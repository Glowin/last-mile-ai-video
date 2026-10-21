---
title: "KakaReel Google 登录架构与验证"
date: 2026-10-20
status: "2026-10-21 已上线，真实 Google 登录、刷新、退出与再次登录通过"
---

# Google sign-in for KakaReel

Implemented 2026-10-20. This is a separate KakaReel identity store; no 13F Insight users, tokens, secrets, or configuration are imported. The reference architecture contributes Google Identity Services (GIS), access JWTs, and rotating hashed refresh tokens. Email/password registration is not implemented.

## Runtime configuration and Google Cloud

Set `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `APP_URL`, and `DATABASE_URL` at runtime. Keep actual values outside the checkout or in the deployment platform. `.env.example` contains names only. No Google client secret is needed for this GIS ID-token flow. Do not use `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or a Docker build argument.

Create an OAuth **Web application** client in the independent KakaReel Google Cloud project. Configure its exact website origin under **Authorized JavaScript origins** and the consent/branding settings. This implementation uses a JavaScript popup callback, not a redirect callback URL. Production uses HTTPS. A localhost preview can show the disabled state without a client ID; genuine local Google login requires a separately authorized local origin/client. Do not assume the production client permits localhost.

`GET /api/config` returns only `{ googleClientId: string | null }`, with `Cache-Control: no-store`. The official GIS script is loaded from `https://accounts.google.com/gsi/client` and `renderButton()` renders the button. There is no credential in a query string and no application token in localStorage. The public client ID comes from runtime configuration and is not baked into JavaScript bundles. `Cross-Origin-Opener-Policy: same-origin-allow-popups` supports the popup flow. If a stricter CSP is introduced at the proxy, allow the GIS script, frame, style, and connection origins per Google's setup guide.

## Identity and browser security

- `POST /api/auth/challenge` creates a 10-minute random nonce, returns it to GIS, stores its SHA-256 hash in PostgreSQL, and binds it to an HttpOnly browser cookie. Challenge issuance is globally limited to 120/minute; expired nonce rows are removed on issuance.
- `POST /api/auth/google` calls `google-auth-library` `verifyIdToken({ idToken, audience })`. Signature, issuer, audience, expiry, a verified email, and the expected nonce are required. Exact expiry is additionally checked without clock-skew grace. The nonce is atomically consumed in the account transaction; replay cannot create another session.
- `users.google_sub` is unique. A returning Google subject retains its KakaReel UUID even if its email changes. Different subjects are never merged by email. Email and name are profile attributes, not account keys; no Google password, photo, access token, or refresh token is stored.
- Application access JWTs expire in 10 minutes, use HS256 with the existing `SESSION_SECRET`, and specify KakaReel issuer/audience. A database session is checked on authenticated requests, so logout or replay revocation also invalidates existing access JWTs immediately.
- Application refresh tokens are random 256-bit values, stored only as SHA-256 hashes. Each rotation runs in a PostgreSQL transaction with the session row locked. The absolute session lifetime is 30 days. Used refresh tokens remain as replay evidence; reuse revokes that session family. Independent sessions on other devices are unaffected.
- Cookies are HttpOnly, SameSite=Lax, host-only, and Secure in production. Access and guest cookies use `/`; refresh uses `/api`; nonce uses `/api/auth`. `DELETE /api/session` revokes the current account session and any presented unclaimed guest cookie, then clears all four cookies.
- All API mutations, including DELETE, require the exact configured Origin; missing, null, foreign origins and cross-site Fetch Metadata are rejected. The GIS callback is posted by our same-origin JavaScript; there is no unauthenticated Google redirect POST handler. No permissive CORS is enabled.
- On reload or API expiry, the client obtains the session and rotates when needed, then retries once. A single flight plus Web Locks coordinates refresh within/across tabs. Browsers without Web Locks still deduplicate within a tab; competing cross-tab refreshes fail closed and may require sign-in again. Sign-in, sign-out, and refresh share the same browser lock. Identity changes clear visible history and reject stale responses and retries. Paid mutations also carry the expected owner, checked against the authenticated server identity. Unacknowledged request IDs are retained per owner and move with a valid guest claim; damaged saved requests block submission until an explicit reset. A lost rotation response can also require a new login, rather than accepting a reused refresh token.

## Invite permission and existing jobs

Google signup creates an account with **no generation permission**. Both job creation and recovery require preview access. `POST /api/session` continues to accept the existing invitation code: guests receive the legacy signed cookie; signed-in users redeem the code onto their account. Existing rate limits, global daily spend reservations, provider idempotency keys, and recovery behavior remain in force.

