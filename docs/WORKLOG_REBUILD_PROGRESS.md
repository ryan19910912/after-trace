# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 V1 functional scope remains 100% source-authored; static validation has isolated customer runtime from additional legacy LINE/funding dependencies; executable validation still blocked

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support channel.

User completion rule remains in force: compile/tests/runtime/deployment are not counted toward functional completion. Under that rule, accepted V1 feature scope remains **100% source-authored**. Validation/release-readiness is tracked separately and is not yet PASS/RUNTIME VERIFIED.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds remain allowed while no real durable production data exists. This permission expires once real customer data exists.

## Commercial/product contract

- V1 exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No one-time AI top-up and no extra paid tier.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial from Admin-configured `free_initial_ai_trial_points`.
- AI entitlement is per requesting account; GROUP only authorizes Source data.
- AI Pro retains monthly point/resource cap, provider-cost hard cap, optional per-request cap and capability toggles.
- V1 payment transport is NewebPay / 藍新信用卡定期定額.
- No target GROUP AI funding-owner/responsible-user concept.

## V1 functional scope — source-authored complete

Current branch source-authors the accepted V1 surface:

- provider-neutral Google / LINE / Apple login;
- immutable public 帳號 ID + Web/PWA copy + Admin exact lookup;
- native PRIVATE/GROUP Sources + invites/membership;
- FREE manual Record CRUD/search/date filters/revisions/delete/restore;
- provider-free browser/device STT;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH;
- Admin announcements + shared ~5 minute scheduler;
- native Tasks/reminders;
- Admin-manageable feedback workflow `BUG | FEATURE | UX | OTHER` and `OPEN | IN_PROGRESS | RESOLVED | IGNORED`;
- FREE one-time AI trial;
- unified per-user AI entitlement + selected Grant admission + reservation/settlement + provider-cost hard cap;
- provider-backed text/image/audio/file/PDF capture;
- natural-language search + PostgreSQL retrieval;
- Related Records;
- bounded time-range summary;
- proposal-only AI rewrite;
- proposal-only AI Task extraction with user confirmation before durable Task creation;
- Record-card direct Related / Rewrite / AI Task actions;
- Chrome Extension V1 quick text / selected text / browser STT / page context / screenshot AI using the same account/Source/Record/entitlement domain;
- NewebPay checkout / periodic notify / renewal / cancel-at-period-end adapter over provider-neutral subscription lifecycle;
- target-first Admin root: `/accounts`, `/commercial`, `/announcements`, `/feedback-management`, `/pricing-calculator`, `/profitability`.

## Executable verification — FAIL / BLOCKED

Actually attempted in the current validation session:

- searched available `/mnt/data` and `/home/oai` for an AFTERTRACE `.git` checkout — **FAIL**, no checkout found;
- `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`.

Therefore the following are still **NOT RUN**:

- API/Web/Admin TypeScript typecheck;
- ESLint;
- focused/full Vitest;
- API Worker dry-run build;
- Web/Admin production build;
- Drizzle schema export;
- clean PostgreSQL rebuild;
- NewebPay sandbox/runtime flow;
- lifecycle/provider-cost concurrency smoke;
- Google/LINE/Apple OAuth smoke;
- Gemini provider smoke;
- Chrome unpacked-extension smoke;
- Push/Cron runtime smoke;
- Dev E2E.

No unexecuted item is claimed PASS.

## Static release-readiness checks — completed

Verified from current branch source:

- root `release:preflight` runs baseline guard -> typecheck -> lint -> tests -> builds -> Drizzle schema export;
- API/Web/Admin validation/build scripts exist;
- `schema-all.ts` exports provider-neutral identity, notifications/tasks, Feedback management and NewebPay adapter schemas;
- Admin/API commercial config shapes both include `aiTaskProposal` capability;
- manual Record routes use `verifyWebSessionToken + resolveWebSessionUserId`, not LINE identity;
- Web session claims support provider-neutral sessions with `userId` and empty migration-only `lineUserId`;
- cancellation-at-period-end keeps the core AI Pro subscription `ACTIVE` until `current_period_end`, so cancelling renewal does not immediately downgrade a paid user;
- current NewebPay periodic checkout field set matches the documented periodic-payment contract;
- NewebPay `AlterStatus` uses its separate `Version=1.0` contract;
- manual deploy script uploads optional all-or-none NewebPay configuration and validates key/IV lengths and mode/period count.

These are **STATIC VERIFIED**, not runtime PASS.

## Defects found and fixed during validation

### 1. Feedback Admin public-account join

Wrong target table name was corrected from `worklog_public_account_ids` to `worklog_user_public_accounts`.

- `32492d9e` — `[skip ci] fix feedback public account join`.

Status: **SOURCE-AUTHORED / NOT RUN**.

### 2. AI Task hard-cap SYSTEM notification parity

AI Task now emits the same idempotent AI-limit SYSTEM notification used by other provider-backed AI operations for monthly point/provider-cost hard stops.

