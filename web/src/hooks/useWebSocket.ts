import { useEffect, useRef, useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';
import type { WSMessage, ChatMessage } from '../types';

/**
 * WebSocket 连接管理 Hook
 *
 * 职责（重构后）：
 * - 连接生命周期 + 指数退避重连
 * - 唯一应用层心跳 + RTT 测量（pong 路由到 RTT 并暴露给 store）
 * - sendMessage 离线队列（可靠命令入队，onopen flush）
 * - 消息路由：sync 类消息统一 forward 给 useSync；chat/room 元数据直写 store
 *   不再自行 setPlayerState / senderId 过滤（由 useSync 唯一处理）
 * - 重连后用持久化的 roomPassword 重新加入房间
 */

/** 获取 WebSocket 连接地址 */
function getWsUrl(): string {
  try {
    const manual = localStorage.getItem('zlplay_ws_url');
    if (manual) return manual;
  } catch { /* ignore */ }

  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  const envUrl = (import.meta as any).env?.VITE_WS_URL;
  if (envUrl) return envUrl;

  return 'ws://localhost:8080';
}

export function setWsUrl(url: string): void {
  localStorage.setItem('zlplay_ws_url', url);
}

/** 需要离线排队的可靠命令 */
const QUEUED_TYPES = new Set([
  'play', 'pause', 'seek', 'chat', 'change_video', 'create_room', 'join_room',
]);
const MAX_QUEUE = 50;

export function useWebSocket(onRemoteMsg?: (msg: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const pingTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const myIdRef = useRef('');
  const onRemoteRef = useRef(onRemoteMsg);
  onRemoteRef.current = onRemoteMsg;

  // RTT 测量
  const pingStartRef = useRef(0);
  const rttEwmaRef = useRef(0.1);
  const missedPongsRef = useRef(0);
  const mountedRef = useRef(true);

  // 离线消息队列
  const messageQueueRef = useRef<{ type: string; payload: Record<string, unknown> }[]>([]);

  const {
    setMyId,
    setWsConnected,
    setWsError,
    setWsRtt,
    setRoomCode,
    setIsOwner,
    setOwnerId,
    setMembers,
    setCurrentVideo,
    addChatMessage,
    setPage,
  } = useRoomStore();

  /** 发送消息（离线时可靠命令入队） */
  const sendMessage = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    } else if (QUEUED_TYPES.has(type)) {
      if (messageQueueRef.current.length < MAX_QUEUE) {
        messageQueueRef.current.push({ type, payload });
        console.log('[WS] 离线，消息已排队:', type);
      } else {
        console.warn('[WS] 队列已满，丢弃消息:', type);
      }
    } else {
      console.warn('[WS] 未连接，丢弃一次性消息:', type);
    }
  }, []);

  /** flush 离线队列 */
  const flushQueue = useCallback(() => {
    const queue = messageQueueRef.current;
    if (queue.length === 0) return;
    messageQueueRef.current = [];
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const msg of queue) {
      ws.send(JSON.stringify({ type: msg.type, ...msg.payload }));
    }
    console.log(`[WS] 已重放 ${queue.length} 条排队消息`);
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
        // 房间元数据写 store（播放器状态归 sync 引擎，不在此 setPlayerState）
        setRoomCode(payload.code as string);
        setOwnerId(payload.ownerId as string);
        setIsOwner((payload.ownerId as string) === myIdRef.current);
        setMembers((payload.members as any[]) || []);
        if (payload.currentVideo) {
          setCurrentVideo(payload.currentVideo as any);
        }

        // forward 给 useSync 处理播放同步
        onRemoteRef.current?.({
          type: 'sync_response',
          position: (payload.playerState as any)?.position,
          status: (payload.playerState as any)?.playing ? 'playing' : 'paused',
          serverTimestamp: (payload.playerState as any)?.timestamp,
        });

        setPage('room');
        break;
      }

      case 'member_joined':
      case 'member_left': {
        setMembers((payload.members as any[]) || []);
        break;
      }

      case 'owner_changed': {
        setOwnerId(payload.ownerId as string);
        setIsOwner((payload.ownerId as string) === myIdRef.current);
        break;
      }

      // ── 同步指令：统一 forward 给 useSync，不在 WS 层做补偿/过滤 ──
      case 'play':
      case 'pause':
      case 'seek': {
        onRemoteRef.current?.({
          type,
          position: payload.position,
          clientTimestamp: payload.clientTimestamp || payload.timestamp,
          senderId: payload.senderId,
        });
        break;
      }

      case 'change_video': {
        // store 更新 currentVideo
        setCurrentVideo({
          url: payload.url as string,
          title: (payload.title as string) || '',
        });
        // forward 给 useSync 重置同步状态
        onRemoteRef.current?.({
          type: 'change_video',
          url: payload.url,
          title: payload.title,
          senderId: payload.senderId,
        });
        break;
      }

      case 'chat': {
        // 服务端广播给所有人（含发送者）；前端统一在此入列，ChatBox 不再本地乐观添加
        addChatMessage({
          senderId: payload.senderId as string,
          senderName: payload.senderName as string,
          message: payload.message as string,
          timestamp: payload.timestamp as number,
        });
        break;
      }

      case 'pong': {
        // RTT 测量：EWMA 更新并写 store
        if (pingStartRef.current > 0) {
          const rtt = (performance.now() - pingStartRef.current) / 1000;
          if (rtt > 0 && rtt < 10) {
            rttEwmaRef.current = rttEwmaRef.current * 0.7 + rtt * 0.3;
            setWsRtt(rttEwmaRef.current);
          }
          pingStartRef.current = 0;
          missedPongsRef.current = 0;
        }
        if (pingTimeoutRef.current) {
          clearTimeout(pingTimeoutRef.current);
          pingTimeoutRef.current = null;
        }
        // forward 让 useSync 重置 missedBeats
        onRemoteRef.current?.({ type: 'pong' });
        break;
      }

      case 'kicked': {
        // 被房主踢出
        useRoomStore.getState().setWsError('你已被房主移出房间');
        useRoomStore.getState().resetRoom();
        break;
      }

      case 'room_destroyed':
      case 'left_room': {
        useRoomStore.getState().resetRoom();
        break;
      }

      case 'room_list': {
        useRoomStore.getState().setAvailableRooms((payload.rooms as any[]) || []);
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
  }, [setRoomCode, setOwnerId, setIsOwner, setMembers, setCurrentVideo, addChatMessage, setPage, setWsError, setWsRtt]);

  /** 建立连接 */
  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    intentionalCloseRef.current = false;

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }

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
        if (!mountedRef.current) return;
        console.log('[WS] 已连接');
        setWsConnected(true);
        setWsError(null);
        reconnectAttemptsRef.current = 0;
        missedPongsRef.current = 0;

        // 重连后重新加入房间（用持久化密码）
        const st = useRoomStore.getState();
        if (st.roomCode && st.currentPage === 'room') {
          console.log('[WS] 重连后重新加入房间:', st.roomCode);
          ws.send(JSON.stringify({
            type: 'join_room',
            code: st.roomCode,
            password: st.roomPassword || '',
          }));
        }

        // flush 离线队列
        flushQueue();

        // 启动唯一应用层心跳（带 RTT 测量）
        const beat = () => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          pingStartRef.current = performance.now();
          sendMessage('ping', {});
          // 10s 无 pong 则 RTT 异常
          if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
          pingTimeoutRef.current = window.setTimeout(() => {
            missedPongsRef.current++;
            pingStartRef.current = 0;
            if (missedPongsRef.current >= 3) {
              console.warn('[WS] 连续 3 次心跳无响应');
              setWsRtt(2.0);
            }
          }, 10000);
        };
        beat();
        heartbeatTimerRef.current = window.setInterval(beat, 30000);
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        console.log('[WS] 断开:', event.code, event.reason);
        setWsConnected(false);

        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (pingTimeoutRef.current) {
          clearTimeout(pingTimeoutRef.current);
          pingTimeoutRef.current = null;
        }

        if (!intentionalCloseRef.current && event.code !== 1000) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        console.error('[WS] 连接错误');
        setWsError('WebSocket 连接失败');
      };
    } catch (e) {
      console.error('[WS] 创建连接失败:', e);
      setWsError('无法创建 WebSocket 连接');
      scheduleReconnect();
    }
  }, [handleMessage, sendMessage, flushQueue, setWsConnected, setWsError, setWsRtt]);

  /** 指数退避重连 */
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    const attempt = reconnectAttemptsRef.current;
    const delay = Math.min(1000 * Math.pow(2, attempt), 60000);
    const jitter = Math.random() * 1000;

    console.log(`[WS] 将在 ${Math.round((delay + jitter) / 1000)}s 后重连 (第 ${attempt + 1} 次)`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectAttemptsRef.current++;
      connect();
    }, delay + jitter);
  }, [connect]);

  /** 主动断开 */
  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
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

  // 挂载时连接，卸载时断开
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { sendMessage, disconnect };
}
