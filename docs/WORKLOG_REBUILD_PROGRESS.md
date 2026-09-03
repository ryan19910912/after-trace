# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- this file

## Current execution checkpoint — 2026-09-04 06:xx batch

This run continued from the completed single-title Record/manual-PWA foundation, durable pending-confirmation backend, FREE 400,000-point provisioning, GROUP AI responsibility separation, and grant-backed provider reservation/settlement. It did not redo those batches.

### Scanned this run

- all required durable product/development/deployment docs;
- current customer usage service/repository and PWA compatibility route;
- user-owned grant/scoped-balance schema;
- GROUP AI responsibility service/repository;
- current Worker route composition;
- old Admin repository aggregate-quota/Owner reads to identify next cleanup targets.

## Completed this run

### 1. Fixed a real static integration bug in GROUP AI authorization

`WorklogAiResponsibilityService` had drifted from the actual `WorklogAiGrantService.canStartAi(userId, sourceId, at): Promise<boolean>` signature and was calling it with an object plus `.allowed` result access.

The call now matches the real grant service contract. This was a likely TypeScript/runtime blocker in the previous checkpoint.

### 2. Customer usage backend no longer reads aggregate subscription quota

`WorklogUsageService` and `DrizzleWorklogUsageRepository` were rewritten around the grant ledger.

Source-scoped usage now models:

- current GROUP AI 額度負責人, when applicable;
- positive grant points explicitly scoped to the Source;
- active reservation points on those scopes;
- customer AI points already charged for the Source;
- platform-subsidized points for the Source;
- whether the current viewer is the responsible user allowed to manage funding.

The repository no longer queries `worklog_ai_quota_balances`, plan `ai_allowance_units`, legacy Source Owner, subscription periods, or `ai_units_consumed` for customer usage.

The existing `/usage/me` route is temporarily kept compatible so the current Web UI does not break before its Source-scoped usage UI is switched. Its compatibility values now come only from the user's PRIVATE grant ledger and never from aggregate quota tables.

### 3. Added bounded GROUP grant-allocation API

New authenticated route module:

- `GET /api/v1/worklog/funding/group/:sourceId`
- `PUT /api/v1/worklog/funding/group/:sourceId/grants/:grantId`

Behavior:

- any active GROUP member may see only this GROUP's current AI availability/history and current AI 額度負責人;
- ordinary members do not receive another user's grant inventory or unrelated balances;
- only the current AI 額度負責人 may see and configure their own grants for this GROUP;
- a grant allocation may be enabled/disabled and may have an optional per-GROUP cap;
- lowering a cap below already committed+reserved usage is rejected;
- disabling a scope with an active reservation is rejected;
- another user's grant cannot be configured through this API;
- PRIVATE/other-GROUP balances are not exposed to other members.

This provides the backend management contract needed for the pending PWA funding UI without implicitly leaking the FREE PRIVATE grant into groups.

### 4. Worker routing now mounts the funding API

`apps/api/src/worker.ts` mounts the new funding route under `/api/v1/worklog/funding` through the existing Web API anomaly boundary.

### 5. Usage tests were rewritten for grant semantics

`usage.test.ts` now encodes:

- PRIVATE usage comes from the current user's PRIVATE-scoped grant balance;
- the temporary `/usage/me` compatibility shape is backed by grants, not aggregate quota;
- GROUP usage shows only the current responsible user's points explicitly scoped to that GROUP;
- a GROUP with no AI 額度負責人 exposes zero current AI availability rather than falling back to another balance.

Tests were authored/updated but not executed in this environment.

### Files added/changed this run

