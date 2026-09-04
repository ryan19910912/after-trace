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

## Current execution checkpoint — 2026-09-04 provider-cost point contract cleanup

This batch continued immediately from the prior accounting checkpoint. It did not redo completed Source/Record/PWA/LINE/Grant/subscription-period work.

The main completed change is that customer AI accounting now has one coherent runtime contract:

- durable provider usage snapshots no longer write or require `actualUnits`;
- `WorklogAiUsageCommit` contains only factual provider usage/pricing/cost plus optional Record/workspace/operation attribution;
- customer hold APIs now use `requestedPoints`, not `requestedUnits`;
- actual customer points are always derived during settlement from immutable `providerCostUsd` and the frozen output-token reference price;
- customer charge remains persisted only as `customer_points_charged`, with provider overrun separately recorded as `platform_subsidized_points`;
- TEXT CREATE, attachment ingestion and Reply-targeted LINE AI EDIT new provider-result writes no longer serialize `actualUnits`;
- TEXT and attachment durable replay parsers accept the new format and ignore any old prelaunch extra `actualUnits` field if present;
- provider modality counters `audioInputUnits` / `imageInputUnits` remain because they are factual provider usage measurements, not customer quota/accounting units.

A stale test contract was also found and corrected: `text-normalization-persistence.test.ts` still imported the removed aggregate-quota `WorklogTextNormalizationSubscriptionPort` and used `unitsReserved` / `remainingAiUnits`. It now uses the Grant-backed AI point port and point-reservation snapshot.

Provider implementations still expose the internal method name `reservationUnits(...)` even though its return value is already an AI-point hold estimate. This is now a naming-only cleanup item; authoritative accounting and durable replay no longer depend on old unit semantics. Rename it coherently across all three provider interfaces/implementations/tests when convenient, but do not confuse `audioInputUnits` / `imageInputUnits` with customer AI points.

## Scanned this run

- all required durable product/development/deployment documents;
- latest progress checkpoint and current `revive/line-worklog` branch;
- `ai-provider-usage.ts`;
- `ai-point-ledger.ts` and its test;
- TEXT CREATE service/provider/repository/replay tests;
- attachment service/provider/repository/replay tests;
- Reply-targeted LINE AI EDIT service/repository/provider path;
- transitional `subscription.ts` usage barrel;
- stale persistence-uncertainty test contracts.

## Files changed this run

