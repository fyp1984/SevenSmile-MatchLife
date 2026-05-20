# MatchLife Ops Docs

本目录汇总 MatchLife 与部署、发布、路径基线、运维变更相关的仓内文档，作为仓内工程上下文与历史修复说明的可见事实源。

当前优先阅读顺序：

1. `部署路径基线.md`
2. `2026-05-20-UAT路径与日志修复说明.md`
3. `UAT服务器部署与运维手册.md`
4. `本地Docker与UAT一致性方案.md`
5. `生产环境发布方案.md`
6. `Nginx-域名与SSL部署方案.md`
7. `../postgrest-troubleshooting-summary.md`

说明：

- UAT 当前入口：`https://tools.cheersai.cloud/7smile-matchlife/`
- UAT 静态资源前缀：`/7smile-matchlife/assets/`
- 生产目标入口：`https://7smile.dlithink.com/match-life/`
- 生产静态资源前缀：`/match-life/assets/`
- UAT shell 权威入口统一为 `TECH_SCRIPT_DIR=/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat`
- 仓库内 `scripts/matchlife-uat/*.sh` 仅保留兼容转发层
- 仓库内 `scripts/matchlife-uat/*.mjs` 仍为运行时源码资产路径
- 本目录负责沉淀仓内工程上下文与排障记录，不替代技术目录中的 shell 运维权威入口

规则：

- UAT 与生产允许使用不同子路径，但同一环境内不得混用基路径产物。
- `$TECH_SCRIPT_DIR/02-push.sh` 会在上传前校验 `dist/index.html` 的资源前缀。
- `$TECH_SCRIPT_DIR/deploy-matchlife.sh` 会在远端落地后再次校验 `current/index.html` 的资源前缀。
- 若校验失败，发布应直接中止，而不是继续把错误构建上线。
- 涉及路径、代理、Cookie、同步和微信入口的修改，必须先在本地正式仓完成并经过本地 Docker 或标准发布链验证。
