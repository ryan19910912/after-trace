# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Account Identity, Support, Notification, Extension and Subscription policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 provider-neutral login surfaces + canonical Apple Login + atomic AI Pro provider-cost hold source-authored; executable/runtime verification pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real customer/durable production data exists. This permission expires once real durable production data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no extra paid tiers.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are not TWD, do not refresh monthly and do not retroactively resize issued grants.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership authorizes data only.
- AI Pro retains monthly resource/point cap, provider-cost hard cap and optional per-request cap.
- Every provider-backed request must pass unified entitlement before low-level reservation/settlement.

## Accepted target foundation — do not redo

- provider-neutral account identities for Google / LINE / Apple;
- immutable opaque `public_account_id`, Web/PWA display+copy and Admin exact lookup;
- native AFTERTRACE groups/invites independent from LINE GROUP membership;
- free manual Record CRUD/search, nullable `occurred_at`, provider-free browser speech-to-text;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH;
- Admin announcements, Web Push subscriptions/preferences/delivery, one shared ~5 minute scheduler;
- native Task backend + Web/PWA task surface;
- dedicated FREE trial config + provider-neutral onboarding issuance;
- Admin `/commercial`, V1-only customer FREE + AI_PRO subscription surface;
- unified `AiEntitlementService`, exact selected Grant admission and `EntitledAiPointLedgerService`;
- target provider-backed AI text capture backend + PWA `一般紀錄` / `AI 整理紀錄` UI;
- deterministic AI-limit SYSTEM notification caller;
- Chrome extension scaffold.

## This checkpoint — login/auth work

### Google + LINE customer login chooser

Web/PWA now has a provider-neutral `/login` surface and shared `LoginProviderButtons`.

Customer surfaces converge on Google / LINE rather than silently preferring LINE:

- main Worklog compatibility login entry resolves to `/login`;
- `/capture` uses the shared provider buttons;
- `/subscription` uses the shared provider buttons;
- `/feedback` uses the shared provider buttons;
- `/tasks` already returns through `/login`;
- provider callbacks still issue the same durable AFTERTRACE Web session.

Copy explicitly states that provider accounts only authenticate the user and do not become the AFTERTRACE customer account id. No email-based automatic merge was introduced.

### Canonical Apple Login foundation

The branch already contained an integrated Apple flow inside `createWebAuthRoutes()`. During this run a second standalone Apple route implementation was briefly authored, detected as duplicate, then deleted. The final tree intentionally has **one canonical Apple flow only**: the integrated `createWebAuthRoutes()` implementation.

Canonical Apple flow:

- `GET /api/v1/auth/apple/start`;
- `POST /api/v1/auth/apple/callback`;
- complete optional Apple Services ID / Team ID / Key ID / `.p8` secret required before enablement;
- HTTPS callback required;
- provider-tagged signed state + nonce;
- `response_mode=form_post` with `name email` request;
- short-lived HttpOnly `SameSite=None; Secure` state/nonce cookie for Apple's cross-site POST;
- Apple callback is the only provider callback allowed past normal Web Origin rejection for the provider-origin POST; signed state + cookie + nonce remain the security boundary;
- authorization code exchange uses a short-lived developer client secret;
- Apple `sub` is the provider identity;
- optional name/email are bounded snapshots only;
- provisioning uses `AccountIdentityService` and shared `ensureAccountOnboarding()`;
- no merge by matching email;
- normal AFTERTRACE Web session is issued after successful provisioning.

### Apple JWT algorithm correction

`apple-login.ts` was corrected to keep the two Apple JWT directions distinct:

- AFTERTRACE-generated Apple `client_secret` uses the developer P-256 key with **ES256**;
- Apple-issued OpenID identity token uses **RS256** and is verified against Apple's RSA JWKS from `/auth/keys`.

Identity token checks include issuer, Services ID audience, expiry, bounded issue time, request nonce and immutable `sub`.

A duplicate standalone `apple-routes.ts` and its test were removed after the integrated route was confirmed to be the canonical implementation. `worker.ts` was restored so Apple auth continues through the normal `/api/v1/auth` app routing rather than a competing Worker-level mount.

### Apple deployment configuration

`.env.example` now documents optional:

