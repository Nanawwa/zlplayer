import { useRef, useEffect, useCallback, useState } from 'react';
import {
  type SyncStatus,
  SYNC_CONFIG,
  RTTTracker,
  compensatePosition,
  calcDeviation,
  calcPlaybackRate,
  nowSeconds,
  unixMs,
} from '../utils/syncProtocol';

// ── Player API ──

export interface PlayerAPI {
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  getCurrentTime(): number;
  isPaused(): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getDuration(): number;
  isBuffering(): boolean;
}

export interface RemoteSyncCommand {
  type: 'play' | 'pause' | 'seek' | 'change_video' | 'sync_response' | 'pong';
  position?: number;
  clientTimestamp?: number;
  serverTimestamp?: number;
  status?: 'playing' | 'paused';
  videoUrl?: string | null;
  title?: string | null;
  senderId?: string;
  ownerId?: string;
  members?: unknown[];
}

// ── Hook ──

interface UseSyncOptions {
  /** 发送 WS 消息 */
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  /** 当前用户 ID */
  myId: string;
  /** 是否已连接 */
  connected: boolean;
}

interface UseSyncReturn {
  status: SyncStatus;
  deviation: number;
  remotePosition: number;
  registerPlayer: (api: PlayerAPI | null) => void;
  handleRemoteCommand: (cmd: RemoteSyncCommand) => void;
  onRoomEnter: () => void;
  onRoomLeave: () => void;
  handlePlayerPlay: () => void;
  handlePlayerPause: () => void;
  handlePlayerSeeked: () => void;
}

