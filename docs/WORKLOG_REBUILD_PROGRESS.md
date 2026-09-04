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

## Current execution checkpoint — 2026-09-04 13:30 batch

This batch re-read all required specifications and reconciled the previous checkpoint against the actual branch before modifying anything. It did not redo the already-completed Source/Record/LINE/Grant/subscription-period foundation.

The main completed batch was the remaining **plan-template aggregate-allowance terminology cleanup** plus two related accounting fixes:

1. plan configuration now uses explicit `subscription_period_points` / `subscriptionPeriodPoints` semantics from TypeScript schema through subscription-period persistence, customer subscription API/PWA and Admin API/UI;
2. Admin overview now actually displays customer-charged AI points and platform-subsidized points/cost that the backend was already calculating;
3. attachment AI usage now receives deterministic operation tags such as `IMAGE_RECORD_CREATE` instead of falling through to generic `UNKNOWN`.

The physical Drizzle baseline/snapshot were intentionally **not** hand-edited. They remain stale and are still the primary deployment blocker until regenerated from the final checked-out TypeScript schema and applied to a fresh PostgreSQL database.

## Scanned this run

- all required durable product/development/deployment documents;
- latest progress checkpoint and current branch state;
- `schema-worklog.ts` plan/Source/workspace structure;
- `subscription-period.ts` and `drizzle-subscription-period.ts`;
- customer subscription routes/client/page;
- Admin repository/routes/client/editor/overview;
- Admin route validation tests;
- attachment ingestion service/tests and AI usage operation persistence;
- AI point ledger settlement SQL and AI usage schema;
- `entitlements.ts` after the previous cleanup;
- bootstrap service + Drizzle bootstrap repository to trace remaining workspace dependency;
- auth repository to verify PWA authorization is Source/user/member based rather than workspace Owner based;
- Grant-backed usage service/repository/tests;
- current stale Drizzle baseline, confirming it still contains Customer/Project/Transaction/category/normalized-summary, Source Owner fields, aggregate AI units and the old plan-template column.

## Files changed this run

