# MatchLife - 七笑果赛事生涯系统

**MatchLife** 是一个专注记录运动员比赛生涯成绩的轻量系统：以“搜索”为核心，聚焦「快速检索 + 生涯沉淀 + 统计看板」。当前版本从羽毛球 **U 系列** 数据起步，并通过自动化抓取/同步入库，提供免登录查询体验。

## 已实现能力

- **全局检索**：在首页通过关键词模糊搜索赛事/场地/选手/比分/组别/项目等信息。
- **近期比赛**：未输入关键字时展示最近收录的比赛记录。
- **自动刷新**：输入关键字后支持 5 秒自动刷新检索结果（用于跟踪进行中的比赛）。
- **赛事统计看板**：汇总比赛总量、参赛人数、赛事覆盖、已完赛数量；并提供按项目/组别切换的胜场榜与胜率。
- **同步监控**：展示最近 10 次同步运行记录（成功/失败、拉取条数、入库条数、错误信息）。
- **关注校验（弱）**：非本机环境需要在微信内完成关注验证，未关注用户会被引导关注后再进入。

## 页面入口

- `/`：首页（搜索 + 近期比赛 + 同步状态摘要）
- `/stats`：统计看板
- `/sync`：同步状态与手动触发同步（本地支持 `/api/*`，线上建议走 Supabase Edge Function）
- `/gate/wechat`：微信关注验证入口（通常无需手动访问）
- `/follow`：未关注引导页

## 技术栈

- 前端：React 18 + TypeScript + Vite + React Router
- UI：TailwindCSS + Lucide Icons
- 数据：Supabase（Postgres + RPC）
- 同步：
  - 本地：Vite dev server 内置 `/api/sync`、`/api/reset`（需要 `SUPABASE_SERVICE_ROLE_KEY`）
  - 线上：Supabase Edge Function `sync-ymq`（需要在 Supabase 中配置环境变量）
- 访问控制（弱校验）：Vercel Serverless Functions `/api/wechat/*`（OAuth + subscribe 校验）

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

### 2) 配置环境变量

拷贝示例文件并填写：

```bash
cp .env.example .env.local
```

需要的变量：

- `VITE_SUPABASE_URL`：Supabase Project URL
- `VITE_SUPABASE_ANON_KEY`：Supabase anon key（前端使用）
- `SUPABASE_SERVICE_ROLE_KEY`：仅本地调试/重建/手动同步需要（不要提交到 Git）

### 3) 启动开发环境

```bash
pnpm dev
```

若本机存在代理（例如 `127.0.0.1:8118`），建议先绕过代理再启动：

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY pnpm dev
```

可先执行连通性诊断：

```bash
pnpm diag:supabase
```

## 数据库与同步说明

### Supabase 数据结构

- `matches`：比赛明细（包含 `players_a/players_b`、`score_text`、`winner_side`、`event_key` 等）
- `sync_runs`：同步运行记录（成功/失败、拉取条数、入库条数、错误信息等）

数据库迁移 SQL 位于 `supabase/migrations/`，现已统一为 Supabase CLI 标准时间戳命名：

```text
<timestamp>_<name>.sql
```

推荐使用以下流程管理数据库变更：

```bash
supabase migration list
supabase db push
```

如需新增迁移，请继续沿用标准时间戳文件名，不要再使用无时间戳的 SQL 文件名，以避免后续 `supabase db push` 无法识别。

### 线上同步（推荐）

部署 `supabase/functions/sync-ymq` 后，通过页面 `/sync` 或直接调用 Edge Function 触发同步：

- 函数名：`sync-ymq`
- 依赖环境变量：`SUPABASE_URL`/`PROJECT_URL`、`SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE_KEY`

### 本地同步（仅开发调试）

开发服务器内置了本地 API：

- `POST /api/sync?mode=full|fast`：触发同步
- `POST /api/reset`：清空并重建（危险操作，仅本地）
- `GET /api/health`：检查本地是否已配置 `SUPABASE_SERVICE_ROLE_KEY`

另外也可以使用脚本：

```bash
pnpm sync:ymq
pnpm sync:ymq:watch
pnpm reset:db
```

## 部署

当前仓库包含 `vercel.json`，可直接部署静态站点（输出目录 `dist`）。

- 线上手动同步依赖 Supabase Edge Function。
- 线上微信关注校验依赖 Vercel Serverless Functions（`/api/wechat/oauth-start`、`/api/wechat/oauth-callback`）。

### 微信关注校验（弱校验）上线配置

需要在 Vercel Project → Environment Variables 中配置：

- `WECHAT_MP_APPID`
- `WECHAT_MP_SECRET`

并在公众号后台配置「网页授权域名」为你的线上域名（例如 Vercel 的 Production Domain，不要带 `https://`）。

### GitHub Pages（不依赖 Vercel）

仓库已内置 GitHub Pages 的自动部署工作流（推送 `main` 后自动构建并发布）。

需要在 GitHub 仓库的 Secrets 中配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

然后在仓库 Settings → Pages 中将 Source 设为 GitHub Actions。

### 国内自建（推荐）

该项目是纯静态前端（Vite 构建产物在 `dist/`），可部署到任意国内服务器/CDN：

- 方案 A：腾讯云 COS / 阿里云 OSS / 七牛云 等对象存储 + CDN
  - 上传 `dist/` 全量文件
  - 默认首页：`index.html`
  - SPA 路由：配置“404 回源到 `index.html`”或等价的重写规则
- 方案 B：Nginx 静态托管
  - `try_files $uri $uri/ /index.html;` 以支持前端路由

## 安全提示

- 不要将 `SUPABASE_SERVICE_ROLE_KEY` 写入可提交文件（请使用 `.env.local`）。
- `/sync` 页面在非本机环境使用口令保护逻辑，口令配置位于 `src/pages/AccessGate.tsx`，建议上线前替换为七笑果 SSO 或从环境变量注入。
