# MatchLife UAT 兼容入口（Aliyun ECS）

> 当前 `shell` 权威入口已迁移至：
> `/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat`
>
> 本目录保留的 `00-*.sh`、`01-*.sh`、`02-*.sh`、`03-*.sh`、`04-*.sh` 仅作为兼容转发层，避免仓库内历史调用、运维命令、脚本入口立即失效。
> 运行时源码资产如 `.mjs`、`sync-runtime.package.json`、`systemd/` 仍保留在本仓库，供 Docker / 本地构建 / 发布产物打包使用。

该目录当前用于将 MatchLife 发布到阿里云 ECS `121.41.195.46`，通过共享域名 `tools.cheersai.cloud` 的子路径 `/7smile-matchlife/` 对外提供服务。

说明：

- 当前 `121.41.195.46 + tools.cheersai.cloud/7smile-matchlife` 为临时过渡方案
- 生产环境仍允许使用 `175.178.236.183 + 7smile.dlithink.com/match-life`，但 UAT 发布不得混入 `/match-life/assets/*` 产物
- 待后期旧主机备案完成后，再统一规划正式迁移与回收

目录内脚本职责：

- `check-env.sh`：本地与目标主机自检
- `00-deploy-all.sh`：一键入口
- `01-build.sh`：按子路径构建前端 `dist/`
- `02-push.sh`：推送构建产物与运行时文件到远端暂存目录
- `03-release.sh`：创建运行用户、落盘文件、接入共享 Nginx、重启同步服务
- `04-monitor.sh`：校验入口、静态资源、同步服务与 heartbeat

## 目标环境

- 服务器：`121.41.195.46`
- SSH 登录用户：`cheersai`
- 应用运行用户：`sevensmile`
- 共享域名：`tools.cheersai.cloud`
- 对外路径：`https://tools.cheersai.cloud/7smile-matchlife/`
- 前端发布目录：`/home/sevensmile/apps/7smile-matchlife/current`
- 同步运行时目录：`/home/sevensmile/release/runtime/7smile-matchlife-sync`
- Nginx 主配置：`/etc/nginx/conf.d/tools.cheersai.cloud.conf`
- MatchLife location 片段：`/etc/nginx/snippets/7smile-matchlife.tools.cheersai.cloud.locations.conf`
- 证书：复用主机现有 `tools.cheersai.cloud` 证书

## 历史环境保留

- 历史主机：`175.178.236.183`
- 历史域名：`7smile.dlithink.com`
- 生产路径：`/match-life/`
- 路径基线与仓内运维说明见：`docs/ops/部署路径基线.md`、`docs/ops/2026-05-20-UAT路径与日志修复说明.md`、`docs/ops/UAT服务器部署与运维手册.md`、`docs/ops/生产环境发布方案.md`
- 当前要求：保持历史环境可追溯、可保留，不做铲除

## 前置条件

- `cheersai@121.41.195.46` 可 SSH 登录
- `cheersai` 具备 `sudo NOPASSWD`
- 目标机已安装并启用 Nginx
- `tools.cheersai.cloud` 已解析到 `121.41.195.46`

## Supabase 私有化（非 Docker）

当云 Supabase 不稳定时，可在 `175.178.236.183` 以本地服务方式部署 PostgREST + PostgreSQL（非 Docker）：

1) 准备文件（本地）：

```bash
scp supabase/migrations/*.sql sevensmile@175.178.236.183:/home/sevensmile/release/staging/
scp /tmp/postgrest sevensmile@175.178.236.183:/home/sevensmile/release/staging/postgrest
scp /tmp/matchlife_supabase_secrets.env sevensmile@175.178.236.183:/home/sevensmile/release/staging/matchlife_supabase_secrets.env
```

2) 执行部署（远端）：

```bash
scp scripts/matchlife-uat/setup-selfhosted-supabase.sh sevensmile@175.178.236.183:/home/sevensmile/release/staging/
ssh sevensmile@175.178.236.183 "chmod +x /home/sevensmile/release/staging/setup-selfhosted-supabase.sh && /home/sevensmile/release/staging/setup-selfhosted-supabase.sh"
```

3) 输出结果：

- PostgREST: `postgrest-matchlife.service`（本机 `127.0.0.1:18000`）
- Nginx 对外 API: `http://175.178.236.183:8000/rest/v1/*`
- Nginx 对外 HTTPS: `https://175.178.236.183:8443/rest/v1/*`（自签证书）
- 客户端密钥文件：`/home/sevensmile/release/runtime/matchlife-supabase.env`

