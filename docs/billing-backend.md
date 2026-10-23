---
title: "KakaReel 一次性积分包与支付后端"
date: 2026-10-23
source: "主会话 2026-10-23 官方沙盒与邮箱回读；本地完整测试日志；当前代码"
status: "168 项测试通过；首笔零税额官方沙盒付款已核；worker 空库启动与生产库备份已核；退款 unknown 冻结中，待发布验收，正式收费关闭"
---

# 现行范围

江昪已确认 Starter Pack：US$19／150 credits、一次性、无自动续费、积分不过期、税外标价、14 天内整包未使用可申请全额退款，本站不额外收退款手续费。只有一档商品。源码常量在 `src/lib/credit-offer.ts`，八项文生规格的公开费率在 `src/lib/video-credit-rates.ts`；成本与来源见[定价报告订正](research/2026-10-21-video-pricing.md#2026-10-23-现行决定与成本订正)。图生不外推文生报价。

本轮集成订单、Pancake adapter、权益批次、报价、预留、结算、退款申请和恢复工具。**实现、离线测试、真实渠道沙盒与上线验收是四个状态。** 正式销售仍被服务端禁止，`GENERATION_CHARGING_ENABLED=false`；生产不能仅靠添加环境变量开启收费。Pancake 测试商品的“销售中”不代表 KakaReel 正式开售。部署及最终验收看 [launch.md](launch.md)。

## 2026-10-23 已验与未验

以下是本轮主会话确认的验收快照；代码已准备提交，尚待生产部署验收，既有线上预览不等于已运行本轮补丁。

| 项目 | 已取得的证据 | 边界与下一步 |
|---|---|---|
| 完整本地测试 | `/private/tmp/kakareel-tests-final.log`：168 passed、0 failed、0 skipped，已回读汇总 | 数据库与 mock／fake provider 测试不能替代官方渠道和实物视频交付；独立测试库入口见[部署说明](deployment.md#完整测试的独立数据库) |
| worker 镜像与空库 runtime | Dockerfile `worker` target 构建 passed；非 root UID 1000；空 `video_worker_qa` 完成 start → 5 项迁移 → once，退出码 0、jobs 0，无上游 Key | 已验空库启动链路；有任务恢复、重启幂等与生产常驻仍须另验 |
| 生产库备份 | 主会话经授权 `pg_dump` 到既有卷；26722 bytes，`pg_restore --list` 可读、输出 72 行 | 不公开实际路径；备份目录可读不等于已完成恢复演练 |
| 公开客服 | [support@kakareel.com](mailto:support@kakareel.com) 的 Cloudflare 转发 Active；用户实际收信完成 Pancake 邮箱验证，主会话已回读 | 仅公开客服地址，不公开内部转发目标；处理责任和响应流程仍需明确 |
| 官方 Pancake 沙盒付款 | 首笔 USD19 测试支付成功；authenticated GraphQL 查询原订单确认 paid，小计 1900、税额 0、总额 1900；本地已入 150 测试积分 | 金额为 USD 最小货币单位；不是正式收入。税额为 0 的交易不能证明有税结账正确，查询对账成功也不能证明 webhook 送达 |
| 该单退款 | 当前状态 unknown；对应 150 测试积分冻结；只读诊断确认原付款成功、金额匹配，两种查询均未观察到工单或退款记录；未重复提交退款 | 未核退款终态／到账，不解冻、不冲销、不重提；主会话继续核原退款请求及原订单 |
| 发布与放行 | 正式收款和生成收费保持关闭 | 本轮待发布验收，主会话等待退款诊断代码停写后统一提交；退款／webhook、有税交易、生产 worker 与正式视频交付仍未验收 |

验收记录只保留状态和金额，不记录实际订单、用户、商店、工单、部署等私有 ID，也不记录 checkout token、密钥、配置值或内部转发目标。上述日志为本机临时证据，不当作永久归档；正式发布后由主会话补部署版本与行为验收。

## 前端契约与身份

公共类型位于 `src/lib/billing.ts`；不导出 SDK、签名、私钥或 checkout token。所有响应 no-store；身份取已验证 Google 会话，客户端 userId、价格、积分、付款结果均非可信来源。

| 接口 | 行为 |
|---|---|
| `GET /api/billing/catalog` | 公开 US$19／150 积分和未开售状态；含 catalog／provider 的 test、live 或 null 环境 |
| `GET /api/billing` | 本人正式／测试钱包分别展示可用、预留、blocked；测试异常不能阻断正式钱包 |
| `GET /api/billing/orders` | 本人最新 50 单；尚无分页 |
| `GET /api/billing/orders/:id` | 本人订单；越权与不存在同为 404 |
| `POST /api/billing/checkout` | 仅开放的隔离测试环境可创建；服务端白名单商品与价格，固定 requestId 幂等 |
| `POST /api/billing/orders/:id/refund` | 本人整包未用退款申请；冻结对应批次后提交渠道工单，不把 pending 当到账 |
| `POST /api/billing/webhooks/:provider` | 原始 body 验签；仅四个确切 POST 路径豁免普通 Origin 检查，未知路径不豁免 |
| `POST /api/jobs/quote` | Google 本人，完整生成参数、requestId、5 分钟报价；未核价／未开放／余额不足明确不可用 |
| `POST /api/jobs` | 默认 preview；paid 必须显式选择、有效 quoteId、同账号及足额正式余额 |

浏览器 mutation 保留 exact Origin、Sec-Fetch-Site 与 `X-KakaReel-Owner` 一致性校验；该头不是授权来源。前端切换账户后丢弃旧账单和报价。报价绑定 requestId、提示词、输入图片引用、模型、模式、时长、分辨率、声音等所有已验证参数；提交必须复用同一 requestId，改变参数或过期须重新报价。

订单公开小计、税额、总额、实付，未知税额／实付用 null，不写成零。返回页只读本人订单，URL 的 success 参数不会发积分。渠道 checkout URL 只瞬时返回，不能入公开日志／文档。

## 支付、税与对账

固定 `@waffo/pancake-ts@0.26.0`，使用真实 SDK authenticated checkout。商品税类别为 SaaS，`taxIncluded:false`。SDK 类型缺少该属性但运行时可转发；必须用真实沙盒核实结账与返回税额，不能只凭本地请求 fixture 宣称完成。`1900` 是未税 USD 小计，不是未知地区的最终实付。

Pancake 验签使用显式项目环境的平台公钥，RSA-SHA256 验原始字节、严格签名时间窗、拒绝重复 JSON key。核 store、test/prod、外部订单、buyer UUID、币种、实际 chargedAmount／refundedAmount 与税额快照。商户 metadata 只是签名覆盖的商户回显，不能当渠道独立观察的商品证据。Pancake 事件没有 checkout session ID，使用独立 evidence 分支；其他渠道仍保留 checkout ID 绑定，不能伪造一个 ID 绕过。

成功须满足小计＋税＝总额＝实付，且小计等于本地商品快照。实际金额缺失、部分退款或冲突写入 review 状态并阻断相应环境钱包，不补造收入或丢弃外部资金事实。完整外部退款在积分已消费时仍落账，记录债额／限制后续生成，不向用户自动补扣现金。

事务锁顺序为钱包 → 订单／任务 → 批次。订单、事件、付款唯一约束与 purchase／refund 账本保护重复及乱序；数据库错误整体回滚。供应商网络调用在事务外，checkout lease 为 60 秒，同订单始终用原幂等键。订单创建超过 23 小时停止创建请求，先查询原订单，不越过渠道幂等窗口重扣。

GraphQL 恢复通过 SDK `graphql.query` 查询原订单和实际收款，不信返回页。2026-10-23 已用专用测试密钥取得真实 schema，确认实体环境字段为 `testMode`，不是推测的 `mode`／`environment`。恢复查退款优先于成功付款，避免已退款订单短暂给出可消费积分。实际 PSP 金额缺失仍待核，不拿 snapshot 代替实收。完整付款时间恢复须同步订单和权益批次，退款窗口按实际付款时间计算。

## 积分、生成与失败

`0004-credit-wallet.sql` 新增钱包、购买批次、报价、任务预留分配及审计记录；`0005-pancake-bridge.sql` 增量扩展金额、退款与证据字段。历史迁移不改写，用户和视频保留。旧非终态预览任务在迁移中标记已开始提交，worker 只查原任务，不再次 POST。

- 同一次请求的任务创建、报价使用和 FIFO 批次预留在同一事务中完成；并发不能超支。
- 正常处理中保持 reserved。明确失败 release 一次；上游成功且结果经交付检查才 capture 一次。
- 交付检查采用 HTTPS、有界 ranged GET、视频 MIME＋容器文件头；DNS 检查并固定连接地址，拒绝私网／重定向。它证明链接当下返回视频内容，不等于完整解码、内容安全审核或永久存储。
- 网络超时不是失败；保持原任务 ID 查询，不新建付费任务。持久 lease＋token 防止过期 worker 结算。
- 超过 24 小时仍不明转人工 review；操作者可查原任务或带原因释放。补偿后迟到成功不能自动重新扣积分。
- 测试余额只可用于注入的 fake provider；真实 worker 拒绝 test 任务。预览继续按邀请权限和既有日次数限额。
- 上游已收费但本站无法交付，未追回成本由本站承担。积分释放不调用现金退款；用户主动重新生成是新任务。

`credit-worker.ts` 支持 `run`、`once`、`review`、`poll JOB_UUID`、`release JOB_UUID OPERATOR REASON`。`review` 列待处理任务，release 只接受超过 24 小时的未解决预留且追加审计记录。Compose 新增独立 worker，与 Web 共用数据库和迁移锁；没有公网 worker 端口或未认证操作 HTTP 接口。

## 现金退款

申请条件为付款后 14 天、整包未消费且无预留。先冻结购买批次，再用官方 customer refund ticket API 创建工单，幂等键固定。pending／processing／unknown 不释放冻结；明确失败或拒绝解冻，真实全额退款成功才冲销。商户审批仍由真实 Pancake 后台处理，不虚构 SDK 审批接口。

退款工单、现金成功事件、积分消费是独立状态。重复回调不重复冲销；先退款后付款保持退款终态。人工 review hold 按订单记录，解除一个订单不能误清另一个订单的阻断。

## 测试配置与操作

Pancake 测试商店、一次性商品与测试密钥已于 2026-10-23 创建。真实配置仅存库外受限目录或部署环境；公有仓库只列变量名。测试部署要求独立数据库、独立角色、明确 test 环境；代码既校验 URL，也查询实际 current_database/current_user。名称分别须以 `_billing_sandbox`、`_billing_test` 结尾。

环境变量见 `.env.example`。`sandbox-smoke.ts` 提供 `inspect / seed / checkout / reconcile / refund / refund-diagnose`：inspect 只读 schema，其他操作验证实际沙盒库身份。输出目录必须位于仓库外、0700；输出新建且0600，可能包含结账 token，不得截图、打印或提交。工具不会自己加载凭证，也不会自动开生产销售。

退款／原任务恢复是可用的操作入口，不是已经建立持续运营值班。首笔零税额官方沙盒付款与 authenticated 查询入账已验；退款仍 unknown、150 测试积分冻结，未重提。带税结账、回调送达、退款到账与生产实物视频交付仍须分别验收，由主会话接续；本轮文档更新不操作渠道或部署。

## 开售前仍需完成

1. 首笔零税额官方沙盒成功付款已核；继续完成拒绝、重复／丢失回调、重启恢复、有税交易、退款闭环与跨用户隔离的真实渠道验收。当前退款 unknown 保持原请求和冻结，不以再次申请替代查询。
2. 各开放视频规格的真实生成交付；新费用预算须另行批准，不能复用已因失败停止的旧授权。
3. 原子全局金额预算、成本记录与供应商涨价停用流程；当前日次数限额不能代替金额预算。
4. 生成前输入审核、展示前输出审核、公开 AUP／举报处置、素材授权和本业务商户准入。
5. `support@kakareel.com` 已验证可收信；继续明确支持处理责任、响应流程和结果保留策略，不承诺永久存储。
6. 所有验收通过后，另行正式放行销售和生成收费；测试密钥不用于生产。

## 订阅扩展边界

订阅后续新增独立状态、周期、取消生效时刻、渠道 customer／subscription 关联和每周期付款／发放唯一键。继续复用用户、订单、付款事件和权益批次；生成只消费统一钱包，不判断订阅供应商。一次性购买不会被改成自动续费，退款不等于取消订阅。

历史基线：2026-10-21 基础版本 `9ae7ca4` 已上线，74 项测试通过；当时商品无价格、SDK 未桥接、没有生成钱包。其状态已被本文的 2026-10-23 工程进度取代，不将旧验收数量套用到本次改动。