- `apps/api/src/worklog/ai-provider-usage.ts`
- `apps/api/src/worklog/ai-point-ledger.ts`
- `apps/api/src/worklog/text-normalization.ts`
- `apps/api/src/worklog/attachment-ingestion.ts`
- `apps/api/src/worklog/line-record-edit.ts`
- `apps/api/src/worklog/drizzle-text-normalization.ts`
- `apps/api/src/worklog/drizzle-attachment-ingestion.ts`
- `apps/api/src/worklog/ai-point-ledger.test.ts`
- `apps/api/src/worklog/text-normalization.test.ts`
- `apps/api/src/worklog/attachment-ingestion.test.ts`
- `apps/api/src/worklog/text-normalization-persistence.test.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. `actualUnits` is removed from the provider-usage contract

`WorklogAiUsageCommit.actualUnits` is gone. New TEXT, attachment and LINE EDIT durable provider usage snapshots contain provider facts such as:

- provider/model;
- input/output tokens;
- modality subsets where factual;
- pricing snapshot;
- provider USD/TWD cost;
- operation/Record/workspace attribution where available.

The Grant ledger independently converts immutable provider cost to AI points when settling the reservation. There is no second mutable or replay-dependent customer-consumption value in provider-result JSON.

### 2. TEXT and attachment replay no longer depend on legacy unit JSON

`DrizzleWorklogTextNormalizationRepository` and `DrizzleWorklogAttachmentRepository` no longer parse or require `actualUnits`. This matters for Worker recovery after provider success when the provider result is durable but point settlement/application is unfinished.

Old prelaunch JSON that contains an extra `actualUnits` property remains readable because the parsers ignore unknown extra fields. New JSON omits it.

LINE EDIT durable replay already used the stored usage object without an `actualUnits`-specific parser; its new writes now also omit the field.

### 3. Customer hold APIs use point vocabulary

The Grant-backed point ledger and TEXT/attachment/LINE EDIT callers now use `requestedPoints`. The repository layer already used `requestedPoints`, so the public execution contract now matches the actual ledger semantics.

The remaining provider method name `reservationUnits` is only an internal naming inconsistency. Its implementations already convert conservative provider-token/cost estimates into AI points before returning.

### 4. Stale aggregate-quota persistence test removed

`text-normalization-persistence.test.ts` no longer imports or constructs the removed subscription/aggregate-quota port. Its fixtures now use:

- `WorklogTextNormalizationAiPointPort`;
- `pointsReserved` / `pointsCommitted`;
- `platformSubsidizedPoints`;
- `requestedPoints`.

The uncertainty rule is unchanged: if provider success may have happened but durable result persistence fails, do not release the hold and do not automatically call the provider again.

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
- successful paid subscription period -> immutable/idempotent `SUBSCRIPTION_PERIOD` Grant with PRIVATE scope;
- plan template uses `subscription_period_points` / `subscriptionPeriodPoints`, not live aggregate allowance naming;
- Admin overview surfaces customer-charged points plus platform subsidy points/cost;
- attachment usage operations are deterministic `AUDIO_RECORD_CREATE` / `IMAGE_RECORD_CREATE` / `FILE_RECORD_CREATE`;
- retired `groupCollaboration`, `maxGroupCount`, aggregate entitlement/quota helper contracts removed from current entitlement/collaboration paths;
- persisted `worklog_ai_usage_events.ai_units_consumed` removed from current source and executable settlement SQL.

## Remaining / blocking work

### 1. Small provider naming / compatibility cleanup

Trace and coherently rename provider-only `reservationUnits(...)` to explicit point-estimate naming across:

- TEXT provider interface + Gemini implementation/tests;
- attachment provider interface + Gemini implementation/tests;
- LINE EDIT provider interface + Gemini implementation/tests.

Also switch remaining `WorklogAiUsageCommit` imports from `subscription.ts` to `ai-provider-usage.ts` where practical. These are cleanup items, not alternate accounting sources.

Do not rename `audioInputUnits` / `imageInputUnits`; they are provider modality usage facts.

### 2. Continue targeted stale-contract audit

Check peripheral files for concrete remnants of:

- Source Owner / owner binding;
- `subscription_owner_user_id`;
- aggregate quota/allowance as live balance;
- `groupCollaboration` / `maxGroupCount`;
- old Owner-controlled recording authorization;
- Customer/Project/Transaction/category/normalized-summary Record assumptions;
- tests or fixtures that still construct old subscription/quota reservation shapes.

Do not remove generic anomaly/audit fields named `category` or `summary`; those are unrelated to the obsolete Record model.

### 3. Admin profitability reporting still needs the full factual workflow

Current Admin Overview shows basic charged/subsidy/cost facts, but the accepted AI point policy still needs a selectable factual report:

- today / 7d / 30d / current billing month;
- request count, charged points, subsidized points, provider USD/TWD cost;
- charged-user / active-user averages and medians where factual and meaningful;
- Grant utilization/exhaustion;
- breakdowns by Grant type, factual plan association, model, operation/input type and PRIVATE/GROUP;
- realized cost ratio/gross margin only when successful-payment revenue facts actually exist;
- no synthetic revenue from plan list price.

### 4. TOP_UP/payment lifecycle remains separate/unwired

The Grant model supports `TOP_UP`, but no payment-provider success boundary exists yet. A future successful purchase must create one immutable/idempotent TOP_UP Grant keyed by external purchase identity.

Undefined mid-period upgrade/downgrade/refund/proration behavior must continue to fail closed until product policy explicitly defines it.

### 5. Transitional workspace storage parent remains technical-only

`worklog_workspaces.owner_user_id` remains a storage/bootstrap parent while Source/audit/provider-usage structures still reference `workspace_id`. It must not be used as GROUP access, payment responsibility or AI 額度負責人 authority.

Removing workspace requires a coordinated schema/bootstrap/audit/provider-usage migration and is not required before the accepted Source/member/Grant authorization model can function.

### 6. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and the journal do not represent the current TypeScript schema. Do not hand-fabricate the large Drizzle snapshot.

Regenerate from a checked-out current branch with the real project toolchain and apply to a fresh disposable PostgreSQL database before any Worker deployment.

### 7. Real runtime validation is mandatory

Before deployment execute locally/runtime, not GitHub Actions:

- TypeScript typecheck/build;
- Vitest suites for point ledger, text normalization, persistence uncertainty, attachment ingestion, LINE EDIT and stale-contract rewrites;
- fresh disposable PostgreSQL migration;
- Grant reservation/settlement/subsidy/concurrency tests;
- manual CRUD/version/revision/delete/restore tests;
- CREATE/HISTORY/Reply EDIT and confirmation-operation tests;
- PRIVATE/GROUP funding authorization tests;
- browser/PWA smoke;
- LINE/Gemini runtime smoke as available;
- Workers deployment-readiness checks from `WORKLOG_DEPLOYMENT.md`.

## Next implementation target

Continue from this exact checkpoint. Do not redo `actualUnits` removal, `requestedPoints` conversion, subscription-period Grant creation, PWA funding, LINE edit confirmation UX or the removed persisted `ai_units_consumed` column.

1. Finish the small provider `reservationUnits` naming/direct-import cleanup and focused stale-contract scan.
2. Implement the first full Admin profitability reporting endpoint/view with selectable factual periods and cost/point/request/user/model/operation/Source-type breakdowns. Do not synthesize revenue.
3. Regenerate Drizzle baseline/snapshot from the final schema with a real local toolchain and apply to disposable PostgreSQL.
4. Run concentrated local/runtime validation. Only after those checks should Workers deployment readiness be reconsidered.

## Validation status

This batch performed static branch/document cross-file audit and GitHub source edits only.

**Not executed:** TypeScript typecheck, build, Vitest, PostgreSQL, Drizzle generation/apply, browser/PWA runtime, Cloudflare Worker runtime, LINE runtime, Gemini runtime, or deployment.

Therefore no test/build/runtime result is claimed as passing.

A local checked-out project/toolchain was not available in this execution environment, so package scripts and migration generation were not executed. This was not substituted with GitHub Actions.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.** Main blockers are stale Drizzle baseline/snapshot and lack of real local/PostgreSQL/runtime validation. Provider `reservationUnits` naming and the remaining stale-contract audit should also be cleaned before migration regeneration, but the authoritative AI point accounting/replay contract is now provider-cost/Grant-point based.

## Rough remaining work

Planning-only estimate from the current branch state:

- core Record/domain/manual PWA/LINE CREATE-HISTORY-EDIT/Grant funding/subscription-period behavior: largely implemented;
- provider naming + stale-contract cleanup: **small focused cleanup**;
- factual Admin profitability reporting: roughly **1 focused reporting batch**;
- migration regeneration + disposable PostgreSQL + typecheck/Vitest/runtime smoke: **1 mandatory validation batch**;
- real payment/TOP_UP and undefined proration/refund policy remain separate product/payment work unless launch scope later explicitly requires them.
