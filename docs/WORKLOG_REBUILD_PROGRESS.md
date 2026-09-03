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

## Current execution checkpoint — 2026-09-04 06:56 batch

This run continued from the completed single-title Record/manual-PWA foundation, durable pending-confirmation backend, FREE 400,000-point provisioning, GROUP AI responsibility separation, grant-backed provider reservation/settlement, Source-scoped customer usage backend, and bounded GROUP grant-allocation API. It did not redo those batches.

### Scanned this run

- all required durable product/development/deployment docs;
- `apps/api/src/admin/repository.ts` legacy aggregate quota / Source Owner SQL;
- `apps/api/src/admin/grant-repository.ts` grant-aware user/group reporting;
- Admin routes, presentation mapping and customer Admin API client;
- current grant/responsibility/usage schema;
- remaining subscription aggregate-quota repository to identify the next removal boundary.

## Completed this run

### 1. Physically removed legacy Admin user/group reporting SQL

`apps/api/src/admin/repository.ts` no longer contains user list/detail or group list/detail queries based on:

- `worklog_ai_quota_balances`;
- `worklog_sources.owner_user_id` / `subscription_owner_user_id`;
- plan allowance as live customer balance;
- `ai_units_consumed`;
- Owner-derived group classification.

That file is now deliberately limited to Admin persistence that is not live allowance reporting: overview, plan template CRUD, AI runtime config, feedback, anomalies and audit.

User/group reporting remains exclusively in `DrizzleGrantAdminRepository`, which reads:

- `worklog_ai_grants` / `worklog_ai_grant_scopes`;
- `worklog_source_ai_responsibility`;
- `customer_points_charged`;
- `platform_subsidized_points`;
- provider cost.

This closes the largest remaining accidental path by which the old aggregate quota / Owner model could leak back into Admin user/group reporting.

### 2. Admin overview now exposes point/subsidy accounting facts

The Admin overview backend now also returns for the current Taipei day:

- customer AI points charged;
- platform-subsidized AI points;
- provider cost TWD;
- platform-subsidized cost TWD.

The existing Admin UI still shows only its previous subset of overview metrics; surfacing the two new subsidy/point metrics visually remains a small UI follow-up.

### 3. Fixed stale Owner-era group-detail client logic

`apps/admin/src/api.ts` was still taking the new grant-aware GROUP detail payload and then trying to derive `owner_plan_code`, `owner_subscription_status`, `owner_effective_at`, etc.

That compatibility layer has been removed. GROUP detail now consumes the grant/responsibility payload directly and no longer fabricates old Owner subscription fields.

### 4. Admin presentation language now uses AI 額度負責人

Admin value presentation now labels both the compatibility filter value and the current reporting value as **AI 額度負責人**, rather than `群組擁有者`.

The compatibility query string `GROUP_ENABLED` is still accepted by the existing Admin filter API/UI so this batch did not require a wide route/UI rewrite, but its semantics are explicitly AI-responsibility, not Source ownership.

### 5. Retry guidance was aligned with grant-based AI eligibility

Admin attachment anomaly presentation no longer tells operators to diagnose old subscription-period entitlement states as the primary retry contract. Safe point-related retry states now reference Source-scoped AI points / eligible grants.

### Files changed this run

- `apps/api/src/admin/repository.ts`
- `apps/api/src/admin/presentation.ts`
- `apps/admin/src/api.ts`
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
- provider result/usage settlement remains resumable/idempotent;
- customer usage backend is Source/grant based;
- bounded GROUP grant-allocation backend exists;
- Admin user/group reporting is grant/responsibility based and the old Admin aggregate-quota reporting SQL has now been removed.

## Important transitional / blocking state

### 1. Customer PWA GROUP funding UI is still pending

Backend grant allocation already exists:

- `GET /api/v1/worklog/funding/group/:sourceId`
- `PUT /api/v1/worklog/funding/group/:sourceId/grants/:grantId`

Next PWA work should:

- load GROUP funding when the active scope is GROUP;
- show only this GROUP's available/used/subsidized points and AI 額度負責人;
- let the responsible user enable/disable only their own grants and set optional per-GROUP caps;
- never expose unrelated PRIVATE/other-GROUP balances to ordinary members.

The top PWA usage bar still uses the temporary PRIVATE `/usage/me` compatibility shape.

