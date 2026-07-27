/**
 * 同步协议：消息类型、时间戳工具、延迟补偿
 *
 * 设计原则：
 * - 所有时间单位为秒（浮点数）
 * - performance.now() 用于高精度计时，Date.now() 用于跨端时间戳
 * - 消息采用 discriminated union，类型安全
 */

// ── 消息类型定义 ──

export interface PlayMessage {
  type: 'play';
  position: number;
  clientTimestamp: number;   // 发送方的 Date.now()
  senderId: string;
}

export interface PauseMessage {
  type: 'pause';
  position: number;
  clientTimestamp: number;
  senderId: string;
}

export interface SeekMessage {
  type: 'seek';
  position: number;
  clientTimestamp: number;
  senderId: string;
}

export interface ChangeVideoMessage {
  type: 'change_video';
  url: string;
  title: string;
  senderId: string;
}

export interface SyncResponseMessage {
  type: 'sync_response';
  videoUrl: string | null;
  title: string | null;
  status: 'playing' | 'paused';
  position: number;
  playbackRate: number;
  serverTimestamp: number;
  members: unknown[];
  ownerId: string;
}

/** 同步控制消息联合类型 */
export type SyncCommand =
  | PlayMessage
  | PauseMessage
  | SeekMessage
  | ChangeVideoMessage
  | SyncResponseMessage;

// ── 同步状态 ──

export type SyncStatus =
  | 'idle'        // 未加入房间
  | 'waiting'     // 等待服务器初始状态
  | 'synced'      // 正常同步中
  | 'recovering'  // 偏差较大，正在 seek 追赶
  | 'desynced';   // 失去同步（网络异常等）

// ── 配置常量 ──

export const SYNC_CONFIG = {
  /** 校准间隔（秒） */
  CALIBRATE_INTERVAL: 1.0,

  /** 微小偏差阈值：<此值视为已同步，恢复正常速率 */
  TINY_DEVIATION: 0.05,

  /** seek 阈值：偏差超过此值直接 seek */
  SEEK_THRESHOLD: 0.5,

  /** 失去同步阈值：偏差超过此值标记 DESYNCED */
  DESYNC_THRESHOLD: 5.0,

  /** 速率调整比例增益 */
  RATE_KP: 0.8,

  /** 最小/最大播放速率 */
  MIN_RATE: 0.5,
  MAX_RATE: 2.0,

  /** 心跳间隔（秒） */
  HEARTBEAT_INTERVAL: 30,

  /** 连续心跳失败次数 → DESYNCED */
  MAX_MISSED_HEARTBEATS: 3,

  /** RTT 上限（秒），超过视为网络异常 */
  MAX_RTT: 2.0,
} as const;

// ── 时间戳工具 ──

/** 获取高精度本地时间（秒），用于时间差计算 */
export function nowSeconds(): number {
  return performance.now() / 1000;
}

/** 获取 Unix 毫秒时间戳，用于跨端传输 */
export function unixMs(): number {
  return Date.now();
}

// ── RTT 计算 ──

/** RTT 追踪器 */
export class RTTTracker {
  private samples: number[] = [];
  private lastPingTime = 0;
  private _current = 0.1; // 默认 100ms

  /** 开始一次 ping 测量 */
  ping() {
    this.lastPingTime = performance.now();
  }

  /** 收到 pong，记录 RTT */
  pong() {
    const rtt = (performance.now() - this.lastPingTime) / 1000;
    this.samples.push(rtt);
    if (this.samples.length > 10) this.samples.shift();
    // 指数加权移动平均
    this._current = this._current * 0.7 + rtt * 0.3;
  }

  /** 当前估算 RTT（秒） */
  get current(): number {
    return this._current;
  }

  /** RTT 是否异常 */
  get isHighLatency(): boolean {
    return this._current > SYNC_CONFIG.MAX_RTT;
  }
}

// ── 延迟补偿 ──

/**
 * 计算延迟补偿后的目标位置
 *
 * @param remotePosition  远端发来的播放位置（秒）
 * @param remoteTimestamp 远端发来的时间戳（Date.now() 毫秒）
 * @param isPlaying       远端是否正在播放
 * @param rtt             当前估算 RTT（秒）
 * @returns 补偿后的实际应跳转位置（秒）
 */
export function compensatePosition(
  remotePosition: number,
  remoteTimestamp: number,
  isPlaying: boolean,
  rtt: number,
): number {
  if (!isPlaying) return remotePosition;

  // 从远端发来到我方收到，经历的时间 ≈ RTT/2
  // 这段时间内远端视频继续播放，所以需要加上这段时间的播放量
  const elapsed = (Date.now() - remoteTimestamp) / 1000;
  const delay = Math.min(elapsed, rtt); // 取较小值防止异常跳变

  return remotePosition + delay;
}

/**
 * 计算本地与远端的偏差
 * @returns 偏差（秒），正数 = 本地超前，负数 = 本地落后
 */
export function calcDeviation(localPosition: number, remotePosition: number): number {
  return localPosition - remotePosition;
}

/**
 * 计算应设置的播放速率（用于微调追赶）
 * @returns 应在 [MIN_RATE, MAX_RATE] 之间的速率值
 */
export function calcPlaybackRate(deviation: number): number {
  if (Math.abs(deviation) < SYNC_CONFIG.TINY_DEVIATION) return 1.0;

  // 比例控制：本地落后 → 加速，本地超前 → 减速
  const rate = 1.0 + deviation * SYNC_CONFIG.RATE_KP;

  return Math.max(SYNC_CONFIG.MIN_RATE, Math.min(SYNC_CONFIG.MAX_RATE, rate));
}
