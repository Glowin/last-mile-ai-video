---
title: "KakaReel — 最后一海里计划"
date: 2026-10-20
---

# KakaReel · The Last Mile Project

An open-source AI video studio built in public, from the first idea to the first US$100 in revenue. For international creators, with text-to-video and image-to-video adapters for Seedance 2.5, Kling 3.0, and MiniMax H3 through VibeToken.

《最后一海里计划》的直播产品：从创意、制作、上线、获取首位付费用户到 US$100 收入。品牌 **KakaReel**，目标域名 `kakareel.com`，Logo 和吉祥物为鸮鹦鹉。

## Current status

The local MVP includes the English website, model pages, invite-preview studio, PostgreSQL task history, idempotent submission and recovery, and a Docker Compose deployment template.

**Production launch, domain registration and real provider generations are not yet verified.** There is no paid checkout or revenue claim. Generation stays disabled until project-specific runtime configuration is supplied.

Type checking, seven tests (including disposable PostgreSQL integration), Docker build, and sixteen production-container route/asset checks passed on 2026-10-20. Provider responses in automated tests are mocked; they do not prove live model availability.

## Develop

Node.js 22, pnpm 10.27.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Without credentials, `pnpm dev` lets you browse the website and studio. See [deployment instructions](docs/deployment.md) for external runtime configuration, database setup and full integration tests.

Real configuration stays **outside the checkout, even ignored files**. Only empty variable templates belong in Git. Production values go into Dokploy environment settings. See [AGENTS.md](AGENTS.md).

## Project notes

- [MVP scope and launch acceptance](docs/launch.md)
- [Hostinger / Dokploy deployment](docs/deployment.md)
- [VibeToken API contracts and limitations](docs/vibetoken.md)
- [KakaReel brand and mascot](docs/brand.md)
- [Competitor research: Higgsfield, Canva, Runway](docs/research/2026-10-19-ai-video-sites.md)
- [Google Trends keyword notes from the livestream](docs/research/2026-10-20-google-trends-keyword-notes.md)

## License

[MIT](LICENSE). Model inference is a separate paid service; this repository does not include model weights or free API usage. Model and provider names belong to their respective owners.
