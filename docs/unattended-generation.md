---
title: "Unattended MVP generation: policy, rollout and rollback"
date: 2026-10-28
source: "Owner's explicit 2026-10-28 decision; current implementation; official Prompt Sift contract"
status: "Reviewed and locally validated; production deployment pending"
---

# Scope and truthfulness

The owner selected `mvp-text-only-v1` for **new** jobs. Text must receive an explicit, valid Waffo Pancake Prompt Sift `allow`. Reference images and generated videos are **not reviewed**, and are permitted by this MVP operating policy. No human approval, reviewer, viewing attestation or content-safety certification is fabricated. Technical validation of ownership, provider identity, allowed download destination and the full file remains mandatory before delivery and settlement.

This is not confirmation that Waffo accepts the changed policy. Its [published AIGC requirements](https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance) call for input and output moderation; text-only screening does not meet that full coverage. Image moderation, output moderation and maintained broader safety controls remain work to do. Do not submit a statement claiming those capabilities or Waffo approval. Existing content reports, holds, appeals, age requirements and prohibited-use rules remain in force; support is still human-operated.

# Durable flow

1. Authentication, age, exact quote, cost budget, rate validity, ownership and idempotency checks remain. Creation atomically records the job, applicable holds and frozen policy. New MVP requests return accepted job state so the browser does not own execution.
2. The worker checks text using the existing server-side merchant authentication, `semantic=enforce`, and one stable task-specific idempotency key. Only validated `allow` proceeds. No image/Base64 is sent to Prompt Sift. The exact input binding prevents a changed payload from reusing an earlier decision.
3. `block` ends before model submission. `review` waits for automated confirmation; it is not a human queue. Errors, rate limits and deadlines never imply allow. Bounded attempts and a persisted deadline survive restarts. The SDK adapter performs one request per attempt; the worker owns retry scheduling.
4. The model submission permission remains one-shot and durable. Unknown submission outcomes query the original task; there is no second model POST. Explicit failure releases still-held user credits. A provider timeout is not proof of failure or zero cost.
5. A successful result must pass original identity/download/full-file checks. Delivery, the unreviewed-output policy record and one-time credit capture are committed together. Repeated polling/settlement cannot consume again. The video is not placed into the historical human output queue.

The [verified Prompt Sift contract](research/2026-10-28-prompt-sift-contract.md) has no documented review-result query endpoint. Its general idempotency rules cache 2xx responses for 24 hours. Retrying the same key can return the same review decision; no fresh key or invented query bypasses that decision. The application may end at its shorter configured deadline before an upstream review could change. A user can later explicitly create a new request.

## Financial boundaries

| Situation | User credits | Supplier cost |
|---|---|---|
| Text blocked, attempts exhausted, or safety deadline reached before model submission | Release any reservation once | Release confirmed-unsubmitted risk only |
| Model explicitly failed | Release any reservation once | Retain submitted exposure; actual charge needs independent supplier evidence |
| Model submission/result unknown | Preserve original recovery and compensation rules; no duplicate charge or POST | Retain exposure; actual cost stays unknown until evidenced |
| Verified successful delivery | Consume held credits once | Record success separately from actual billed amount |
| Late success after an existing credit release | Never recharge released credits | Supplier cost can still exist |

No change to public sales, payment credentials themselves, catalog prices, payment channels, subscription plans or public generation-charging approval is included. An enabled moderation policy does not enable a disabled/expired cost budget or a consumed paid pilot.

## Operational inspection

`node --import tsx scripts/generation-safety-status.ts [JOB_UUID]` runs read-only SQL using the existing host runtime database configuration. Without an ID it prints aggregate policy/status counts. With an exact ID it reports policy, bounded scan attempts/request IDs, provider task ID, delivery hash/time, credit transitions and separately recorded supplier cost. It never selects prompts, image payloads, user identifiers, signed output URLs or keys. It is a host-only tool, not an HTTP admin endpoint; keep task-level output private. Worker failures log a fixed code rather than raw driver/SDK errors that could contain SQL parameters.

# Configuration and rollback

| Variable | Default / boundary |
|---|---|
| `GENERATION_REVIEW_POLICY` | `manual-v1`; select `mvp-text-only-v1` for new tasks only |
| `GENERATION_MVP_AUTOMATION_ENABLED` | `false`; independent emergency switch |
| `GENERATION_REVIEW_MAX_WAIT_SECONDS` | 300; clamped 30–900; frozen per task |
| `GENERATION_REVIEW_MAX_ATTEMPTS` | 3 total; clamped 1–3; frozen per task |
| `GENERATION_REVIEW_TIMEOUT_MS` | 10000; clamped 1000–30000; frozen per task |

