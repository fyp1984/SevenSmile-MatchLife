# PostgREST Schema Cache 问题修复指南

## 📋 问题描述

**错误信息**：
```
Could not find the function public.get_player_rankings(page_limit, page_offset, sport_type) in the schema cache
```

**根本原因**：
PostgREST 运行在 `175.178.236.183:8000`，配置文件中缺少 `db-channel-enabled = true`，导致无法接收数据库的 schema 变更通知。

---

## ✅ 已完成的准备工作

### 1. 数据库角色创建（已完成）

```sql
-- 创建 anon 和 authenticated 角色
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

-- 授予基本权限
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

-- 授予函数执行权限
GRANT EXECUTE ON FUNCTION public.get_player_rankings TO anon;
GRANT EXECUTE ON FUNCTION public.get_player_rankings TO authenticated;
```

### 2. 自动通知触发器（已完成）

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

---

## 🔧 需要在 175.178.236.183 服务器上执行的操作

### 步骤 1: 登录到 PostgREST 服务器

```bash
# 使用 SSH 登录到 PostgREST 服务器
ssh user@175.178.236.183
```

### 步骤 2: 修改 PostgREST 配置文件

根据部署脚本，配置文件位于：`/etc/postgrest/matchlife.conf`

```bash
# 编辑配置文件
sudo nano /etc/postgrest/matchlife.conf
```

**添加以下配置**（在文件末尾）：

```ini
# 启用 schema cache 自动重新加载
db-channel-enabled = true
db-channel = "pgrst"
```

**完整配置示例**：

```ini
# Database connection
db-uri = "postgres://matchlife_auth:YOUR_PASSWORD@121.41.195.46:5432/postgres"
db-anon-role = "anon"
db-schemas = "public"

# Server configuration
server-host = "127.0.0.1"
server-port = 18000

# JWT configuration
jwt-secret = "YOUR_JWT_SECRET"

# OpenAPI configuration
openapi-mode = "follow-privileges"

# Schema cache auto-reload (新增)
db-channel-enabled = true
db-channel = "pgrst"
```

### 步骤 3: 重启 PostgREST 服务

```bash
# 重启 PostgREST 服务
sudo systemctl restart postgrest-matchlife.service

# 检查服务状态
sudo systemctl status postgrest-matchlife.service

# 查看日志（确认 schema cache 已加载）
sudo journalctl -u postgrest-matchlife.service -f
```

**预期日志输出**：
```
Schema cache loaded
Listening for notifications on the pgrst channel
```

### 步骤 4: 验证修复

```bash
# 测试 RPC 函数
curl -s 'http://localhost:18000/rest/v1/rpc/get_player_rankings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY' \
  -d '{"page_limit": 20, "page_offset": 0, "sport_type": "badminton"}'
```

**预期结果**：返回排行榜数据（JSON 数组）

---

## 🎯 临时解决方案（如果无法修改配置）

如果无法立即修改 PostgREST 配置，可以使用以下临时方案：

### 方案 1: 手动重启 PostgREST 服务

每次创建新函数后，手动重启 PostgREST：

```bash
ssh user@175.178.236.183
sudo systemctl restart postgrest-matchlife.service
```

### 方案 2: 发送 SIGUSR1 信号

```bash
# 找到 PostgREST 进程 PID
ps aux | grep postgrest

# 发送 SIGUSR1 信号重新加载 schema
sudo kill -SIGUSR1 <PID>
```

### 方案 3: 使用 NOTIFY（需要 db-channel-enabled）

在 UAT 服务器上执行：

```bash
ssh cheersai@121.41.195.46
sudo -u postgres psql -d postgres -c "SELECT pg_notify('pgrst', 'reload schema');"
```

**注意**：此方案只有在 PostgREST 配置了 `db-channel-enabled = true` 后才有效。

---

## 📊 验证清单

完成以上步骤后，请验证以下内容：

- [ ] PostgREST 配置文件已添加 `db-channel-enabled = true`
- [ ] PostgREST 服务已成功重启
- [ ] PostgREST 日志显示 "Listening for notifications on the pgrst channel"
- [ ] RPC 函数 `get_player_rankings` 可以正常调用
- [ ] 排行榜页面 https://tools.cheersai.cloud/7smile-matchlife/leaderboard 正常显示

---

## 🔍 故障排查

### 问题 1: PostgREST 服务无法启动

**检查日志**：
```bash
sudo journalctl -u postgrest-matchlife.service -n 50
```

**常见原因**：
- 配置文件语法错误
- 数据库连接失败
- JWT secret 配置错误

### 问题 2: 仍然报错 "function not found"

**检查以下内容**：
1. 确认 `anon` 角色已创建：
   ```sql
   SELECT rolname FROM pg_roles WHERE rolname = 'anon';
   ```

2. 确认函数权限已授予：
   ```sql
   SELECT has_function_privilege('anon', 'public.get_player_rankings(integer, integer, text)', 'EXECUTE');
   ```

3. 手动触发 schema reload：
   ```bash
   sudo systemctl restart postgrest-matchlife.service
   ```

### 问题 3: NOTIFY 不工作

**检查 PostgREST 配置**：
```bash
cat /etc/postgrest/matchlife.conf | grep db-channel
```

**预期输出**：
```
db-channel-enabled = true
db-channel = "pgrst"
```

---

## 📞 联系信息

如需帮助，请联系：
- UAT 服务器：`cheersai@121.41.195.46`
- PostgREST 服务器：`175.178.236.183`（需要管理员权限）

---

## 🎉 总结

完成以上步骤后：
1. PostgREST 将自动监听数据库 schema 变更
2. 每次创建新函数时，PostgREST 会自动重新加载 schema cache
3. 排行榜功能将正常工作
4. 未来不再需要手动重启 PostgREST 服务