- `589e138b` — `[skip ci] align AI task limit notifications`.

Status: **SOURCE-AUTHORED / NOT RUN**.

### 3. NewebPay callback idempotency wall-clock fallback

Successful callbacks no longer use local `new Date()` when stable provider authorization time is missing. Insufficient stable provider facts fail closed with `RETRY`, so retries cannot derive different event keys.

- `51868af5` — `[skip ci] harden NewebPay callback idempotency`.

Status: **SOURCE-AUTHORED / NOT RUN**.

### 4. API runtime binding types

Root `Bindings` now includes accepted Google/Apple Login, Web Push and NewebPay fields used by runtime/deployment.

- `7e8f1ce9` — `[skip ci] align API runtime binding types`.

Status: **SOURCE-AUTHORED / NOT RUN** TypeScript.

### 5. NewebPay AlterStatus version

Periodic checkout remains 1.5; AlterStatus now uses its separate `Version=1.0` contract.

- `7b2be28a` — `[skip ci] use NewebPay AlterStatus API version`;
- `0ed1e0ec` — `[skip ci] author NewebPay version contract tests`.

Tests: **AUTHORED / NOT RUN**.

### 6. Admin account lookup still depended on legacy GROUP AI responsibility / LINE identity

Target-facing `AdminApi.users()` previously selected/searched LINE/OA fields and used `worklog_source_ai_responsibility` for user type/filtering. That would break the new `/accounts` page once legacy funding schema is removed.

The target-facing users query now uses only:

- `worklog_users` internal id/display name;
- `worklog_user_public_accounts`;
- current subscription;
- user-owned Grant/usage facts;
- active native GROUP memberships;
- active Record counts.

`GROUP_ENABLED` now means active AFTERTRACE GROUP membership, not AI funding responsibility.

- `c1559d8a` — `[skip ci] detach Admin account lookup from legacy funding`.

An unused alternate account-lookup route was removed after this smaller integration path was chosen:

- `26180c5c` — `[skip ci] remove unused account lookup route`.

Status: **SOURCE-AUTHORED / NOT RUN** against PostgreSQL/Admin build.

### 7. `/health/ready` still validated retired LINE-era schema/config

Legacy readiness probed LINE group profiles/entities/confirmations/GROUP responsibility and required LINE Messaging channel credentials as target readiness conditions.

Added `apps/api/src/target-readiness.ts` which validates the accepted V1 target instead:

- provider-neutral identities/public account ids/native invites;
- manual Records/revisions;
- FREE trial commercial config;
- AI Grant provider-cost counters/reservation holds;
- notifications/recipients/push/preferences;
- tasks;
- checkout/subscription lifecycle;
- Feedback management;
- NewebPay adapter table;
- Google + LINE Login core config, optional Apple remains outside mandatory readiness;
- AI runtime, FREE + AI Pro shape and Web Push configuration.

Wrangler now uses a thin `worker-entry.ts` wrapper so `/health/ready` goes through target readiness while the existing Worker is delegated for retained routes/scheduler.

- `c3bbd8d3` — `[skip ci] add V1 target readiness probe`;
- `d7afaf42` — `[skip ci] route readiness through V1 target probe`;
- `b3a8b089` — `[skip ci] use target-first API worker entry`.

Status: **SOURCE-AUTHORED / NOT RUN** Worker build/runtime.

### 8. Retired LINE webhook remained runtime-reachable

`/webhooks/line` is now rejected at the outer Worker boundary with HTTP 410 before legacy small-trace/LINE runtime can execute.

- `d83f0e72` — `[skip ci] retire LINE webhook at Worker boundary`.

Status: **SOURCE-AUTHORED / NOT RUN**.

### 9. In-product feedback still resolved sessions through `lineUserId`

Web `/api/v1/worklog/feedback` previously fell into legacy `worklog/routes.ts`, whose middleware resolves `session.lineUserId`. Google/Apple users could therefore fail `WORKLOG_USER_NOT_FOUND`.

Added a dedicated provider-neutral feedback route using `resolveWebSessionUserId`, bounded feedback/context input and durable `PWA` feedback persistence. The outer Worker intercepts the existing customer URL so Web UI needs no compatibility rewrite.

- `31506bfa` — `[skip ci] make in-product feedback provider-neutral`;
- `ee77a6a0` — `[skip ci] route feedback through provider-neutral boundary`.

Status: **SOURCE-AUTHORED / NOT RUN** against PostgreSQL/Web runtime.

### 10. Legacy confirmations/funding/generic Worklog routes remained reachable

Current Web client has no confirmation API usage; accepted Rewrite/Task confirmation flows use their own provider-neutral proposal/confirm paths. Funding is explicitly retired.

The outer Worker now:

- tombstones `/api/v1/worklog/funding*`;
- tombstones `/api/v1/worklog/confirmations*`;
- allows only accepted manual Worklog paths (`surfaces`, personal/group Record list/create, deleted, exact Record mutate/restore/revisions);
- handles feedback through the provider-neutral route;
- returns 410 for all other legacy `/api/v1/worklog/*` product routes.

