---
title: "本地开发与 Hostinger Dokploy 部署"
date: 2026-10-26
source: "项目实现与 tests/ 环境检查；主会话 2026-10-23 验收；Dokploy Docker Compose 文档；用户 2026-10-26 最新决定"
status: "35691b0 已部署；Web healthy、两个worker running，十项迁移已核；新生成及正式收费关闭"
---

# 运行结构

2026-10-26 现状：Waffo整改版本 `35691b0` 已完成停旧进程、备份、迁移和部署；十项迁移校验和匹配，四个旧用户与六条视频保留。当前Web、generation worker和billing reconciliation均运行；新生成预算及正式收费关闭。详细验收见 [开售执行清单](launch-readiness.md)。下列10月23日描述为历史基线。

2026-10-23 最新核验：`b197051` 的 Dokploy 部署记录为 done，完整日志显示 Compose Deployed；Web healthy，worker running，数据库 healthy。生产库只读查询返回 `0001-init.sql`、`0002-google-auth.sql`、`0003-billing.sql`、`0004-credit-wallet.sql`、`0005-pancake-bridge.sql`。有任务恢复与真实生成交付仍未验。部署触发链接本轮已轮换，仅同步到库外配置与既有 GitHub push hook；`b197051` push 自动触发并完成部署，确认触发链路可用。支付最新状态见[接续记录](billing-backend.md#2026-10-23-当前接续状态)。

Next.js＋TypeScript，Hono API 位于 Next.js Node 路由，PostgreSQL＋Drizzle 存任务。共享 VPS 上先用一个应用构建，独立数据库，避免多个前后端构建同时争用资源。上游提供持久化异步任务，MVP 未引入 Redis 队列。本轮准备代码新增同库持久化 worker，用于不依赖用户打开页面的轮询和恢复；Web 与 worker 启动都通过同一迁移锁。worker 镜像构建和空库 start → migrate → once 已验收，`b197051` 已部署，Web healthy，worker 持续 running，生产五项迁移已只读核验；有任务恢复仍需单独验收。

## 配置边界

真实配置一律在 checkout 外；本机目录权限 0700，配置文件 0600；生产值只进入 Dokploy 环境设置。不得复制或软链接配置回仓库，不使用其他应用的密钥。`.env.example` 仅列空变量。

| 变量 | 用途 |
|---|---|
| DATABASE_URL | 项目专用 PostgreSQL 连接串 |
| VIBETOKEN_API_KEY | 项目专用上游密钥；缺少时仅浏览工作台 |
| GA_MEASUREMENT_ID | GA4 运行时测量标识；留空禁用，配置与验收见 [访问统计](analytics.md) |
| GOOGLE_CLIENT_ID | Google Web 客户端公开标识，运行时提供；缺少时禁用 Google 登录 |
| SESSION_SECRET | 至少 32 字符的随机签名密钥 |
| DEMO_ACCESS_CODE | 至少 12 字符的预览口令 |
| APP_URL | 对外 HTTPS origin，不带子路径 |
| GENERATION_DAILY_LIMIT | 全站 UTC 日提交上限，默认 10 |
| POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD | Compose 独立数据库配置 |

配置不作为构建参数，不写入镜像；密钥不进入浏览器。Google Client ID 是登录所需的公开标识，仅经运行时 `/api/config` 返回。可以先部署浏览版本、暂不配置 VibeToken Key 和邀请口令，页面会明确提示暂不能生成。

### 正式支付运行时接线（2026-10-25，尚未放行）

`compose.yaml` 通过独立的 `x-billing-environment` 环境块，仅向 `web` 和 `billing-reconciliation` 透传下列正式支付变量；两者共用同一组值。generation `worker` 只继承应用环境，不接收任何 `BILLING_*`／`PANCAKE_*` 变量。账单对账服务保留独立启动命令，不接收 VibeToken 上游密钥。

| 变量 | Compose 默认值 | 正式配置要求 |
|---|---|---|
| `BILLING_LIVE_ENABLED` | `false` | 仅精确的 `true` 表示请求启用；仍受代码放行常量约束 |
| `BILLING_DEPLOYMENT_MODE` | 空 | 正式模式要求 `production` |
| `BILLING_LIVE_APP_ORIGIN` | 空 | 必须等于 HTTPS `APP_URL` 的 origin，不带路径或尾斜线 |
| `PANCAKE_LIVE_MERCHANT_ID` | 空 | 正式商户 ID |
| `PANCAKE_LIVE_STORE_ID` | 空 | 同一正式商户的店铺 ID |
| `PANCAKE_LIVE_PRODUCT_ID` | 空 | 与应用积分包金额、币种和税类对应的正式商品 ID |
| `PANCAKE_LIVE_PRIVATE_KEY` | 空 | 正式商户签名私钥；通过平台 secret 设置保留 PEM 换行 |
| `PANCAKE_LIVE_PLATFORM_PUBLIC_KEY` | 空 | 正式渠道验签公钥；保留 PEM 换行，不回退使用沙盒公钥 |

两个支付服务的 `BILLING_TEST_ENABLED` 固定为 `false`，不透传 `BILLING_TEST_APP_ORIGIN` 或 `PANCAKE_TEST_*`。正式数据库名不能以 `_billing_sandbox` 结尾，角色不能以 `_billing_test` 结尾；运行时还会核实际数据库和角色与连接串一致。真实值只在库外或 Dokploy 环境／secret 设置中提供，不写入此文件、Compose、构建参数或前端变量。

`src/server/billing/config.ts` 的 `productionBillingRelease.liveSalesApproved` 保持 `false`。即使完整设置正式环境并请求启用，也不会注册正式支付 adapter；账单对账的零计数不能作为正式查询成功的证据。修改代码放行常量属于另一次经明确批准并完成运营验收的发布。本次部署接线已于2026-10-26上线；未创建正式资源、未调用正式支付渠道。按本轮任务提供的状态，Pancake 业务审核／税费尚未通过，真实正式密钥、商品与 Webhook 尚未配置；正式开售条件由主会话继续核验。

离线验证 Compose 时使用清空继承环境的进程、显式 `--env-file /dev/null` 和全合成必填值，避免自动读取 checkout 的 `.env`。分别检查未设置支付变量、显式空值、合成正式值及沙盒变量混入的场景：两个支付服务的正式值一致，沙盒开关始终关闭，generation worker 无支付变量。解析结果只在内存中断言，不将完整环境输出到日志；此检查不启动容器，也不代表真实支付验收。

## 数据库凭证轮换

用户于 2026-10-26 根据现有信息明确决定本次不改数据库密码，取消轮换维护窗口等待，不再将轮换作为本次上线或 0006–0010 升级前置。生产尚未轮换，此决定不代表风险已消除。

[独立轮换操作与验收](database-credential-rotation.md)保留为未启用的备选方案；2026-10-25 合成凭证的 PostgreSQL 16 隔离演练及随后平台源码核查的结论仍限于各自验证范围。未来另行决定轮换时，须重新核准当时的运行版本、迁移及执行条件；不得把更新环境变量、healthy 或旧连接仍可用当作新旧密码验收。

## 本地

使用 Node.js 22 和 pnpm 10.27.0，先 `pnpm install --frozen-lockfile`。外部配置文件路径由操作者提供，以下占位路径不应直接执行：

```sh
node --env-file=/absolute/external/runtime.env --import tsx scripts/migrate.mjs
node --env-file=/absolute/external/runtime.env node_modules/next/dist/bin/next dev --hostname 127.0.0.1
```

迁移按编号应用 `db/*.sql` 并记录校验和；旧库保留任务，补建迁移记录。开发不依赖真实上游密钥才能打开页面；Google 登录详见 [架构说明](google-auth.md)。Google 登录已于 2026-10-21 上线；当前功能与验收状态以 [上线记录](launch.md) 为准。

## Dokploy

参照 [Dokploy Compose 文档](https://docs.dokploy.com/docs/core/docker-compose)：

1. 在已有 Hostinger Dokploy 创建本项目独立 Compose 服务，源仓库为 `Glowin/last-mile-ai-video`、分支 `main`，使用根目录 `compose.yaml`。
2. 在平台内设置上述运行环境；数据库 URL 的主机为该 Compose 内的 `db`，用户、密码、库名与数据库服务对应。由平台保存，不导出到 Git。
3. 数据库使用 PostgreSQL 16 镜像；应用启动时先运行版本化迁移，成功后才启动 Web，失败则退出。SQL 与迁移脚本随 Web 镜像打包，新旧数据库卷都通过同一迁移入口升级。升级前备份，保留旧任务，不删卷强制重建；首次部署后的历史初始化方式已被此入口替代。
4. 将已注册域名绑定 `web` 服务端口 3000，配置 DNS 与 TLS。不要公开 PostgreSQL 端口，不修改其他项目的服务或卷。
5. 一次部署一个构建；确认 VPS 资源可用。只有平台实际配置并验收 webhook 后，才称为 push 自动上线。
6. 核对实际运行版本、HTTPS 首页、`/build`、三个模型页、`/create`、`/api/health`、sitemap 与 canonical。健康接口只证明应用存活，不证明上游可用。
7. 配好专用上游 Key 后做有限真实生成验收，再开放邀请。

<a id="cost-moderation-cutover"></a>
## 0006–0010 升级切换（2026-10-26 已执行）

这次不能让旧版与新版 Web／worker 滚动并行。迁移锁只串行化迁移进程，不会停止旧应用；旧版不认识成本与审核限制，仍可能提交或结算新任务。旧 Web 的任务查询／恢复接口也可能推进任务，因此只停 worker 不够。以下步骤仅作用于本项目，保留数据库和持久卷。按用户 2026-10-26 决定，本次不以数据库密码轮换为前置；升级自身的停机、备份、迁移与验收要求仍保留。

1. 发布前备齐新 Web／worker 镜像、受限的审核 CLI 运行入口和配置、已批准的运营预算及精确规格费率。历史轮换准备未保存固定命令或覆盖配置，本次也不执行轮换；升级时仍须核当时实际配置，若存在固定旧镜像的自定义命令、Patch 记录及落地覆盖文件，核并协调移除；删除记录不等于文件已清理，不为清理单独触发默认 Reload。未获预算批准时保持新生成关闭，不沿用已结束的真实视频测试授权。审核操作须能私下导出输入、观看完整候选视频并提交匹配文件哈希的决议；没有可用操作入口不得放行新任务。
2. 核对并暂时暂停本项目自动部署触发，记录原状态，防止切换期间 main 的新 push 意外启动进程。阻断进入旧应用的请求，再停止所有旧 Web、worker 及其副本，确认它们已经退出。维护页或流量阻断须在旧应用之外生效；不能仅靠旧版不认识的数据库预算开关。
3. 在应用已停止时记录未终结任务、原上游 ID、租约和积分预留的只读清单，保存在库外。对现有数据库做新备份并核可读性；此前备份不替代本次切换点。供应商已接受的任务仍可能继续运行，保留原 ID，恢复时仅查询，不重新提交。
4. 使用新镜像的迁移入口应用 0006–0010。读取 `schema_migrations` 核十项名称／校验和与待部署镜像一致，并核 `generation_moderation_rollout.started_at` 已持久化。确认新预算默认关闭、没有意外费率；迁移失败时保持维护状态，不启动旧程序继续处理。
5. 只启动新版本 Web、worker 和账单查询进程，逐个核实际镜像版本、迁移日志与进程健康。账单进程当前生产 adapter 为空，零计数仅证明进程可运行，不代表正式订单已自动对账。旧已提交任务继续查询；旧未提交且没有成本快照的任务保持本地拒绝／释放，不补发。
6. 在放行新生成前，复核库外费率、预算有效期、全局累计风险与供应商 Key 上限；用新版本检查未配置／停用规格被拒绝，以及审核队列可达。实际生成验收消耗运营预算，须先有对应授权。所有页面与旧任务查询验证通过后再解除维护，恢复此前批准的自动部署状态。正式收款仍受 Pancake 准入和支付验收独立限制。

**故障恢复：** 升级后不能通过退回 `b197051` 等旧镜像恢复生成。旧迁移器会忽略它不包含的 0006–0010，旧代码可能正常启动却绕过新保护。保留升级后的数据库、任务及审计事实，维持维护状态，修复后部署前向兼容版本。新外部任务／付款发生后，不能自动恢复切换前备份并丢弃后续事实；如确需数据恢复，须先核所有外部交易与上游任务，形成单独可审阅方案。仅关闭新预算也不能约束旧程序。

2026-10-26已按上述顺序完成生产停止、切换点备份、十项迁移与新版启动。审核CLI队列／案件读取成功且为空；预算和费率保持关闭，未放行新生成。实际结果见[开售清单](launch-readiness.md)；历史隔离检查不冒充真实交付。

## 本轮已解决的打包问题

2026-10-20 实测，通用 `build/` 忽略规则会误排除应用路由 `src/app/build/page.tsx`：本地开发能打开，不代表 Docker 镜像或 Git 提交包含该页。现已在 `.gitignore` 与 `.dockerignore` 同时加例外，并在生产容器验证 `/build` 返回 200。以后调整忽略规则须同时核这两处和镜像内实际路由。

Docker 生产阶段必须复制 `public/`，否则代码引用的鸮鹦鹉素材不会随 standalone 输出自动带入。本轮已显式复制，并验证两个 PNG 的生产容器响应。

## 检查

`pnpm typecheck`、`pnpm test`、`pnpm build`、`docker build -t kakareel:local .`。

### 完整测试的独立数据库

普通 `pnpm test` 未提供相应变量时会跳过数据库集成用例，不能称为完整验收。2026-10-23 按当前 `tests/` 读取的入口如下；全部为可丢弃的本机测试库，不能连接生产库或保存官方支付记录的 Pancake 沙盒库。五个库须彼此独立，可由同一临时 PostgreSQL 实例承载。

| 环境变量 | 使用测试 | 当前代码检查与准备要求 |
|---|---|---|
| `DATABASE_URL` | `tests/api.test.ts` | 主机 `127.0.0.1`，库名 `video_qa`；先应用全部迁移。测试会 TRUNCATE 任务、报价、分配和审计等表 |
| `AUTH_TEST_DATABASE_URL` | `tests/auth.test.ts` | 主机 `127.0.0.1`，库名 `video_auth_qa`；测试自行 DROP／重建 public schema、构造旧版本并执行并发迁移 |
| `BILLING_TEST_DATABASE_URL` | `tests/billing.test.ts` | 主机 `127.0.0.1`，库名 `video_billing_qa`；测试自行 DROP／重建 public schema、构造旧用户／任务并迁移 |
| `ACCOUNT_TEST_DATABASE_URL` | `tests/account-profile.test.ts` | 协议 `postgresql:`，主机 `127.0.0.1`，库名 `video_account_qa`，角色 `account_test`；必须显式非 5432 端口，无 query／fragment；初始 public schema 无表。测试自行迁移，收尾清空自身 schema |
| `CREDIT_TEST_DATABASE_URL` | `tests/credit-wallet.integration.test.ts`、`tests/credit-migration.integration.test.ts`、`tests/model-options.test.ts` 的 runner 集成用例 | 固定 `127.0.0.1:55439`，库名 `video_credit_qa`；先应用全部迁移。迁移回填测试另建随机 schema，验证后删除；其余用例会写测试用户、订单、钱包与任务 |

上表库名、角色与端口是测试源码中的固定假设，不是生产配置。不要给五个变量填同一连接串；AUTH／BILLING 的 schema 重置会破坏其他测试的数据。ACCOUNT 库每次运行须保持空库前置条件。测试进程结束后由操作者回收自己创建的临时数据库／容器，不能据一次通过推断全部资源已清理。

外部测试配置同时提供 `NODE_ENV`（test）、仅供测试的 `SESSION_SECRET`（至少 32 字符）、`DEMO_ACCESS_CODE`（至少 12 字符）、假 `VIBETOKEN_API_KEY`、假 `GOOGLE_CLIENT_ID`、本机 `APP_URL`；`GENERATION_DAILY_LIMIT` 使用测试值或默认值。不得载入真实上游、Google 或支付凭据。`BILLING_TEST_DATABASE_URL` 只是离线账单集成库入口，与开启官方隔离沙盒的 `BILLING_TEST_ENABLED` 不同；离线全测不启用后者。

先由操作者创建上述五个可丢弃库并核对 URL 与角色。AUTH、BILLING、ACCOUNT 的迁移由各测试自行负责；只预迁移基础 API 库和 CREDIT 库。以下外部路径是占位，须换成经核对的**测试专用**配置文件，不可使用生产或官方支付沙盒配置：

```sh
node --env-file=/absolute/external/test.env scripts/migrate.mjs
node --env-file=/absolute/external/test.env --input-type=module -e 'import { migrate } from "./scripts/migrate.mjs"; const url = process.env.CREDIT_TEST_DATABASE_URL; if (!url) throw new Error("Set CREDIT_TEST_DATABASE_URL for the disposable credit QA database"); await migrate(url);'
node --env-file=/absolute/external/test.env --import tsx --test tests/*.test.ts
```

这里使用 Node 原生 test runner 加 `tsx` loader；数据库用例依赖真实 PostgreSQL，上游与付款调用使用 mock／fake provider，不产生真实视频或支付。必须检查日志的 pass／fail／skipped，而非只看退出码。主会话 2026-10-23 完整测试日志 `/private/tmp/kakareel-tests-final.log` 已核为 **168 passed、0 failed、0 skipped**；这是该次快照的结果；新增退款诊断另有 27 项定向测试通过，最终 build／tsc 通过。测试不能替代真实渠道和生产行为验收。

## 一次性积分包 worker（2026-10-23）

Compose 的 worker 使用 Dockerfile `worker` target，保留 TypeScript runtime，只运行任务恢复与结算；没有公网端口。2026-10-23 主会话确认该 target 镜像构建 passed，并以非 root UID 1000 在空 `video_worker_qa` 验证 start → 5 项迁移 → once，退出码 0、jobs 0，未配置上游 Key；`715e6b0` 已推送 main，Dokploy 完整日志为 `Docker Compose Deployed ✅`，新 Web／worker 均显示 Started。应用服务仍是默认最终 runner target。生产数据库已由主会话经授权 `pg_dump` 到既有卷：26722 bytes，`pg_restore --list` 可读、输出 72 行，实际路径不写公开仓库；尚不代表完成恢复演练。本轮已确认生产五项迁移及 worker 持续 running；既有任务不会重复提交的有任务验收仍需补齐。正式销售和生成收费开关仍在代码层关闭。

Pancake 沙盒只在独立部署和独立数据库配置 `.env.example` 的测试变量，生产 Compose 默认不传这些测试凭证。测试角色、数据库、OAuth／域名及回调需单独配置；详细契约和手动恢复命令见 [支付后端](billing-backend.md)。

主会话线上验收：`GET /api/billing/catalog` 返回 USD 1900 最小货币单位／150 credits，`checkoutEnabled=false`，全部 provider unavailable，服务端实际收费保持关闭。浏览器已视觉验收 `/pricing` 的 US$19＋适用税费、八项费率与客服链接。最终 probe 的 `/pricing`、`/terms`、`/privacy`、`/create`、`/api/health`、`/api/billing/catalog` 均 200；前三页 support mailto 命中，create 的 `Generate preview video` 命中；匿名 billing／jobs 均 401。

同日较早曾因页面被占用停止核验；用户恢复登录后，现已确认 worker 持续运行及生产五项迁移。原 unknown 沙盒单仍保持 150 credits 冻结，未重试退款；新的商户签名退款验收状态以支付后端现状表为准。详见[支付后端](billing-backend.md#2026-10-23-当前接续状态)。

测试 dev 已停止；临时 PostgreSQL 已留下排除 auth 数据的库外沙盒账本备份；本轮临时容器与 worker 测试镜像已清理，其他项目容器保留；公开文档不记录备份实际路径。
