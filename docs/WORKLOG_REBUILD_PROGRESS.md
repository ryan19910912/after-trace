# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 PWA explicit AI text capture UI + provider-neutral Google Login backend source-authored; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership authorizes data only.
- AI Pro has monthly resource/point cap, provider-cost hard cap and optional per-request cap.
- Every provider-backed request must pass unified entitlement before low-level reservation/settlement.

## Accepted foundation from prior checkpoints

Do not redo these batches:

- provider-neutral account/identity schema for Google / LINE / Apple with immutable `public_account_id`;
- native GROUP membership/invites;
- free manual Record CRUD/search + nullable `occurred_at`;
- capture-first PWA browser speech-to-text path;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + Push + shared five-minute scheduler;
- native Task backend/Web UI;
- FREE one-time AI trial config/onboarding;
- Admin `/commercial` and V1-only FREE + AI_PRO subscription surface;
- unified `AiEntitlementService`, exact selected-Grant admission and `EntitledAiPointLedgerService`;
- target provider-backed AI text capture backend `POST /api/v1/ai/capture/text`;
- AI hard-limit SYSTEM notification caller;
- Chrome extension scaffold.

## This run — PWA AI text surface + Google Login backend

### Web/PWA explicit AI text capture UI

New `apps/web/src/ai-capture-api.ts` provides the customer client for:

- `GET /api/v1/ai/entitlement?sourceId=...`;
- `POST /api/v1/ai/capture/text`.

`CaptureRoot.tsx` now has two explicit modes:

- `一般紀錄` — existing free/manual provider-free behavior;
- `AI 整理紀錄` — explicit provider-backed action using FREE trial or AI Pro.

The AI mode:

- keeps the current PRIVATE/GROUP Source picker;
- displays FREE_TRIAL / AI_PRO / blocked status;
- does not show provider cost/margin;
- provides upgrade CTA when blocked;
- keeps browser speech-to-text provider-free until the user explicitly presses `AI 整理並記錄`;
- does not expose manual occurred-at input in AI mode; AI may resolve a date only when grounded in the text;
- refreshes entitlement after successful/blocked provider work.

Customer blocked reasons map to friendly messages for exhausted trial, monthly point/resource limit, provider-cost safety limit, per-request limit, incomplete cost accounting and unauthorized Source. FREE manual capture remains available regardless of AI state.

New `apps/web/src/ai-capture-api.test.ts` covers entitlement mapping, target AI capture persistence endpoint, bearer auth and hard-cap error propagation. `capture.css` now styles the mode switch and entitlement state responsively.

### Google Login backend

`oauth-state.ts` now has a provider-aware signed OAuth state primitive with wrappers for LINE and Google. Provider state types cannot be substituted for one another.

`createWebAuthRoutes()` now source-authors:

- `GET /api/v1/auth/google/start`;
- `GET /api/v1/auth/google/callback`.

The Google flow uses:

- OAuth authorization code + PKCE;
- provider-specific HttpOnly SameSite=Lax state/verifier cookie;
- Google token endpoint;
- OpenID Connect userinfo endpoint;
- `provider='GOOGLE'` + immutable Google `sub` as the provider identity binding;
- optional email/name only as snapshots;
- no silent merge by email;
- the existing provider-neutral `AccountIdentityService`;
- the same `ensureAccountOnboarding()` used by LINE, including idempotent FREE trial issuance;
- durable Web session containing AFTERTRACE `userId`, not Google email/id as core account identity.

New `google-login.test.ts` source-authors Google start/PKCE/cookie/config-fail-closed coverage. Callback/provider/database runtime still needs executable integration testing.

### Manual deployment configuration

`.env.example` now documents:

- `GOOGLE_LOGIN_CLIENT_ID`;
- `GOOGLE_LOGIN_CLIENT_SECRET`.

`scripts/deploy-workers.mjs` now requires and uploads those two API runtime secrets during the existing manual deploy flow. No deployment was performed in this run.

## Files changed this run

- `apps/web/src/ai-capture-api.ts`;
- `apps/web/src/ai-capture-api.test.ts`;
- `apps/web/src/CaptureRoot.tsx`;
- `apps/web/src/capture.css`;
- `apps/api/src/auth/oauth-state.ts`;
- `apps/api/src/auth/routes.ts`;
- `apps/api/src/auth/google-login.test.ts`;
- `scripts/deploy-workers.mjs`;
- `.env.example`;
- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Commits this run

