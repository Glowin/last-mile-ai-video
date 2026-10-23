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

# 重查与官方依据

- 从现有 Google Analytics 账号选择 KakaReel，查看 Admin → Data streams 与 Reports → Realtime。
- [Google 页面浏览与自动 history 重复计数说明](https://developers.google.com/analytics/devguides/collection/ga4/views)。
- [Google 基础同意模式说明](https://developers.google.com/tag-platform/security/concepts/consent-mode)：授权前不加载标签。