- `apps/api/src/db/schema-worklog.ts`
- `apps/api/src/worklog/drizzle-subscription-period.ts`
- `apps/api/src/worklog/subscription-routes.ts`
- `apps/api/src/admin/repository.ts`
- `apps/api/src/admin/routes.ts`
- `apps/api/src/admin/routes.test.ts`
- `apps/admin/src/api.ts`
- `apps/admin/src/App.tsx`
- `apps/web/src/worklog-api.ts`
- `apps/web/src/SubscriptionRoot.tsx`
- `apps/api/src/worklog/attachment-ingestion.ts`
- `apps/api/src/worklog/attachment-ingestion.test.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. Plan template no longer presents itself as a live aggregate AI allowance

The runtime/schema/API naming has been changed from the legacy:

- DB: `ai_allowance_units`
- TS/API: `aiAllowanceUnits`

into the explicit period-grant template:

- DB: `subscription_period_points`
- TS/API: `subscriptionPeriodPoints`

The value semantics did not change: it is the configured number of points frozen into a future immutable `SUBSCRIPTION_PERIOD` Grant. It is **not** a current balance and changing a plan template does not resize historical Grants.

Updated surfaces include:

- Drizzle plan schema;
- subscription-period repository plan SELECT/mapping;
- customer `/api/v1/subscription/plans` response;
- customer subscription PWA types/display;
- Admin plan repository/upsert;
- Admin route input contract;
- Admin client/editor labels and payload.

Admin route validation now includes a source test that the retired `aiAllowanceUnits` request field is rejected before persistence instead of being silently accepted as the new model.

Do not add a compatibility alias back unless an actual external production client requires a deliberate migration. There is no production-customer compatibility requirement in the current prelaunch rebuild.

### 2. Admin overview now surfaces already-accounted charged/subsidized facts

The backend already calculated:

- customer-charged AI points;
- platform-subsidized AI points;
- total provider cost in TWD;
- platform-subsidized provider cost in TWD.

The Admin Overview UI now displays all four instead of hiding the subsidy split. This makes Grant overrun/platform subsidy visible without exposing internal provider pricing to the customer PWA.

This is still only the first profitability view. Period selection, cohort/breakdown reporting and pricing calculator remain below.

### 3. Attachment AI operations are now deterministically classified

Attachment usage used to omit `operation`, causing `DrizzleWorklogAiPointLedgerRepository` to persist `UNKNOWN` even though the provider output had already identified the durable Record input type.

New attachment calls now set:

- `AUDIO_RECORD_CREATE`
- `IMAGE_RECORD_CREATE`
- `FILE_RECORD_CREATE`

based strictly on `provider.output.inputType`.

This does not call AI again, does not use legacy category/summary concepts and does not alter point settlement. The attachment service test source now asserts `IMAGE_RECORD_CREATE` on the successful image path.

Existing historical/durable replay payloads without an operation remain readable because the usage contract still permits missing operation and the ledger retains `UNKNOWN` as a compatibility fallback.

### 4. Workspace trace confirms it is technical storage debt, not product Owner semantics

The remaining `worklog_workspaces.owner_user_id` was traced further rather than deleted blindly.

Current facts:

- `WorklogBootstrapService` still calls `ensureWorkspace(userId)` before creating PRIVATE Source and before first creation of a GROUP Source;
- `DrizzleWorklogBootstrapRepository` persists one workspace per user and every Source still has a non-null `workspace_id` FK;
- GROUP authorization itself does not consult workspace owner: active membership controls data access;
- GROUP AI funding does not consult workspace owner: `worklog_source_ai_responsibility` + user-owned Grant scopes control funding;
- web auth private entry validation uses the PRIVATE Source/user relationship directly, not workspace ownership;
- audit/provider-usage schemas still carry optional `workspace_id` references.

Therefore workspace deletion is **not** a low-risk one-field cleanup. It would require a coordinated schema/bootstrap/audit/usage migration. Until that is deliberately done, `owner_user_id` must remain documented and treated strictly as a technical storage-parent identity, never as Source Owner, group permission, subscription payer or AI 額度負責人.

### 5. Current TypeScript Source schema and old baseline are intentionally divergent until regeneration

The current TypeScript Source schema already has no:

- Source `owner_user_id`;
- owner binding method/time;
- `subscription_owner_user_id`;
- Customer/Project/Transaction/category/normalized-summary Record core.

The checked-in `drizzle/0000_worklog_baseline.sql` still contains all of those obsolete structures plus `ai_allowance_units` and `ai_units_consumed`. This is confirmed stale migration debt, not the current product model.

Do not patch individual lines into the historical 0000 snapshot. Regenerate the baseline/snapshot from the final TypeScript schema using the real project toolchain, then apply it to a fresh disposable PostgreSQL database.

## Stable completed foundation from earlier batches

Do not redo unless an actual regression is found:

- Source + single Entity/title + Alias + Record + immutable Revision core;
- Customer/Project/Finance/Transaction/category/normalized-summary removed from customer Record core/UI/API;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization = active membership, independent from subscription/AI points;
- GROUP Source independent from AI funding responsibility;
- old pending-group runtime/schema removed;
- single-title/`occurred_at` Gemini CREATE interpretation;
- durable CREATE Pending Confirmation and safe PWA resolution;
- deterministic HISTORY -> Source-correct filtered PWA links;
- deterministic same-Source Reply target resolution;
- durable GROUP/PRIVATE Reply-targeted LINE AI EDIT provider pipeline;
- LINE_AI_EDIT durable proposal, optimistic Record version guard and immutable Revision;
- LINE_AI_EDIT Pending Confirmation current-vs-proposed PWA UX and no second AI charge;
- bot success-message -> Record Reply mapping;
- FREE initial Grant = exactly 400,000 AI points once, idempotent, no refresh/expiry;
- text and attachment provider execution use user-owned Grants/scopes/caps;
- full provider cost -> frozen output-price-equivalent AI points;
- customer balance floors at zero; provider overrun becomes platform subsidy;
- GROUP charged-user resolution via `worklog_source_ai_responsibility`;
- Grant-backed GROUP funding/allocation PWA;
- Grant-backed PRIVATE funding PWA;
- Admin customer/group usage reporting based on Grants/responsibility/provider-cost facts;
- normalization reservation FK points to Grant-backed point reservations;
- successful paid subscription period -> immutable/idempotent `SUBSCRIPTION_PERIOD` Grant with PRIVATE scope;
- retired `groupCollaboration`, `maxGroupCount`, aggregate entitlement/quota helper contracts removed from current entitlement/collaboration paths;
- stale bootstrap/collaboration/GROUP LINE runtime tests from the Owner/quota model rewritten to the current Source/member/AI-responsibility/Grant contracts.

## Remaining / blocking work

### 1. Finish stale terminology/data-column cleanup in AI usage accounting

One important compatibility remnant was found during this run:

- `worklog_ai_usage_events.ai_units_consumed` still exists in the current TypeScript AI usage schema;
- AI point settlement still writes `actualPoints` into that legacy column even though all current readers use `customer_points_charged` and `platform_subsidized_points`;
- `WorklogAiUsageCommit.actualUnits` and some reservation APIs still use legacy `Units` naming even though the actual semantics are points.

Before migration regeneration, trace all references and remove/rename these compatibility remnants only if there are no current callers/readers. Do not preserve `ai_units_consumed` as a second authoritative customer balance fact.

### 2. Continue targeted stale-contract audit

The highest-risk old test/contracts were already cleaned, but continue checking peripheral files for:

- Source Owner / owner binding;
- `subscription_owner_user_id`;
- aggregate quota/allowance as live balance;
- `groupCollaboration` / `maxGroupCount`;
- old `authorizeGroupRecord` / Owner-controlled recording semantics;
- Customer/Project/Transaction/category/normalized-summary Record assumptions.

Do not remove generic anomaly/audit fields named `category` or `summary`; those are unrelated to the obsolete customer Record normalization model.

### 3. Admin profitability still needs the full reporting workflow from the AI point policy

Now-visible today metrics are not the complete required Admin reporting.

Still needed, using actual immutable usage/cost facts:

- selectable today / 7d / 30d / current billing month;
- total requests/points/provider USD+TWD cost;
- request/user/subscriber averages and medians where enough data exists;
- allowance utilization/exhaustion;
- FREE subsidy/conversion;
- realized AI cost ratio / gross margin where real revenue exists;
- breakdowns by plan, Grant type, model, operation/input type and PRIVATE/GROUP;
- pricing recommendation calculator using Admin-entered price/target margin/model snapshot and explicit Admin-confirmed included points.

Do not invent revenue from plan list price when no successful payment/revenue fact exists.

### 4. TOP_UP/payment lifecycle remains unwired

The Grant model supports `TOP_UP`, but there is no real payment-provider success boundary yet. Each future successful purchase must create one immutable/idempotent user-owned TOP_UP Grant keyed by the external purchase identity. Do not fake provider behavior merely to complete schema work.

Undefined mid-period upgrade/downgrade/refund/proration behavior must continue to fail closed until product policy explicitly defines it.

### 5. Transitional workspace storage parent remains

Keep workspace technical-only for now. A later structural simplification may remove it, but only as a coordinated schema/bootstrap/audit/provider-usage change after current migration/runtime validation is stable. It is not a blocker to the Source/member/Grant product semantics because those paths already do not authorize by workspace Owner.

### 6. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and journal do not represent the current TypeScript schema.

Regenerate from a checked-out current branch with the project toolchain; do not hand-fabricate the large snapshot. Apply the generated baseline to a fresh disposable PostgreSQL database before any Worker deployment.

### 7. Real runtime validation is still mandatory

Before deployment, execute locally/runtime, not GitHub Actions:

- TypeScript typecheck/build;
- Vitest suites, especially plan-contract and attachment-operation tests changed this batch plus stale-contract tests from the previous batch;
- fresh disposable PostgreSQL migration;
- Grant reservation/settlement/subsidy/concurrency tests;
- manual CRUD/version/revision/delete/restore tests;
- CREATE/HISTORY/Reply EDIT and both confirmation operation tests;
- PRIVATE/GROUP funding authorization tests;
- browser/PWA smoke;
- LINE/Gemini runtime smoke as available;
- Workers deployment-readiness checks from `WORKLOG_DEPLOYMENT.md`.

## Next implementation target

Continue from this exact checkpoint; do not redo subscription-period Grant creation, plan-template naming, PWA funding, or LINE edit confirmation UX.

1. Trace and remove/rename remaining `ai_units_consumed` / `actualUnits` / point-ledger `requestedUnits` compatibility terminology so customer point accounting has one authoritative vocabulary and one authoritative persisted charged-point fact.
2. Continue focused peripheral stale-contract scan; fix only concrete mismatches.
3. Add the first full Admin profitability reporting endpoint/view with selectable periods and factual cost/point/request/user breakdowns. Do not synthesize revenue or margin without real revenue data.
4. Keep workspace as technical-only unless a complete removal change can be made safely in one coordinated schema batch.
5. Regenerate Drizzle baseline/snapshot from the final schema with a real local toolchain and apply to disposable PostgreSQL.
6. Run concentrated local/runtime validation. Only after those checks should Workers deployment readiness be reconsidered.

## Validation status

This batch performed static branch/document cross-file audit and GitHub source edits only.

**Not executed:** TypeScript typecheck, build, Vitest, PostgreSQL, Drizzle generation/apply, browser/PWA runtime, Cloudflare Worker runtime, LINE runtime, Gemini runtime, or deployment.

Therefore no test/build/runtime result is claimed as passing. The changed tests are specification-aligned source changes, not executed proof.

A local repository checkout was not available in this execution environment, so migration generation and local package scripts could not be run here.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.** Main blockers are stale Drizzle baseline/snapshot plus lack of real local/PostgreSQL/runtime validation. The remaining `ai_units_consumed` compatibility column/terminology should also be resolved before final migration regeneration so the new baseline does not encode avoidable legacy accounting debt.

## Rough remaining work

Planning-only estimate from the current branch state:

- core Record/domain/manual PWA/LINE CREATE-HISTORY-EDIT/Grant funding/subscription-period behavior: largely implemented;
- remaining non-payment implementation/audit before migration regeneration: roughly **1 focused accounting/stale-contract cleanup batch**;
- Admin profitability reporting: roughly **1 focused reporting batch** for the factual non-payment analytics, with real revenue/margin views extending only when payment revenue facts exist;
- migration regeneration + disposable PostgreSQL + typecheck/Vitest/runtime smoke: **1 mandatory validation batch**;
- real payment/TOP_UP and undefined proration/refund policy remain separate product/payment work and are not blockers to finishing the current non-payment refactor unless launch scope explicitly requires them.
