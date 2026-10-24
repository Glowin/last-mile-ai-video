---
title: "生成任务全局成本预算与停用闸门"
date: 2026-10-25
source: "本轮工程实现、合成数据 PostgreSQL 集成测试；非上游真实扣费验收"
status: "成本 app／runner 接入及隔离验收完成；审核整合、生产配置与上线待主会话"
---

# 边界与金额语义

`src/server/costs/index.ts` 与 `db/0006-generation-cost-budget.sql` 实现独立的 PostgreSQL 成本控制。它不调用供应商、不读取账户或价格网页，不自动加载或推断报价。迁移后预算默认关闭，无任何预置费率；未配置、过期或未核价均不能得到新提交许可。旧任务查询与结果／成本记录不受预算停用影响。

所有金额为 **CNY 分整数**，不是用户 credits 或人民币元；`600` 表示 ¥6.00。API 拒绝负数、浮点数、非安全整数。预算为全服务累计风险额度：预览、付费用户、不同模型共用一个上限；不因午夜或更新有效期重置。需要增加累计额度时显式调整 cap，旧任务继续占用。它不是用户钱包或供应商余额。

- `reservedMinor`：提交前核定的单次最大可能收费，不是猜测均价。
- `exposureMinor`：占用风险额度。提交前为预留上限，已开始提交后至少保留该上限；已核实际收费更高时增加。
- `actualMinor`：有独立供应商最终收费证据才填写；未知保持 `null`。生成成功、失败、返回 HTTP 错误均不能推出实际扣费为零。
- 失败退还用户积分不减少本表风险额度；已提交任务实际收费较低或有零收费证据，仍不自动回收额度。真实成本与保守预算占用分别展示。
- 本轮没有供应商退款抵扣／更正已核最终账单 API，不能手工将 `exposure_minor` 清零。需要更正时另做有证据的审计迁移，不能伪装成任务未提交。

数据库 `generation_cost_budget` 单行 `FOR UPDATE` 串行化所有预算、报价、预留、提交和费用写入。原子事务同时更新全局占用、任务快照和审计；并发任务不能超额。允许记录已发生的真实超支，随后关闭对应规格的新任务；不能因超过 cap 而回滚资金事实。数据库保存不可变费率版本及任务快照。

# 主会话集成契约

所有写 API 必须在 `database().transaction(async tx => ...)` 内调用，不把普通 db 伪装成 tx，不捕获错误后继续提交半成品。事务内禁止网络请求。统一锁序：**全局成本预算 → 用户钱包 → video job**。如果现有入口先锁钱包／job，再调用成本模块，必须调整；否则与任务创建入口形成反向等待。

| API | 集成位置与约束 |
|---|---|
| `lockGenerationCostBudget(tx)` | 在同时写钱包／job 的事务最开始获取；后续成本 API 重入同事务锁是安全的 |
| `reserveGenerationCost(tx, {jobId, fingerprint, spec})` | `POST /api/jobs`：服务端验证参数后，和任务创建、积分预留在同一事务中；任务 UUID、完整请求指纹与精确规格绑定。同一任务重试仅回原记录，不代表允许重新 POST |
| `markGenerationSubmission(tx, jobId)` | runner 的 claim 事务：和 `submissionStartedAt`、lease 写入一起提交；仅返回 `maySubmit:true` 的调用者可在事务提交后执行一次供应商 POST。返回 false 必须查原任务，不能 POST |
| `releaseUnsubmittedGenerationCost(tx, {jobId, actor, evidenceRef})` | 确认本地拒绝、并且任务从未被标记提交时释放。`submitted` 不可释放，包括网络超时、HTTP 错误、死 worker、审核拒绝、用户退款 |
| `recordGenerationOutcome(tx, {jobId, outcome, evidenceRef})` | runner 在验证任务身份、lease 后记录 unknown／success／failed；成本占用不变。unknown 可转终态，冲突终态报错，重复终态幂等 |
| `recordActualGenerationCost(tx, {jobId, amountMinor, evidenceRef, actor})` | 有供应商最终收费证据时调用；同证据同金额幂等，冲突拒绝。返回 `priceIncreased:true` 时停用已在事务内写入，必须提交，不能用抛错回滚该停用 |
| `getGenerationCost(dbOrTx, jobId)`／`getGenerationBudget(dbOrTx)` | 只读，用于后台诊断和原任务恢复，无新预留、无供应商 POST。不得直接开放成未授权的用户跨账号查询 |

