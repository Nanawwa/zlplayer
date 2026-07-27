# ZlPlay

异地同步看视频。基于 WebSocket 的实时房间同步，支持 Alist 视频源，双向播放控制。

## 特性

- 实时房间同步：创建/加入房间（6 位房间码），可选密码
- 双向播放控制：任意成员可播放/暂停/拖动进度条，全房间同步
- 预测-校准同步算法：微调播放速率消除小偏差，大幅偏差自动 seek
- 延迟补偿：基于 RTT 估算网络延迟，自动修正同步位置
- 断线重连：指数退避，恢复后自动请求同步状态
- 聊天：房间内文字消息
- 深色模式：跟随系统 / 手动切换
- 响应式布局：桌面端、平板、手机端自适应
- Docker 一键部署

## 技术栈

| 层 | 技术 |
|---|---|
| 同步服务器 | Node.js, ws |
| Web 前端 | React 18, TypeScript, Vite, Tailwind CSS |
| 播放器 | ArtPlayer + HLS.js |
| 状态管理 | Zustand |
| 部署 | Docker, Nginx, docker-compose |

## 项目结构

```
zlplay-web/
├── server/
│   ├── src/
│   │   ├── index.js          # HTTP + WebSocket 服务入口
│   │   ├── roomManager.js    # 房间生命周期管理
│   │   └── rateLimiter.js    # 连接速率限制
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── .env.example
├── web/
│   ├── src/
│   │   ├── components/       # VideoPlayer, ChatBox, FileBrowser, SyncIndicator, RoomList
│   │   ├── hooks/            # useWebSocket, useSync, useTheme
│   │   ├── pages/            # HomePage, RoomPage
│   │   ├── store/            # roomStore (zustand)
│   │   ├── utils/            # alistApi, syncProtocol
│   │   └── types.ts
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.js
└── README.md
```

## 快速开始

### 安装依赖

```bash
# 服务器
cd server && npm install

# Web 端
cd ../web && npm install
```

### 启动开发环境

```bash
# 终端 1：启动同步服务器
cd server && npm start

# 终端 2：启动 Web 端
cd web && npm run dev
```

浏览器访问 `http://localhost:5173`，输入 Alist 服务器地址即可使用。

### 生产构建

```bash
cd web && npm run build   # 产物输出到 web/dist/
```

## Docker 部署

```bash
cd server

# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f sync-server

# 停止
docker-compose down
```

详细部署指南见 [DEPLOY.md](DEPLOY.md)。

## 环境变量

### 服务器 (`server/.env`)

| 变量 | 默认值 | 说明 |
|---|---|---|
| WS_PORT | 8080 | 服务端口 |
| MAX_ROOMS | 200 | 最大房间数 |
| ROOM_TIMEOUT | 300 | 空闲房间自动清理（秒） |
| HEARTBEAT_INTERVAL | 30000 | 心跳间隔（毫秒） |
| HEARTBEAT_TIMEOUT | 60000 | 心跳超时断线（毫秒） |
| RATE_LIMIT | 10 | 单连接每秒最大消息数 |

### Web 端 (`web/.env`)

| 变量 | 默认值 | 说明 |
|---|---|---|
| VITE_WS_URL | (自动检测) | WebSocket 地址，见下方说明 |
| VITE_DEFAULT_ALIST_URL | (空) | 预填的 Alist 地址 |

**WebSocket 地址自动检测逻辑：**

```
优先级从高到低：
1. 浏览器中手动设置（localStorage）
2. 生产环境自动推断（当前页面 https→wss, http→ws）
3. .env 中的 VITE_WS_URL
4. ws://localhost:8080（开发默认值）
```

生产环境部署后不需要任何配置，浏览器会自动用当前域名连接 WebSocket。例如：
- 访问 `https://video.example.com` → 自动连接 `wss://video.example.com`
- Nginx 需要同时代理 HTTP 和 WebSocket（参考 `server/nginx/conf.d/default.conf`）

如果 WebSocket 和网页不在同一域名，可以在浏览器控制台手动指定：
```js
localStorage.setItem('zlplay_ws_url', 'wss://ws.example.com')
```

## WebSocket 协议

### 客户端 → 服务器

| 消息类型 | 说明 | 载荷 |
|---|---|---|
| `create_room` | 创建房间 | `{ password?, name? }` |
| `join_room` | 加入房间 | `{ code, password?, name? }` |
| `leave_room` | 离开房间 | — |
| `destroy_room` | 解散房间 | — |
| `play` | 播放 | `{ position, clientTimestamp }` |
| `pause` | 暂停 | `{ position, clientTimestamp }` |
| `seek` | 拖动进度 | `{ position, clientTimestamp }` |
| `change_video` | 切换视频 | `{ url, title }` |
| `chat` | 聊天 | `{ message }` |
| `ping` | 心跳 | — |

### 服务器 → 客户端

| 消息类型 | 说明 |
|---|---|
| `connected` | 连接建立，下发 clientId |
| `room_created` | 房间创建成功 |
| `sync_response` | 房间完整状态（含视频信息、播放位置、成员列表） |
| `member_joined` / `member_left` | 成员变动 |
| `owner_changed` | 房主转移 |
| `play` / `pause` / `seek` | 同步指令 |
| `change_video` | 视频切换 |
| `chat` | 聊天消息 |
| `room_destroyed` | 房间已解散 |
| `error` | 错误信息 |
| `pong` | 心跳响应 |

## 同步算法

采用"预测-校准"双机制：

- **小偏差 (< 500ms)**：通过调整 `playbackRate`（0.5~2.0）逐渐追赶，避免频繁 seek 导致卡顿
- **大偏差 (≥ 500ms)**：直接 seek 到目标位置，重置速率
- **延迟补偿**：基于 RTT/2 估算网络延迟，修正远端位置
- **防回环**：`senderId` + `syncingRef` 双重保护
- **容错**：缓冲中暂停校准、页面隐藏暂停校准、连续心跳失败标记 DESYNCED

## License

MIT