- `apps/api/src/worklog/ai-responsibility.ts`
- `apps/api/src/worklog/usage.ts`
- `apps/api/src/worklog/drizzle-usage.ts`
- `apps/api/src/worklog/usage.test.ts`
- `apps/api/src/worklog/funding-routes.ts` (new)
- `apps/api/src/worker.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Stable completed foundation from earlier batches

Do not redo these unless a regression is found:

- universal Customer/Project/Finance/category/normalized-summary removed from the TypeScript/customer Record core;
- Source + single Entity/title + Alias + Record + immutable Revision schema/runtime foundation;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization uses active membership, not billing;
- GROUP Source exists independently from AI funding user; obsolete pending-group TypeScript runtime/schema removed;
- old Gemini summary/category/customer/project normalization replaced by single-title/`occurred_at` interpretation;
- durable pending-confirmation creation and deterministic resolution backend exists;
- obvious LINE HISTORY requests route to deterministic Source-correct filtered PWA links;
- obvious LINE EDIT requests cannot accidentally become new Records while Reply AI edit is unfinished;
- FREE initial grant is exactly 400,000 AI points once, no expiry/refresh, idempotently provisioned to the user's PRIVATE Source;
- text and attachment provider execution use the user-owned grant ledger;
- actual provider cost converts to customer points through the frozen output-price-equivalent rule;
- customer balances do not go negative and provider overage is recorded as platform subsidy;
- GROUP provider charged-user resolution uses `worklog_source_ai_responsibility`, not legacy Owner/subscription-owner fields;
- provider result/usage settlement remains resumable/idempotent.

## Important transitional / blocking state

### 1. Admin still has substantial legacy aggregate-quota and Owner reporting reads

`apps/api/src/admin/repository.ts` still contains old reporting based on:

- `worklog_ai_quota_balances`;
- plan `ai_allowance_units` as if it were the live customer balance;
- `worklog_sources.owner_user_id` / `subscription_owner_user_id`;
- `ai_units_consumed`;
- Owner-derived user/group classifications.

These are now one of the highest-priority cleanup targets because customer/provider execution has already cut over to grants and responsibility.

### 2. Legacy aggregate quota schema/service still exists

The real provider path no longer depends on it, but the following remain for compatibility and must not survive final prelaunch schema:

- `schema-worklog-quota.ts`;
- old subscription reservation/settlement methods/repositories;
- transitional aggregate reporting columns/readers;
- transitional `ai_units_consumed`.

Delete only after all remaining Admin/subscription readers are replaced.

### 3. GROUP funding API exists; customer PWA funding UI is still pending

Backend grant allocation is now available and bounded. Next PWA work should:

- load GROUP funding when the active scope is GROUP;
- show current GROUP-specific available/used points and AI 額度負責人;
- when current user is responsible, list only their grants with per-GROUP enabled/cap controls;
- never show unrelated balances to other members.

The current top usage bar still uses the temporary PRIVATE `/usage/me` compatibility response until this UI is switched.

### 4. PWA pending-confirmation UI is still pending

Backend deterministic confirmation APIs already exist. The Records UI still needs to show pending proposed title/candidates and allow choose/create/reject without another AI call.

### 5. Actual LINE Reply AI edit is still pending

Safety behavior remains correct: ambiguous/non-deterministic edits are refused rather than guessed. Remaining implementation needs deterministic Reply-to-Record mapping, point hold/provider edit interpretation, title ambiguity handling, version/revision mutation and idempotent settlement.

### 6. Subscription-period and TOP_UP grant provisioning are not wired

The ledger supports these grant types, but actual successful payment/renewal lifecycle provisioning remains pending. FREE initial provisioning is currently the only production grant creator.

### 7. Admin pricing/profitability analytics are incomplete

Provider cost and subsidy facts exist, but Admin still needs grant/point/subsidy views and pricing recommendation analytics from the frozen AI-point policy.

### 8. Attachment operation classification is still generic

Attachment usage accounting is correct, but provider usage operation may still fall back to `UNKNOWN`. Add stable operation tags before relying on per-operation pricing analytics.

### 9. Prelaunch migration baseline/snapshot remain stale — deployment is blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and the journal still describe obsolete pre-refactor structures. They do not yet represent the final Record/grant/responsibility/confirmation/point-reservation/funding schema.

Do not hand-fabricate a large Drizzle snapshot. Regenerate from the actual TypeScript schema and run a fresh disposable PostgreSQL migration when a checked-out pnpm/project toolchain is available.

### 10. New grant/point SQL is still not runtime-validated

The grant ledger and funding configuration use PostgreSQL row locks, CTEs, cap/reservation invariants and exactly-once settlement. Static edits are not production proof; real disposable PostgreSQL validation is required before Workers deployment.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Replace Admin aggregate-quota/Owner reporting with grants + AI 額度負責人.**
   - user list/detail: current plan may remain subscription metadata, but live points must come from grants;
   - group list/detail: responsible user must come from `worklog_source_ai_responsibility`;
   - usage must use `customer_points_charged` / `platform_subsidized_points` / provider cost;
   - remove Owner-derived group-enabled classification;
   - stop reading `worklog_ai_quota_balances` and `ai_units_consumed`.

2. **Wire the GROUP funding API into customer PWA.**
   - Source-scoped usage bar;
   - responsible-user label;
   - own grant allocation/cap controls only for responsible user.

3. **Implement PWA pending-confirmation UI.**

4. **Finish Reply-targeted LINE AI edit on the grant/idempotent layer.**

5. **Remove legacy quota schema/service and Source Owner funding fields once Admin/subscription reads are gone.**

6. **Wire SUBSCRIPTION_PERIOD and TOP_UP grant creation after billing lifecycle is ready.**

7. **Add Admin pricing/profitability analytics.**

8. **Regenerate prelaunch Drizzle baseline/snapshot and run concentrated validation when a real local project toolchain is available.**
   - typecheck/build/Vitest;
   - disposable PostgreSQL migration;
   - point-ledger/funding concurrency tests;
   - browser/PWA flows;
   - LINE/Gemini/runtime smoke;
   - then workers.dev deployment.

## Rough remaining work

Planning-only estimate from the current branch state:

- core product/domain contract: essentially defined;
- major runtime implementation remaining before concentrated validation: roughly 2–4 substantial batches;
- Admin legacy reporting cleanup and PWA funding/confirmation surfaces are now the largest non-payment work items;
- payment provider integration remains a separate later batch;
- deployment should not start until migration regeneration and runtime validation succeed.

## Validation status

This run performed static GitHub repository edits only. No local build, TypeScript typecheck, Vitest execution, migration, browser, Worker, LINE, Gemini or PostgreSQL runtime validation was executed here.

New/updated tests encode intended behavior but are not claimed passing.

The branch remains an active refactor checkpoint and is **not deployment-ready** because the migration baseline/snapshot are stale and the new grant/funding SQL has not yet run against disposable PostgreSQL.

**GitHub Actions were not run, dispatched, rerun, enabled, modified, or otherwise triggered.**
