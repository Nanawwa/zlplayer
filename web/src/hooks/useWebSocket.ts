import { useEffect, useRef, useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';
import type { WSMessage, ChatMessage } from '../types';

/**
 * WebSocket 连接与重连 Hook
 *
 * 特性：
 * - 自动重连（指数退避，最大间隔 60s）
 * - 心跳（每 30s ping）
 * - 消息分发
 */

/**
 * 获取 WebSocket 连接地址
 * 优先级：localStorage 手动指定 > 生产环境自动检测 > 环境变量 > 默认值
 *
 * 生产环境：自动使用当前页面的域名（http→ws, https→wss）
 * 开发环境：默认 ws://localhost:8080
 */
function getWsUrl(): string {
  // 1. 用户手动指定的地址
  try {
    const manual = localStorage.getItem('zlplay_ws_url');
    if (manual) return manual;
  } catch { /* ignore */ }

  // 2. 生产环境：自动从当前页面 URL 推断（nginx 在 /ws 路径代理 WebSocket）
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  // 3. 环境变量
  const envUrl = (import.meta as any).env?.VITE_WS_URL;
  if (envUrl) return envUrl;

  // 4. 开发环境默认值
  return 'ws://localhost:8080';
}

export function setWsUrl(url: string): void {
  localStorage.setItem('zlplay_ws_url', url);
}

export function useWebSocket(onRemoteMsg?: (msg: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const myIdRef = useRef('');
  const onRemoteRef = useRef(onRemoteMsg);
  onRemoteRef.current = onRemoteMsg;

  const {
    setMyId,
    setWsConnected,
    setWsError,
    setRoomCode,
    setIsOwner,
    setOwnerId,
    setMembers,
    setCurrentVideo,
    setPlayerState,
    addChatMessage,
    setPage,
  } = useRoomStore();

  /** 发送消息 */
  const sendMessage = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    } else {
      console.warn('[WS] 未连接，无法发送消息:', type);
    }
  }, []);

  /** 处理收到的消息 */
  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.warn('[WS] 收到无效 JSON');
      return;
    }

    const { type, ...payload } = msg;

    switch (type) {
      // 服务器分配的 clientId，统一使用此 ID
      case 'connected': {
        const svrId = payload.clientId as string;
        myIdRef.current = svrId;
        setMyId(svrId);
        console.log('[WS] 服务器分配 ID:', svrId);
        break;
      }

      case 'room_created': {
        setRoomCode(payload.code as string);
        setOwnerId(payload.ownerId as string);
        setIsOwner(true);
        setMembers((payload.members as any[]) || []);
        setPage('room');
        break;
      }

      case 'sync_response': {
        // 转发给 useSync（新同步引擎）
        onRemoteRef.current?.({
          type: 'sync_response',
          position: (payload.playerState as any)?.position,
          status: (payload.playerState as any)?.playing ? 'playing' : 'paused',
          serverTimestamp: (payload.playerState as any)?.timestamp,
        });

        setRoomCode(payload.code as string);
        setOwnerId(payload.ownerId as string);
        setIsOwner((payload.ownerId as string) === myIdRef.current);
        setMembers((payload.members as any[]) || []);
        if (payload.currentVideo) {
          setCurrentVideo(payload.currentVideo as any);
        }
        if (payload.playerState) {
          setPlayerState(payload.playerState as any);
        }
        setPage('room');
        break;
      }

      case 'member_joined': {
        setMembers((payload.members as any[]) || []);
        break;
      }

      case 'member_left': {
        setMembers((payload.members as any[]) || []);
        break;
      }

      case 'owner_changed': {
        const newOwnerId = payload.ownerId as string;
        setOwnerId(newOwnerId);
        setIsOwner(newOwnerId === myIdRef.current);
        break;
      }

      case 'play':
      case 'pause':
      case 'seek': {
        const senderId = payload.senderId as string;
        // 忽略自己发出的指令
        if (senderId === myIdRef.current) break;

        // 转发给 useSync（新同步引擎）
        onRemoteRef.current?.({
          type,
          position: payload.position,
          clientTimestamp: payload.clientTimestamp || payload.timestamp,
          senderId,
        });

        const position = payload.position as number;
        const timestamp = payload.timestamp as number;

        // 根据 RTT/2 微调 position（保留兼容旧逻辑）
        const now = Date.now();
        const rtt = timestamp ? now - timestamp : 0;
        const adjustedPosition = (position ?? 0) + rtt / 2000;

        // seek 只更新位置，不改播放状态
        // play/pause 更新播放状态 + 位置
        const update: Record<string, unknown> = {
          position: adjustedPosition,
          timestamp: now,
        };
        if (type === 'play') update.playing = true;
        else if (type === 'pause') update.playing = false;
        // type === 'seek': 不传 playing，保持当前播放状态

        setPlayerState(update as any);
        break;
      }

      case 'change_video': {
        const senderId = payload.senderId as string;
        if (senderId === myIdRef.current) break;

        setCurrentVideo({
          url: payload.url as string,
          title: payload.title as string || '',
        });
        setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
        break;
      }

      case 'chat': {
        addChatMessage({
          senderId: payload.senderId as string,
          senderName: payload.senderName as string,
          message: payload.message as string,
          timestamp: payload.timestamp as number,
        });
        break;
      }

      case 'room_destroyed': {
        useRoomStore.getState().resetRoom();
        break;
      }

      case 'left_room': {
        useRoomStore.getState().resetRoom();
        break;
      }

      case 'pong': {
        // 心跳响应，不需要处理
        break;
      }

      case 'error': {
        console.error('[WS] 服务器错误:', payload.message);
        setWsError(payload.message as string);
        break;
      }

      case 'server_shutdown': {
        setWsError('服务器正在关闭');
        break;
      }

      default:
        console.log('[WS] 未处理的消息类型:', type);
    }
  }, [setRoomCode, setOwnerId, setIsOwner, setMembers, setCurrentVideo, setPlayerState, addChatMessage, setPage, setWsError]);

  /** 建立连接 */
  const connect = useCallback(() => {
    // 重置主动关闭标志，允许自动重连
    intentionalCloseRef.current = false;

    // 先清除旧的心跳定时器（避免泄漏）
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    // 清理旧连接
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }

    // 清除重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const url = getWsUrl();
    console.log('[WS] 正在连接:', url);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] 已连接');
        setWsConnected(true);
        setWsError(null);
        reconnectAttemptsRef.current = 0;

        // 启动心跳
        heartbeatTimerRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            sendMessage('ping');
          }
        }, 30000);
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        console.log('[WS] 断开:', event.code, event.reason);
        setWsConnected(false);

        // 清除心跳
        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }

        // 非主动关闭则重连
        if (!intentionalCloseRef.current && event.code !== 1000) {
          scheduleReconnect();
        }
      };

      ws.onerror = (event) => {
        console.error('[WS] 连接错误');
        setWsError('WebSocket 连接失败');
      };
    } catch (e) {
      console.error('[WS] 创建连接失败:', e);
      setWsError('无法创建 WebSocket 连接');
      scheduleReconnect();
    }
  }, [handleMessage, sendMessage, setWsConnected, setWsError]);

  /** 指数退避重连 */
  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptsRef.current;
    // 指数退避: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
    const delay = Math.min(1000 * Math.pow(2, attempt), 60000);
    const jitter = Math.random() * 1000; // 添加随机抖动用避免惊群

    console.log(`[WS] 将在 ${Math.round((delay + jitter) / 1000)}s 后重连 (第 ${attempt + 1} 次)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectAttemptsRef.current++;
      connect();
    }, delay + jitter);
  }, [connect]);

  /** 断开连接（主动） */
  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    setWsConnected(false);
  }, [setWsConnected]);

  // 组件挂载时连接，卸载时断开
  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { sendMessage, disconnect };
}
