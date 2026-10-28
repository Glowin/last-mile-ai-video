---
title: "GA4 访问统计"
date: 2026-10-28
source: "江昪 2026-10-23 接入指令；Google Analytics 控制台；2026-10-28 PR #4 审查、合并与生产验收"
status: "PR #4 已合并并部署为 ea7ee21；渠道归因与转化代码上线；GA_API_SECRET 已在生产 web 生效，Search Console 已关联；GA 端真实转化验收待完成"
---

# 采集范围

独立 GA4 资源与 Web 数据流已创建。实际标识仅保存在项目库外配置与 Dokploy 运行环境，代码通过 `GA_MEASUREMENT_ID` 读取；不需要构建参数。变量为空时不显示选择条、不加载统计。

首次访问展示可拒绝的统计选择条；同意后才加载 Google tag。页脚 Cookie settings 可重新选择，撤回会立即禁用标签并清除本域 GA cookie，待服务端确认撤回后刷新；请求失败显示重试。选择保存在浏览器 localStorage；无法保存时仅在当前页面有效。

手动发送 `page_view`，页面 URL 不含 hash，query 仅保留 `utm_*` 白名单（见下文 2026-10-28）；首次来源仅保留 origin。GA 自带会话、首次访问和参与度事件可能随标签发送。不传账户标识、邮箱、提示词、图片或支付卡信息。

**控制台配置依赖：Web 数据流的 Enhanced measurement 必须关闭**，否则自动 history、表单、站内搜索等采集可能绕过页面参数过滤并重复计数。2026-10-23 已保存并回读为关闭。标签同时关闭广告个性化、Google signals。

# 验收

- `pnpm typecheck`、`pnpm build` 通过。
- 本地真实浏览器拒绝并刷新：Google tag 元素 0，网络中的 Google Analytics／Tag Manager 请求 0。
- 同意后 tag 元素 1；首页到定价页各产生一次 page_view，标题匹配。
- 直接进入带测试 prompt query／hash 的工作台：事件仅含 `/create`，不含 query／hash。
- 从隐私页撤回授权，刷新后 tag 元素归零；桌面弹层已视觉检查。
- 合并远端同期导航修复，保留首页锚点和定价模块定位；合并后类型检查通过。

# 2026-10-23 生产验收

`ac0ad3b` 实现与远端导航修复合并为 `df826ca`；main 推送成功，Dokploy 对应提交 Done（19 秒）。正式站已出现统计选择条与页脚入口。

- 授权前 Google tag 元素为 0；授权后 `gtag/js` 返回 200。
- 首页与 `/build` 各一条 `page_view` 请求，Google collect 均返回 204。
- GA Realtime overview 实际显示 1 位测试活跃用户、两页各 1 次浏览，`page_view=2`、`first_visit=1`、`session_start=1`。这是验收访问，不是新增真实客户。
- 生产撤回授权后，标签元素与 `_ga`／`_ga_*` cookie 均为 0；本轮结束时测试浏览器选择为拒绝统计。
- 本地测试服务已停止。标准报告的汇总延迟未作为本次实时接通判据；购买、注册与生成转化不在本轮范围。

# 接续步骤与走不通的路（2026-10-23 实测）

以下来自本轮接入过程，控件名称仅代表当日界面；后续操作先读取当前状态。

1. **先查已有资源，再创建。** 本轮在既有账号内创建独立资源与 Web 数据流，不复用其他产品的测量 ID。GA 顶部资源选择器未出现时，搜索框可按产品名找资源；结果可能打开新标签，须枚举目标域标签并核资源名称，不能继续在原产品报表上验收。
2. **关闭增强型衡量有二次确认。** 点击开关后会弹出 `Turn off enhanced measurement?`，须点击 `Turn off`，再回读开关和事件列表。工具的 uncheck 成功不等于最终保存；先读状态再点下一步，避免取消确认后仍按默认开启创建。
3. **安装向导空白不等于创建失败。** 本轮数据流已出现在列表，但安装 iframe 为 `about:blank`；继续／关闭操作未推进。停止重复点击，正常返回 GA 首页，搜索已创建资源并打开其新标签；首页可读测量 ID，Admin → Data streams 可回读详情。原因未查明，不归因为权限、广告拦截或平台反自动化，也不重复建资源。
4. **Dokploy 编辑器先核可编辑性。** Environment 中存在 role=textbox 但 `contenteditable=false` 时，直接 press／fill 会失败。v0.29.4 当日编辑开关的可访问名称为 `Toggle bold`；切换后确认 `contenteditable=true`。同次读取当前完整值，在内存中仅追加目标变量，比较其余内容未变，再保存并刷新回读。不能用旧本地 env 文件整包覆盖线上参数。
5. **配置页只输出必要断言。** 浏览器定位器失败诊断可能自动带出 textbox 内容，部署列表也可能包含完整 webhook。先检查编辑状态，避免在含密钥的编辑器上试错；整页快照留在内存，输出变量是否存在、其他行是否保持及保存状态，不能把完整快照或配置带入工具输出和公开文档。

