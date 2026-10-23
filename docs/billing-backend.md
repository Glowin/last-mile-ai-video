---
title: "KakaReel 一次性积分包与支付后端"
date: 2026-10-23
source: "2026-10-23 Pancake 官方沙盒页面、实际签名回调、隔离数据库与本地测试日志"
status: "沙盒付款、商户退款及退款回调重启后幂等已验；原单冻结 150，买家退款 403 待解；本机资源已清理，后台临时 Webhook 待删除确认；有税及生产运行待核，收费关闭"
---

# 现行范围

江昪已确认 Starter Pack：US$19／150 credits、一次性、无自动续费、积分不过期、税外标价、14 天内整包未使用可申请全额退款，本站不额外收退款手续费。只有一档商品。源码常量在 `src/lib/credit-offer.ts`，八项文生规格的公开费率在 `src/lib/video-credit-rates.ts`；成本与来源见[定价报告订正](research/2026-10-21-video-pricing.md#2026-10-23-现行决定与成本订正)。图生不外推文生报价。

本轮集成订单、Pancake adapter、权益批次、报价、预留、结算、退款申请和恢复工具。**实现、离线测试、真实渠道沙盒与上线验收是四个状态。** 正式销售仍被服务端禁止，`GENERATION_CHARGING_ENABLED=false`；生产不能仅靠添加环境变量开启收费。Pancake 测试商品的“销售中”不代表 KakaReel 正式开售。部署及最终验收看 [launch.md](launch.md)。

## 2026-10-23 当前接续状态

本表为当前验收状态；下节保留较早历史快照。当前仅完成部分官方沙盒验收，未取得真实资金、生产权限或有税交易验证，正式收费保持关闭。

| 项目 | 本轮已核事实 | 当前边界与接续 |
|---|---|---|
| 测试账本与回调入口 | 已将原沙盒账本恢复到独立本机 PostgreSQL；新增临时 loopback-only webhook 接收器，经 Cloudflare HTTPS 测试隧道接收回调，只订阅 `order.completed`／`refund.succeeded` | 这是临时沙盒入口，不是生产 webhook 部署；本机端点现已离线，后台记录待删除确认，见清理行 |
| 新官方测试付款与税 | 新订单实际付款 USD19 成功；选择 DE、非企业，payload `billingDetail.country=DE`，但 `listPrice` 的税额为 0、`taxName=None`，总额仍为 USD19 | 国家字段已返回不等于税已正确征收；本次仍为零税额交易，有税验收未过 |
| 付款 webhook 与幂等 | 官方签名 webhook 在未调用 `reconcile` 前完成数据库入账 150 credits；后台第二次重投同一事件，返回 HTTP 200、`outcome=duplicate`；purchase 总计仍为 300 credits／2 笔（包含此前原单 150） | 已证明本次付款回调送达、入账与重复投递不重复发积分；退款回调及 receiver 重启后幂等另见下行；不外推为丢失回调或 worker 任务恢复已验 |
| 独立拒付测试 | 此前独立测试卡拒付已在页面显示支付失败，该拒付新单未发积分 | 不与本轮成功订单混为同一笔 |
| 新成功单买家端退款提交（历史步骤） | 随后 `reconcile` 回读付款时间与金额，再对该单调用一次 `requestRefund`，明确返回 `PANCAKE_REFUND_SUBMISSION_HTTP_403`；买家 session 正常，customer GraphQL 可读同单；当时只读 diagnosis 为 0 tickets／0 refund | 买家端退款提交 HTTP 403 仍为独立待解问题；不证明其根因，也不把原 unknown 单归为同一原因；随后商户退款结果见下行 |
| 新单商户退款与签名回调 | 商户后台仅提交一次新测试单全额 USD19 退款后，真实 `refund.succeeded` 签名回调返回 HTTP 200、`outcome=applied`；隔离数据库中新单为 `refunded/succeeded`，自动冲销 150 credits；商户 UI 已显示已退款 USD19 | 已验本次沙盒商户退款 → 签名回调 → 数据库冲销；不代表买家端提交 403 已解决或真实资金退款已验 |
| 退款回调重启后幂等 | 主动停止并重启本机 receiver，复用同一沙盒数据库；后台重投 `refund.succeeded` 返回 HTTP 200、`outcome=duplicate`，尝试次数 2；DB refund ledger 仍仅 1 条、-150 credits | 退款回调重启后幂等已通过；未重复冲销，不外推为生产 worker 常驻或任务恢复已验 |
| 当前订单与账本 | 隔离数据库：原旧单 `paid/unknown`，新单 `refunded/succeeded`，拒付单 `pending/none`；`payment.succeeded/applied` 共 2 条（含原旧单），`payment.refunded/applied` 1 条；ledger purchase 合计 300 credits（2 条），refund 为 -150 credits（1 条） | 当前仅原旧单 150 credits 仍冻结，不重提、不解冻；拒付单没有发积分，页面失败不改写为数据库失败终态 |
| 重投后批次状态 | 原批次 150 credits、`refund_frozen=true`；新批次 150 credits、`refunded=true` 且 `refund_frozen=false`；reserved／consumed／debt 均为 0 | 仅原旧单仍冻结，新单退款冲销未误解冻原批次 |
| 本轮工程验证 | 新增退款 session 响应验证及 SDK 错误来源区分（`pancake.ts`／相关 tests）；30 项定向测试、8 项新 receiver 测试与 build 通过 | 与此前 168 项全测、27 项诊断测试分开记录，不合称新一轮全测；未确认本轮补丁已部署 |
| 备份与本机清理 | 新沙盒账本另存既有库外材料目录的新文件，未覆盖旧备份；`pg_restore --list` 检查可读，排除 auth session／token 数据；5 张验收截图已归档。receiver 与 HTTPS tunnel 正常退出，本轮 Docker 沙盒容器已 stop／rm，3026 无 listener，其他项目容器未动 | 备份可读不等于完成恢复演练；截图、备份实际路径及测试 ID 留库外 |
| 临时 Webhook 后台记录 | 页面无停用开关，取消全部事件后保存按钮禁用，不能保存 0 事件；已按浏览器删除确认规则向用户申请删除本轮临时测试 Webhook，等待答复 | 后台记录未删，端点现在不在线；后续测试前须处理该记录与端点，不能宣称已停用或全部清理完成 |
| 生产与部署 | 生产未改配置、未开放收费；Dokploy 登录已过期，已请用户重新登录 | worker 常驻及生产迁移数仍待核；既有部署的 Started 日志不能替代当前验收 |

### 简短接续操作说明

1. 原 unknown 单仅按原请求只读核查，不重提、不解冻；买家端提交 403 单独排查，不以商户退款成功推定买家入口已修复，也不将其作为原单根因。
2. 等待用户确认删除临时 Webhook；确认后处理后台记录并回读结果。后续测试前核对记录与端点状态，不向当前离线端点继续投递。
3. 恢复 Dokploy 登录后核生产 worker 常驻及实际迁移数；继续有税交易、丢失回调、worker 任务恢复等验收，生产配置与收费保持关闭。

## 2026-10-23 较早验收快照（历史）

以下保留主会话同日较早确认的事实；其中单笔冻结、webhook 未验、资源已清理及 Dokploy 页面占用原因均属当时状态，不代表本轮当前状态：`715e6b0` 已推送 main，Dokploy 完整日志为 `Docker Compose Deployed ✅`，新 Web／worker 显示 Started。线上定价与接口已核；worker 常驻状态和生产迁移数仍未回读。

| 项目 | 已取得的证据 | 边界与下一步 |
|---|---|---|
| 完整本地测试 | `/private/tmp/kakareel-tests-final.log`：168 passed、0 failed、0 skipped，已回读汇总；新增诊断另有 27 项定向测试通过，最终 build／tsc 通过 | 数据库与 mock／fake provider 测试不能替代官方渠道和实物视频交付；独立测试库入口见[部署说明](deployment.md#完整测试的独立数据库) |
| worker 镜像与空库 runtime | Dockerfile `worker` target 构建 passed；非 root UID 1000；空 `video_worker_qa` 完成 start → 5 项迁移 → once，退出码 0、jobs 0，无上游 Key | 已验空库启动链路；有任务恢复、重启幂等与生产常驻仍须另验 |
| 生产库备份 | 主会话经授权 `pg_dump` 到既有卷；26722 bytes，`pg_restore --list` 可读、输出 72 行 | 不公开实际路径；备份目录可读不等于已完成恢复演练 |
| 公开客服 | [support@kakareel.com](mailto:support@kakareel.com) 的 Cloudflare 转发 Active；用户实际收信完成 Pancake 邮箱验证，主会话已回读 | 仅公开客服地址，不公开内部转发目标；处理责任和响应流程仍需明确 |
| 官方 Pancake 沙盒付款 | 首笔 USD19 测试支付成功；authenticated GraphQL 查询原订单确认 paid，小计 1900、税额 0、总额 1900；本地已入 150 测试积分 | 金额为 USD 最小货币单位；不是正式收入。税额为 0 的交易不能证明有税结账正确，查询对账成功也不能证明 webhook 送达 |
| 该单退款 | 当前状态 unknown；对应 150 测试积分冻结；只读 diagnosis 实际成功，结果 0 tickets／0 refund；payment succeeded、金额匹配；未重复提交退款 | 未核退款终态／到账，不解冻、不冲销、不重提；主会话继续核原退款请求及原订单 |
| 发布与放行 | `715e6b0` 已部署；线上 catalog 为 USD 1900 最小货币单位／150 credits，`checkoutEnabled=false`，全部 provider unavailable；服务端实际收费保持关闭 | Web／worker 仅有 Started 日志；观察到 Dokploy 标签页在本会话未操作时连续切换，为避免干扰，主会话停止该页，worker 常驻状态及生产迁移数待回读。退款／webhook、有税交易和正式视频交付仍未验收 |
| 线上页面与 probe | `/pricing` 已视觉验收 US$19＋适用税费、八项费率及客服链接；`/pricing`、`/terms`、`/privacy`、`/create`、`/api/health`、`/api/billing/catalog` 均 200；前三页 support mailto 命中，create 的 `Generate preview video` 命中；匿名 billing／jobs 均 401 | 页面／接口验收不等于真实收费或生产 worker 常驻已验 |

验收记录只保留状态和金额，不记录实际订单、用户、商店、工单、部署等私有 ID，也不记录 checkout token、密钥、配置值或内部转发目标。上述日志为本机临时证据，不当作永久归档；本轮部署版本与已验行为如上；待确认 Dokploy 页面空闲后由主会话回读 worker 常驻状态及生产迁移数。测试 dev 已停；排除 auth 数据的沙盒账本已库外备份，本轮临时 PostgreSQL 容器与 worker 测试镜像已清理，其他项目容器保留。

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

退款／原任务恢复入口不代表已建立持续运营值班；验收结果、冻结状态及清理待办统一见[当前现状表](#2026-10-23-当前接续状态)。

## 开售前仍需完成

1. 完成丢失回调、worker 任务恢复、有税交易、买家端退款提交问题与跨用户隔离的真实渠道验收；已验项及原单冻结边界见上方现状表。
2. 各开放视频规格的真实生成交付；新费用预算须另行批准，不能复用已因失败停止的旧授权。
3. 原子全局金额预算、成本记录与供应商涨价停用流程；当前日次数限额不能代替金额预算。
4. 生成前输入审核、展示前输出审核、公开 AUP／举报处置、素材授权和本业务商户准入。
5. `support@kakareel.com` 已验证可收信；继续明确支持处理责任、响应流程和结果保留策略，不承诺永久存储。
6. 所有验收通过后，另行正式放行销售和生成收费；测试密钥不用于生产。

## 订阅扩展边界

订阅后续新增独立状态、周期、取消生效时刻、渠道 customer／subscription 关联和每周期付款／发放唯一键。继续复用用户、订单、付款事件和权益批次；生成只消费统一钱包，不判断订阅供应商。一次性购买不会被改成自动续费，退款不等于取消订阅。

历史基线：2026-10-21 基础版本 `9ae7ca4` 已上线，74 项测试通过；当时商品无价格、SDK 未桥接、没有生成钱包。其状态已被本文的 2026-10-23 工程进度取代，不将旧验收数量套用到本次改动。
