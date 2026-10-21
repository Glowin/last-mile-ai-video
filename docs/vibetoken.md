---
title: "VibeToken 视频接口接入"
date: 2026-10-21
source: "VibeToken 官方文档与模型 schema"
status: "Seedance 480p 已知失败已本地拦截；其余 Seedance 配置未通过真实验收"
---

# 接口与限制

核验入口：[文档首页](https://docs.vibetoken.cn/zh)、[完整索引](https://docs.vibetoken.cn/llms.txt)。2026-10-20 已读取视频生成、异步任务、幂等以及六个模型的文字文档，并对照公开模型 schema。

服务端向 `https://vibetoken.cn/v1/videos/generations` 提交，使用 Bearer 认证；API Key 只在服务端运行时加载。请求头 `Idempotency-Key` 使用客户端创建、服务器预先持久化的 UUID。状态查询使用任务 ID，或通过 `client_request_id` 查回提交结果。

| 系列 | 文生模型 | 图生模型 | 适配要点 |
|---|---|---|---|
| Seedance 2.5 | `bytedance/seedance-2-5-t2v` | `bytedance/seedance-2-5-i2v` | duration 为整数；ratio；generate_audio；文生／图生均仅保留 720p、1080p，默认 720p（未通过真实验收） |
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

公开文档、模型目录与账户实际价格可能不同。2026-10-20 的既有真实调用结果见 [上线记录](launch.md)：MiniMax 成片已验；Seedance 480p 失败且未扣费。2026-10-21 本次修复仅查阅公开文档并做静态／离线 mock 验证，未读取凭证或进行真实 API 调用，未改模型、价格或新增请求参数。

## 2026-10-21：Seedance 480p 保守限制

- 失败依据：2026-10-20 原生产验收记录（见 [上线记录](launch.md)），经主会话交接，模型 `bytedance/seedance-2-5-t2v`、4 秒、480p，错误 `Invalid parameter value: resolution`，charge 为 0。本次未访问账户日志重新核验，不把该记录外推为所有 Seedance 配置失败。
- 文档复核：[官方文生参数](https://docs.vibetoken.cn/zh/bytedance-seedance-2-5-api/text-to-video.md)仍声明 480p／720p／1080p、默认 720p；[官方图生参数](https://docs.vibetoken.cn/zh/bytedance-seedance-2-5-api/image-to-video.md)仅列 720p／1080p、默认 720p。公开声明与已确认的文生 480p 失败冲突，具体提供方原因未证实，不能靠文档宣布恢复。
- 本地修复：共享 `resolutions()` 去除文生 480p，工作台选项与服务端 `generationSchema` 同时限制为 720p／1080p；手工或旧页面提交 480p 会被输入校验拒绝，不自动升档。默认 720p 保持不变，保留分辨率只表示现有产品选项，不表示已实测可用。
- 恢复路径保护：旧任务的 JSON payload 会绕过新建任务的输入校验，故 `providerRequest()` 在读取 Key／发送请求前拒绝两个现有 Seedance 模型的 480p POST，抛出独立的 `ProviderSubmissionBlockedError`（不继承 `ProviderError`），不得将本地阻止当作上游明确拒绝。现有 `submit` 将恢复时临时认领为 submitting 的任务还原为 unknown，并保留原 payload 与请求 ID，不发 POST、不制造 failed 终态。只有后续远端证据才能确定旧任务结果；按原 ID 查询状态仍可进行。本次没有访问或修改历史任务数据库。
- 边界：不自动替换模型、分辨率、价格或重试；Kling、MiniMax、Seedance 其余参数映射保持原样。`tests/model-options.test.ts` 覆盖选项、服务端拒绝、旧 payload 发送前拦截、其他模型 payload、只查询状态和无自动重试；测试还读取并执行当前 `app.ts` 的完整 `submit` 函数正文（仅去掉参数类型、mock 数据库与网络），验证本地阻止保留 unknown／payload 且零 fetch，并用上游明确返回 400 会写 failed、503 保留 unknown 作对照，不冒充完整 recover 路由或真实数据库验收；这些离线检查不能证明上游成功，也不代表修复已部署。
- 待授权：原预算在失败后停止，0 扣费或剩余额度均不构成继续生成许可。Seedance 720p／1080p、Kling 与全部图生流程的真实模型验收仍需重新授权具体模型、参数与预算；此轮不执行。
