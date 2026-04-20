# MatchLife 订阅号关注验证方案重构

## 1. 背景与目标

当前系统最初尝试沿用“公众号网页授权 OAuth + `openid` + `subscribe` 校验”的方案，但在订阅号场景下暴露出两个根本问题：

- 技术层面：订阅号无法稳定使用公众号网页授权获取当前 H5 访问用户身份
- 体验层面：访问码手输流程阻塞严重，导致关注后到达系统的转化路径过长

本次重构目标：

- 在**订阅号能力边界内**设计一个真正可落地的身份校验方案
- 优先提升“已关注用户”的进入流畅度
- 保留访问码兜底，但将其降级为备用链路
- 为未来升级到服务号或更强接口能力预留架构兼容位

## 2. 官方能力调研结论

### 2.1 网页授权（OAuth2.0）能力边界

微信官方网页开发文档明确指出：

- 网页授权“通过此机制可以获取用户身份信息，进而实现业务逻辑”
- **“仅服务号可用”**

说明：

- 在当前订阅号账号前提下，不能依赖网页授权获取当前 H5 访问用户 `openid`
- 因此“订阅号内无感 OAuth 拿 `openid` 再校验关注状态”不成立

官方参考：

- `https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/Wechat_webpage_authorization.html`

### 2.2 JS-SDK 能力边界

官方网页开发入口对 JS-SDK 的定义是：

- 提供扫一扫、分享、录音等网页能力
- 并未提供“直接获取当前访问用户 openid”的能力

结论：

- **JS-SDK 不是用户身份识别方案**
- 可用于交互增强，但不能替代身份认证

官方参考：

- `https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/JS-SDK.html`

### 2.3 订阅号下可行的用户身份来源

官方“接收普通消息”文档明确说明：

- 当普通微信用户向公众账号发消息时，微信服务器会回调开发者 URL
- XML 中 `FromUserName` 就是**发送方账号（一个 OpenID）**

结论：

- 在订阅号场景下，**最可靠的用户身份来源不是网页授权，而是消息回调**
- 也就是说：用户先与公众号发生消息交互，开发者服务端即可拿到其 `openid`

官方参考：

- `https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_standard_messages.html`

### 2.4 服务端关注状态校验可行性

官方用户管理文档给出：

- `/cgi-bin/user/get`：获取关注用户列表
- `/cgi-bin/user/info`：获取单个用户基本信息与 `subscribe`

结论：

- 一旦服务端通过消息回调拿到了用户 `openid`
- 就可以：
  - 用 `user/info` 实时校验该用户是否仍关注
  - 或定时用 `user/get` 同步全量关注者列表做本地缓存

官方参考：

- `https://developers.weixin.qq.com/doc/offiaccount/User_Management/Getting_a_User_List.html`

## 3. 重构后的技术方案

## 3.1 方案拆分

### A. 订阅号可落地 MVP（本次实施）

主链路：

1. 用户关注公众号
2. 用户回复关键词“比赛生涯”
3. 微信消息回调把该用户 `openid` 发到服务端
4. 服务端生成**短期有效直达链接票据（ticket）**
5. 服务端通过被动回复文本，把直达链接返回给用户
6. 用户点击链接打开 H5
7. H5 调用服务端 `/api/wechat/magic-link/consume`
8. 服务端校验：
   - 票据合法性
   - 票据有效期
   - 票据未被复用
   - 用户是否仍关注（优先查本地关注列表缓存，必要时回退 `user/info`）
9. 校验成功后下发会话 Cookie，用户无感进入系统

兜底链路：

- 若用户未点公众号返回的直达链接，仍可在 `/gate/wechat` 输入访问码进入

### B. 增强方案（需要额外前提）

前提：

- 升级服务号
- 或确认订阅号拥有完整消息回调/客服消息/菜单事件能力并已完成配置

增强点：

- 菜单点击直接生成直达链接
- 一次一链
- 更短 TTL
- 更严格的 `subscribe` 实时校验

## 3.2 架构设计

### 前端

- `WechatProtectedLayout`
  - 守卫未放行用户
  - 支持 Cookie + 版本号校验
- `WechatGate`
  - 提示用户“回复关键词获取直达链接”
  - 保留访问码输入兜底
- `WechatComplete`
  - 消费 `ticket`
  - 调用服务端校验
  - 成功后写入前端会话并跳转

### 服务端

- `GET /api/wechat/mp/callback`
  - 用于微信服务器 URL 校验（`echostr`）
- `POST /api/wechat/mp/callback`
  - 接收普通消息 / 菜单事件
  - 从 `FromUserName` 获取 `openid`
  - 生成短期票据
  - 回复直达链接
- `GET /api/wechat/magic-link/consume`
  - 校验票据合法性
  - 校验关注状态
  - 设置放行 Cookie
- `POST /api/wechat/access-code/verify`
  - 访问码兜底入口

### 关注状态缓存

- 本地内存缓存：
  - 单用户 `openid -> subscribe`，TTL 5 分钟