Prompt Sift reuses `PANCAKE_LIVE_MERCHANT_ID` and `PANCAKE_LIVE_PRIVATE_KEY`. On 2026-10-28 the owner explicitly authorized passing these existing credentials to the KakaReel generation worker solely for Prompt Sift. Compose gives that worker neither payment configuration nor a reconciliation command. The same merchant key still has its original upstream permissions; process separation is not a new scoped upstream credential. Real values remain in restricted external configuration/Dokploy; never print them.

**Stop new MVP adoption:** set `GENERATION_REVIEW_POLICY=manual-v1` and redeploy. Existing task policies stay frozen; legacy tasks keep real historical decisions. Do not label existing jobs approved, delete policy rows or rewrite their decisions.

**Emergency stop:** set `GENERATION_MVP_AUTOMATION_ENABLED=false` and redeploy. Confirmed-unsubmitted MVP jobs end and release reservations. Already-submitted work must retain its identity and recover without a replacement POST. For immediate spending control also use the existing cost-budget stop; it cannot recall an already-issued submission permission. Keep the current compatible code and additive tables for recovery. Do not roll back to code that predates these policies while MVP jobs are in flight, and do not restore an old database over new financial facts.

# Migration and deployment acceptance

Migration `0011-generation-automation.sql` is additive: policy and scan-attempt tables, indexes and immutability protection. It does not backfill or update `video_jobs`, historical moderation decisions, wallets, allocations, cost records or payment data. An absent policy row retains legacy behavior. No bulk approval/capture/release is part of the migration.

2026-10-28 preflight through the current production worker: zero nonterminal unsubmitted jobs; two old unknown preview jobs; three historical input approvals and one output approval. The global budget was disabled with revision 6 and its cumulative risk limit fully occupied. This is a dated preflight, not an assertion that the mutable state cannot change. Recheck before release. The completed owner pilot and its one-time consumption must remain unchanged.

Pre-migration backup on 2026-10-28: a new custom-format dump in this database's existing persistent volume is 5,553,711 bytes; `pg_restore --list` succeeded with 176 lines. Its path and contents remain private. This verifies archive readability, not a restored-database rehearsal.

Before migration: review the exact commit, run isolated PostgreSQL and adapter tests, build, recheck concurrent changes, back up this project's database and verify the dump list. Keep public sales/payment values unchanged. Deploy the reviewed main commit through existing Dokploy; verify migration checksums, live version and worker health. Only then enable the selected new-job policy, preserving all unrelated environment lines. Read back selected nonsecret settings and inspect old-job invariants.

Live paid generation requires a fresh cost/credit authorization. Do not reuse the earlier mascot request, paid-pilot slot or historic spending approval. Synthetic adapter/DB tests are not a real upstream acceptance. A harmless live Prompt Sift check alone is not proof of video delivery or credit settlement.

## Acceptance record

2026-10-28 pre-deployment acceptance:

- Independent code review found and resolved guest-to-account owner transfer invalidating content bindings, reported queued jobs missing automatic cancellation, a final pre-transport lease/content-case check, and a replay message claiming credits were released before they actually were.
- Main-session rerun: **28/28** automation/policy tests passed, no skips (26 real PostgreSQL cases plus 2 policy cases). Synthetic paid jobs demonstrate queued acceptance → text allow → one model submission → complete-file verification → automatic delivery and 23-credit capture, without any human decision. Tests reject any fabricated insertion into the human-review table.
- Coverage includes block, review, 429/Retry-After, bounded timeout/attempts, concurrent repeats, scanner lease loss and late-result fencing, reconnection/recovery, explicit model failure, unknown submission with no second POST, incomplete/unsafe output, final send authorization, emergency cancellation, content reports, owner transfer, and immutable legacy/manual policies. Restart evidence uses database reconnection/lease loss, not an actual SIGKILL of a deployed worker.
- Existing credit/cost/manual-moderation PostgreSQL suites: **52/52** passed, no skips. Full offline suite: **252 passed, 0 failed, 122 database-dependent cases skipped**; relevant database suites were run separately above. Counts overlap and are not a unique aggregate total.
- Full TypeScript check and production build passed. Real rendered Help page was visually inspected. Synthetic Compose configuration confirms manual/off defaults and scoped worker credentials; public payment/charging gates remain unchanged. The host-only status CLI was exercised against the disposable database.
- No production video request or charge was created during these checks. Live scanner and production deployment results remain to be recorded. An attempted pre-deployment SDK probe in the older web container stopped at module loading, before any request; the deployed worker is the intended acceptance entry point.

No task/account identifiers, signed file URLs, prompts, keys, production host identifiers or private operational paths belong in this document.
