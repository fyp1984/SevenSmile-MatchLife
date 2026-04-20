# MatchLife 方案A：数据抓取与自动更新机制（自适应同步 + Realtime 推送）

## 目标

- 让用户尽可能“接近实时”看到最新比分与比赛状态
- 控制服务器与网络开销，避免全量高频拉取与前端高频全表查询
- 保持现有数据模型与同步链路可回滚、可观测

## 总体架构（端到端）

1. 数据源（YMQ）提供 HTTP 接口：场地列表 + 场次/比分列表
2. 同步进程以“自适应策略”拉取变化：低频发现 + 高频活跃
3. 以 `raw_hash` 作为变更检测，仅对变化记录执行 UPDATE/INSERT
4. 数据入库后：
   - 前端通过 Supabase Realtime（Postgres Changes）订阅 `matches/sync_runs` 的变更
   - 一旦有变更，页面立即刷新（并保留轮询兜底，保证在 Realtime 未启用时仍可用）

## 同步策略（自适应：发现低频 + 活跃高频）

### 1) 发现（Discovery）

- 周期：默认 30s（可配置）
- 行为：对所有场地只抓“第 1 页”（fast）
- 目的：
  - 发现新开赛/新场次
  - 探测哪些场地存在“未结束比赛”

### 2) 活跃（Active）

- 触发条件：在某个场地页中发现 `scoreStatusNo != 2`（未完赛）
- 周期：默认 1.5s（可配置）
- 行为：仅抓“活跃场地集合”，且最多抓到 `ACTIVE_PAGES`（默认 2 页）
- 退出条件：某个场地连续 `ACTIVE_IDLE_MS`（默认 60s）未再发现活跃比赛，则从活跃集合移除

### 3) 空闲兜底（Idle Fast）

- 当活跃集合为空时：默认每 10s 再跑一次 fast（用于保持低频跟踪）

### 关键配置项（环境变量）

- `MATCHLIFE_DISCOVERY_INTERVAL_MS`（默认 30000）
- `MATCHLIFE_ACTIVE_INTERVAL_MS`（默认 1500）
- `MATCHLIFE_IDLE_FAST_INTERVAL_MS`（默认 10000）
- `MATCHLIFE_ACTIVE_IDLE_MS`（默认 60000）
- `MATCHLIFE_ACTIVE_PAGES`（默认 2）

## 入库策略（只写变化）

### 变更检测

- 对每条源记录计算 `raw_hash = sha1(JSON.stringify(row))`
- RPC：`upsert_matches_if_changed(records jsonb)`
  - `ON CONFLICT (ymq_match_id)` 时，仅在 `raw_hash` 变化时执行 UPDATE

### 运行记录（sync_runs）

- 每次同步都会写入 `sync_runs`，并带上：
  - `mode`：fast/full
  - `kind`：discovery/active/idle_fast/manual_full/manual_fast 等
  - `hotCourts`：本次发现的活跃场地数量
  - `courts/pages`：本次抓取范围
- 同时做清理，仅保留最近 5 条记录，防止表膨胀

## 前端展示策略（Realtime 推送 + 轮询兜底）

### 首页检索（成绩检索页）

- 开启“自动刷新”后：
  - 订阅 `matches` 的变更事件，一旦有更新（INSERT/UPDATE/DELETE）即触发检索刷新（300ms 去抖）
  - 同时保留每 5s 轮询兜底，避免 Realtime 未启用时无法自动更新

### 数据状态页（/sync）

- 订阅 `sync_runs` 的 INSERT：
  - 后台写入同步记录后，页面自动刷新列表
  - 解析 `error_message` 中的 `kind/hotCourts/pages` 等信息用于可视化展示

### 看板页（/stats）

- 订阅 `matches` 变更，但仅在比赛从“未完赛”变为“完赛”（`winner_side` 变化为 A/B）时触发刷新，避免比分每次更新都全量重算

## 数据字段补充：比赛开始/结束时间

- 新增字段：
  - `match_started_at`：来自 `scoreStartTime`
  - `match_ended_at`：来自 `scoreEndTime`
- 用于前端在“进行中比赛”展示：日期、开始时间、结束时间（缺失则置空）

## 运维与本地运行

### 本地启动（前端 + 本地 API）

- `pnpm dev`

### 本地持续同步（推荐）

- `pnpm sync:ymq:watch`
- 可按需覆盖环境变量调参

### 数据库迁移（需要在 Supabase SQL Editor 执行）

- `matchlife_match_round.sql`：新增 `round_name` 并更新 RPC
- `matchlife_match_times.sql`：新增 `match_started_at/match_ended_at` 并更新 RPC
- `matchlife_search_trgm.sql`：为模糊搜索（ilike %keyword%）增加 trigram 索引，降低 statement timeout 风险

## 风险与边界

- 若 Supabase 未启用 Realtime（Postgres Changes/Replication），前端会回退到 5s 轮询兜底，功能仍可用但体验下降
- 活跃高频同步会增加写入次数，应优先保证“只写变化”与 “sync_runs 保留 5 条”策略生效
