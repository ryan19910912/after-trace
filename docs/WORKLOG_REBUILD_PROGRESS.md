# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 FREE one-time AI trial commercial config + provider-neutral onboarding issuance source-authored; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are explicitly allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE AFTERTRACE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- Trial points are not a TWD balance, are not hard-coded, do not refresh monthly, and do not retroactively resize already-issued trials.
- Trial/AI_PRO provider calls must use auditable reservation/settlement/provider-cost accounting where it cleanly fits.
- AI Pro keeps internal monthly point/resource caps plus operator-configured provider-cost hard cap.

## Accepted foundation from prior checkpoints

- Provider-neutral identity model for Google / LINE / Apple, immutable opaque `public_account_id`, Admin exact lookup and authenticated account chrome.
- Native AFTERTRACE GROUP membership/invites independent from LINE group membership.
- Free manual Record CRUD/search with nullable `occurred_at` and content-only create.
- Capture-first PWA/browser speech path without AFTERTRACE provider AI.
- Notification categories exactly `ANNOUNCEMENT | SYSTEM | TASK`, independent `IN_APP | PUSH` channels, durable notification center/read state.
- Admin ANNOUNCEMENT backend/frontend, scheduled dispatch, Web Push subscriptions/preferences/encrypted transport/retry state.
- One shared `*/5 * * * *` Worker scheduler for due ANNOUNCEMENT -> due TASK -> pending PUSH.
- Native Task target schema/service/repository/API + Web/PWA Task surface.
- Chrome extension scaffold remains committed to shared account/Source/Record/AI entitlement model.

## This run — FREE AI trial + SYSTEM event foundation

This run continued the exact next planned backend batch and did not redo a broad static audit.

### Dedicated commercial config for FREE AI trial

New `apps/api/src/db/schema-worklog-commercial.ts` adds singleton operator configuration:

- `free_initial_ai_trial_points`;
- positive integer only;
- `updated_by`, created/updated timestamps;
- explicitly not a customer TWD balance.

The schema is exported from `schema-all.ts`.

The trial quantity is no longer read from legacy FREE plan `grant_points`. `WorklogAiGrantService` now reads the dedicated commercial config and snapshots that quantity into the user's immutable/idempotent `FREE_INITIAL` grant. Later Admin config edits do not resize existing grants.

### Admin commercial config API

New commercial config service/repository and Admin routes provide:

- `GET /api/v1/admin/commercial-config/free-ai-trial`;
- `PUT /api/v1/admin/commercial-config/free-ai-trial`;
- Admin auth/origin enforcement;
- positive point validation;
- audit row `FREE_AI_TRIAL_CONFIG_UPDATED`;
- operational summary: recipients, exhausted recipients, issued points, remaining points, consumed points.

This is point-based only. No TWD trial price/value is introduced.

### Provider-neutral account onboarding issues the trial idempotently

New `auth/account-onboarding.ts` is the shared post-provider-login onboarding boundary.

It:

1. ensures workspace/private Source;
2. attempts the one-time FREE trial grant using owner + durable origin key uniqueness;
3. ensures PRIVATE grant scope;
4. emits an idempotent SYSTEM notification `free-ai-trial-issued:v1`;
5. returns `CONFIG_PENDING` rather than blocking login/manual FREE product when operator trial config has not yet been initialized.

Current LINE Login callback now uses this shared onboarding helper. Future Google/Apple callbacks should call the same helper after provider-neutral account provisioning, avoiding provider-specific trial logic.

### Deterministic SYSTEM event helpers

New `worklog/system-notification-events.ts` source-authors stable event helpers for:

- FREE trial issued — currently wired by account onboarding;
- AI Pro activated;
- AI Pro renewed;
- AI Pro cancelled;
- AI usage-limit reached.

All use deterministic event keys intended for the existing Notification Service idempotency boundary. Arbitrary Admin text remains ANNOUNCEMENT, not SYSTEM.

Actual payment/renewal/cancellation and AI-limit call sites are still pending because those runtime lifecycle paths are not yet complete.

### Existing grant tests aligned

`ai-grants.test.ts` now targets the dedicated commercial trial config instead of legacy FREE plan grant points. New `commercial-config.test.ts` covers positive point validation and explicitly asserts that the config surface does not expose TWD trial pricing.

## Files changed this run

