# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 V1 functional scope remains 100% source-authored; static validation/hardening found and fixed additional release defects; executable validation still blocked

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

Legacy monolithic Admin product UI is no longer mounted. Legacy LINE/GROUP-funding/ONE_TIME source remains only as migration residue pending executable dependency proof.

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
- Worker mounts NewebPay, AI Task proposal and Feedback management routes before legacy generic runtime fallback;
- Web router mounts `/ai-task`; Admin router mounts `/accounts` and `/feedback-management`;
- `schema-all.ts` exports Feedback management and NewebPay adapter schemas;
- Admin/API commercial config shapes both include `aiTaskProposal` capability;
- manual deploy script uploads optional all-or-none NewebPay configuration and validates key/IV lengths and mode/period count;
- current NewebPay periodic checkout field set matches the provider's documented 1.5 periodic-payment contract;
- current NewebPay periodic success parsing uses documented stable fields including `TradeNo`, `AuthDate`, `AlreadyTimes`, `NextAuthDate` and `PeriodNo` where supplied;
- NewebPay `AlterStatus` endpoint/version contract is separate from periodic checkout and now uses `Version=1.0`.

These are **STATIC VERIFIED**, not runtime PASS.

## Defects found and fixed during validation

### 1. Feedback Admin public-account join

`apps/api/src/admin/feedback-management-routes.ts` incorrectly joined `worklog_public_account_ids`. Target table is `worklog_user_public_accounts`.

Fixed commit:

- `32492d9e` — `[skip ci] fix feedback public account join`.

Status: **SOURCE-AUTHORED / NOT RUN** against PostgreSQL.

### 2. AI Task hard-cap SYSTEM notification parity

AI Task proposal shared entitlement/reservation accounting but did not emit the deterministic `AI_LIMIT_REACHED` SYSTEM notification used by other provider-backed AI operations.

Fixed for:

- `MONTHLY_POINT_CAP_REACHED`;
- `MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED`;
- `MONTHLY_PROVIDER_COST_CAP_REACHED`.

`PROVIDER_COST_ACCOUNTING_INCOMPLETE` is still not mislabelled as customer exhaustion.

Fixed commit:

- `589e138b` — `[skip ci] align AI task limit notifications`.

Status: **SOURCE-AUTHORED / NOT RUN**.

### 3. NewebPay callback idempotency used local wall-clock fallback

Successful periodic callbacks previously fell back to `new Date()` when provider authorization time could not be parsed. A retry of the same callback could therefore derive a different billing period/event key.

Now successful callback processing fails closed with `RETRY` when stable provider facts are insufficient. `periodStart` must come from provider authorization time, and the idempotency key uses stable provider `TradeNo` or `AlreadyTimes` together with `PeriodNo`. Lifecycle `occurredAt` is derived from the stable provider period start.

Fixed commit:

- `51868af5` — `[skip ci] harden NewebPay callback idempotency`.

Status: **SOURCE-AUTHORED / NOT RUN** against NewebPay/PostgreSQL.

### 4. Root API Worker bindings were behind actual runtime contract

`apps/api/src/index.ts` root `Bindings` type omitted newer Google/Apple Login, Web Push and NewebPay fields used by route modules/manual deployment.

Root bindings now include the accepted runtime fields so future strict typecheck reflects actual deployment configuration instead of relying on route casts alone.

Fixed commit:

- `7e8f1ce9` — `[skip ci] align API runtime binding types`.

Status: **SOURCE-AUTHORED / NOT RUN** TypeScript.

### 5. NewebPay AlterStatus incorrectly reused checkout version

Current periodic checkout contract uses version 1.5, but NewebPay AlterStatus is a separate API contract and documents `Version=1.0`. The helper previously reused the periodic checkout version for cancellation.

Fixed commit:

- `7b2be28a` — `[skip ci] use NewebPay AlterStatus API version`.

Regression contract tests added:

- `0ed1e0ec` — `[skip ci] author NewebPay version contract tests`.

Tests are **AUTHORED / NOT RUN**.

## Canonical Drizzle baseline — STATIC FAIL

