# MatchLife 订阅号验证性能测试报告

## 1. 测试范围

本报告覆盖“订阅号消息直达链接方案”中的**本地核心计算路径**：

- 票据签发（HMAC + base64url）
- 票据验签与解析
- 关注者集合本地命中查询

说明：

- 本报告**不包含**微信远程接口 `user/info` / `user/get` 的真实网络耗时
- 因为该部分强依赖外部网络与微信平台响应，不能与本地核心计算混为一谈

## 2. 测试环境

- 项目：`SevenSmile-MatchLife`
- 脚本：
  - `scripts/matchlife-uat/wechat-auth-bench.mjs`
- 执行命令：

```bash
node scripts/matchlife-uat/wechat-auth-bench.mjs
```

## 3. 测试结果

### 基准参数

- 迭代次数：`20000`
- 访问版本：`2026-04-18`

### 实测输出

```json
{
  "iterations": 20000,
  "version": "2026-04-18",
  "results": [
    {
      "name": "issue_ticket",
      "totalMs": 93.29,
      "avgMs": 0.0047
    },
    {
      "name": "verify_ticket",
      "totalMs": 45.96,
      "avgMs": 0.0023
    },
    {
      "name": "follower_set_lookup",
      "totalMs": 0.88,
      "avgMs": 0
    }
  ],
  "note": "仅覆盖本地票据签发/验签/缓存命中路径，不含微信远程接口网络耗时"
}
```

## 4. 结果解读

### 4.1 本地 CPU 开销

- 票据签发平均耗时：`0.0047ms`
- 票据验签平均耗时：`0.0023ms`
- 关注者集合命中平均耗时：约 `0ms`

结论：

- 本地鉴权计算开销可以忽略不计
- 系统响应时间的主要不确定项来自：
  - 网络 RTT
  - 微信接口调用
  - 浏览器页面加载

### 4.2 500ms 响应目标可达性

#### 缓存命中路径

- `ticket -> 本地验签 -> 本地关注列表命中 -> 下发 Cookie`
- 完全可达到 `< 500ms`

#### 微信接口回退路径

- `ticket -> 本地验签 -> 调用 user/info -> 下发 Cookie`
- 是否 `< 500ms` 取决于：
  - 微信接口响应
  - 出口网络
  - TLS 建连

因此：

- **500ms SLA 必须建立在缓存优先策略上**

## 5. 高并发稳定性分析

### 5.1 有利因素

- 核心逻辑为无锁轻计算
- 票据验证不依赖数据库
- 本地 `Set/Map` 查询为 O(1)
- 关注列表同步可异步完成，不阻塞在线请求

### 5.2 风险点

- 若大量请求同时回退 `user/info`，可能触发微信接口频次压力
- 若消息回调服务与验证服务共进程，极端高峰下需关注事件循环阻塞

### 5.3 建议的保护策略

- 严格优先使用本地关注列表缓存
- 将关注列表同步为独立定时任务
- 对 `user/info` 回退设置超时与熔断
- 对同一 `openid` 的回退结果做短 TTL 缓存

## 6. 结论

- 从本地计算与缓存命中角度看，当前重构方案足以支持高并发
- 若要在生产环境满足“已关注用户验证响应时间不超过 500ms”，必须：
  - 保持关注列表缓存新鲜
  - 降低在线请求对微信 API 的依赖

## 7. 下一步建议

- 线上增加 `p50/p95/p99` 实测埋点
- 增加：
  - `magic_link_consume_latency_ms`
  - `follow_check_cache_hit_rate`
  - `follow_check_remote_fallback_rate`
  - `follow_check_remote_error_rate`

只有补齐线上埋点后，才能对 `99.9%` 可用性和 `<500ms` SLA 做持续性验收。