- `APPLE_LOGIN_CLIENT_ID`;
- `APPLE_LOGIN_TEAM_ID`;
- `APPLE_LOGIN_KEY_ID`;
- `APPLE_LOGIN_PRIVATE_KEY_P8_BASE64`.

`scripts/deploy-workers.mjs` treats Apple as optional all-or-none configuration. Google + LINE remain required first-priority providers. If any Apple field is present, all four must be present; otherwise deployment fails before upload. If none are present, deployment may continue and Apple endpoints fail closed as not configured.

No deploy occurred in this run.

### Apple tests

Current source contains Apple tests for:

- ES256 client-secret shape/claims;
- RS256 identity-token verification against generated RSA JWK;
- nonce/algorithm rejection;
- authorization start contract;
- form_post / state / nonce / cookie behavior;
- incomplete config fail-closed;
- HTTPS callback requirement;
- provider-origin Apple callback reaching signed callback validation.

Tests are authored only; they were not executed.

## AI Pro concurrent provider-cost hold incorporated into checkpoint

The branch advanced between earlier progress checkpoints with an important paid-AI hardening batch. It was inspected and preserved rather than reimplemented.

Target schema now contains:

- `worklog_ai_grants.provider_cost_committed_twd`;
- `worklog_ai_grants.provider_cost_reserved_twd`;
- `worklog_ai_point_reservations.entitlement_grant_id`;
- `worklog_ai_point_reservations.provider_cost_hold_twd`.

Provider admission behavior:

1. unified entitlement chooses the exact requesting user's current Grant;
2. AI Pro computes a conservative TWD provider-cost hold from the current pricing/FX snapshot;
3. PostgreSQL locks the selected Grant/Source scope using `FOR UPDATE`;
4. atomic cost guard evaluates committed period cost + existing reserved holds + new hold against `monthly_provider_cost_cap_twd`;
5. missing committed TWD accounting or older in-flight reservations without a cost hold fail closed;
6. reservation increments Grant `provider_cost_reserved_twd` before provider execution;
7. commit moves/reconciles the hold into committed cost;
8. release/expiry returns the hold.

This closes the known source-level race where two concurrent AI Pro requests could both pass a hard-cap check before either provider result was committed. It still requires real PostgreSQL concurrency/runtime verification before paid launch.

`ai-point-ledger.test.ts` and related entitlement tests contain source-authored hold/hard-cap cases — **NOT RUN**.

## Files changed / materially reconciled in this run

- `apps/web/src/LoginProviderButtons.tsx` — shared provider-neutral login buttons;
- `apps/web/src/styles.css` — shared login styling;
- `apps/web/src/CaptureRoot.tsx` — Google/LINE shared login entry;
- `apps/web/src/SubscriptionRoot.tsx` — Google/LINE shared login entry;
- `apps/web/src/FeedbackRoot.tsx` — Google/LINE shared login entry;
- existing `apps/web/src/LoginRoot.tsx`, `main.tsx`, `worklog-api.ts`, Task login return — inspected and preserved;
- `apps/api/src/auth/apple-login.ts` — correct ES256 client-secret vs RS256 Apple id-token boundary;
- existing `apps/api/src/auth/routes.ts` canonical Apple flow — inspected/preserved;
- `apps/api/src/auth/apple-login.test.ts` — Apple crypto tests authored/aligned;
- existing `apps/api/src/auth/apple-login-routes.test.ts` — canonical integrated-route tests preserved;
- `.env.example` — optional Apple secret contract;
- `scripts/deploy-workers.mjs` — optional all-or-none Apple upload;
- `apps/api/src/worker.ts` — duplicate Apple Worker route removed; canonical `/api/v1/auth` route retained;
- duplicate transient `apps/api/src/auth/apple-routes.ts` and `apple-routes.test.ts` — deleted;
- AI grant/reservation schema + ledger files — existing atomic provider-cost hold inspected and incorporated into this checkpoint;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — current handoff.

## Commits directly produced/retained in this development pass

All successful commits contain `[skip ci]`.

Visible commits from this pass include:

