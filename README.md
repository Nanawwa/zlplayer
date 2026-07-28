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
| 服务器 | Node.js, ws, HTTP 视频代理 |
| 前端 | React 18, TypeScript, Vite, Tailwind CSS |
| 播放器 | ArtPlayer + HLS.js, `<meta referrer>` 策略 |
| 状态管理 | Zustand |
| 关键方案 | 同域部署绕过 CDN Referer ACL, 页面级 no-referrer |

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

以下为 1Panel（OpenResty）+ Docker 环境两种部署方式。

### 方式一：Alist 同域部署（推荐，夸克等云盘必须用此方案）

将 zlplay-web 部署在 Alist 同域的子路径（如 `https://alist.example.com/zlplay`），利用同域绕过 CDN Referer 校验。

**1. 构建前端**

```bash
cd web && npm run build
```

**2. 放置静态文件**

```bash
mkdir -p /www/sites/alist.example.com/index/zlplay
# 将 web/dist/index.html 放入该目录
```

**3. 启动同步服务**

```bash
cd server && docker-compose up -d
```

**4. 配置 OpenResty**

在 Alist 域名的网站配置中，`include /*.conf` **之前**插入：

```nginx
# zlplay-web 页面（必须放在 Alist 代理前面）
location /zlplay {
    alias /www/sites/alist.example.com/index/zlplay/;
    index index.html;
    try_files $uri /zlplay/index.html;
}

# WebSocket 同步
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

**5. 修改 Alist 反向代理规则**

将原来的 `location ^~ /` 去掉 `^~`，改为 `location /`。否则 nginx 的 `^~` 优先级高于普通前缀匹配，`/zlplay` 和 `/ws` 不会生效。

**6. 重载 OpenResty**

访问 `https://alist.example.com/zlplay` 使用。

### 方式二：独立域名部署（仅限无 Referer ACL 的视频源）

适用于自有存储、本地文件等无 CDN Referer 校验的场景。

| 字段 | 值 |
|---|---|
| 域名 | `play.example.com` |
| 网站类型 | 静态网站 |
| 网站目录 | `/opt/zlplay-web/web/dist` |

添加反向代理 `/ws` → `http://127.0.0.1:8080`（开启 WebSocket）。

### SSL 证书

1Panel → 网站 → 证书 → 申请 Let's Encrypt。

### 更新

```bash
cd /opt/zlplay-web/web && npm run build
# 将 dist/index.html 上传到网站目录覆盖
# 同步服务如有更新：
cd /opt/zlplay-web/server
docker-compose down && docker-compose pull && docker-compose up -d
```

## 云盘视频播放（夸克等）

### 问题背景

夸克等云盘的 CDN 有 Referer ACL 校验（`x-tengine-error: denied by Referer ACL`）。如果 zlplay-web 部署在独立域名（如 `play.example.com`），`<video>` 标签跨域加载 CDN 直链时会带上 `Referer: https://play.example.com/`，被 CDN 拒绝返回 403。

即使使用 `<video referrerpolicy="no-referrer">` 元素属性，Chrome/Edge 对此支持不稳定，请求中仍可能携带 Referer。

### 解决方案

**将 zlplay-web 部署到 Alist 同域的子路径下**（如 `https://alist.example.com/zlplay`），配合页面级 Referer 策略。

```
关键配置：

1. 页面级禁止 Referer（vite.config.ts）:
   <meta name="referrer" content="no-referrer" />

2. 视频直链走 Alist raw_url（/api/fs/get）:
   同域下 Referer 规则一致，CDN 不会拦截

3. OpenResty 配置（location / 前插入）:
   location /zlplay { alias /www/sites/xxx/index/zlplay/; ... }
   location /ws    { proxy_pass http://127.0.0.1:8080; ... }
   location /      { proxy_pass http://127.0.0.1:5244; ... }  # Alist
   
   注意：Alist 反向代理的 location 不能用 ^~ 修饰符，否则 /zlplay 和 /ws 无法匹配。
```

### 为什么不直接用代理

其他方案对比：

| 方案 | 问题 |
|------|------|
| `referrerpolicy` 属性 | Chrome/Edge 不完全支持 |
| 服务端流代理 (pipe) | 视频数据经过服务器，消耗带宽 |
| 302 重定向代理 | 同域无意义，跨域无效 |
| **同域部署 + meta referrer** ✅ | 零带宽、零延迟，CDN 直连 |

### 排查方法

打开 DevTools → Network，找到 `drive.quark.cn` 的请求：

- 请求头有 `referer` → Referer 未屏蔽，检查 `<meta>` 标签是否正确插入
- `sec-fetch-site: cross-site` 且无 `referer` → 正常，CDN 应放行
- 状态码 403 + `denied by Referer ACL` → 仍有 Referer 或部署不在同域

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
