---
title: "GA4 访问统计"
date: 2026-10-23
source: "江昪 2026-10-23 接入指令；Google Analytics 控制台；本地与正式站浏览器验收"
status: "已部署，GA 实时报告收到测试访问"
---

# 采集范围

独立 GA4 资源与 Web 数据流已创建。实际标识仅保存在项目库外配置与 Dokploy 运行环境，代码通过 `GA_MEASUREMENT_ID` 读取；不需要构建参数。变量为空时不显示选择条、不加载统计。

首次访问展示可拒绝的统计选择条；同意后才加载 Google tag。页脚 Cookie settings 可重新选择，撤回会禁用标签、清除本域 GA cookie 并刷新。选择保存在浏览器 localStorage；无法保存时仅在当前页面有效。

仅手动发送 `page_view`，包含无 query／hash 的页面 URL 与标题；首次来源仅保留 origin。GA 自带会话、首次访问和参与度事件可能随标签发送。不传账户标识、邮箱、提示词、图片或支付详情；不接购买转化。移除 URL 参数也意味着 UTM 活动参数不会进入这版报表。

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
- 带合成 query／hash 的 URL 验字段过滤；后续增加 UTM 或业务事件时，显式选字段，不发送整段 URL、表单或账户对象。本轮未实现 UTM 归因、业务转化和跨标签撤回广播。
- 用真实浏览器请求与 GA Realtime 两层核验：collect 204 只说明端点接收，仍须在目标资源看到匹配的页面、事件与数量。首页／数据流的“未收到数据”提示不能覆盖实时报告已收到的证据。
- 原生截图已在会话中目视检查，但本轮未将截图归档为长期文件；长期证据目前为本文、代码提交及库外结构化验收记录，不宣称已有截图原件。

# 修订

- 2026-10-23：按江昪“沉淀”，补齐 GA 向导恢复、增强型衡量二次确认、Dokploy 编辑状态与配置输出边界；明确未验项目、未接的 UTM／业务事件和截图归档缺口。产品事实保留本文件与 launch.md 的单向指针，不新增 Core 竞争正本。

# 重查与官方依据

- 从现有 Google Analytics 账号选择 KakaReel，查看 Admin → Data streams 与 Reports → Realtime。
- [Google 页面浏览与自动 history 重复计数说明](https://developers.google.com/analytics/devguides/collection/ga4/views)。
- [Google 基础同意模式说明](https://developers.google.com/tag-platform/security/concepts/consent-mode)：授权前不加载标签。
