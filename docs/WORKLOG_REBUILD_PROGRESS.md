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

## Current execution checkpoint — 2026-09-04 Admin profitability reporting batch

This interactive batch continued immediately from the provider-cost AI-point accounting checkpoint. It did not redo the already-completed Source/Record/PWA/LINE/Grant/subscription-period rebuild.

The main new result is the first end-to-end **factual Admin AI profitability/cost reporting workflow**:

- selectable `TODAY`, `7D`, `30D`, and `BILLING_MONTH` periods;
- total AI request count and distinct charged users;
- customer-charged AI points and platform-subsidized points;
- immutable provider cost in USD and TWD where the historical pricing snapshot contained a TWD conversion;
- platform-subsidy provider cost in USD/TWD;
- average points and provider cost per request / charged user;
- breakdowns by model, AI operation, and PRIVATE/GROUP Source type;
- exact charged-point attribution by Grant type through `worklog_ai_usage_funding`;
- current Grant inventory/exhaustion by Grant type;
- explicit missing-TWD-cost request counts so unavailable historical FX conversion is not silently presented as zero cost;
- realized revenue, AI cost ratio, and gross margin remain `null` because AFTERTRACE does not yet have a durable successful-payment revenue ledger. Plan list price and checkout intent status are deliberately not treated as realized revenue.

The report is Admin-only, protected by the existing Admin session/origin boundary, and is mounted under `/api/v1/admin/profitability` before the general Admin route catch-all.

An Admin Web page is also implemented at `/profitability`. It reuses the existing `aftertrace.admin.session`, provides the four period choices, surfaces summary metrics and breakdown tables, warns when TWD cost coverage is incomplete, and states clearly that revenue/margin are unavailable until a real successful-payment ledger exists.

## Scanned this run

- all required durable product/development/deployment documents;
- latest progress checkpoint and current `revive/line-worklog` branch;
- provider-cost/AI-point usage contract and durable replay paths from the prior checkpoint;
- `apps/api/src/admin/repository.ts` and `grant-repository.ts`;
- AI usage / Grant / checkout / Source Drizzle schemas;
- Admin auth/presentation/routes and Worker route dispatch;
- Admin Web API client and application entrypoint;
- current payment/checkout state to verify that no durable successful-payment revenue fact exists yet.

The scan reconfirmed that `worklog_checkout_intents` is an intent/provider-handoff table, not an accounting revenue ledger. Therefore profitability reporting must not infer revenue from `COMPLETED`, plan price, or current subscription rows until payment success facts and amounts are durably persisted under an approved payment lifecycle.

## Files changed this run

Provider-cost point cleanup carried into this same interactive run:

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

Admin profitability batch:

- `apps/api/src/admin/profitability.ts` — new factual reporting repository/window contract
- `apps/api/src/admin/profitability.test.ts` — period/window tests
- `apps/api/src/admin/profitability-routes.ts` — new read-only authenticated Admin endpoint
- `apps/api/src/admin/profitability-routes.test.ts` — auth/origin/period validation tests
- `apps/api/src/worker.ts` — mounts profitability route before general Admin route
- `apps/admin/src/api.ts` — profitability API types/client
- `apps/admin/src/profitability-api.test.ts` — client URL/bearer/response contract
- `apps/admin/src/ProfitabilityPage.tsx` — selectable factual report UI
- `apps/admin/src/main.tsx` — routes `/profitability` to the report page
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. Provider usage and customer point accounting remain one coherent contract

The preceding sub-batch in this same interactive run completed:

- `WorklogAiUsageCommit.actualUnits` removal;
- `requestedUnits -> requestedPoints` on the Grant-backed point hold API;
- TEXT CREATE / attachment / LINE EDIT new provider-result JSON no longer writes `actualUnits`;
- TEXT and attachment replay no longer require `actualUnits`;
- customer charge remains authoritative only as `worklog_ai_usage_events.customer_points_charged`;
- provider overrun remains separate `platform_subsidized_points`/cost;
- provider modality measurements `audioInputUnits` / `imageInputUnits` remain factual provider usage and are intentionally not renamed as customer points.

Do not reintroduce an aggregate or duplicated "AI units consumed" fact.

### 2. Factual period reporting is implemented

`DrizzleAdminProfitabilityRepository` supports:

- `TODAY`: current Asia/Taipei calendar day;
- `7D`: trailing 7 × 24 hours;
- `30D`: trailing 30 × 24 hours;
- `BILLING_MONTH`: platform-level current Asia/Taipei calendar month for this aggregate report.

