# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 V1 FUNCTIONAL SCOPE 100% SOURCE-AUTHORED; validation/runtime remains separate

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support channel.

**User completion rule for this checkpoint:** compile/tests/runtime/deployment are explicitly not counted toward “functional completion”. Under that rule, the accepted V1 functional scope is now **100% source-authored**.

This does **not** mean PASS/RUNTIME VERIFIED. Executable validation, canonical DB baseline regeneration, Dev/Prod rebuild and real provider/browser smoke remain pending and are tracked separately below.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds remain explicitly allowed while no real durable production data exists. This permission expires once real customers/durable production data exist.

## Commercial/product contract in force

- V1 has exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No one-time AI top-up and no extra paid tier.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are internal AI points, not TWD; they do not refresh monthly and issued grants are never resized retroactively.
- AI entitlement belongs to the requesting AFTERTRACE account; GROUP membership only authorizes Source data.
- AI Pro retains monthly resource/point cap, provider-cost hard cap, optional per-request cap and operator capability toggles.
- Every provider-backed request must pass Source authorization + unified entitlement + reservation/provider-cost hold before provider execution, then settle actual provider usage/cost.
- There is no target GROUP AI funding-owner/responsible-user concept.
- V1 payment provider is NewebPay / 藍新信用卡定期定額.

## V1 functional scope — source-authored complete

### Account / identity / support

- Google / LINE / Apple provider-neutral login flows;
- immutable opaque `public_account_id` and Web/PWA display/copy;
- Admin provider-neutral account lookup by exact 帳號 ID;
- no auto-merge by provider email;
- in-product `意見回饋` plus official LINE OA `聯絡客服`;
- Admin feedback workflow with categories `BUG | FEATURE | UX | OTHER` and statuses `OPEN | IN_PROGRESS | RESOLVED | IGNORED`, including Admin audit.

### FREE manual product

- manual Record create/edit/delete/restore;
- nullable `occurred_at`, durable version/revision history;
- deterministic keyword/date search;
- native AFTERTRACE groups + invite/join;
- provider-free browser/device speech-to-text where supported;
- native Tasks/reminders;
- notification center and PWA/Web Push support.

### Notification system

- exactly `ANNOUNCEMENT | SYSTEM | TASK` categories;
- durable `IN_APP` + optional `PUSH` channels;
- Admin announcement audience/scheduling/preview/cancel/status;
- deterministic SYSTEM notification helpers;
- one shared ~5 minute Cloudflare Worker scheduler for announcements/tasks/push;
- idempotent task reminder and push delivery boundaries.

### FREE AI trial / AI Pro accounting

- Admin `FREE 初始 AI 試用點數` / `free_initial_ai_trial_points`;
- idempotent one-time FREE trial issuance;
- unified per-user `AiEntitlementService`;
- exact selected Grant admission;
- `EntitledAiPointLedgerService` reservation/settlement;
- monthly AI resource cap, provider-cost hard cap, optional per-request cap;
- atomic concurrent provider-cost reservation hold;
- deterministic AI-limit SYSTEM notification;
- fixed AI Pro price NT$99/month and capability controls.

### Provider-backed AI features

- natural-language text capture + AI title/search terms/date/bounded metadata;
- image capture;
- AI audio interpretation;
- supported file/PDF/document interpretation;
- natural-language search interpretation + deterministic PostgreSQL retrieval;
- Related Records deterministic ranking;
- bounded time-range summary;
- explicit proposal-only AI rewrite + user-confirmed optimistic Record update;
- AI Task proposal: provider-backed structured proposal only, never silent Task creation;
- user can edit AI Task title/body/due/remind fields before explicit confirmation creates the durable Task;
- AI Task capability is independently controllable from Admin.

### Record-level AI UX

Main Worklog Record cards now expose direct actions for active Records:

- `找相關` -> bounded `/ai-tools?sourceId=&recordId=&tool=related`;
- `AI 改寫` -> bounded `/ai-tools?sourceId=&recordId=&tool=rewrite`;
- `AI 待辦` -> bounded `/ai-task?sourceId=&recordId=`.

The URL is only navigation state. AI-tools / AI-task pages accept prefill only when the requested Source is present in the authenticated user's authorized surfaces; backend authorization remains authoritative.

Main Worklog unauthenticated state now uses the shared Google/LINE/Apple provider chooser rather than a LINE-only login button.

### Chrome Extension V1

- bounded explicit Web -> Extension session handoff;
- Source/group picker;
- quick text;
- selected text context-menu flow;
- browser speech-to-text;
- optional bounded page title/URL durable `capture_context`;
- explicit visible-tab screenshot/image AI path;
- same account/Source/Record/AI entitlement/accounting as Web/PWA;
- no silent full-page/history/clipboard/screen/mic collection.

### NewebPay / 藍新 subscription transport

