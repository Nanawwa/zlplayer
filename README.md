# 🎬 ZlPlay — 异地同步看视频

两个人通过 Web 浏览器同步观看来自 Alist 的视频。房主控制播放/暂停/拖动，另一端自动同步。

## 项目结构

```
zlplay-web/
├── server/                  # 同步服务器 (Node.js + WebSocket)
│   ├── src/
│   │   ├── index.js         # 入口：HTTP + WebSocket 服务
│   │   ├── roomManager.js   # 房间管理
│   │   └── rateLimiter.js   # 速率限制
│   ├── package.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── .env.example
├── web/                     # Web 端 (React + TypeScript + Tailwind)
│   ├── src/
│   │   ├── pages/           # HomePage, RoomPage
│   │   ├── components/      # VideoPlayer, ChatBox, RoomList
│   │   ├── hooks/           # useWebSocket, useSync
│   │   ├── store/           # zustand store
│   │   ├── utils/           # alistApi
│   │   ├── types.ts         # TypeScript 类型
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
└── README.md
```

## 快速开始

### 1. 启动同步服务器

```bash
cd server
npm install
npm start
```

服务器将在 `http://localhost:8080` 启动。
- 健康检查: `http://localhost:8080/health`
- 统计信息: `http://localhost:8080/stats`

### 2. 启动 Web 端

```bash
cd web
npm install
npm run dev
```

Web 端将在 `http://localhost:5173` 启动。

### 3. 使用

1. 打开浏览器访问 `http://localhost:5173`
2. 输入 Alist 服务器地址和 Token（可选）
3. 浏览文件夹，点击视频播放
4. 点击「创建房间」创建同步房间（获得 6 位房间码）
5. 另一个浏览器窗口点击「加入房间」，输入房间码
6. 房主播放/暂停/拖动时，另一端自动同步

## Docker 部署

```bash
cd server

# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

注意：Docker 部署前需将 Web 端构建产物放到 nginx 能访问的路径。

```bash
cd web
npm run build
# 产物在 web/dist/ 目录
```

然后取消 `docker-compose.yml` 中 nginx 的静态文件挂载注释：
```yaml
volumes:
  - ../web/dist:/usr/share/nginx/html:ro
```

## 配置

### 服务器环境变量

见 `server/.env.example`：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| WS_PORT | 8080 | WebSocket 端口 |
| MAX_ROOMS | 200 | 最大房间数 |
| ROOM_TIMEOUT | 300 | 空闲房间清理（秒） |
| HEARTBEAT_INTERVAL | 30000 | 心跳间隔（毫秒） |
| HEARTBEAT_TIMEOUT | 60000 | 心跳超时（毫秒） |
| RATE_LIMIT | 10 | 每秒最大消息数 |

### Web 端环境变量

见 `web/.env.example`：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| VITE_WS_URL | ws://localhost:8080 | WebSocket 地址 |

WebSocket 地址也可在浏览器中通过 localStorage 修改：
```js
localStorage.setItem('zlplay_ws_url', 'ws://your-server.com:8080')
```

## 协议说明

### WebSocket 消息类型

**客户端 → 服务器：**
| 类型 | 说明 |
|------|------|
| create_room | 创建房间 |
| join_room | 加入房间 |
| leave_room | 离开房间 |
| destroy_room | 解散房间（房主） |
| play / pause / seek | 播放控制 |
| change_video | 切换视频 |
| request_sync | 请求同步状态 |
| chat | 发送聊天消息 |
| ping | 心跳 |

**服务器 → 客户端：**
| 类型 | 说明 |
|------|------|
| room_created | 房间已创建 |
| sync_response | 房间完整状态 |
| member_joined / member_left | 成员变动 |
| owner_changed | 房主变更 |
| play / pause / seek | 同步指令 |
| change_video | 视频切换 |
| chat | 聊天消息 |
| error | 错误信息 |
| pong | 心跳响应 |
| room_destroyed | 房间已解散 |

## 测试同步

1. 打开浏览器窗口 A，创建房间，记录房间码
2. 打开浏览器窗口 B（或隐身模式），加入同一房间
3. 在窗口 A 点击播放视频 → 窗口 B 自动同步播放
4. 在窗口 A 拖动进度条 → 窗口 B 跟随跳转
5. 在窗口 A 暂停 → 窗口 B 同步暂停

## 最可能出错的 3 个地方

### 1. WebSocket 重连逻辑
**问题**：断线后重连可能丢失房间状态，或重连后消息重复。
**验证**：
- 刷新服务端（kill 后重启），观察客户端是否重连。
- 断网后恢复网络，观察房间状态是否恢复。
- 使用 `wscat -c ws://localhost:8080` 测试服务器消息。

### 2. HLS.js 初始化时机
**问题**：HLS 流可能因为 CORS、跨域、Alist 认证等问题无法加载。
**验证**：
- 打开浏览器控制台查看 HLS.js 的错误日志。
- 确认 Alist 返回的 m3u8 链接可以直接在浏览器中打开。
- 检查 Alist 是否需要 sign 参数（部分版本对直链需要签名）。
- 如果遇到 CORS 错误，可能需要在 Alist 侧配置允许跨域。

### 3. Alist API 路径
**问题**：不同 Alist 版本的 API 路径和响应格式可能不同。
**验证**：
- 直接调用 `https://your-alist/api/fs/list` 查看返回的 JSON 结构。
- 检查 `code` 字段是否为 200（部分版本用 `code: 0` 表示成功）。
- 确认 `raw_url` 字段是否存在，以及获取直链的方式（/d/ vs /p/）。
- 文件搜索的 API 路径可能为 `/api/fs/search` 或 `/api/public/search`。

## 技术栈

- **服务器**: Node.js, ws, dotenv
- **Web 端**: React 18, TypeScript, Vite, Tailwind CSS, HLS.js, zustand
- **部署**: Docker, Nginx, docker-compose