The platform report cannot use one user's subscription anniversary as a global period. If a future per-subscriber cohort report needs subscription-period boundaries, implement that as a separate cohort view rather than silently changing this aggregate period.

### 3. Revenue is deliberately not synthesized

The report returns:

- `revenueTwd = null`;
- `realizedAiCostRatio = null`;
- `realizedGrossMargin = null`;
- `revenueStatus = UNAVAILABLE_NO_SUCCESSFUL_PAYMENT_FACT`.

This is intentional and required by the pricing policy. Current tables do not contain a trustworthy successful-payment amount ledger. Do not multiply subscriber counts by plan price and call it revenue.

When a payment provider is implemented, successful charge/renewal/top-up payment events should persist immutable external payment identity, successful amount/currency, provider/fee facts where available, timestamps, refund state and idempotency identity. Only then should this report calculate realized revenue/margin.

### 4. TWD cost completeness is explicit

`provider_cost_twd` and subsidy TWD cost may be NULL for historical events without a stored USD/TWD rate. The report therefore exposes:

- `missingProviderCostTwdRequests`;
- `missingSubsidyCostTwdRequests`;
- per-breakdown `missingProviderCostTwdRequests`.

The Admin page warns when these values are non-zero. USD provider cost remains the primary complete provider-cost fact. Do not interpret a missing TWD conversion as known zero cost.

### 5. Report is Admin-only and read-only

The new route:

`GET /api/v1/admin/profitability?period=TODAY|7D|30D|BILLING_MONTH`

uses the existing Admin HMAC bearer session and Admin Web origin restriction. Unsupported periods fail before persistence access. The route has no mutation surface and does not expose provider cost to normal customer PWA APIs.

### 6. Admin Web report surface is implemented

`/profitability`:

- reuses the existing Admin session stored in `sessionStorage`;
- checks `/session` before report loading;
- allows period switching;
- displays request/point/cost/user averages;
- displays model / operation / PRIVATE-GROUP breakdown tables;
- displays Grant-type charged points and Grant inventory;
- warns about incomplete TWD conversion coverage;
- explicitly explains that revenue/margin are unavailable until successful-payment facts exist.

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
- successful paid subscription period -> immutable/idempotent `SUBSCRIPTION_PERIOD` Grant with PRIVATE scope;
- plan template uses `subscription_period_points` / `subscriptionPeriodPoints`, not live aggregate allowance naming;
- persisted `worklog_ai_usage_events.ai_units_consumed` removed from current source and executable settlement SQL;
- provider durable usage JSON no longer contains/requires `actualUnits`;
- Admin user/group reporting based on Grants/responsibility/provider-cost facts;
- attachment operations use deterministic `AUDIO_RECORD_CREATE` / `IMAGE_RECORD_CREATE` / `FILE_RECORD_CREATE`;
- retired `groupCollaboration`, `maxGroupCount`, aggregate entitlement/quota helper contracts removed from current entitlement/collaboration paths.

## Remaining / blocking work

### 1. Small provider naming/direct-import cleanup

Provider interfaces/implementations still use the internal method name `reservationUnits(...)` although they already return an AI-point hold estimate. This is naming-only, not an alternate accounting path.

When cleaning it, rename coherently across TEXT, attachment and LINE EDIT provider interfaces/implementations/tests, e.g. `reservationPoints(...)` or another clearly point-specific name. Do not rename `audioInputUnits` / `imageInputUnits`.

Also remove remaining `WorklogAiUsageCommit` imports through the transitional `subscription.ts` compatibility barrel when a touched file can safely import `ai-provider-usage.ts` directly.

### 2. Focused stale-contract audit before schema regeneration

Continue checking peripheral files/tests for concrete remnants of:

- Source Owner / owner binding as product authority;
- `subscription_owner_user_id`;
- aggregate quota/allowance as live customer balance;
- `groupCollaboration` / `maxGroupCount`;
- old Owner-controlled group recording authorization;
- Customer/Project/Transaction/category/normalized-summary Record assumptions;
- stale aggregate quota reservation fixtures.

Do not remove generic anomaly/audit `category` or `summary` fields; those are unrelated.

`worklog_workspaces.owner_user_id` remains a technical storage/bootstrap parent only. Do not treat it as product Owner/payment responsibility/AI 額度負責人. Removing the workspace parent is a coordinated later schema migration, not required to preserve current Source/member/Grant semantics.

