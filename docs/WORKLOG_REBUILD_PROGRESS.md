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

## Current execution checkpoint — 2026-09-04 migration safety + accounting + PWA stale-version correctness

This batch re-read all eight durable documents and continued from the latest migration/accounting checkpoint. It did **not** redo completed Source/Record/PWA/LINE CREATE-HISTORY-EDIT/Grant/subscription-period/Admin-profitability work.

The previously known small provider/Owner/recording cleanup is already complete. This batch closed several concrete correctness gaps that were still visible before real migration/runtime validation:

- Drizzle baseline generation can now run from TypeScript schema without requiring a live `DATABASE_URL`;
- baseline regeneration has explicit destructive-reset confirmation, exact prelaunch artifact-shape checks, Windows-compatible pnpm execution, full backup, and distinct failure behavior for generation failure vs guard-detected drift;
- baseline guard now validates the exact `0000` migration/snapshot/journal shape instead of only searching markers;
- AI Grant status now actually becomes `EXHAUSTED` when a point reservation holds the final remaining balance and can return to `ACTIVE` when held points are restored;
- Admin profitability no longer treats in-flight reserved points as committed utilization;
- a real Admin client syntax error in `audit()` introduced by a recent profitability follow-up was fixed;
- paid subscription-period retry remains idempotent even after a future plan-template point amount changes;
- PWA manual edit/single-move/batch-move now rejects stale versions **before** no-op success or `resolveManualEntity(...)`, preventing stale requests from creating orphan titles before returning 409;
- a focused route source-contract test was added to lock that version-check ordering.

## Scanned this run

- all eight required durable product/development/deployment/progress documents;
- current `revive/line-worklog` branch state and concurrent commits before each final write;
- `drizzle.config.ts`, root/API package scripts, current baseline guard and regeneration script;
- checked-in Drizzle SQL/snapshot/journal shape and deployment migration policy;
- AI Grant schema, Grant provisioning and full PostgreSQL point reservation/commit/release/expiry SQL;
- Admin profitability repository/client/page and Grant inventory semantics;
- paid subscription-period service/repository/retry tests;
- customer PWA `routes.ts` manual edit/move/batch move/delete/restore and Revision SQL;
- manual Entity/title resolution and current Entity/Alias uniqueness behavior;
- the local execution environment for a checked-out project/toolchain;
- current Drizzle Kit `generate` contract for schema-only generation.

A direct local clone was retried and still failed with `Could not resolve host: github.com`; no mounted checkout/toolchain was available. Therefore pnpm, TypeScript, Vitest, Drizzle generation, PostgreSQL and browser/Worker runtime could not be honestly executed in this environment.

## Files changed in this batch

Migration/deployment safety:

- `drizzle.config.ts`
- `scripts/regenerate-worklog-baseline.mjs`
- `scripts/check-worklog-baseline.mjs`
- `package.json` — contains `db:baseline:regenerate`
- `docs/WORKLOG_DEPLOYMENT.md`

Accounting / Admin correctness:

- `apps/api/src/worklog/drizzle-ai-point-ledger.ts`
- `apps/api/src/admin/profitability.ts`
- `apps/admin/src/api.ts`
- `apps/admin/src/ProfitabilityPage.tsx`
- `apps/api/src/worklog/subscription-period.ts`
- `apps/api/src/worklog/subscription-period.test.ts`

PWA optimistic-concurrency ordering:

- `apps/api/src/worklog/routes.ts`
- `apps/api/src/worklog/routes-version-ordering.test.ts` — new focused source-ordering guard

Durable handoff:

- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. Drizzle baseline generation is schema-only and no longer requires a live database

`drizzle.config.ts` still uses only:

`apps/api/src/db/schema-all.ts`

as the authoritative schema export surface, but `dbCredentials` is now included only when `DATABASE_URL` is actually configured.

This allows `drizzle-kit generate` / schema generation to operate from TypeScript schema without pointing at a real database. Commands that actually connect to PostgreSQL still require real DB credentials and must fail when they are absent.

Do not reintroduce a fake or production DB URL merely to generate migration artifacts.

