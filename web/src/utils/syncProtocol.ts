/**
 * 同步协议：消息类型、时间戳工具、延迟补偿
 *
 * 设计原则：
 * - 所有时间单位为秒（浮点数）
 * - performance.now() 用于高精度计时，Date.now() 用于跨端时间戳
 * - 消息采用 discriminated union，类型安全
 */

// 消息类型定义

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

/**
 * 远端播放状态的本地缓存
 *
 * 关键设计：
 * - `compensatedPosition` 是应用 compensatePosition(rtt/2) 后的位置，
 *   表示"消息到达瞬间，远端实际播放到了哪里"的最佳估计（与时钟偏差无关）。
 * - `localTimestamp` 是该补偿时刻的**本地** Date.now()，
 *   calibrate 用本地时间差推算"补偿后位置 + 已过时间" = 当前远端位置。
 * - 全部用本地时间，彻底避免跨端时钟偏差导致的 seek 抖动。
 */
export interface RemoteState {
  /** 远端是否正在播放 */
  playing: boolean;
  /** 补偿后的远端位置（秒），已应用 RTT/2 单向延迟补偿 */
  compensatedPosition: number;
  /** 补偿时刻的本地时间戳（Date.now() 毫秒） */
  localTimestamp: number;
}

// 同步状态

export type SyncStatus =
  | 'idle'        // 未加入房间
  | 'waiting'     // 等待服务器初始状态
  | 'synced'      // 正常同步中
  | 'recovering'  // 偏差较大，正在 seek 追赶
  | 'desynced';   // 失去同步（网络异常等）

// 配置常量

export const SYNC_CONFIG = {
  /** 校准间隔（秒）— 2 秒一次避免频繁调整 */
  CALIBRATE_INTERVAL: 2.0,

  /** 微小偏差阈值：<此值视为已同步，不调整速率 */
  TINY_DEVIATION: 0.3,

  /** seek 阈值：偏差超过此值直接 seek（提高至 2s，减少可见跳动） */
  SEEK_THRESHOLD: 2.0,

  /** 失去同步阈值：偏差超过此值标记 DESYNCED */
  DESYNC_THRESHOLD: 8.0,

  /** 速率调整比例增益（降低至 0.12 避免频繁变速） */
  RATE_KP: 0.12,

  /** 最小/最大播放速率（收窄范围，避免可感知的变速） */
  MIN_RATE: 0.85,
  MAX_RATE: 1.15,

  /** 心跳间隔（秒） */
  HEARTBEAT_INTERVAL: 30,

  /** 连续校准跳过次数 → DESYNCED（2s × 6 = 12s 无响应） */
  MAX_MISSED_HEARTBEATS: 6,

  /** RTT 上限（秒），超过视为网络异常 */
  MAX_RTT: 2.0,
} as const;

// 时间戳工具

/** 获取 Unix 毫秒时间戳，用于跨端传输 */
export function unixMs(): number {
  return Date.now();
}

// 延迟补偿

/**
 * 计算延迟补偿后的目标位置
 *
 * 用 RTT/2（单向延迟）估计消息在网络传输期间远端视频继续播放的量。
 * 采用 RTT 而非 Date.now()-remoteTimestamp，因为后者依赖跨端时钟同步，
 * 客户端与服务器/其他客户端时钟不一致时会产生错误补偿。
 *
 * @param remotePosition  远端发来的播放位置（秒）
 * @param _remoteTimestamp 远端时间戳（保留参数兼容，不再使用）
 * @param isPlaying       远端是否正在播放
 * @param rtt             当前估算 RTT（秒）
 * @returns 补偿后的实际应跳转位置（秒）
 */
export function compensatePosition(
  remotePosition: number,
  _remoteTimestamp: number,
  isPlaying: boolean,
  rtt: number,
): number {
  if (!isPlaying) return remotePosition;

  // 单向延迟 ≈ RTT / 2，这段时间内远端视频仍在播放
  const oneWayDelay = Math.max(0, rtt / 2);
  // 上限 2 秒，防止陈旧数据导致过度补偿
  return Math.min(remotePosition + oneWayDelay, remotePosition + 2.0);
}

/**
 * 计算本地与远端的偏差
 * @returns 偏差（秒），正数 = 本地超前，负数 = 本地落后；任一无效返回 0
 */
export function calcDeviation(localPosition: number, remotePosition: number): number {
  if (!Number.isFinite(localPosition) || !Number.isFinite(remotePosition)) return 0;
  return localPosition - remotePosition;
}

/**
 * 计算应设置的播放速率（用于微调追赶）
 * @returns 应在 [MIN_RATE, MAX_RATE] 之间的速率值
 */
export function calcPlaybackRate(deviation: number): number {
  if (Math.abs(deviation) < SYNC_CONFIG.TINY_DEVIATION) return 1.0;

  // deviation = local - remote
  // 本地落后 (负) → 加速追赶: rate = 1.0 - (-0.5)*Kp = 1.15 ✓
  // 本地超前 (正) → 减速等待: rate = 1.0 - 0.5*Kp = 0.85    ✓
  const rate = 1.0 - deviation * SYNC_CONFIG.RATE_KP;

  return Math.max(SYNC_CONFIG.MIN_RATE, Math.min(SYNC_CONFIG.MAX_RATE, rate));
}