# 后续修改的验收入口

- 未选择／拒绝并刷新：标签不加载、GA 网络请求为零；允许后才发请求。撤回后核 cookie 与标签均清除，区分当前浏览器选择与全站状态。
- 首次页面、Next.js 客户端切页、普通链接整页跳转、返回上一页分别核事件数和标题；只变 hash 不应新增页面浏览。2026-10-23 已验的子集见上方记录，未列项不算已验。
- 带合成 query／hash 的 URL 验字段过滤；后续增加 UTM 或业务事件时，显式选字段，不发送整段 URL、表单或账户对象。2026-10-23 当时未实现 UTM 归因、业务转化和跨标签撤回广播；2026-10-28 实现见下文。
- 用真实浏览器请求与 GA Realtime 两层核验：collect 204 只说明端点接收，仍须在目标资源看到匹配的页面、事件与数量。首页／数据流的“未收到数据”提示不能覆盖实时报告已收到的证据。
- 原生截图已在会话中目视检查，但本轮未将截图归档为长期文件；长期证据目前为本文、代码提交及库外结构化验收记录，不宣称已有截图原件。

# 修订

- 2026-10-28：按江昪“沉淀”，将 PR #4 的合并部署、四项修复及验收边界回写正本；明确购买上报未启用及后续配置／验收步骤。

- 2026-10-23：按江昪“沉淀”，补齐 GA 向导恢复、增强型衡量二次确认、Dokploy 编辑状态与配置输出边界；明确未验项目、未接的 UTM／业务事件和截图归档缺口。产品事实保留本文件与 launch.md 的单向指针，不新增 Core 竞争正本。

# 重查与官方依据