4) 本地开发切换：

将 `.env/.env.local` 中的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 更新为上一步生成值，然后执行：

```bash
pnpm diag:supabase
pnpm sync:ymq
```

## 快速使用

```bash
export PROJECT_ROOT=/Users/FYP/Documents/WorkSpace/7Smile/subproducts/SevenSmile-MatchLife
export SERVER_IP=121.41.195.46
export REMOTE_USER=cheersai
export APP_RUN_USER=sevensmile
export APP_SLUG=7smile-matchlife
export REMOTE_STAGE_DIR=/home/cheersai/release/staging/7smile-matchlife
export REMOTE_WWW_DIR=/home/sevensmile/apps/7smile-matchlife/current
export DOMAIN_NAME=tools.cheersai.cloud
export APP_ORIGIN=https://tools.cheersai.cloud
export APP_BASE_PATH=/7smile-matchlife/
export APP_PATH=/7smile-matchlife

bash scripts/matchlife-uat/00-deploy-all.sh
```

## 发布行为

`03-release.sh` 会自动完成以下工作：

- 若不存在则创建系统用户 `sevensmile`
- 发布前端到 `/home/sevensmile/apps/7smile-matchlife/current`
- 保留旧 hashed `assets/`，降低发布窗口期旧 HTML 命中失效资源的风险
- 将 MatchLife 的 location 片段注入 `tools.cheersai.cloud.conf`
- 将 `/7smile-matchlife/api/wechat/*` 反向代理到本机 `127.0.0.1:18765`
- 以 `sevensmile` 身份重启访问码服务
- 安装并重启 `7smile-matchlife-sync.service`

## 共享网关接入

`tools.cheersai.cloud` 是共享域名，MatchLife 不能覆盖整份 `server` 配置，只能以子路径形式挂载：

- 页面入口：`/7smile-matchlife/`
- 静态资源：`/7smile-matchlife/assets/*`
- 微信接口：`/7smile-matchlife/api/wechat/*`

前端已同步改为基于 `import.meta.env.BASE_URL` 访问微信接口，因此构建时必须使用：

```bash
APP_BASE_PATH=/7smile-matchlife/ bash scripts/matchlife-uat/01-build.sh
```

## 访问码与公众号链路

推荐环境变量：

```bash
export WECHAT_ACCESS_CODES=7SMILE-ML-20260418
export WECHAT_ACCESS_KEYWORD=比赛生涯
export APP_ORIGIN=https://tools.cheersai.cloud
export APP_BASE_PATH=/7smile-matchlife/
```

用户访问流程：

- 关注公众号“七笑果-文体中心”
- 回复关键词“比赛生涯”
- 通过直达链接或访问码进入 `/7smile-matchlife/gate/wechat`

## 同步守护进程

同步服务统一以 `systemd` 方式运行：

- 服务名：`7smile-matchlife-sync.service`
- 运行目录：`/home/sevensmile/release/runtime/7smile-matchlife-sync`
- 心跳文件：`/home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json`
- watcher 日志默认输出摘要；可通过 `MATCHLIFE_LOG_MIN_INTERVAL_MS` 控制无增量时的最小打印间隔，默认 `60000`

发布时会自动：

- 安装最小运行时依赖
- 生成 `start-watch-ymq.sh`
- 安装 `/etc/systemd/system/7smile-matchlife-sync.service`
- `enable + restart` 服务

## 验收

标准验收：

```bash
bash scripts/matchlife-uat/04-monitor.sh
```

脚本会检查：

- `https://tools.cheersai.cloud/7smile-matchlife/` 是否可达
- HTML 中引用的 CSS/JS/图标是否都可访问
- `7smile-matchlife-sync.service` 是否为 `active`
- `heartbeat.json` 是否按时刷新

常用排查命令：

```bash
ssh cheersai@121.41.195.46 "sudo -n systemctl status 7smile-matchlife-sync --no-pager"
ssh cheersai@121.41.195.46 "sudo -n journalctl -u 7smile-matchlife-sync -n 80 --no-pager"
ssh cheersai@121.41.195.46 "cat /home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json"
ssh cheersai@121.41.195.46 "cat /home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json"
```

手工恢复：

```bash
ssh cheersai@121.41.195.46 "rm -f /home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json && sudo -n systemctl restart 7smile-matchlife-sync"
```
