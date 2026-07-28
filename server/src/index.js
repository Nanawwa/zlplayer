'use strict';

// 加载环境变量（优先加载 .env，不存在则用默认值）
try {
  require('dotenv').config();
} catch (e) {
  // dotenv 可能未安装，忽略
}

const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./roomManager');
const { RateLimiter } = require('./rateLimiter');

// ── 配置 ──────────────────────────────────────────────
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '200', 10);
const ROOM_TIMEOUT = parseInt(process.env.ROOM_TIMEOUT || '300', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
const HEARTBEAT_TIMEOUT = parseInt(process.env.HEARTBEAT_TIMEOUT || '60000', 10);
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '10', 10);

// ── 工具函数 ──────────────────────────────────────────
const log = (message, level = 'info') => {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[level] < levels[LOG_LEVEL]) return;
  const timestamp = new Date().toISOString();
  const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📌';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] ${emoji} ${message}`);
};

/**
 * 发送 JSON 消息给 WebSocket 客户端
 * @param {import('ws').WebSocket} ws
 * @param {string} type
 * @param {object} payload
 */
const send = (ws, type, payload = {}) => {
  if (ws.readyState !== 1) return; // 1 = OPEN
  try {
    ws.send(JSON.stringify({ type, ...payload }));
  } catch (e) {
    log(`发送消息失败: ${e.message}`, 'error');
  }
};

/**
 * 广播消息给房间内除发送者外的所有成员
 * @param {object} room
 * @param {string} senderId
 * @param {string} type
 * @param {object} payload
 */
const broadcast = (room, senderId, type, payload = {}) => {
  let count = 0;
  for (const [memberId, member] of room.members) {
    if (memberId !== senderId && member.ws.readyState === 1) {
      try {
        member.ws.send(JSON.stringify({ type, ...payload }));
        count++;
      } catch (e) {
        log(`广播到 ${memberId} 失败: ${e.message}`, 'error');
      }
    }
  }
  return count;
};

// ── 初始化 ────────────────────────────────────────────
const roomManager = new RoomManager({
  maxRooms: MAX_ROOMS,
  roomTimeout: ROOM_TIMEOUT,
  heartbeatTimeout: HEARTBEAT_TIMEOUT,
});

const rateLimiter = new RateLimiter(RATE_LIMIT);

let connectionCounter = 0;

// ── HTTP 服务 ──────────────────────────────────────────
const httpServer = createServer((req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // ── 视频代理：解决云盘 CDN 跨域 / Referer 校验问题 ──
  if (parsedUrl.pathname === '/proxy-video') {
    const targetUrl = parsedUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '缺少 url 参数' }));
    }
    return proxyVideo(req, res, targetUrl);
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(roomManager.getStats()));
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ZlPlay Sync Server');
});

// ── WebSocket 服务 ─────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

// 设置连接心跳（定期清理僵尸连接）
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      log(`心跳超时，断开连接 ${ws.clientId}`, 'warn');
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping(); // ws 库内置 ping/pong
  }
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws) => {
  const clientId = `c_${++connectionCounter}_${Date.now().toString(36)}`;
  ws.id = clientId;       // roomManager.joinRoom 使用 member.id
  ws.clientId = clientId; // 其他地方使用 clientId（兼容）
  ws.isAlive = true;
  ws.currentRoom = null;
  ws.joinTime = Date.now();

  log(`新连接: ${clientId}`);

  // 连接建立后立即下发 clientId，让客户端统一使用服务端分配的 ID
  send(ws, 'connected', { clientId });

  // 心跳响应
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 消息处理
  ws.on('message', (data) => {
    // 速率限制检查
    if (!rateLimiter.check(clientId)) {
      log(`客户端 ${clientId} 超出速率限制，断开`, 'warn');
      send(ws, 'error', { message: '消息过于频繁，已断开连接' });
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      log(`客户端 ${clientId} 发送无效 JSON`, 'warn');
      send(ws, 'error', { message: '无效的消息格式' });
      return;
    }

    roomManager.incrementMessageCount();
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    log(`连接断开: ${clientId}`);
    rateLimiter.remove(clientId);

    // 清理所在房间
    if (ws.currentRoom) {
      try {
        roomManager.leaveRoom(ws.currentRoom, clientId);
      } catch (e) {
        log(`清理房间失败: ${e.message}`, 'error');
      }
    }
  });

  ws.on('error', (err) => {
    log(`WebSocket 错误 (${clientId}): ${err.message}`, 'error');
  });
});

// ── 视频代理 ───────────────────────────────────────────
/**
 * 代理视频流，绕过云盘 CDN 的 Referer / Sec-Fetch 跨域校验
 * 浏览器 → 本服务(同源) → CDN → 流式返回
 * 支持 Range 请求（拖动进度条）
 */
