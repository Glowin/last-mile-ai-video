---
title: "Public paid video specifications"
date: 2026-11-09
status: "Release implementation and isolated acceptance; production activation is verified separately"
---

# Released settings

The paid specification allowlist is shared by Studio, pricing and the server. Published retail rates are unchanged. A released setting still needs a current exact supplier rate and sufficient operational budget before a quote or reservation can succeed.

| Model | Mode | Resolution | Duration | Credits | Ratios | Audio request |
|---|---|---|---|---|---|---|
| Seedance 2.5 | Text | 720p | 5s / 10s | 33 / 65 | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 | false |
| Seedance 2.5 | Text | 1080p | 5s / 10s | 80 / 160 | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 | false |
| Kling 3.0 | Text | 4K | 5s / 10s | 72 / 143 | 16:9, 9:16, 1:1 | false |
| MiniMax H3 | Image | 2K | 6s | 23 | adaptive | false (model defaults) |

There are 30 newly released exact text specifications and the existing MiniMax image specification. MiniMax text, other durations, audio=true and other image settings remain unreleased. Unpriced and unsupported inputs are rejected; there is no fallback to another model or a more expensive setting. The 160-credit Seedance tier needs more than one Starter Pack's 150-credit balance.

Seedance maps to `bytedance/seedance-2-5-t2v` with integer duration, resolution, ratio, generate_audio=false and output_format=mp4. Kling maps to `kuaishou/kling-v3-4k-t2v` with integer duration, aspect_ratio and sound=false; 4K is encoded by the model and is not an extra provider request parameter. Existing MiniMax payloads are unchanged.

# Supplier price evidence and activation boundary

On 2026-11-09 the coordinating session read the current [Seedance detail page](https://vibetoken.cn/models/bytedance/seedance-2-5/text-to-video) and [Kling detail page](https://vibetoken.cn/models/kuaishou/kling-3-0/text-to-video), including current parameter prices without submitting a generation. The confirmed text prices in CNY are Seedance 720p 5s=6.426, 10s=12.852; 1080p 5s=15.904, 10s=31.809; Kling sound=false 5s=14.250, 10s=28.500. The detail pages specify linear duration pricing and supported aspect ratios; Seedance 1080p 10s at 21:9 was also checked with unchanged price. The generic Kling directory price must not replace this sound=false model's detail price.

Production confirmation uses the existing trusted cost API and each exact ratio key; conservative maxima round upward to fen: 643, 1286, 1591, 3181, 1425 and 2850 respectively. These are not client prices or automatic defaults. Production budget, rate writes, running release version and current quotes need separate readback. This implementation neither expands the authorized operating allowance nor changes payment configuration, wallet settlement, cost protection or moderation policy.

The owner authorized this public model release after learning that Waffo still requires output review. The existing MVP checks prompts but does not review input images or output videos. This release does not resolve that gap or assert payment-provider approval. See [the current generation policy](unattended-generation.md).

# Isolated acceptance

Use a fresh disposable PostgreSQL instance at 127.0.0.1:55452 with database `kakareel_acceptance_55452_sandbox` and role `kakareel_acceptance_55452_test`, and set `PUBLIC_PAID_TEST_DATABASE_URL` only in the test process. The suite rejects another address, an existing schema, inherited production configuration and all external fetches. It runs every repository migration, uses synthetic purchases and supplier rates, and removes its schema afterward. No real upstream generation or payment occurs.

`tests/public-paid-generation.integration.test.ts` exercises all six text tiers, every allowed ratio, successful delivery charging exactly once, confirmed failure returning the held customer credits, and retained supplier exposure. It retains original MiniMax paid success/failure and consumed-pilot regressions. Disabled/scoped/exhausted budget and missing/expired/blocked supplier rates fail closed for all 31 specifications before reservation; unsupported settings make no model calls. Static specification and pricing-render tests cover the full input matrix and exactly seven available rate rows, leaving the two MiniMax text rows unavailable.

2026-11-09 local result: TypeScript and production build passed; the default suite passed 262 tests (159 unrelated database cases explicitly skipped without their dedicated URLs), and the dedicated PostgreSQL suite passed all 22 tests with zero skips. Its disposable container and temporary in-memory database were removed after verification.

These are real PostgreSQL application-path tests with a synthetic provider, not proof of new supplier calls, production deployment or output moderation.
