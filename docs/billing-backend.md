---
title: "KakaReel 支付后端基础与接入边界"
date: 2026-10-21
status: "基础已部署，所有真实渠道关闭，尚不能收款"
---

# 支付后端基础

本轮只提供一次性积分包的订单、验签适配边界、事件状态机和整数积分账本。默认商品无价格、无积分数量、未开售；Pancake、Waffo、Stripe、Antom 的 provider registry 为空。未安装支付 SDK、创建商户、执行真实／真实渠道沙盒交易或发放真实付费额度。不把 mock 验收写成生产支付可用。

依据：[2026-10-21 支付接入研究](research/2026-10-21-payment-integration.md)；项目负责人 2026-10-21 的任务要求。app 挂载、账户及定价前端已集成；生成仍沿用邀请预览权限。订阅是未来范围。

## 前端契约

浏览器安全类型统一在 `src/lib/billing.ts`，不包含 SDK、密钥或 provider 内部引用。所有响应 `Cache-Control: no-store`。

| 方法与路径 | 请求／返回 | 权限与限制 |
|---|---|---|
| `GET /api/billing/catalog` | `{mode:"one-time-credits", checkoutEnabled, products, providers}` | 公开。默认商品 `credits:null`、`price:null`、`available:false`；四个渠道 `available:false` |
| `GET /api/billing` | `{balanceCredits, testBalanceCredits, checkoutEnabled, generationChargingEnabled:false, previewAccess}` | Google 本人；正式／测试余额分别求和。previewAccess 仍来自现有邀请资格 |
| `GET /api/billing/orders` | `{orders: BillingOrder[]}` | Google 本人最新 50 单；没有跨用户过滤器，未实现分页 |
| `GET /api/billing/orders/:id` | `{order: BillingOrder}` | 非本人或不存在均 404 |
| `POST /api/billing/checkout` | `{productId, provider, requestId}` → `{order, checkoutUrl}` | Google 账户、正确 Origin、`X-KakaReel-Owner` 必须等于当前会话 UUID；requestId 为 UUID |
| `POST /api/billing/webhooks/:provider` | 原始 body；成功 `{ok:true,outcome:"applied"\|"ignored"\|"duplicate"}` | 仅四个确切渠道路径。渠道验签与作用域校验，不用浏览器 session／Origin 认证 |

`provider` 为 `pancake | waffo | stripe | antom`。GET 如带 `X-KakaReel-Owner` 也校验一致性；前端读账单／订单时应带上当前用户 ID，避免切换标签后的旧账号显示。该头是身份一致性断言，不是授权来源。所有归属只取已验证会话，body 里的 owner、userId、金额、币种、积分、成功状态及其他额外字段都拒绝。

`BillingOrder` 返回 ID、产品名／ID／价格版本、渠道／test 或 live、订单状态、结账准备状态、整数金额／币种／积分、创建与更新时间。没有 checkout token、用户邮箱、签名原文或 provider 内部标识。checkoutUrl 仅瞬时返回；不存数据库／日志。前端关闭付款页、返回页 query、按钮显示成功均不能发放积分。返回页只读取本人订单。

错误格式 `{error,code}`：

- 401：`GOOGLE_SIGN_IN_REQUIRED`；过期账号沿用 `SESSION_EXPIRED`，可用现有刷新流程。
- 403：`GOOGLE_ACCOUNT_REQUIRED`、`ORIGIN_REJECTED`、`WEBHOOK_SCOPE_MISMATCH`。
- 400：`INVALID_CHECKOUT`、`INVALID_WEBHOOK`；无效签名与不完整／不支持的事件均不进入交易。
- 409：`ACCOUNT_CHANGED`、`PRODUCT_UNAVAILABLE`、`IDEMPOTENCY_CONFLICT`、`CHECKOUT_IN_PROGRESS`、`ORDER_NOT_PAYABLE`、`PAYMENT_MISMATCH`、`EVENT_ID_CONFLICT`。
- 503：`PROVIDER_UNAVAILABLE`、`SALES_DISABLED`、`CHECKOUT_UNCONFIRMED`、`CHECKOUT_BINDING_PENDING` 等暂未确认状态；数据库异常返回 `BILLING_UNAVAILABLE`。数据库唯一约束冲突也失败关闭，不能把持续冲突当成付款失败后重新扣款，须对账处理。

