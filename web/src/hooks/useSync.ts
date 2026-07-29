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
  const syncingRef = useRef(0); // 计数器而非布尔，防止嵌套 syncLock 竞态
  const syncLockTimeoutsRef = useRef<number[]>([]);
  const remoteRef = useRef<RemoteState>({
    playing: false,
    originalPosition: 0,
    originalServerTimestamp: 0,
    localArrivalTime: 0,
  });
  const statusRef = useRef<SyncStatus>('idle');
  const calibrateTimer = useRef<number | null>(null);
  const recoverTimer = useRef<number | null>(null);
  // 网络停滞安全网：连续多次校准跳过（缓冲/隐藏/无 pong）则标记 desynced
  const stallCountRef = useRef(0);

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [deviation, setDeviation] = useState(0);
  const [remotePosition, setRemotePosition] = useState(0);

  const setSyncStatus = useCallback((s: SyncStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // register player
  const registerPlayer = useCallback((api: PlayerAPI | null) => {
    playerRef.current = api;
  }, []);

  // sync lock (防止回环广播)；超时 timer 统一收集，unmount 清理
  const syncing = useCallback(() => syncingRef.current > 0, []);

  const syncLock = useCallback((fn: () => void, duration = 300) => {
    syncingRef.current++;
    fn();
    const id = window.setTimeout(() => {
      syncingRef.current = Math.max(0, syncingRef.current - 1);
    }, duration);
    syncLockTimeoutsRef.current.push(id);
  }, []);

  // send local command
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

  // 读取当前 RTT（来自 store，由 useWebSocket 心跳更新）
  const getRtt = useCallback(() => useRoomStore.getState().wsRtt, []);

  // apply remote command
  const applyRemote = useCallback(
    (cmd: RemoteSyncCommand) => {
      const player = playerRef.current;
      if (!player) return;

      const rtt = getRtt();

      if (cmd.type === 'play' || cmd.type === 'pause' || cmd.type === 'seek') {
        const rawPos = cmd.position ?? remoteRef.current.originalPosition;
        const ts = cmd.clientTimestamp ?? Date.now();
        const isPlaying = cmd.type === 'play' || (cmd.type === 'seek' && remoteRef.current.playing);

        // remoteRef 存未补偿原始数据，供 calibrate 推算
        remoteRef.current = {
          playing: isPlaying,
          originalPosition: rawPos,
          originalServerTimestamp: ts,
          localArrivalTime: Date.now(),
        };
        setRemotePosition(rawPos);

        // 当前 seek 目标用 compensatePosition 即时补偿（rtt/2）
        const targetPos = compensatePosition(rawPos, ts, isPlaying, rtt);

        syncLock(() => {
          if (Math.abs(player.getCurrentTime() - targetPos) > SYNC_CONFIG.SEEK_THRESHOLD) {
            player.seek(targetPos);
          }
          player.setPlaybackRate(1.0);
          if (cmd.type === 'play') player.play();
          else if (cmd.type === 'pause') player.pause();
          // seek: 不改变播放状态
        }, 400);

        setSyncStatus('synced');
      } else if (cmd.type === 'change_video') {
        const store = useRoomStore.getState();
        store.setCurrentVideo({ url: cmd.videoUrl || '', title: cmd.title || '' });
        store.setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
        remoteRef.current = {
          playing: false,
          originalPosition: 0,
          originalServerTimestamp: Date.now(),
          localArrivalTime: Date.now(),
        };
        setRemotePosition(0);
        setSyncStatus('synced');
      } else if (cmd.type === 'sync_response') {
        const isPlaying = cmd.status === 'playing';
        const rawPos = cmd.position ?? 0;
        const ts = cmd.serverTimestamp ?? Date.now();

        remoteRef.current = {
          playing: isPlaying,
          originalPosition: rawPos,
          originalServerTimestamp: ts,
          localArrivalTime: Date.now(),
        };
        setRemotePosition(rawPos);

        const targetPos = compensatePosition(rawPos, ts, isPlaying, rtt);

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

  // calibration loop
  const calibrate = useCallback(() => {
    const player = playerRef.current;
    if (!player || syncingRef.current > 0) return;
    if (statusRef.current !== 'synced' && statusRef.current !== 'recovering') return;

    // 缓冲中 / 页面不可见：跳过并累计停滞计数
    if (player.isBuffering() || document.hidden) {
      stallCountRef.current++;
      if (stallCountRef.current >= SYNC_CONFIG.MAX_MISSED_HEARTBEATS) {
        setSyncStatus('desynced');
      }
      return;
    }

    const local = player.getCurrentTime();
    const remote = remoteRef.current;

    // 用原始未补偿数据推算远端当前位置（elapsed 自消息发出起算）
    let target = remote.originalPosition;
    if (remote.playing) {
      const elapsed = (Date.now() - remote.originalServerTimestamp) / 1000;
      target = remote.originalPosition + elapsed;
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
      if (recoverTimer.current) clearTimeout(recoverTimer.current);
      recoverTimer.current = window.setTimeout(() => {
        if (statusRef.current === 'recovering') setSyncStatus('synced');
      }, 800);
    } else {
      // 小偏差：调整速率
      setSyncStatus('synced');
      stallCountRef.current = 0;
      const rate = calcPlaybackRate(dev);
      if (Math.abs(player.getPlaybackRate() - rate) > 0.01) {
        player.setPlaybackRate(rate);
      }
    }
  }, [syncLock, setSyncStatus]);

  // player event handlers (user actions → send)
  const handlePlayerPlay = useCallback(() => {
    if (syncingRef.current > 0) return;
    sendCommand('play');
    remoteRef.current.playing = true;
    remoteRef.current.originalPosition = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.originalServerTimestamp = Date.now();
    setSyncStatus('synced');
  }, [sendCommand, setSyncStatus]);

  const handlePlayerPause = useCallback(() => {
    if (syncingRef.current > 0) return;
    sendCommand('pause');
    remoteRef.current.playing = false;
    remoteRef.current.originalPosition = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.originalServerTimestamp = Date.now();
    setSyncStatus('synced');
  }, [sendCommand, setSyncStatus]);

  const handlePlayerSeeked = useCallback(() => {
    if (syncingRef.current > 0) return;
    sendCommand('seek');
    remoteRef.current.originalPosition = playerRef.current?.getCurrentTime() ?? 0;
    remoteRef.current.originalServerTimestamp = Date.now();
    setSyncStatus('synced');
  }, [sendCommand, setSyncStatus]);

  // handle connection state changes
  useEffect(() => {
    if (!connected) {
      if (statusRef.current !== 'idle') setSyncStatus('waiting');
    }
  }, [connected, setSyncStatus]);

  // calibrate interval：connected 即常驻，calibrate 内部用 statusRef 门控
  useEffect(() => {
    if (!connected) return;

    calibrateTimer.current = window.setInterval(() => {
      calibrate();
    }, SYNC_CONFIG.CALIBRATE_INTERVAL * 1000);

    return () => {
      if (calibrateTimer.current) clearInterval(calibrateTimer.current);
    };
  }, [connected, calibrate]);

  // visibility change: recover from system interruptions
  useEffect(() => {
    const handler = () => {
      if (document.hidden) return;
      if (statusRef.current === 'idle' || !playerRef.current) return;

      const player = playerRef.current;
      calibrate();
      stallCountRef.current = 0;

      // 远端在播放但本地暂停了（系统打断），尝试恢复
      if (remoteRef.current.playing && player.isPaused()) {
        player.play().catch(() => {
          setSyncStatus('synced');
          remoteRef.current.playing = false;
          sendMessage('pause', {
            position: player.getCurrentTime(),
            clientTimestamp: unixMs(),
          });
        });
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [calibrate, sendMessage, setSyncStatus]);

  // public API
  const handleRemoteCommand = useCallback(
    (cmd: RemoteSyncCommand) => {
      // 忽略自己发出的指令（唯一过滤点）
      if (cmd.senderId && cmd.senderId === myId) return;

      if (cmd.type === 'pong') {
        // 心跳响应：重置停滞计数
        stallCountRef.current = 0;
        return;
      }

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
    remoteRef.current = {
      playing: false,
      originalPosition: 0,
      originalServerTimestamp: 0,
      localArrivalTime: 0,
    };
    setDeviation(0);
    setRemotePosition(0);
    playerRef.current?.setPlaybackRate(1.0);
  }, [setSyncStatus]);

  // unmount 清理所有定时器
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
