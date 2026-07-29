import { useRef, useEffect, useCallback, useState } from 'react';
import { useRoomStore } from '../store/roomStore';
import {
  type SyncStatus,
  type RemoteState,
  SYNC_CONFIG,
  compensatePosition,
  calcDeviation,
  calcPlaybackRate,
  unixMs,
} from '../utils/syncProtocol';

// Player API

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

// Hook

interface UseSyncOptions {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  myId: string;
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
  const syncingRef = useRef(0);
  const syncLockTimeoutsRef = useRef<number[]>([]);

  // remoteRef 存补偿后位置 + 本地时间，彻底避免跨端时钟偏差
  const remoteRef = useRef<RemoteState>({
    playing: false,
    compensatedPosition: 0,
    localTimestamp: 0,
  });

  const statusRef = useRef<SyncStatus>('idle');
  const calibrateTimer = useRef<number | null>(null);
  const recoverTimer = useRef<number | null>(null);
  const stallCountRef = useRef(0);

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [deviation, setDeviation] = useState(0);
  const [remotePosition, setRemotePosition] = useState(0);

  const setSyncStatus = useCallback((s: SyncStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const registerPlayer = useCallback((api: PlayerAPI | null) => {
    playerRef.current = api;
  }, []);

  const syncLock = useCallback((fn: () => void, duration = 300) => {
    syncingRef.current++;
    fn();
    const id = window.setTimeout(() => {
      syncingRef.current = Math.max(0, syncingRef.current - 1);
    }, duration);
    syncLockTimeoutsRef.current.push(id);
  }, []);

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

  const getRtt = useCallback(() => useRoomStore.getState().wsRtt, []);

  // ── 核心：应用远端指令 ──
  const applyRemote = useCallback(
    (cmd: RemoteSyncCommand) => {
      const player = playerRef.current;
      if (!player) return;

      const rtt = getRtt();

      if (cmd.type === 'play' || cmd.type === 'pause' || cmd.type === 'seek') {
        const rawPos = cmd.position ?? remoteRef.current.compensatedPosition;
        const ts = cmd.clientTimestamp ?? Date.now();
        const isPlaying = cmd.type === 'play' || (cmd.type === 'seek' && remoteRef.current.playing);

        // compensatePosition 用 rtt/2 补偿传输延迟（时钟无关）
        const targetPos = compensatePosition(rawPos, ts, isPlaying, rtt);

        // 存补偿后位置 + 本地时间（calibrate 用本地时间差推算，避时钟偏差）
        remoteRef.current = {
          playing: isPlaying,
          compensatedPosition: targetPos,
          localTimestamp: Date.now(),
        };
        setRemotePosition(targetPos);

        syncLock(() => {
          if (Math.abs(player.getCurrentTime() - targetPos) > SYNC_CONFIG.SEEK_THRESHOLD) {
            player.seek(targetPos);
          }
          player.setPlaybackRate(1.0);
          if (cmd.type === 'play') player.play();
          else if (cmd.type === 'pause') player.pause();
        }, 400);

        setSyncStatus('synced');
      } else if (cmd.type === 'change_video') {
        const store = useRoomStore.getState();
        store.setCurrentVideo({ url: cmd.videoUrl || '', title: cmd.title || '' });
        store.setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
        remoteRef.current = { playing: false, compensatedPosition: 0, localTimestamp: Date.now() };
        setRemotePosition(0);
        setSyncStatus('synced');
      } else if (cmd.type === 'sync_response') {
        const isPlaying = cmd.status === 'playing';
        const rawPos = cmd.position ?? 0;
        const ts = cmd.serverTimestamp ?? Date.now();

        const targetPos = compensatePosition(rawPos, ts, isPlaying, rtt);

        remoteRef.current = {
          playing: isPlaying,
          compensatedPosition: targetPos,
          localTimestamp: Date.now(),
        };
        setRemotePosition(targetPos);

        syncLock(() => {
          player.seek(targetPos);
          player.setPlaybackRate(1.0);
          if (isPlaying) player.play();
          else player.pause();
        }, 500);

        setSyncStatus('synced');
      }
    },
    [syncLock, setSyncStatus, getRtt]
  );

  // ── 核心：每秒校准循环 ──
  const calibrate = useCallback(() => {
    const player = playerRef.current;
    if (!player || syncingRef.current > 0) return;
    if (statusRef.current !== 'synced' && statusRef.current !== 'recovering') return;

    if (player.isBuffering() || document.hidden) {
      stallCountRef.current++;
      if (stallCountRef.current >= SYNC_CONFIG.MAX_MISSED_HEARTBEATS) {
        setSyncStatus('desynced');
      }
      return;
    }
    stallCountRef.current = 0;

    const local = player.getCurrentTime();
    const remote = remoteRef.current;

    // target = 补偿后位置 + 本地已过时间（全部本地时钟，零时钟偏差）
    let target = remote.compensatedPosition;
    if (remote.playing) {
      const elapsed = (Date.now() - remote.localTimestamp) / 1000;
      target = remote.compensatedPosition + elapsed;
    }

    const dev = calcDeviation(local, target);
    setDeviation(dev);

    if (Math.abs(dev) >= SYNC_CONFIG.DESYNC_THRESHOLD) {
      setSyncStatus('desynced');
      return;
    }

    if (Math.abs(dev) >= SYNC_CONFIG.SEEK_THRESHOLD) {
      setSyncStatus('recovering');
      syncLock(() => {
        player.seek(target);
        player.setPlaybackRate(1.0);
      }, 600);
      if (recoverTimer.current) clearTimeout(recoverTimer.current);
      recoverTimer.current = window.setTimeout(() => {
        if (statusRef.current === 'recovering') setSyncStatus('synced');
      }, 800);
    } else {
      setSyncStatus('synced');
      const rate = calcPlaybackRate(dev);
      if (Math.abs(player.getPlaybackRate() - rate) > 0.01) {
        player.setPlaybackRate(rate);
      }
    }
  }, [syncLock, setSyncStatus]);

  // ── 本地用户操作 ──
  const handlePlayerPlay = useCallback(() => {
    if (syncingRef.current > 0) return;
    sendCommand('play');
    // 自己是播放源：补偿后位置 = 当前本地位置，无传输延迟
    const pos = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current = { playing: true, compensatedPosition: pos, localTimestamp: Date.now() };
    setSyncStatus('synced');
  }, [sendCommand, setSyncStatus]);

  const handlePlayerPause = useCallback(() => {
    if (syncingRef.current > 0) return;
    sendCommand('pause');
    const pos = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current = { playing: false, compensatedPosition: pos, localTimestamp: Date.now() };
    setSyncStatus('synced');
  }, [sendCommand, setSyncStatus]);

  const handlePlayerSeeked = useCallback(() => {
    if (syncingRef.current > 0) return;
    sendCommand('seek');
    const pos = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.compensatedPosition = pos;
    remoteRef.current.localTimestamp = Date.now();
    setSyncStatus('synced');
  }, [sendCommand, setSyncStatus]);

  useEffect(() => {
    if (!connected) {
      if (statusRef.current !== 'idle') setSyncStatus('waiting');
    }
  }, [connected, setSyncStatus]);

  useEffect(() => {
    if (!connected) return;
    calibrateTimer.current = window.setInterval(() => calibrate(), SYNC_CONFIG.CALIBRATE_INTERVAL * 1000);
    return () => { if (calibrateTimer.current) clearInterval(calibrateTimer.current); };
  }, [connected, calibrate]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) return;
      if (statusRef.current === 'idle' || !playerRef.current) return;
      const player = playerRef.current;
      calibrate();
      stallCountRef.current = 0;
      if (remoteRef.current.playing && player.isPaused()) {
        player.play().catch(() => {
          setSyncStatus('synced');
          remoteRef.current.playing = false;
          sendMessage('pause', { position: player.getCurrentTime(), clientTimestamp: unixMs() });
        });
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [calibrate, sendMessage, setSyncStatus]);

  const handleRemoteCommand = useCallback(
    (cmd: RemoteSyncCommand) => {
      if (cmd.senderId && cmd.senderId === myId) return;
      if (cmd.type === 'pong') { stallCountRef.current = 0; return; }
      applyRemote(cmd);
    },
    [myId, applyRemote]
  );

  const onRoomEnter = useCallback(() => {
    setSyncStatus('waiting');
    stallCountRef.current = 0;
  }, [setSyncStatus]);

  const onRoomLeave = useCallback(() => {
    setSyncStatus('idle');
    remoteRef.current = { playing: false, compensatedPosition: 0, localTimestamp: 0 };
    setDeviation(0);
    setRemotePosition(0);
    playerRef.current?.setPlaybackRate(1.0);
  }, [setSyncStatus]);

  useEffect(() => {
    return () => {
      syncLockTimeoutsRef.current.forEach(clearTimeout);
      syncLockTimeoutsRef.current = [];
      if (calibrateTimer.current) clearInterval(calibrateTimer.current);
      if (recoverTimer.current) clearTimeout(recoverTimer.current);
    };
  }, []);

  return {
    status,
    deviation,
    remotePosition,
    registerPlayer,
    handleRemoteCommand,
    onRoomEnter,
    onRoomLeave,
    handlePlayerPlay,
    handlePlayerPause,
    handlePlayerSeeked,
  };
}
