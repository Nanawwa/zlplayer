# ZlPlay 生产环境部署指南

适用于 **1Panel + Debian + Docker** 环境。

## 目录结构

```
zlplay-web/
├── server/                  # 同步服务器
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx.conf
├── web/                     # Web 前端（构建后放入 nginx）
│   ├── dist/                # npm run build 产物
│   └── ...
└── DEPLOY.md
```

## 1. 构建 Web 前端

在本地或开发机上：

```bash
cd web
npm install
npm run build
# 产物在 web/dist/ 目录
```

将 `web/dist/` 上传到服务器，例如 `/opt/zlplay-web/web/dist/`。

## 2. 配置环境变量

```bash
cd server
cp .env.example .env
```

编辑 `.env` 文件：

```env
# WebSocket 端口（容器内部端口，不建议改）
WS_PORT=8080

# 最大房间数
MAX_ROOMS=200

# 房间空闲超时（秒）
ROOM_TIMEOUT=300

# 日志级别: debug | info | warn | error
LOG_LEVEL=info

# 心跳间隔（毫秒）
HEARTBEAT_INTERVAL=30000

# 心跳超时（毫秒）
HEARTBEAT_TIMEOUT=60000

# 每个连接每秒最大消息数
RATE_LIMIT=10
```

## 3. Docker 部署

### 方式 A：docker-compose（推荐）

将整个 `server/` 目录上传到服务器 `/opt/zlplay-web/server/`。

修改 `docker-compose.yml`，取消 SSL 和静态文件的注释：

```yaml
version: '3.8'

services:
  sync-server:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: zlplay-sync-server
    restart: unless-stopped
    expose:
      - "8080"                    # 仅 nginx 访问，不暴露到宿主机
    environment:
      - WS_PORT=8080
      - MAX_ROOMS=200
      - ROOM_TIMEOUT=300
      - LOG_LEVEL=info
    deploy:
      resources:
        limits:
          memory: 256M
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:1.25-alpine
    container_name: zlplay-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ../web/dist:/usr/share/nginx/html:ro   # Web 构建产物
      - ./ssl:/etc/nginx/ssl:ro                # SSL 证书（1Panel 管理）
    depends_on:
      sync-server:
        condition: service_healthy
```

启动：

```bash
cd /opt/zlplay-web/server
docker-compose up -d

# 查看日志
docker-compose logs -f

# 重启
docker-compose restart

# 停止
docker-compose down
```

### 方式 B：1Panel 面板部署

1. 登录 1Panel 面板
2. 进入「容器」→「编排」→「创建编排」
3. 粘贴上面的 `docker-compose.yml` 内容
4. 点击「启动」

## 4. Nginx 配置

编辑 `server/nginx.conf`：

```nginx
upstream sync_server {
    server sync-server:8080;
}

# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（1Panel 自动管理）
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # 安全头
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    client_max_body_size 10m;

    # WebSocket 代理
    location / {
        proxy_pass http://sync_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # 静态文件
    location /app {
        alias /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /app/index.html;
    }
}
```

### SSL 证书（1Panel）

1. 1Panel →「网站」→「证书」
2. 申请 Let's Encrypt 证书（需要域名已解析到服务器）
3. 证书会自动保存到 1Panel 管理的目录
4. 将证书软链接或复制到 `./ssl/` 目录：

```bash
mkdir -p /opt/zlplay-web/server/ssl
# 1Panel 证书通常在 /opt/1panel/data/letsencrypt/live/your-domain/
ln -s /opt/1panel/data/letsencrypt/live/your-domain/fullchain.pem /opt/zlplay-web/server/ssl/
ln -s /opt/1panel/data/letsencrypt/live/your-domain/privkey.pem /opt/zlplay-web/server/ssl/
```

## 5. 客户端配置

部署完成后，Web 端通过 `https://your-domain.com/app` 访问。

首次使用时，在页面中输入 Alist 服务器地址（支持用户名密码登录或直接 Token）。

WebSocket 地址会自动使用当前页面的 host（生产环境无需额外配置）。

如需手动指定 WebSocket 地址，在浏览器控制台执行：

```js
localStorage.setItem('zlplay_ws_url', 'wss://your-domain.com')
```

## 6. 健康检查

```bash
# 检查服务器状态
curl https://your-domain.com/health
# 返回: {"status":"ok"}

# 查看统计
curl https://your-domain.com/stats
# 返回: {"rooms":0,"online":0,"totalMessages":0}
```

## 7. 故障排查

### 容器启动失败

```bash
# 查看日志
docker logs zlplay-sync-server

# 常见原因：端口被占用
netstat -tlnp | grep 8080
```

### WebSocket 连接失败

- 检查 Nginx 是否配置了 WebSocket 升级头
- 检查防火墙是否开放了 80/443 端口
- 检查浏览器控制台 WebSocket 连接 URL 是否正确（wss:// 不是 ws://）

### 视频无法播放

- 确认 Alist 服务器地址和 Token 正确
- 检查 Alist 的存储驱动是否支持直链（部分网盘需要特殊配置）
- 查看浏览器控制台的网络请求，确认视频 URL 是否返回 200

### 1Panel 反向代理

如果在 1Panel 中使用了「网站」功能创建反向代理（而非 docker-compose 中的 nginx），需要额外配置 WebSocket 支持：

1. 进入 1Panel →「网站」→ 你的站点 →「配置文件」
2. 在 `location /` 块中添加：
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

## 8. 更新部署

```bash
# 拉取最新代码
cd /opt/zlplay-web
git pull

# 重新构建前端
cd web && npm run build

# 重新构建并重启容器
cd ../server
docker-compose down
docker-compose up -d --build
```

## 9. 资源需求

| 组件 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| sync-server | 0.5 核 | 128MB | 50MB |
| nginx | 0.2 核 | 32MB | 20MB |
| **总计** | **0.7 核** | **256MB** | **100MB** |

每增加 50 个并发房间，建议增加 128MB 内存。