### 2. Prelaunch baseline regeneration is explicit and fail-closed

Use only after confirming the repository is still prelaunch/disposable:

`pnpm db:baseline:regenerate --confirm-prelaunch-reset`

The regeneration script now:

- refuses to run without the explicit reset flag;
- refuses to delete `drizzle/` unless it contains exactly the expected prelaunch `0000_worklog_baseline.sql` plus `meta/0000_snapshot.json` and `_journal.json`;
- backs up the whole existing `drizzle` directory before destructive generation;
- runs the project-pinned Drizzle Kit from `schema-all.ts`;
- uses shell execution for the pnpm invocation on Windows so the command can resolve the Windows pnpm shim;
- immediately runs the AFTERTRACE baseline guard after successful generation.

Failure handling is intentionally split:

- if **Drizzle generation itself** fails or leaves an unusable partial set, restore the previous `drizzle` directory in full;
- if generation succeeds but the AFTERTRACE guard exposes a real schema/product drift, keep the newly generated artifacts for inspection, exit non-zero, and keep deployment blocked. Do not restore the known-stale baseline and hide the drift.

This workflow was authored/reviewed statically but was **not executed** here.

### 3. Baseline guard now validates exact artifact shape

`scripts/check-worklog-baseline.mjs` now verifies more than legacy markers:

- `drizzle/` must contain exactly `0000_worklog_baseline.sql` + `meta/`;
- `drizzle/meta/` must contain exactly `0000_snapshot.json` + `_journal.json`;
- journal dialect must be PostgreSQL;
- journal must have one entry with `idx=0` and tag `0000_worklog_baseline`;
- known obsolete Customer/Project/Transaction/category/aggregate-quota/recording markers are forbidden;
- accepted Entity/Alias/Revision/Confirmation/Grant/usage-accounting markers are required.

Unexpected extra migration files are treated as a reason to stop and review the prelaunch-reset assumption, not something the script should silently delete.

### 4. Grant status now follows the reservation hold state

A real state-machine bug existed in `reservePointsAtomic`:

- reservation immediately subtracts held points from `worklog_ai_grants.remaining_points`;
- release/expiry/unused settlement already knew how to reactivate an `EXHAUSTED` Grant;
- but the reservation hold itself never changed an ACTIVE Grant to `EXHAUSTED` when it held the final remaining point.

The hold SQL now sets:

- post-hold remaining `0` -> `EXHAUSTED`;
- positive post-hold remaining -> `ACTIVE`.

This keeps durable status coherent with the currently available customer balance while preserving the existing release/restore behavior.

PostgreSQL execution is still required to validate the full concurrent CTE state machine.

### 5. Profitability distinguishes committed usage from in-flight holds

The prior inventory calculation could infer utilization from `originalPoints - remainingPoints`. That is wrong because `remaining_points` is reduced at reservation/preflight time, before provider success and settlement.

Inventory now exposes separate factual values:

- `usedPoints` = committed `worklog_ai_grant_scopes.used_points`;
- `reservedPoints` = current in-flight `scope.reserved_points`;
- `remainingPoints` = current unheld available points.

Committed utilization is based on `usedPoints / originalPoints` only. A Grant whose entire currently available balance is merely held by an in-flight request is not presented as permanently consumed.

The Admin page shows original / committed used / reserved / remaining separately and explains the distinction.

### 6. Profitability keeps actor and funding identities separate

For GROUP usage, actual operators and the AI 額度負責人 may differ. The report therefore keeps:

- `activeUsers = DISTINCT actor_user_id`;
- `chargedUsers = DISTINCT charged_user_id`.

USD averages remain available from immutable USD cost. TWD averages become `null`/`資料不完整` when any selected-period request lacks a TWD conversion snapshot rather than dividing a partial TWD total by all requests.

`byPlan` remains historical/factual from the Grant that actually funded usage (`FREE_INITIAL` or frozen subscription Grant metadata), never from the current subscription row and never from plan list price.

### 7. Admin `audit()` syntax regression was fixed