`CostSpec` 必须提供全部字段：`provider`、精确 `model`、`mode`、`duration`、`resolution`、`audio`、`ratio`。当前输入的每个组合均精确匹配，没有默认费率、忽略声音的回退、文生价格套用图生或自动模型替换。`fingerprint` 使用现有 `generationFingerprint` 的完整请求指纹，不能取客户端价格、用户输入的成本或仅提示词。新增影响费用的参数必须先扩展此结构／版本再开放；多图、批量、自动重试不在本轮契约内。

**接入要覆盖所有真实供应商 POST，包括预览生成。** fake provider 的隔离测试不必走真实预算。旧任务没有成本快照时仍可查询原任务；不得为已开始的旧任务补一个新 reserve 然后再次 POST。历史供应商费用导入不在此模块范围内，初始化预算之前须在运营侧核已发生费用和剩余授权额度。

提交标记后崩溃可能实际上尚未发出 POST，此时仍保持占用并查询原任务；这是一项保守选择。已标记提交的进程与停用配置可能交错，停用只保证不会再发放新提交许可，不能撤回已经发放／已在途的请求。任何自动重试逻辑都不得重用这个许可发送第二次 POST。

# 价格确认与停用

1. 可信运维读取已登录生成页的**对应完整参数单次报价／最终账单**，保存库外证据。把经过核准的最大成本输入 `confirmGenerationRate`；这里没有自动抓取上游价格功能。
2. 确认必须包含 `sourceRef`、`observedAt`、`validFrom`、`expiresAt`、`actor` 和 `expectedRateId`。来源引用只填不含密钥、登录链接或个人资料的证据索引；引用本身不能代替人工真实性检查。
3. 每个规格独立有效期；过期立即拒绝新预留和未提交任务。任务快照保留原版本、原来源、观察／生效／失效时间与确认人。
4. `observeSupplierPrice` 登记可信外部观测：超过当前已确认上限时持久化停用。同样返回 blocked，不以异常回滚停用；较低的新报价不会自动清除既有停用。观察时间不能在未来，旧观察不能覆盖新观察。
5. `recordActualGenerationCost` 在最终费用超过任务快照时同样停用规格，并补记超支。全局占用超过 cap 后其余新任务也会因预算不足被拒绝。
6. 恢复必须重新确认，核现行 rateId（乐观锁），且新证据不能早于旧确认／最新观测，确认上限不能低于已知观测。新版本不会修改旧任务快照；旧版本未提交任务被 `COST_RATE_CHANGED` 拒绝，必须先本地释放、由用户重新发起新任务，而不是静默增加成本或积分。
7. `configureGenerationBudget` 需 `expectedRevision`、显式 enabled／cap／有效期和审计依据。默认无配置不放行；补配置不会重置任何占用。没有环境变量自动启售入口。

本轮未填入生产真实费率、预算额度或账户配置，也没有将公开零售 credits 反推成上游成本。

# 验收与未做项

测试入口：`tests/generation-cost-budget.integration.test.ts`。仅接受 `GENERATION_COST_TEST_DATABASE_URL` 指向 `127.0.0.1:55441`、数据库 `kakareel_cost_55441_sandbox`、角色 `kakareel_cost_55441_test`；连接前核 URL，执行 DDL 前再核 `current_database()`／`current_user`。测试仅重建自己命名的五张表，使用合成数据，禁止外部 fetch。不继承生产 `DATABASE_URL`。

2026-10-25 已执行真实 PostgreSQL 16 测试，20 项通过、0 失败、0 跳过；范围为：并发全局限额、同任务幂等、指纹／规格绑定、事务回滚、一次提交许可与新连接恢复、release／submit 竞争、未知与失败保留额度、本地拒绝仅释放一次、供应商涨价阻断、过期阻断且旧查询可用、实际费用超支停用、较低实扣不恢复预算、修订冲突和迟到终态。无真实模型调用、无生产数据库、无真实配置。

主会话仍需：整合独立审核模块并复验锁序／结果放行；核报价与初始化累计预算；覆盖线上 worker 重启行为；建立人工价格复核及账单核对的负责人／频率；执行迁移、部署并验收。隔离测试通过不能称为线上预算已启用。


# 成本接线现状（2026-10-25）

`app.ts` 的所有 live 新任务（含 preview）在同一事务预留成本、插入 job、预留付费积分。成本锁先于钱包和 job；fake transport 不申请真实成本预算。成本规格 provider 固定为 `vibetoken`，model 使用 `providerPayload(x).model` 的精确供应商模型 ID，其余字段来自已验证的 `GenerationInput`。成本快照使用 `generationFingerprint(x)`；旧预览 job 的历史指纹保持兼容。

