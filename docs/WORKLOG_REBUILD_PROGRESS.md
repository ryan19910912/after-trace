# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 V1 functional scope remains 100% source-authored; first validation pass found/fixed two static integration defects; executable validation is still blocked

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support channel.

User completion rule remains in force: compile/tests/runtime/deployment are not counted toward “functional completion”. Under that rule, accepted V1 feature scope remains **100% source-authored**. Validation/release-readiness is tracked separately and is not yet PASS/RUNTIME VERIFIED.

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

## Validation run completed in this checkpoint

### Executable verification — FAIL / BLOCKED

Actually attempted:

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

### Static release-readiness checks — completed

Verified from the current branch source:

- root `release:preflight` exists and runs baseline guard -> typecheck -> lint -> tests -> builds -> Drizzle schema export;
- API/Web/Admin package validation/build scripts exist;
- Worker mounts NewebPay, AI Task proposal and Feedback management routes before legacy generic runtime fallback;
- Web router mounts `/ai-task`; Admin router mounts `/accounts` and `/feedback-management`;
- schema-all exports Feedback management and NewebPay adapter schemas;
- Admin/API commercial config shapes both include `aiTaskProposal` capability;
- manual deploy script uploads optional all-or-none NewebPay configuration and validates key/IV lengths and mode/period count.

These are **STATIC VERIFIED**, not runtime PASS.

### Defect found and fixed — Feedback Admin public-account join

Static SQL inspection found `apps/api/src/admin/feedback-management-routes.ts` joining a non-target table name `worklog_public_account_ids`.

Target account lookup uses `worklog_user_public_accounts`. The Feedback Admin query was corrected accordingly.

Commit:

- `32492d9e` — `[skip ci] fix feedback public account join`.

This fix is **SOURCE-AUTHORED / NOT RUN** against PostgreSQL.

### Defect found and fixed — AI Task hard-cap SYSTEM notification parity

AI Task proposal shared entitlement/reservation accounting but its blocked response did not emit the same deterministic `AI_LIMIT_REACHED` SYSTEM notification used by other provider-backed AI operations.

The route now emits an idempotent limit notification for:

- `MONTHLY_POINT_CAP_REACHED`;
- `MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED`;
- `MONTHLY_PROVIDER_COST_CAP_REACHED`.

It still does not mislabel `PROVIDER_COST_ACCOUNTING_INCOMPLETE` as customer exhaustion.

Commit:

- `589e138b` — `[skip ci] align AI task limit notifications`.

This fix is **SOURCE-AUTHORED / NOT RUN**.

### Canonical Drizzle baseline — STATIC FAIL

`drizzle/0000_worklog_baseline.sql` was inspected and is confirmed stale relative to the target schema.

Examples visible in the canonical baseline:

- `worklog_users.line_user_id` is still `NOT NULL`, conflicting with provider-neutral accounts;
- GROUP Source identity still requires a LINE group id;
- the baseline predates current Feedback management / NewebPay target tables and many newer identity/notification/task/AI/lifecycle changes.

Status: **FAIL — baseline regeneration required before clean DB validation/deployment**.

Do not manually hand-edit the baseline to simulate success. Once an executable checkout is available, regenerate from authoritative `apps/api/src/db/schema-all.ts` using the repository's baseline tooling, then rebuild a disposable PostgreSQL database.

## Known validation blockers / risks

1. No executable checkout/networked git is available in the current tool environment.
2. Canonical `drizzle/0000` is confirmed stale and blocks trustworthy clean rebuild validation.
3. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL are not yet supplied; paid runtime smoke cannot be completed until operator configuration exists.
4. NewebPay callback/AlterStatus payload assumptions still require sandbox verification with the merchant account's enabled periodic-payment product.
5. PostgreSQL lifecycle/provider-cost concurrency remains unverified.
6. OAuth/Gemini/Chrome/Push/Cron require real provider/browser/runtime smoke.
7. Legacy LINE/ONE_TIME/GROUP-funding/confirmation source still exists as migration residue and should be physically removed only after executable dependency validation.
8. `apps/api/src/index.ts` root `Bindings` type still reflects older runtime fields; route-local bindings and runtime env provide newer optional values, but a real strict typecheck is required before deciding whether to broaden the root type.

## Exact next validation plan

When an executable checkout becomes available:

1. run `pnpm install --frozen-lockfile` if dependencies are absent;
2. run `pnpm release:preflight` and fix all compile/lint/test/build failures coherently;
3. regenerate canonical `drizzle/0000` from `schema-all.ts` and run baseline guard;
4. clean rebuild a disposable PostgreSQL DB;
5. run focused PostgreSQL smoke for:
   - Feedback management join/update/audit;
   - FREE trial / AI Pro grants;
   - provider-cost concurrent holds;
   - lifecycle duplicate/out-of-order/stale cancellation;
   - Related Records ranking;
6. configure NewebPay TEST credentials and run checkout -> callback -> renewal -> cancel smoke;
7. run Google/LINE/Apple + Gemini + Chrome Extension + Push/Cron Dev smoke;
8. only after target dependencies are proven, physically remove remaining retired LINE/ONE_TIME/GROUP-funding/confirmation residue.

## Remaining estimate

### Functional scope

**0 focused feature-development hours remain** for the accepted V1 scope.

### Validation / release-readiness

Approximately **2–5.5 focused hours** remain after an executable checkout becomes available. The first `release:preflight` + canonical DB regeneration pass is the largest uncertainty.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.
