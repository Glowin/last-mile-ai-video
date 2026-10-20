---
title: "KakaReel 搜索平台接入与接续"
date: 2026-10-20
source: "Google Search Console、Bing Webmaster、Cloudflare 控制台实际操作；江昪会话指示"
status: "Google 已验证且 sitemap 成功；Bing 状态待核"
---

# 搜索平台接入

本记录承接江昪 2026-10-20「参考 13F Insight，把 Google Search Console 和 Bing Webmaster 都接入」的要求。仅操作 KakaReel，不导入其他站点或复制参考项目的凭证。

## 已完成与证据

| 平台 | 资源与提交 | 实际读回 |
|---|---|---|
| Google Search Console | Domain property `sc-domain:kakareel.com`；根域 DNS TXT 验证；提交 `https://kakareel.com/sitemap.xml` | Ownership verified；sitemap Success；提交与读取日期 2026-10-20；发现页面 5，视频 0 |
| Bing Webmaster | 手动添加 `https://kakareel.com/`；Cloudflare 验证 CNAME 为 DNS only，指向 `verify.bing.com`；公共 DNS 查询确认生效 | 验证两次报 Unexpected error；之后可进入站点 Home/Sitemaps，曾不再显示 Not verified，但缺少稳定验证结果，不能直接认定完成 |

Google 的发现页面数不是索引数。新资源报告仍在处理数据；不宣称已经收录、已有排名或搜索流量。TXT/CNAME 实际验证值、账户资料与平台配置均留库外，不写入这个公开仓库。

## Bing 尚未完成

1. 已尝试提交相同 sitemap 一次，平台返回 “This might be a momentary issue”，尚未取得保存成功证据。
2. 之后页面出现 Chrome `ERR_BLOCKED_BY_CLIENT`。江昪确认已修复并允许重试；重试后页面能打开，但显示欢迎页、Profile 中账号字段为 `0`，没有稳定站点清单。
3. 当前应先恢复并确认原有账号，然后读取 KakaReel 的验证状态和 sitemap 列表。已存在就不重复新建；未保存才重新提交，并在页面重开后核条目、状态和日期。
4. GSC Import 入口的自动审批曾因可能涉及其他站点授权而拒绝；未执行导入，未授予读取其他属性的权限。继续使用已配置的手动 DNS 路径。

这些现象不能证明站点被删除、验证已失败或 sitemap 已保存。不要循环重试同一失败操作；先判断账号／界面状态。

## 可复用做法与边界

- 复用 13F Insight 的独立站点验证、sitemap、canonical 和私有页面排除方式，不照搬其他站点配置。
- 当前 sitemap 包含首页、`/build`、三个模型页共 5 个 URL；`/create` 不索引，`/api` 禁止抓取。用户历史和生成结果不进入公开 sitemap。
- Bing Webmaster sitemap、IndexNow 和 Google Indexing API 是不同入口；本轮没有配置 IndexNow 或自动索引推送，不能因搜索平台接入就宣称自动收录。
- DNS 生效、平台产权验证、sitemap 接收和搜索收录是不同状态，分别取证。Bing 的报错后界面变化须再次读回，不能只凭按钮点击或站点入口存在宣布成功。

浏览器继续使用 Chrome Glow，并以当前 Profile 名识别，不固定标签或浏览器编号。Google 验证与 sitemap 截图已归档库外，归档入口由知识库项目档案维护。
