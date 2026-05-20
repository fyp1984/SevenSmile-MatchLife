# MatchLife 本地 Docker 与 UAT 一致性方案

## 目标

本方案用于明确哪些场景必须经过本地 Docker 验证，以及如何让本地运行方式尽量贴近 UAT。

## 为什么不能只跑 `pnpm dev`

`pnpm dev` 适合页面开发，但无法完整覆盖以下发布态问题：

- 子路径部署
- Nginx 同源代理
- Cookie Path 与微信入口
- `sync watcher` 后台守护逻辑
- 运行时环境变量与脚本组合

因此，任何涉及路径、代理、Cookie、同步、微信入口的修改，都必须再跑一遍本地 Docker。

## 当前本地 Docker 拓扑

- `matchlife-web`
  - 基于 `Dockerfile.web`
  - 负责构建前端并通过 Nginx 子路径对外提供静态站点
- `wechat-access`
  - 基于 `Dockerfile.runtime`
  - 运行 `scripts/matchlife-uat/wechat-oauth-server.mjs`
- `sync-watcher`
  - 基于 `Dockerfile.runtime`
  - 运行 `scripts/watch-ymq.mjs`

对应文件：

- `docker-compose.local.yml`
- `Dockerfile.web`
- `Dockerfile.runtime`
- `docker/local/nginx/default.conf.template`

## 与 UAT 的对应关系

- `matchlife-web` 对应 UAT 上的共享 Nginx 子路径站点
- `wechat-access` 对应 UAT 上的访问码与微信辅助服务
- `sync-watcher` 对应 UAT 上的 `7smile-matchlife-sync.service`

## 启动方式

### 1. 准备环境变量

建议先准备 `.env.local`，至少包含：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

如果本地 Docker 需要回源宿主机 PostgREST，可使用：

- `SUPABASE_REST_UPSTREAM=http://host.docker.internal:8000`
- `SUPABASE_URL=http://host.docker.internal:8000`

### 2. 启动容器

```bash
docker compose -f docker-compose.local.yml up --build
```

### 3. 访问地址

```text
http://localhost:18080/7smile-matchlife/
```

## 一致性检查清单

### 路径一致

- 页面入口是否固定为 `/7smile-matchlife/`
- 静态资源是否都从 `/7smile-matchlife/assets/*` 加载
- 数据请求是否走 `/7smile-matchlife/supabase/*`
- 微信入口是否走 `/7smile-matchlife/api/wechat/*`

### 配置一致

- 是否都使用 `APP_BASE_PATH=/7smile-matchlife/`
- 是否都使用同名 `SUPABASE_*` 与 `MATCHLIFE_*` 环境变量
- 是否都使用与 UAT 相同的 Node 脚本

### 行为一致

- 访问码是否能正确设置 Cookie
- watcher 是否会生成 heartbeat 与 state 文件
- 页面刷新到子路由时是否不会 404
- 搜索、最近比赛、同步状态页是否行为一致

## 发版前最小动作

- UAT shell 权威入口统一为 `TECH_SCRIPT_DIR=/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat`。
- 仓库内 `scripts/matchlife-uat/*.sh` 仅保留兼容转发层，运行时源码资产仍在源码仓库。

```bash
TECH_SCRIPT_DIR="/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat"
```

涉及路径或发布链的变更，发版前至少执行：

```bash
docker compose -f docker-compose.local.yml config
bash "$TECH_SCRIPT_DIR/check-env.sh"
APP_BASE_PATH=/7smile-matchlife/ bash "$TECH_SCRIPT_DIR/01-build.sh"
```

如果这类修改同时影响发布脚本，还应继续执行：

```bash
bash "$TECH_SCRIPT_DIR/02-push.sh"
bash "$TECH_SCRIPT_DIR/03-release.sh"
bash "$TECH_SCRIPT_DIR/04-monitor.sh"
```

## 当前经验规则

- 样式和纯前端交互修改，可以先用 `pnpm dev`
- 发布链、路径、代理、Cookie、微信入口修改，必须再走本地 Docker
- 需要上线 UAT 的修复，一律先改本地正式仓，再同步服务器

## 关联文档

- UAT 发布与运维：`UAT服务器部署与运维手册.md`
- 路径矩阵：`部署路径基线.md`
- 2026-05-20 修复记录：`2026-05-20-UAT路径与日志修复说明.md`