All successful development commits contain `[skip ci]`:

- `b2f707db` — add Web AI capture API client;
- `2abb583d` — author Web AI capture API tests;
- `ed9388fa` — add AI text mode to PWA capture;
- `27d57479` — style PWA AI capture mode;
- `4469dba3` — harden AI capture response mapping;
- `4a2b22e0` — generalize OAuth state for provider login;
- `7f2f7123` — add provider-neutral Google Login flow;
- `d01b4f47` — author Google Login start contract tests;
- `d8283d96` — deploy Google Login runtime secrets;
- `c5d5e68a` — document Google Login environment bindings;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

- `apps/web/src/ai-capture-api.test.ts` — **AUTHORED / NOT RUN**;
- PWA AI capture mode — **AUTHORED / NOT RUN**;
- Google OAuth state/start tests — **AUTHORED / NOT RUN**;
- Google callback/account onboarding — **AUTHORED / NOT RUN**;
- deploy Google secret selection — **AUTHORED / NOT RUN**;
- API TypeScript typecheck — **NOT RUN**;
- Web TypeScript typecheck — **NOT RUN**;
- API/Web focused/full Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web production build — **NOT RUN**;
- PostgreSQL target-schema/AI capture/Google onboarding smoke — **NOT RUN**;
- Google real OAuth callback smoke — **NOT RUN**;
- Gemini real provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

Executable verification actually attempted this run:

- mounted AFTERTRACE checkout discovery — **FAIL**; no checkout found;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so current TypeScript/React/SQL has not compiled or executed.
2. Canonical `drizzle/0000` is still behind the current target schema.
3. PWA AI capture needs browser/mobile smoke, especially mode switching, entitlement refresh and blocked/upgrade UX.
4. Google Login backend is source-authored, but customer login buttons outside the existing LINE-first screens still need to expose Google consistently across Web/PWA.
5. Google OAuth callback needs real Dev credentials/redirect URI smoke before it can be called runtime verified.
6. Apple Login remains pending.
7. AI Pro provider-cost hard cap still needs an in-flight/concurrent cost hold before paid launch.
8. Payment lifecycle remains disabled (`CHECKOUT_ENABLED=false`).
9. Target AI voice/image/file, natural-language search, related Records, summary and rewrite remain pending.
10. Chrome extension still needs real auth handoff/Source picker/durable capture wiring.
11. Push/Cron/Task still need real browser/provider/runtime smoke.
12. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are replaced.

## Exact next run plan

1. If executable checkout becomes available, stop expanding features and run/fix API + Web + Admin typecheck/tests/build, then regenerate canonical baseline and perform PostgreSQL/Dev smoke.
2. Otherwise:
   - expose Google + LINE login buttons consistently across unauthenticated Web/PWA surfaces;
   - close the concurrent provider-cost hard-cap race with a bounded in-flight cost hold;
   - add Apple Login using the same provider-neutral provisioning/onboarding boundary.
3. Then implement payment/AI Pro activation-renewal-cancellation lifecycle and deterministic SYSTEM callers; keep checkout disabled until verified.
4. Complete target AI voice/image/file and retrieval features on the same entitlement/accounting boundary.
5. Wire Chrome extension real auth + Source + quick text first, then page context/selected text/voice/image.
6. Rebuild canonical baseline/Dev, run runtime E2E, then remove/isolate remaining retired LINE-era code.

## Current estimated remaining development time

Approximately **11–26 focused development hours** remain.

Rough allocation:

- executable validation + canonical baseline/DB rebuild fixes: **4–8h**;
- login UI consistency + Apple Login/auth smoke: **1.5–3h**;
- provider-cost concurrent hard-cap hold: **1–3h**;
- payment/AI Pro lifecycle + SYSTEM callers: **1.5–3h**;
- AI voice/image/file + search/related/summary/rewrite remaining V1 scope: **2–5h**;
- Chrome extension real auth/capture integration: **1.5–4h**;
- final Push/Cron/PWA/browser/runtime smoke + legacy cleanup: **1–3h**.

Largest uncertainty remains the first real compile/test pass, PostgreSQL clean baseline rebuild, OAuth/provider smoke and full Dev runtime E2E.
