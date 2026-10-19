# Last Mile AI Video · 最后一海里计划

## English

An open-source project built through a public livestream demonstration: start with an idea, research user needs, build and launch a website, find the first paying customer, and work toward **US$100 in revenue**.

The product direction is AI video generation for international users. **Current stage: research and planning.** The specific use case, features, technology stack, and pricing are still being explored. This repository does not yet contain an application; no launch, paying customer, or revenue milestone is claimed.

The website's source code will be developed openly in this repository. Research and implementation updates will be added as they are ready.

## 中文

这是《最后一海里计划》的公开直播示范项目：从零梳理创意、调研用户需求、做站并上线，获取首个付费用户，最终以 **100 美元收入**为目标。

产品方向是为海外用户提供 AI 视频生成服务。**当前处于研究筹备阶段。** 具体使用场景、功能、技术栈和定价仍在探索。本仓库尚无应用代码，尚未宣称网站上线、获得付费用户或取得收入。

站点源码将在本仓库公开开发，调研与实现进展会在准备好后补充。

## Research / 研究

[2026-10-19 AI video site research and launch suggestions / AI 视频站竞品研究与上线建议（中文）](docs/research/2026-10-19-ai-video-sites.md)

These are research observations and proposals, not implemented features or confirmed product decisions.

报告记录公开页面观察与方案建议，尚未实施，也不代表产品决策已定案。

## Development and deployment / 开发与部署

This repository is the product's source of truth throughout the livestream series. Completed code changes will be pushed here. The deployment target is **Dokploy on Hostinger**; application code and deployment integration are not set up yet.

本仓库作为本次系列直播产品的源码仓库，完成的代码变更会及时推送。部署目标为 **Hostinger 上的 Dokploy**；应用代码与部署接入尚未完成。

Real configuration stays outside the checkout and is injected at runtime. Production values are managed separately in the deployment platform. Only empty configuration templates belong in Git. See [AGENTS.md](AGENTS.md) for the contribution and configuration rules.

真实配置保存在仓库外并在运行时加载，生产配置由部署平台单独管理。Git 仅保留空值配置模板；密钥、连接串、服务器地址与部署配置原件均不入库。协作与配置规则见 [AGENTS.md](AGENTS.md)。

## License / 许可

[MIT](LICENSE)