`runner.ts` 在 claim 事务内再次核价并提交一次性许可，然后才允许事务外 POST。无成本快照的历史任务只在已开始／已有 upstream ID 时查询；未开始的历史任务不会补建快照或获得 POST 许可。排队后预算／费率过期、费率版本改变或停用时，事务释放未提交成本及用户预留积分，写入 `cost-local-rejection` 审计并保持 `unknown + reviewRequired`。这是已确认的本地未提交拒绝，不伪称供应商生成失败；强制恢复也不能逃出该 hold。手工释放确实未提交的旧任务同样释放两侧预留。

提交后未知、明确失败和成功都保留成本风险额度，实际扣费一直为 `null`，直到有独立最终账单证据。预算关闭不阻止旧任务查询、结果记录或积分结算。同一请求重放返回原任务，不能重复提交。API 对创建事务中的成本错误返回安全的 `503 / GENERATION_COST_UNAVAILABLE`；创建后本地拒绝返回原 job 和 `GENERATION_NOT_STARTED`，明确说明积分已释放，不暴露内部报价、来源或配置。

本轮仅接成本；没有接 `ensureInputReview`／`stageOutputReview`，也没有改内容审核模块。主会话接审核时必须保留成本 → 钱包 → job 锁序，在输入审核通过后、实际 POST 前才申请提交许可。审核拒绝仅在确定尚未提交时释放成本；供应商已提交的成本仍保留。

# 库外运维 CLI

入口：`node --import tsx scripts/generation-cost-admin.ts /absolute/private-directory/input.json`。数据库连接仅从运行环境 `DATABASE_URL` 读取，CLI 不加载仓库配置，也不迁移数据库。JSON 必须在所有 Git checkout 外，普通非符号链接文件、权限 `0600`，直接父目录 `0700`，上限 64 KiB。每次只执行一个动作，不提供隐式默认真实值。

每个 JSON 都包含 `action` 和 `target: {database, role}`；连接后先核真实 `current_database()`／`current_user`，不符即拒绝。字段严格校验，多余字段拒绝；时间为带时区 ISO 8601。配置应由运维根据实际核验明确填写，本文不预置价格、预算、生产目标或操作者。

| action | 必须显式提供的其他字段 |
|---|---|
| `budget` | `expectedRevision`、`enabled`、`capMinor`、`validFrom`、`expiresAt`、`actor`、`evidenceRef` |
| `rate` | 完整 `spec`、`expectedRateId`（首次明确为 null）、`maximumMinor`、`sourceRef`、`observedAt`、`validFrom`、`expiresAt`、`actor` |
| `observe` | 完整 `spec`、`amountMinor`、`observedAt`、`sourceRef`、`actor` |
| `actual` | `jobId`、`amountMinor`、`evidenceRef`、`actor` |

首次预算修订为 0，后续使用数据库中的当前 revision；费率以当前 rateId 比对，不知道当前值时先只读核验，不能盲猜覆盖。`observe` 返回 `blocked:true`、`actual` 返回 `priceIncreased:true` 都是已提交的审计事实，不当作异常回滚。CLI 只输出修订／结果标记，不输出输入内容、连接串或原始数据库错误。CLI 不是公开管理 API；没有新增网页入口。

# 接线验收

`tests/cost-runner.integration.test.ts` 仅接受 `COST_RUNNER_TEST_DATABASE_URL` 指向 `127.0.0.1:55445`、角色 `kakareel_cost_runner_55445_test`、数据库 `kakareel_cost_runner_55445_sandbox`，禁止密码、查询参数和 hash。连接前核 URL，DDL 前核实际角色／数据库。只在该专属临时库初始化 0001–0006 迁移，不读取并行审核迁移或任何生产配置。live 路径注入可观测 transport spy，所有全局 fetch 禁止，verifyDelivery 也是合成替身；并非真实模型交付验收。

2026-10-25：**13 项通过，0 失败，0 跳过**。包括 live 预览默认拒绝和正向放行、精确规格、并发全局限额、job 插入失败原子回滚、未提交过期／改价释放、历史任务边界、一次提交许可与新连接恢复、用户退款后迟到成功不再扣积分、HTTP 402 不推断零供应商成本、fake 隔离、CLI 目标校验和涨价停用提交。新连接恢复测试模拟 claim 提交后 worker 丢失，不把它冒充本轮 SIGKILL 测试。

本任务四个 TypeScript 文件及其依赖的严格类型检查通过。全项目检查曾遇并行 `tests/delivery-content.test.ts` 类型错误，未越界修改；完整整合后的全项目检查留主会话。没有 git、浏览器、付费调用、真实费率配置、生产迁移或部署。
