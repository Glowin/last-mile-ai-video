---
title: "KakaReel MVP 与上线状态"
date: 2026-10-23
source: "江昪与主会话 2026-10-23 确认；本地测试日志；历次源站与控制台验收"
status: "715e6b0 已部署；线上定价与路由已验，服务端收费关闭；worker 常驻与生产迁移数待回读；退款 unknown 冻结"
---

# KakaReel

江昪于 2026-10-20 确认：面向海外视频生成用户，做 All-in-One 视频生成站；接入 VibeToken，覆盖 Seedance、Kling、MiniMax H3。品牌域名选定 `kakareel.com`，Logo 与吉祥物使用鸮鹦鹉。2026-10-20 已在 Cloudflare 完成注册，注册管理页面确认状态为 Active。现已部署至既有 Hostinger 的 Dokploy，正式地址为 https://kakareel.com 。

《最后一海里计划》是公开直播系列，目标是展示从创意、开发、上线、首位付费用户到 US$100 收入的过程。KakaReel 是这次系列的产品，代码开源。未宣称已有用户或收入。

## 2026-10-23 收费准备进展

- 已确认 US$19／150 credits、一次性、税外标价、积分不过期、14 天内整包未使用全额退款；不自动续费。
- Seedance／Kling 单位歧义已澄清，现行八项文生费用见 [成本订正](research/2026-10-21-video-pricing.md#2026-10-23-现行决定与成本订正)。图生仍需单独核价。
- Pancake 个人／中国测试商店、Starter Pack 商品与专用测试密钥已创建；配置仅库外受限保存。客服邮箱 [support@kakareel.com](mailto:support@kakareel.com) 的 Cloudflare 转发为 Active，用户实际收信完成 Pancake 验证，主会话已回读确认；不公开内部转发目标。
- 主会话完成首笔官方 Pancake 沙盒 USD19 支付；authenticated GraphQL 回读为 paid，小计 1900、税额 0、总额 1900（USD 最小货币单位），已入账 150 测试积分。这是零税额测试付款，不是正式收入，也不证明有税交易或 webhook 已验收。
- 退款只读 diagnosis 实际执行成功：查询结果为 0 tickets／0 refund，原 payment succeeded 且金额匹配；这不证明退款失败或完成。该单仍为 unknown，对应 150 测试积分保持冻结，不重试提交。退款终态、到账与 webhook 送达仍未验收。
- 本轮定价、钱包／生成结算与 Pancake bridge 的主会话完整测试为 **168 passed、0 failed、0 skipped**；已回读本机临时日志 `/private/tmp/kakareel-tests-final.log`。这是该次代码快照的测试结果；主会话随后确认新增诊断 27 项定向测试通过，最终 build／tsc 通过。两轮测试分开记录，不合称一次全测。
- 主会话已验 Dockerfile worker target 镜像构建与空库 runtime：非 root UID 1000，在空 `video_worker_qa` 上完成 start → 5 项迁移 → once，退出码 0，jobs 0，未配置上游 Key。仅证明空库启动链路，不代表有任务恢复或生产常驻已验。完整测试库准备见[部署说明](deployment.md#完整测试的独立数据库)。
- 主会话经授权完成生产数据库 `pg_dump`，备份保存在既有卷；文件 26722 bytes，`pg_restore --list` 可读、输出 72 行。未在公开文档记录实际路径；目录可读不等于已完成恢复演练。
- **`715e6b0` 已推送 main 并部署。** 主会话回读 Dokploy 完整日志为 `Docker Compose Deployed ✅`，新 Web 与 worker 均显示 Started。观察到 Dokploy 标签页在本会话未操作时连续切换，为避免干扰，主会话已停止该页操作；worker 常驻状态及生产迁移数尚未回读，不能用 Started 代替验收。
- 线上 `GET /api/billing/catalog` 已核为 USD 1900 最小货币单位／150 credits，`checkoutEnabled=false`，全部 provider unavailable；服务端实际收费保持关闭，生成收费也未开放。
- 主会话浏览器已视觉验收线上 `/pricing` 的 US$19＋适用税费、八项费率和客服链接。最终 probe：`/pricing`、`/terms`、`/privacy`、`/create`、`/api/health`、`/api/billing/catalog` 均 200；前三页 `support` mailto 命中，`/create` 的 `Generate preview video` 命中；匿名 billing／jobs 均 401。
- 测试 dev 已停止；临时 PostgreSQL 已留存排除 auth 数据的库外沙盒账本备份；本轮临时容器与 worker 测试镜像已清理，其他项目容器保留。下一步由主会话在确认 Dokploy 页面空闲后回读 worker 常驻及生产迁移数，继续只读核退款；正式收费保持关闭。

## 当前实现

- 英文首页、三个模型落地页、工作台、公开开发介绍、条款与隐私说明；公开客服入口已上线，定价／条款／隐私页的 support mailto 已核。
- 文生视频、单张图片生视频；模型对应的时长、比例、分辨率与声音选项。
- 服务器端调用 VibeToken；任务写入 PostgreSQL，查询状态、预览与打开视频保存。
- Google 独立账号与跨设备历史；保留访客预览、HttpOnly cookie、邀请口令、全站每日任务上限。
- 请求 ID 落库后才提交；超时标记状态未知，同一 ID 恢复，避免重复付费生成。
- 既有部署为 Docker Web 容器＋独立 PostgreSQL；本轮 Compose 增加独立 worker，镜像构建与空库 start／migrate／once 已验，部署日志已显示 Started，生产常驻状态和生产迁移数尚待回读。

邀请制与每日任务上限是本轮 MVP 的实现选择，用于有限预算的演示。Google 账号历史随账号保留；尚未登录的访客在清除 cookie／退出后会失去原会话入口。账户资料与会话管理、定价页面和一次性积分包的订单／事件／账本基础已实现；真实收款、生成扣减、自动素材保留与删除流程尚未开放。

## 调研如何落地

依据 [竞品报告](research/2026-10-19-ai-video-sites.md)：首屏说明输入和输出、明确进入工作台的按钮、模型落地页承接具体需求、示例提示词降低开始门槛、FAQ 解释价格与使用边界。模型入口保留选择进入工作台；公开页面有独立标题、描述、canonical 与 sitemap；工作台不索引。

首页示例是明确标注的提示词概念插画，不冒充实际视频。现已有一条经播放验收的 MiniMax 鸮鹦鹉测试成片，但未作为首页示例发布；仍无实际用户证言。公开价格须先核对账户计费，再上线支付。

## 2026-10-20 上线检查点

| 项目 | 已完成证据 | 尚未完成 |
|---|---|---|
| 代码与品牌 | 代码已推送 `main`；Logo／吉祥物已用于页面 | 无正式 Figma 源稿与矢量 Logo |
| 生产服务 | 独立 Compose，Web 与 PostgreSQL 容器均 healthy；含 `96e2244` 数据库镜像修复；main push 自动部署已用 `6949df4` Done 验证 | Google 登录 `b5e0dcd`、账户与支付基础 `9ae7ca4` 已发布；真实收款关闭 |
| 域名与 HTTPS | Cloudflare A 记录、公共 DNS、正式证书已验；本机普通域名请求已恢复，健康接口 200；Glow 已实际打开首页并视觉检查 | 工作台完整交互与手机布局待验 |
| 源站验收 | 16 项路由／素材状态检查符合预期；公开页 canonical、sitemap 正确；工作台 noindex；匿名任务接口 401；线上首页、成片直链播放下载已验 | Google 登录、刷新、退出及再次登录于 2026-10-21 通过；手机布局待验 |
| 上游接入 | 专用 Key 已在平台运行环境配置；`/api/session` ready=true；邀请口令登录、数据库历史查询成功；MiniMax H3 6 秒 2K 文生视频成功，Glow 实际播放并下载；文件实测 2560×1440、6.584 秒；上游实际扣费已核 | Seedance 4 秒 480p 文生测试失败，VibeToken 日志明确 Invalid parameter value: resolution、未扣费；已停止新付费调用；Kling 和全部图生流程未做真实验收 |
| 收入目标 | 直播与开源产品路线确定 | 支付、首位付费用户与 US$100 收入 |

最初源站检查使用正式 HTTPS 域名并在请求层指定已核实的源站地址，没有跳过证书校验。2026-10-20 后续复查：普通域名请求 `/api/health` 返回 200（无源站覆盖），Glow Chrome 已显示正式首页；此前“本机 DNS 待恢复”状态已解除。首页可见不等于登录和生成工作台的全部交互已验。

**接续依赖与已有授权：**

- 江昪已授权开发、push、复用现有 Dokploy 部署。项目源为本仓库 `main`、根目录 `compose.yaml`。管理入口、服务器地址、部署 ID、运行参数留在库外／私域，不写公开仓库。
- 江昪已完成 VibeToken 账户准备，并明确授权创建项目专用 Key、只存库外与 Dokploy。此前“暂缓 Key 设置”已被 2026-10-20 的新授权替代。
- 真实验收仅有本轮有限预算授权，金额与账户流水留私域；不能外推为无限消费。新任务提交前核报价与剩余额度，失败或超额即停止，不自动充值。已提交任务只按原 ID 查询，不能重复提交。
- 生产配置启用邀请口令和每日提交限额，不代表开放免费生成。邀请口令从项目库外运行配置取，不放聊天截图或公开文档。
- 项目真实配置始终在仓库外，包括忽略文件也不能保存；不复用其他应用的密钥。浏览器密钥交接临时文件已删除。

## 后续验收

1. Seedance 已失败且未扣费；公开接口规格与实际 480p 支持不一致，后续需核对提供方支持范围。MiniMax 成片已验。按授权，失败后停止所有新付费调用。
2. 首页与正常 DNS 已复核；Google 登录、真实登录／退出／刷新及未邀请权限已验；手机布局待验；用户管理与支付基础已上线，不产生新的付费生成调用。
3. 后续真实模型验收须重新取得授权；本轮因 Seedance 失败已停止，不以剩余预算当作继续调用的许可。
4. 自动部署已验：GitHub push 投递 200，Dokploy 对应提交 `6949df4` Done。后续推送仍须等部署终态再验实际服务。
5. 邀请一位真实用户完成任务，再围绕反馈推进账号、支付与 US$100 目标。

实施步骤见 [部署说明](deployment.md)，接口差异见 [VibeToken 接入](vibetoken.md)。首轮 MVP 的临时服务已收尾；Google 登录补丁的测试资源另按该任务交接清理。接续以本仓库、部署平台和库外专用配置为准，不依赖旧 tab ID。

## Google 登录与搜索平台接入（2026-10-20）

江昪明确要求先基于 13F Insight 的架构接入 Google 登录，同时接入 Google Search Console 与 Bing Webmaster。复用 GIS、JWT 与刷新令牌轮换模式，KakaReel 使用独立账号数据和配置；不共享参考项目凭证。本轮未扩展邮箱密码登录、支付或积分。

| 项目 | 2026-10-20 已核实状态 | 接续与验收条件 |
|---|---|---|
| Google Cloud | 独立项目与 Web OAuth 客户端已创建；仅授权正式 HTTPS origin；品牌首页、隐私、条款和域名已填；Audience 显示 In production；没有绑定付费账单 | 不重复创建项目或客户端；GIS 流程只需 Client ID，无需保留客户端 secret |
| 用户授权 | 江昪分别明确允许创建配置、同意 Google API Services User Data Policy、发布 Production | 已有授权持续有效，不再以先前拒绝为由重复询问 |
| 运行环境 | Client ID 仅保存到库外配置及 Dokploy 环境，未写入仓库或构建参数 | 环境保存不等于新代码已运行；发布后回读 `/api/config` 与实际页面 |
| 登录实现 | 本地补丁包含独立用户表、HttpOnly 会话、刷新令牌轮换、邀请权限、旧访客历史迁移和增量迁移；实现子任务已完成 23 项测试（0 跳过）、类型检查、构建、Docker 旧库升级与重启保留数据检查；主会话审查完成，`b5e0dcd` 已上线并通过真实登录、刷新、退出与再次登录 | 旧库两条任务及 owner 摘要保留；新账号无邀请权限；后续用户管理另验 |
| Google Search Console | 域名资源已通过 DNS 验证；sitemap 为 Success，发现 5 个页面 | 这是发现数量，不是收录或排名；后续查索引报告 |
| Bing Webmaster | 站点与验证 CNAME 已创建、公共 DNS 生效；提交 sitemap 曾报临时错误，无成功回执 | 江昪修复 Chrome 拦截后重试已可打开，但出现欢迎页和账号字段 0，需先恢复／核对当前账户，再读站点验证与 sitemap 状态 |

Google 与 Bing 的具体操作证据、失败边界与下一步见 [搜索平台记录](search-console.md)。2026-10-20 的功能基线为 `6949df4`。Google 登录补丁保存在独立分支 [`feat/google-signin-20261020`](https://github.com/Glowin/last-mile-ai-video/tree/feat/google-signin-20261020)，架构与验证说明随分支保存于 `docs/google-auth.md`；2026-10-21 已合并为 `b5e0dcd` 并上线；详细证据见 [Google 登录验证](google-auth.md)。

2026-10-21 接续：Google 登录与工作台 SEO 已上线；继续用户管理、付费计划调研／页面、支付后端基础与 Pancake 前置任务，Bing 后续已恢复并核得 sitemap Success。以上由 Agent 继续处理；只有账户必须真人登录或出现新的权限边界时才交给江昪。

## 2026-10-21 工作清单（历史验收）

江昪本日明确要求完成昨晚剩余任务、准备晚间 Waffo Pancake 接入（Google 登录与用户管理）、仔细学习优秀站点的付费计划，并建设定价入口／页面及支付后端；Stripe、Waffo Pancake、Waffo、Antom 的真实渠道接入留后续。工程由并行子任务实现，主会话负责方案取舍、审查与生产验收。

| 工作 | 当日事实 | 当日接续判据 |
|---|---|---|
| Google 登录 | 全站共享登录已上线；`db46eca` 修复双浮窗：只让 Google 自动提示，站点卡片仅主动点击 Sign in 后出现；首页、定价、工作台已验 | 江昪截图确认原生 One Tap 可出现；此前真实登录保留提示词、退出抑制已验，新版本隐身／窄屏待验，详见 [登录记录](google-auth.md) |
| 工作台 SEO | canonical、54 字符 title、156 字符 description、分享标签及有意义的 H2/H3 已线上核对 | 工作台继续 noindex；装饰图片空 alt 有语义依据 |
| Seedance 480p | 已移除 480p 选项并增加本地拒绝与旧任务保护，回归通过 | 生产选项仅 720p／1080p；不把本地阻止当成旧任务远端失败，无新付费生成 |
| 用户管理 | 已上线；本人资料、当前会话、无其他会话的禁用状态、退出及重新登录在 Glow 实测通过 | 多会话撤销与跨用户隔离由独立 PostgreSQL 回归验证；生产没有人为制造其他设备会话 |
| 付费计划 | 原研究及 [三站个人定价视觉报告](research/2026-10-21-individual-pricing-visual-review.md)完成，9 张截图库外归档；`/pricing` 继续未开售 | 江昪确认先一次性后订阅，首渠道 Pancake；六模型成本详情已核，已于 2026-10-23 确认 $19／150 credits；Seedance／Kling 单位已在登录生成页澄清；详见[成本与失败测算](research/2026-10-21-video-pricing.md#11-vibetoken-成本复核失败损耗与首包建议2026-10-21)，未开售 |
| 支付后端 | [一次性额度包基础](billing-backend.md)已上线；Pancake SDK 接入层已实现，14 项离线测试、类型与构建通过；生产 catalog 仍关闭 | SDK 层尚未桥接订单事务；生成报价／扣减／失败释放、内容审核和真实沙盒仍待完成，不是已可收款 |
| Pancake 研究 | [接入研究](research/2026-10-21-payment-integration.md)已完成 | 需本项目测试资源、商户路线与 AI 视频准入确认；不是已接入 |
| Bing | 江昪恢复登录后，sitemap 提交并刷新为 Success，发现 6 URL、错误／警告均为 0 | 索引与排名另验；不把 DNS 按钮旧错误当成成功回执 |

本日未提交任何付费生成或真实支付。未获新的模型测试授权，不沿用此前失败后停止的预算继续消费。付款页面将明确未开售，不显示伪造价格、折扣、客户数或成功交易。

集成验证：2026-10-21 完整 Next.js 构建通过；74 项测试通过、0 失败、0 跳过，包含独立 PostgreSQL 上的登录、账号隔离、迁移、订单幂等、回调及账本回滚。临时测试容器和卷已清理。PR #2 合并为 `9ae7ca4`，Dokploy 对应提交 Done（17 秒）。生产健康 200、匿名账户／账单 401、已知但未配置 webhook 503、无 Origin 的 checkout 403；sitemap 六页。付款返回页带 `status=success` 仍显示 No order selected，不会伪造支付。

本次升级前另做了包含 Google 用户的数据库备份。浏览器恢复后已直接核对生产数据库：三条迁移均应用，用户一位，原有两条视频任务及归属摘要与备份前一致，订单／事件／积分账本均为零，已使用的刷新令牌记录三条。移动端同样待验：viewport 覆盖未改变测量宽度，随后调试调用超时；停止重试，未宣称手机验收通过。域名续费两条持久提醒仍未创建，当前工具没有可用的个人提醒调度入口，保留知识库原待办。

## 2026-10-23 导航滚动修复

江昪反馈：Pricing 未定位到套餐区域，跨页点 Logo 返回首页会滚到底。生产复现：首页 → Pricing 为 y=0，套餐区距顶部约 535px；Pricing → Logo 后首页 y=2580，等于最大滚动值。

移除非固定顶栏场景下的全局 95px scroll padding，声明 Next smooth-scroll 属性；定价入口统一指向 `/pricing#access-options`。首版 `853f28d` 上线后套餐区约距视口顶部 32px，重复点击也正常。其 Logo 的 `/#top` 方案被江昪验收否决：**首页 URL 必须保持干净的 `/`，不能为回顶添加 `#top`。** 此要求覆盖导航、页脚和工作台 Logo。

现行 Logo 统一使用 `HomeLink`，实际 href 为 `/`，跨页使用 Next 普通导航；已在首页时直接滚回顶部，如已有查询／锚点则导航回 `/`，不加入替代锚点。定价与模型锚点仍采用原生链接，跨页会完整加载文档；不增加全局滚动监听或改写历史恢复策略。

本地生产构建含类型检查通过；真实浏览器验证 Pricing／工作台 → Logo、首页底部重复 Logo、`#models` → Logo，均为 hash 空、y=0。前轮还验证了首次／重复定价入口、Models、普通跨页与前进／后退。未改数据库、支付、登录逻辑或运行配置；并行 GA4 更新已保留。生产验收截图留库外。

## 2026-10-23 GA4 接入

独立 GA4 资源与网站数据流已建立，`df826ca` 部署完成。正式站选择同意后加载统计；实时报告已核到测试用户 1、两页浏览各 1，撤回授权可清除 GA cookie 并停止加载。实现、采集边界与验收见 [GA4 访问统计](analytics.md)。不传提示词／账户／支付数据，未接购买等业务转化。