- `apps/api/src/db/schema-worklog-commercial.ts` — dedicated FREE trial config schema;
- `apps/api/src/db/schema-all.ts` — target schema export;
- `apps/api/src/worklog/ai-grants.ts` — FREE trial config contract;
- `apps/api/src/worklog/drizzle-ai-grants.ts` — reads singleton commercial config;
- `apps/api/src/worklog/commercial-config.ts` — operator config service;
- `apps/api/src/worklog/drizzle-commercial-config.ts` — config persistence/audit/stats;
- `apps/api/src/admin/commercial-config-routes.ts` — Admin config API;
- `apps/api/src/worker.ts` — Admin commercial-config route mounting;
- `apps/api/src/worklog/system-notification-events.ts` — deterministic SYSTEM event helpers;
- `apps/api/src/auth/account-onboarding.ts` — provider-neutral post-login onboarding;
- `apps/api/src/auth/routes.ts` — LINE Login uses shared onboarding;
- `apps/api/src/worklog/ai-grants.test.ts` — trial config contract tests updated;
- `apps/api/src/worklog/commercial-config.test.ts` — config tests authored;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `e703da3e` add FREE AI trial commercial config schema;
- `8b9b338a` export commercial trial config schema;
- `b9ec9e02` source FREE trial points from commercial config;
- `ff22d4c0` read FREE trial points from commercial config;
- `ac6f2182` add commercial FREE trial config service;
- `798bf9d0` persist FREE trial commercial config;
- `f7cb14dc` add Admin FREE trial config API;
- `c73c8bc5` mount Admin FREE trial config routes;
- `dab68655` require positive FREE trial points;
- `20d8de06` reject zero-point FREE trial config;
- `8ac569b3` add deterministic SYSTEM notification event helpers;
- `b986608b` add provider-neutral account onboarding;
- `f97adbfe` issue FREE AI trial during provider onboarding;
- `b7ae70b9` align FREE trial grant tests with commercial config;
- `90c26467` author FREE trial commercial config tests;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/ai-grants.test.ts` — **AUTHORED/UPDATED / NOT RUN**;
- `apps/api/src/worklog/commercial-config.test.ts` — **AUTHORED / NOT RUN**;
- commercial config schema/repository/Admin API — **AUTHORED / NOT RUN**;
- provider-neutral account onboarding + FREE trial issuance — **AUTHORED / NOT RUN**;
- FREE trial SYSTEM notification caller — **AUTHORED / NOT RUN**;
- subscription/renewal/cancel/AI-limit SYSTEM helper contracts — **AUTHORED / NOT RUN**.

### Executable verification actually attempted

- executable AFTERTRACE checkout discovery — **FAIL**; no mounted checkout was found;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- FREE trial/config focused Vitest — **NOT RUN**;
- existing Task/Push/Notification focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Admin/Web typecheck/tests/build — **NOT RUN**;
- PostgreSQL FREE trial concurrent-login/idempotency smoke — **NOT RUN**;
- PostgreSQL config-change-does-not-resize-existing-grant smoke — **NOT RUN**;
- actual SYSTEM notification retry/idempotency smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so the new schema/TypeScript/SQL has not compiled/executed.
2. Canonical `drizzle/0000` is behind current target schema, now also including `worklog_commercial_config`.
3. Admin UI does not yet expose the FREE trial config; backend API exists.
4. Existing Admin plan UI/schema still contains legacy `grant_points` / `ONE_TIME` concepts and should be cleaned in the target baseline so V1 visibly exposes only FREE + AI_PRO.
5. FREE trial is currently scoped to the user's PRIVATE Source at onboarding. Target per-user AI entitlement must add authorized GROUP Source use without reviving GROUP responsible-user/funding complexity.
6. Provider-backed AI admission still needs a unified target entitlement check: eligible FREE trial OR active AI_PRO, then request/period/provider-cost caps.
7. Payment/renewal/cancellation and AI-limit runtime call sites still need to invoke the authored deterministic SYSTEM helpers.
8. Google Login and Apple Login callbacks remain incomplete; future callbacks must use the same provider-neutral onboarding helper and never merge by email.
9. Real Web Push/Cron/Task runtime and browser/provider validation remain pending.
10. Chrome extension real auth handoff/Source picker/durable Record persistence remains incomplete.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix first:
   - API typecheck;
   - FREE trial/config focused tests;
   - existing Task/Push/Notification focused tests;
   - API Worker dry-run build;
   - Admin/Web typecheck/tests/build;
   - PostgreSQL clean target-schema trial/idempotency smoke.
2. If executable checkout remains unavailable, continue the next bounded product batch:
   - add Admin UI for `FREE 初始 AI 試用點數` and trial operating stats;
   - remove one-time purchase/top-up exposure from current V1 Admin/customer plan surfaces;
   - build one target AI entitlement service that resolves `FREE_TRIAL | AI_PRO | BLOCKED` per requesting user and authorized Source;
   - allow FREE trial/AI_PRO per-user entitlement on authorized GROUP Sources without GROUP funding/responsibility concepts;
   - wire actual SYSTEM callers at subscription-period assignment and future payment/AI-limit state transitions.
3. Complete Google Login first, keep LINE Login, add Apple next; all callbacks use provider-neutral provisioning + shared onboarding.
4. Complete AI Pro monthly point/resource cap + provider-cost hard-cap admission/settlement and customer fair-use state.
5. Continue Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page context -> selected text -> quick voice -> screenshot/image AI entitlement -> permission/privacy/browser smoke/package.
6. Regenerate canonical baseline, rebuild disposable Dev/Prod, run runtime E2E, then remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **23–46 focused development hours** remain.

Rough remaining allocation:

- executable validation + canonical baseline/DB rebuild fixes: **4–9h**;
- Admin FREE-trial UI + V1 plan cleanup: **2–4h**;
- unified FREE_TRIAL / AI_PRO entitlement + GROUP authorization + hard caps: **5–9h**;
- Google + Apple login completion and auth smoke: **3–6h**;
- paid AI capture/search/enrichment/summary/rewrite gaps: **4–8h**;
- Chrome extension real auth/capture integration: **3–6h**;
- final Dev runtime/Web Push/Cron/PWA smoke + legacy cleanup: **2–4h**.

Largest uncertainty remains the first real API/Web/Admin compile/test pass, PostgreSQL target-schema rebuild, Web Push provider/browser smoke, and Dev runtime E2E. Narrow this estimate again after those execute.
