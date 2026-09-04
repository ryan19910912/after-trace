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

The latest product/development documents above are the only product specification. Do not revive old Customer/Project/Finance/Owner/aggregate-quota assumptions from older code or tests.

## Current execution checkpoint — 2026-09-04 13:00 batch

This batch re-read all required specifications and reconciled the previous checkpoint against the **actual current branch** before modifying anything.

Important reconciliation: the prior 11:30 checkpoint was behind the branch. The subscription aggregate-quota collapse it listed as the next large implementation task had already landed in later branch commits before this batch. Current subscription execution is already based on successful-period -> immutable `SUBSCRIPTION_PERIOD` Grant, not the old aggregate quota repository. This batch therefore did **not** reimplement subscription-period grants. It instead audited and removed stale schema/test contracts that still encoded the retired Owner/quota model and would otherwise break or mislead validation.

## Scanned this run

- all required durable product/development/deployment documents;
- latest progress checkpoint and recent branch commits/tree;
- `subscription.ts`, `subscription-period.ts`, `drizzle-subscription-period.ts`, subscription routes and Admin subscription assignment;
- Grant schema/service/point ledger and Grant-backed usage readers;
- Source schema and bootstrap persistence;
- GROUP manual collaboration and AI-responsibility domains;
- GROUP LINE runtime and Reply-targeted edit integration;
- Admin Grant-aware repository for remaining Source-owner references;
- high-risk stale test files: entitlement, bootstrap, lifecycle ordering, collaboration, GROUP LINE runtime, GROUP/OA webhook, OA runtime, Record and subscription-period tests.

## Files changed this run

