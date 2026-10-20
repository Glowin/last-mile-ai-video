---
title: "VibeToken 视频接口接入"
date: 2026-10-20
source: "VibeToken 官方文档与模型 schema"
status: "契约已核验；真实账户调用待验证"
---

# 接口与限制

核验入口：[文档首页](https://docs.vibetoken.cn/zh)、[完整索引](https://docs.vibetoken.cn/llms.txt)。2026-10-20 已读取视频生成、异步任务、幂等以及六个模型的文字文档，并对照公开模型 schema。

服务端向 `https://vibetoken.cn/v1/videos/generations` 提交，使用 Bearer 认证；API Key 只在服务端运行时加载。请求头 `Idempotency-Key` 使用客户端创建、服务器预先持久化的 UUID。状态查询使用任务 ID，或通过 `client_request_id` 查回提交结果。

| 系列 | 文生模型 | 图生模型 | 适配要点 |
|---|---|---|---|
| Seedance 2.5 | `bytedance/seedance-2-5-t2v` | `bytedance/seedance-2-5-i2v` | duration 为整数；ratio；generate_audio；图生不提供 480p |
| Kling 3.0 | `kuaishou/kling-v3-4k-t2v` | `kuaishou/kling-v3-4k-i2v` | duration 为整数；sound；文生 aspect_ratio；图生不额外发送比例／分辨率 |
| MiniMax H3 | `minimax/minimax-h3-t2v` | `minimax/minimax-h3-i2v` | duration 为字符串 6／10；2K；aspect_ratio |

MiniMax 文档示例的 `ratio` 与当前 schema 不一致，代码采用 schema 的 `aspect_ratio`。模型存在于 VibeToken 目录，只证明该网关提供相应接入声明，不能替代实际账户可用性和生成质量验证。

图片仅接受 JPEG／PNG data URI，最大 3 MB，检查 MIME、头部字节与体积；不让用户提供服务器抓取的任意 URL。通用视频 API 支持 inline data URI，真实模型接受情况仍须实测。

## 故障与费用边界

- 先写任务再调用上游；同一请求 ID 的不同内容返回冲突。
- 超时不等于生成失败：保留输入供同 ID 恢复；明确失败须用户新建请求。
- 接受上游任务后清除库中的图片请求 payload；文本提示、状态和结果链接保留在任务历史。
- 全站每日提交数按 UTC 统计，失败和未知任务同样占用额度。额度是请求数，不是美元消费上限；上游账户仍须配置预算。
- 前端每六秒查询，连续三次查询失败暂停并提示手动刷新。没有接入未验证的回调。
- 输出是上游 HTTPS 临时链接，提醒及时保存；本站未承诺永久存储。
- 不在响应和日志输出上游密钥、原始错误正文、数据库连接串。

公开文档、模型目录与账户实际价格可能不同。本轮没有发布零售价格，也没有真实付费调用。上线前必须在项目账户复核单价与余额。
