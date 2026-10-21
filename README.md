---
title: "KakaReel — 最后一海里计划"
date: 2026-10-20
---

# KakaReel · The Last Mile Project

An open-source AI video studio built in public, from the first idea to the first US$100 in revenue. For international creators, with text-to-video and image-to-video adapters for Seedance 2.5, Kling 3.0, and MiniMax H3 through VibeToken.

《最后一海里计划》的直播产品：从创意、制作、上线、获取首位付费用户到 US$100 收入。品牌 **KakaReel**，已注册域名 `kakareel.com`，Logo 和吉祥物为鸮鹦鹉。

## Current status

The MVP includes the English website, model pages, Google sign-in, account/session management, invite-preview studio, PostgreSQL task history, and idempotent submission/recovery. Pricing and payment-return pages plus an order/event/credit-ledger foundation are implemented; real payment providers and generation charging remain disabled.

**Deployed to Hostinger / Dokploy on 2026-10-20: [kakareel.com](https://kakareel.com).** Both containers are healthy, public DNS and the origin TLS certificate are verified, and sixteen origin route/asset checks passed. Normal local DNS access has recovered: the health endpoint returned 200 without an origin override, and the homepage rendered correctly in Chrome Glow. Google sign-in, reload, logout and returning sign-in were verified in Chrome Glow on 2026-10-21 after deploying `b5e0dcd`; both existing jobs and owners were preserved. Mobile acceptance remains pending. The first real MiniMax output was played and downloaded in Chrome (2560×1440, 6.584 seconds). The Seedance 480p text-to-video check failed upstream with an invalid-resolution error and no charge; no further paid checks were attempted. Kling and image-to-video flows are not yet verified. GitHub main pushes now trigger Dokploy, verified with commit `6949df4`. There is no paid checkout or revenue claim. Generation requires a preview code and is limited by a project-specific budget.

The complete build and 74 tests passed with zero failures or skips on 2026-10-21, including disposable PostgreSQL integration. Provider responses in automated tests are mocked; they do not prove live model availability.

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
- [Google login architecture and production acceptance](docs/google-auth.md)
- [Search Console and Bing setup status](docs/search-console.md)
- [VibeToken API contracts and limitations](docs/vibetoken.md)
- [KakaReel brand and mascot](docs/brand.md)
- [Competitor research: Higgsfield, Canva, Runway](docs/research/2026-10-19-ai-video-sites.md)
- [Google Trends keyword notes from the livestream](docs/research/2026-10-20-google-trends-keyword-notes.md)
- [Video pricing research and cost model](docs/research/2026-10-21-video-pricing.md)
- [Pancake and payment integration research](docs/research/2026-10-21-payment-integration.md)
- [Billing backend and activation requirements](docs/billing-backend.md)

## License

[MIT](LICENSE). Model inference is a separate paid service; this repository does not include model weights or free API usage. Model and provider names belong to their respective owners.