checkout 的价格和额度来自服务端商品白名单／渠道商品映射。未配置渠道在订单预留之前返回 503，无假订单、假 URL 或积分。默认没有环境变量可打开销售；接入真实 adapter、获批商品和显式 salesEnabled 都属于后续代码／运营放行。

## API 精确挂载

`src/server/billing/routes.ts` 导出 `billingRoutes`、`billingWebhookRoutes` 和 `isBillingWebhookRequest`。保留全局 body limit、no-store、onError。在既有 Origin middleware 的判断处只增加精确 method＋path 条件：

```ts
import { billingRoutes, billingWebhookRoutes, isBillingWebhookRequest } from "./billing/routes";

if (
  !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
  !isBillingWebhookRequest(c.req.method, c.req.path)
) {
  // 保留现有 exact Origin 与 Sec-Fetch-Site 检查，不改变其他 mutation。
}

// 在全局 middleware 之后挂载，webhook 必须排在普通 billing router 之前。
app.route("/billing/webhooks", billingWebhookRoutes);
app.route("/billing", billingRoutes);
```

根 app 使用 `.basePath("/api")`。豁免仅为四个完整的 POST 路径：`/api/billing/webhooks/pancake`、`/waffo`、`/stripe`、`/antom`（后三者替换同一末段）。不匹配尾斜线、附加路径、未知渠道或其他方法。禁止用 startsWith、全 `/billing` 前缀或全 POST 放宽。普通 billing router 还独立保留 Origin 检查；webhook 必须先挂载，否则会被普通 billing 的 Origin／账号 middleware 拦住。

webhook body 上限 256 KiB，checkout 上限 4 KiB；raw bytes 在验签前不做 JSON 解析或重编码。默认未配置 webhook 返回 503，不能先 200 再丢弃。真实 app 的匿名已知渠道 503、未知／伪造路径及 checkout 无 Origin 403 已有集成回归。

## Provider 适配边界

`src/server/billing/providers.ts` 定义 hosted `createCheckout` 和 `verifyAndNormalizeWebhook`。`createBillingModule` 接受 server-only 依赖注入以便测试；没有测试 HTTP 入口或配置绕过。测试 mock 仅存在于 `tests/billing.test.ts`，采用内存随机测试签名协议，不能拿它当任一真实渠道的签名实现。

每个 adapter 固定渠道、test/live 环境、商户／店铺 ID、允许的 HTTPS checkout hostname。订单记录渠道商品映射、价格版本和金额／积分快照。所有 provider 幂等键固定为本地订单 UUID；超时／进程重启不能换键、换渠道、重建资金订单。返回地址、Google token、客户端价格都不是 adapter 的客户端输入。

- **Pancake**：后续按核准版本 `@waffo/pancake-ts` 的 authenticated checkout 实现。buyerIdentity 映射本地用户 UUID、buyerEmail 只作预填，orderMerchantExternalId 映射本地订单；显式传幂等键。把整数最小货币单位精确转展示金额字符串，不能浮点运算或套用弃用 amount 字段。RSA-SHA256 原始 body／平台公钥、事件 id／eventType、mode、storeId、时间与重试窗口按锁定 SDK／真实沙盒载荷核验；不能混用通用页面与 SDK 两套事件格式或测试公钥兜底。
- **Stripe**：独立 Checkout Session、签名 secret、原始 body、实际 payment_status／异步支付完成判据。
- **Waffo 企业支付**：独立产品和 adapter；不能复用 Pancake SDK、字段或商户配置。
- **Antom**：先确定合同产品及托管结账 API；RSA256／Client-Id／环境、通知和响应规则独立实现。

