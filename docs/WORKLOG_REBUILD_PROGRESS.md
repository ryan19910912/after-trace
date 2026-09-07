# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 Google/LINE login chooser + atomic provider-cost reservation + Apple Login source-authored; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- Trial points are not TWD, do not refresh monthly and do not retroactively resize already-issued grants.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership authorizes data only.
- AI Pro retains monthly resource/point cap, provider-cost hard cap and optional per-request cap.
- Every provider-backed request must pass unified entitlement before low-level reservation/settlement.

## Accepted foundation from prior checkpoints

Do not redo these batches:

- provider-neutral account/identity schema for Google / LINE / Apple with immutable opaque `public_account_id`;
- native AFTERTRACE GROUP membership/invites independent from LINE GROUP membership;
- free manual Record CRUD/search + nullable `occurred_at`;
- capture-first PWA browser speech-to-text path that does not consume AFTERTRACE provider AI;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH + shared five-minute scheduler;
- native Task backend/Web UI;
- FREE one-time AI trial config/onboarding;
- Admin `/commercial` and customer V1-only FREE + AI_PRO subscription surface;
- unified `AiEntitlementService`, exact selected-Grant admission and `EntitledAiPointLedgerService`;
- target provider-backed AI text capture backend `POST /api/v1/ai/capture/text`;
- explicit PWA `一般紀錄` vs `AI 整理紀錄` surface;
- AI hard-limit SYSTEM notification caller;
- Chrome extension scaffold.

## Branch progress incorporated after the previous stale checkpoint

The branch advanced beyond the prior progress document before this run. That newer branch state was inspected and preserved rather than reimplemented.

### Provider-neutral Web/PWA login chooser

The current Web branch already contains `/login`, `LoginRoot.tsx`, `LoginProviderButtons.tsx`, `login.css` and provider entry tests.

Existing unauthenticated customer surfaces now converge on the provider-neutral login chooser rather than silently preferring LINE. Google and LINE are first-class login options and both resolve into the same AFTERTRACE account/session model.

No provider email/id becomes the customer-facing account id and no email-based automatic merge is introduced.

### Concurrent AI Pro provider-cost hold is now source-authored

The current AI point reservation model now carries:

- exact `entitlement_grant_id`;
- conservative `provider_cost_hold_twd` for AI Pro reservations;
- grant-level committed/reserved provider-cost accounting.

`EntitledAiPointLedgerService` requires an AI Pro provider-cost hold in addition to exact Grant admission.

The PostgreSQL reservation path locks the selected Grant/Source scope and atomically evaluates:

- current-period committed provider TWD cost;
- current reserved/in-flight provider-cost holds;
- the new request hold;
- missing committed TWD cost accounting;
- older active reservations without a provider-cost hold.

New provider work fails closed as `MONTHLY_PROVIDER_COST_CAP_REACHED` or `PROVIDER_COST_ACCOUNTING_INCOMPLETE` rather than allowing concurrent requests to race past the AI Pro hard cap. Settlement/release paths return the held amount through the durable reservation/grant accounting model.

Representative branch commits for this already-present batch include:

- `4f997492` — test conservative provider cost hold conversion;
- `7a67a8a3` — test exact Grant provider cost admission holds;
- `767a1d9e` — test atomic provider cost hard-cap propagation;
- `8de5abc9` — align AI capture tests with the current entitlement contract.

These are source-authored branch changes; executable verification is still pending.

## This run — provider-neutral Sign in with Apple

This run continued the next planned auth batch and did not redo a broad static audit.

### Apple OAuth state and crypto boundary

`oauth-state.ts` now exposes Apple-specific wrappers over the provider-tagged HMAC state format, so an Apple state cannot be substituted for Google/LINE state.

New `apple-login.ts` implements the two distinct Apple JWT responsibilities correctly:

- AFTERTRACE developer `client_secret` is signed with the configured Sign in with Apple P-256 private key using **ES256**;
- Apple-issued `id_token` is verified as **RS256** against Apple's RSA JWKS from `/auth/keys`.

Identity-token verification checks:

- Apple issuer;
- Services ID audience;
- expiry / bounded issue time;
- exact request nonce;
- immutable Apple `sub` as provider identity.

Email remains an optional snapshot only.

New `apple-user.ts` sanitizes the optional first-login Apple `user` form payload. First/last name and email are bounded metadata only and never an account merge key.

### Apple Web authorization + callback

`createWebAuthRoutes()` now source-authors:

