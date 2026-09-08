# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule remains: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 V1 functional scope 100% source-authored; static validation hardened target runtime; GitHub Actions trial did not produce a run; executable validation remains blocked

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support channel.

User completion rule remains in force: compile/tests/runtime/deployment are not counted toward functional completion. Under that rule, accepted V1 feature scope remains **100% source-authored**. Validation/release-readiness remains separate and is not yet PASS/RUNTIME VERIFIED.

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
- Admin-manageable Feedback workflow;
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

## Static validation/hardening completed

Current validation session found and fixed concrete integration/release defects:

1. Feedback Admin public-account join used the wrong table name -> fixed to `worklog_user_public_accounts` (`32492d9e`).
2. AI Task hard-cap path lacked deterministic AI-limit SYSTEM notification parity (`589e138b`).
3. NewebPay callback idempotency used local wall-clock fallback when provider time was missing -> now fails closed with stable provider facts (`51868af5`).
4. Root API runtime bindings omitted Google/Apple/Web Push/NewebPay fields (`7e8f1ce9`).
5. NewebPay AlterStatus incorrectly reused checkout version 1.5 -> AlterStatus now uses `Version=1.0`; regression test authored (`7b2be28a`, `0ed1e0ec`).
6. Admin `/accounts` target-facing query still depended on legacy LINE/OA/GROUP AI responsibility -> detached from legacy funding identity (`c1559d8a`); unused alternate route removed (`26180c5c`).
7. `/health/ready` still validated retired LINE-era schema/config -> target readiness added and Wrangler switched to target-first Worker entry (`c3bbd8d3`, `d7afaf42`, `b3a8b089`).
8. Retired `/webhooks/line` remained reachable -> outer Worker now returns 410 (`d83f0e72`).
9. In-product Feedback still resolved sessions through `lineUserId` -> provider-neutral Feedback route now uses `resolveWebSessionUserId` (`31506bfa`, `ee77a6a0`).
10. Retired confirmations/funding/generic Worklog routes remained reachable -> outer Worker tombstones retired paths and allowlists only accepted manual Worklog routes (`459a60b6`, `fb0b6d42`).
11. Deployment verification did not recognize new legitimate target bootstrap-pending readiness states -> aligned (`7723c337`).
12. Baseline guard still enforced retired LINE-era schema as required -> rewritten target-first (`d879ce1e`).

Manual Record allowlisted backend was inspected and is **STATIC VERIFIED** provider-neutral (`verifyWebSessionToken + resolveWebSessionUserId`). Web session claims support provider-neutral sessions with a durable user id and empty migration-only LINE id.

## GitHub Actions trial — attempted with explicit user authorization

The user explicitly authorized a temporary GitHub Actions validation attempt on 2026-09-08.

Existing `.github/workflows/ci.yml` was inspected first. It is a validation-only workflow and contains no deployment/Prod actions. It runs:

- dependency install;
- TypeScript typecheck;
- ESLint;
- Vitest;
- build;
- Drizzle schema export.

Because the available connector exposes no workflow-dispatch operation, the branch push trigger was temporarily expanded from `main` to `main, revive/line-worklog` and committed as `9580bd4f6624a97346f20c2969e24f5284c0ca1a` specifically to trigger CI.

GitHub Actions run query for `branch=revive/line-worklog&event=push` returned:

- `total_count: 0`;
- no workflow run was created.

Status: **FAIL / unavailable as an execution path in the current repository/tool state**. No CI result exists and nothing is claimed PASS.

Per the user's instruction to turn it back off if it did not work, the temporary branch trigger was restored to the original `main`-only configuration in commit `a2596e85f243d8e859c71aa11d9de57283c110a0` (`[skip ci] restore CI branch trigger after unavailable Actions`).

Do not retry or modify Actions again unless the user explicitly authorizes another attempt.

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

## Executable verification status

Previously actually attempted:

- searched available `/mnt/data` and `/home/oai` for an AFTERTRACE `.git` checkout — **FAIL**, no checkout found;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- temporary GitHub Actions branch-trigger validation — **FAIL / no workflow run created**.

Therefore the following remain **NOT RUN**:

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

No unexecuted item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. No executable checkout/networked git is available in the current tool environment.
2. GitHub Actions did not create a run during the explicitly authorized trial and is not currently usable as the replacement execution path.
3. Canonical `drizzle/0000` is confirmed stale and blocks trustworthy clean rebuild validation.
4. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL are not yet supplied; paid runtime smoke cannot be completed until operator configuration exists.
5. NewebPay callback/AlterStatus behavior still requires sandbox verification against the merchant account's enabled periodic-payment product.
6. PostgreSQL lifecycle/provider-cost concurrency remains unverified.
7. OAuth/Gemini/Chrome/Push/Cron require real provider/browser/runtime smoke.
8. Legacy LINE/ONE_TIME/GROUP-funding/confirmation source files/schema still exist as migration residue, but the main customer runtime entry tombstones retired LINE webhook/funding/confirmation/generic Worklog paths. Physical deletion waits for executable dependency validation.
9. `scripts/deploy-workers.mjs` still requires legacy LINE Messaging channel secret/access token because retained legacy source/runtime modules are still compiled/delegated outside target customer paths. Remove that requirement only together with physical legacy runtime deletion after typecheck/build proof.

## Exact next validation plan

When an executable checkout becomes available:

1. run `pnpm install --frozen-lockfile` if dependencies are absent;
2. run `pnpm release:preflight` and fix compile/lint/test/build failures coherently;
3. regenerate canonical `drizzle/0000` from `schema-all.ts` and run the V1 target baseline guard;
4. clean rebuild a disposable PostgreSQL DB;
5. run focused PostgreSQL smoke for provider-neutral account lookup, Feedback, FREE trial/AI Pro grants, provider-cost concurrency, lifecycle replay/stale cancellation and Related Records ranking;
6. configure NewebPay TEST credentials and run checkout -> callback retry/idempotency -> renewal -> cancel smoke;
7. run Google/LINE/Apple + Gemini + Chrome Extension + Push/Cron Dev smoke;
8. only after target dependencies are proven, physically remove remaining retired LINE/ONE_TIME/GROUP-funding/confirmation source/schema and then remove legacy LINE Messaging deploy requirements.

## Remaining estimate

### Functional scope

**0 focused feature-development hours remain** for the accepted V1 scope.

### Validation / release-readiness

Approximately **1.75–4.5 focused hours** remain once an executable checkout becomes available. The first `release:preflight` + canonical DB regeneration pass remains the largest uncertainty.

`apps/api/verify-admin-schema.mjs` was not staged or committed.
