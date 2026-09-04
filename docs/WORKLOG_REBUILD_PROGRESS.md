# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run, in this order:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- this file

The latest product/development documents above are the only product specification. Do not revive old Customer/Project/Finance/Owner/aggregate-quota assumptions from older code, migrations, or tests.

## Current execution checkpoint — 2026-09-04 release-readiness gate batch

This batch continued from the migration-safety/accounting/PWA-concurrency checkpoint. It did not redo the completed Source/Entity/Alias/Record/Revision/Confirmation, free PWA CRUD/search, LINE CREATE-HISTORY-Reply EDIT, Grant/scopes/caps, subscription-period Grant, or Admin profitability implementations.

The goal of this batch was to move the branch as close as possible to an actual workers.dev launch without pretending that unexecuted migration/runtime validation had passed.

## Scanned this run

- all required durable product/development/deployment/progress documents;
- latest branch checkpoint and current `revive/line-worklog` source before each write;
- API/Web/Admin Worker configs and production deploy helpers;
- root/API package scripts and Drizzle config;
- baseline regeneration/guard scripts and checked-in baseline SQL;
- Web/Auth LINE Login callback/origin flow;
- API Worker bindings and health behavior;
- LINE webhook empty-result metrics schema;
- latest PWA manual edit/single-move/batch-move optimistic-version ordering.

The latest PWA routes already contain the required early `expectedVersion` checks before no-op success or `resolveManualEntity(...)`, including batch move. Do not redo that fix unless a regression appears.

## Files changed this run

Release/migration tooling:

- `scripts/release-preflight.mjs` — new local non-deploying release gate
- `package.json` — added `release:preflight`
- `drizzle.config.ts` — `.env.local` first, `.env` fallback, while schema-only generation remains DB-optional
- `scripts/regenerate-worklog-baseline.mjs` — generation failure restores old artifacts; guard-visible drift keeps the newly generated artifacts for inspection

Deployment/runtime readiness:

- `worker-deploy.ps1` — baseline guard moved before dependency/build work and post-deploy readiness required
- `web-worker-deploy.ps1` — verifies `/`, `/help`, `/subscription`
- `admin-worker-deploy.ps1` — verifies `/`, `/profitability`
- `apps/api/src/index.ts` — `/health/ready` and current LINE empty-webhook metrics schema
- `apps/api/src/index-readiness.test.ts` — new fail-closed readiness test source
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. One local release preflight command now covers all three applications

New command:

`pnpm release:preflight`

It is deliberately non-deploying/non-migrating and runs, in order:

1. checked-in Worklog baseline/snapshot/journal guard;
2. API/Web/Admin TypeScript typecheck;
3. ESLint;
4. Vitest;
5. API Worker dry-run plus Web/Admin production builds via the root build command;
6. Drizzle schema export from `apps/api/src/db/schema-all.ts`.

A green preflight is necessary but not sufficient for launch. Fresh PostgreSQL migration/application and real browser/LINE/Gemini smoke remain mandatory.

### 2. Drizzle tooling now uses the same local environment source as API development

`apps/api/scripts/dev.mjs` already uses repository-root `.env.local`, but `drizzle.config.ts` previously loaded only `.env`.

Drizzle now:

- respects an explicitly supplied `DATABASE_URL` first;
- otherwise loads `.env.local`;
- falls back to `.env` only for compatibility;
- still allows `generate`/`export` without a DB URL;
- still requires a real DB URL when a command actually connects to PostgreSQL.

This prevents a local Worker and migration tooling from silently using different DB configuration.

### 3. Baseline regeneration no longer hides a successful generation that exposes drift

`pnpm db:baseline:regenerate --confirm-prelaunch-reset` now distinguishes two failure classes:

- **Drizzle generation fails / partial artifacts:** restore the backed-up old `drizzle/` directory;
- **generation succeeds but AFTERTRACE guard fails:** keep the newly generated artifacts, exit non-zero, and keep deployment blocked so the developer can inspect/fix the real generated drift.

Do not restore the known-stale baseline merely to hide a guard-visible mismatch.

### 4. API production deploy fails fast on the known-stale migration set

`worker-deploy.ps1` now runs the baseline guard before dependency installation/typecheck/test/build. The current checked-in stale baseline therefore fails immediately instead of wasting a full release cycle before migration is rejected.

### 5. API now distinguishes liveness from actual launch readiness

- `GET /health` = Worker process/liveness only.
- `GET /health/ready` = production readiness.

`/health/ready` fails with HTTP 503 when required production configuration is missing/invalid, including:

- DB;
- LINE Messaging credentials;
- Gemini key;
- Web URL/origin and >=32-char Web auth secret;
- LINE Login channel/secret;
- Admin username/password/session secret/origin.

It also queries the rebuilt core `worklog_users` table. A reachable DB with an unapplied/stale schema is therefore **not** considered ready.

The endpoint reports missing configuration names only; it never returns secret values.

`worker-deploy.ps1` now requires both `/health` and `/health/ready` after deployment.

### 6. Web/Admin deployment now verifies representative SPA deep links

Both Static Assets configs already use `not_found_handling = "single-page-application"`.

When `-ExpectedUrl` is supplied:

- Web deployment verifies `/`, `/help`, `/subscription`;
- Admin deployment verifies `/`, `/profitability`.

This catches an otherwise easy launch failure where `/` works but direct navigation/reload of SPA routes returns 404.

### 7. Empty LINE webhook response no longer exposes the retired Owner metric name

Normal GROUP webhook processing already uses `worklogAiResponsibilityClaims`, but the zero-event fast response still returned `worklogOwnerClaims: 0`.