- `6789bf76` shared provider-neutral login buttons;
- `a33bdd8e` provider login styling;
- `1af7d881` provider login in Capture;
- `9191cd0e` provider login in Subscription;
- `9565daa7` provider login in Feedback;
- `5953de73` correct Apple identity-token RS256 verification;
- `4f49ac22` document optional Apple Login bindings;
- `9c2934f9` optional all-or-none Apple deploy secrets;
- `05e51b16` Apple crypto contract tests;
- `538340fc` align Apple private-key fixture with env contract;
- `90d10c47` remove duplicate Apple route implementation;
- `7301bdd3` remove duplicate Apple route tests;
- `ca09c892` keep only canonical integrated Apple auth route;
- this checkpoint commit follows.

Transient duplicate-route commits existed briefly but were explicitly cleaned from the final tree. No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation. The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- Google/LINE provider-neutral login chooser;
- Apple client-secret/id-token crypto helpers;
- Apple integrated OAuth callback/provisioning path;
- Apple auth/crypto tests;
- atomic AI Pro provider-cost reservation/hard-cap SQL;
- provider-cost hold unit contracts.

### Executable verification actually attempted

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- auth/Apple/AI-focused Vitest — **NOT RUN**;
- full API/Web/Admin Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- PostgreSQL exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini real provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so the accumulated TypeScript/React/SQL has not compiled/executed.
2. Canonical `drizzle/0000` remains behind the target schema and must be regenerated before clean DB/runtime validation.
3. Atomic provider-cost hold is structurally present in schema + SQL but still needs a real PostgreSQL concurrent-reservation smoke test.
4. Real Google/LINE/Apple OAuth configuration has not been runtime tested. Apple especially requires real Services ID/domain/HTTPS return URL/private key setup.
5. Apple is currently shown as a login choice while Apple deploy config is optional. Before production launch either configure Apple or add a small auth-provider availability endpoint so unavailable providers can be hidden.
6. Payment provider transport/lifecycle remains disabled (`CHECKOUT_ENABLED=false`). Activation/renewal/cancel webhook idempotency and SYSTEM callers still need a final provider-neutral lifecycle boundary once cancellation semantics/payment provider are chosen.
7. Target AI voice/image/file, natural-language search, related Records, time-range summary and explicit rewrite are still pending.
8. Chrome extension scaffold still lacks real Web-session handoff, Source loading and durable quick-text persistence.
9. Push/Cron/Task still need real browser/provider/runtime smoke.
10. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are fully replaced.

## Exact next run plan

1. If executable checkout becomes available, **stop feature expansion** and run/fix:
   - API/Web/Admin typecheck;
   - auth/Apple/AI entitlement/provider-cost focused tests;
   - Task/Push/Notification focused tests;
   - API Worker dry-run build + Web/Admin production builds;
   - regenerate canonical Drizzle baseline and rebuild a disposable DB;
   - real PostgreSQL selected-Grant/provider-cost concurrency smoke;
   - Dev Google/LINE/Apple auth + AI text smoke.
2. If executable checkout remains unavailable:
   - add auth-provider availability so optional Apple can be hidden when unconfigured;
   - then implement Chrome Extension Web-session handoff + Source picker + manual quick-text persistence using the same AFTERTRACE APIs;
   - do not invent extension-only durable Record storage.
3. After that, complete payment-provider-neutral AI Pro lifecycle once cancel-at-period-end semantics/provider choice are explicit.
4. Complete target AI voice/image/file and retrieval/rewrite features on the same entitlement/accounting boundary.
5. Finish extension page context/selected text/voice/screenshot AI, then runtime smoke/package.
6. Regenerate canonical baseline, rebuild disposable Dev/Prod as appropriate, run runtime E2E, then remove/isolate remaining retired LINE-era code.

## Current estimated remaining development time

Approximately **7–18 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **4–8h**;
- auth-provider availability + real Google/LINE/Apple smoke/polish: **0.5–1.5h**;
- payment lifecycle + deterministic SYSTEM callers: **1–3h**;
- target AI voice/image/file + search/related/summary/rewrite: **2–4h**;
- Chrome extension real auth/Source/manual capture + remaining capture features: **1.5–4h**;
- final Push/Cron/PWA/browser/runtime smoke + legacy cleanup: **1–3h**.

Ranges overlap. The largest uncertainty is still the first real compile/test + clean PostgreSQL baseline pass. Once that can run, the remaining estimate should become much tighter.
