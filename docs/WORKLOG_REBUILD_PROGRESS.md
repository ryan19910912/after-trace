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

## Current execution checkpoint — 2026-09-04 migration workflow + accounting correctness batch

This batch started by re-reading all required durable documents and the latest branch checkpoint. It did **not** redo completed Source/Record/PWA/LINE CREATE-HISTORY-EDIT/Grant/subscription-period/Admin-profitability work.

The previous checkpoint had already completed provider `reservationPoints` naming, stale `OWNER_BOUND` cleanup, retired GROUP recording preference removal, Drizzle `schema-all.ts` authority, baseline guard, fail-closed deploy helpers and hard-coded Workers URL removal.

This batch focused on concrete correctness gaps found while tracing the final migration/accounting paths.

## Scanned this run

- all eight required durable documents;
- current `revive/line-worklog` checkpoint and branch state;
- Drizzle config, root/API package scripts, baseline guard and current migration artifacts;
- Admin profitability repository/client/page;
- Grant reservation/settlement SQL and Grant scope accounting;
- subscription-period service/repository/tests;
- manual PWA Record routes including edit, move, batch move, delete, restore and revision SQL;
- Entity/Alias uniqueness schema and manual title resolution;
- local execution environment for a checked-out repo/toolchain.

A direct local clone was retried and still failed with `Could not resolve host: github.com`. A search of mounted `/mnt/data` and `/home/oai/share` also found no checked-out `after-trace` repo/toolchain. Therefore pnpm/TypeScript/Vitest/Drizzle/PostgreSQL could not be honestly executed in this run.

## Files changed this run