适配器只有在签名、重放政策、环境、商户作用域验证成功后才能返回 `VerifiedPaymentEvent`。业务层再次验证环境／商户、用户、订单、商品、渠道商品、checkout ID、整数金额／币种；成功与退款还需资金 payment ID。HTTP 客户端不能提交 normalized event 或 `verified:true` 直达状态机。

`payment.succeeded` 必须表示**全额实际收款成功**；授权、部分成功、未知状态均不允许映射为它。`payment.failed` 是失败付款尝试，不表示该 checkout 永远不能成功；失败 attempt ID 只存事件审计。`checkout.canceled` 也不能推翻后来可信收款。确需不可恢复 order-level failure 的渠道语义需要后续独立状态／对账设计，不能混为 attempt failure。

`payment.refunded` 只表示**全额退款实际成功**，amountMinor 必须等于订单总额，paymentId 必须对应原资金支付。Pancake 创建退款工单、审核、pending、refund.failed 都不能映射成功。部分退款、退款发起、已消费额度退款和拒付尚未实现；当前不支持的事件拒绝／等待 adapter 提供完整证据，不猜测金额，不发放／冲销。

当前没有 queryPayment、queryRefund、定时对账或补发后台；接口可后续扩展，不伪造实现。渠道税费／折扣／金额字符串核对、付款记录、净结算和实际到账也未完成。金额字段是需精确相等的订单应付总额及实际收款／全额退款，不代表净到账；动态加税导致应付总额不确定时，必须先扩展正式税额快照流程，不能去掉金额相等判据以启售。

## 事务、幂等与乱序

`0003-billing.sql` 只新增 billing_orders、billing_events、credit_ledger 和约束／索引，不修改 users、video_jobs 或既有迁移，不 seed 任何资金数据。

- 订单 `(user_id,request_id)` 唯一；同键不同产品／渠道／环境／商户返回冲突。重试用订单原始价格快照，不取客户端价格或新价格。
- 本地订单先提交，再在数据库事务之外调用 adapter。checkout lease 60 秒；并发第二个请求 409，未确认状态重试沿用原键；宕机后 lease 到期可重试。adapter 必须真实支持重复调用返回同一远端 checkout，否则不能启用。
- 不持有数据库事务等待支付网络。provider 返回的 HTTPS hostname 必须在配置 allowlist，无 userinfo／自定义端口。URL 与 token 不持久化。
- 事件 `(provider,environment,merchant_account_id,provider_event_id)` 唯一，canonical fingerprint 检测同事件 ID 改内容。不同投递 ID 也受订单状态和 ledger `(order_id,kind)` 约束，不能重复入账。
- 资金支付 ID 在 `(provider,environment,merchant_account_id)` 下唯一；只有成功／退款建立此绑定。失败 attempt 不能阻止同 checkout 另一 attempt 的真实成功。
- 每个 webhook 锁订单行，并在同一事务中完成事件、状态与 ledger；事务失败全部回滚，不能先确认事件再发货。异步 fire-and-forget 未使用。
- credit ledger 只追加 purchase／refund；整数正值／负值，订单、用户、环境有复合外键。正式／测试分开求和，安全整数边界检查；没有余额直接改写接口，也没有视频预留／扣减／释放。

| 原状态 | 可信事件 | 结果与积分变化 |
|---|---|---|
| pending／failed／canceled | payment.succeeded | paid；只追加一次 purchase |
| pending | payment.failed／checkout.canceled | failed／canceled；无资金绑定、无积分 |
| paid | 迟到 failed／canceled／重复 succeeded | 保持 paid；无第二笔积分 |
| paid | payment.refunded | refunded；只追加一次全额负积分 |
| pending／failed／canceled | payment.refunded | refunded；从未入账则不产生负余额 |
| refunded | 迟到 succeeded／重复 refunded | 保持 refunded；不恢复积分 |

