---
title: "KakaReel 支付接入研究与前置任务"
date: 2026-10-21
status: "研究完成；支付基础已实现，真实渠道尚未接入或验收"
scope: "Waffo Pancake 优先路径及 Stripe、Waffo 企业服务、Antom 的适配边界"
method: "读取本项目源码及公开官方文档；未登录支付后台、创建账号、读取凭证或执行交易"
---

# KakaReel 支付接入研究

建议先做 **Waffo Pancake 托管结账＋登录用户绑定＋一次性固定额度包**，把支付完成后充值、生成扣减、失败释放和退款串成一条可验收链路。这是实施建议，额度包、价格和正式渠道尚待产品负责人确定。订单、事件与积分账本基础已实现，见[支付后端说明](../billing-backend.md)；真实渠道、商户创建与正式收款资格均未完成。

2026-10-21 晚上可独立推进订单、账本、适配接口和离线测试。真实沙盒联调需要该项目自己的测试商户资源；正式收款还需要商户审核、AI 视频业务审核和生产配置。Google 登录上线本身不解除这些条件。

## 1. 产品名与渠道边界

| 路径 | 官方已核能力 | 适配方式与当前边界 |
|---|---|---|
| **Waffo Pancake** | 面向开发者的 MoR 产品，支持个人身份申请、一次性与订阅收费 | SDK 为 `@waffo/pancake-ts`，文档为 `docs.waffo.ai`，商户入口为 `pancake.waffo.ai`；优先研究路径，尚未接入 |
| **Waffo 企业支付** | Waffo 官网另列企业服务及托管／嵌入式 Checkout | 独立适配器；不能把企业示例中的 `@waffo/waffo-node`、订单字段或支付方式总数套到 Pancake |
| **Stripe Checkout** | Checkout Sessions、托管结账、一次性及订阅支付 | 独立商户审核、商品／价格映射、签名与退款实现；Stripe Atlas 注册服务不等于 Checkout 已开通 |
| **Antom** | 商户入驻、单笔支付、订阅及结算对账；另有 APO 编排等产品 | 先确定合同对应产品、地区和支付方式，再选 API；不混用 One-time Payments、APO、Business Account 的文档路径 |