- 从现有 Google Analytics 账号选择 KakaReel，查看 Admin → Data streams 与 Reports → Realtime。
- [Google 页面浏览与自动 history 重复计数说明](https://developers.google.com/analytics/devguides/collection/ga4/views)。
- [Google 基础同意模式说明](https://developers.google.com/tag-platform/security/concepts/consent-mode)：授权前不加载标签。

# 2026-10-26 隐私整改

用户要求自行托管字体并关闭会话重放。本轮源码检查未发现会话重放 SDK／调用；上线前线上隐私页脚本来源仅本域（该测试浏览器未同意统计），无外部字体链接。保留已有同意后才加载的 GA 页面统计，不引入 replay 或输入录制。字体改为本域 `/fonts/inter-variable.woff2`，保留 Inter 官方 OFL 许可证；Google 登录独立框架自身资产不属于站点字体。最终上线资产与页面验收见 launch-readiness.md。

# 2026-10-28 渠道归因与转化事件

江昪要求补注册、生成、购买埋点并记录每位用户的来源渠道。实现分两层：自有库保存首次来源（可按渠道算收入），GA4 只收聚合事件。

## 首次来源（自有数据库）

- 浏览器在首次落地时写一方 cookie `kr_ft`（90 天，SameSite=Lax，非 HttpOnly，不含任何标识）。字段：`utm_source/medium/campaign/content/term`、`ref`（或 `via`）、来源站点主机名、落地路径（无 query／hash），以及是否带广告点击参数（只记类型如 `gclid`，不存值）。值一律小写、截断 100 字符，含 `@` 的值丢弃。规则为“首次非直接来源”：先直接访问、后带 UTM 访问时升级一次；已有来源后不再覆盖。
- 同意模型：选择“拒绝统计”的浏览器不写，拒绝时立即删除；未选择或同意时写。理由：内容只有活动标签，不识别个人，不发送第三方，仅在本站创建账户时用于聚合渠道统计；隐私页“How you found us”已披露。若需要更严格（仅同意后写），在 `analytics.tsx` 把 `saved !== "denied"` 改为 `=== "granted"` 即可，代价是未选择的注册用户记为 `(direct)`。
- 首次 Google 注册（`users` 新建）时，服务端在同一事务（savepoint，失败不阻塞注册）里重新校验 cookie 并写入 `user_attribution`；cookie 缺失或损坏仍写一行 `(direct)`。老用户无行，报表记 `(unattributed)`。
- 订单收入通过 `billing_orders.user_id → user_attribution` 关联。计费表结构不变；结账路由和服务增加可选统计上下文，新建订单事务内以 savepoint 保存，失败不阻塞支付，重试不覆盖。

## GA4 事件（均需统计同意）

| 事件 | 触发点 | 参数 |
| --- | --- | --- |
| `page_view` | 每次路由 | `page_location` = origin + path + 白名单 `utm_source/medium/campaign/content/term/id`；token、code、预览码等其余参数和 hash 一律丢弃 |
| `sign_up` | `/api/auth/google` 返回 `newUser: true`（仅首次建号） | `method=google` |
| `generate_video` | `POST /api/jobs` 成功后，按任务 ID 去重 | `model`、`generation_mode`、`duration_seconds`、`resolution`、`billing_mode`、`credits`；不发 prompt／图片 |
| `begin_checkout` | 点击购买、跳转托管收银台前 | `currency=USD`、`value=19`、`items=[credits-starter]` |
| `purchase` | **服务端** Measurement Protocol，订单被 Pancake webhook／对账标记 `paid` 后 | `transaction_id`=订单 ID、`value`=税前小计、`tax`、`currency`、`items` |

`purchase` 细节：
- 同意统计的浏览器在结账前用 `gtag('get', …)` 读取 `client_id` 和 `session_id`，POST `/api/analytics/consent` 建立独立的 HttpOnly 浏览器凭据（`kr_analytics_consent`，`/api`，SameSite=Lax，90 天），随结账请求提交白名单 ID。标签被阻止、超时或无同意时仍可付款，但不保存统计上下文。
- 新订单仅保存该次浏览器的上下文到 `analytics_order_contexts`；同一账号其他设备、未带 GA 上下文的订单以及旧订单重试均不能借用／覆盖。`analytics_ga_clients` 旧账号级关联由新增迁移 `0012-analytics-checkout-consent.sql` 清空，发送端不再读取。
- 撤回先停止本页 GA，再 DELETE `/api/analytics/consent`，服务端删除此浏览器凭据并级联删除订单关联。独立于账户登录令牌，即使登录过期或已退出也可撤回。收到成功回执才刷新；失败显示重试入口，拒绝状态重载后也重试。跨标签广播拒绝，Web Locks 串行化凭据创建／撤回，延迟 GA 回调须再次核同意。发送中持有凭据行共享锁（网络超时 5 秒），撤回成功后不会再用该凭据发送新事件。
- 没有订单级上下文或对应授权已撤回／过期的订单记 `skipped_no_consent`，不发送。
- 去重：`analytics_purchase_events` 以订单 ID 为主键，带租约认领；只发 `live`、`status=paid`、无 `review_reason` 的订单；GA 非 2xx 记 `failed`，下次触发重试，最多 5 次。迁移时已有的已付／已退款订单（含 10-27 验收单）回填为 `skipped_backfill`，永不补发。
- 触发：webhook 响应后、用户轮询 `GET /api/billing/orders/:id` 响应后（`app.ts` 中间件，异步不阻塞响应），以及 CLI `dispatch-purchases`。仅靠对账 worker 转为 paid 且用户未回到订单页的订单，要等下一次 webhook／轮询或手动 CLI。
- 发送 `non_personalized_ads: true`，`ad_user_data`／`ad_personalization` 为 DENIED；72 小时内的订单带 `timestamp_micros`=付款时间。购买附带原始 `session_id` 的前提是发送在该会话开始 24 小时内，付款在结账后 30 分钟内（现有 GA 默认不活跃超时）；超窗仍记购买，但不声称原会话归因。若 GA 会话超时配置改变，需同步这里的判据。[Google 会话归因要求](https://developers.google.com/analytics/devguides/collection/protocol/ga4/use-cases#session_attribution)。
- 退款不会自动发 `refund` 事件（未做，避免改计费流程）。

## 环境变量（只在 Dokploy 设置，不入库）

- `GA_API_SECRET`：GA Admin → Data streams → KakaReel Web 流 → Measurement Protocol API secrets → Create。为空时服务端 purchase 完全不发送、不入队。
- `GA_MP_DEBUG`：`true` 时 MP 事件带 `debug_mode`，出现在 DebugView；验收后清空。
- 两者只注入 `web` 服务（`compose.yaml`）；`GA_MEASUREMENT_ID` 沿用现值。

## 运营报表 CLI

```
pnpm analytics:report report --from 2026-10-01 --to 2026-10-31 [--tz Asia/Shanghai] [--group source|source_medium|campaign] [--environment live|test] [--json]
pnpm analytics:report dispatch-purchases
```

只读事务；按首次来源汇总当期注册数、生成数（含付费生成）、已付／已退款订单数与收入（已付订单税前小计，最小货币单位换算）。source 取 `utm_source` → `ref` → 来源主机 → `(direct)`；medium 无 UTM 时为 `ref`／`referral`／`(none)`。需在能连生产库的容器内运行（`DATABASE_URL`），输出不含个人信息。

## 验证（DebugView）

1. 本地或正式站浏览器 URL 带 `?utm_source=test&utm_medium=qa&utm_campaign=debug`，同意统计；GA Admin → DebugView（或安装 Tag Assistant）可看到 `page_view` 的 `page_location` 含 utm。客户端事件需开启调试：Tag Assistant 连接，或临时在控制台 `gtag('set','debug_mode',true)`。
2. 用新 Google 账号注册：出现 `sign_up`；库中 `user_attribution` 一行 `utm_source=test`。
3. 生成视频：出现一次 `generate_video`，参数无 prompt。
4. 点击购买：`begin_checkout`。设置 `GA_API_SECRET`、`GA_MP_DEBUG=true` 后完成一次 live 支付，回到订单页：DebugView 出现 `purchase`，`analytics_purchase_events.status=sent`；刷新订单页不重复。
5. 拒绝统计：`kr_ft`／GA cookie 被删除，GA 请求为零；DELETE 成功后 `kr_analytics_consent` cookie 与此浏览器的订单上下文清除。等待登录令牌过期后重复，仍应成功；同一账号另一设备拒绝后付款不得产生 purchase。
6. 标准报告中 `purchase` 需 24–48 小时；可在 Reports → Monetization 和 Traffic acquisition 按 session source/medium 查看。

## PR #4 审查修复（2026-10-28）

- Cookie 解码分层：浏览器读取原始 cookie 仅 URI 解码一次；服务端 Hono `getCookie` 已解码，使用 `parseDecodedFirstTouch` 直接解析 JSON，含 `%`、编码片段与中文的活动名原样保留。
- 数据库验收覆盖浏览器凭据撤回、跨设备订单隔离、订单重试保持初始上下文和实际 purchase session_id；客户端用例覆盖延迟 gtag 回调、撤回失败／重试；最终执行结果见下方部署记录及 PR 说明。

<a id="pr4-production-20261028"></a>
## PR #4 合并部署与接续（2026-10-28）

江昪授权修复审查问题、更新 PR，随后要求合并部署。[PR #4](https://github.com/Glowin/last-mile-ai-video/pull/4) 已合并为 `ea7ee21a0f9d2edfa61586f5cdf297d960995959`，生产已验。以下为本轮实测记录，不代表后续配置永远不变。

- 合并最新 main 后，隔离 PostgreSQL／应用容器共跑 457 项：356 通过、0 失败、101 按前置条件跳过；类型检查与 Linux 生产构建通过。测试容器无外网、无宿主端口或生产凭证挂载，结束已清理；不称为全部用例通过。
- 发布前新建数据库备份并验证归档清单可读，未做恢复演练。发布后 web／db 健康，生成与账单 worker 运行；13 项迁移及其校验和匹配。两项统计迁移与 `0011-generation-automation.sql` 共存，按完整文件名排序；不重编号或改写已应用迁移。
- 除生产源码 HEAD 外，核对运行 worker 的统计／结账关键文件哈希、web 镜像迁移文件及数据库校验和；业务配置指纹、已有用户／订单／任务数量与部署前一致。记录只保留断言，不公开真实配置或备份位置。
- `/api/health`、`/create`、`/privacy` 返回 200，隐私页含新的撤回说明。无账户登录的合成浏览器凭据 POST 200，Cookie 为 Secure／HttpOnly／SameSite=Lax；跨站 DELETE 403，同源 DELETE 200，Cookie 和数据库凭据均已删除。该探针未创建订单、生成视频或向 GA 发送事件。
- 此次 PR 合并部署时，生产 `GA_MEASUREMENT_ID` 已配置，`GA_API_SECRET` 未配置，购买发送路径关闭；该历史状态已被下方23:21配置验收更新。代码部署与合成接口验收不等于 GA DebugView／真实支付验收。

**接续：** 当前配置及剩余真实事件验收见下方最新记录。退款事件与对账 worker 单独完成付款时的触发缺口仍见上方实现边界，本轮未补齐。

**四项修复的复用判据：** 撤回能力不能随短期账户令牌一起过期；发送许可必须来自该订单下单浏览器，而非同账号其他设备；保存 client ID 不足以证明原会话归因，须显式验证 session ID 与时间窗；Cookie 解码入口要区分浏览器原始值与框架已解码值。对应回归分别在 `tests/analytics-consent.test.ts`、`tests/analytics.integration.test.ts`、`tests/analytics.test.ts`，后续改动沿这些边界验证。

**本轮走不通的路：** 本机 Python urllib 两次读取分块响应出现 `IncompleteRead`；改用 curl 获取完整页面并完成授权／撤回验收。只记录客户端链路差异，根因未查明，不据此推断服务故障或 Python 客户端普遍不可用。服务器源码目录已更新也不能单独证明运行镜像更新，须结合上述容器与行为证据。


<a id="ga-production-config-20261028"></a>
## GA 管理与生产密钥配置（2026-10-28 23:21，北京时间）

用户授权继续完成配置后，已接受 GA 数据收集声明，创建本站专用 Measurement Protocol 密钥，保存到 Dokploy 的 `GA_API_SECRET`。保存后刷新平台回读匹配，其他变量保持不变；平台重新部署记录为 done。生产 web 实际环境与密钥一致且 healthy，两个 worker 均没有该密钥、继续运行；服务器源码仍为 `ec78499`，服务器经公网 HTTPS 健康检查返回 `status=ok`。本机一次公网连接超时，不能由此推断生产服务失败。实际值与部署标识仅保存在库外和平台。

- GA Admin API 回读：关键事件为 purchase、sign_up、begin_checkout；5个事件维度为 model、generation_mode、resolution、billing_mode、method；指标 duration_seconds 为秒、credits 为普通数值；事件和用户保留期均14个月。generate_video 未标记为关键事件。
- Search Console 域资源与本站 Web 流关联已在界面显示 `LINK CREATED`，关联列表含正确的本站域名及流。本次未扩大服务账号的 Search Console 权限。
- `GA_MP_DEBUG` 保持关闭。Tag Assistant 连接未成功，DebugView 尚无匹配事件；新测试账号登录遇到Google人机验证，用户尝试后报告登录失败，尚未确认注册成功。注册、生成、结账、购买四项真实事件均未宣布通过，未伪造事件或复用历史订单。
- **下一步：** 完成指定新账号登录与真实事件验收；用户已单独批准指定账号的单笔付款与单次生成预算，完成后关闭试点；具体账号、预算上限和授权范围仅在私有接续记录登记。登录成功后按现有受限试点设置进行，不能公开开售或增加测试次数。付款前短时开启 `GA_MP_DEBUG=true`，结束清空并验运行态。GA 收到事件与业务表状态均需匹配；配置生效不等于购买转化已经验收。
