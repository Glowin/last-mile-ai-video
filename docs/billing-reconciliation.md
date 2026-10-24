---
title: "账单自动查询恢复 worker"
date: 2026-10-25
status: "隔离 PostgreSQL 验收通过；本地启动接线完成，未部署，不开启正式销售"
---

# 范围与调用边界

`BillingReconciliationWorker.tick()` 只调用现有公开 `BillingService.reconcile(orderId)`。该 service 使用已认证渠道查询原订单和原 `refundRequestId`，通过原有事件、钱包事务与账本唯一键恢复权益。本 worker 不直接修改付款、退款、批次或积分账本。

传入 service 的 adapter 仅保留 `reconcile` 和 `reconcileRefund`，创建 checkout、提交 refund 和处理 webhook 的能力均拒绝。`salesEnabled=false`、`generationChargingEnabled=false` 在 worker 构造中固定；没有环境变量开启正式销售的入口。service 对账本来允许关售状态，查询恢复不等于开售。

默认 `billingOptionsFromEnvironment()` 在生产未配置渠道时返回空 registry，worker 在访问数据库前直接返回全零计数，不发渠道请求。测试配置继续使用现有 isolated-test 校验，必须有独立沙盒库、角色与实际数据库身份检查。注入测试 adapter 也必须提供 `assertIsolation`；同一 worker 不接受 test/live 混合 registry。调度筛选同时匹配 provider、environment、merchant_account_id，不能拿一个店铺密钥查询另一个店铺订单。

# 调度与失效行为

新增 `0007-billing-reconciliation.sql` 保存调度状态；不改历史迁移、业务 schema 或收费 gate。

- 每 tick 最多发现 10 个最老的未登记订单、重置 10 个新退款请求 episode、领取 10 个到期任务。包含 paid 单，以发现渠道后台退款丢失的回调；不是每次只看最新 N 单。
- `next_attempt_at, order_id` 排序与 PostgreSQL `FOR UPDATE SKIP LOCKED` 保证逐单公平领取。网络查询不持有数据库事务锁。
- 每单持久 token、120 秒 lease、领取即增加 attempts。进程崩溃后，只能在 lease 到期时领取；旧 token 不能覆盖新租约的调度结果。并发与迟到资金事实仍由现有 service 的严格证据校验和唯一账本约束保护。
- 单个 provider 查询限 20 秒、付款恢复最多 10 条事件；一单正常最多两次查询调用。超时结果在进入 service 写账前丢弃，后续查询使用原订单／退款请求，绝不补发 POST 付款／退款。现有 provider API 没有 AbortSignal，超时不能取消底层传输；底层读请求可能继续完成，但迟到结果不能写账。将来 adapter 增加取消能力后可进一步释放连接。
- 退避为 60、120、240 秒逐次翻倍，最高 6 小时。查询错误只计入该单 `query_failed`，继续其他单；不记录 SDK message、原始响应或敏感 URL。
- 每个观察 episode 最多 64 次领取和 30 天。达到上限后 `exhausted`，不继续自动查询；64 次包含进程崩溃消耗的领取次数。单笔变成 refunded 则 `complete`；金额／退款 review 进入 `review`，交人工核证。
- 只有原订单出现不同且非空的 `refund_request_id` 才开始新 episode。重启、普通 updated_at 变动或查询失败均不会重置预算。
- `unknown`、processing 以及达到重试上限都不等于退款失败，不释放冻结、不冲销。只有 service 接受的渠道明确终态可改变权益。
- DB 不可用属于全局故障：本 tick 失败，CLI 输出固定错误码，run 模式等待下一轮。不能谎报成功；已领取任务仍受持久 lease 保护。

退避上限不承诺覆盖所有未来渠道退款：预算耗尽后保留可查询状态，需要人工核查和经审阅的恢复。不要删除调度行来无痕重置预算，也不要通过新建付款／退款替代查询。

# 启动接线

2026-10-25 完成本地 package／Compose 接线；未修改 worker、billing config、Dockerfile 或迁移，未部署或启用销售。