- `459a60b6` — `[skip ci] isolate retired worklog routes at Worker boundary`;
- `fb0b6d42` — `[skip ci] allowlist target Worklog runtime routes`.

Manual Record allowlisted backend was inspected and is **STATIC VERIFIED** provider-neutral.

### 11. Deployment verification did not recognize new legitimate bootstrap-pending readiness states

The deploy verifier previously accepted only `AI_RUNTIME_CONFIG_NOT_INITIALIZED` and `FREE_PLAN_NOT_INITIALIZED` as first-environment bootstrap states. Target readiness can also legitimately report AI Pro plan or FREE AI trial config pending before operator initialization.

Added:

- `AI_PRO_PLAN_NOT_INITIALIZED`;
- `FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED`.

Schema failure, runtime binding failure and invalid Push configuration still hard-fail deployment verification.

- `7723c337` — `[skip ci] align deploy readiness bootstrap states`.

Status: **SOURCE-AUTHORED / NOT RUN** deployment script.

## Canonical Drizzle baseline — STATIC FAIL

`drizzle/0000_worklog_baseline.sql` is confirmed stale relative to target schema.

Examples:

- `worklog_users.line_user_id` still `NOT NULL`;
- GROUP Source identity still requires LINE group id;
- missing provider-neutral identity/public account ids;
- missing current Notification/Push/Task target;
- missing Feedback management / NewebPay target;
- missing current provider-cost concurrent hold/newer lifecycle state.

Status: **FAIL — baseline regeneration required before clean DB validation/deployment**.

Do not hand-edit baseline SQL to simulate success. Regenerate SQL + snapshot + journal together from authoritative `apps/api/src/db/schema-all.ts`, then rebuild a fresh disposable PostgreSQL DB.

## Baseline guard — target contract corrected

`scripts/check-worklog-baseline.mjs` was updated from a retired LINE-era required-schema list to a V1 target guard requiring provider-neutral identity/invites, notifications/tasks, FREE trial commercial config, AI provider-cost counters, lifecycle, Feedback and NewebPay.

Legacy responsibility/ONE_TIME/TOP_UP/LINE edit/nonces are currently warnings until executable dependency cleanup proves safe removal.

- `d879ce1e` — `[skip ci] align baseline guard to V1 target`.

Status: **SOURCE-AUTHORED / NOT RUN**.

## Known validation blockers / risks

1. No executable checkout/networked git is available in the current tool environment.
2. Canonical `drizzle/0000` is confirmed stale and blocks trustworthy clean rebuild validation.
3. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL are not yet supplied; paid runtime smoke cannot be completed until operator configuration exists.
4. NewebPay callback/AlterStatus behavior still requires sandbox verification against the merchant account's enabled periodic-payment product.
5. PostgreSQL lifecycle/provider-cost concurrency remains unverified.
6. OAuth/Gemini/Chrome/Push/Cron require real provider/browser/runtime smoke.
7. Legacy LINE/ONE_TIME/GROUP-funding/confirmation source files/schema still exist as migration residue, but the main customer runtime entry now tombstones retired LINE webhook/funding/confirmation/generic Worklog paths. Physical deletion still waits for executable dependency validation.
8. `scripts/deploy-workers.mjs` still requires legacy LINE Messaging channel secret/access token because retained legacy source/runtime modules are still compiled/delegated outside target customer paths. Remove that deployment requirement only together with physical legacy runtime deletion after typecheck/build proof.

## Exact next validation plan

When an executable checkout becomes available:

1. run `pnpm install --frozen-lockfile` if dependencies are absent;
2. run `pnpm release:preflight` and fix compile/lint/test/build failures coherently;
3. regenerate canonical `drizzle/0000` from `schema-all.ts` and run the V1 target baseline guard;
4. clean rebuild a disposable PostgreSQL DB;
5. run focused PostgreSQL smoke for:
   - provider-neutral account lookup;
   - provider-neutral in-product Feedback create + Admin workflow;
   - FREE trial / AI Pro grants;
   - provider-cost concurrent holds;
   - lifecycle duplicate/out-of-order/stale cancellation;
   - Related Records ranking;
6. configure NewebPay TEST credentials and run checkout -> callback retry/idempotency -> renewal -> cancel smoke;
7. run Google/LINE/Apple + Gemini + Chrome Extension + Push/Cron Dev smoke;
8. only after target dependencies are proven, physically remove remaining retired LINE/ONE_TIME/GROUP-funding/confirmation source/schema and then remove legacy LINE Messaging deploy requirements.

## Remaining estimate

### Functional scope

**0 focused feature-development hours remain** for the accepted V1 scope.

### Validation / release-readiness

Approximately **1.75–4.5 focused hours** remain after an executable checkout becomes available. The first `release:preflight` + canonical DB regeneration pass remains the largest uncertainty.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.
