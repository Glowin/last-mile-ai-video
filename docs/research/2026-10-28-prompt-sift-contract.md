---
title: "Prompt Sift one-shot adapter contract"
date: 2026-10-28
status: "Implemented; offline validation only; no live acceptance claim"
source: "Current official Waffo documentation and installed @waffo/pancake-ts 0.26.0 JavaScript/type declarations"
---

# Scope and authorization

The owner authorized the MVP to check **text prompts only** on 2026-10-28. Images and generated output remain unreviewed by this adapter. This task does not enforce the earlier manual-input/output policy described in the [2026-10-25 research note](2026-10-25-prompt-sift-contract.md). That note is historical context, not an activation prerequisite for this implementation. Main owns orchestration and deployment; this adapter does not change billing behavior or the existing moderation state machine.

# Verified official contract

The [scan endpoint](https://docs.waffo.ai/zh/api-reference/endpoints/content-safety/scan-prompt), checked on 2026-10-28, documents `POST /v1/actions/verification/scan-prompt`, a 1–10,000-character prompt, optional locale and semantic mode, and beta access free using the existing payment key. It returns `allow`, `block`, or `review` with `reasonCode`, `matchedCategories`, `requestId`, and `semanticStatus`. Its successful enforced-semantic example returns `scored`. Review means defer and retry later, with approximately one hour mentioned; degradation also requires deferral. HTTP 429 includes `Retry-After`. Other 4xx require correction; 5xx guidance starts at five seconds with exponential backoff and at most three retries. These are documented guidance, not a completion SLA or a permanent free-price guarantee.

The [generic idempotency contract](https://docs.waffo.ai/zh/api-reference/introduction) caches 2xx responses for 24 hours and replays a completed same-key response without executing again. In-flight duplicates return 409; non-2xx failures do not occupy the key. Keys permit 1–256 letters, numbers, underscores and hyphens. Merchant-wide uniqueness belongs to the caller.

**Unresolved gap:** the reviewed scan documentation and SDK expose no request-status query or terminal-result callback. If generic caching applies unchanged to a 200 `review`, the documented later retry may replay the same review. Whether a later verdict updates that cache is undocumented in the reviewed sources. This adapter makes no query, does not rotate keys, and does not promise that retrying obtains a new verdict.

[Authentication](https://docs.waffo.ai/zh/api-reference/authentication) uses merchant RSA-SHA256 signing over method, path, timestamp and the SHA256/base64 body digest. The verified key determines environment; setting an SDK environment option does not turn production credentials into sandbox credentials.

# Installed SDK evidence

Read only `node_modules/@waffo/pancake-ts/package.json` and narrow sections of `dist/index.js` and `dist/index.d.ts`, excluding source maps. Version: **0.26.0**.

- `WaffoPancake` validates merchant ID and parses the private key at construction. Its `fetch` option permits a transport wrapper.
- `ContentSafetyResource.scanPrompt(params, options)` signs and sends one POST, then unwraps `data`; `options.idempotencyKey` becomes `X-Idempotency-Key` unchanged. There is no internal retry or scan timeout.
- `HttpClient.post()` parses the body and returns `{ status: response.status, ...envelope }`; an envelope can overwrite that SDK status. `unwrapAction()` checks `errors` rather than rejecting by HTTP status. The adapter therefore records HTTP status before SDK parsing and rejects non-200 responses itself.
- The shipped semantic enum contains `disabled`, `scored`, `shadow_scored`, `skipped_rules_block`, `skipped_budget`, `provider_timeout`, and `provider_error`. Only `scored` satisfies the adapter's enforced-semantic **allow** rule. A rules-based block can use `skipped_rules_block`. Unknown values are rejected pending contract review; no undocumented “success” synonym is assumed.

# Public API and local policy

Implementation: [prompt-sift.ts](../../src/server/moderation/prompt-sift.ts).

```ts
type PromptSiftResult = {
  action: 'allow' | 'block' | 'review' | 'error';
  requestId: string | null;
  reasonCode: string;
  semanticStatus: string | null;
  retryable: boolean;
  retryAfterMs: number | null;
  httpStatus: number | null;
};

scanPrompt(
  input: { prompt: string; idempotencyKey: string; timeoutMs: number },
  options?: {
    env?: Readonly<{
      PANCAKE_LIVE_MERCHANT_ID?: string;
      PANCAKE_LIVE_PRIVATE_KEY?: string;
    }>;
    fetch?: typeof fetch;
  },
): Promise<PromptSiftResult>;
```

Importing the module reads no credentials and constructs no client. A valid explicit `scanPrompt()` call reads only `PANCAKE_LIVE_MERCHANT_ID` and `PANCAKE_LIVE_PRIVATE_KEY`, or the supplied isolated test environment. Inactive orchestration must not call it. There is no fallback from injected credentials to real environment values, no file-based key lookup, and no billing-client import.

Each call makes at most one SDK POST. The prompt and caller's stable idempotency key are unchanged; `semantic` is always `enforce`, and locale is omitted. The caller must persist a globally unique key for the logical scan, bind it to the exact prompt, and reuse it after ambiguous outcomes or review. The adapter cannot enforce durable uniqueness across calls.

Local resource limits are a **1–60,000 ms** caller-selected total deadline and **65,536 response bytes**. The deadline covers request and body consumption, not just receipt of headers. Abort plus an outer deadline race bounds transports that ignore abort; late bodies are canceled. Redirects are returned with `redirect: manual` and rejected without following. Limits are implementation choices, not claimed provider limits.

Only HTTP 200, valid UTF-8/JSON, an unambiguous envelope, known verdict fields, no nonempty errors/warnings, and a consistent verdict can authorize generation. Duplicate object members, excess depth, oversized bodies, unknown enum values, malformed schema and inconsistent verdicts fail closed. Returned HTTP status is the observed response status, never an SDK-generated or envelope-supplied value. `null` means no HTTP response was observed before the adapter returned.

| Result | Conditions | Retry metadata |
|---|---|---|
| `allow` / `allowed` | Action allow, reason allowed, semantics scored, empty matched categories | `false`, `null` |
| `block` / `restricted_content` | Action block, matching reason, semantics scored or skipped_rules_block | `false`, `null` |
| `review` / `review_required` | Action review and matching reason | `true`, valid Retry-After or 3,600,000 ms |
| `review` / `service_degraded` | Degraded reason or provider_error/provider_timeout/skipped_budget, even if action says allow | `true`, valid Retry-After or 3,600,000 ms |
| `error` / `PROMPT_SIFT_RATE_LIMITED` | HTTP 429, irrespective of body | `true`, valid Retry-After or 60,000 ms |
| `error` / `PROMPT_SIFT_HTTP_ERROR` | Any other non-200 HTTP status | 5xx only: `true`, valid Retry-After or 5,000 ms; otherwise `false`, `null` |
| `error` / `PROMPT_SIFT_TIMEOUT` or `PROMPT_SIFT_TRANSPORT_ERROR` | Deadline or request/body transport failure | `true`, observed valid Retry-After or 5,000 ms |
| Other `error` | Invalid input/config, redirect, oversized/malformed response, API errors, invalid verdict | `false`, `null` |

`retryable` is permission for the external state machine to consider another same-key attempt, **not a scheduled retry, successful recovery, or eventual approval promise**. The adapter has zero internal retries, does not sleep, and does not enforce a retry count. The caller owns the documented backoff/count budget, expiration, and terminal handling. HTTP 409 is currently non-retryable under the scan endpoint's general 4xx guidance; it never becomes allow.

**Integration timing:** Main reported a proposed 60-second review wait and 300-second job expiry on 2026-10-28. Those do not match this adapter's one-hour review fallback. If `now + retryAfterMs` is beyond the job deadline, orchestration should expire the job through its configured terminal path, not advertise a scheduled retry. A 60-second override is a caller policy choice, not this adapter's contract or evidence that a cached review changes. Frontend copy must reflect the actual scheduled time and deadline and must not promise completion within 300 seconds. These orchestration changes are outside this adapter's ownership.

Errors expose only fixed locally assigned codes. Valid request IDs are bounded opaque references; semantic statuses and provider reason codes are restricted to known values. No prompts, credentials, SDK exception text, matched-category list or raw response body are logged or returned. No new persistence is added.

# Validation and limits of evidence

[Focused tests](../../tests/prompt-sift.test.ts) use generated ephemeral RSA keys and the **actual installed SDK**, replacing only fetch. They independently verify the signature over transmitted bytes, one POST per call, unchanged stable keys, enforced semantics, real HTTP status precedence, Retry-After parsing, request/body timeout behavior, stream byte limits/cancellation, duplicate fields, malformed responses, contradictory/degraded results, and silent safe errors. A fresh subprocess imports the module with no credentials and a failing network stub.

Observed on 2026-10-28: `node --import tsx --test tests/prompt-sift.test.ts` passed all **16** tests with no skipped tests; the strict scoped TypeScript check passed; `./node_modules/.bin/tsc --noEmit --incremental false` passed for the full checkout. These checks do not generate build metadata or modify other owners' files.

These are offline contract tests. They do not establish live availability, pricing, real moderation accuracy, review turnaround, same-key cache refresh, image/output review, or production readiness. No live scan, real credential read, browser, git operation or deployment was performed by this task.
