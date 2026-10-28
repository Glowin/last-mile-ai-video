---
title: "注册体验与首页 SEO 修复"
date: 2026-10-29
source: "项目所有者转交并确认的访客反馈；代码、隔离 PostgreSQL 与浏览器验收"
status: "生产部署与页面验收通过；真实新用户转化待重试"
---

# 注册与预览体验

访客完成 Google 验证后，关闭出生日期弹窗，页面仍显示未登录。原服务端在年龄确认前不创建账户，故不能把 Google 验证通过当作 KakaReel 注册完成。项目所有者明确要求全产品取消年龄验证，覆盖 Google 登录、访客预览、工作台和生成接口；不是改到首次生成前再显示。

现行行为见[登录架构](google-auth.md#age-verification-removed--2026-10-29)。移除表单、前端状态、API 校验及旧确认端点；新登录和预览兑换不提交生日。既有邀请、账户隔离、nonce 防重放、余额、付费报价、预算和内容控制继续生效。保留历史迁移及年龄声明元数据，不删除记录或伪造已确认值。Terms 中成人使用资格仍是条款声明，没有互动验证步骤。隐私页更新为实际采集现状。

# 首页

- 独立首页标题包含品牌、AI Video Generator、Text/Image to Video；56字符。摘要按约150–160字符组织，保留各模型及用途。
- 单一H1为“KakaReel. AI video studio.”，保留原视觉风格；新增文本生成、图片生成、模型比较、结果保存四段实用说明。
- 本地DOM的 main 文本按空白切词为1031词，含可展开FAQ正文；这是页面快照指标，不是搜索引擎排名保证。
- 服务端输出 WebSite 和 WebApplication JSON-LD，URL来自运行环境的APP_URL。未编造评价、评分、已开售Offer或搜索功能。同步首页OpenGraph/Twitter及canonical。
- Google说明标题和摘要会按展示宽度截断，字数本身并无固定排名目标；本轮按访客建议改善信息量和可读性，不堆关键词。[标题](https://developers.google.com/search/docs/appearance/title-link)、[摘要](https://developers.google.com/search/docs/appearance/snippet)、[站点名称结构化数据](https://developers.google.com/search/docs/appearance/site-names)。

# 验收

- 真实隔离PostgreSQL的认证与账户测试通过；全套本地执行416项，293通过、0失败、123因其他独立数据库等前置未配置而跳过。不能称全部数据库场景完成。
- 新增回归覆盖无生日注册及直接来源行、回访不重复建号、刷新会话、无邀请拒绝生成、正确预览码放行、付费请求仍须报价、访客不写年龄表、旧年龄端点404与旧载荷不落库。模型供应商调用使用fake，无真实付款／生成。
- 生产构建通过；1720px与390px首页无横向溢出，移动端指南单栏；在本地生产构建中通过真实表单兑换合成预览码，无年龄表单，成功显示预览会话与历史入口。未提交生成。
- 2026-10-29生产功能版本 `0d08b57` 已部署，web与数据库healthy，两个worker运行；四个容器的环境配置指纹与部署前一致。HTTPS首页标题、摘要、H1及WebSite／WebApplication结构化数据与代码相符；生产匿名session不再返回年龄确认字段，旧年龄端点POST返回404。浏览器工作台不再展示生日表单。尚未代替访客重新完成真实Google登录，不把上线当作sign_up验收。

# 统计接续

没有UTM不妨碍注册。首次注册仍写来源行，缺少可用来源记direct；不能补造UTM。GA的sign_up仅在实际新建用户且浏览器允许统计时发送。注册、生成、结账和购买的真实事件验收依然分别核对，不拿本地模拟、Google账户弹窗或HTTP成功替代生产事实。具体账户、反馈原图和测试预算仅存私有接续记录。
