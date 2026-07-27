# ZlPlay

异地同步看视频。基于 WebSocket 的实时房间同步，支持 Alist 视频源，双向播放控制。

## 功能

- 创建 / 加入房间（6 位房间码），可选密码
- 双向播放同步：任意成员可控制播放、暂停、拖动进度
- 速率校准：小偏差微调播放速率，大偏差自动 seek
- 延迟补偿：基于 RTT 自动修正同步位置
- 房间内文字聊天、成员列表
- 断线自动重连，恢复后请求状态同步
- 深色模式、响应式布局（桌面 / 平板 / 手机）
- Docker 部署，单文件构建产物

## 技术栈

| 层 | 技术 |
|---|---|
| 服务器 | Node.js, ws |
| 前端 | React 18, TypeScript, Vite, Tailwind CSS |
| 播放器 | ArtPlayer + HLS.js |
| 状态管理 | Zustand |

## 项目结构

```
zlplay-web/
├── server/
│   ├── src/
│   │   ├── index.js          # HTTP + WebSocket 服务
│   │   ├── roomManager.js    # 房间管理
│   │   └── rateLimiter.js    # 速率限制
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx/conf.d/default.conf
├── web/
│   ├── src/
│   │   ├── components/       # VideoPlayer, ChatBox, FileBrowser, SyncIndicator, RoomList
│   │   ├── hooks/            # useWebSocket, useSync, useTheme
│   │   ├── pages/            # HomePage, RoomPage
│   │   ├── store/            # roomStore
│   │   └── utils/            # alistApi, syncProtocol
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.js
└── README.md
```

## 开发环境

```bash
# 服务器
cd server && npm install && npm start          # 启动在 :8080

# 前端
cd web && npm install && npm run dev            # 启动在 :5173
```

浏览器打开 `http://localhost:5173`，输入 Alist 地址即可使用。

## 构建

```bash
cd web && npm run build
```

产物为单个 `dist/index.html`，JS 与 CSS 全部内联，可直接双击打开，也可部署到任意 HTTP 服务器。

## 环境变量

### `web/.env`

| 变量 | 说明 | 默认值 |
|---|---|---|
| `VITE_DEFAULT_ALIST_URL` | 页面预填的 Alist 地址 | 空 |
| `VITE_WS_URL` | WebSocket 地址 | 生产环境自动检测，开发环境 `ws://localhost:8080` |

WebSocket 地址优先级：localStorage 手动指定 > 生产环境自动推断（当前页面 https→wss / http→ws，路径 `/ws`）> 环境变量 > 默认值。

### `server/.env`

| 变量 | 说明 | 默认值 |
|---|---|---|
| `WS_PORT` | 服务端口 | 8080 |
| `MAX_ROOMS` | 最大房间数 | 200 |
| `ROOM_TIMEOUT` | 空闲房间自动清理（秒） | 300 |
| `HEARTBEAT_INTERVAL` | 心跳间隔（毫秒） | 30000 |
| `HEARTBEAT_TIMEOUT` | 心跳超时断线（毫秒） | 60000 |
| `RATE_LIMIT` | 单连接每秒最大消息 | 10 |

## 生产部署

以下为 1Panel（OpenResty）+ Docker + Debian 环境，域名 `play.example.com` 为例。

### 1. 构建前端

```bash
cd web && npm run build
```

将 `web/dist/index.html` 放到服务器 `/opt/zlplay-web/web/dist/`。

### 2. 启动同步服务

```bash
cd /opt/zlplay-web/server

# 确保 docker-compose.yml 中 sync-server 的端口映射为：
#   ports:
#     - "8080:8080"

docker-compose up -d
curl localhost:8080/health    # 应返回 {"status":"ok"}
```

### 3. 配置 1Panel 网站

3.1 在 1Panel 中创建静态网站：

| 字段 | 值 |
|---|---|
| 域名 | `play.example.com` |
| 网站目录 | `/opt/zlplay-web/web/dist` |

3.2 在同一个网站中添加反向代理：

| 字段 | 值 |
|---|---|
| 代理路径 | `/ws` |
| 目标地址 | `http://127.0.0.1:8080` |
| WebSocket | 开启 |

或者手动编辑网站配置，在 `server` 块中添加：

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

### 4. SSL 证书

1Panel → 网站 → `play.example.com` → 证书 → 申请 Let's Encrypt。

### 5. 更新

```bash
cd /opt/zlplay-web/server
docker-compose down
docker-compose pull        # 如果使用镜像
docker-compose up -d --build
```

## Docker 镜像

推送到 GitHub Container Registry（`.github/workflows/docker-publish.yml`）：

```bash
docker pull ghcr.io/nanawwa/zlplayer:master
```

镜像在 GitHub Packages 设置中需设为 Public 才能被拉取。

## WebSocket 协议

### 客户端 → 服务器

| 类型 | 说明 | 载荷 |
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

| 类型 | 说明 |
|---|---|
| `connected` | 连接建立，下发 clientId |
| `room_created` | 房间创建成功 |
| `sync_response` | 房间完整状态（视频、位置、成员） |
| `member_joined` / `member_left` | 成员变动 |
| `owner_changed` | 房主转移 |
| `play` / `pause` / `seek` | 同步指令 |
| `change_video` | 视频切换 |
| `chat` | 聊天消息 |
| `room_destroyed` | 房间已解散 |
| `error` | 错误信息 |
| `pong` | 心跳响应 |

## License

MIT
