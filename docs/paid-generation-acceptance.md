---
title: "Single unattended paid generation acceptance"
date: 2026-11-04
source: "Owner-authorized single acceptance; implementation and isolated PostgreSQL tests"
status: "Implementation prepared; production acceptance pending"
---

# Fixed boundary

Public sales and public generation charging remain closed. `GENERATION_PAID_ACCEPTANCE_ENABLED` defaults to false. Enabling it alone issues no permission and creates no job. This separate fixed-purpose grant is `unattended-paid-acceptance-v1`: one grant per owner for its lifetime, including expired, revoked, failed and released grants. It does not reset or reuse the historical paid pilot.

The grant permits one exact request ID, a deadline at most one hour away, MiniMax H3 image-to-video, 6 seconds, 2K, adaptive ratio and model-default audio (`audio=false` in the request). Retail cost is 23 purchased credits; confirmed supplier maximum is CNY4.56. The owner supplies the prompt and image in Studio. A five-minute quote binds the complete validated input; job, input audit, quote use and both financial reservations commit together. No new schema, public offer or Studio controls are introduced.

# Operator entry

Use the deployed worker's host-only CLI:

`node --import tsx scripts/paid-generation-acceptance-admin.ts /absolute/external/private/input.json`

Inputs must be outside all repositories, in a 0700 directory, with a nonsymlink 0600 file. Both commands require `target: { database, role }`, `userId`, `actor`, and `evidenceRef`. The target is compared to the actual connected database and role before mutation. Never put real values in this public repository.

- `action: "issue"` additionally requires `requestId`, `previousJobId`, `expectedRevision`, and ISO `expiresAt`. The exact historical prior paid job must still be successful and consumed for 23 credits, with no additional live paid job for that owner. Issuance and a short-lived budget revision commit atomically; cumulative exposure is preserved and the cap is exposure plus456 fen. The budget is scoped to this request and grant, so preview traffic cannot borrow it. Current price confirmation and supplier Key quota are separate operator checks.
- `action: "revoke"` additionally requires `grantId`. It appends permanent revocation without recalling authorized in-flight work. It does not reopen the lifetime slot. Close the generation budget separately with the existing cost administration CLI; revocation intentionally does not alter an unrelated newer budget.

Grants and revocations use application-level append-only audit conventions, not a new database immutability guarantee. New authorizations recheck grant, deadline, original input, wallet, budget revision/scope and task lease. Final durable send authorization checks them in cost→wallet→job lock order. Once that transaction commits, the request is authorized/in flight; remote transport and DB commit cannot be atomic. The synchronous expiry/emergency check immediately before transport remains.

# Acceptance and cleanup

Before issuance, verify the deployed code and default-off state, the owner's current wallet and historical task, no conflicting new paid work, the supplier's current exact price/Key quota, and the explicit one-request spending authorization. Enable only the fixed acceptance gate with the existing MVP automation policy; do not enable public charging or sales. Issue the short-lived grant only when the owner is ready to submit through Studio.

Observe reservation127 available/0 reserved→104/23 and verified automatic delivery→104/0, cumulative consumed23→46, using independently read current wallet values as the actual baseline. Verify one provider POST, no fabricated human review, complete output hash, playback and refreshed history. Record actual supplier cost from independent supplier evidence; do not infer it from job success. Close new-generation budget and revoke any remaining permission after the accepted request. Unknown submissions retain original identity and supplier exposure and only query; explicit failure releases held customer credits once. Late success after an existing release never charges again.

Production issuance, generation, wallet settlement and supplier spend have not been performed by the implementation tests. The isolated tests use synthetic providers and forbid external fetch.
