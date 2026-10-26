---
title: "Content review and support operations"
date: 2026-10-25
scope: "KakaReel manual review, private support workflow and generation integration"
---

# Content review and support operations

Updated 2026-10-25. Owner: KakaReel founder (Glow Jiang). The founder handles the review queue and `support@kakareel.com`, checking them before operating generation and before ending each operating session. No guaranteed response or review deadline is advertised. The module is integrated with the app and runner and has passed isolated PostgreSQL acceptance; this branch's review flow and policy/footer changes have not yet been deployed, and the live operator workflow remains unverified. See [launch readiness](launch-readiness.md) for current evidence.

## Boundaries and policy

Inputs (full prompt, model settings, and every uploaded image) require human approval before the first upstream POST. Generated videos require a separate human review of the actual full video before KakaReel publishes its URL or consumes reserved credits. Review is not a keyword classifier or a claim that an AI has checked content. Do not approve files you have not viewed.

Apply every category in `/acceptable-use` to both inputs and the full output. Reject:

- Pornography, sexually explicit or NSFW content, including adult sexual content and non-consensual intimate imagery.
- Violence or gore, including graphic injury, mutilation or cruelty.
- Hate speech, including attacks based on protected characteristics and incitement to hatred or genocide.
- Child sexual abuse material (CSAM), child sexual exploitation or any sexual content involving anyone under 18, including synthetic depictions.
- Real-person deepfakes or impersonation: face swaps, nudification, fabricated kissing, hugging or other intimate interactions, and fabricated speech or actions attributed to a real person. Consent never exempts these uses.
- Copyright or trademark infringement, including unauthorized use of protected works, characters, logos or brands.
- Promotion or assistance of terrorism, violent extremism or mass harm; instructions to make or use dangerous weapons, including weapons of mass destruction; other illegal content, fraud, privacy violations, targeted harassment, instructions to harm people, or threats involving prohibited intimate imagery.

Ordinary lawful material depicting people is not categorically prohibited. Verify that identifiable-person uploads depict the uploader or have the depicted person's explicit permission, and check third-party material rights. Rights or consent do not permit a prohibited deepfake. Where context or rights cannot be established, keep the item pending and ask the user through support. Do not download, forward or preserve illegal imagery as an ordinary support attachment. Use provider reporting and applicable reporting channels when necessary; do not claim those reports have happened without evidence.

`/acceptable-use` and `/support` are the public policy/help pages, linked from the footer alongside a visible `mailto:support@kakareel.com` contact. Terms, Privacy and the generation form disclose that the founder may inspect prompts, images and outputs. There is no automatic storage deletion today. Do not promise a retention period. Deletion requests need ownership verification and explicit handling of account/job rows, review snapshots, locally exported evidence and provider copies; financial/security retention may be separate.

### Remaining launch checks (2026-10-25)

2026-10-26 update: Pancake initial review now requires changes to the live disclaimers, AUP, enforcement timing, reporting and moderation disclosures, and recommends its Prompt Screening API. These branch changes have not been deployed or accepted by the reviewer. See [the latest review feedback](launch-readiness.md) for the source and remaining gaps.

Prompt Sift's public text-only contract and installed SDK were researched on 2026-10-25; see [findings and unresolved channel questions](research/2026-10-25-prompt-sift-contract.md). No scanner adapter, credential or live request was added. Its pending-review resolution and data-processing terms remain unconfirmed; do not substitute it for manual input/full-output review.