同一 payment 被用于另一订单触发唯一约束，事件／状态／积分全部回滚；需要对账，不能认定收入已到账。已付订单收到不同资金 payment ID 也拒绝，不能静默接受可能的二次收款。

**早到或丢失回调不是已经解决的生产能力。** 如果 verified webhook 早于 checkout ID 的本地绑定，返回 `503 CHECKOUT_BINDING_PENDING`，不记 processed、不发积分；渠道必须按支持的窗口重试。checkout 创建响应丢失，可用原 requestId 重试 adapter 后建立绑定，但没有后台自动 query／对账。若渠道不重试、回调丢失或重试耗尽，就需要后续查询／人工对账流程；激活前必须实现并验收该恢复路径。

## 激活 gate（本轮均不代替完成）

1. 用户批准 SKU、价格版本、积分数量、有效期、成本／税费／渠道费／失败重试与退款毛利口径。当前商品无金额、不开售。
2. 独立本项目商户、适用个人／企业主体与地区、渠道及 AI 视频业务准入书面确认；不得复用其他项目密钥。
3. 实施**生成前提示词审核＋展示前输出审核**，以及 AUP、举报／处置和真人素材授权约束；仅提示词审核或假定上游风控均不足。此模块不实现它们。
4. 锁定真实 adapter／SDK，核签名／环境／店铺／时间窗口、真实金额／税费字段、异步付款、全额退款、重试与查询对账；资源在库外或部署平台。
5. 用户批准付费权益与 preview 并存规则，并另行实现生成预留／扣减／失败释放。当前无论支付账本如何，生成仍只认既有 preview 权限。
6. 条款、退款、部分退款／已消费额度／拒付规则、客服入口、对账责任、监控与人工解除路径就绪。
7. 完成独立真实渠道沙盒的付款、拒付、迟到／丢失回调、重试、重启、退款及跨用户隔离；测试积分不可换真实付费推理。
8. 获准后独立开启正式配置与商品，首次真实交易另获明确授权。生产配置存在不自动打开本模块。

## 验证与资源清理

`tests/billing.test.ts` 只允许 `BILLING_TEST_DATABASE_URL` hostname 为 `127.0.0.1`、database 为 `video_billing_qa`。测试会清空该库 public schema，必须是专用一次性数据库；不能指向保留数据。配置留库外，目录 0700、文件 0600。未提供该变量会显式 skip，**skip 不算验证通过**。

在独立临时 PostgreSQL 16 容器上设置该测试变量后运行：

```sh
node --import tsx --test tests/billing.test.ts
pnpm exec tsc --noEmit --incremental false
git diff --check
```

测试使用测试库的本地用户／真实应用 JWT，会话照常查数据库；无生产认证绕过。mock provider 只在测试文件内注入，所有 fetch 被拒绝，不调用真实支付或视频。实际运行覆盖新增迁移保留用户／视频、真实 app 挂载、默认全关闭、越权与强 owner、CSRF、客户端改价、订单幂等并发／超时／过期 lease、验签前原文篡改与重放、环境／店铺、金额／币种、失败后成功、退款先到、重复回调／重复 payment、早到回调重试，以及 ledger 写入故障导致整个事务回滚再恢复。

2026-10-21 专项集成运行：16 passed（15 子项＋父测试），0 failed、0 skipped。本轮临时容器脚本设 EXIT 清理，停止容器并删除临时卷；应用 pool 在 after 中关闭。测试模拟签名不等于 Pancake／Stripe／Waffo／Antom 真实 SDK 已验收；真实渠道、真实交易和生产支付仍未启用。

2026-10-21 生产验收：`9ae7ca4` 部署 Done；公开 catalog 返回未开售与 null 价格／额度，匿名 billing 401，未配置 Pancake webhook 503，无 Origin checkout 403。返回页忽略 URL success 参数。生产只读 SQL 确认三条迁移已应用，原任务及归属保留；订单、事件与账本均为零。没有执行真实支付操作，资金链路仍只经过 mock 集成验收。
