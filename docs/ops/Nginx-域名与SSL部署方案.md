# MatchLife Nginx 域名与 SSL 部署方案

## 目标

本方案用于明确 MatchLife 在共享域名模式下的 Nginx 接入方式、证书落盘位置，以及 UAT/生产子路径的边界。

## 共享域名原则

- MatchLife 不独占整份 Nginx `server` 配置。
- MatchLife 只能以 location 片段方式接入共享网关。
- UAT 与生产允许使用不同子路径，但同一环境内不得混用构建产物。

## 当前环境矩阵

### UAT

- 域名：`tools.cheersai.cloud`
- 页面入口：`/7smile-matchlife/`
- 静态资源：`/7smile-matchlife/assets/*`
- location 片段：`/etc/nginx/snippets/7smile-matchlife.tools.cheersai.cloud.locations.conf`
- 主配置：`/etc/nginx/conf.d/tools.cheersai.cloud.conf`

### 生产

- 域名：`7smile.dlithink.com`
- 页面入口：`/match-life/`
- 静态资源：`/match-life/assets/*`
- 推荐 location 片段：`/etc/nginx/locations/matchlife-prod.conf`
- 推荐网关入口：`/etc/nginx/sites-available/00-gateway.conf`

## 证书来源

证书材料位于：

- `/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/nginx.pro/certs/7smile.dlithink.com_nginx`
- `/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/nginx.uat`

生产证书建议落盘：

- `/etc/nginx/ssl/7smile.dlithink.com_bundle.pem`
- `/etc/nginx/ssl/7smile.dlithink.com.key`

UAT 通常复用 `tools.cheersai.cloud` 所在主机现有证书，不单独签发 MatchLife 证书。

## location 设计要求

无论 UAT 还是生产，location 片段至少需要覆盖：

- `location = /<app-path>`
- `location ^~ /<app-path>/assets/`
- `location ^~ /<app-path>/api/wechat/`
- `location ^~ /<app-path>/supabase/`
- `location ^~ /<app-path>/`

其中：

- `assets` 负责静态资源直出与缓存
- `api/wechat` 反代到本机 Node 服务
- `supabase` 反代到数据服务
- 根路径使用 SPA `try_files` 回退到对应 `index.html`

## 子路径与构建约束

代码侧已经支持通过 `APP_BASE_PATH` 注入子路径：

- UAT：`APP_BASE_PATH=/7smile-matchlife/`
- 生产：`APP_BASE_PATH=/match-life/`

因此 Nginx 的 location 路径必须与构建时的 `APP_BASE_PATH` 完全一致，否则会出现静态资源 404 或 HTML 引用逃逸。

## 推荐验收项

### UAT

- `http://tools.cheersai.cloud/7smile-matchlife` 会重定向到 `/7smile-matchlife/`
- `https://tools.cheersai.cloud/7smile-matchlife/` 正常打开
- `/7smile-matchlife/assets/*` 返回 200
- `/7smile-matchlife/stats` 刷新不 404

### 生产

- `http://7smile.dlithink.com/match-life` 会重定向到 `/match-life/`
- `https://7smile.dlithink.com/match-life/` 正常打开
- `/match-life/assets/*` 返回 200
- `/match-life/stats` 刷新不 404

## 风险提示

- 不要把 `/match-life/` 的 location 直接挂到 UAT。
- 不要把 `/7smile-matchlife/` 的静态资源目录直接映射到生产。
- 不要为了快速修复而直接改服务器 HTML；应回到仓库改 `APP_BASE_PATH`、发布脚本或 Nginx 片段。

## 关联文档

- 路径矩阵：`部署路径基线.md`
- UAT 运维：`UAT服务器部署与运维手册.md`
- 生产发布：`生产环境发布方案.md`
