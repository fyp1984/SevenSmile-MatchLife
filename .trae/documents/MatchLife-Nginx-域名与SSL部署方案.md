# MatchLife 域名与 SSL 部署方案

## 目标

- 启用共享域名：`7smile.dlithink.com`
- 当前应用挂载为子路径：`/match-life`
- 与同域其他应用共存，避免单应用独占 `server` 配置
- 复用现有 SSL 证书

## 推荐架构

### 域名层

- 对外入口：`https://7smile.dlithink.com/match-life/`
- 共享域名网关负责：
  - 80 -> 443 跳转
  - SSL 终止
  - `include /etc/nginx/locations/*.conf` 统一纳管不同子应用

### 应用层

- MatchLife 静态资源发布目录：
  - `/var/www/7smile.dlithink.com/match-life`
- MatchLife 只提供一个 location 片段：
  - `location = /match-life`
  - `location ^~ /match-life/assets/`
  - `location ^~ /match-life/`

这样不会覆盖网关主 `server`，更适合多应用共享域名。

## 证书文件

证书源目录：

- `/Users/FYP/Documents/WorkSpace/CheersAI/CheersAI - docs/技术/nginx.pro/certs/7smile.dlithink.com_nginx`

建议落盘到服务器：

- `/etc/nginx/ssl/7smile.dlithink.com_bundle.pem`
- `/etc/nginx/ssl/7smile.dlithink.com.key`

## 代码层改造（已完成）

为支持子路径部署，前端已完成：

- Vite `base` 支持由 `APP_BASE_PATH` 注入
- React Router 使用 `basename={import.meta.env.BASE_URL}`
- 发布脚本默认构建为 `/match-life/`

## 需要部署的 Nginx 配置

### 1) 网关 server（若服务器尚未存在该域名入口）

可参考：

- `scripts/matchlife-uat/nginx/7smile.dlithink.com.gateway.conf.example`

### 2) MatchLife 子应用 location

可参考：

- `scripts/matchlife-uat/nginx/match-life.location.conf.tpl`

建议最终路径：

- `/etc/nginx/locations/match-life.conf`

## 发布脚本（已改造）

默认发布参数：

- `DOMAIN_NAME=7smile.dlithink.com`
- `APP_BASE_PATH=/match-life/`
- `APP_PATH=/match-life`
- `REMOTE_WWW_DIR=/var/www/7smile.dlithink.com/match-life`

执行入口：

```bash
bash scripts/matchlife-uat/00-deploy-all.sh
```

## 服务器操作步骤

1. 上传证书到 `/etc/nginx/ssl/`
2. 创建或更新网关 server
3. 放置 MatchLife location 配置到 `/etc/nginx/locations/match-life.conf`
4. 运行发布脚本，将静态产物落盘到 `/var/www/7smile.dlithink.com/match-life`
5. `nginx -t && systemctl reload nginx`

## 验收项

- `http://7smile.dlithink.com/match-life` 会 301 到 `/match-life/`
- `https://7smile.dlithink.com/match-life/` 可正常打开首页
- `/match-life/assets/*` 静态资源返回 200
- 前端刷新子路由（如 `/match-life/stats`）不会 404