A recent Admin profitability follow-up left `AdminApi.audit()` with a missing closing parenthesis, which would have broken Admin TypeScript parsing/build.

The method now correctly returns the labeled `/audit` response. This was found by source audit; no typecheck was available in this environment.

### 8. Subscription-period retry is stable across future plan-template changes

An exact retry of an already-created paid period no longer compares the immutable historical Grant point count with today's editable `plan.subscriptionPeriodPoints` template.

The retry validates immutable period/origin identity and dates. Therefore changing PRO/TEAM included points for a **future** renewal does not make an older already-created period stop being idempotent.

Focused test source exists but was **not executed**.

### 9. PWA stale-version checks now happen before no-op/title side effects

A concrete route ordering bug is now fixed.

Manual PATCH edit:

- validates `expectedVersion`;
- immediately compares it with the loaded current version;
- stale request returns `RECORD_VERSION_CONFLICT` before a no-op path can report success.

Single Record move:

- performs the same early version comparison;
- stale request returns 409 **before** `resolveManualEntity(...)` can resolve/create a target title;
- a stale move can no longer create a new unused title and only then discover the conflict.

Batch move:

- loads/authenticates all snapshots;
- builds the expected-version map and rejects any mismatch;
- only after every requested Record version matches does it call `resolveManualEntity(...)`.

The lower-level mutation SQL still retains its own version predicate, so the route-level early check prevents pre-mutation side effects while the DB-level predicate remains the final concurrency guard.

`routes-version-ordering.test.ts` statically locks these ordering invariants. It was authored but **not executed**; fresh PostgreSQL behavior/integration tests are still required.

## Stable completed foundation from earlier batches

Do not redo unless a real regression is found:

- Source + single Entity/title + Alias + Record + immutable Revision core;
- Customer/Project/Finance/Transaction/category/normalized-summary removed from customer Record core/UI/API;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization = active Source membership, independent from subscription/AI points;
- GROUP Source existence independent from AI funding responsibility;
- bounded Gemini CREATE title/occurred_at interpretation + durable Pending Confirmation;
- deterministic HISTORY filtered PWA deep links;
- deterministic same-Source Reply target and full GROUP/PRIVATE LINE AI EDIT pipeline;
- LINE_AI_EDIT optimistic version guard, Revision and confirmation UX without second charge;
- bot success-message -> Record Reply mapping;
- FREE initial Grant = exactly 400,000 points once;
- user-owned Grants/scopes/caps for TEXT/attachment/LINE EDIT;
- provider full cost -> output-price-equivalent AI points;
- customer balance floor + platform subsidy;
- GROUP AI funding responsibility via `worklog_source_ai_responsibility`;
- Grant-backed PRIVATE/GROUP funding UI;
- successful paid period -> immutable/idempotent `SUBSCRIPTION_PERIOD` Grant scoped to PRIVATE by default;
- plan template `subscription_period_points` semantics;
- `ai_units_consumed`, `actualUnits`, aggregate quota live-balance paths removed;
- provider `reservationPoints` vocabulary and direct provider-usage imports;
- stale `OWNER_BOUND` -> `AI_RESPONSIBILITY_BOUND` runtime fix;
- retired GROUP recording preference removed;
- factual Admin profitability API/client/page without synthetic revenue;
- Drizzle config points only to `schema-all.ts`;
- known-stale baseline guard and fail-closed deployment helpers;
- hard-coded Workers account URL removed from deploy helpers.

## Remaining / blocking work

### 1. Regenerate baseline/snapshot/journal with the real project toolchain — primary blocker

The currently checked-in migration artifacts are still known stale and MUST NOT be applied.

From a real latest checkout:

1. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
2. inspect generated SQL/snapshot/journal;
3. if guard fails, inspect the **kept generated artifacts**, fix schema/product mismatches, and regenerate;
4. run `pnpm db:baseline:guard` until it passes.

Do not hand-edit/fabricate Drizzle snapshot metadata to silence the guard.

### 2. Apply to a fresh disposable PostgreSQL database

After a guard-passing regeneration:

- apply from an empty disposable DB;
- compare/export the resulting schema;
- validate FK/index/check/type names;
- exercise manual Record edit/move/batch/revision/confirmation SQL;
- exercise Grant reservation/commit/release/expiry/subsidy/concurrency SQL;
- verify that Grant status and used/reserved/remaining invariants hold under concurrent requests.

Only real PostgreSQL execution can validate these paths.

### 3. Validate Entity/Alias case-insensitive collision behavior on PostgreSQL

Current manual resolution compares titles/Aliases case-insensitively with `lower(...)`, while schema uniqueness is currently case-sensitive.

This may permit case-variant duplicates in principle. Do **not** blindly add expression indexes from static inspection. During the fresh DB batch, reproduce the collision behavior and then choose the smallest DB-level normalization/uniqueness fix that preserves accepted user-facing title semantics.

### 4. Real TypeScript/test/build/runtime validation remains mandatory

Run locally/runtime, not GitHub Actions:

- API/Web/Admin TypeScript typecheck;
- lint/build;
- targeted/full Vitest including point ledger, subscription-period retry, profitability and `routes-version-ordering`;
- PWA CRUD/version/move/batch/delete/restore browser/API behavior;
- PRIVATE/GROUP membership and Grant funding authorization;
- Admin `/profitability` browser smoke;
- LINE CREATE/HISTORY/Reply EDIT + confirmation flows;
- Gemini usage/pricing snapshots;
- Worker dry-run/runtime readiness.

### 5. Payment/TOP_UP remains separate product/payment work

No durable successful-payment revenue ledger exists yet. Do not synthesize revenue, fees, refunds, proration, top-up margin or upgrade/downgrade behavior from plan list price/current subscription state.

## Next implementation target

Continue from this exact checkpoint. Do not redo PWA stale-version ordering, Grant status sync, profitability used/reserved separation, subscription-period retry, provider naming or completed Source/Record/LINE behavior.

1. Obtain/use a real latest checkout with the pinned pnpm/Drizzle toolchain.
2. Run the safe baseline regeneration command and inspect/fix any guard-visible drift.
3. Apply the guard-passing baseline to fresh disposable PostgreSQL and fix every real schema/SQL mismatch.
4. Validate Entity/Alias case collision behavior in that DB and harden only if reproduced/needed.
5. Run API/Web/Admin typecheck/lint/build and targeted/full Vitest.
6. Run browser/Worker/LINE/Gemini smoke as available. Only after these checks should workers.dev deployment readiness be reconsidered.

## Validation status

This batch performed source/document audit and direct GitHub source edits only.

A local clone was retried and failed with DNS resolution for `github.com`; no mounted project checkout/toolchain was available.

Test source was authored/updated, but **no test was executed in this environment**.

**Not executed:**

- `pnpm db:baseline:regenerate`;
- `pnpm db:baseline:guard`;
- TypeScript typecheck;
- lint/build;
- Vitest;
- Drizzle generate/export/migrate;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker dry-run/runtime/deploy;
- LINE runtime;
- Gemini runtime.

Therefore no test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.**

Core non-payment product implementation is largely complete and the latest known static correctness bugs in migration safety, Grant state/accounting, subscription retry, Admin profitability and PWA stale-version side-effect ordering are now closed at source level.

The remaining launch blockers are operational validation blockers:

1. regenerate the known-stale Drizzle baseline/snapshot/journal with the real toolchain;
2. pass the baseline guard;
3. apply/validate on fresh PostgreSQL and fix real schema/SQL drift;
4. run real typecheck/test/build/browser/Worker/LINE/Gemini validation.

## Rough remaining work

Planning-only estimate from the current branch:

- Drizzle regeneration + guard-visible drift fixes + fresh PostgreSQL validation: **1 mandatory schema/database batch**;
- API/Web/Admin typecheck/Vitest/browser/Worker/LINE/Gemini validation and fixes: **1 mandatory validation batch**;
- payment/TOP_UP plus undefined refund/proration/upgrade policy: separate future payment/product work unless launch scope explicitly requires it.
