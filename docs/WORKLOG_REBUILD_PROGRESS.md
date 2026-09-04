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

## Current execution checkpoint — 2026-09-04 AI usage accounting batch

This batch re-read every required product/development/deployment document, checked the previous checkpoint against the actual `revive/line-worklog` branch, and continued from the stated accounting cleanup target without redoing the already-completed Source/Record/PWA/LINE/Grant/subscription-period work.

The completed implementation sub-batch removes the last known **duplicate persisted customer AI-charge column** from the current TypeScript schema and executable point-ledger settlement SQL:

- removed `worklog_ai_usage_events.ai_units_consumed` from `schema-worklog-ai-usage.ts`;
- removed `ai_units_consumed` from the ledger's `INSERT INTO worklog_ai_usage_events` statement;
- retained `customer_points_charged` as the single authoritative persisted customer charge for each successful provider usage event;
- retained `platform_subsidized_points` plus provider USD/TWD cost facts independently;
- changed the point-ledger repository to import `WorklogAiUsageCommit` directly from `ai-provider-usage.ts` instead of the transitional subscription compatibility barrel.

The ledger still computes `actualPoints` from immutable provider cost and the frozen output-token reference price at settlement. That value is used to split customer charge vs platform subsidy, but is no longer copied into a second legacy `ai_units_consumed` column.

The physical Drizzle baseline/snapshot were intentionally not hand-edited. They remain stale and are still a deployment blocker until the final TypeScript schema is regenerated using the actual project toolchain and applied to a fresh disposable PostgreSQL database.

## Scanned this run

- all required durable product/development/deployment documents;
- latest progress checkpoint and current branch HEAD;
- `apps/api/src/db/schema-worklog.ts` to reconfirm Source/workspace semantics;
- `apps/api/src/db/schema-worklog-ai-usage.ts`;
- `apps/api/src/worklog/ai-provider-usage.ts`;
- `apps/api/src/worklog/ai-point-ledger.ts` and `ai-point-ledger.test.ts`;
- `apps/api/src/worklog/drizzle-ai-point-ledger.ts`;
- `apps/api/src/worklog/subscription.ts` compatibility barrel;
- text CREATE provider/service and durable normalization repository;
- attachment provider/service and durable ingestion repository;
- Reply-targeted LINE AI EDIT service and durable edit repository;
- durable JSON replay/parsing paths for provider usage snapshots.

The scan confirmed that persisted point accounting readers already rely on `customer_points_charged` / `platform_subsidized_points`; `ai_units_consumed` was only a redundant compatibility write in the current point-ledger usage event path.

## Files changed this run

