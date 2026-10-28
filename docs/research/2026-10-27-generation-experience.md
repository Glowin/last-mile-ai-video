---
title: "KakaReel 生成体验：官方资料与代码缺口复核"
date: 2026-10-27
status: "研究与本轮实现完成；本地行为验收通过，生产状态见 launch-readiness"
method: "公开官方文档检索与正文核读；项目规范、既有研究及 studio.tsx 只读检查"
access_date: 2026-10-27
---

# 建议与证据边界

本轮优先让用户准确知道“是否提交、是否仍在处理、额度发生了什么、下一步点哪里”。保留现有报价、预留、原任务恢复机制，先补状态呈现与可发现性；复杂作品管理后置。

- **官方文档证据**：下表是厂商自己描述的规则／操作路径，不能当成本轮实际体验，更不能直接成为 KakaReel 的服务承诺。
- **代码事实**：完整只读检查 `src/components/studio.tsx`，补查 `home-link.tsx`、`models.ts` 与相关 CSS；没有验证服务端账本、上游接口或线上部署。读取期间主代码 Agent 正在编辑，以下是工作区快照，交接时须按函数／文案重新定位，不能按旧行号直接覆盖。
- **推断／建议**：缺口及改法由代码与官方资料推导，不代表已发生用户损失或已证明转化提升。**未测 UI**：本轮没有进入任何认证浏览器、购买、生成、截图或设备实测；Glow 由主会话独占。未测真实等待时长、完成率、屏幕阅读器、移动端布局和下载行为。
- 已查看 `docs/research` 的既有材料，重点回读站点研究、个人定价研究、支付／视频成本的失败与未知状态条款，以及两篇 2026-10-25 研究。旧报告的“待实施”是当时状态，不能覆盖当前代码已有能力。[既有失败口径](2026-10-21-video-pricing.md#112-失败由谁承担)。
- 江昪本轮明确反馈：生成按钮未持续显示处理中、提交后找不到结果区、已登录仍收到登录提示。研究子任务只读外部资料与代码；后续主会话实现及验收记录见文末。

# 可迁移的官方证据

所有链接访问日期均为 **2026-10-27**；以下均为转述。

| 编号／官方来源 | 核到的事实 | 对 KakaReel 的启发与边界 |
|---|---|---|
| R1 [Runway：生成卡住](https://help.runwayml.com/hc/en-us/articles/32881061675795-Why-is-my-generation-stuck) | 进度停住仍可能在处理；其取消操作有独立条件且不返还已用积分 | 页面等待不能等同失败；取消与返还必须分开说明。不要照搬其时限或百分比 |
| R2 [Runway：生成错误](https://help.runwayml.com/hc/en-us/articles/32880432736659-Why-am-I-receiving-errors-when-trying-to-generate) | 区分政策拦截与生成错误；生成错误会返积分；政策误判可反馈，但反馈不立即放行，不能反复提交相同受限输入 | 失败、审核、申诉各给对应行动；返还是否完成应读本站账本 |
| R3 [Runway：导航](https://help.runwayml.com/hc/en-us/articles/24298206897043-Navigating-Runway) | 持续导航提供 Home、Recents、Assets；Assets 可找回与下载成片 | 首页、历史、账户入口持续可找；无需复制其全部导航层级 |
| R4 [Runway：网络问题](https://help.runwayml.com/hc/en-us/articles/51474557342227-Identifying-and-troubleshooting-network-issues) | 生成已完成但媒体不显示，也可能是网络问题 | 播放／下载失败先恢复原媒体，不能默认重新生成 |
| H1 [Higgsfield Changelog](https://higgsfield.ai/creator-hub/changelog)，2026-10-03 条目 | 披露 Seedance 上游故障导致失败与缓慢，并说明该次失败积分自动退回 | 故障说明应明确影响范围与额度处置；单次事故说明不是全平台永久退款规则 |
| H2 同上，2026-09-24「Mobile interface redesign」 | 移动端打开提示词栏，左上入口打开导航，侧栏保留 Library、近期会话及账户余额入口 | 小屏优先创作，同时保留有名称、可发现的历史／账户入口；未实测其手机 UI |
| I1 [Invideo：历史](https://help.invideo.io/en/articles/9387704-where-can-i-check-my-history) | History 可查看以往视频；同时限定其覆盖 Autopilot，AI Agents 项目在 You | 历史入口必须说明覆盖范围；KakaReel 首版宜维持一个清楚入口，避免凭空拆分 |
| I2 [Invideo：用量](https://help.invideo.io/en/articles/9382129-where-can-i-check-my-current-usage) | Usage 显示当月用量，You 下按产物入口追踪创作／下载 | 总余额之外，应能定位是哪条任务预留或消费了额度 |
| I3 [Invideo：关页后任务](https://help.invideo.io/en/articles/17221480-will-an-assigned-agent-job-continue-if-i-close-the-browser-tab) | 已交给云端的任务可继续；须先确认提交，文件上传完成后才能依赖上传素材 | “可以离开”只能用于服务端已接收任务之后，提交中不能提前保证 |
| W1 [W3C：状态消息](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | 状态变化应能被辅助技术感知，无需用户主动移焦 | 为提交、刷新结果、任务完成设置适当 live region |
| W2 [W3C：最小目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[重排](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | 目标尺寸基准为 24×24 CSS px，并有间距等例外；纵向内容在 320 CSS px 宽度应保留信息与功能，二维必要内容除外 | 用于后续手机／缩放验收，不据源码直接宣判合规或不合规 |

# 现在：纳入当前修复后的验收

下列均为**代码事实＋推断建议**。优先级表示建议顺序，未扩大本轮实现授权。

| 优先级／问题 | 现有代码与实际缺口 | 最小改动／验收判据 |
|---|---|---|
| P0 状态真实性 | `checked`、`ready` 与 `jobs=[]` 初值不能表达“正在核会话／加载历史”；历史仅按长度显示空态。`refresh()` 没有独立 loading 状态 | 分开 session、history 的 loading／success／error；首次历史读取成功且为空才显示首次创作空态。已有列表刷新失败保留旧内容并标“未更新”。慢响应／失败均不闪出“没有视频” |
| P0 提交与刷新反馈 | `busy` 共用于解锁、退出、年龄确认、提交、恢复；生成按钮统一写 `Working…`。刷新按钮没有进行中反馈，先清 `pollError` 再请求 | 与主会话反馈／刷新改动合并：区分操作中的按钮文案，刷新防连点，成功与失败均有可见反馈；核状态失败不显示“生成失败”，不产生新任务。参照 R1、W1 |
| P0 pending／unknown 防重复消费 | 已有持久 request ID、报价有效性、`generationFlight`、reserved 标签、unknown 的 `/recover`；这是已有保护。提交异常后虽然尝试拉历史，但用户仍可能看到普通错误而去改输入再提交 | 将“检查原任务，不会创建新视频”放在任务卡和提交异常附近；若只有本地请求凭据也应说明“提交结果待确认”，不能编造 task ID。改提示词／参数是新意图，可能另收费，先给历史入口。保留 damaged request 重置警告；前端文案不能替代服务端幂等证明 |
| P1 登录、权限与服务状态 | `!user` 时始终可见 Google 登录入口，尚未完成 session 读取也会出现；登录后 `canGenerate=false` 的提示固定为输入预览码解锁生成，未区分 paid 模式与预览资格 | 初次核身份时显示正在检查；区分 Google 账户、访客预览会话、预览资格、付费资格及服务未就绪（2026-10-29全产品取消年龄验证）。提示应指向当前模式缺什么，不能把预览无权限说成全部不能生成；会话失败提供重查入口 |
| P1 审核／失败说明互相矛盾 | `jobLabel()` 已识别 rejected／expired，但详情正文先看 `reviewRequired` 再看普通 failed，可能出现标题“审核拒绝”而正文“供应商未完成，请新建”。`success` 无 `resultUrl` 时落入普通等待说明 | 用同一展示状态同时决定标题、正文、按钮；审核拒绝／过期走规则与申诉，生成失败走编辑后新报价，success 无媒体走交付异常。每张卡显示服务端实际 creditState；未回读释放前不能写已返还。参照 R2、H1 |
| P1 媒体恢复 | `<video>` 未见 `onError` 或播放失败恢复 UI；已有 Open / download，且说明供应商链接可能到期 | 保留成功任务与原任务 ID，媒体失败给重新加载、打开原链接、联系支持；不自动新生成。链接失效是否能续签须先核服务端能力，不虚构“恢复下载”。参照 R4 |
| P1 导航与历史可发现性 | 已有 `HomeLink`、My videos、Pricing、Account；不能再称“没有返回首页”。650px 以下 `.side-nav` 的字号为 0，小屏可见文字消失；结果面板在控制表单之后。历史只显示日期、提示词、模型与状态，额度状态须点开 | 验收主会话导航修复：小屏保留易懂文字／菜单名称，不能只靠图标；完成提交后让用户找到结果区并听到状态。历史行补关键预留／消费状态与提交时刻，便于辨认近似任务；别把当前编辑规格误当历史任务规格。参照 R3、H2、I1、I2 |
| P1 无障碍基础 | 已有错误 `role=alert`、报价 live region、部分图标标签、focus-visible 与 reduced-motion；不能笼统说未做无障碍。普通任务标题／刷新成功尚无状态播报，选中项主要靠 class | 为一般状态使用简短 polite 播报，异常才用 alert；相同任务不随每轮检查重复朗读。按钮组用恰当 pressed／current 语义；若实现完整 tabs 则同时补键盘行为。手机与键盘实测，不把增加 ARIA 当作通过验收。参照 W1、W2 |

**显示规则建议**：任务生命周期、审核状态、额度状态、连接状态分别存真值，再组合呈现。没有可靠 queue 字段时，写“已提交，等待处理／生成”，不要擅自增加“排队第几位”。没有真实进度数据时只显示不定进度活动提示；不按计时器编造百分比或完成时间。“最近检查成功时间”只在服务端查询成功后更新，不因计时器运行而刷新。

**英文文案候选**（上线前由主会话按真实契约核对）：

- 身份读取：`Checking your session…`
- 历史读取：`Loading your videos…`
- 刷新失败：`Couldn’t update status. Your last known tasks are still shown. Check again.`
- 提交结果不明：`We couldn’t confirm submission. Check My videos before starting another generation.`
- unknown 恢复按钮：`Check this task`；邻近说明 `Checks the existing task without creating another video.`
- 明确 failed：`This task failed. Check its credit status below before creating a new generation.`

# 以后：需要契约或更多使用量再做

1. **持久导航与草稿恢复**：当前 `tab`、选中任务、提示词和图片主要在组件状态；评估任务深链、返回／刷新后恢复及草稿保存。账户隔离、图片体积与隐私先定，不把素材直接塞 URL。首轮先不让成功提交后的状态丢失。
2. **unknown 的运营闭环**：明确多久介入、由谁查账、怎样反馈；不能无限冻结或计时到点直接判失败。恢复入口显示最后一次可靠结果与 task ID；无任务 ID 的请求另走凭据恢复。方案依赖服务端恢复与账本契约，不在本报告假定已支持。
3. **历史规模化**：待确认服务端返回范围后再做分页、筛选、搜索、批量下载和规格复用；前端 `jobs.length` 只能表示当前取得的列表条数，不能承诺账户总量。参考 Runway 的组织能力，不复制整套项目系统。
4. **可靠交付与通知**：到期媒体恢复、保留周期、完成通知都须先落实服务和授权；当前继续明确及时下载，不承诺永久保存或已建立邮件通知。

# 主会话可执行的验收清单（本轮未运行）

用隔离 fixture／mock 覆盖下列条件即可验证展示，不需要真实扣费或调用模型；浏览器与 Glow 仍由主会话安排。

1. session 慢响应、失败、访客、Google 已登录但无预览资格、付费可用但预览不可用：文案与按钮各自对应；后台服务未就绪不伪装登录失败。
2. history 首次慢响应、空列表、已有列表刷新失败、恢复成功：不闪假空态，旧列表保留；刷新、recover 只查／恢复原任务，不发新建生成请求。
3. 提交响应丢失、刷新页面、同输入再操作、改输入、损坏本地凭据：原 request ID 的复用边界可解释；重置或新意图须显式操作，不能静默再次消费。服务端最多一次预留／消费须由主代码测试另证。
4. pending、unknown、审核 pending／rejected／expired、failed＋released、failed＋reserved、success 无链接、视频加载失败：标题、正文、行动与额度一致；媒体失败不会生成新视频。
5. 320／375 CSS px、长邮箱、长提示词、键盘与屏幕阅读器：首页／历史／账户入口可找、无关键信息截断；进入结果有反馈、普通状态不过度朗读、减少动态设置有效。未实测前不写“手机或无障碍已通过”。

验收应回报主会话实际修改后的行为与证据；本报告没有提供截图、性能数字、真实生成结果或部署完成声明。

# 本轮落地与验收（2026-10-27）

已实现：持续的提交／生成反馈；输入审核、输出审核与未知结果分开呈现；按钮邻近提示及自愿点击的 View progress；不改变 URL 的定位与键盘焦点；已登录／访客／会话检查中的不同文案；刷新及恢复反馈；历史加载、失败与空态区分；原媒体重新加载；小屏导航文字。相同页面内相同未终结输入保留原任务，不自动另建或消耗积分；这不构成跨设备的内容去重承诺。

主会话使用本机隔离 API fixture 验证提交瞬间、持续生成、unknown、输出审核、审核拒绝、历史慢加载及刷新／恢复错误。成片链接故意返回无效媒体时出现 Reload video／Open original video，均未新建生成请求。View progress 后焦点为结果区、URL hash 为空；375 与 320 CSS px 宽度下无页面横向溢出，导航文字可见。未使用这些模拟结果冒充真实生成，也未完成真人屏幕阅读器或真实手机硬件验收。

离线测试199通过、0失败、83项需要独立数据库的测试跳过；类型检查、生产构建通过。本轮没有数据库迁移，不把上述结果称为数据库完整回归。生产部署与真实任务未决项统一见[上线验收](../launch-readiness.md#studio-ux-20261027)。
