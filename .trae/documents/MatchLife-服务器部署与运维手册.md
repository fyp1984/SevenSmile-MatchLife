# MatchLife 服务器部署与运维手册

## 一、当前部署策略

- 当前对外运行方案：
  - `121.41.195.46`
  - `https://tools.cheersai.cloud/7smile-matchlife/`
- 当前定位：
  - 临时过渡方案
  - 用于在备案完成前承载现网访问
- 历史主机与域名：
  - `175.178.236.183`
  - `https://7smile.dlithink.com/match-life/`
- 当前要求：
  - 针对 `175.178.236.183` 与 `7smile.dlithink.com` 的既有配置先不做铲除或清理
  - 待后期该主机备案完成后，再统一规划迁移与切换

## 二、当前过渡环境

- 共享域名：`tools.cheersai.cloud`
- 应用访问路径：`https://tools.cheersai.cloud/7smile-matchlife/`
- 应用类型：Vite 构建的前端静态站点
- 证书：复用 `tools.cheersai.cloud` 所在主机现有证书

## 三、当前线上部署结果

### 1) 目标服务器

- SSH 登录用户：`cheersai`
- 应用运行用户：`sevensmile`
- 服务器公网 IP：`121.41.195.46`

### 2) DNS 状态

- 当前过渡域名：`tools.cheersai.cloud`
- 当前过渡路径：`/7smile-matchlife/`
- 旧域名 `7smile.dlithink.com` 相关配置保留，不在本轮运维范围内清理

### 3) 线上目录

- 远端暂存目录：
  - `/home/cheersai/release/staging/7smile-matchlife`
- 线上站点目录：
  - `/home/sevensmile/apps/7smile-matchlife/current`
- 同步运行时目录：
  - `/home/sevensmile/release/runtime/7smile-matchlife-sync`

### 4) Nginx 配置与证书

- 共享网关主配置：
  - `/etc/nginx/conf.d/tools.cheersai.cloud.conf`
- MatchLife 子路径片段：
  - `/etc/nginx/snippets/7smile-matchlife.tools.cheersai.cloud.locations.conf`
- 证书：
  - 复用 `tools.cheersai.cloud` 主机现有 HTTPS 证书

## 四、历史环境保留说明

- `175.178.236.183` 主机上的 MatchLife 相关部署、证书与 Nginx 配置暂不拆除
- `7smile.dlithink.com` 现有链路暂不做下线、清理、回收或覆盖
- 后续待旧主机备案完成后，再统一规划：
  - 数据迁移
  - 域名切换
  - 历史配置回收

## 五、Nginx 配置规范

### 1) HTTP -> HTTPS

- `tools.cheersai.cloud` 为共享域名
- MatchLife 仅以子路径 `/7smile-matchlife/` 形式接入
- 不覆盖根路径 `/`

### 2) 根路径策略

- 不整份重写 `tools.cheersai.cloud.conf`
- 仅通过受控 include / snippet 方式挂载 MatchLife location

### 3) 子路径路由

- `location = /7smile-matchlife`
  - 301 到 `/7smile-matchlife/`
- `location ^~ /7smile-matchlife/assets/`
  - 直接映射静态资源目录
  - 开启长期缓存
- `location ^~ /7smile-matchlife/`
  - 使用 SPA `try_files` 回退到 `/7smile-matchlife/index.html`
- `location ^~ /7smile-matchlife/api/wechat/`
  - 反向代理到本机访问码服务

### 4) 安全配置

- 启用 TLS 1.2 / TLS 1.3
- 开启基础安全头：
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `X-XSS-Protection`
  - `Referrer-Policy`

## 六、前端部署规范

### 1) 子路径构建

发布时必须带：

```bash
APP_BASE_PATH=/7smile-matchlife/
```

这样前端资源路径会构建为：

- `/7smile-matchlife/assets/...`

### 2) React Router

- 已使用 `basename={import.meta.env.BASE_URL}`
- 允许在 `/7smile-matchlife/stats`、`/7smile-matchlife/sync` 等子路由下正常刷新

## 七、后台数据同步机制

### 1) 当前服务器部署方式

线上不再依赖手工执行 `pnpm sync:ymq:watch`，而是使用独立 Node 运行时 + `systemd` 常驻：

- 运行目录：
  - `/home/sevensmile/release/runtime/7smile-matchlife-sync`
- 启动脚本：
  - `/home/sevensmile/release/runtime/7smile-matchlife-sync/start-watch-ymq.sh`
- `systemd` 单元：
  - `/etc/systemd/system/7smile-matchlife-sync.service`
- 心跳文件：
  - `/home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json`
- 状态文件：
  - `/home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json`
- 日志查看：
  - `journalctl -u 7smile-matchlife-sync`

### 2) 运行时文件

- `package.json`
- `watch-ymq.mjs`
- `lib/ymq-sync.mjs`
- `.env.runtime`
- `heartbeat.json`
- `sync-state.json`
- `node_modules/`