`worklog_source_members.recording_enabled` still exists as an AI-path member preference. It is not used for free manual PWA authorization. Trace its runtime use before deciding whether it is obsolete; do not delete it by assumption.

### 3. Profitability reporting follow-ups that need additional factual domains

The new report covers current immutable AI usage/Grant facts. The following policy metrics cannot be completed truthfully yet without additional durable facts or an approved definition:

- realized revenue / gross margin / payment fee cost;
- FREE-to-paid conversion based on successful payment, not subscription/admin assignment alone;
- top-up realized margin;
- refunds/proration impact;
- cohort monthly median per subscriber tied to actual successful billing periods.

Do not invent these from plan price or current subscription state.

### 4. TOP_UP/payment lifecycle remains separate/unwired

The Grant model supports `TOP_UP`, but no successful payment-provider boundary exists yet. A future successful purchase must create one immutable/idempotent TOP_UP Grant keyed by external purchase identity.

Undefined mid-period upgrade/downgrade/refund/proration behavior continues to fail closed until product policy explicitly defines it.

### 5. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and `_journal.json` do not represent the current TypeScript schema. The obsolete baseline still contains legacy domain/accounting structures from before the rebuild.

Do not hand-fabricate the large Drizzle snapshot. Regenerate from a checked-out current branch with the actual project toolchain, then apply the resulting baseline to a fresh disposable PostgreSQL database.

### 6. Real runtime validation is mandatory

Before deployment execute locally/runtime, not GitHub Actions:

- TypeScript typecheck/build for API/Web/Admin;
- Vitest for point ledger, text normalization/replay uncertainty, attachment ingestion, LINE EDIT, manual Record domain, subscription-period Grants, Admin profitability periods/routes/client;
- fresh disposable PostgreSQL migration and schema drift check;
- Grant reservation/settlement/subsidy/concurrency tests;
- manual CRUD/version/revision/delete/restore tests;
- CREATE/HISTORY/Reply EDIT and both confirmation-operation tests;
- PRIVATE/GROUP funding authorization tests;
- Admin `/profitability` browser smoke;
- customer PWA browser smoke;
- LINE/Gemini runtime smoke as available;
- Workers deployment-readiness checks from `WORKLOG_DEPLOYMENT.md`.

## Next implementation target

Continue from this exact checkpoint. Do not redo the Admin profitability repository/route/client/page, `actualUnits` removal, `requestedPoints` conversion, subscription-period Grant creation, PWA funding, or LINE edit confirmation UX.

1. Do one final focused provider/stale-contract cleanup (`reservationUnits` naming + safe direct imports + concrete obsolete remnants only).
2. Obtain/use a real checked-out project toolchain; regenerate the prelaunch Drizzle baseline/snapshot/journal from the final TypeScript schema.
3. Apply to a fresh disposable PostgreSQL database and fix every real schema/SQL mismatch found.
4. Run API/Web/Admin typecheck/build and targeted/full Vitest locally/runtime.
5. Run browser/Worker/LINE/Gemini smoke as available. Only after these checks should workers.dev deployment readiness be reconsidered.

## Validation status

This batch performed static branch/document cross-file audit and GitHub source edits only.

Test files were authored/updated, but **none were executed** in this environment.

**Not executed:** TypeScript typecheck, build, Vitest, PostgreSQL, Drizzle generation/apply, browser/PWA/Admin runtime, Cloudflare Worker runtime, LINE runtime, Gemini runtime, or deployment.

Therefore no test/build/runtime result is claimed as passing.

A local checked-out project/toolchain is still unavailable in this execution environment; earlier direct GitHub clone/network resolution failed. This limitation was not substituted with GitHub Actions.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.** Product/domain/manual PWA/LINE AI/Grant/subscription-period and the first factual Admin profitability surface are largely implemented. Main blockers are now the stale Drizzle baseline/snapshot and lack of actual PostgreSQL/typecheck/Vitest/runtime validation, plus one small stale-contract/provider naming cleanup pass before regeneration.

## Rough remaining work

Planning-only estimate from the current branch state:

- core non-payment product implementation: largely implemented;
- provider naming + final stale-contract cleanup: **small focused batch**;
- Drizzle regeneration + disposable PostgreSQL fixes: **1 mandatory schema batch**;
- API/Web/Admin typecheck/Vitest/browser/Worker/LINE/Gemini validation: **1 mandatory validation batch**;
- real payment/TOP_UP plus undefined proration/refund policy remain separate payment/product work unless launch scope explicitly requires them.
