---
title: "Pancake Prompt Sift 接入前契约核验"
date: 2026-10-25
status: "仅研究；未接入、未调用真实接口"
source: "Waffo 官方接口与认证文档；本地 @waffo/pancake-ts 0.26.0 静态核验"
---

# 结论与范围

原生子代理完成接口／SDK 研究，主会话回读报告并重新核官方端点。当前不能把 Prompt Sift 当作完整视频审核方案；继续保留[人工输入与完整输出审核](../content-operations.md)。本轮没有新增依赖、创建凭证、调用渠道或发送用户提示词。

公开[扫描端点](https://docs.waffo.ai/zh/api-reference/endpoints/content-safety/scan-prompt)仅接收文本 `prompt`，另有 `locale` 和 `semantic`。返回 `allow`／`review`／`block`；`review` 和服务降级均不能放行生成。文档称内测免费，不代表正式价格或长期零成本承诺。公开 schema 没有图片或视频参数；不把图像 Base64 塞进文字字段假装完成多模态审核。

# 已核接口边界

- [认证](https://docs.waffo.ai/zh/api-reference/authentication)使用商户 RSA 签名；不是 Bearer token。签名须与实际发送的 JSON 字节一致。测试／生产由验签密钥所属环境决定，不能用 SDK 的环境选项将生产凭证自动变成测试凭证。
- 本地 SDK 0.26.0 有 `contentSafety.scanPrompt(params, { idempotencyKey })`，直接返回解包后的判定；构造器会读取／解析私钥。禁用模式须在实例化前返回本地 `not_run`，不伪造 `allow`。
- 静态检查发现 SDK 没有内建扫描超时／重试，也不保留供调用者使用的 HTTP 响应头；类型声明不能代替响应校验。未来 transport 须检查 HTTP 状态、完整枚举和结构，并有有界超时。异常保持待审，不默认允许。
- [通用幂等规则](https://docs.waffo.ai/zh/api-reference/introduction)对首次成功响应保留 24 小时。**推断：** 如果本接口的 200 review 遵循该规则，同键重试只会得到旧结果。已核端点、SDK 与相关文档未找到按 requestId 查询终态的明确契约；不据此断言渠道内部没有能力，也不编造查询接口。
- `semantic: off` 只是关闭语义层，仍然调用扫描接口；不能作为“不联网”的禁用开关。扫描允许也不能替代完整输入的人工批准，更不能替代输出审核。

# 启用前需要渠道确认

| 缺口 | 所需答复 |
|---|---|
| 待审终态 | review 是否产生人工工单；正式查询／回调、关联字段、终态及申诉流程 |
| 幂等与复核 | 200 review 是否缓存、人工结束是否更新缓存；复用键还是独立查询，何时允许新扫描 |
| 测试与费用 | test 是否真实审核、可用合成用例；免费期、正式计价、人工复核／重试费用与额度 |
| 用户数据 | 专项隐私／DPA、子处理商、处理地区、训练用途及原文／派生数据／人工记录保留与删除 |
| 覆盖与准入 | 图片、完整视频输出的正式审核方式；现有人工流程、动态词库及无作品广场场景的验收要求 |

端点的“不留提示词原文”声明不能推导为第三方不处理、所有日志零保留或不用于训练。以上问题尚未发送，本轮没有扩展既有群消息内容。

后续若准备 adapter，应先做默认关闭、零凭证读取、零网络调用的边界，再用合成结果验证待审／降级／异常不会提交生成。当前未实现 adapter，不增加没有调用方的空模块冒充接入进度。[AIGC 要求](https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance)涉及多个审核阶段；文本接口研究不等于商户审核通过。