function proxyVideo(req, res, targetUrl) {
  const protocol = targetUrl.startsWith('https') ? require('https') : require('http');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity', // 不要压缩，直接流式传递
    'Connection': 'keep-alive',
  };

  // 转发 Range 请求（支持拖动进度条）
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  log(`代理视频: ${targetUrl.slice(0, 80)}...`, 'debug');

  const proxyReq = protocol.get(targetUrl, { headers, timeout: 30000 }, (proxyRes) => {
    const { statusCode, headers: resHeaders } = proxyRes;

    // 处理重定向（CDN 可能有多次跳转）
    if (statusCode >= 300 && statusCode < 400 && resHeaders.location) {
      const redirectUrl = new URL(resHeaders.location, targetUrl).href;
      proxyRes.destroy();
      return proxyVideo(req, res, redirectUrl);
    }

    if (!statusCode || statusCode >= 400) {
      res.writeHead(statusCode || 502, { 'Content-Type': 'text/plain' });
      res.end(`Proxy error: upstream returned ${statusCode}`);
      log(`代理失败: ${targetUrl.slice(0, 60)}... → ${statusCode}`, 'error');
      return;
    }

    // 设置响应头
    const outHeaders = {
      'Content-Type': resHeaders['content-type'] || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };

    if (resHeaders['content-length']) {
      outHeaders['Content-Length'] = resHeaders['content-length'];
    }
    if (resHeaders['content-range']) {
      outHeaders['Content-Range'] = resHeaders['content-range'];
      res.writeHead(206, outHeaders);
    } else if (req.headers.range) {
      // 上游不支持 Range，但我们请求了 Range，返回全部内容
      res.writeHead(200, outHeaders);
    } else {
      res.writeHead(200, outHeaders);
    }

    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      log(`代理流错误: ${err.message}`, 'error');
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    log(`代理请求失败: ${err.message}`, 'error');
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Proxy error: ${err.message}`);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Proxy timeout');
    }
  });

  // 客户端断开时取消代理请求
  req.on('close', () => {
    proxyReq.destroy();
  });
}

// ── 消息路由 ───────────────────────────────────────────
/**
 * @param {import('ws').WebSocket} ws
 * @param {object} msg
 */
function handleMessage(ws, msg) {
  const { type, ...payload } = msg;

  try {
    switch (type) {
      // ── 房间操作 ──
      case 'create_room': {
        if (ws.currentRoom) {
          return send(ws, 'error', { message: '你已在房间中，请先离开' });
        }

        const result = roomManager.createRoom({
          password: payload.password || '',
          owner: { id: ws.clientId, name: payload.name || '' },
        });

        // 将自己加入房间
        const room = roomManager.joinRoom(
          result.code,
          payload.password || '',
          ws,
          payload.name || ''
        );

        ws.currentRoom = result.code;

        send(ws, 'room_created', {
          code: result.code,
          members: getMemberList(room),
          ownerId: room.ownerId,
        });
        break;
      }

      case 'join_room': {
        if (ws.currentRoom) {
          return send(ws, 'error', { message: '你已在房间中，请先离开' });
        }

        if (!payload.code) {
          return send(ws, 'error', { message: '请提供房间码' });
        }

        const room = roomManager.joinRoom(
          payload.code.toUpperCase(),
          payload.password || '',
          ws,
          payload.name || ''
        );

        ws.currentRoom = payload.code.toUpperCase();

        // 调试：打印当前房间成员
        log(`房间 ${room.code} 当前成员: ${JSON.stringify(getMemberList(room))}`);

        // 通知已有成员
        const bcCount = broadcast(room, ws.clientId, 'member_joined', {
          memberId: ws.clientId,
          memberName: room.members.get(ws.clientId)?.name || '',
          members: getMemberList(room),
        });
        log(`member_joined 广播到 ${bcCount} 个已有成员`);

        // 发送当前房间状态给新成员
        send(ws, 'sync_response', {
          code: room.code,
          ownerId: room.ownerId,
          members: getMemberList(room),
          currentVideo: room.currentVideo,
          playerState: room.playerState,
        });
        break;
      }

      case 'leave_room': {
        if (!ws.currentRoom) break;

        const room = roomManager.getRoom(ws.currentRoom);
        if (room) {
          broadcast(room, ws.clientId, 'member_left', {
            memberId: ws.clientId,
            members: getMemberListAfterRemove(room, ws.clientId),
          });

          // 如果房主离开，通知新房主
          if (room.ownerId === ws.clientId && room.members.size > 1) {
            const newOwner = [...room.members.values()]
              .filter(m => m.id !== ws.clientId)
              .sort((a, b) => a.joinedAt - b.joinedAt)[0];

            if (newOwner) {
              send(newOwner.ws, 'owner_changed', {
                ownerId: newOwner.id,
                message: '房主已离开，你已成为新房主',
              });
            }
          }
        }

        roomManager.leaveRoom(ws.currentRoom, ws.clientId);
        ws.currentRoom = null;

        send(ws, 'left_room', {});
        break;
      }

      case 'destroy_room': {
        if (!ws.currentRoom) break;

        const room = roomManager.getRoom(ws.currentRoom);
        if (!room) break;

        // 先验证房主权限
        if (room.ownerId !== ws.clientId) {
          send(ws, 'error', { message: '仅房主可以解散房间' });
          break;
        }

        // 通知所有成员
        broadcast(room, ws.clientId, 'room_destroyed', {
          message: '房主已解散房间',
        });

        // 清理所有成员的 currentRoom
        for (const [, member] of room.members) {
          member.ws.currentRoom = null;
        }

        roomManager.destroyRoom(ws.currentRoom, ws.clientId);

        send(ws, 'room_destroyed', {});
        break;
      }

      // ── 同步操作 ──
      case 'play':
      case 'pause':
      case 'seek': {
        if (!ws.currentRoom) break;

        const room = roomManager.getRoom(ws.currentRoom);
        if (!room) break;

        // 更新房间状态
        roomManager.updatePlayerState(ws.currentRoom, {
          playing: type === 'play' ? true : type === 'pause' ? false : room.playerState.playing,
          position: payload.position ?? room.playerState.position,
          timestamp: payload.clientTimestamp || payload.timestamp || Date.now(),
        });

        roomManager.touchRoom(ws.currentRoom);

        // 广播给其他人
        broadcast(room, ws.clientId, type, {
          position: payload.position,
          timestamp: payload.clientTimestamp || payload.timestamp || Date.now(),
          senderId: ws.clientId,
        });
        break;
      }

      case 'change_video': {
        if (!ws.currentRoom) break;

        const room = roomManager.getRoom(ws.currentRoom);
        if (!room) break;

        roomManager.setCurrentVideo(ws.currentRoom, {
          url: payload.url,
          title: payload.title || '',
        });

        roomManager.updatePlayerState(ws.currentRoom, {
          playing: false,
          position: 0,
          timestamp: Date.now(),
        });

        roomManager.touchRoom(ws.currentRoom);

        broadcast(room, ws.clientId, 'change_video', {
          url: payload.url,
          title: payload.title || '',
          senderId: ws.clientId,
        });
        break;
      }

      case 'request_sync': {
        if (!ws.currentRoom) break;

        const room = roomManager.getRoom(ws.currentRoom);
        if (!room) break;

        send(ws, 'sync_response', {
          code: room.code,
          ownerId: room.ownerId,
          members: getMemberList(room),
          currentVideo: room.currentVideo,
          playerState: room.playerState,
        });
        break;
      }

      // ── 房间发现 ──
      case 'list_rooms': {
        const rooms = roomManager.getDiscoverableRooms();
        send(ws, 'room_list', { rooms });
        break;
      }

      // ── 聊天 ──
      case 'chat': {
        if (!ws.currentRoom || !payload.message) break;

        const room = roomManager.getRoom(ws.currentRoom);
        if (!room) break;

        const member = room.members.get(ws.clientId);

        // 广播聊天消息给房间所有人（包括自己，方便 UI 刷新）
        for (const [, m] of room.members) {
          send(m.ws, 'chat', {
            senderId: ws.clientId,
            senderName: member?.name || '未知用户',
            message: String(payload.message).slice(0, 500), // 限制长度
            timestamp: Date.now(),
          });
        }

        roomManager.touchRoom(ws.currentRoom);
        break;
      }

      // ── 心跳 ──
      case 'ping': {
        send(ws, 'pong', { timestamp: Date.now() });
        break;
      }

      default:
        log(`未知消息类型: ${type}`, 'warn');
        send(ws, 'error', { message: `未知消息类型: ${type}` });
    }
  } catch (e) {
    log(`处理消息失败 (${type}): ${e.message}`, 'error');
    send(ws, 'error', { message: `操作失败: ${e.message}` });
  }
}

// ── 辅助函数 ──────────────────────────────────────────
function getMemberList(room) {
  return [...room.members.values()].map(m => ({
    id: m.id,
    name: m.name,
    joinedAt: m.joinedAt,
  }));
}

function getMemberListAfterRemove(room, removedId) {
  return [...room.members.values()]
    .filter(m => m.id !== removedId)
    .map(m => ({
      id: m.id,
      name: m.name,
      joinedAt: m.joinedAt,
    }));
}

// ── 优雅关闭 ──────────────────────────────────────────
function shutdown() {
  log('正在关闭服务器...', 'warn');

  clearInterval(heartbeatInterval);
  roomManager.shutdown();

  // 通知所有客户端
  for (const ws of wss.clients) {
    send(ws, 'server_shutdown', { message: '服务器正在关闭' });
    ws.close(1001, 'Server shutting down');
  }

  httpServer.close(() => {
    log('服务器已关闭');
    process.exit(0);
  });

  // 5 秒后强制退出
  setTimeout(() => {
    log('强制退出', 'error');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── 启动 ───────────────────────────────────────────────
httpServer.on('error', (err) => {
  log(`HTTP 服务器错误: ${err.message}`, 'error');
  if (err.code === 'EADDRINUSE') {
    log(`端口 ${WS_PORT} 已被占用，请检查是否已有实例在运行`, 'error');
  }
  process.exit(1);
});

httpServer.listen(WS_PORT, () => {
  log(`ZlPlay 同步服务器已启动，端口: ${WS_PORT}`);
  log(`配置: maxRooms=${MAX_ROOMS}, roomTimeout=${ROOM_TIMEOUT}s, rateLimit=${RATE_LIMIT}/s`);
});
