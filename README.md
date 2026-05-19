# MatchLife - 七笑果赛事生涯系统

MatchLife 用于汇总公开赛事数据、沉淀选手档案，并提供检索、看板、排行榜和比赛详情等能力。当前版本重点覆盖羽毛球，并已预留网球等多球类扩展能力。

## 页面入口

- `/`：首页检索与最近比赛
- `/stats`：赛事统计看板
- `/leaderboard`：排行榜，可按运动、性别、单双打筛选
- `/matches/:id`：比赛详情页
- `/data-sources`：数据源与选手档案维护
- `/sync`：同步状态与运行监控
- `/guide`：在线使用说明页

## 数据源维护

数据源页按 3 个区域组织：

- `数据源配置`：新增、启停、删除数据源
- `选手档案`：维护选手姓名、俱乐部、教练、头像等资料
- `格式说明`：查看当前已适配 JSON 格式与示例

当前删除选手档案使用临时“数据源密码”保护，默认值为 `7%K$QJ2pWtgw`。这是过渡方案，后续会替换为正式 SSO 权限控制。

## 已适配格式

### 1. MatchLife Source JSON

适合通用数据源配置，至少包含 `name`、`type`、`url`、`format`、`enabled`。

```json
{
  "sources": [
    {
      "name": "七笑果赛事聚合源",
      "type": "api",
      "url": "https://api.example.com/matchlife/source.json",
      "format": "matchlife-source-json",
      "enabled": true
    }
  ]
}
```

### 2. YMQ JSON

适合已适配的 YMQ 赛事页地址，通常将 `type` 设为 `html`。

```json
{
  "sources": [
    {
      "name": "YMQ 北方赛区",
      "type": "html",
      "url": "https://apply.ymq.me/wechat/#/match?game_id=38653",
      "format": "ymq-json",
      "enabled": true
    }
  ]
}
```

### 3. Tennis JSON

适合已适配的网球 JSON 数据源，通常来自稳定接口。

```json
{
  "sources": [
    {
      "name": "全国青少年网球巡回赛",
      "type": "api",
      "url": "https://api.example.com/tennis/tournament-feed.json",
      "format": "tennis-json",
      "enabled": true
    }
  ]
}
```

## 日常操作流程

1. 在 `数据源配置` 中新增或启用数据源。
2. 在 `选手档案` 中补充选手基础信息。
3. 到首页、看板、排行榜确认数据是否正常展示。
4. 如需离线维护，可导入已适配的 JSON 配置或选手档案文件。

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

至少需要：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3. 启动开发环境

```bash
pnpm dev
```

可先执行连通性诊断：

```bash
pnpm diag:supabase
```

## 本地 Docker 发布

仓库提供 `docker-compose.local.yml`，用于本地模拟接近发布态的运行方式：

- `matchlife-web`：静态前端与 `/supabase` 代理
- `wechat-access`：本地访问与辅助接口服务
- `sync-watcher`：后台同步 watcher

启动命令：

```bash
docker compose -f docker-compose.local.yml up --build
```

默认访问地址：

```text
http://localhost:18080/7smile-matchlife/
```

## 数据库与同步

- `matches`：比赛明细
- `players`：选手档案
- `sync_runs`：同步运行记录
- `matchlife_data_sources`：Source Registry 数据源注册中心

数据库变更统一使用 `supabase/migrations/` 下的时间戳 SQL 文件管理。

常用命令：

```bash
supabase migration list
supabase db push
pnpm sync:ymq
pnpm sync:ymq:watch
pnpm sync:orchestrator
```

新增多数据源接入基础能力文档：

- `docs/source-registry-inventory-report.md`
- `docs/source-adapter-protocol.md`
- `docs/source-orchestrator-deployment.md`
- `docs/source-orchestrator-test-report.md`

## 说明

- 若页面运行在 HTTPS 下，请优先通过同源 `/7smile-matchlife/supabase/*` 或 `/supabase` 代理访问 PostgREST。
- 历史环境与自建 PostgREST 仍保留兼容链路，当前对外主入口为 `https://tools.cheersai.cloud/7smile-matchlife/`。
