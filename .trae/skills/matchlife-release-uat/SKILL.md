---
name: "matchlife-release-uat"
description: "Deploys MatchLife to Aliyun ECS 121.41.195.46 under tools.cheersai.cloud/7smile-matchlife with shared-Nginx path routing, build, push, release, and monitor steps."
---

# MatchLife Release UAT

## 适用场景

当出现以下需求时调用本 SKILL：

- 需要将 MatchLife 发布到阿里云 ECS `121.41.195.46`
- 需要接入共享域名 `tools.cheersai.cloud` 的 `/7smile-matchlife/` 子路径
- 需要创建应用运行用户 `sevensmile`
- 需要迁移前端静态资源、微信访问码服务与同步 watcher
- 需要执行发布后验收或回归检查

## 当前定位

- `121.41.195.46 + tools.cheersai.cloud/7smile-matchlife` 为当前临时过渡方案
- 历史 `175.178.236.183 + 7smile.dlithink.com/match-life` 先保留，不做铲除或清理
- 待后期旧主机备案完成后，再统一规划正式迁移与回收

## 目标环境

- 域名：`tools.cheersai.cloud`
- 应用路径：`/7smile-matchlife`
- 服务器：`121.41.195.46`
- SSH 登录用户：`cheersai`
- 应用运行用户：`sevensmile`
- 前端目录：`/home/sevensmile/apps/7smile-matchlife/current`
- 同步目录：`/home/sevensmile/release/runtime/7smile-matchlife-sync`
- Nginx 主配置：`/etc/nginx/conf.d/tools.cheersai.cloud.conf`
- MatchLife location 片段：`/etc/nginx/snippets/7smile-matchlife.tools.cheersai.cloud.locations.conf`
- 证书：复用主机现有 `tools.cheersai.cloud` 证书

## 历史环境说明

- 历史主机：`175.178.236.183`
- 历史域名：`7smile.dlithink.com`
- 历史路径：`/match-life/`
- 当前要求：与其相关的 Nginx、证书、静态站点和运行时配置先保留
- 本 SKILL 当前只覆盖阿里云 ECS 过渡环境，不包含历史环境的拆除动作

## 速查版

标准命令：

```bash
bash scripts/matchlife-uat/check-env.sh
APP_BASE_PATH=/7smile-matchlife/ bash scripts/matchlife-uat/01-build.sh
bash scripts/matchlife-uat/02-push.sh
bash scripts/matchlife-uat/03-release.sh
bash scripts/matchlife-uat/04-monitor.sh
```

常用环境变量：

```bash
export SERVER_IP=121.41.195.46
export REMOTE_USER=cheersai
export APP_RUN_USER=sevensmile
export APP_SLUG=7smile-matchlife
export DOMAIN_NAME=tools.cheersai.cloud
export APP_ORIGIN=https://tools.cheersai.cloud
export APP_BASE_PATH=/7smile-matchlife/
export APP_PATH=/7smile-matchlife
```

执行边界：

- 允许：发布、修复、验收 `121.41.195.46` 上的过渡环境
- 不允许：顺手删除、覆盖、清空 `175.178.236.183` 或 `7smile.dlithink.com` 既有配置

## 标准流程

### 1. 环境自检

执行：

```bash
bash scripts/matchlife-uat/check-env.sh
```

确认以下项全部通过：

- 本地 Git 仓库有效
- `pnpm / ssh / scp / rsync` 可用
- `cheersai@121.41.195.46` 可连接
- `cheersai` 已具备 `sudo NOPASSWD`

### 2. 子路径构建

必须使用：

```bash
APP_BASE_PATH=/7smile-matchlife/ bash scripts/matchlife-uat/01-build.sh
```

原因：

- 前端需在 `/7smile-matchlife/` 子路径下加载静态资源
- 前端访问码接口已收口到 `${BASE_URL}api/wechat/*`

### 3. 推送产物

执行：

