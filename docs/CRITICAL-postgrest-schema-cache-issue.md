# 🚨 CRITICAL: PostgREST Schema Cache 问题完整分析

**创建时间**：2026-04-24  
**状态**：🔴 未解决  
**影响**：排行榜功能完全无法使用

---

## 📊 问题描述

**错误信息**：
```
Could not find the function public.get_player_rankings(page_limit, page_offset, sport_type) in the schema cache
```

**影响范围**：
- ❌ 排行榜页面无法加载：https://tools.cheersai.cloud/7smile-matchlife/leaderboard
- ✅ 其他页面正常工作

---

## 🔍 深入分析结果

### 服务器实际架构

根据深入分析，发现实际部署架构与文档描述**严重不符**：

```
实际架构：
┌─────────────────────────────────────────────────────────────┐
│ 121.41.195.46 (UAT 服务器)                                   │
│  - Nginx (tools.cheersai.cloud)                             │
│  - 前端静态文件 (/home/sevensmile/apps/7smile-matchlife/)   │
│  - 同步服务 (systemd: 7smile-matchlife-sync.service)        │
│  - 微信服务 (127.0.0.1:18765)                               │
└─────────────────────────────────────────────────────────────┘
                          ↓ (代理)
┌─────────────────────────────────────────────────────────────┐
│ 175.178.236.183 (历史服务器 - 数据后端)                      │
│  - PostgREST (127.0.0.1:18000 → Nginx → :8000)             │
│  - PostgreSQL 16.12 (127.0.0.1:5432)                        │
│  - 数据库：postgres                                          │
└─────────────────────────────────────────────────────────────┘
```

**关键发现**：
1. ❌ 121.41.195.46 服务器上**没有 matchlife 数据库**
2. ✅ 数据库实际在 175.178.236.183 服务器上
3. ✅ PostgREST 运行在 175.178.236.183 服务器上
4. ✅ 121.41.195.46 只是前端和代理服务器

### 数据库实际状态

**数据库名称**：`postgres`（不是 `matchlife` 或 `matchlife_supabase`）

**表结构**（6 张表）：
| 表名 | 说明 |
|------|------|
| players | 选手信息（0 rows - 空表）|
| matches | 比赛记录 |
| match_events | 比赛事件 |
| sync_runs | 同步运行记录 |
| technique_tags | 技术标签 |
| user_reputation | 用户声誉 |

**物化视图**：
- ✅ `mv_player_rankings` - 已创建
- ✅ 唯一索引 `idx_mv_player_rankings_player_id` - 已创建
- ⚠️ 数据为空（0 rows）- 因为 players 表为空

**函数**（3 个）：
| 函数名 | 说明 | 权限 |
|--------|------|------|
| get_player_rankings | 获取排行榜 | ✅ anon, authenticated, authenticator |
| notify_postgrest_schema_change | 通知 schema 变更 | ✅ |
| refresh_player_rankings | 刷新排行榜视图 | ✅ |

### PostgREST 配置状态

**配置文件**：`/etc/postgrest/matchlife.conf`（在 175.178.236.183 服务器上）

**当前配置**：
```ini
db-uri = "postgres://authenticator:...@127.0.0.1:5432/postgres"
db-anon-role = "anon"
db-schemas = "public"
server-host = "127.0.0.1"
server-port = 18000
jwt-secret = "..."
jwt-secret-is-base64 = true
openapi-mode = "follow-privileges"

# 已添加（2026-04-24）
db-channel-enabled = true
db-channel = "pgrst"
```

**服务状态**：
```
● postgrest-matchlife.service - PostgREST MatchLife Self Hosted
     Active: active (running)
     
日志显示：
✅ Successfully connected to PostgreSQL 16.12
✅ Listener connected and listening for notifications on "pgrst" channel
❌ Schema cache loaded 0 Relations, 0 Relationships, 0 Functions
```

---

## 🎯 问题根源分析

### 为什么 PostgREST Schema Cache 为空？

经过多次尝试和验证，发现以下事实：