export function useSync({ sendMessage, myId, connected }: UseSyncOptions): UseSyncReturn {
  const playerRef = useRef<PlayerAPI | null>(null);
  const syncingRef = useRef(false);
  const remoteRef = useRef({ position: 0, playing: false, timestamp: 0 });
  const statusRef = useRef<SyncStatus>('idle');
  const rttTracker = useRef(new RTTTracker());
  const calibrateTimer = useRef<number | null>(null);
  const heartbeatTimer = useRef<number | null>(null);
  const missedBeats = useRef(0);
  const localUserAction = useRef(false);

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [deviation, setDeviation] = useState(0);
  const [remotePosition, setRemotePosition] = useState(0);

  const setSyncStatus = useCallback((s: SyncStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ── register player ──
  const registerPlayer = useCallback((api: PlayerAPI | null) => {
    playerRef.current = api;
  }, []);

  // ── sync lock (防止回环广播) ──
  const syncLock = useCallback((fn: () => void, duration = 300) => {
    syncingRef.current = true;
    fn();
    setTimeout(() => { syncingRef.current = false; }, duration);
  }, []);

  // ── send local command ──
  const sendCommand = useCallback(
    (type: string, extra: Record<string, unknown> = {}) => {
      const player = playerRef.current;
      if (!player) return;
      sendMessage(type, {
        position: player.getCurrentTime(),
        clientTimestamp: unixMs(),
        ...extra,
      });
    },
    [sendMessage]
  );

  // ── apply remote command ──
  const applyRemote = useCallback(
    (cmd: RemoteSyncCommand) => {
      const player = playerRef.current;
      if (!player) return;

      const rtt = rttTracker.current.current;

      if (cmd.type === 'play') {
        const pos = compensatePosition(
          cmd.position ?? remoteRef.current.position,
          cmd.clientTimestamp ?? Date.now(),
          true,
          rtt
        );
        remoteRef.current = { position: pos, playing: true, timestamp: Date.now() };
        setRemotePosition(pos);

        syncLock(() => {
          if (Math.abs(player.getCurrentTime() - pos) > SYNC_CONFIG.SEEK_THRESHOLD) {
            player.seek(pos);
          }
          player.setPlaybackRate(1.0);
          player.play();
        }, 400);
      } else if (cmd.type === 'pause') {
        const pos = cmd.position ?? remoteRef.current.position;
        remoteRef.current = { position: pos, playing: false, timestamp: Date.now() };
        setRemotePosition(pos);

        syncLock(() => {
          if (Math.abs(player.getCurrentTime() - pos) > SYNC_CONFIG.SEEK_THRESHOLD) {
            player.seek(pos);
          }
          player.setPlaybackRate(1.0);
          player.pause();
        }, 400);
      } else if (cmd.type === 'seek') {
        const pos = compensatePosition(
          cmd.position ?? remoteRef.current.position,
          cmd.clientTimestamp ?? Date.now(),
          remoteRef.current.playing,
          rtt
        );
        remoteRef.current.position = pos;
        setRemotePosition(pos);

        syncLock(() => {
          player.seek(pos);
          player.setPlaybackRate(1.0);
        }, 600);
      } else if (cmd.type === 'sync_response') {
        const isPlaying = cmd.status === 'playing';
        const pos = isPlaying
          ? compensatePosition(cmd.position ?? 0, cmd.serverTimestamp ?? Date.now(), true, rtt)
          : (cmd.position ?? 0);

        remoteRef.current = { position: pos, playing: isPlaying, timestamp: Date.now() };
        setRemotePosition(pos);

        syncLock(() => {
          player.seek(pos);
          player.setPlaybackRate(1.0);
          if (isPlaying) {
            player.play();
          } else {
            player.pause();
          }
        }, 500);

        setSyncStatus('synced');
      }
    },
    [syncLock, setSyncStatus]
  );

  // ── calibration loop ──
  const calibrate = useCallback(() => {
    const player = playerRef.current;
    if (!player || syncingRef.current) return;
    if (statusRef.current !== 'synced' && statusRef.current !== 'recovering') return;
    if (player.isBuffering()) return; // 缓冲中不校准
    if (document.hidden) return;       // 页面不可见不校准

    const local = player.getCurrentTime();
    const remote = remoteRef.current.position;

    // 如果远端正在播放，推算远端当前位置
    let target = remote;
    if (remoteRef.current.playing) {
      const elapsed = (Date.now() - remoteRef.current.timestamp) / 1000;
      target = remote + elapsed;
    }

    const dev = calcDeviation(local, target);
    setDeviation(dev);

    if (Math.abs(dev) >= SYNC_CONFIG.DESYNC_THRESHOLD) {
      setSyncStatus('desynced');
      return;
    }

    if (Math.abs(dev) >= SYNC_CONFIG.SEEK_THRESHOLD) {
      // 大偏差：直接 seek
      setSyncStatus('recovering');
      syncLock(() => {
        player.seek(target);
        player.setPlaybackRate(1.0);
      }, 600);
      // 恢复后回到 synced
      setTimeout(() => {
        if (statusRef.current === 'recovering') setSyncStatus('synced');
      }, 800);
    } else {
      // 小偏差：调整速率
      setSyncStatus('synced');
      const rate = calcPlaybackRate(dev);
      if (Math.abs(player.getPlaybackRate() - rate) > 0.01) {
        player.setPlaybackRate(rate);
      }
    }
  }, [syncLock, setSyncStatus]);

  // ── player event handlers (user actions → send) ──
  const handlePlayerPlay = useCallback(() => {
    if (syncingRef.current || localUserAction.current) return;
    localUserAction.current = true;
    sendCommand('play');
    remoteRef.current.playing = true;
    remoteRef.current.position = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.timestamp = Date.now();
    setSyncStatus('synced');
    setTimeout(() => { localUserAction.current = false; }, 200);
  }, [sendCommand, setSyncStatus]);

  const handlePlayerPause = useCallback(() => {
    if (syncingRef.current || localUserAction.current) return;
    localUserAction.current = true;
    sendCommand('pause');
    remoteRef.current.playing = false;
    remoteRef.current.position = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.timestamp = Date.now();
    setSyncStatus('synced');
    setTimeout(() => { localUserAction.current = false; }, 200);
  }, [sendCommand, setSyncStatus]);

  const handlePlayerSeeked = useCallback(() => {
    if (syncingRef.current || localUserAction.current) return;
    localUserAction.current = true;
    sendCommand('seek');
    remoteRef.current.position = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.timestamp = Date.now();
    setSyncStatus('synced');
    setTimeout(() => { localUserAction.current = false; }, 200);
  }, [sendCommand, setSyncStatus]);

  // ── calibrate interval ──
  useEffect(() => {
    if (!connected || statusRef.current === 'idle') return;

    calibrateTimer.current = window.setInterval(() => {
      calibrate();
    }, SYNC_CONFIG.CALIBRATE_INTERVAL * 1000);

    return () => {
      if (calibrateTimer.current) clearInterval(calibrateTimer.current);
    };
  }, [connected, calibrate]);

  // ── heartbeat ──
  useEffect(() => {
    if (!connected) return;

    heartbeatTimer.current = window.setInterval(() => {
      rttTracker.current.ping();
      sendMessage('ping', {});
      missedBeats.current++;

      if (missedBeats.current >= SYNC_CONFIG.MAX_MISSED_HEARTBEATS) {
        setSyncStatus('desynced');
      }
    }, SYNC_CONFIG.HEARTBEAT_INTERVAL * 1000);

    return () => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    };
  }, [connected, sendMessage, setSyncStatus]);

  // ── visibility change ──
  useEffect(() => {
    const handler = () => {
      if (!document.hidden && statusRef.current !== 'idle' && playerRef.current) {
        // 回到前台：强制校准一次
        calibrate();
        missedBeats.current = 0;
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [calibrate]);

  // ── public API ──
  const handleRemoteCommand = useCallback(
    (cmd: RemoteSyncCommand) => {
      // 忽略自己发出的消息
      if (cmd.senderId === myId) return;

      if (cmd.type === 'pong') {
        rttTracker.current.pong();
        missedBeats.current = 0;
        return;
      }

      applyRemote(cmd);
    },
    [myId, applyRemote]
  );

  const onRoomEnter = useCallback(() => {
    setSyncStatus('waiting');
    missedBeats.current = 0;
  }, [setSyncStatus]);

  const onRoomLeave = useCallback(() => {
    setSyncStatus('idle');
    remoteRef.current = { position: 0, playing: false, timestamp: 0 };
    setDeviation(0);
    setRemotePosition(0);
    // 恢复正常速率
    playerRef.current?.setPlaybackRate(1.0);
  }, [setSyncStatus]);

  return {
    status,
    deviation,
    remotePosition,
    registerPlayer,
    handleRemoteCommand,
    onRoomEnter,
    onRoomLeave,
    // expose for VideoPlayer to subscribe to player events
    handlePlayerPlay,
    handlePlayerPause,
    handlePlayerSeeked,
  };
}
