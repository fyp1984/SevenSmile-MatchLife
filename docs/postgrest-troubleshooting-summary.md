# PostgREST 排行榜问题排查总结

## 📊 问题描述

**错误信息**：
```
Could not find the function public.get_player_rankings(page_limit, page_offset, sport_type) in the schema cache
```

**影响范围**：
- ❌ 排行榜页面无法加载：https://tools.cheersai.cloud/7smile-matchlife/leaderboard
- ✅ 其他页面正常工作

---

## 🔍 已完成的排查工作

### 1. SSH 免密登录配置 ✅

**本地 → UAT 服务器 (121.41.195.46)**：
```bash
ssh cheersai@121.41.195.46  # 已配置完成
```

**本地 → PostgREST 服务器 (175.178.236.183)**：
```bash
ssh sevensmile@175.178.236.183  # 已配置完成
```

### 2. 数据库角色和权限 ✅

已在 `postgres` 数据库中创建：
- ✅ `anon` 角色
- ✅ `authenticated` 角色
- ✅ `authenticator` 角色
- ✅ 所有角色都有 `EXECUTE` 权限

验证结果：
```sql
SELECT has_function_privilege('authenticator', 'public.get_player_rankings(integer, integer, text)', 'EXECUTE');
-- 返回：t (true)
```

### 3. PostgREST 配置修改 ✅

**配置文件位置**：`/etc/postgrest/matchlife.conf`

**已修改的配置**：
```ini
# 修改前（错误）
db-uri = "postgres://authenticator:...@127.0.0.1:5432/matchlife_supabase"

# 修改后（正确）
db-uri = "postgres://authenticator:...@127.0.0.1:5432/postgres"

# 新增配置
db-channel-enabled = true
db-channel = "pgrst"
```

### 4. PostgREST 服务状态 ⚠️

**服务运行正常**：
```bash
● postgrest-matchlife.service - PostgREST MatchLife Self Hosted
     Active: active (running)
```

**但 Schema Cache 为空**：
```
Schema cache loaded 0 Relations, 0 Relationships, 0 Functions
```

---

## 🎯 问题根源分析

根据深入排查，发现以下关键问题：

### 问题 1: 数据库不存在
PostgREST 原本配置连接到 `matchlife_supabase` 数据库，但该数据库不存在：
```bash
psql: error: database "matchlife_supabase" does not exist
```

### 问题 2: Schema Cache 为空
修改为连接 `postgres` 数据库后，PostgREST 可以连接，但 Schema Cache 中没有加载任何函数。

### 问题 3: 可能的原因

根据 PostgREST 文档和测试结果，Schema Cache 为空可能是因为：

1. **`db-schemas` 配置问题**：
   - 当前配置：`db-schemas = "public"`
   - PostgREST 可能无法正确识别 `public` schema 中的函数

2. **函数定义问题**：
   - 函数使用了 `SECURITY INVOKER`（默认）
   - 函数依赖的视图 `mv_player_rankings` 可能不存在或权限不足

3. **PostgREST 版本问题**：
   - 当前版本：PostgREST 14.10
   - 可能存在已知的 bug 或配置问题

---

## 🔧 建议的解决方案

### 方案 1: 检查依赖的视图是否存在

```bash
ssh cheersai@121.41.195.46 "sudo -u postgres psql -d postgres -c \"SELECT schemaname, matviewname FROM pg_matviews WHERE matviewname = 'mv_player_rankings';\""
```

如果视图不存在，需要创建：
```sql
-- 创建物化视图
CREATE MATERIALIZED VIEW mv_player_rankings AS
SELECT 
  player_id,
  player_name,
  avatar_url,
  COUNT(*) as total_matches,
  SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
  ROUND(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 1) as win_rate,
  MAX(match_date) as last_active,
  primary_sport
FROM matches
GROUP BY player_id, player_name, avatar_url, primary_sport;

-- 授予权限
GRANT SELECT ON mv_player_rankings TO anon;
GRANT SELECT ON mv_player_rankings TO authenticated;
GRANT SELECT ON mv_player_rankings TO authenticator;

-- 刷新 PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
```

### 方案 2: 修改 PostgREST 配置

尝试修改 `db-schemas` 配置：

```bash
ssh sevensmile@175.178.236.183 "sudo sed -i 's/db-schemas = \"public\"/db-schemas = \"public,pg_catalog\"/g' /etc/postgrest/matchlife.conf && sudo systemctl restart postgrest-matchlife.service"
```

### 方案 3: 使用 PostgREST Admin API 检查

```bash
curl -s 'http://175.178.236.183:8000/' -H 'Accept: application/openapi+json' | jq '.paths' | grep -i player
```

### 方案 4: 检查 PostgREST 日志

```bash
ssh sevensmile@175.178.236.183 "sudo journalctl -u postgrest-matchlife.service -n 100 --no-pager | grep -E 'error|warning|schema|function'"
```

---

## 📋 下一步操作清单

请按照以下顺序执行：

### 步骤 1: 检查依赖的视图
```bash
ssh cheersai@121.41.195.46 "sudo -u postgres psql -d postgres -c \"\\d+ mv_player_rankings\""
```

### 步骤 2: 如果视图不存在，创建视图
参考上面的 SQL 脚本创建 `mv_player_rankings` 视图。

### 步骤 3: 重启 PostgREST 并验证
```bash
ssh sevensmile@175.178.236.183 "sudo systemctl restart postgrest-matchlife.service && sleep 5 && sudo journalctl -u postgrest-matchlife.service -n 20 --no-pager | grep 'Schema cache'"
```

### 步骤 4: 测试 RPC 函数
```bash
curl -s 'http://175.178.236.183:8000/rest/v1/rpc/get_player_rankings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY' \
  -d '{"page_limit": 5, "page_offset": 0, "sport_type": "badminton"}'
```

### 步骤 5: 验证排行榜页面
访问：https://tools.cheersai.cloud/7smile-matchlife/leaderboard

---

## 📞 需要帮助？

如果以上步骤仍然无法解决问题，请提供以下信息：

1. **视图检查结果**：
   ```bash
   ssh cheersai@121.41.195.46 "sudo -u postgres psql -d postgres -c \"\\d+ mv_player_rankings\""
   ```

2. **PostgREST 完整日志**：
   ```bash
   ssh sevensmile@175.178.236.183 "sudo journalctl -u postgrest-matchlife.service -n 100 --no-pager"
   ```

3. **数据库中的所有函数**：
   ```bash
   ssh cheersai@121.41.195.46 "sudo -u postgres psql -d postgres -c \"SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = 'public';\""
   ```

---

## 🎉 已完成的工作总结

### ✅ 选手生涯页文字颜色修复
- 总胜率 "42.9%"：白色背景 + rgb(241, 77, 59) 文字
- "1胜" 文字：白色背景 + rgb(241, 77, 59) 文字
- 已成功部署至 UAT 环境

### ✅ SSH 免密登录配置
- 本地 → UAT 服务器：已配置完成
- 本地 → PostgREST 服务器：已配置完成

### ✅ PostgREST 基础配置
- 数据库连接已修复：从 `matchlife_supabase` 改为 `postgres`
- Schema cache 自动重载已启用：`db-channel-enabled = true`
- 数据库角色和权限已配置

### ⚠️ 待解决问题
- PostgREST Schema Cache 为空（0 Functions）
- 需要检查依赖的视图 `mv_player_rankings` 是否存在

---

**最后更新时间**：2026-04-24 11:20 CST