`drizzle/0000_worklog_baseline.sql` is confirmed stale relative to target schema.

Examples visible in the canonical baseline:

- `worklog_users.line_user_id` is still `NOT NULL`, conflicting with provider-neutral accounts;
- GROUP Source identity still requires a LINE group id;
- baseline predates provider-neutral identity/public account ids;
- baseline predates current Notification/Push/Task target tables;
- baseline predates Feedback management / NewebPay target tables;
- baseline predates current provider-cost concurrent hold and newer subscription lifecycle state.

Status: **FAIL — baseline regeneration required before clean DB validation/deployment**.

Do not hand-edit baseline SQL to simulate success. Once an executable checkout is available, regenerate from authoritative `apps/api/src/db/schema-all.ts` using repository tooling, regenerate SQL + snapshot + journal together, then rebuild a disposable PostgreSQL database.

## Baseline guard — target contract corrected

Static validation also found `scripts/check-worklog-baseline.mjs` was still enforcing the retired LINE-era product as required schema, including GROUP AI responsibility / LINE edit concepts, while not requiring key current V1 tables.

The guard is now target-first and requires markers for:

- provider-neutral auth identities + public account ids;
- native Source invites;
- Record revision history;
- Grant/reservation/usage funding and provider-cost hold counters;
- FREE trial commercial config;
- Notification/recipient/Push/preference tables;
- Tasks;
- checkout + provider-neutral subscription lifecycle inbox;
- Feedback + Feedback management;
- NewebPay adapter state.

Known legacy responsibility/ONE_TIME/TOP_UP/LINE edit/nonces are currently emitted as migration-residue warnings rather than V1 requirements. They should become forbidden only after executable dependency cleanup proves safe physical removal.

Fixed commit:

- `d879ce1e` — `[skip ci] align baseline guard to V1 target`.

Status: **SOURCE-AUTHORED / NOT RUN**.

## Known validation blockers / risks

1. No executable checkout/networked git is available in the current tool environment.
2. Canonical `drizzle/0000` is confirmed stale and blocks trustworthy clean rebuild validation.
3. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL are not yet supplied; paid runtime smoke cannot be completed until operator configuration exists.
4. NewebPay callback/AlterStatus behavior still requires sandbox verification against the merchant account's enabled periodic-payment product even though the source now aligns with documented field/version contracts.
5. PostgreSQL lifecycle/provider-cost concurrency remains unverified.
6. OAuth/Gemini/Chrome/Push/Cron require real provider/browser/runtime smoke.
7. Legacy LINE/ONE_TIME/GROUP-funding/confirmation source still exists as migration residue and should be physically removed only after executable dependency validation.
8. Worker still initializes some legacy LINE attachment/normalization runtime for generic old `/api/v1/worklog/*` fallback routes. Target APIs are mounted before this boundary; final physical isolation belongs to post-validation cleanup.

## Exact next validation plan

When an executable checkout becomes available:

1. run `pnpm install --frozen-lockfile` if dependencies are absent;
2. run `pnpm release:preflight` and fix compile/lint/test/build failures coherently;
3. regenerate canonical `drizzle/0000` from `schema-all.ts` and run the updated V1 target baseline guard;
4. clean rebuild a disposable PostgreSQL DB;
5. run focused PostgreSQL smoke for:
   - Feedback management join/update/audit;
   - FREE trial / AI Pro grants;
   - provider-cost concurrent holds;
   - lifecycle duplicate/out-of-order/stale cancellation;
   - Related Records ranking;
6. configure NewebPay TEST credentials and run checkout -> callback retry/idempotency -> renewal -> cancel smoke;
7. run Google/LINE/Apple + Gemini + Chrome Extension + Push/Cron Dev smoke;
8. only after target dependencies are proven, physically remove remaining retired LINE/ONE_TIME/GROUP-funding/confirmation residue.

## Remaining estimate

### Functional scope

**0 focused feature-development hours remain** for the accepted V1 scope.

### Validation / release-readiness

Approximately **2–5 focused hours** remain after an executable checkout becomes available. The first `release:preflight` + canonical DB regeneration pass remains the largest uncertainty.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.