```bash
bash scripts/matchlife-uat/02-push.sh
```

该步骤会推送：

- `dist/`
- `deploy-matchlife.sh`
- `wechat-oauth-server.mjs` 与 `wechat-access.env`
- `watch-ymq.mjs`、`lib/ymq-sync.mjs`
- `sync-runtime.package.json`
- `matchlife-sync.service.tpl`
- `sync-runtime.env`

### 4. 远端发布

执行：

```bash
bash scripts/matchlife-uat/03-release.sh
```

远端会完成：

- 若不存在则创建 `sevensmile`
- 发布静态文件到 `/home/sevensmile/apps/7smile-matchlife/current`
- 将 MatchLife 的 location 片段注入 `tools.cheersai.cloud.conf`
- 为 HTML 入口设置 `no-store`
- 保留既有 hashed `assets/`，降低旧缓存命中失效资源的概率
- 重启访问码服务 `127.0.0.1:18765`
- 安装并重启 `7smile-matchlife-sync.service`

### 5. 发布后验收

执行：

```bash
bash scripts/matchlife-uat/04-monitor.sh
```

该步骤会校验：

- `https://tools.cheersai.cloud/7smile-matchlife/` 是否可达
- HTML 引用的 CSS/JS/图标资源是否都可访问
- `7smile-matchlife-sync.service` 是否为 `active`
- `heartbeat.json` 是否在时效内刷新

## 关键规范

### 共享域名规范

- `tools.cheersai.cloud` 为共享域名
- MatchLife 必须固定挂载在 `/7smile-matchlife/`
- 不覆盖根路径 `/`
- 不覆盖其他既有子路径如 `/ts/`、`/rm/`、`/survey/`
- 不以当前过渡发布动作为由，去回收历史 `7smile.dlithink.com` 链路

### Nginx 规范

- 不整份重写 `tools.cheersai.cloud.conf`
- 仅通过受控 marker 向 HTTPS `server` 注入 MatchLife include
- MatchLife 片段文件固定写入 `/etc/nginx/snippets/7smile-matchlife.tools.cheersai.cloud.locations.conf`
- 微信接口固定走 `/7smile-matchlife/api/wechat/*`

### 后台同步规范

- watcher 统一由 `7smile-matchlife-sync.service` 托管
- 运行目录固定为 `/home/sevensmile/release/runtime/7smile-matchlife-sync`
- 心跳文件固定为 `/home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json`

## 常用排查

### 如果首页 404

- 检查 `APP_BASE_PATH` 是否为 `/7smile-matchlife/`
- 检查 `/home/sevensmile/apps/7smile-matchlife/current/index.html` 是否存在
- 检查 `tools.cheersai.cloud.conf` 中是否已注入 MatchLife include block

### 如果静态资源 404

- 检查 `dist/index.html` 中资源是否以 `/7smile-matchlife/assets/` 开头
- 检查 Nginx `location ^~ /7smile-matchlife/assets/`

### 如果微信验证失败

- 检查前端是否请求 `/7smile-matchlife/api/wechat/*`
- 检查 `wechat-oauth-server.mjs` 是否已接受子路径 API
- 检查 `APP_ORIGIN=https://tools.cheersai.cloud`

### 如果同步服务未运行

- 检查 `systemctl status 7smile-matchlife-sync --no-pager`
- 检查 `journalctl -u 7smile-matchlife-sync -n 80 --no-pager`
- 检查 `/home/sevensmile/release/runtime/7smile-matchlife-sync/.env.runtime`

## 禁止事项

- 不删除 `175.178.236.183` 上既有 MatchLife 配置
- 不删除 `7smile.dlithink.com` 相关证书、Nginx、静态目录或运行时目录
- 不将“过渡方案上线”误写成“历史环境已迁移完成”
- 未经明确确认，不执行历史环境下线、域名切换或配置回收

## 一键入口

```bash
bash scripts/matchlife-uat/00-deploy-all.sh
```