### 3) 必要环境变量

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MATCHLIFE_DISCOVERY_INTERVAL_MS`
- `MATCHLIFE_ACTIVE_INTERVAL_MS`
- `MATCHLIFE_IDLE_FAST_INTERVAL_MS`
- `MATCHLIFE_ACTIVE_IDLE_MS`
- `MATCHLIFE_ACTIVE_PAGES`
- `MATCHLIFE_AUTO_PAUSE_IDLE_MS`
- `MATCHLIFE_AUTO_PAUSE_ERROR_MS`
- `MATCHLIFE_PAUSED_HEARTBEAT_INTERVAL_MS`
- `SYNC_RACE_ID`
- `SYNC_TOURNAMENT_NAME`

### 4) 当前默认同步参数

- `MATCHLIFE_DISCOVERY_INTERVAL_MS=30000`
- `MATCHLIFE_ACTIVE_INTERVAL_MS=1500`
- `MATCHLIFE_IDLE_FAST_INTERVAL_MS=10000`
- `MATCHLIFE_ACTIVE_IDLE_MS=60000`
- `MATCHLIFE_ACTIVE_PAGES=2`
- `MATCHLIFE_AUTO_PAUSE_IDLE_MS=86400000`
- `MATCHLIFE_AUTO_PAUSE_ERROR_MS=86400000`
- `MATCHLIFE_PAUSED_HEARTBEAT_INTERVAL_MS=300000`
- `SYNC_RACE_ID=38653`
- `SYNC_TOURNAMENT_NAME=2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛`

### 5) 自动暂停策略

- 若连续 24 小时没有任何有效更新，且源站不再返回进行中场地，则自动判定该轮比赛已完赛并暂停抓取
- 若连续 24 小时同步请求异常、无法成功完成同步，则自动暂停抓取，避免持续空转
- 自动暂停后，`matchlife-sync.service` 继续由 `systemd` 保持运行，但 watcher 只刷新 heartbeat，不再访问源站
- 自动暂停状态写入：
  - `/home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json`
- 恢复方式为手工清理状态文件并重启服务

## 八、标准发布流程

### 1) 环境自检

```bash
bash scripts/matchlife-uat/check-env.sh
```

确认项：

- 本地 `pnpm / ssh / scp / rsync / python3` 可用
- `cheersai@121.41.195.46` SSH 免密正常
- 远端具备所需 `sudo NOPASSWD` 能力
- 本地 `.env.local` 或 `.env` 已提供同步所需 Supabase 凭据

### 2) 本地构建

```bash
APP_BASE_PATH=/7smile-matchlife/ bash scripts/matchlife-uat/01-build.sh
```

说明：

- 必须以 `/7smile-matchlife/` 作为构建基路径
- 这样 `dist/index.html` 中资源路径才会落到 `/7smile-matchlife/assets/...`
- React Router 已通过 `basename={import.meta.env.BASE_URL}` 适配子路径刷新

### 3) 推送产物与证书

```bash
bash scripts/matchlife-uat/02-push.sh
```

推送内容：

- 前端产物 `dist/`
- 远端发布脚本 `deploy-matchlife.sh`
- 微信访问码守护相关脚本与配置
- 同步 watcher 运行时：`watch-ymq.mjs`、`lib/ymq-sync.mjs`、`sync-runtime.package.json`
- `systemd` 模板：`matchlife-sync.service.tpl`
- 同步环境配置：`sync-runtime.env`

### 4) 远端发布

```bash
bash scripts/matchlife-uat/03-release.sh
```

说明：

- 除了发布前端静态资源与 Nginx 配置外，还会：
  - 部署 `wechat` 守护服务
  - 部署 `7smile-matchlife-sync` 持续同步守护进程
  - 安装最小运行时依赖
  - 写入 heartbeat 配置
  - 生成 `start-watch-ymq.sh`
  - 安装并重启 `7smile-matchlife-sync.service`

### 5) 发布后检查

```bash
bash scripts/matchlife-uat/04-monitor.sh
```

检查项：

- `https://tools.cheersai.cloud/7smile-matchlife/` 可访问
- `7smile-matchlife-sync.service` 处于 `active`
- `heartbeat.json` 最近持续刷新
- 若已自动暂停，监控输出会显示 `paused=true` 与暂停原因

说明：

- 站点可用性通过 SSH 到服务器后执行 loopback `curl` 校验，避免本地 TLS 链路干扰导致误报
- 心跳默认允许最大时效为 `180s`，可通过 `SYNC_HEARTBEAT_MAX_AGE_SECONDS` 覆盖

### 6) 一键入口

```bash
bash scripts/matchlife-uat/00-deploy-all.sh
```

## 九、运行时验收规范

### 1) 页面验收

- `https://tools.cheersai.cloud/7smile-matchlife/` 返回 200
- `https://tools.cheersai.cloud/7smile-matchlife/stats` 刷新不 404
- `https://tools.cheersai.cloud/7smile-matchlife/assets/...` 返回 200

### 2) Nginx 验收

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3) 服务器本机验收

```bash
curl -k -I https://127.0.0.1/7smile-matchlife/ -H 'Host: tools.cheersai.cloud'
curl -k -I https://127.0.0.1/7smile-matchlife/assets/index-xxx.js -H 'Host: tools.cheersai.cloud'
```