1. `pnpm billing:reconcile once` 运行一批（省略参数也默认 once）；`pnpm billing:reconcile run` 持续运行。package 命令不执行迁移，手动使用已配置 adapter 时须先迁移专用数据库。使用 `node --import tsx` 加载脚本，不依赖镜像 PATH 中存在 `tsx` 可执行文件。
2. Compose 新增独立进程服务 `billing-reconciliation`，复用 Dockerfile 的 `worker` target。该 target 已安装包含 tsx 的依赖，并复制 src、scripts、db 与 tsconfig。服务显式覆盖原 credit-worker CMD：`node scripts/start.mjs node --import tsx scripts/billing-reconcile-worker.ts run`；不开放端口、不挂载配置文件。
3. Compose 服务等数据库健康后启动。`start.mjs` 校验 SESSION_SECRET／APP_URL 并执行迁移，现有 migrator 自动发现 `0007-billing-reconciliation.sql`。**空 adapter 的零数据库访问承诺仅指 worker tick；启动包装器仍会执行数据库迁移。** 本轮未运行该包装器或任何迁移。
4. 服务只传 DATABASE_URL、SESSION_SECRET、APP_URL 和固定为 `false` 的 BILLING_TEST_ENABLED，不继承 web／视频 worker 的环境锚点，也不传 VibeToken 或 Pancake 凭证。生产空 registry 下只输出零计数；不存在创建支付、发起退款或启用销售的接线。它是独立进程，生产时仍使用本项目数据库，不声称具有独立沙盒数据库隔离。
5. `run` 每 5 秒尝试一批。SIGINT／SIGTERM 停止新一轮，等待当前 tick 完成；Compose 设置 `stop_grace_period: 8m`，为每批最多 10 单、每单最多两次 20 秒渠道查询留出时间。数据库故障可能超过此时间，强制结束时靠 lease 恢复。日志仅输出 claimed／observed／failed／exhausted 计数或固定错误码。
6. 独立测试部署必须另行提供专用数据库、角色及沙盒配置，继续通过 `billingOptionsFromEnvironment` 的 isolated-test 校验；不得把本生产 Compose 的数据库拿来开启测试 adapter。未来正式 query adapter 接线需代码审查并匹配具体商户 scope，不能靠设置环境变量开启本版生产查询，也不能改 sales gate 来实现对账。
7. 人工运维查询 `billing_reconciliation` 中的 `review`、`exhausted` 和 lease 长期未恢复项，关联原订单核证。现有 `BillingService.reconcile` 仍为受控手动查询入口；此版本不增加未认证 HTTP 管理接口、不自动通知外部人员。

# 本地验收

2026-10-25 接线验收：使用清空继承环境后的合成占位值及 `--env-file /dev/null` 执行 `docker compose config --format json`，解析通过。断言独立 worker target、精确启动命令、数据库健康依赖、8 分钟退出窗口、仅四项环境变量及无端口／挂载均通过；未输出渲染后的配置值。核实 package 命令及镜像所需脚本、tsx 依赖存在。

实际执行 package 对应命令的默认、`once`、`run` 三种方式：不提供 DATABASE_URL 或任何渠道凭证，固定 production／BILLING_TEST_ENABLED=false，均输出 claimed／observed／failed／exhausted 全零；`run` 收到 SIGTERM 后正常退出。未启动容器、执行迁移、调用支付渠道或读取真实配置。未重复下述 11 项 PostgreSQL 测试，因为本轮未修改其模块。镜像构建、部署后的常驻与重启验证，以及配置渠道后的真实自动对账，尚未执行。

使用真实 PostgreSQL 16，仅本任务容器、localhost:55443、库 `reconciliation_55443_billing_sandbox`、角色 `reconciliation_55443_billing_test`。这些是可复用的合成测试标识，不是项目配置。测试开始先检查 URL 的 host、port、库名、role、无 query 参数，再读实际 current_database/current_user；检查失败不会迁移或写 fixture。测试 adapter 完全内存模拟、不访问渠道，不读取真实配置。

运行：从库外设置 `BILLING_RECONCILIATION_TEST_DATABASE_URL` 后执行 `node --import tsx --test tests/billing-reconciliation.integration.test.ts`。未设置专用变量会显式 skip 集成测试，不能拿这种运行作为验收通过。不要替换成生产 DATABASE_URL。

覆盖：两 worker 并发领取；真实子进程进入查询后 SIGKILL；新进程／连接在租约到期前不领取、到期后恢复；23 单跨批公平调度；单单错误不阻断全批；重启保持退避；测试／正式／其他商户隔离；缺回调付款 +150 仅一次；缺退款回调 −150 仅一次及并发重复恢复；unknown 冻结及上限停止；30 天上限；缺资金证据停 review；20 秒查询超时迟到结果不入账，后续查询正确恢复。全部路径创建付款／退款调用计数为零。2026-10-25 最终运行 11 项通过、0 failed、0 skipped；`tsc --noEmit --incremental false` 退出码 0。专用容器及匿名卷已清理。

这是持久调度和真实数据库权益验收，不是新增渠道真实交易验收，也不证明已部署常驻。官方渠道已有沙盒证据见 [账单后端文档](billing-backend.md)。