### 2. PWA pending-confirmation UI is still pending

Backend deterministic confirmation APIs already exist. The Records UI still needs to show pending proposed title/candidates and allow choose/create/reject without another AI call.

### 3. Actual LINE Reply AI edit is still pending

Safety behavior remains correct: ambiguous/non-deterministic edits are refused rather than guessed. Remaining implementation needs deterministic Reply-to-Record mapping, point hold/provider edit interpretation, title ambiguity handling, version/revision mutation and idempotent settlement.

### 4. Legacy subscription aggregate quota implementation still exists

Provider execution and Admin/customer usage reporting no longer depend on it, but `DrizzleWorklogSubscriptionRepository` / `WorklogSubscriptionService` still expose old live-quota/reservation methods and read `worklog_ai_quota_balances`.

This is now a high-priority cleanup target. Subscription should remain metadata/lifecycle that creates independent `SUBSCRIPTION_PERIOD` grants; it should not expose a second live AI balance system.

After its remaining callers are migrated, remove:

- `schema-worklog-quota.ts`;
- old aggregate quota reservation/settlement service methods;
- transitional `ai_units_consumed` from provider usage schema;
- Source Owner funding compatibility fields once no other runtime path depends on them.

### 5. SUBSCRIPTION_PERIOD and TOP_UP grant provisioning are not wired

The ledger supports these grant types, but actual successful payment/renewal lifecycle provisioning remains pending. FREE initial provisioning is currently the only production grant creator.

### 6. Admin pricing/profitability analytics are incomplete

Provider cost/points/subsidy facts exist and the overview now exposes daily charged/subsidized facts, but selectable-period analytics, utilization/exhaustion, cohort margin and the pricing recommendation calculator are still pending.

### 7. Attachment operation classification is still generic

Attachment usage accounting is correct, but provider usage operation may still fall back to `UNKNOWN`. Add stable operation tags before relying on per-operation pricing analytics.

### 8. Prelaunch migration baseline/snapshot remain stale — deployment is blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and the journal still describe obsolete pre-refactor structures. They do not yet represent the final Record/grant/responsibility/confirmation/point-reservation/funding schema.

Do not hand-fabricate a large Drizzle snapshot. Regenerate from the actual TypeScript schema and run a fresh disposable PostgreSQL migration when a checked-out pnpm/project toolchain is available.

### 9. New grant/point SQL is still not runtime-validated

The grant ledger and funding configuration use PostgreSQL row locks, CTEs, cap/reservation invariants and exactly-once settlement. Static edits are not production proof; real disposable PostgreSQL validation is required before Workers deployment.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Wire the GROUP funding API into customer PWA.**
   - Source-scoped GROUP usage bar;
   - responsible-user label;
   - own grant allocation/cap controls only for responsible user;
   - ordinary members see only group-scoped points/history.

2. **Implement PWA pending-confirmation UI.**

3. **Finish Reply-targeted LINE AI edit on the grant/idempotent layer.**

4. **Collapse subscription entitlement to metadata/lifecycle and remove the old aggregate quota implementation.**
   - subscription plan remains a template for future subscription-period Grant creation;
   - provider AI eligibility must remain grant-only;
   - then delete `schema-worklog-quota.ts` and transitional aggregate reservation methods/readers.

5. **Wire SUBSCRIPTION_PERIOD and TOP_UP grant creation after billing lifecycle is ready.**

6. **Add Admin pricing/profitability analytics and surface the new overview point/subsidy metrics.**

7. **Regenerate prelaunch Drizzle baseline/snapshot and run concentrated validation when a real local project toolchain is available.**
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
- PWA funding/confirmation surfaces, Reply AI edit and final quota cleanup are now the largest non-payment work items;
- payment provider integration remains a separate later batch;
- deployment should not start until migration regeneration and runtime validation succeed.

## Validation status

This run performed static GitHub repository edits only. No local build, TypeScript typecheck, Vitest execution, migration, browser, Worker, LINE, Gemini or PostgreSQL runtime validation was executed here.

No GitHub Actions were run, dispatched, rerun, enabled, modified, or otherwise triggered.

The branch remains an active refactor checkpoint and is **not deployment-ready** because the migration baseline/snapshot are stale and the new grant/funding SQL has not yet run against disposable PostgreSQL.