- `scripts/regenerate-worklog-baseline.mjs` — new explicit prelaunch regeneration workflow
- `package.json` — added `db:baseline:regenerate`
- `apps/api/src/admin/profitability.ts`
- `apps/admin/src/api.ts`
- `apps/admin/src/ProfitabilityPage.tsx`
- `apps/api/src/worklog/subscription-period.ts`
- `apps/api/src/worklog/subscription-period.test.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. Prelaunch baseline regeneration now has one explicit fail-closed command

New command:

`pnpm db:baseline:regenerate --confirm-prelaunch-reset`

The script:

- refuses to run without the explicit prelaunch-reset flag;
- requires usable DB configuration because `drizzle.config.ts` itself fails closed without `DATABASE_URL`;
- backs up the currently checked-in baseline/snapshot/journal;
- removes the old Drizzle artifact directory;
- regenerates from `apps/api/src/db/schema-all.ts` using the project-pinned Drizzle toolchain;
- restores the old artifacts if generation itself fails;
- requires regenerated `0000_worklog_baseline.sql`, snapshot and journal to exist;
- automatically runs `scripts/check-worklog-baseline.mjs` after generation;
- leaves guard-failing generated artifacts available for inspection while deployment remains blocked.

This command was authored but **not executed** in this environment.

### 2. Admin profitability now separates actual actors from charged/funding users

The previous report treated `charged_user_id` as the user count. That is wrong for GROUP usage because many group members may generate AI work while one AI 額度負責人 funds the Source.

The report now separately exposes:

- `activeUsers = COUNT(DISTINCT actor_user_id)`;
- `chargedUsers = COUNT(DISTINCT charged_user_id)`.

Breakdowns by model/operation/PRIVATE-GROUP carry both counts. The Admin page labels them separately as actual operators vs charged users/AI funding responsible users.

### 3. TWD averages no longer silently use partial cost coverage

Historical `provider_cost_twd` may be NULL when no USD/TWD snapshot existed. The report already exposed missing-TWD request counts; this batch also prevents misleading averages:

- USD averages remain available from complete USD provider-cost facts;
- TWD average per request / active user becomes `null` whenever any selected-period provider cost lacks TWD conversion;
- the Admin page renders these as `資料不完整` rather than dividing a partial TWD total by all requests.

### 4. Profitability gained factual historical plan attribution

The report now exposes `byPlan`, derived only from the Grant that actually funded each usage event:

- `FREE_INITIAL` -> `FREE`;
- `SUBSCRIPTION_PERIOD` -> frozen `grant.metadata.planCode`;
- other grants -> `UNASSOCIATED`.

It does **not** join current subscription state to rewrite history and does not synthesize revenue from plan list price.

### 5. Grant Inventory only includes currently valid Grants

Inventory now excludes future, expired and revoked Grants.

### 6. Grant utilization/exhaustion no longer confuses reservation holds with committed usage

Ledger tracing confirmed `reservePointsAtomic` immediately subtracts held points from `grant.remaining_points`, may temporarily set Grant status to `EXHAUSTED`, and later restores unused/released holds.

Therefore `remaining_points = 0` or transient `status = EXHAUSTED` is not sufficient evidence of real consumption.

The Admin inventory now separates:

- `usedPoints` = committed `worklog_ai_grant_scopes.used_points`;
- `reservedPoints` = in-flight `scope.reserved_points`;
- `remainingPoints` = currently unheld balance.

Committed utilization is `usedPoints / originalPoints` only. A Grant is counted as actually exhausted only when `remaining_points + reserved_points = 0`, so a Grant whose entire balance is merely held by an active provider request is not falsely reported as consumed.

### 7. Subscription-period retry remains idempotent after future plan-template changes

A concrete bug was fixed in `WorklogSubscriptionPeriodService.resolveActivePeriodRetry`.

Before this batch an exact retry of an already-created paid period compared the immutable historical Grant's `originalPoints` against **today's editable** `plan.subscriptionPeriodPoints`. If Admin changed the plan template for future renewals, an old period retry could stop being idempotent.

Now an exact active-period retry validates immutable identity only:

- same period start/end;
- same period origin key;
- historical Grant exists;
- Grant effective/expiry dates match the active period.

It does not compare the historical Grant point count with the current plan template. A focused test source covers an old 800,000-point PRO Grant remaining idempotent after the future PRO template changes to 1,200,000 points.

The test source was added/updated but **not executed**.

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

## Newly discovered concrete bug — next source-edit priority

### PWA stale-version requests can currently create orphan titles / incorrectly return no-op success

`apps/api/src/worklog/routes.ts` has a real ordering bug that was traced this run but not yet safely rewritten in this execution environment.

Single edit:

- `/records/:recordId` parses `expectedVersion` but a no-op text/time save can return success before checking that expected version equals the current Record version.

Single move:

- `/records/:recordId/move` calls `resolveManualEntity(...)` before an explicit version comparison;
- if the client is stale and submits a brand-new title, `resolveManualEntity` may create the Entity first;
- `mutateRecord` then returns `RECORD_VERSION_CONFLICT`, leaving an unused/orphan title behind;
- a stale no-op move can also return success before version conflict is surfaced.

Batch move:

- `/records/batch-move` also resolves/creates the target Entity before comparing all requested expected versions with loaded snapshots;
- a stale batch with a new title can therefore leave the same orphan-title side effect before returning 409.

Required fix next:

1. PATCH edit: compare `expectedVersion !== current.version` immediately after validating the version, before no-op success.
2. Single move: same early version comparison before `resolveManualEntity`.
3. Batch move: build the expected-version map and reject any mismatch **before** `resolveManualEntity`.
4. Add focused tests ensuring stale no-op edit/move returns 409 and stale new-title move/batch cannot create title side effects.

The lower-level `mutateRecord` SQL itself already performs version checking and inserts the immutable Revision in the same CTE statement; the discovered gap is the route-level side effect/order before that atomic mutation.

## Additional schema hardening observation — validate with PostgreSQL

Entity and Alias tables currently have case-sensitive unique indexes (`source_id + name`, `source_id + alias`), while manual resolution compares with `lower(...)`. Case-variant duplicates could therefore become ambiguous in principle.

Do not blindly add expression indexes without running the real Drizzle/PostgreSQL toolchain. Treat this as a schema-validation item during fresh PostgreSQL regeneration: verify whether normalized case-insensitive uniqueness should be enforced at DB level without breaking accepted title semantics.

## Remaining / blocking work

### 1. Fix the PWA stale-version/title side-effect ordering bug

This is the next source change before migration validation.

### 2. Regenerate baseline/snapshot/journal — primary deployment blocker

With a real checkout/toolchain:

1. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
2. `pnpm db:baseline:guard`
3. inspect generated baseline/snapshot/journal together

The currently checked-in baseline is still known stale and MUST NOT be applied.

### 3. Fresh disposable PostgreSQL validation

After regeneration:

- apply migration from empty DB;
- compare/export schema;
- test FK/index/check/type names;
- run Record mutation/revision/confirmation SQL;
- run Grant reservation/settlement/release/expiry/concurrency SQL;
- validate case-insensitive Entity/Alias collision behavior.

### 4. Real TypeScript/test/build/runtime validation

Run locally/runtime, not GitHub Actions:

- API/Web/Admin typecheck;
- lint/build;
- targeted/full Vitest including new subscription retry and profitability contracts;
- PWA CRUD/version/move/batch/delete/restore tests;
- PRIVATE/GROUP funding and membership auth;
- Admin profitability browser smoke;
- LINE CREATE/HISTORY/Reply EDIT/confirmation smoke;
- Gemini usage/pricing snapshot smoke;
- Worker dry-run/runtime readiness.

### 5. Payment/TOP_UP remains separate

No successful payment revenue ledger exists yet. Do not synthesize revenue, fees, refunds, proration, top-up margin or upgrade/downgrade behavior from plan list price/current subscription state.

## Next implementation target

Continue from this exact checkpoint; do not redo the completed accounting/profitability/subscription-period fixes.

1. Fix `routes.ts` stale-version ordering before any `resolveManualEntity` side effect/no-op success.
2. Add focused route tests for stale no-op and stale new-title move/batch behavior.
3. Obtain a real checkout/toolchain and regenerate all Drizzle baseline metadata together using the new regeneration command.
4. Run baseline guard and fresh disposable PostgreSQL apply/fix loop.
5. Run typecheck/lint/build/Vitest/browser/Worker/LINE/Gemini validation.

## Validation status

This run performed source/document audit and direct GitHub source edits only.

A local clone was retried and failed with DNS resolution for `github.com`; no mounted repo was available either.

**Not executed:**

- `pnpm db:baseline:regenerate`;
- `pnpm db:baseline:guard`;
- TypeScript typecheck;
- lint/build;
- Vitest;
- Drizzle generate/export/migrate;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker runtime/deploy;
- LINE runtime;
- Gemini runtime.

Therefore no test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.**

Core non-payment product implementation is largely complete. Current blockers are now concrete:

1. fix the newly found PWA stale-version/title side-effect ordering bug;
2. regenerate the known-stale Drizzle baseline/snapshot/journal;
3. apply/validate on fresh PostgreSQL;
4. run real local/runtime typecheck/test/build/browser/Worker/LINE/Gemini validation.

## Rough remaining work

Planning-only estimate:

- PWA stale-version route fix + focused tests: **1 small focused batch**;
- Drizzle regeneration + fresh PostgreSQL fixes: **1 mandatory schema batch**;
- typecheck/Vitest/browser/Worker/LINE/Gemini validation: **1 mandatory validation batch**;
- payment/TOP_UP and undefined proration/refund policy: separate future payment/product work unless launch scope explicitly requires it.