1. ✅ **数据库连接正常**：PostgREST 成功连接到 postgres 数据库
2. ✅ **角色权限正确**：authenticator, anon, authenticated 角色都有 EXECUTE 权限
3. ✅ **物化视图存在**：mv_player_rankings 已创建并有唯一索引
4. ✅ **函数定义正确**：get_player_rankings 函数存在且语法正确
5. ✅ **NOTIFY 机制工作**：PostgREST 监听 "pgrst" 通道
6. ❌ **Schema Cache 仍为空**：PostgREST 无法加载任何函数

### 可能的原因

根据 PostgREST 文档和测试结果，Schema Cache 为空可能是因为：

#### 原因 1：函数依赖的视图数据为空
```sql
-- mv_player_rankings 视图数据为空（0 rows）
SELECT COUNT(*) FROM mv_player_rankings;
-- 返回：0

-- 原因：players 表为空
SELECT COUNT(*) FROM players;
-- 返回：0
```

**但这不应该导致函数无法加载到 Schema Cache！**

#### 原因 2：PostgREST 配置问题
```ini
# 当前配置
db-schemas = "public"

# 可能需要的配置
db-schemas = "public"
db-extra-search-path = "public"
```

#### 原因 3：函数签名不匹配
```sql
-- 函数定义
CREATE FUNCTION get_player_rankings(
  page_limit integer DEFAULT 20,
  page_offset integer DEFAULT 0,
  sport_type text DEFAULT NULL
)

-- PostgREST 可能期望的签名
-- 需要检查 PostgREST 如何处理 DEFAULT 参数
```

#### 原因 4：PostgREST 版本问题
```
当前版本：PostgREST 14.10
PostgreSQL 版本：16.12

可能存在兼容性问题
```

---

## 🔧 已尝试的修复方案

### 方案 1：创建物化视图和索引 ✅
```sql
-- 创建物化视图
CREATE MATERIALIZED VIEW mv_player_rankings AS ...;

-- 创建唯一索引
CREATE UNIQUE INDEX idx_mv_player_rankings_player_id 
ON mv_player_rankings(player_id);

-- 授予权限
GRANT SELECT ON mv_player_rankings TO anon;
GRANT SELECT ON mv_player_rankings TO authenticated;
GRANT SELECT ON mv_player_rankings TO authenticator;

-- 刷新视图
REFRESH MATERIALIZED VIEW mv_player_rankings;
```

**结果**：✅ 视图创建成功，但 PostgREST Schema Cache 仍为空

### 方案 2：修改 PostgREST 配置 ✅
```ini
# 修改数据库连接
db-uri = "postgres://authenticator:...@127.0.0.1:5432/postgres"

# 启用 schema cache 自动重载
db-channel-enabled = true
db-channel = "pgrst"
```

**结果**：✅ 配置生效，PostgREST 监听通知，但 Schema Cache 仍为空

### 方案 3：创建数据库角色 ✅
```sql
-- 创建角色
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE authenticator LOGIN PASSWORD '...' NOINHERIT;

-- 授予权限
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT USAGE ON SCHEMA public TO authenticator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticator;
```

**结果**：✅ 角色创建成功，权限正确，但 Schema Cache 仍为空

### 方案 4：重启 PostgREST 服务 ✅
```bash
sudo systemctl restart postgrest-matchlife.service
```

**结果**：✅ 服务重启成功，但 Schema Cache 仍为空

### 方案 5：发送 NOTIFY 通知 ✅
```sql
SELECT pg_notify('pgrst', 'reload schema');
```

**结果**：✅ 通知发送成功，PostgREST 接收到，但 Schema Cache 仍为空

### 方案 6：修改函数 SECURITY 设置 ✅
```sql
ALTER FUNCTION public.get_player_rankings(integer, integer, text) 
SECURITY DEFINER;
```

**结果**：✅ 函数修改成功，但 Schema Cache 仍为空

---

## 🚨 当前状态