- 本地文件缓存：
  - 周期性同步关注者列表到 JSON 文件
  - 验证时优先命中文件缓存
- 远程回退：
  - 缓存失效时调用 `user/info`

## 4. 为什么这比访问码方案更好

### 4.1 用户体验优化

原方案：

- 关注公众号
- 回复关键词
- 读文本
- 手动复制访问码
- 切回 H5
- 输入访问码

新方案：

- 关注公众号
- 回复关键词
- **点击公众号返回的直达链接**

效果：

- 去掉手输访问码
- 去掉复制/切换成本
- 用户更容易完成从公众号到 H5 的闭环

### 4.2 安全性优化

- 票据包含签名
- 票据带有效期（默认 10 分钟）
- 票据默认一次性消费
- Cookie 带版本号，支持轮换失效
- 可选严格模式：若 `user/info` 校验失败则拒绝放行

## 5. 当前实现的代码模块

### 前端

- `src/components/WechatProtectedLayout.tsx`
- `src/pages/WechatGate.tsx`
- `src/pages/WechatComplete.tsx`
- `src/pages/Follow.tsx`

### 本地 API

- `api/wechat/access-code-verify.ts`
- `api/wechat/magic-link-consume.ts`
- `api/wechat/mp-callback.ts`
- `api/wechat/oauth-start.ts`
- `api/wechat/oauth-callback.ts`

### 生产服务

- `scripts/matchlife-uat/wechat-oauth-server.mjs`
- `scripts/matchlife-uat/wechat-follower-sync.mjs`

## 6. 关注状态校验策略

### 优先级

1. 文件缓存 `WECHAT_FOLLOWER_CACHE_FILE`
2. 进程内 5 分钟缓存
3. 微信 `user/info`

### 频次控制

- `user/info` 不对每个请求强制调用
- 缓存命中优先，降低微信接口调用量
- 全量关注者列表使用离线同步，不放在在线请求链路上

## 7. 异常处理策略

### 消息回调

- 微信要求 5 秒内响应
- 若复杂逻辑超时风险高，应优先快速返回文本，不在回调内做重型处理

### `magic-link/consume`

- 票据无效：返回 401，提示重新获取直达链接
- 票据过期：返回 401，提示重新回复关键词
- 票据已用：返回 401，提示重新获取
- 微信接口异常：
  - 严格模式：拒绝放行
  - 非严格模式：记录降级日志，可选择基于近期消息交互放行

### 缓存失效

- 本地关注列表文件不存在或过旧时，自动回退单用户 `user/info`

## 8. 性能与可用性分析

### 8.1 响应时间目标

- 已关注用户命中本地缓存：
  - 目标 `< 500ms`
- 已关注用户回退微信 `user/info`：
  - 依赖外部网络，不应作为常态链路

### 8.2 可用性设计

- H5 进入链路不依赖数据库
- 票据校验为本地 HMAC，计算开销极低
- 微信 API 调用通过缓存削峰

### 8.3 99.9% 可用性前提

- Nginx / Node 守护进程稳定
- 微信消息回调地址可用
- 关注列表缓存定时更新
- 严格控制远程 `user/info` 依赖频率

## 9. 隐私与安全

- 不在前端存储 `openid`
- 票据使用 HMAC 签名
- Cookie 仅存放放行状态与版本，不存用户身份明文
- 所有网络链路使用 HTTPS
- 日志中避免打印完整票据和敏感字段

## 10. 运营数据统计方案

建议埋点：

- `gate_view`
- `gate_keyword_hint_seen`
- `gate_access_code_submit`
- `gate_access_code_success`
- `magic_link_issued`
- `magic_link_clicked`
- `magic_link_consumed_success`
- `follow_redirect`

核心指标：

- 公众号回复关键词人数
- 直达链接点击率
- 直达链接消费成功率
- 从关注到进入系统的转化率
- 访问码兜底使用率
- 未关注拦截率

## 11. 质量验收说明

### 可以承诺的

- 订阅号场景下不再依赖不可用的网页授权
- 已关注用户通过消息直达链接进入时，体验显著优于手输访问码
- 票据签发/验签/缓存命中路径计算成本极低

### 需要前置条件的

- “已关注用户验证响应时间不超过 500ms”
  - 仅在缓存命中或本地关注列表命中时成立
- “未关注用户引导流程转化率提升 30%”
  - 需要上线后通过埋点和 A/B 数据验证，不能在开发阶段直接保证
- “系统可用性 99.9%”
  - 需要配合守护进程、监控与告警

## 12. 实施建议

### 第一阶段（立即上线）

- 上线消息回调 + 直达链接方案
- 访问码作为兜底
- 设置 10 分钟链接有效期
- 会话 Cookie 缩短到 12 小时并绑定版本号

### 第二阶段（1-2 周）

- 配置自定义菜单点击直达
- 部署关注者列表同步定时任务
- 增加运营埋点与看板

### 第三阶段（后续）

- 如业务对“真正无感 + 高精度关注校验”要求更高，评估升级为服务号