### 4) 同步守护进程验收

```bash
sudo systemctl status 7smile-matchlife-sync --no-pager
sudo journalctl -u 7smile-matchlife-sync -n 80 --no-pager
cat /home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json
cat /home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json
```

重点观察：

- `systemctl status` 显示 `active (running)`
- `journalctl` 持续有 `discovery / active / idle_fast` 的同步输出
- `heartbeat.json` 中 `ok=true`
- `heartbeat.json` 的 `kind` 与最近运行状态一致
- 若处于暂停状态，`heartbeat.json` 会显示 `kind=paused`
- `sync-state.json` 中可看到 `pauseReason`、`pausedAt`、`lastActivityAt`

### 5) 数据库验收

观察 `sync_runs` 最近记录，应持续出现：

- `kind=discovery`
- 活跃比赛时出现 `kind=active`

## 十、访问码与公众号方案

### 1) 当前生产方案

- 不再依赖公众号网页授权 OAuth
- 用户流程：
  - 关注公众号“七笑果-文体有料”
  - 回复关键词“比赛生涯”
  - 获取访问码后，在 `/7smile-matchlife/gate/wechat` 页面输入

### 2) 服务端验证接口

- `/7smile-matchlife/api/wechat/access-code/verify`
- 由 `127.0.0.1:18765` Node 守护服务处理
- 验证成功后下发：
  - `Set-Cookie: matchlife_wechat_ok=1`

### 3) 生产环境文件

- 运行脚本：
  - `/home/sevensmile/release/runtime/7smile-matchlife/wechat-oauth-server.mjs`
- 访问码配置：
  - `/home/sevensmile/release/runtime/7smile-matchlife/wechat-access.env`
- 进程 PID：
  - `/home/sevensmile/release/runtime/7smile-matchlife/wechat-access.pid`
- 日志：
  - `/home/sevensmile/release/runtime/7smile-matchlife/wechat-access.log`

### 4) 当前已投产访问码

- `7SMILE-ML-20260418`

建议在完成当前验收后尽快轮换。

### 5) 如何轮换访问码

修改服务器文件：

```bash
/home/sevensmile/release/runtime/7smile-matchlife/wechat-access.env
```

例如：

```bash
WECHAT_ACCESS_CODES='7SMILE-ML-20260419'
WECHAT_ACCESS_KEYWORD='比赛生涯'
```

然后重启守护服务：

```bash
pkill -f wechat-oauth-server.mjs
nohup bash -lc "set -a && source /home/sevensmile/release/runtime/7smile-matchlife/wechat-access.env && set +a && exec node /home/sevensmile/release/runtime/7smile-matchlife/wechat-oauth-server.mjs" > /home/sevensmile/release/runtime/7smile-matchlife/wechat-access.log 2>&1 &
```

## 十一、运维注意事项

- 当前阿里云环境仅为过渡方案，历史 `175.178.236.183` 与 `7smile.dlithink.com` 链路继续保留，不在本轮清理范围内
- `tools.cheersai.cloud` 为共享域名，后续新增应用时继续按子路径扩展
- 不建议为同一域名再单独创建多个相互冲突的 `server_name tools.cheersai.cloud` 配置
- 如需回滚，只需重新发布旧版本 `dist/` 到 `/home/sevensmile/apps/7smile-matchlife/current`
- 同步守护进程已切换为 `systemd` 管理，不再使用手工 `pid` 文件拉起或停止
- 如需重启同步守护进程，优先使用 `sudo systemctl restart 7smile-matchlife-sync`
- 如需查看同步异常，优先检查 `journalctl -u 7smile-matchlife-sync` 与 `heartbeat.json`

## 十二、常用运维操作

### 1) 发布整套应用

```bash
bash scripts/matchlife-uat/00-deploy-all.sh
```

### 2) 仅检查线上状态

```bash
bash scripts/matchlife-uat/04-monitor.sh
```

### 3) 仅重启同步服务

```bash
ssh cheersai@121.41.195.46 "sudo -n systemctl restart 7smile-matchlife-sync"
ssh cheersai@121.41.195.46 "sudo -n systemctl status 7smile-matchlife-sync --no-pager"
```

### 4) 查看最近同步日志

```bash
ssh cheersai@121.41.195.46 "journalctl -u 7smile-matchlife-sync -n 80 --no-pager"
```

### 5) 查看最近同步心跳

```bash
ssh cheersai@121.41.195.46 "cat /home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json"
```

### 6) 查看自动暂停状态

```bash
ssh cheersai@121.41.195.46 "cat /home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json"
```

### 7) 手工恢复已暂停的 watcher

```bash
ssh cheersai@121.41.195.46 "rm -f /home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json"
ssh cheersai@121.41.195.46 "sudo -n systemctl restart 7smile-matchlife-sync"
```

## 十三、当前已知风险

- 阿里云环境当前为临时过渡方案，后续仍需结合备案完成情况规划正式迁移
- 历史环境与过渡环境会并行保留一段时间，运维时需明确区分目标主机与域名