Policy sources checked: [Pancake AIGC compliance](https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance) and [AUP guidance](https://docs.waffo.ai/zh/mor/account-reviews/aup). These edits align the written rules; they do not establish deployment or approval by Pancake. The main session owns the following checks before opening sales:

- The reviewed moderation service, runner and operator CLI implement manual input/output decisions and audit records. No automated content scanner or actively maintained prompt blocklist was found in the reviewed source. Pancake also calls for a maintained blocklist and, if user works are publicly displayed, post-publication scanning. Resolve those gaps and the applicability of public-display scanning before claiming full compliance.
- The rollout migration exempts older jobs from the new review gates. Do not label those outputs reviewed; verify the production rollout boundary and how legacy results will be handled. The current manual process also depends on the operator actually inspecting every image and the whole video; a hash and viewing attestation alone cannot prove that inspection happened.
- Verify real mailbox receipt, founder coverage and the deployed report/appeal workflow. The CLI records cases but does not read or send email. Reconsideration currently goes back to the founder; there is no verified independent appeals reviewer.
- Supported actions are task holds, hidden result links, review rejection and release of still-reserved credits. Do not advertise automatic account bans, balance forfeiture, provider-file deletion, continuous staffing or response deadlines. Live execution of these actions remains unverified. For repeated violations, the founder must examine prior cases before approving further requests and record each decision; this is manual refusal of generation, not an implemented automatic account suspension flag. Account-level suspension/termination tooling is still absent and must not be presented as deployed.
- `POLICY_VERSION` in `src/server/moderation/service.ts` remains `2026-10-25.1`; this three-file policy edit does not invalidate existing approvals. Before rollout, determine whether any reviews used the earlier wording and, if so, plan a version change and re-review without stranding existing input/output approvals. Typecheck, build and browser acceptance remain with the main session.

## Data and state

Migration `0008-generation-moderation.sql` adds `generation_moderation`, `moderation_cases` and append-only `moderation_case_events`. No unprotected admin HTTP route exists. Review decisions record job UUID, phase, monotonically increasing version, policy version, immutable input/output digest, actor, reason and decision timestamp. Historical versions remain available. The input snapshot includes the entire upstream payload (including uploaded-image data where present); protect it like other user content. Do not put exports in logs, the public repo or support email.

- `pending`: hold submission/output; reservation remains reserved.
- Input `approved`: resume the worker only for that exact payload and current policy version.
- Output `approved`: set successful delivery and consume once in the same wallet/job transaction. Already released credits stay released, including a later appeal approval.
- `rejected` / `expired`: remove our output link, preserve upstream identity, set `unknown` + `reviewRequired`, release any still-reserved user credits once. This is a moderation result, **not** an upstream generation failure.
- Pending review expires after 24 hours in database time. Expiry is an explicit audited operator action, not a background job in this module. Until acted on it stays held. An expired review cannot be approved. Queue output shows deadlines. There is no claim of automatic handling.
- A policy rejection before submission releases unsubmitted supplier-cost exposure in the integrated transaction. Rejection after submission must not erase provider cost; KakaReel bears that cost unless the provider separately confirms a refund.

The output hash includes the exact provider task, URL, full-video SHA-256, input approval version and policy. A content SHA-256 must come from all delivered video bytes, not from a URL, Range request or header. The operator downloads/views the candidate privately; CLI verifies that file's hash before approval. External provider URLs can expire or change: this does not create immutable hosting or prevent a provider from changing bytes later. A controlled delivery proxy/object store would be needed for that stronger guarantee.

## Host-only CLI

Run `node --import tsx scripts/moderation-review.ts /ABS/PRIVATE/operator.json COMMAND ...` from the checkout. The operator config is created by an authorized administrator **outside the repository**, parent directory 0700, file 0600, owned by the invoking OS user. It contains only `databaseUrl` and `operator` (a stable founder/operator identity). Never print or check in actual values. This script ignores ambient `DATABASE_URL` and selects only that explicit private configuration. Host access and database credentials are its authentication boundary; do not expose the CLI through a website form or give it to customers.

Commands:

```text
queue
export JOB_UUID input|output /ABS/PRIVATE/review.json
decide /ABS/PRIVATE/review.json approved|rejected|expired "specific reason"
decide /ABS/PRIVATE/review.json approved "specific reason" /ABS/PRIVATE/video.mp4 I_VIEWED_THIS_VIDEO
cases
case-open MAIL_REFERENCE content|rights|privacy|billing|account|other "specific summary" [JOB_UUID]
case-resolve CASE_UUID "evidence, action and reply outcome"
reopen-output JOB_UUID "reason to re-review exact existing output"
```

Exports are exclusive-create 0600 private files; choose a fresh filename. `queue` and `cases` show IDs/status only, never payloads or output URLs. `export` is the deliberate private-content inspection path. For input review, inspect the payload and every image; for output review, download from the exported candidate URL using the trusted operator workstation, view the entire file and use the video approval command. The CLI does not fetch arbitrary URLs. Reject unsafe or changed content; a hash mismatch cannot be overridden. Same decision/operator/reason repeats are idempotent; conflicting decisions or stale versions fail.

## Reports, appeals and unknown outcomes

1. Read support email manually. Use an opaque mail/message reference as `MAIL_REFERENCE`, not raw email bodies, signed result URLs or private attachments. Record a concise reason through `case-open`; map to the actual job after ownership/identity checks. If a reporter has no task ID, start an unlinked case and investigate through private account records; never guess a target job. A case requiring a newly identified job should get a new linked source reference, and the original case should record that handoff in its resolution.
2. Content/rights/privacy cases linked to a job immediately hide its KakaReel result and hold worker processing. Existing downloads and external provider files cannot be retracted by this action. No retroactive financial refund is invented; investigate payment eligibility separately.
3. `cases` shows unresolved work. Record actual investigation and response via `case-resolve`. This does not unhide a video or resume a generation. For an existing reviewed output, run `reopen-output`, export its new version, inspect again and decide normally. Do not reuse an old approval. For rejected/expired inputs, ask the user for a new compliant task; do not restart a released job at the platform's expense.
4. For a provider outcome still unknown (separate from a moderation hold), query the **existing** task via the existing credit-worker `review` / `poll JOB_UUID` commands. Do not POST a replacement or claim failure from timeout. Only the existing audited compensation path may release an eligible unresolved reservation; it does not mark provider success/failure. Integrated polling respects content holds, even with force=true.
5. For a payment/refund case use the billing reconciliation CLI on the original order; never re-create the payment/refund as a troubleshooting step. Reply only with verified state. Outbound support messages require normal owner authorization; the case queue itself does not send email.

## Exact integration contract (main session)

Exports from `src/server/moderation/service.ts`:

- `ensureInputReview(tx, job): Promise<Review>`: caller holds job `FOR UPDATE`, before setting `submissionStartedAt` or sending first POST. Only `state === 'approved'` permits submission. Pending/rejected/expired must return without provider calls. Payload changes invalidate approval and create a new version. Do not call it after payload disposal or upstream submission.
- `stageOutputReview(tx, job, {providerTaskId, url, contentSha256}): Promise<Review>`: caller has verified full video bytes, paid wallet lock, current job lock and valid worker lease. Require matching upstream identity, record provider-cost outcome independently, then call this **instead of** `finishClaim` success/capture. It stores the private candidate and puts the job on hold. Do not later overwrite its hold in `finishClaim`.
- `decideReview({jobId, phase, version, inputHash, outputHash, decision, actor, reason, viewedContentSha256?})`: host-only transaction for the CLI. Integration locks **cost budget → wallet → job**, releasing held supplier exposure only for a confirmed not-submitted input rejection/expiry. Submitted supplier exposure remains recorded independently of the user's returned credits.
- `hasOpenContentCase(tx, jobId): Promise<boolean>`: reject claims and approval while an active content/rights/privacy case exists. Do not let forced polling bypass holds.
- `publicModeration(jobId)`: phase/state/version only, included in owned job responses. Pending/rejected/expired or reported output URLs are hidden. Migration `0009-moderation-rollout.sql` records a durable rollout time: older jobs keep the previous delivery flow and history without being labeled reviewed. New live jobs require both reviews. Content reports hold jobs of every age; forced polling cannot bypass moderation holds. Unstarted old jobs still need a previously reserved cost snapshot, so the rollout boundary grants no new supplier-spending permission.
- `reopenOutputReview(jobId, actor, reason)`: explicit new output-review version after report resolution; never new provider work.

`src/server/moderation/cases.ts` exports `openCase(...)` and `resolveCase(...)`; CLI uses these directly. App/runner integration, public review states, footer/help links and Terms/Privacy disclosures are included in the current branch. They have not yet been deployed.

## Validation

`MODERATION_TEST_DATABASE_URL` enables `tests/moderation.integration.test.ts`; strict preflight requires only 127.0.0.1:55444 and the dedicated `kakareel_moderation_55444_test` role / `kakareel_moderation_55444_sandbox` database. It then verifies live database identity before resetting its dedicated schema. Tests use synthetic prompts, URLs and money; external fetch is disabled. Coverage includes changed inputs and stale versions, operator/output-byte-hash checks, concurrent idempotent capture, rejection/expiry release, content report holds, appeal re-review and no late recharge. These are module tests; full runner integration, rendered-page inspection and live operational review are separate acceptance steps.

2026-10-25 module acceptance: 14 passed, 0 failed, 0 skipped on the dedicated PostgreSQL instance; whole-worktree TypeScript check passed. Log: `/private/tmp/kakareel-moderation-55444-test.log`; type-check log: `/private/tmp/kakareel-moderation-types.log`. The task-owned container and anonymous volume were removed after testing. No production database, real credential, paid API or browser was used.

## Complete-video hash API (2026-10-25)

`src/server/jobs/delivery.ts` now exports:

```ts
verifyVideoContent(
  value: string,
  io?: DeliveryIO,
  limits?: { maxBytes?: number; timeoutMs?: number },
): Promise<{
  contentSha256: string;
  bytes: number;
  mime: 'video/mp4' | 'video/quicktime' | 'video/webm';
} | null>
```

Use the returned `contentSha256` for `stageOutputReview` only when the result is non-null, with the same provider task and URL. Existing `verifyVideoDelivery` remains unchanged for compatibility; its prefix check is **not** a substitute for this API. This new API does not approve content, mutate jobs or consume credits. A null result is a missing complete delivery proof, not evidence of upstream generation failure; retain the existing task for later inspection rather than generating another.

Hard ceilings are `VIDEO_CONTENT_MAX_BYTES = 128 * 1024 * 1024` (128 MiB) and `VIDEO_CONTENT_TIMEOUT_MS = 30_000` (30 seconds, including DNS). Optional limits may only lower these ceilings. DNS itself has a 3-second ceiling. The function requires HTTPS on the standard port, forbids userinfo/fragments, rejects private/reserved/mapped addresses and any mixed public/private DNS answer, pins the selected validated address to a fresh TLS connection, and retains certificate verification. IP literals are checked directly because Node does not invoke DNS lookup for them. It sends an unauthenticated GET with identity encoding, no Range header, no redirect following and no pooled connection reuse.

Only status 200, accepted video MIME, a matching video signature, a normal response `end`, and Node's `response.complete` proof can produce a hash. Content-Range, 206, redirects, compression, conflicting/duplicate framing, interruption, early close and over-limit bodies fail closed. A provided Content-Length must be a valid bounded integer and match the number of streamed bytes exactly; missing length is allowed only when HTTP framing completes normally. Chunked responses must include their complete framing as verified by Node. The hash consumes chunks incrementally; only the first 32 bytes are retained for signature validation, with no whole-video cache or file writes. Both timers and data/end deadline checks enforce the absolute time limit.

Limitations: HTTP completeness and the MP4/QuickTime/WebM signature do not prove the entire file decodes, has the requested duration or complies with policy. An upstream that deliberately sends an incomplete media container inside a normally framed HTTP response cannot be identified by a header-only media check. Human review still needs to download and view the exact bytes matching the hash. The function does not guarantee the external URL remains immutable after verification. Provider URLs requiring authentication, redirects or content encoding are intentionally unsupported. All network behavior tests use injected transports; no real provider or external network was called.

Acceptance: `tests/delivery-content.test.ts` plus existing `tests/video-delivery.test.ts`: 18 passed, 0 failed, 0 skipped; whole-worktree TypeScript check passed at handoff. Logs: `/private/tmp/kakareel-delivery-content-test.log` and `/private/tmp/kakareel-delivery-content-types.log`. Runner/app wiring and its isolated integration acceptance are now complete; see [launch readiness](launch-readiness.md).

## Actual worker-image operator rehearsal (2026-10-25)

At `efdea26`, the actual CLI ran as UID/GID 1000 inside the newly built worker image against its own PostgreSQL 16.11 database on an internal-only Docker network, with no published ports. The explicit private config selected the synthetic database despite an invalid ambient URL. Container-owned 0700 directories and 0600 config/export files passed; identical-content files owned by root and deliberately unsafe modes failed. Exported input and video evidence was also copied back and successfully read on the host. Source and Git were unchanged.

The current input could be approved; changed payloads, old review versions, changed provider identity, a truncated video and a changed final byte all remained held. Five successful repeated/concurrent calls approving the same complete synthetic video consumed exactly 10 credits once, leaving 140 of the 150 test credits available and one approval audit row. Failed decisions preserved the original reservation. The generation budget stayed disabled. The main session inspected the structured results and cleanup evidence; task-owned containers, network and volume were removed.

The candidate was a locally encoded one-second, five-frame grayscale MP4 with no audio, checked through an injected transport and full-byte digest. It intentionally did not match the seeded five-second/720p product specification: this proves CLI permissions, stale-evidence rejection and settlement behavior, **not** model generation, product-spec validation, paid delivery or founder staffing. No provider request or payment occurred. A separate amd64 worker build loaded `tsx` and the moderation exports as UID1000 without network or database access; the database rehearsal itself ran on arm64.

The existing Hostinger host console is now accessible after the owner signed in. The production operator path still needs minimal private config, UID-compatible mounts, secure evidence transfer, and actual inspection of every input image and the whole output. The worker image has no media viewer. The offline input-image helper described below now handles supported PNG/JPEG uploads; it does not fetch output videos or perform human review. Do not expose this CLI as a public admin route, weaken evidence permissions, or call a successful file export a completed human review. Restricted evidence: `/private/tmp/kakareel-operator-20261025-efdea26-r1`; this path contains synthetic fixtures only.


## Offline input-image inspection helper (2026-10-25)

After exporting an input review, run this separate command on the trusted operator workstation:

```sh
node --import tsx scripts/moderation-input-images.ts /ABS/PRIVATE/review.json /ABS/PRIVATE/new-image-directory
```

It requires no database, operator config or network. Both paths must be outside the checkout with canonical absolute parents owned by the current user and mode 0700; the source must be a single-link 0600 regular file, and the destination must not exist. On macOS, use the canonical `/private/tmp` path rather than its `/tmp` alias. It writes numbered 0600 PNG/JPEG files in original array order, including duplicates, and a final `manifest.json` with the complete count, byte hashes and the source export/review identity. Text-only input explicitly produces a zero-image manifest. Never copy real exports into this public repository.

Open every numbered image and inspect the original private prompt/settings before using the existing `decide` command. A manifest proves byte extraction from the supplied export, not image decodability, current database state, authenticity, human viewing or content approval. Unknown model/fields, remote URLs, malformed data, duplicate JSON keys, inconsistent input hashes and unsafe paths are rejected; the helper never fetches URLs or approves content. Each image retains the application’s 3 MiB PNG/JPEG limit; exports above 32 MiB are explicitly refused. On an IO failure, a partial private directory may remain without a completion manifest; do not use it as a complete review.

Acceptance: 14 focused offline tests passed, including all current provider payload families/modes, image count/order, refusal cases, non-overwrite and sensitive-output checks; TypeScript passed. The main session inspected the implementation and opened both independently generated PNG/JPEG outputs. The older operator rehearsal’s fictitious-model export was correctly refused; this does not claim a new production or container-database rehearsal. The helper has not been deployed and makes no changes to review or billing decisions.