Provider-neutral subscription lifecycle remains the core domain. NewebPay is the selected V1 transport adapter.

Source-authored flow:

1. customer enters payment Email on `/subscription` and requests AI Pro NT$99/month;
2. API creates a bounded NewebPay periodic-payment checkout intent;
3. browser posts `MerchantID_` + encrypted `PostData_` directly to NewebPay hosted checkout;
4. AFTERTRACE never receives/stores raw card number/CVV;
5. successful first NewebPay periodic callback -> normalized `ACTIVATE`;
6. later successful periodic callback -> `RENEW`;
7. callback/provider event retries remain idempotent;
8. stale/out-of-order lifecycle events cannot rewind a newer billing period;
9. failed recurring payment does not erase an already-paid current period;
10. customer `取消 AI Pro 自動續訂` calls NewebPay periodic `AlterStatus terminate`, then normalized `CANCEL` preserves paid access through current `periodEnd`;
11. subscription activation/renew/cancel emits idempotent SYSTEM notifications.

NewebPay config is optional all-or-none in manual deployment. Missing MerchantID/HashKey/HashIV/NotifyURL/ReturnURL disables paid checkout only; FREE/manual functionality remains available. Real credentials are intentionally not committed.

Legacy generic `POST /api/v1/subscription/checkout-intents` remains disabled and is not the accepted NewebPay checkout path.

### Admin V1 target surface

Admin `/` is now target-first and routes only accepted V1 operator surfaces:

- `/accounts` — provider-neutral 帳號 ID/support lookup;
- `/commercial` — FREE trial + AI Pro config/capabilities;
- `/announcements` — announcement management;
- `/feedback-management` — feedback classification/status workflow;
- `/pricing-calculator`;
- `/profitability`.

The legacy monolithic `App.tsx` is no longer mounted by the Admin router. LINE GROUP funding-owner, AI 額度負責人, ONE_TIME/TOP_UP and other migration-era Admin product concepts therefore have no V1 navigation/product entry. Legacy source may remain temporarily until executable dependency cleanup.

## Main files added/changed in the functional-completion batch

### API / AI Task

- `apps/api/src/worklog/ai-task-proposal.ts`;
- `apps/api/src/worklog/drizzle-ai-task-proposal.ts`;
- `apps/api/src/worklog/gemini-task-proposal.ts`;
- `apps/api/src/worklog/ai-task-proposal-routes.ts`;
- `apps/api/src/worklog/commercial-config.ts`;
- `apps/api/src/worklog/drizzle-commercial-config.ts`;
- `apps/api/src/admin/commercial-config-routes.ts`.

### API / Feedback management

- `apps/api/src/db/schema-worklog-feedback-management.ts`;
- `apps/api/src/admin/feedback-management-routes.ts`;
- `apps/api/src/db/schema-all.ts`.

### API / NewebPay

- `apps/api/src/db/schema-worklog-newebpay.ts`;
- `apps/api/src/payments/newebpay-periodic.ts`;
- `apps/api/src/payments/newebpay-routes.ts`;
- `apps/api/src/worker.ts`;
- `.env.example`;
- `scripts/deploy-workers.mjs`.

### Web/PWA

- `apps/web/src/AiTaskRoot.tsx`;
- `apps/web/src/ai-task-deep-link.ts`;
- `apps/web/src/main.tsx`;
- `apps/web/src/login-return.ts`;
- `apps/web/src/SubscriptionRoot.tsx`;
- `apps/web/src/WorklogRoot.tsx`.

### Admin

- `apps/admin/src/AdminFeedbackPage.tsx`;
- `apps/admin/src/AdminAccountsPage.tsx`;
- `apps/admin/src/AdminHomePage.tsx`;
- `apps/admin/src/AdminCommercialPage.tsx`;
- `apps/admin/src/commercial-api.ts`;
- `apps/admin/src/main.tsx`.

### Docs

- `docs/WORKLOG_SUBSCRIPTION_POLICY.md`;
- `docs/WORKLOG_DEPLOYMENT.md`;
- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Relevant development commits since legacy funding retirement

All successful development commits contain `[skip ci]`. The functional batch is 38 commits ahead of `78cfb1db` before this checkpoint commit. Key commits include:

- `7b028f12` — AI Task proposal domain;
- `28a33e13` — Gemini AI Task structured proposer;
- `6cb18464` — AI Task PostgreSQL repository;
- `adfd404f` — authenticated AI Task proposal route;
- `39b10afc` / `65ceed99` — Feedback management schema/export;
- `47a3e557` — Admin Feedback management API;
- `18368722` — customer AI Task proposal UI;
- `f88313cf` / `69d3f482` — `/ai-task` login-return/router;
- `d230a562` / `ce672404` — Feedback Admin UI/router;
- `e396de1a` / `36d3f8e2` — NewebPay adapter schema/export;
- `85d0495c` — NewebPay periodic crypto/transport helper;
- `1cb0ac3d` — NewebPay checkout/notify/cancel routes;
- `95ec9c04` — mount NewebPay/AI Task/Feedback APIs;
- `169945cc` — customer NewebPay subscription UX;
- `ceed9d5e` / `a7d7cd28` — NewebPay environment/manual-deploy wiring;
- `7a628f41` / `b5d5fdb9` / `d423ec73` / `2ac7adfa` / `4f115ce7` — AI Task Admin capability/config wiring;
- `89779b42` / `489f1970` — bounded AI Task Record deep links/prefill;
- `7e3b0d23` — Record-card Related/Rewrite/AI Task actions + provider-neutral Worklog login;
- `3fb43fd2` / `6068a1e7` / `14d5964e` / `e6d3622c` — target-first Admin root and legacy Admin router retirement;
- `f494a758` / `1ce37179` / `b3179445` — provider-neutral Admin account lookup;
- `bc6ef5d7` — record NewebPay subscription policy;
- `d73548af` — record NewebPay deployment bindings;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status — explicitly separate from functional completion

### SOURCE-AUTHORED / NOT RUN

The following are source-authored but still **NOT RUN** in an executable checkout/runtime:

- API/Web/Admin TypeScript compilation;
- focused and full Vitest suites including AI Task, Feedback management and NewebPay;
- Cloudflare Worker build;
- Web/Admin production builds;
- PostgreSQL clean target-schema rebuild;
- NewebPay schema/checkout/callback/cancel SQL/runtime flow;
- subscription duplicate/out-of-order/concurrency flow;
- exact-Grant/provider-cost concurrency;
- Related Records SQL/ranking;
- Google/LINE/Apple real OAuth;
- Gemini text/image/audio/file/search/summary/rewrite/task-proposal real calls;
- Chrome unpacked-extension smoke;
- Push/Cron browser/runtime smoke;
- canonical Drizzle baseline regeneration;
- Dev/Prod clean rebuild;
- runtime E2E.

### Executable verification actually attempted this run

- mounted AFTERTRACE checkout discovery under available `/mnt/data` and `/home/oai` — **FAIL**, no `.git` checkout found;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known non-functional blockers / risks

1. Executable checkout remains unavailable; accumulated source has not been compiled/executed.
2. Canonical `drizzle/0000` is behind target schema and must include Feedback management + NewebPay plus prior identity/group/notification/task/AI/lifecycle schemas.
3. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL have not been supplied; runtime paid checkout therefore cannot be configured yet. This is environment configuration, not a source feature gap.
4. NewebPay periodic callback/AlterStatus assumptions must be verified against the merchant account's enabled periodic-payment product during runtime smoke.
5. Real PostgreSQL lifecycle/provider-cost concurrency behavior is not verified.
6. OAuth/Gemini/Chrome/Push/Cron still need real runtime/browser/provider validation.
7. Legacy LINE/ONE_TIME/GROUP-funding schemas/services and `App.tsx` still exist in source as migration residue; they have no current target product navigation and should be physically removed only after executable dependency validation.
8. `confirmation-routes.ts` still contains a legacy LINE-session resolution path; current accepted customer surfaces do not depend on it visibly, but physical retirement/migration should wait for executable reference validation.
9. Worker still initializes some legacy LINE attachment/normalization runtime for generic old `/api/v1/worklog/*` fallback routes. Target APIs are mounted before this boundary; final physical isolation belongs to post-validation cleanup.

## Exact next run plan

There is **no remaining V1 feature-development batch** under the current accepted scope.

When an executable checkout becomes available:

1. stop feature expansion;
2. API/Web/Admin typecheck and fix compile errors;
3. focused + full package tests;
4. Worker/Web/Admin builds;
5. regenerate canonical `drizzle/0000` and clean rebuild a disposable PostgreSQL DB;
6. execute subscription lifecycle + NewebPay callback/cancel + provider-cost concurrency SQL/runtime smoke;
7. real OAuth + Gemini + Chrome Extension + Push/Cron Dev smoke;
8. only after target dependency proof, physically remove remaining retired LINE/ONE_TIME/GROUP-funding/confirmation migration residue;
9. configure NewebPay Dev/Prod credentials supplied by operator and run payment sandbox/production-readiness smoke.

## Remaining estimate

### Functional scope

**0 focused development hours remain** for the currently accepted V1 feature set. Functional completion is 100% source-authored under the user's stated definition that testing/runtime validation is not part of the completion standard.

### Validation / release-readiness work (not counted as feature completion)

Approximately **2–5.5 focused hours** remain, dominated by the first real compile + canonical PostgreSQL rebuild + integration fixes, plus real provider/browser smoke.

This range may move after the first executable pass; no PASS is inferred from source inspection.