A valid, unexpired, correctly signed existing `lm_session` cookie can transfer its owner's jobs and invitation to the Google account. This is done in one transaction with a unique `guest_claims` row and a per-guest advisory lock. Generation reservations and recovery use the same lock, so concurrent claims cannot split ownership or leave new jobs behind. No owner ID supplied in a request body is trusted. Claimed/revoked cookies are denied guest access, and replaying them while signing into a different Google account grants neither history nor invitation. Successful sign-in clears the guest cookie. Account history survives logout; returning with the same Google subject restores access.

## Additive startup migration

`db/0001-init.sql` is unchanged. `0002-google-auth.sql` adds users, sessions, hashed refresh tokens, guest claims, nonces, and auth attempt counters. Existing `video_jobs` are preserved, including their guest owner UUIDs.

`node scripts/migrate.mjs` discovers sorted SQL migrations, records checksums in `schema_migrations`, and applies missing migrations under a PostgreSQL advisory lock in one transaction. It can adopt a legacy database with 0001 tables but no migration ledger. Re-running is safe; changing an applied migration fails rather than silently rewriting history.

`pnpm start` and the Docker `CMD` run `scripts/start.mjs`, which awaits migrations **before** starting Next.js. Migration failure exits without opening the app listener. The database image no longer relies on one-time init SQL. Existing Compose volumes therefore receive upgrades at web startup. Standalone output explicitly traces `postgres`, and the runtime image includes the migration scripts and SQL files. For development, run `pnpm db:migrate` before `pnpm dev`.

## Verification and handoff

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `docker build` without real configuration. For integration tests, provide external temporary environment values and dedicated disposable PostgreSQL databases: `DATABASE_URL` must be on `127.0.0.1` with database `video_qa`; `AUTH_TEST_DATABASE_URL` must be on `127.0.0.1` with database `video_auth_qa`. The auth suite resets the latter's public schema; never point it at retained data. Set test-only `APP_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `DEMO_ACCESS_CODE`, and `VIBETOKEN_API_KEY` outside the repository, then run `pnpm db:migrate` and `pnpm test`. Without these DB variables the integration suites explicitly skip.

Google tests generate a temporary RSA key in memory and mock only Google's certificate retrieval inside the test process. Real `verifyIdToken` signature/claim verification still executes; there is no production bypass or test auth endpoint. Video requests are intercepted in tests. Coverage includes legacy migrations, bad audience/issuer/signature/expiry/unverified email, nonce replay, CSRF including DELETE, stable identity, account isolation, hashed refresh rotation/reuse/logout, invitation gating, and concurrent guest adoption. Client tests check refresh deduplication and exact mutation retries.

Local verification completed on 2026-10-20: `pnpm typecheck`, `pnpm test` (23 passed, zero failed/skipped), `pnpm build`, and the Docker image build all passed. The final runtime image successfully imported `postgres`. Its default startup migrated a PostgreSQL 16 volume containing only the legacy schema and a job fixture, preserved that job’s original owner, and preserved it again after web restart. A nonexistent test database caused exit 1 before Next.js readiness. Loopback HTTP checks confirmed health, disabled Google config, session state, and the studio/privacy/terms responses. Browser appearance and genuine Google login remain unverified locally.

Review completed on 2026-10-21: 9 client regressions and 17 auth/integration checks passed without skips on disposable PostgreSQL 16; type checking and the final Next.js build passed. These checks cover cross-tab identity switches, anonymous refresh responses, pending request adoption, and concurrent guest claims. No paid provider calls were made.

The parent owns Google Cloud configuration, deployment, and browser acceptance. After deployment, verify the official button and popup on the authorized HTTPS origin, account reload/logout, guest migration, and invite-required generation. No browser login or production request is claimed by these local tests. No paid generation is necessary for auth acceptance.

Known unrelated provider issue reported by the parent on 2026-10-20: a Seedance 480p request returned `Invalid parameter value: resolution` with zero charge. Models/provider code is unchanged in this auth patch; resolution compatibility needs a separate fix and verification.

## Provider references

Checked against official Google documentation on 2026-10-20:

- [Verify Google ID tokens on the server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [GIS JavaScript API: initialization, nonce and official button](https://developers.google.com/identity/gsi/web/reference/js-reference)
- [Google client/origin, popup and CSP setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

## Production acceptance — 2026-10-21

PR #1 merged as `b5e0dcd`; Dokploy completed that exact commit. The runtime Google client ID matched external configuration. In Chrome Glow, the official Google flow created an account, reload retained it, logout cleared it, reload stayed signed out, and a returning sign-in succeeded. The account had no preview permission and generation remained disabled. No paid video request was submitted.

The production database applied `0001-init.sql` and `0002-google-auth.sql`; both existing video jobs and their owner digest matched the pre-deploy baseline. A custom-format database backup was retained on the persistent database volume before deployment; its location and restricted screenshot evidence are kept outside this repository. Invalid credentials returned 401, anonymous jobs returned 401, and foreign-Origin mutation returned 403.

The deployed workspace has canonical, a 54-character title, a 156-character description, OpenGraph/Twitter metadata, two meaningful H2s and an H3. The redundant brand image intentionally keeps empty alt next to brand text. `/create` retains noindex and is excluded from the sitemap; robots.txt allows crawling the noindex instruction. Desktop appearance was inspected. Responsive acceptance remains pending because the browser viewport override did not change the measured width; no mobile success is claimed.

Account management shipped in `9ae7ca4` on 2026-10-21. The production account page showed the same profile and creation date, one current session and no other sessions. Signing out cleared the profile; the official Google flow returned to the same account. Disabling the “other sessions” action when none exist was checked. Multiple-session revocation remains covered by isolated PostgreSQL integration rather than a manufactured production device session.

## Sign-in entry visibility — 2026-10-21

An anonymous visitor reported not finding Google login. The shared header previously labeled the entry “Account” inside navigation hidden at widths of 650px or less; the studio placed the official Google button below generation settings, with no sign-in action in its top bar. This was a discoverability defect. In a real Chrome Glow Incognito window with third-party cookies blocked, the account page still rendered the official button and clicking it opened Google's email sign-in screen. No password was entered and this check does not claim a completed Incognito login.

The shared header now exposes a separate “Sign in” link to `/account`, outside the hidden navigation. The unsigned-in studio exposes “Sign in with Google” at the top, linking to its existing in-page Google section so entering login does not discard the prompt. Header actions can wrap on narrow screens. The Google SDK, session protocol, and invite requirement are unchanged. The production build and TypeScript check passed. Dokploy deployed `6fbdbb5` successfully (27 seconds); the live desktop header visibly showed “Sign in”. The owner also confirmed seeing the Google button in Incognito. Mobile rules were corrected in code, but an actual narrow-screen visual check is still pending.

## Site-wide One Tap — implementation and acceptance contract

On 2026-10-21 the owner clarified that “Google login” means the Google quick sign-in prompt when opening any page, plus a Google sign-in action when no Google session exists. A navigation link alone does not meet this requirement. All HTML routes must share the same root sign-in provider; account and studio buttons must reuse its GIS configuration, nonce and credential callback. The server-side verification, invitation permissions and guest-history claim contract remain unchanged.

Google's [One Tap user experience](https://developers.google.com/identity/gsi/web/guides/features) states that native One Tap is not shown without an active Google session and can be suppressed by user settings or cooldown. Its [FedCM migration guide](https://developers.google.com/identity/gsi/web/guides/fedcm-migration) says the browser controls native prompt placement and removes display-moment notifications. Therefore the app must not promise a native prompt on every visit, infer Google login status from missing UI, or automatically reset browser consent/cooldown. A clearly branded KakaReel card containing the official Google-rendered button provides the signed-out fallback. It must remain dismissible and respect that choice during this tab session.

The [GIS JavaScript reference](https://developers.google.com/identity/gsi/web/reference/js-reference), checked 2026-10-21, requires shared initialization when using buttons and One Tap together; later initialization overwrites the earlier callback and nonce. The current reference marks `use_fedcm_for_prompt` deprecated. Call `prompt()` through the shared lifecycle and retain a user-confirmed flow rather than silently selecting an account.

Acceptance must distinguish the app card, official button, native One Tap prompt and a completed KakaReel login. Verify a Google-signed-in browser and a Google-signed-out browser; verify homepage and inner routes, dismissal/navigation, existing KakaReel session suppression, same-page account/studio updates and unchanged invitation requirements. No paid video or payment request is needed. Until the production evidence is appended, this section records the requested behavior and validation criteria, not a completed deployment.

Validation on 2026-10-21: production build passed; isolated PostgreSQL authentication and client suites passed 45/45 with no skipped tests. The challenge endpoint reuses an unconsumed nonce without extending its original deadline and returns its remaining lifetime. Web Locks serialize challenge cookie changes with session changes across supported browsers. Browsers without Web Locks retain within-tab serialization; simultaneous first-time requests in separate tabs can still fail safely and require retry. No paid generation was run. Production UI acceptance is pending deployment.