产品名称使用 **Waffo Pancake**；本研究没有核到“Waffle”是该收款产品的官方名称。Pancake 的个人路径不能推导企业账户也可按同样方式提现。当前身份文档仍把企业身份验证列为 coming soon，需渠道方确认适用路线。[Pancake 简介](https://docs.waffo.ai/zh)、[身份验证](https://docs.waffo.ai/merchant/identity-kyc)、[Waffo Checkout](https://waffo.com/en/checkout)、[Stripe Checkout](https://docs.stripe.com/payments/checkout/quickstarts)、[Antom 入驻](https://docs.antom.com/ac/merchant_service/merchant_onboard)。

## 2. 本项目现有基础与缺口

以下是研究开始时的源码快照，用于解释改造动机。2026-10-21 Google 登录已上线；订单、事件、积分账本及精确 webhook 挂载已实现，当前边界以[支付后端说明](../billing-backend.md)为准。表中的生成扣减、内容审核和真实渠道仍是后续工作。

| 本地入口 | 当前基础 | 支付改造要求 |
|---|---|---|
| `src/server/account.ts`、`auth-routes.ts` | Google ID token 校验、本地 UUID、数据库会话、访客历史迁移 | 结账必须用已登录账户 UUID，不能用浏览器提交的用户 ID 或可变邮箱 |
| `src/server/schema.ts` | 用户、会话、视频任务等表 | 尚无支付订单、支付流水、退款、充值／消耗账本；新增迁移，不重写已应用迁移 |
| `src/server/app.ts` | API 写入全局检查同源 Origin；任务操作检查邀请资格 | 第三方 webhook 通常没有本站 Origin，直接挂入会被 403；只为精确 webhook 路径改用签名身份，其他写入口继续保留 CSRF 与用户校验 |
| `src/server/account.ts` | `canGenerate` 来自 `invitedAt` | 付款成功不能靠设置邀请字段交付；须单独定义付费权益、余额与预览额度关系 |
| `src/server/app.ts`、`docs/vibetoken.md` | 视频请求预落库、请求 ID 幂等、未知状态恢复、全局请求数限制 | 增加用户余额预留／扣减／释放；未知生成状态不直接退款或再扣一次；请求数限制不是美元成本上限 |
| `src/app/terms/page.tsx` | 邀请预览条款，明确暂无付费结账 | 商业发布前补价格、退款、内容政策、可用联系渠道和交付边界；本轮未修改条款 |

Google 官方要求服务端校验令牌并使用稳定 `sub` 识别用户。本项目已有 `google_sub → users.id` 映射，支付只需要本地 UUID，不向支付渠道传 Google token。Google Pay 是付款方式，与 Google 登录是两回事。[Google ID token 验证](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)、[本项目 Google 登录说明](../google-auth.md)。

## 3. Pancake 商户与正式开通

通用准备顺序：已有商户查重 → 选择个人／企业适用路径 → 准备测试密钥及测试商品 → 回调和沙盒验证 → 审核获准后发布商品与生产配置。商户审核材料可以与测试准备并行；商户审核和提现身份验证分别确认，不能把完成个人资料表当成正式交易权限。

个人提现验证需要法定姓名、国籍、证件类型和证件号，收款户名须匹配；资料由本人提交官方后台。工程仓库只记变量名和完成状态，不收证件、账户号或密钥。[身份验证](https://docs.waffo.ai/merchant/identity-kyc)。正式开通清单还包括收款账户、业务资料、商品同步、生产 API Key 和生产 webhook 公钥。[Quickstart](https://docs.waffo.ai/quickstart)。

**AI 视频业务审核是本项目的实际前置条件。** 官方要求独立品牌、准确模型披露、生成前提示词审核与展示前输出审核、公开 AUP 和举报／处置机制；真人素材须有授权约束。Prompt Sift 主要覆盖提示词阶段，不替代输出审核。以真人 deepfake 为核心的产品被禁止。[AIGC 审核要求](https://docs.waffo.ai/mor/account-reviews/aigc-compliance)、[限制产品](https://docs.waffo.ai/mor/prohibited-products)。

本轮读到的预览条款只有一般内容限制；在 `src`、`tests`、`docs` 的审核相关符号检索及已读生成链中，未发现独立提示词／输出审核接入证据。因此列为待实施与待核项；不能假定上游模型已有的风控自动满足渠道审核。不得把本产品的生成额度包装成第三方 AI 账户充值、礼品码转售；业务实质与商品描述须由渠道确认。

## 4. 用户、商品与结账契约

建议 MVP 只做一个 USD 固定价格的一次性额度包。订阅、试用、自动续费和多币种是后续范围；不要为展示能力同时接四家支付。

Pancake 商品是计费实体；固定价格设在商品上，动态金额可用服务端 `priceSnapshot`。商品可配置税种及是否含税，USD 商品公开价格范围为 1 至 10,000 美元；这是平台限制，不是 KakaReel 零售价。商品的 Redirect URL 同时用于成功和失败返回，落地页本身不能决定发货。[商品与价格](https://docs.waffo.ai/features/products)。

零售价须在负责人核实际推理成本后确定。建议计算：售价扣税费、渠道费、推理成本、失败重试损耗及退款／拒付准备后，仍留目标毛利。当前公开卡与数字钱包费率为 3.9%＋0.50 美元，特定支付失败另有费用；退款处理费为每次 1 美元，原交易手续费不退。提现另按金额的 1% 收费、每次最低 10 美元；首个 US$100 目标应分别记录销售收入、净结算和实际提现，不能当成 100 美元净到账。最终以商户适用报价为准，不能简单按“到账金额＝售价”估算。[费用表](https://docs.waffo.ai/mor/fees)。

推荐服务端契约：

1. `POST /api/billing/checkout` 接收允许的 `sku` 和客户端请求 ID，要求 Google 账户会话、同源 Origin 和当前用户一致性；服务端查版本化商品表并决定价格、币种、额度数量。
2. 先写本地订单、价格快照、用户 UUID 和幂等键。相同请求 ID 的不同内容应冲突，不创建第二份订单。
3. 调用 `client.checkout.authenticated.create(...)`，令 `buyerIdentity = users.id`，`buyerEmail = users.email`，`orderMerchantExternalId = 本地订单 ID`；用 `productId` 映射 Pancake 商品。邮箱只作预填，订单所有权仍绑定 UUID。
4. 第二参数显式传 `{ idempotencyKey }`。超时保持待核并复用同一键，不能自动切渠道再扣一笔。返回 `checkoutUrl` 给付款按钮，不记录 URL 中的会话 token。
5. 返回页查询当前用户自己的订单。只凭付款渠道已验证成功事件／服务端查询与本地订单一致后交付额度。

SDK 当前公开仓库 `package.json` 标为 `0.26.0`、要求 Node.js ≥20；这不是 npm 最新发布版本保证，真正安装前复核并锁定版本。认证式 checkout 实现串起会话令牌和结账会话，传入幂等键仅用于创建结账会话。[SDK README](https://github.com/waffo-com/waffo-pancake-sdk-ts)、[版本声明](https://raw.githubusercontent.com/waffo-com/waffo-pancake-sdk-ts/main/package.json)、[认证式 checkout 实现](https://raw.githubusercontent.com/waffo-com/waffo-pancake-sdk-ts/main/src/resources/checkout-authenticated.ts)。

底层结账接口为 `POST https://api.waffo.ai/v1/actions/checkout/create-session`，本项目优先调用认证式 SDK 封装。[官方接口示例](https://docs.waffo.ai/zh)。服务端请求采用 RSA-SHA256，相关头为 `X-Merchant-Id`、`X-Timestamp`、`X-Signature`；使用官方 SDK 生成，勿自行拼接签名。商户密钥与 webhook 验证用的平台公钥角色不同。[认证文档](https://docs.waffo.ai/api-reference/authentication)。

## 5. 签名 webhook、幂等交付与对账

Pancake SDK 的 webhook 使用原始 body 和 `X-Waffo-Signature` 验 RSA-SHA256；事件包含 `id`、`eventType`、`eventId`、`storeId`、`mode`。官方 SDK 指南的重放窗口为过去 45 分钟／未来 1 分钟，重试复用原始时间戳。生产明确指定 `environment: "prod"` 并检查 `mode`，不能依赖默认自动尝试测试公钥。[Webhook SDK 指南](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/webhook-guide.md)。

建议处理顺序：

1. 在精确 `/api/webhooks/pancake` 路由读取 `c.req.text()`，验证签名、环境、店铺；无签名、错环境、非本站订单拒绝或隔离，不能充值。
2. 验证订单 ID、商品、币种、实际付款及税费快照、用户归属。金额缺失进入待核，不补零、不拿标价替代实收。
3. 持久化接收事件，用 `(provider, environment, event.id)` 去重；再用支付业务 ID／本地订单交付唯一约束阻止不同投递重复发货。
4. 在同一数据库事务中完成“事件处理状态＋支付流水＋订单状态＋额度入账”，或先可靠入队再回 2xx。进程内 fire-and-forget 不算可靠队列；不能先标记已处理，再在事务外发货。
5. 同一事件重发返回成功但不重复加余额。数据库失败返回可重试错误；签名失败与处理失败分开记录。
6. 存储结构化必要字段及受控审计证据；日志不输出完整 payload、付款人资料、结账 token 或密钥。

一次性付款关注 `order.completed`；退款关注 `refund.succeeded`／`refund.failed`。若后续加订阅，付款流水和订阅权益分开处理，不能因初始付款与激活事件同时到达而双发额度。字段按锁定 SDK 的类型与真实沙盒载荷确认。

建议新增的数据模型：

| 表 | 最小职责与约束 |
|---|---|
| `billing_orders` | 用户、SKU／价格版本、币种／金额快照、渠道／环境、请求 ID、远端订单／会话、状态；请求键唯一 |
| `billing_payments` | 实收、税、费、远端支付 ID；渠道＋环境＋支付 ID 唯一；不把收入当净到账 |
| `billing_events` | 签名已验事件、业务 ID、接收／处理状态、错误与重试记录；投递 ID 唯一 |
| `credit_ledger` | 充值、预留、消耗、释放、退款冲销；追加式，以订单／任务业务键约束单次生效 |
| `billing_refunds` | 请求、审批、处理、成功／失败独立；累计退款与可退额度分开 |
| `billing_reconciliation` | 渠道订单／支付／退款与本地流水差异、检查时间、处理人；未知状态可恢复 |

金额在本地使用整数最小货币单位或精确 decimal，禁止浮点算钱；Pancake 适配器显式转其展示金额字符串。生成额度是独立整数单位，不能和美元余额混为一列。并发扣减须锁定账户或使用等效原子约束，保证不超用。

Pancake 退款采用工单流程：买家提交请求，商户后台审核，随后支付渠道处理；创建工单不等于退款成功。首期可由负责人在官方后台操作退款，应用监听终态并冲销额度，避免臆造一个 `client.refunds.create()`。[退款功能](https://docs.waffo.ai/features/refunds)、[SDK 退款工单参数](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/api-reference.md)。

部分退款、已消耗额度、退款失败和拒付的处置规则须先确定。付款成功和提现完成也分开：Pancake 财务页区分店铺收入、处理中与可提现净额，当前公开说明清算约 10 个工作日；实际按商户规则。[财务与提现](https://docs.waffo.ai/features/finance)。对账至少核本地订单、渠道支付、退款、净结算和实际提现五层；用业务外部 ID 联查，缺失／金额不符进差异表，不以 webhook 200 当资金已到账。

## 6. 官方资料中需避开的版本差异

| 2026-10-21 读到的差异 | 实施判据 |
|---|---|
| 通用 webhook 页面示例写 `event`、UUID；SDK 写 `eventType`、带前缀业务 ID | 依锁定 SDK 的类型和沙盒真载荷建解析；不拼接两版格式 |
| 官方 Skill 示例注释写默认 5 分钟，SDK webhook 指南写 45 分钟 | 以实际安装源码、重试窗口测试和渠道确认核定；不盲目缩短窗口导致迟到重试全部失效 |
| Skill 的示例金额为 number，SDK 指南区分字符串实收、标价、退款金额 | 用精确数值，缺失留空；不要把已弃用 `amount` 当所有事件唯一口径 |
| 官网营销示例出现不同 SDK 名称／Stripe 风格 price 字段 | Pancake 按 `@waffo/pancake-ts` 的实际 API 接；不复制营销动画代码 |

证据：[通用 webhook 页面](https://docs.waffo.ai/integrate/webhooks)、[官方 Skill](https://docs.waffo.ai/integrate/skill)、[SDK webhook 指南](https://github.com/waffo-com/waffo-pancake-sdk-ts/blob/main/docs/webhook-guide.md)。本轮只将 Skill 作为公开技术资料读取，未安装或执行。其示例中的仓库内 `.env` 做法不适用本项目，真实配置继续留仓库外。

## 7. Stripe、Waffo 企业服务与 Antom 的适配接口

共用业务层建议只定义 `createCheckout`、`queryPayment`、`verifyAndNormalizeWebhook`、`queryRefund` 等能力；退款发起、订阅和结算报表用显式 capability 声明。每个适配器保留原始渠道状态，不能把未知映射成失败。新增渠道不迁移用户，不共享渠道凭证，不自动把未明订单切去另一家重扣。

| 差异 | Stripe Checkout | Pancake | Antom 单笔支付 |
|---|---|---|---|
| 商品／金额 | 本地 SKU 映射 Product／Price，创建 Checkout Session | Product 与明确币种、展示金额字符串 | 自己维护商品；提交 `order`、`paymentAmount`、`paymentRequestId` 等 |
| 账户关联 | 本地用户与 Customer／订单映射 | 服务端 `buyerIdentity`、外部订单 ID | 本地订单与付款请求 ID 映射 |
| 完成判据 | 验签后核 `payment_status`；覆盖异步付款事件 | 验签后核业务订单／支付与环境 | 验签通知或 `inquiryPayment`；会话创建成功不等于付款；授权／扣款按所选方式区分 |
| 签名 | `Stripe-Signature`＋endpoint secret＋原始 body | RSA-SHA256＋平台公钥＋原始 body | `Signature`／RSA256，按官方规范处理 Client-Id、时间和消息内容；请求、响应、通知均需适配 |
| 退款 | Refunds API／后台，可能 pending 或失败 | 买家退款工单＋商户审核＋终态通知 | 按已启用产品的 refund／查询／通知 API；不得只凭受理结果冲销 |
| 沙盒到正式 | 独立测试资源，验证业务并完成激活 | 分环境 Key、webhook；商品 publish 后正式权限仍须满足 | 激活商户、开通付款方式、更换正式网关／Client ID／密钥、配置通知 |

Stripe 的订单交付必须可重复调用且不重复发货，异步支付不能只监听返回页；签名与退款各按本产品契约实现。[Stripe 交付](https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted)、[Webhook](https://docs.stripe.com/webhooks)、[退款](https://docs.stripe.com/refunds)、[账户激活](https://docs.stripe.com/get-started/account/set-up)。普通 Checkout 本身不能作为本项目已获得 MoR 税务服务的依据。

Antom 建议从单笔支付托管页面路线评估，接口参考 `POST /v1/payments/createPaymentSession`，完整网关来自对应环境；不同产品可能返回 `normalUrl` 或客户端会话数据，必须与选择的集成模式匹配。本轮没有确定 KakaReel 的 Antom 合同／产品配置。[单笔 API](https://docs.antom.com/ac/ams/session_cashier)、[托管页面流程](https://docs.antom.com/ac/aba/hosted_checkout)、[API 消息结构](https://docs.antom.com/ac/ams/api_fund)、[集成与上线](https://docs.antom.com/integration_guide)。

Antom 对账提供交易、待结算、结算汇总及明细等报告，可按结算批次核银行到账；报表权限与 SFTP 是否开通另核。支付服务、账户注册协助和资金回国是不同交付，不能由品牌名称互相推导。[报告](https://docs.antom.com/ac/merchant_service/reports)。Waffo 企业路线同样应先确认该商户获批产品和结算责任，本轮只核公开能力，没有企业 API 沙盒验证。

## 8. 2026-10-21 晚间前置任务与责任

下表是待执行清单，不是本轮完成声明。建议优先完成 A1～A3，B 类就绪后推进真实沙盒；正式开通不承诺当晚完成。

| 类别／责任 | 明确动作 | 可验收产物／依赖 |
|---|---|---|
| A1，工程今晚可做 | 固定一次性商品的通用 schema、订单状态、支付接口、价格版本 | 未配置时购买入口关闭；不依赖商户账号 |
| A2，工程今晚可做 | 订单／事件／额度账本迁移，精确 webhook 路由，mock Pancake adapter | 复用现有登录；能离线跑交易与失败回滚测试 |
| A3，工程今晚可做 | 用户绑定、重复／乱序回调、跨用户越权、错金额／币种／店铺／环境、原始 body 被改、重放与数据库故障测试 | 同一支付最多发一次额度；失败可恢复；全局 CSRF 没被放松 |
| A4，工程今晚可准备 | 退款／生成扣减设计、价格与 AUP／退款政策草稿、审核差距表 | 不擅定价格和退款规则；不声称审核系统已部署 |
| B1，需要用户 | 选择个人还是企业商户及提现主体，确认是否已有本项目商户／店铺 | 本人完成官方身份与业务资料；不复用其他项目密钥 |
| B2，需要用户 | 决定售价、额度、可用模型、有效期、已消耗额度退款、预览额度如何并存 | 一个明确可售 SKU 与获准商业条款；实际模型成本在私下核 |
| B3，需要用户／部署负责人 | 在仓库外或部署平台配置测试 Key、商户／店铺／商品映射，授权沙盒测试窗口 | 不在公开文档填真实值；本轮未读取／配置 |
| C1，需要渠道方 | 核 AI 视频业务准入、审核材料、提示词与输出审核要求、个人／企业及国家地区资格 | 书面准入清单与审核结果；不以通用网站介绍代替 |
| C2，需要渠道方 | 确认生产权限、付款方式、税种、实际费率、结算周期、限额／准备金、退款与拒付规则 | 项目适用条款；无答复不得填“已开通” |
| C3，需要渠道方 | 核当前 SDK／文档差异、webhook 字段／重试、商户后台可查询的测试完成标志 | 用真实沙盒订单形成完整验收记录；官方示例事件不等于订单测试 |
| D，工程待 B／C 就绪 | 测试商品、成功／拒绝支付、断回调重试、退款、重启和对账 | 仅沙盒，记录订单与账本结果；没有资源时保持未验证 |

## 9. 沙盒与正式验收界线

Pancake 测试数据隔离，测试 webhook 正常发送；API Key 创建时即区分测试／正式，不能只改一个 header 认为已切换。测试商品通过 publish 同步到正式，正式使用不同密钥与对应 webhook 配置。[Test Mode](https://docs.waffo.ai/features/test-mode)。

沙盒验收要求：登录 A 购买后只给 A 加额度；改单价／用户 ID 无效；重复点击与重复回调只生效一次；付款页关闭仍能交付；拒绝支付不发额度；回调迟到／丢失可查询恢复；部分退款与退款失败不造成双重冲销；生成成功扣一次、明确失败释放、未知状态不提前释放；重启后状态不丢。沙盒充值必须不能获得真实付费推理额度，测试视频提供方仍使用 mock 或隔离测试账户。

正式收款的放行条件：获批商户与产品、生产配置回读、价格及条款发布、内容审核实施、订单和额度隔离测试完成、退款入口及对账责任明确。首次真实交易须另获明确授权；本任务禁止真实支付，因此没有执行。真实交易、真实退款及实际提现尚未验证，不能在公开 README 写“支付已接入”或声称已有收入。

## 10. 本轮研究范围

公开依据为上文所链的 Google、Waffo／Pancake、Stripe、Antom 官方页面和 Waffo 官方 SDK 仓库，访问日期为 2026-10-21。`llms.txt`／`llms-full.txt` 本轮抓取不可用，改读具体官方页面；部分官方页面存在版本差异，已列出。未安装 SDK、未执行官方 Skill／CLI、未触碰商户后台或生产环境。

本文件只包含公开可核能力、本项目源码观察及通用实现建议。不包含商务合作条件、私有资料、内部联系人、真实配置或其他项目的接入记录。
