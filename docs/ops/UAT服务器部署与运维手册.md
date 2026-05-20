# MatchLife UAT 服务器部署与运维手册

## 目标

本手册用于沉淀 MatchLife 当前 UAT 环境的正式部署口径，避免后续再次依赖仓外文档、临时聊天记录或远端热修知识。

## 当前 UAT 基线

- 服务器：`121.41.195.46`
- SSH 登录用户：`cheersai`
- 应用运行用户：`sevensmile`
- 对外入口：`https://tools.cheersai.cloud/7smile-matchlife/`
- 应用路径：`/7smile-matchlife/`
- 静态资源前缀：`/7smile-matchlife/assets/*`
- 微信入口：`/7smile-matchlife/api/wechat/*`
- 数据代理：`/7smile-matchlife/supabase/*`

## 远端目录

- staging：`/home/cheersai/release/staging/7smile-matchlife`
- 站点目录：`/home/sevensmile/apps/7smile-matchlife/current`
- sync runtime：`/home/sevensmile/release/runtime/7smile-matchlife-sync`
- Nginx 主配置：`/etc/nginx/conf.d/tools.cheersai.cloud.conf`
- MatchLife location 片段：`/etc/nginx/snippets/7smile-matchlife.tools.cheersai.cloud.locations.conf`

## 发布链入口

- UAT shell 权威入口统一为 `TECH_SCRIPT_DIR=/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat`。
- 仓库内 `scripts/matchlife-uat/*.sh` 仅保留兼容转发层；运行时 `.mjs` 资产仍留在源码仓库。

```bash
TECH_SCRIPT_DIR="/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat"
```

- 环境检查：`bash "$TECH_SCRIPT_DIR/check-env.sh"`
- 本地构建：`APP_BASE_PATH=/7smile-matchlife/ bash "$TECH_SCRIPT_DIR/01-build.sh"`
- 推送 staging：`bash "$TECH_SCRIPT_DIR/02-push.sh"`
- 远端发布：`bash "$TECH_SCRIPT_DIR/03-release.sh"`
- 验收巡检：`bash "$TECH_SCRIPT_DIR/04-monitor.sh"`
- 一键执行：`bash "$TECH_SCRIPT_DIR/00-deploy-all.sh"`

## 当前运维约束

- UAT 只允许发布 `/7smile-matchlife/` 构建产物。
- 生产仍可合法使用 `/match-life/`，但不得把该路径的构建产物混发到 UAT。
- 任何路径相关修改都必须先改本地正式工程，再走标准发布链，禁止只在服务器热修。
- 发布前后都需要执行路径校验，防止 `dist/index.html` 与远端 `current/index.html` 的资源前缀不一致。

## 已固化的保护

### 1. 构建与推送前校验

`$TECH_SCRIPT_DIR/02-push.sh` 会在上传前检查 `dist/index.html`：

- 提取 HTML 中所有根路径 `src` 与 `href`
- 确认资源路径都落在 `${APP_BASE_PATH}assets/`
- 发现 `/match-life/assets/*` 等错误前缀时立即终止推送

### 2. 远端落地后二次校验

`$TECH_SCRIPT_DIR/deploy-matchlife.sh` 会在覆盖远端站点目录后再次检查：

- 读取 `current/index.html`
- 校验所有根路径静态资源都位于 `${APP_PATH}/assets/`
- 若远端仍残留旧路径产物，则直接中止发布

### 3. watcher 日志节流

`scripts/watch-ymq.mjs` 已改为：

- 输出单行摘要而不是完整大对象
- 仅在状态变化、实际写入、异常或超过最小间隔时打印
- 通过 `MATCHLIFE_LOG_MIN_INTERVAL_MS` 控制无增量时的最低输出频率

## 同步守护进程

- 服务名：`7smile-matchlife-sync.service`
- 心跳文件：`/home/sevensmile/release/runtime/7smile-matchlife-sync/heartbeat.json`
- 状态文件：`/home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json`
- 日志查看：`sudo -n journalctl -u 7smile-matchlife-sync -n 80 --no-pager`

常用恢复命令：

```bash
ssh cheersai@121.41.195.46 \
  "rm -f /home/sevensmile/release/runtime/7smile-matchlife-sync/sync-state.json \
  && sudo -n systemctl restart 7smile-matchlife-sync"
```

## 发布后的标准验收

```bash
bash "$TECH_SCRIPT_DIR/04-monitor.sh"
```

应至少确认：

- `https://tools.cheersai.cloud/7smile-matchlife/` 返回 200
- 页面 HTML 中的 CSS、JS、图标都引用 `/7smile-matchlife/` 前缀
- `7smile-matchlife-sync.service` 为 `active`
- `heartbeat.json` 持续刷新
- 巡检输出不再出现 `asset path escaped app base`

## 故障排查顺序

1. 先检查本地 `dist/index.html` 是否已使用 `/7smile-matchlife/assets/*`
2. 再检查 `APP_BASE_PATH` 是否仍为 `/7smile-matchlife/`
3. 再检查远端 `current/index.html` 是否残留旧路径内容
4. 最后查看 `04-monitor.sh` 中的 `APP_PATH` 与线上环境是否一致

## 历史环境说明

- `175.178.236.183 + https://7smile.dlithink.com/match-life/` 仍作为生产历史链路保留
- UAT 文档只负责描述 `tools.cheersai.cloud/7smile-matchlife/` 当前基线
- 生产链路请参考同目录下的 `生产环境发布方案.md` 与 `Nginx-域名与SSL部署方案.md`