- `GET /api/v1/auth/apple/start`;
- `POST /api/v1/auth/apple/callback`.

Start behavior:

- requires complete Apple Services ID / Team ID / Key ID / private-key config;
- requires HTTPS callback origin;
- creates provider-specific signed state + random nonce;
- redirects to `https://appleid.apple.com/auth/authorize`;
- requests `name email` with `response_mode=form_post`;
- stores short-lived state+nonce in HttpOnly `SameSite=None; Secure` cookie so Apple's cross-site form POST can return it.

Callback behavior:

- only the Apple OAuth callback is exempted from normal Web exact-Origin rejection, because Apple posts the authorization response from the provider origin;
- signed state + short-lived cookie + nonce still form the CSRF/replay boundary;
- exchanges the single-use authorization code at Apple's token endpoint using a short-lived ES256 client secret;
- verifies the returned Apple RS256 identity token before provisioning;
- provisions `provider='APPLE'` + Apple `sub` through existing `AccountIdentityService`;
- does not merge by email;
- runs the same `ensureAccountOnboarding()` path as Google/LINE, including idempotent FREE trial issuance;
- issues the normal AFTERTRACE Web session containing durable AFTERTRACE user id.

### Customer login UI

The shared `LoginProviderButtons` now exposes:

- Google Login;
- LINE Login;
- Apple Login.

`LoginRoot` now reuses the same shared component used by other unauthenticated customer surfaces. Copy explicitly states that providers only authenticate and that matching provider emails do not automatically merge AFTERTRACE accounts.

Apple runtime configuration remains optional in manual deployment configuration until real Apple credentials are supplied; the endpoint fails closed with `APPLE_LOGIN_NOT_CONFIGURED` when incomplete.

### Apple tests authored

New/updated source-authored tests cover:

- Apple authorization endpoint/Services ID/form_post/name+email/state/nonce contract;
- `SameSite=None; Secure` callback cookie;
- incomplete Apple configuration fail-closed;
- external Apple callback Origin bypassing normal Web CORS rejection only far enough to reach signed callback validation;
- HTTPS callback requirement;
- ES256 client-secret header/claims/signature shape;
- RS256 identity-token verification against generated RSA JWK;
- nonce mismatch rejection;
- rejection of ES256 as an Apple identity-token algorithm.

The Apple private-key test fixture was corrected to match the documented environment contract: Base64 of the complete `.p8` PEM, not raw DER bytes.

## Files changed / incorporated in this run

- `apps/api/src/auth/oauth-state.ts` — Apple provider state wrappers;
- `apps/api/src/auth/apple-login.ts` — Apple client-secret signing + identity-token verification;
- `apps/api/src/auth/apple-user.ts` — bounded first-login profile snapshot sanitizer;
- `apps/api/src/auth/routes.ts` — Apple start/form_post callback + provider-neutral provisioning;
- `apps/api/src/auth/apple-login.test.ts` — Apple crypto tests;
- `apps/api/src/auth/apple-login-routes.test.ts` — Apple route contract tests;
- `apps/web/src/LoginProviderButtons.tsx` — Google / LINE / Apple shared chooser;
- `apps/web/src/LoginRoot.tsx` — reuse shared chooser;
- `.env.example` — Apple Services ID/Team ID/Key ID/private-key secret contract was already added on the advancing branch and preserved;
- `scripts/deploy-workers.mjs` — optional all-or-none Apple secret upload was already added on the advancing branch and preserved;
- AI point/grant files listed above — atomic provider-cost hold branch progress incorporated;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits from this run

All successful development commits contain `[skip ci]`:

- `b01935c2` — add Apple OAuth state wrappers;
- `c624adde` — add Sign in with Apple crypto primitives;
- `dd4ced73` — add first-login Apple profile sanitizer;
- `ea02bc06` — keep Apple profile sanitizer self-contained;
- `7ba6d326` — add provider-neutral Apple Login flow;
- `8f2f561c` — expose Apple as provider-neutral login option;
- `b9ff1b03` — use shared provider-neutral login chooser;
- `35c62299` — author Apple Login route contract tests;
- `538340fc` — align Apple private-key test fixture with environment contract;
- branch-concurrent refinement `5953de73` corrected Apple identity-token verification to RS256 and was preserved rather than overwritten;
- this checkpoint commit follows.

A stale-SHA Apple helper update returned HTTP 409 and produced no repository change. A duplicate test create returned HTTP 422 because the file had already been added by the advancing branch; it also produced no repository change.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Source-authored / not executed

