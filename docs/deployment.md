---
title: "本地开发与 Hostinger Dokploy 部署"
date: 2026-10-20
source: "项目实现；Dokploy Docker Compose 文档"
status: "生产服务已部署；当前验收状态见 launch.md"
---

# 运行结构

Next.js＋TypeScript，Hono API 位于 Next.js Node 路由，PostgreSQL＋Drizzle 存任务。共享 VPS 上先用一个应用构建，独立数据库，避免多个前后端构建同时争用资源。上游提供持久化异步任务，MVP 未引入 Redis 队列。

## 配置边界

真实配置一律在 checkout 外；本机目录权限 0700，配置文件 0600；生产值只进入 Dokploy 环境设置。不得复制或软链接配置回仓库，不使用其他应用的密钥。`.env.example` 仅列空变量。

| 变量 | 用途 |
|---|---|
| DATABASE_URL | 项目专用 PostgreSQL 连接串 |
| VIBETOKEN_API_KEY | 项目专用上游密钥；缺少时仅浏览工作台 |
| GOOGLE_CLIENT_ID | Google Web 客户端公开标识，运行时提供；缺少时禁用 Google 登录 |
| SESSION_SECRET | 至少 32 字符的随机签名密钥 |
| DEMO_ACCESS_CODE | 至少 12 字符的预览口令 |
| APP_URL | 对外 HTTPS origin，不带子路径 |
| GENERATION_DAILY_LIMIT | 全站 UTC 日提交上限，默认 10 |
| POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD | Compose 独立数据库配置 |

配置不作为构建参数，不写入镜像；密钥不进入浏览器。Google Client ID 是登录所需的公开标识，仅经运行时 `/api/config` 返回。可以先部署浏览版本、暂不配置 VibeToken Key 和邀请口令，页面会明确提示暂不能生成。

## 本地

使用 Node.js 22 和 pnpm 10.27.0，先 `pnpm install --frozen-lockfile`。外部配置文件路径由操作者提供，以下占位路径不应直接执行：

```sh
node --env-file=/absolute/external/runtime.env --import tsx scripts/migrate.ts
node --env-file=/absolute/external/runtime.env node_modules/next/dist/bin/next dev --hostname 127.0.0.1
```

迁移按编号应用 `db/*.sql` 并记录校验和；旧库保留任务，补建迁移记录。开发不依赖真实上游密钥才能打开页面；Google 登录详见 [架构说明](google-auth.md)。本分支新增登录尚未合并生产，当前线上状态仍以 [上线记录](launch.md) 为准。

## Dokploy

参照 [Dokploy Compose 文档](https://docs.dokploy.com/docs/core/docker-compose)：

1. 在已有 Hostinger Dokploy 创建本项目独立 Compose 服务，源仓库为 `Glowin/last-mile-ai-video`、分支 `main`，使用根目录 `compose.yaml`。
2. 在平台内设置上述运行环境；数据库 URL 的主机为该 Compose 内的 `db`，用户、密码、库名与数据库服务对应。由平台保存，不导出到 Git。
3. 数据库使用 PostgreSQL 16 镜像；应用启动时先运行版本化迁移，成功后才启动 Web，失败则退出。SQL 与迁移脚本随 Web 镜像打包，新旧数据库卷都通过同一迁移入口升级。升级前备份，保留旧任务，不删卷强制重建；首次部署后的历史初始化方式已被此入口替代。
4. 将已注册域名绑定 `web` 服务端口 3000，配置 DNS 与 TLS。不要公开 PostgreSQL 端口，不修改其他项目的服务或卷。
5. 一次部署一个构建；确认 VPS 资源可用。只有平台实际配置并验收 webhook 后，才称为 push 自动上线。
6. 核对实际运行版本、HTTPS 首页、`/build`、三个模型页、`/create`、`/api/health`、sitemap 与 canonical。健康接口只证明应用存活，不证明上游可用。
7. 配好专用上游 Key 后做有限真实生成验收，再开放邀请。

## 本轮已解决的打包问题

2026-10-20 实测，通用 `build/` 忽略规则会误排除应用路由 `src/app/build/page.tsx`：本地开发能打开，不代表 Docker 镜像或 Git 提交包含该页。现已在 `.gitignore` 与 `.dockerignore` 同时加例外，并在生产容器验证 `/build` 返回 200。以后调整忽略规则须同时核这两处和镜像内实际路由。

Docker 生产阶段必须复制 `public/`，否则代码引用的鸮鹦鹉素材不会随 standalone 输出自动带入。本轮已显式复制，并验证两个 PNG 的生产容器响应。

## 检查

`pnpm typecheck`、`pnpm test`、`pnpm build`、`docker build -t kakareel:local .`。

普通 `pnpm test` 不配置数据库时跳过数据库集成用例。完整集成测试须使用独立、可清空的本机 PostgreSQL，主机固定 `127.0.0.1`、库名固定 `video_qa`，外部测试配置提供随机签名密钥与邀请口令、测试假 API Key 和本机 APP_URL：

```sh
node --env-file=/absolute/external/test.env --import tsx scripts/migrate.ts
node --env-file=/absolute/external/test.env --import tsx --test tests/*.test.ts
```

集成用例会清空该测试库内任务表，使用 mock 上游，不产生真实生成费用。覆盖会话隔离、重复提交、超时恢复、参数映射、每日上限和来源校验。测试通过仍不能代替真实视频与生产部署验收。