- `apps/api/src/db/schema-worklog-ai-usage.ts`
- `apps/api/src/worklog/drizzle-ai-point-ledger.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. `ai_units_consumed` is removed from the current source-of-truth schema

`worklog_ai_usage_events` now has one customer charge fact:

- `customer_points_charged`

and one separate subsidy fact:

- `platform_subsidized_points`

Provider token/modality usage and provider USD/TWD cost remain immutable factual accounting. This matches the accepted AI point policy and prevents a future regenerated baseline from encoding two competing customer-consumption columns.

Do not add `ai_units_consumed` back as a compatibility alias in the prelaunch schema. There is no production-customer migration requirement that justifies keeping this duplicate field.

### 2. Point-ledger settlement no longer writes the legacy duplicate value

`DrizzleWorklogAiPointLedgerRepository.commitReservationAtomic` still:

- recomputes actual AI points from provider cost in `WorklogAiPointLedgerService`;
- charges no more than the held eligible customer points;
- floors the customer balance at zero;
- records excess actual points as platform subsidy;
- persists provider usage/cost and customer/subsidy split exactly once by reservation token;
- attributes charged points to the actual Grant/Grant Scope funding rows.

The usage-event insert no longer stores `${input.actualPoints}` into a second `ai_units_consumed` column. `customer_points_charged = transitioned.points_committed` is now the single persisted customer charge on the usage event.

### 3. Remaining `Units` naming was traced but not partially renamed

The branch still has non-persisted compatibility terminology:

- `WorklogAiUsageCommit.actualUnits`;
- point/service/provider APIs such as `requestedUnits` and `reservationUnits`;
- durable provider-result JSON parsers that currently require/read `actualUnits` for replay even though the ledger does not use it for authoritative settlement;
- several files still import the usage type through `subscription.ts`, which is now only a compatibility barrel.

These references span text CREATE, attachment ingestion, LINE EDIT, their repositories, tests and provider interfaces. They were deliberately not renamed piecemeal in this batch because doing only one side would create a TypeScript/runtime replay mismatch. The next cleanup must change the contract and all durable serializers/parsers/callers together.

### 4. Workspace remains technical-only, not product Owner

The scan reconfirmed the current boundary:

- Source rows carry no product Owner/subscription-owner identity;
- GROUP manual authorization is active membership;
- GROUP AI funding is `worklog_source_ai_responsibility` plus eligible user-owned Grant scopes;
- `worklog_workspaces.owner_user_id` remains only the transitional storage-parent/bootstrap identity while `workspace_id` is still referenced by Source/audit/provider-usage structures.

Do not use workspace ownership for GROUP access, payment responsibility or AI 額度負責人 decisions.

## Stable completed foundation from earlier batches

Do not redo unless an actual regression is found:

- Source + single Entity/title + Alias + Record + immutable Revision core;
- Customer/Project/Finance/Transaction/category/normalized-summary removed from customer Record core/UI/API;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization = active membership, independent from subscription/AI points;
- GROUP Source existence independent from AI funding responsibility;
- old pending-group runtime/schema removed;
- bounded single-title/`occurred_at` Gemini CREATE interpretation;
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
- plan template uses `subscription_period_points` / `subscriptionPeriodPoints`, not live aggregate allowance naming;
- Admin overview surfaces customer-charged points plus platform subsidy points/cost;
- attachment usage operations are deterministic `AUDIO_RECORD_CREATE` / `IMAGE_RECORD_CREATE` / `FILE_RECORD_CREATE`;
- retired `groupCollaboration`, `maxGroupCount`, aggregate entitlement/quota helper contracts removed from current entitlement/collaboration paths;
- stale bootstrap/collaboration/GROUP LINE runtime tests from the Owner/quota model rewritten to the current Source/member/AI-responsibility/Grant contracts.

## Remaining / blocking work

### 1. Finish non-persisted AI point vocabulary cleanup as one coordinated contract batch

Next trace/change together:

- remove `WorklogAiUsageCommit.actualUnits` because authoritative settlement derives points from provider cost;
- update durable text/attachment/edit usage JSON serializers/parsers so replay does not require `actualUnits`;
- rename customer-point hold APIs from `requestedUnits` to `requestedPoints` where semantics are points;
- rename provider `reservationUnits` surfaces to explicit point-estimate naming where practical;
- switch remaining provider-usage imports from the transitional `subscription.ts` barrel to `ai-provider-usage.ts`.

Do not change modality counters such as `audioInputUnits` / `imageInputUnits` merely because they contain the word `Units`; those are provider usage measurement fields, not customer aggregate quota terminology.

### 2. Continue targeted stale-contract audit

Continue checking peripheral files for concrete remnants of:

- Source Owner / owner binding;
- `subscription_owner_user_id`;
- aggregate quota/allowance as live balance;
- `groupCollaboration` / `maxGroupCount`;
- old Owner-controlled recording authorization;
- Customer/Project/Transaction/category/normalized-summary Record assumptions.

Do not remove generic anomaly/audit fields named `category` or `summary`; those are unrelated to the obsolete Record normalization model.

### 3. Admin profitability reporting still needs the full factual workflow

Current Admin Overview shows basic charged/subsidy/cost facts, but the AI point policy still requires a proper selectable reporting workflow using immutable usage facts:

- today / 7d / 30d / current billing month;
- requests, charged points, subsidized points, provider USD/TWD cost;
- active user / charged user averages and medians where meaningful;
- Grant utilization/exhaustion;
- FREE usage/subsidy/conversion facts where those events are actually measurable;
- breakdowns by Grant type, plan association where factual, model, operation/input type and PRIVATE/GROUP;
- realized AI cost ratio/gross margin only when real successful-payment revenue facts exist;
- pricing recommendation calculator based on Admin-entered price, target margin and model pricing snapshot, with final included points explicitly confirmed by Admin.

Do not synthesize revenue from plan list price when no successful payment/revenue fact exists.

### 4. TOP_UP/payment lifecycle remains separate/unwired

The Grant model supports `TOP_UP`, but no payment-provider success boundary exists yet. A future successful purchase must create one immutable/idempotent TOP_UP Grant keyed by external purchase identity.

Undefined mid-period upgrade/downgrade/refund/proration behavior must continue to fail closed until product policy explicitly defines it.

### 5. Transitional workspace storage parent remains

Keep workspace technical-only for now. Removing it requires a coordinated schema/bootstrap/audit/provider-usage change and is not required to preserve the accepted Source/member/Grant authorization model.

### 6. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and the journal do not represent the current TypeScript schema. The old baseline still contains obsolete Customer/Project/Transaction/Owner/aggregate-accounting structures, including the legacy AI usage column removed from current source in this batch.

Regenerate from a checked-out current branch with the real project toolchain; do not hand-fabricate the large snapshot. Apply the generated baseline to a fresh disposable PostgreSQL database before any Worker deployment.

### 7. Real runtime validation is still mandatory

Before deployment, execute locally/runtime, not GitHub Actions:

- TypeScript typecheck/build;
- Vitest suites for point ledger, text normalization, attachment ingestion, LINE EDIT, plan contracts and stale-contract rewrites;
- fresh disposable PostgreSQL migration;
- Grant reservation/settlement/subsidy/concurrency tests;
- manual CRUD/version/revision/delete/restore tests;
- CREATE/HISTORY/Reply EDIT and both confirmation-operation tests;
- PRIVATE/GROUP funding authorization tests;
- browser/PWA smoke;
- LINE/Gemini runtime smoke as available;
- Workers deployment-readiness checks from `WORKLOG_DEPLOYMENT.md`.

## Next implementation target

Continue from this exact checkpoint. Do not redo subscription-period Grant creation, plan-template naming, PWA funding, LINE edit confirmation UX, or the removed `ai_units_consumed` column.

1. Complete the coordinated `actualUnits` / `requestedUnits` / provider `reservationUnits` point-vocabulary cleanup across interfaces, durable JSON replay parsers, callers and tests.
2. Continue focused peripheral stale-contract scan and fix only concrete mismatches.
3. Implement the first full Admin profitability reporting endpoint/view with selectable factual periods and cost/point/request/user/model/operation/Source-type breakdowns. Do not synthesize revenue.
4. Regenerate Drizzle baseline/snapshot from the final schema with a real local toolchain and apply to disposable PostgreSQL.
5. Run concentrated local/runtime validation. Only after those checks should Workers deployment readiness be reconsidered.

## Validation status

This batch performed static branch/document cross-file audit and GitHub source edits only.

**Not executed:** TypeScript typecheck, build, Vitest, PostgreSQL, Drizzle generation/apply, browser/PWA runtime, Cloudflare Worker runtime, LINE runtime, Gemini runtime, or deployment.

Therefore no test/build/runtime result is claimed as passing.

A direct local clone attempt was not usable in this execution environment because outbound GitHub DNS/network resolution failed, so local package scripts and migration generation could not be run here. This was not substituted with GitHub Actions.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.** Main blockers are the remaining coordinated point-vocabulary cleanup, stale Drizzle baseline/snapshot, and lack of real local/PostgreSQL/runtime validation. The duplicate persisted `ai_units_consumed` debt itself is now removed from current source and executable settlement SQL.

## Rough remaining work

Planning-only estimate from the current branch state:

- core Record/domain/manual PWA/LINE CREATE-HISTORY-EDIT/Grant funding/subscription-period behavior: largely implemented;
- remaining non-payment accounting/stale-contract cleanup before migration regeneration: roughly **1 focused contract batch**;
- factual Admin profitability reporting: roughly **1 focused reporting batch**;
- migration regeneration + disposable PostgreSQL + typecheck/Vitest/runtime smoke: **1 mandatory validation batch**;
- real payment/TOP_UP and undefined proration/refund policy remain separate product/payment work unless launch scope later explicitly requires them.
