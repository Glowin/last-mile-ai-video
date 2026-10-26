---
title: "KakaReel 品牌与鸮鹦鹉资产"
date: 2026-10-20
source: "江昪会话定案；内置 imagegen 生成初版"
status: "首版已接入；域名已注册"
---

# 品牌决定

2026-10-20，江昪确定域名 `kakareel.com`，并要求继续以鸮鹦鹉作为 Logo 与吉祥物。对外名称采用 **KakaReel**；仓库与直播系列仍保留 Last Mile 名称。此前 KakapoVideo 等方案不再作为当前购买目标。当天已在 Cloudflare 完成 `kakareel.com` 注册并核到 Active 状态；后续继续接入部署。

第一版采用苔绿、深森林绿与奶油色；鸟类特征是浅色圆脸、弯喙、圆润身体和短翅。Logo 用正面头像，吉祥物用挥翅全身像。

- `public/brand/kakapo-logo.png`：导航、工作台和浏览器图标。
- `public/brand/kakapo-mascot.png`：首页吉祥物。
- 两个文件均由内置 imagegen 生成、透明 PNG，保留原始尺寸；网页显示经 Next Image 优化。当前并非矢量文件。
- 图像不代表模型生成的视频样例，也不暗示与野生动物保护机构存在合作。
- 全站 UI 语义色阶、三级字体排印、空间圆角与组件状态规范见 [design-system.md](design-system.md)。

## 生成提示词

Mascot：

> Use case: logo-brand. Asset type: standalone website mascot for KakaReel, an independent AI video creation studio. Create one original charming kakapo (New Zealand owl parrot) full-body character, facing slightly right but looking warmly at viewer. Distinctive broad pale cream owl-like facial disk, small curved ivory parrot beak, moss green plump pear-shaped body, subtle darker green scalloped feather markings, short rounded wings and sturdy small feet. Friendly intelligent expression, sophisticated editorial flat illustration with gently rounded geometric shapes, restrained forest green / moss / cream palette suited to a cream and dark-green website. One wing raised slightly as a welcoming gesture. Full character centered, generous padding, clean silhouette readable at small size, crisp edges, flat vector-like graphic quality. Actual transparent background. No text, no wordmark, no props, no camera, no owl ear tufts, no flying pose, no watermark, no cast shadow or background scene.

Logo：

> Use case: logo-brand. Create one original compact icon for KakaReel, an AI video creation website whose mascot is the kakapo (owl parrot). Only a stylized kakapo head viewed straight on: round moss-green head, a broad cream facial disk, two friendly dark eyes, a small hooked ivory parrot beak. Distinctively parrot-like, no owl ear tufts. Sophisticated minimal geometric flat logo with a bold, clean silhouette, 3 colors forest green, moss green, cream. Centered square composition, generous clear margin, icon suitable for a browser favicon and navigation logo, crisp hard edges, no gradients, no 3D, no shadow, no text, no wordmark, no background scene. Actual transparent background.