It now returns `worklogAiResponsibilityClaims: 0`, keeping the webhook metrics contract consistent regardless of event count.

### 8. Latest PWA stale-version ordering is confirmed fixed

Current `routes.ts` now performs route-level optimistic-version checks before any no-op or title resolution side effect:

- manual PATCH edit rejects stale `expectedVersion` before no-op success;
- single move rejects stale version before `resolveManualEntity(...)`;
- batch move validates every Record's expected version before resolving/creating the destination title;
- lower-level SQL still retains version predicates as the final DB concurrency guard.

Therefore the previously identified stale request → orphan Entity/title problem is no longer present in current branch source.

## Stable completed foundation

Do not redo unless a concrete regression appears:

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- no Customer/Project/Transaction/Finance/category/normalized-summary Record core;
- free PWA manual create/edit/search/title move/batch move/delete/recycle/restore/revision history;
- PRIVATE authorization by private Source; GROUP manual authorization by active membership only;
- deterministic HISTORY -> filtered PWA deep links;
- deterministic same-Source Reply target + full PRIVATE/GROUP LINE AI EDIT pipeline;
- title/Alias ambiguity confirmation without second AI charge;
- FREE 400,000-point one-time Grant;
- user-owned Grants/scopes/caps with GROUP AI 額度負責人 separation;
- provider full cost -> frozen output-price-equivalent AI points;
- customer floor-at-zero + platform subsidy;
- immutable/idempotent `SUBSCRIPTION_PERIOD` Grants scoped PRIVATE by default;
- historical period retry independent from later plan-template point changes;
- `ai_units_consumed`, `actualUnits`, aggregate quota live-balance paths removed;
- provider `reservationPoints` naming;
- retired `OWNER_BOUND`, Source Owner funding, `groupCollaboration`, `maxGroupCount`, and GROUP recording preference removed from current execution contract;
- factual Admin profitability TODAY/7D/30D/BILLING_MONTH with actor vs charged user, model/operation/PRIVATE-GROUP/Grant/plan breakdowns, subsidy facts and no synthetic revenue;
- Grant inventory separates committed used / reserved / remaining points;
- Drizzle `schema-all.ts` is the authoritative export surface;
- baseline guard + safe regeneration workflow;
- hard-coded Workers account URL removed.

## Current hard blocker — checked-in baseline is still stale

The latest checked-in `drizzle/0000_worklog_baseline.sql` was re-read in this run and still begins with retired structures including:

- `worklog_project_status`;
- `worklog_record_category`;
- `worklog_transaction_type`;
- old `worklog_ai_reservation_status`;
- `worklog_ai_usage_events.ai_units_consumed`.

Therefore **the current migration artifacts MUST NOT be applied** and the branch is still NOT READY for deployment.

This is now the primary concrete launch blocker.

## Next implementation / validation target

Continue from this exact checkpoint. Do not redo release-preflight/readiness/deep-link/PWA-version fixes.

From a real latest checkout with the pinned pnpm/Drizzle toolchain:

1. `pnpm install --frozen-lockfile`
2. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
3. inspect any kept generated artifacts if the guard fails; fix real schema mismatch and regenerate
4. `pnpm db:baseline:guard` until green
5. point `DATABASE_URL` at a **fresh disposable PostgreSQL database**
6. apply the regenerated migration and validate schema drift/FKs/indexes/checks
7. exercise Grant reservation/commit/release/expiry/subsidy/concurrency SQL and Record revision/confirmation/move SQL against PostgreSQL
8. `pnpm release:preflight`
9. browser smoke for customer Web and Admin profitability
10. LINE CREATE/HISTORY/Reply EDIT/confirmation + attachment flows
11. Gemini usage/pricing/point-settlement smoke
12. Worker dry-run/runtime and finally workers.dev deployment helpers

Only after the above may deployment status change to READY.

## Additional validation item — Entity/Alias case collisions

Manual resolution currently matches names with `lower(...)`, while DB uniqueness is case-sensitive. During the fresh PostgreSQL batch, explicitly reproduce case-variant Entity/Alias collisions and then apply the smallest DB-level normalization/uniqueness fix if needed. Do not invent a collation/index policy without reproducing the real behavior.

## Validation status

This run performed static source/document audit and direct GitHub source edits only.

The execution environment still has no usable checked-out `after-trace` project/toolchain; earlier clone attempts failed DNS resolution for `github.com`. Therefore the newly authored release scripts/tests could not be executed here.

**Not executed:**

- `pnpm db:baseline:regenerate`;
- `pnpm db:baseline:guard`;
- `pnpm release:preflight`;
- TypeScript typecheck;
- ESLint;
- Vitest;
- API/Web/Admin builds;
- Drizzle generate/export/migrate;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker dry-run/runtime/deploy;
- LINE runtime;
- Gemini runtime.

Therefore no unexecuted test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY — but implementation is now close to release-gate stage.**

The remaining blocker is no longer a broad product/domain refactor. It is primarily:

1. regenerate the known-stale migration artifacts with the real toolchain;
2. validate/apply them on fresh PostgreSQL;
3. run the now-defined local release preflight and runtime smoke suite.

## Rough remaining work

Planning-only estimate:

- core non-payment product implementation: **largely complete**;
- migration regeneration + real PostgreSQL fixes: **1 mandatory substantial batch**;
- local preflight + browser/Worker/LINE/Gemini smoke: **1 mandatory validation batch**;
- payment-provider/TOP_UP/refund/proration lifecycle: separate payment/product work unless launch scope explicitly requires paid checkout now.