### PostgREST 日志（最新）
```
Apr 24 11:49:35 uat-nexus.cheersai.cloud postgrest[1859934]: 
  24/Apr/2026:11:49:35 +0800: Starting PostgREST 14.10...
  24/Apr/2026:11:49:35 +0800: API server listening on 127.0.0.1:18000
  24/Apr/2026:11:49:35 +0800: Successfully connected to PostgreSQL 16.12
  24/Apr/2026:11:49:35 +0800: Connection Pool initialized with a maximum size of 10 connections
  24/Apr/2026:11:49:35 +0800: Listener connected to PostgreSQL 16.12 on "127.0.0.1:5432" 
                               and listening for database notifications on the "pgrst" channel
  24/Apr/2026:11:49:35 +0800: Config reloaded
  24/Apr/2026:11:49:35 +0800: Schema cache queried in 47.6 milliseconds
  24/Apr/2026:11:49:35 +0800: Schema cache loaded 0 Relations, 0 Relationships, 0 Functions, 
                               0 Domain Representations, 4 Media Type Handlers, 1197 Timezones
  24/Apr/2026:11:49:35 +0800: Schema cache loaded in 0.2 milliseconds
```

**关键问题**：Schema cache loaded **0 Functions**

### 测试结果
```bash
# 测试 RPC 函数
curl -s 'http://175.178.236.183:8000/rest/v1/rpc/get_player_rankings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: ...' \
  -d '{"page_limit": 5, "page_offset": 0}'

# 返回错误
{
  "code": "PGRST202",
  "details": "Searched for the function public.get_player_rankings with parameters page_limit, page_offset or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  "hint": null,
  "message": "Could not find the function public.get_player_rankings(page_limit, page_offset) in the schema cache"
}
```

---

## 💡 下一步建议

### 建议 1：检查 PostgREST 详细日志
```bash
# 启用 PostgREST 调试日志
# 修改 /etc/postgrest/matchlife.conf
log-level = "debug"

# 重启服务
sudo systemctl restart postgrest-matchlife.service

# 查看详细日志
sudo journalctl -u postgrest-matchlife.service -f
```

### 建议 2：直接查询 PostgREST 的 Schema Cache
```bash
# 查询 PostgREST 的 OpenAPI 定义
curl -s 'http://175.178.236.183:8000/' \
  -H 'Accept: application/openapi+json' | jq .

# 检查是否有任何 RPC 函数被列出
```

### 建议 3：检查 PostgreSQL 系统表
```sql
-- 检查函数是否在 pg_proc 中
SELECT proname, pronamespace, proowner, proacl 
FROM pg_proc 
WHERE proname = 'get_player_rankings';

-- 检查 schema 权限
SELECT nspname, nspowner, nspacl 
FROM pg_namespace 
WHERE nspname = 'public';

-- 检查 authenticator 角色的权限
SELECT * FROM pg_roles WHERE rolname = 'authenticator';
```

### 建议 4：尝试简化函数定义
```sql
-- 创建一个最简单的测试函数
CREATE OR REPLACE FUNCTION public.test_function()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 'Hello from PostgREST'::text;
$$;

-- 授予权限
GRANT EXECUTE ON FUNCTION public.test_function() TO anon;

-- 刷新 schema
SELECT pg_notify('pgrst', 'reload schema');

-- 测试
curl -s 'http://175.178.236.183:8000/rest/v1/rpc/test_function' \
  -H 'apikey: ...'
```

### 建议 5：联系 PostgREST 社区
如果以上方案都无效，建议：
1. 在 PostgREST GitHub Issues 中搜索类似问题
2. 提交新的 Issue，附上完整的配置和日志
3. 考虑升级或降级 PostgREST 版本

---

## 📚 相关文档

- [PostgREST Schema Cache 文档](https://postgrest.org/en/stable/references/schema_cache.html)
- [PostgREST Configuration 文档](https://postgrest.org/en/stable/references/configuration.html)
- [PostgreSQL 函数权限文档](https://www.postgresql.org/docs/current/sql-grant.html)

---

## 🔗 相关文件

- `docs/fix-postgrest-schema-cache.md` - PostgREST 修复指南
- `docs/postgrest-auto-reload-setup.md` - PostgREST 自动重载配置
- `docs/postgrest-troubleshooting-summary.md` - 排查总结
- `scripts/matchlife-uat/setup-selfhosted-supabase.sh` - PostgREST 部署脚本

---

**最后更新**：2026-04-24 11:50 CST  
**状态**：🔴 问题未解决，需要进一步调查
