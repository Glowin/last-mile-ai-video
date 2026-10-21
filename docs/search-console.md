---
title: "KakaReel 搜索平台接入与接续"
date: 2026-10-21
source: "Google Search Console、Bing Webmaster、Cloudflare 控制台实际操作；江昪会话指示"
status: "Google 与 Bing sitemap 均成功；索引与排名另验"
---

# 搜索平台接入

本记录承接江昪 2026-10-20「参考 13F Insight，把 Google Search Console 和 Bing Webmaster 都接入」的要求。仅操作 KakaReel，不导入其他站点或复制参考项目的凭证。

## 已完成与证据

| 平台 | 资源与提交 | 实际读回 |
|---|---|---|
| Google Search Console | Domain property `sc-domain:kakareel.com`；根域 DNS TXT 验证；提交 `https://kakareel.com/sitemap.xml` | Ownership verified；sitemap Success；提交与读取日期 2026-10-20；发现页面 5，视频 0 |
| Bing Webmaster | 手动添加 `https://kakareel.com/`；Cloudflare 验证 CNAME 为 DNS only，指向 `verify.bing.com`；公共 DNS 查询确认生效 | 2026-10-21 登录恢复后确认 Site already added；sitemap 提交后刷新显示 Success，发现 6 URL、错误 0、警告 0；CNAME Verify 按钮仍曾报 Unexpected error，不伪造单独的验证成功提示 |

Google 的发现页面数不是索引数。新资源报告仍在处理数据；不宣称已经收录、已有排名或搜索流量。TXT/CNAME 实际验证值、账户资料与平台配置均留库外，不写入这个公开仓库。

## Bing 接续结果（2026-10-21）

1. 最初受 Chrome ERR_BLOCKED_BY_CLIENT 影响；江昪本日再次完成登录并提供当前页面。
2. 欢迎页暂未列出站点，经目标域名入口返回 **Site already added**，确认已有资源而非重复创建。重开后进入 KakaReel 管理页。
3. 既有 CNAME 验证按钮仍返回 Unexpected error；这是该按钮的实际回执，不据随后页面可用推定该请求成功。
4. Sitemaps 列表最初没有条目，提交 `https://kakareel.com/sitemap.xml` 后出现 Processing；重新加载页面后 **Success、发现 6 URL、错误 0、警告 0**，最后提交及抓取日期均为 2026-10-21。保存和抓取成功已验，不需要重复提交。
5. 没有启用 GSC Import、读取其他属性或更改浏览器安全设置。展开 Personal details 被自动审批拒绝后跳过，未影响站点入口完成操作。

后续只需观察索引／搜索报告；sitemap Success 不等于已收录或获得排名。此前“等待恢复登录并确认 sitemap 保存”的待办已解除。若独立 DNS 验证状态今后仍有提示，再按当时可见状态排查，不能循环点击旧错误。

## 可复用做法与边界

- 复用 13F Insight 的独立站点验证、sitemap、canonical 和私有页面排除方式，不照搬其他站点配置。
- 本次版本 sitemap 包含首页、`/build`、`/pricing`、三个模型页共 6 个 URL；`/create` 不索引，`/api` 禁止抓取。`/account`、付款返回页、用户历史和生成结果不进入公开 sitemap。这不代表 GSC 已重新读取六页；此前控制台成功记录仍为五页。
- Bing Webmaster sitemap、IndexNow 和 Google Indexing API 是不同入口；本轮没有配置 IndexNow 或自动索引推送，不能因搜索平台接入就宣称自动收录。
- DNS 生效、平台产权验证、sitemap 接收和搜索收录是不同状态，分别取证。Bing 的报错后界面变化须再次读回，不能只凭按钮点击或站点入口存在宣布成功。

浏览器继续使用 Chrome Glow，并以当前 Profile 名识别，不固定标签或浏览器编号。Google 验证与 sitemap 截图已归档库外，归档入口由知识库项目档案维护。

2026-10-21 的成功截图已另存库外；历史受阻截图只保留追溯用途。
