---
title: "Google Trends 关键词经验：直播中李正分享随手记"
date: 2026-10-20
source: "江昪会话转述：2026-10-20 下午江昪直播中李正分享；官方说明由主会话核验并提供"
status: "追加型笔记；经验及具体结果待验证"
---

记录背景：公开 GitHub 项目 `Glowin/last-mile-ai-video`，面向海外 AI 视频需求；直播主题为从 0 到 100 美元。本篇补充[既有报告](2026-10-19-ai-video-sites.md)。

**来源边界**：以下七条均来自江昪在会话中对 2026-10-20 下午江昪直播中李正分享的转述与个人观察，并非李正逐字稿。保留想到哪说到哪的记录顺序；官方补注由主会话提供，访问日期均为 2026-10-20。经验、观察与已核定义分别标明，不作为产品定案。

## 1. 不要拍脑袋，变换词序组合对比

- **来源分类：直播经验转述＋江昪观察。** 江昪最初搜索 `Video AI`，李正提醒换成 `AI Video` 对比；江昪观察到 `AI Video` 的量级更大。此处保留观察原意，本轮未复测具体结果，不能据此认定绝对搜索量更大。
- 原链接保留：<https://trends.google.com/explore?q=%2522video%2520ai%2522%2C%2522ai%2520video%2522&date=now%207-d&geo=Worldwide>。
- **官方补注：** 不加引号时，词组合可以任意顺序出现；比较词序时，应以 **Search term** 形式在同一张图中比较 `"video ai"` 与 `"ai video"`，不要混用 Topic。[Google 搜索词说明](https://support.google.com/trends/answer/4359582?hl=en)
- Trends 展示抽样后的相对热度，范围为 0–100，并非绝对搜索量；0 也不一定代表无人搜索。[Google Trends 数据说明](https://support.google.com/trends/answer/4365533?hl=en)
- 原 URL 存在双重编码，且 `now 7-d` 为滚动窗口。复测时从界面选择全球、固定日期范围，并确认词语和引号；不静默改写原链接。主会话本轮抓取该结果页失败，未取得数值。

## 2. 多词英文加双引号，为什么结果会不同

- **来源分类：江昪转述与疑问。** 江昪记得多词英文加双引号会更精准，但忘记原因；`seedance 2.5` 加引号后结果不同，具体差异尚未复测。
- **官方补注：** 英文双引号保留完整短语及词序，但仍会包含在短语前后加入其他词的搜索；并非只匹配整条查询完全相同的情况。不加引号时，组合中的词可以任意顺序出现。[Google 搜索词说明](https://support.google.com/trends/answer/4359582?hl=en)
- 上述定义补足规则解释，尚不能确定 `seedance 2.5` 当时差异的具体成因。

## 3. 用什么词作稳定基准

- **来源分类：李正建议转述＋江昪个人判断。** 李正建议用 `GPTS` 作稳定基准，原理由是“GPTS 流量稳定、波动不大”（⚠️ 待核）；江昪觉得 `ChatGPT` 更适合。
- 两个选择均待验证，尚未确认哪个更稳定，也未确定基准比较的时间范围与条件。

## 4. 用 Ahrefs 看关键词难度，区分 KD 与流量

- **来源分类：李正建议转述。** 李正建议用 Ahrefs keyword-difficulty 评估 `video generator ai`。
- 原链接：<https://ahrefs.com/zh/keyword-difficulty/?country=us&input=video%20generator%20ai>。
- **官方补注：** KD 是进入前 10 个自然搜索结果的排名难度，范围为 0–100，依据引用域评估；不是流量指标。[Ahrefs KD 说明](https://help.ahrefs.com/en/articles/72265-what-does-kd-stand-for-in-keywords-explorer)
- Volume 指指定国家的月均搜索次数，采用 12 个月均值；也不能直接当作某个站点实际获得的流量。[Ahrefs Volume 定义与更新说明](https://help.ahrefs.com/en/articles/1077603-how-often-is-the-data-in-keywords-explorer-and-site-explorer-updated)
- 主会话本轮抓取具体结果页失败，未取得 KD 或 Volume 数值，不填写推测分值。

## 5. higgsfield 各方面很好

- **来源分类：江昪会话转述中的主观总体评价。** 保留原意：“higgsfield 各方面很好。”
- 目前未分解评价维度，也没有逐项证据，后续再拆解具体值得参考的部分。

## 6. 可灵的排名与落地页

- **来源分类：江昪转述的观察与解释，未复测。** 可灵经常出现在第一页；原解释是“不仅因为是官方站点，还因为大量 landing page 承接长尾”（⚠️ 排名、页面规模与归因待核）。
- 用户提供页面：<https://kling.ai/feature/ai-video-generator>。
- **主会话页面核验补注：** 页面可读，页尾 Features 有 AI Video Generator、Image to Video、Motion Control、Video3.0 等入口。这只支持存在多个落地页入口，不能证明页面数量“大量”、获得了长尾流量，或这些页面导致了排名表现。
- “经常第一页”的关键词、国家、时间与搜索条件尚未记录，排名及因果均未复测。

## 7. 聚合站／All in One 的方向

- **来源分类：江昪会话转述中的方向想法。** 做聚合站／All in One，接入 `seedance`、`kling`、`MiniMax H3`。
- `MiniMax H3` 按原称保留，**⚠️ 型号待核**，不擅自改名。
- 这是一条待探索想法，不代表已确认接入能力、商业条件或产品定案。

## 短待验证清单

- 固定全球与日期范围，以 Search term 同图复测两个带引号短语；记录设置与结果，同时复查 `seedance 2.5` 加引号前后的差异。
- 在相同条件下比较 `GPTS` 与 `ChatGPT` 的基准稳定性。
- 获取 `video generator ai` 在美国的实际 KD 与 Volume，分别记录，避免混为流量。
- 分解 higgsfield 的具体优点；明确可灵排名观察条件，并核实落地页规模、长尾流量及因果依据。
- 核实 `MiniMax H3` 型号原称与聚合接入条件，再讨论产品取舍。