- provider-neutral Google/LINE login chooser — **AUTHORED / NOT RUN**;
- concurrent provider-cost hold + atomic PostgreSQL guard — **AUTHORED / NOT RUN**;
- Apple OAuth state/client-secret/id-token helpers — **AUTHORED / NOT RUN**;
- `apps/api/src/auth/apple-login.test.ts` — **AUTHORED / NOT RUN**;
- `apps/api/src/auth/apple-login-routes.test.ts` — **AUTHORED / NOT RUN**;
- Apple callback provider-neutral provisioning/onboarding — **AUTHORED / NOT RUN**;
- Apple shared Web login button — **AUTHORED / NOT RUN**.

### Executable verification actually attempted this run

- mounted AFTERTRACE checkout discovery — **FAIL**; no checkout/.git directory found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- Apple/Google/auth + AI entitlement/cost focused Vitest — **NOT RUN**;
- full API/Web/Admin Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production build — **NOT RUN**;
- PostgreSQL canonical target-schema + atomic cost-hold smoke — **NOT RUN**;
- Google/Apple real OAuth smoke — **NOT RUN**;
- Gemini real provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so current TypeScript/React/SQL has not compiled or executed.
2. Canonical `drizzle/0000` is still behind the current target schema, including the new provider-cost reservation columns/logic and other previously authored target surfaces.
3. Atomic provider-cost reservation is source-authored but still requires real PostgreSQL concurrency smoke before AI Pro paid launch.
4. Apple Login requires real Apple Developer configuration: Services ID, associated primary App ID/domain, registered absolute HTTPS return URL and private key. Real Apple authorization/token/JWKS behavior is not runtime verified yet.
5. Apple credentials are optional in the manual deploy script. Until configured, the Apple button reaches a fail-closed 503 route; either configure Apple before exposing production login or add a small provider-availability handshake before launch.
6. Payment lifecycle remains disabled (`CHECKOUT_ENABLED=false`); activation/renewal/cancellation/webhook idempotency and payment SYSTEM callers remain incomplete.
7. Target AI voice/image/file, natural-language search, related Records, time-range summary and explicit rewrite remain pending.
8. Chrome extension still needs real auth handoff/Source picker/durable quick-capture wiring.
9. Push/Cron/Task still need real browser/provider/runtime smoke.
10. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are replaced.

## Exact next run plan

1. If an executable checkout becomes available, stop feature expansion and run/fix first:
   - API typecheck;
   - Web/Admin typecheck;
   - Apple/Google/auth + AI capture/entitlement/provider-cost focused tests;
   - Task/Push/Notification focused tests;
   - API Worker dry-run build;
   - Web/Admin production builds;
   - regenerate canonical Drizzle baseline and rebuild a disposable DB;
   - PostgreSQL exact-Grant/provider-cost concurrency smoke;
   - Dev Google/Apple login + AI text runtime smoke.
2. If executable checkout remains unavailable, continue the next bounded product batch:
   - implement provider-neutral AI Pro subscription activation/renewal/cancellation state transitions + idempotent SYSTEM notification callers while keeping checkout disabled;
   - keep payment-provider transport isolated until a real provider/config is selected and runtime verified;
   - optionally add unauthenticated auth-provider availability so Apple is hidden when its optional credentials are absent.
3. Then complete target AI voice/image/file and natural-language search / related / summary / rewrite on the same entitlement/accounting boundary.
4. Continue Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page title/URL -> selected text -> quick voice -> screenshot/image AI.
5. Regenerate canonical baseline, rebuild disposable Dev/Prod as appropriate, run runtime E2E, then remove/isolate remaining retired LINE-era code.

## Current estimated remaining development time

Approximately **8–20 focused development hours** remain.

Rough remaining allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **4–8h**;
- Apple/Google real OAuth smoke + provider-availability polish: **0.5–1.5h**;
- payment/AI Pro lifecycle + idempotent SYSTEM callers: **1.5–3h**;
- target AI voice/image/file + search/related/summary/rewrite: **2–5h**;
- Chrome extension real auth/capture integration: **1.5–4h**;
- final Push/Cron/PWA/browser/runtime smoke + retired legacy cleanup: **1–3h**.

The ranges overlap. The largest uncertainty remains the first real compile/test pass, PostgreSQL clean baseline rebuild, real Google/Apple OAuth configuration, provider/browser smoke and full Dev runtime E2E. After the first executable validation pass, this estimate should narrow substantially.