- `apps/api/src/worklog/entitlements.ts`
- `apps/api/src/worklog/entitlements.test.ts`
- `apps/api/src/db/schema-worklog.ts`
- `apps/api/src/worklog/bootstrap.test.ts`
- `apps/api/src/worklog/bootstrap-lifecycle-ordering.test.ts`
- `apps/api/src/worklog/collaboration.test.ts`
- `apps/api/src/worklog/line-runtime.test.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. Subscription runtime is already Grant-period based; old aggregate repository is no longer the execution path

Branch reconciliation confirmed:

- `subscription.ts` is now a compatibility barrel for neutral provider-usage types plus subscription-period lifecycle; it no longer implements aggregate AI reserve/commit/release;
- `WorklogSubscriptionPeriodService` creates one immutable/idempotent `SUBSCRIPTION_PERIOD` Grant for an unambiguous successful paid period;
- the Grant gets a stable origin key and automatic PRIVATE Source scope only;
- GROUP scope remains explicit and is never inherited automatically;
- `DrizzleWorklogSubscriptionPeriodRepository` writes subscription lifecycle + Grant/scope atomically and does not use the old aggregate quota tables;
- Admin manual period assignment is already wired to the subscription-period service;
- a mid-period plan switch is intentionally rejected as `ACTIVE_PERIOD_CHANGE_POLICY_UNDEFINED` rather than inventing proration/refund behavior.

Do not redo this foundation unless a concrete regression is found.

### 2. Removed obsolete entitlement helpers that could revive paid GROUP gating / aggregate quota

`entitlements.ts` no longer exposes the retired helpers for:

- `groupCollaboration` / `maxGroupCount` gating;
- aggregate remaining allowance;
- aggregate `canConsumeAiUnits` checks.

The module now keeps only generic plan-capability parsing and immutable provider-cost accounting. Its documentation explicitly states that customer AI eligibility and point consumption belong to user-owned Grant scopes / AI point ledger, not plan capabilities.

The entitlement tests were rewritten accordingly. They no longer assert that GROUP collaboration is a paid capability or that subscription allowance is the live AI balance.

### 3. Removed dead Owner/subscription-owner fields from the TypeScript Source schema

`worklog_sources` no longer defines:

- `owner_user_id`;
- owner binding method/time;
- `subscription_owner_user_id`;
- related Owner/subscription-owner indexes.

GROUP data authorization is membership-based. GROUP AI payment responsibility is represented only by `worklog_source_ai_responsibility` plus user-owned Grant scopes.

`worklog_workspaces.owner_user_id` is still retained as a **transitional storage-parent identity only** because bootstrap/auth/audit still carry `workspace_id`. It must not be treated as GROUP authorization or AI funding. Remove the workspace storage parent only after its remaining technical references are traced; do not conflate that cleanup with the already-removed Source Owner domain.

The physical plan-template column `ai_allowance_units` is also still retained temporarily, but current runtime semantics treat it only as the configured point count frozen into a future `SUBSCRIPTION_PERIOD` Grant. Naming cleanup remains.

### 4. Fixed stale bootstrap tests that no longer matched the production interface

`bootstrap.test.ts` still referenced removed contracts such as:

- Source `ownerUserId`;
- `promoteGroup`;
- `bindGroupOwner`;
- legacy owner conflict behavior.

Those tests were rewritten to the current model:

- GROUP Source is durable immediately and has no Owner field;
- membership is independent of AI funding;
- AI responsibility is claimed later through `WorklogAiResponsibilityClaimPort`;
- a conflicting claimant does not replace the current AI 額度負責人;
- absence of responsibility infrastructure fails closed;
- Source leave/rejoin identity is independent from AI responsibility.

`bootstrap-lifecycle-ordering.test.ts` was also cleaned of the obsolete Owner property and `promoteGroup` stub while retaining delayed LINE lifecycle ordering coverage.

### 5. Fixed stale collaboration tests that contradicted the current free/manual product contract

The previous `collaboration.test.ts` still exercised a deleted legacy service surface:

- `GroupAuthorizationContext`;
- owner subscription status/capabilities;
- owner allowance consumption;
- `authorizeGroupRecord`;
- member recording permissions controlled by legacy Owner;
- Owner binding.

The test now covers only the real `WorklogCollaborationService` responsibility: free manual GROUP data access based on Source existence/status + active membership. AI funding remains completely separate in `ai-responsibility.ts`.

### 6. Fixed stale GROUP LINE runtime tests that still expected Owner/quota/capability authorization

`line-runtime.test.ts` still imported/constructed the retired Owner/quota collaboration interface even though production `line-runtime.ts` already uses:

- `authorizeGroupAccess` for free HISTORY/manual access;
- `authorizeGroupAi` for CREATE/attachment/AI EDIT;
- current AI 額度負責人 -> `chargedUserId`;
- Grant positive-balance checks rather than subscription allowance.

The rewritten tests now cover the current contract:

- ordinary GROUP text is only temporary cache and does not bootstrap/fund/write;
- `@AFTERTRACE 啟用` claims AI responsibility without changing Source ownership;
- HISTORY requires only active-member access and never checks AI points;
- CREATE is rejected before persistence when no eligible scoped Grant can start AI;
- CREATE writes raw Record then invokes the one-title/time normalizer;
- delayed Reply text uses only the exact GROUP cache;
- EDIT resolves deterministic same-Source Reply target before funding;
- invalid/missing EDIT target does not touch AI funding;
- attachment ingestion receives the current responsible user as `chargedUserId`.

### 7. Additional static audit did not find the same stale contract in nearby current tests

This batch also read current:

- `group-webhook.test.ts`;
- `oa-runtime.test.ts` / `oa-runtime.ts`;
- `oa-webhook.test.ts`;
- `records.test.ts`;
- `usage.test.ts`;
- `subscription-period.test.ts`;
- `drizzle-collaboration.ts`;
- `ai-responsibility.ts`.

Those inspected files were already aligned closely enough with the current Source/Grant model and were not rewritten in this batch.

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
- successful paid subscription period -> immutable/idempotent `SUBSCRIPTION_PERIOD` Grant with PRIVATE scope.

## Remaining / blocking work

### 1. Continue stale-contract audit before runtime validation

The branch had several tests lagging behind already-refactored production code. Continue scanning tests and peripheral readers for any remaining references to:

- Source Owner / owner binding;
- `subscription_owner_user_id`;
- aggregate quota/allowance as live balance;
- `groupCollaboration` / `maxGroupCount`;
- old `authorizeGroupRecord` / recording-permission ownership semantics;
- Customer/Project/Transaction/category/normalized-summary Record assumptions.

Do not blindly remove generic fields named `category` or `summary` from anomaly/audit infrastructure; only remove the obsolete customer Record normalization concepts.

### 2. Plan-template terminology / billing representation remains transitional

The execution semantics are already Grant-period based, but schema/API/UI still expose `ai_allowance_units` / `aiAllowanceUnits` as the subscription plan template field.

Next naming cleanup should migrate that to a neutral explicit name such as `subscription_period_points` / `subscriptionPeriodPoints` across:

- Drizzle schema;
- subscription-period repository SELECTs;
- customer subscription API/client;
- Admin repository/routes/client/editor.

Because the product docs define FREE one-time launch Grant and paid recurring plans but do **not** define every future billing/proration edge, do not invent upgrade/downgrade/refund behavior. A clean explicit billing-type representation may be added only where semantics are unambiguous.

### 3. TOP_UP lifecycle remains unwired

The Grant model supports `TOP_UP`, but there is no real payment-provider success boundary yet. When one exists, each successful purchase must create one immutable/idempotent user-owned TOP_UP Grant keyed by the external purchase identity. Do not fake provider behavior merely to complete schema work.

### 4. Admin profitability is only partially surfaced

Backend overview/accounting already contains useful Grant/provider facts, including charged AI points, platform-subsidized points and provider cost. Still needed:

- expose charged/subsidized metrics clearly in Admin UI;
- today / 7d / 30d / billing-month period selection;
- request/user/subscriber usage averages/medians;
- allowance utilization/exhaustion;
- FREE subsidy/conversion;
- realized AI cost ratio/gross margin;
- pricing recommendation calculator with explicit Admin-confirmed included points;
- breakdowns by plan, Grant type, model, operation/input type and PRIVATE/GROUP.

### 5. Attachment operation classification remains generic

Attachment settlement is Grant-correct, but stable operation tags still need cleanup before operation-level profitability reporting is trustworthy.

### 6. Transitional workspace storage parent remains

`worklog_workspaces.owner_user_id` is still used as a technical storage/bootstrap parent. Trace auth/bootstrap/audit dependencies before deciding whether to remove workspace entirely. This field must not be reused as product Owner, GROUP authorization, or AI funding responsibility.

### 7. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and journal still describe obsolete structures and do not represent the current final TypeScript schema.

Do **not** hand-fabricate the large snapshot. Regenerate from the checked-out current TypeScript schema, then apply against a fresh disposable PostgreSQL database. The current TypeScript Source schema now intentionally omits legacy Owner/subscription-owner columns, so the regenerated migration must reflect that.

### 8. Real runtime validation is still mandatory

Before deployment, execute locally/runtime, not GitHub Actions:

- TypeScript typecheck/build;
- Vitest suites, especially the stale-contract tests rewritten this batch;
- fresh disposable PostgreSQL migration;
- Grant reservation/settlement/subsidy/concurrency tests;
- manual CRUD/version/revision/delete/restore tests;
- CREATE/HISTORY/Reply EDIT and both confirmation operation tests;
- PRIVATE/GROUP funding authorization tests;
- browser/PWA smoke;
- LINE/Gemini runtime smoke as available;
- Workers deployment-readiness checks from `WORKLOG_DEPLOYMENT.md`.

## Next implementation target

Continue from this exact checkpoint; do not redo subscription-period Grant creation, PWA funding, or LINE edit confirmation UX.

1. Audit remaining stale tests/peripheral code for retired Owner/quota/capability contracts; fix only real mismatches.
2. Rename plan-template `ai_allowance_units` semantics to `subscription_period_points` (or equivalent neutral point-template name) consistently across schema/API/Admin/PWA without changing configured values.
3. Trace whether `workspace_id` can be removed or simplified without breaking auth/bootstrap/audit; keep it technical-only until that trace is complete.
4. Improve Admin charged/subsidized/profitability presentation and attachment operation tags where product policy is already explicit.
5. Regenerate Drizzle baseline/snapshot from the final schema with a real local toolchain and apply to disposable PostgreSQL.
6. Run concentrated local/runtime validation. Only after those checks should Workers deployment readiness be reconsidered.

## Validation status

This batch performed static branch/document cross-file audit and GitHub source edits only.

**Not executed:** TypeScript typecheck, build, Vitest, PostgreSQL, Drizzle generation/apply, browser/PWA runtime, Cloudflare Worker runtime, LINE runtime, Gemini runtime, or deployment.

Therefore no test/build/runtime result is claimed as passing. The rewritten tests are specification-aligned source changes, not executed proof.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.** Main blockers are stale Drizzle baseline/snapshot plus lack of real local/PostgreSQL/runtime validation. Plan-template terminology and remaining stale-contract audit should also be completed before final migration regeneration.

## Rough remaining work

Planning-only estimate from the current branch state:

- core Record/domain/manual PWA/LINE CREATE-HISTORY-EDIT/Grant funding/subscription-period behavior: largely implemented;
- remaining non-payment implementation/audit before concentrated validation: roughly **1 substantial cleanup batch** for stale contracts + plan naming, with Admin reporting potentially another focused batch;
- migration regeneration + disposable PostgreSQL + typecheck/Vitest/runtime smoke: **1 mandatory validation batch**;
- real payment/TOP_UP and any undefined proration/refund policy remain separate product/payment work and are not blockers to finishing the current non-payment refactor checkpoint unless launch scope requires them.
