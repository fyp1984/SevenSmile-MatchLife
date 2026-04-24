# PostgREST 自动监听 Schema 变更配置指南

## 📋 背景说明

PostgREST 默认在启动时加载数据库 schema 到内存缓存中。当数据库 schema 发生变更（如创建新函数、表等）时，PostgREST 不会自动检测这些变更，需要手动重新加载 schema cache。

## 🔍 当前环境分析

根据 UAT 环境的配置：
- **PostgREST 地址**：`http://175.178.236.183:8000`
- **Nginx 反向代理**：`https://tools.cheersai.cloud/7smile-matchlife/supabase/` → `http://175.178.236.183:8000`
- **数据库**：PostgreSQL 14 运行在 `localhost:5432`

**重要发现**：PostgREST 运行在远程服务器 `175.178.236.183`，不是 UAT 服务器本地。

## ✅ 已完成的配置

### 1. 数据库触发器配置（已完成）

在 UAT 服务器的 PostgreSQL 数据库中已创建：

```sql
-- 创建通知函数
CREATE OR REPLACE FUNCTION notify_postgrest_schema_change()
RETURNS event_trigger AS $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$ LANGUAGE plpgsql;

-- 创建事件触发器
CREATE EVENT TRIGGER postgrest_schema_change_trigger
ON ddl_command_end
EXECUTE FUNCTION notify_postgrest_schema_change();
```

**验证结果**：
```
             evtname             |    evtevent     |            evtfoid             
---------------------------------+-----------------+--------------------------------
 postgrest_schema_change_trigger | ddl_command_end | notify_postgrest_schema_change
```

## ⚠️ 需要在远程 PostgREST 服务器上完成的配置

### 步骤 1：登录到 PostgREST 服务器

```bash
# 登录到运行 PostgREST 的服务器
ssh user@175.178.236.183
```

### 步骤 2：找到 PostgREST 配置文件

```bash
# 查找 PostgREST 进程
ps aux | grep postgrest | grep -v grep

# 查找配置文件
find / -name "postgrest.conf" -o -name "postgrest.config" 2>/dev/null

# 如果找不到，检查环境变量
cat /proc/$(pgrep postgrest | head -1)/environ | tr '\0' '\n' | grep -E 'PGRST|DB'
```

### 步骤 3：修改 PostgREST 配置文件

在配置文件中添加或修改以下配置：

```ini
# 数据库连接配置
db-uri = "postgres://postgres:password@121.41.195.46:5432/postgres"
db-schemas = "public"
db-anon-role = "anon"

# 启用 schema cache 自动重新加载（关键配置）
db-channel-enabled = true
db-channel = "pgrst"

# 其他配置
server-host = "0.0.0.0"
server-port = 8000
```

**关键配置说明**：
- `db-channel-enabled = true`：启用 LISTEN/NOTIFY 机制
- `db-channel = "pgrst"`：监听的 PostgreSQL 通知频道名称（必须与数据库触发器中的频道名称一致）

### 步骤 4：重启 PostgREST 服务

```bash
# 方法 1：如果 PostgREST 由 systemd 管理
sudo systemctl restart postgrest

# 方法 2：如果 PostgREST 由 supervisord 管理
sudo supervisorctl restart postgrest

# 方法 3：如果 PostgREST 是手动启动的进程
# 先找到进程 PID
ps aux | grep postgrest | grep -v grep

# 杀死旧进程
sudo kill -9 <PID>

# 使用新配置启动 PostgREST
postgrest /path/to/postgrest.conf &
```

### 步骤 5：验证配置是否生效

```bash
# 1. 在 UAT 服务器上手动发送通知
ssh cheersai@121.41.195.46 "sudo -u postgres psql -d postgres -c \"SELECT pg_notify('pgrst', 'reload schema');\""

# 2. 等待 3-5 秒后，测试 RPC 函数是否可用
curl -s 'http://175.178.236.183:8000/rest/v1/rpc/get_player_rankings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY' \
  -d '{"page_limit": 20, "page_offset": 0, "sport_type": "badminton"}'

# 3. 检查 PostgREST 日志
# 如果配置正确，应该能看到 "Listening for notifications on the pgrst channel" 的日志
```

## 🔧 临时解决方案（立即可用）

如果无法立即访问远程 PostgREST 服务器，可以使用以下临时解决方案：

### 方案 1：手动发送通知 + 等待

```bash
# 在 UAT 服务器上执行
ssh cheersai@121.41.195.46 "sudo -u postgres psql -d postgres -c \"SELECT pg_notify('pgrst', 'reload schema');\""

# 等待 5-10 秒
sleep 10

# 测试 RPC 函数
curl -s 'https://tools.cheersai.cloud/7smile-matchlife/supabase/rest/v1/rpc/get_player_rankings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY' \
  -d '{"page_limit": 20, "page_offset": 0, "sport_type": "badminton"}'
```

### 方案 2：联系远程服务器管理员

如果 PostgREST 运行在 `175.178.236.183` 服务器上，需要联系该服务器的管理员：

1. **提供配置信息**：
   - PostgREST 需要启用 `db-channel-enabled = true`
   - 监听频道名称：`pgrst`
   - 数据库连接：`postgres://postgres:password@121.41.195.46:5432/postgres`

2. **请求重启 PostgREST 服务**

## 📊 验证自动监听是否生效

配置完成后，可以通过以下方式验证：

### 测试 1：创建新函数并验证

```sql
-- 在 UAT 数据库中创建测试函数
CREATE OR REPLACE FUNCTION test_auto_reload()
RETURNS TEXT AS $$
BEGIN
  RETURN 'Auto reload works!';
END;
$$ LANGUAGE plpgsql;
```

等待 3-5 秒后测试：

```bash
curl -s 'http://175.178.236.183:8000/rest/v1/rpc/test_auto_reload' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY'
```

如果返回 `"Auto reload works!"`，说明自动监听配置成功！

### 测试 2：验证 get_player_rankings 函数

```bash
curl -s 'https://tools.cheersai.cloud/7smile-matchlife/supabase/rest/v1/rpc/get_player_rankings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY' \
  -d '{"page_limit": 20, "page_offset": 0, "sport_type": "badminton"}'
```

## 🎯 总结

### ✅ 已完成的配置

1. **数据库触发器**：已在 UAT PostgreSQL 数据库中创建
2. **事件触发器**：已配置为在 DDL 变更时自动发送通知

### ⚠️ 需要完成的配置

1. **PostgREST 配置**：需要在 `175.178.236.183` 服务器上启用 `db-channel-enabled = true`
2. **PostgREST 重启**：配置修改后需要重启 PostgREST 服务

### 📝 下一步操作

1. **联系 175.178.236.183 服务器管理员**
2. **提供上述配置信息**
3. **请求重启 PostgREST 服务**
4. **验证配置是否生效**

配置完成后，每当数据库 schema 发生变更时，PostgREST 会自动重新加载 schema cache，无需手动干预。

## 📞 联系信息

如需帮助，请联系：
- UAT 服务器：`cheersai@121.41.195.46`
- PostgREST 服务器：`175.178.236.183`（需要管理员权限）
