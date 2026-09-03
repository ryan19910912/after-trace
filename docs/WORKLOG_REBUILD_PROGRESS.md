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

## Current execution checkpoint — 2026-09-04 05:xx batch

This run continued directly from the completed single-title Record/manual-PWA foundation, durable pending-confirmation backend, FREE 400,000-point provisioning and grant schema foundation. It did **not** redo those batches.

Primary goals this run were:

1. make the user-owned grant ledger authoritative for real text/attachment provider execution;
2. enforce the frozen `1 AI point = 1 output-price-equivalent token` settlement rule from actual provider cost;
3. wire GROUP AI funding to the separate **AI 額度負責人** table instead of legacy Source Owner/subscription-owner fields;
4. retain exactly-once/resumable provider accounting while customer balances never become negative.

### Scanned this run

- all required product/entity/edit/AI-point/development/LINE-content/deployment/progress docs;
- grant/scoped-balance schema and Drizzle repository;
- legacy subscription/quota service and current provider runtime wiring;
- text normalization service, Gemini text provider and durable text-normalization repository;
- attachment ingestion service/provider/repository and Worker runtime wiring;
- GROUP bootstrap/collaboration/AI authorization flow;
- provider usage schema and current subsidy fields;
- relevant text/attachment tests and current migration/export structure.

## Completed this run

### 1. Grant-backed AI point reservation/settlement service is implemented

Added `WorklogAiPointLedgerService` plus PostgreSQL/Drizzle repository.

Current reservation semantics:

- AI requires at least one **positive eligible point** in a grant explicitly scoped to the current Source;
- requested points are a conservative provider preflight hold estimate, not customer billing;
- if requested estimate exceeds the user's remaining eligible points, the ledger may hold all currently available positive points and still allow the already-authorized provider request to start;
- eligible grants/scopes are locked in PostgreSQL before allocation;
- allocation may span multiple grants/scopes and is ordered by earliest expiry first, then effective time/id;
- Source caps include both committed `used_points` and active `reserved_points`, preventing concurrent requests from oversubscribing a cap;
- grant `remaining_points` is reduced by the active hold immediately, so concurrent requests cannot spend the same customer points twice.

Release/expiry semantics:

- failed pre-provider requests release the whole hold;
- stale reservations restore held grant points and Source-cap reservations;
- an EXPIRED reservation that is later proven to have successful provider usage charges the customer zero because its hold was already restored, and the full actual request becomes platform subsidy rather than silently re-spending restored balance.

### 2. Actual provider cost is now authoritative for customer points

Text and attachment paths no longer settle customer usage from raw `inputTokens + outputTokens`.

Actual customer point demand is recomputed from durable provider facts:

`ceil(provider_cost_usd / (output_usd_per_million / 1,000,000))`

This includes the provider's billed input/output/thinking/modality cost because `provider_cost_usd` is built from the pricing/usage snapshot first.

Settlement behavior:

- customer charge = `min(actual points, held customer points)`;
- customer balance floors at zero;
- actual points beyond the held customer amount become `platform_subsidized_points`;
- platform subsidy cost USD/TWD is recorded separately;
- unused hold is restored;
- reservation funding rows become exact successful usage funding rows;
- one usage event is keyed by reservation token to prevent duplicate provider-cost settlement.

`ai_units_consumed` remains a transitional reporting column but the provider runtime no longer treats it as authoritative quota.

### 3. Provider usage now has an exactly-once reservation bridge

`worklog_ai_usage_events` now includes nullable `reservation_token` with a unique index.

This lets a durable provider result resume through customer settlement without inserting a second usage event or calling the provider again. Existing provider-success / usage-committed state machines remain intact.

### 4. Text Gemini runtime has switched from subscription quota to the point ledger

Production webhook wiring now creates `WorklogAiPointLedgerService` for `WorklogTextNormalizationService`; it no longer injects `WorklogSubscriptionService` into provider execution.

Text flow now:

1. raw Record is durable;
2. resolve responsible charged user for the Source;
3. acquire a positive scoped grant hold;
4. only then call Gemini;
5. persist provider result/usage before settlement;
6. settle actual provider cost into customer points + subsidy;
7. apply title/time result or create durable pending confirmation.

If no scoped points can be held, Gemini is not called.

The Gemini text provider's reservation estimate was also converted from a byte/token-like value to a **conservative AI-point hold estimate**. Request bytes are used only as a safe token upper bound, output/thinking cushions are added, the upper bound is priced conservatively, then converted to AI points. Actual billing still comes only from real provider-reported usage/cost.

### 5. Attachment Gemini runtime has switched from subscription quota to the point ledger

Worker attachment runtime now receives `WorklogAiPointLedgerService` instead of legacy subscription quota.

Attachment actual points are derived from the full provider pricing snapshot, including image/audio modality pricing when reported. The attachment repository now resumes settlement from `worklog_ai_point_reservations` rather than the legacy quota reservation table.

The Gemini attachment provider's preflight estimate is also now a conservative **AI-point hold estimate**, priced using the most expensive configured input/output/audio/image reference among the possible modalities. Actual settlement remains provider-usage based.

PRIVATE attachment AI charges the user's own PRIVATE-scoped grant. GROUP attachment AI receives the charged AI 額度負責人 from the new GROUP authorization adapter described below.

### 6. GROUP AI 額度負責人 is now a separate runtime domain

Added `WorklogAiResponsibilityService` and Drizzle repository.

GROUP AI authorization now requires:

- Source exists and is ACTIVE;
- actor is an active group member;
- a current `worklog_source_ai_responsibility` row exists;
- that responsible user is still an active group member;
- that responsible user owns positive points in a grant explicitly scoped to this GROUP Source.

Manual GROUP/PWA authorization does **not** use this service and remains free active-member access.

`@AFTERTRACE 啟用` keeps its legacy method/result naming temporarily for LINE compatibility, but production bootstrap now writes the separate AI-responsibility table/history rather than using legacy Owner columns as the authoritative funding role.

Assignment is deliberately conservative for now:

- first active member claim can bind the role;
- repeated same-user claim is idempotent;
- a different claimant gets conflict rather than silent takeover;
- transfer/recovery policy/UI remains later work.

### 7. Text provider charged-user resolution no longer uses legacy Owner/subscription-owner columns

`DrizzleWorklogTextNormalizationRepository.loadContext()` now resolves:

- PRIVATE -> `source.private_user_id`;
- GROUP -> `worklog_source_ai_responsibility.responsible_user_id`, requiring that responsible user to remain an active member.

`getReservationStatus()` now reads the new point-reservation table.

This removes legacy Owner/subscription-owner funding semantics from the real text provider path.

### 8. Scoped grant balance now accounts for concurrent holds

`worklog_ai_grant_scopes` gained `reserved_points`.

Eligible Source balance now uses:

`cap_points - used_points - reserved_points`

instead of only committed usage. FREE provisioning initializes this to zero.

### 9. Tests were updated/authored for the new point contract

Updated text and attachment service tests to use point-ledger reservation/commit/release result shapes and output-price-equivalent point examples rather than raw token-unit quota.

Added `ai-point-ledger.test.ts` covering service-level invariants:

- any positive held scoped balance can start an already-authorized request even when the conservative estimate is larger;
- zero eligible balance blocks provider start;
- commit recomputes points from immutable provider cost/reference price rather than trusting transitional `actualUnits`;
- already-committed reservation is idempotent;
- active holds can be released.

These tests were authored/updated but **not executed** in this environment.

### Files added/changed this run

- `apps/api/src/db/schema-worklog-grants.ts`
- `apps/api/src/db/schema-worklog-ai-usage.ts`
- `apps/api/src/worklog/ai-point-ledger.ts` (new)
- `apps/api/src/worklog/drizzle-ai-point-ledger.ts` (new)
- `apps/api/src/worklog/ai-point-ledger.test.ts` (new)
- `apps/api/src/worklog/ai-responsibility.ts` (new)
- `apps/api/src/worklog/drizzle-ai-responsibility.ts` (new)
- `apps/api/src/worklog/grant-collaboration.ts` (new transitional LINE adapter)
- `apps/api/src/worklog/text-normalization.ts`
- `apps/api/src/worklog/drizzle-text-normalization.ts`
- `apps/api/src/worklog/gemini-text-normalizer.ts`
- `apps/api/src/worklog/text-normalization.test.ts`
- `apps/api/src/worklog/attachment-ingestion.ts`
- `apps/api/src/worklog/drizzle-attachment-ingestion.ts`
- `apps/api/src/worklog/gemini-attachment-normalizer.ts`
- `apps/api/src/worklog/attachment-ingestion.test.ts`
- `apps/api/src/worklog/drizzle-ai-grants.ts`
- `apps/api/src/worklog/bootstrap.ts`
- `apps/api/src/worklog/subscription.ts` (shared usage payload compatibility only)
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/index.ts`
- `apps/api/src/worker.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Stable completed foundation from earlier batches

Do not redo these unless a regression is found:

- Customer/Project/Finance/category/normalized-summary removed from TypeScript/customer core;
- Source + single Entity/title + Alias + Record + immutable Revision schema/runtime foundation;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization uses active membership, not billing;
- GROUP Source exists independently from AI funding user; obsolete pending-group TypeScript runtime/schema removed;
- old Gemini summary/category/customer/project normalization replaced by single-title/`occurred_at` interpretation and durable ambiguity creation;
- durable pending-confirmation resolution backend exists and resolution does not call AI again;
- obvious LINE HISTORY requests route to deterministic Source-correct filtered PWA links rather than becoming Records;
- obvious LINE EDIT requests are fail-safe and cannot accidentally create a Record while Reply AI edit is unfinished;
- FREE initial grant is exactly **400,000 AI points once**, no expiry/refresh, idempotently provisioned to the user's PRIVATE Source;
- LINE attachment provider/idempotency foundation remains retained.

## Important transitional / blocking state

### 1. Real provider execution is now grant-ledger backed, but legacy quota code/schema still exists

The major runtime cutover is complete: production text/attachment provider paths no longer instantiate legacy subscription quota for AI execution.

However these legacy structures still exist for old Admin/subscription/reporting compatibility and must be removed in a later concentrated cleanup:

- `schema-worklog-quota.ts` aggregate balances/reservations;
- legacy reservation/settlement methods in subscription repositories/services;
- plan `ai_allowance_units` / aggregate usage assumptions in older Admin/PWA reporting;
- transitional `ai_units_consumed`;
- compatibility status/copy such as `AI_QUOTA_EXHAUSTED` in parts of LINE runtime.

Do not delete them blindly until all reads are identified and replaced with grant-based views.

### 2. Old Source Owner columns remain transitional storage, but are no longer authoritative for provider funding

`owner_user_id` / `subscription_owner_user_id` remain in Source/bootstrap/Admin legacy structures, and `bindGroupOwner` keeps its old public name for compatibility.

Production group AI charged-user selection is now authoritative from `worklog_source_ai_responsibility`. Manual GROUP data access remains independent.

Next cleanup should remove old funding semantics and eventually rename compatibility `OWNER_*` runtime statuses/copy to AI-responsibility terminology.

### 3. GROUP grant allocation UX/API is not yet implemented

A responsible user may have FREE/top-up/subscription points but GROUP AI only works when one or more of that user's grants are **explicitly scoped to that GROUP Source**.

This is intentional isolation. Do not automatically leak the PRIVATE FREE grant to every group.

Admin/PWA needs a bounded way to allocate an eligible user grant to selected GROUP Sources and optional caps.

### 4. Subscription-period and top-up grant creation are not yet wired

The ledger supports `SUBSCRIPTION_PERIOD` and `TOP_UP`, but actual successful renewal/payment lifecycle provisioning is still pending. FREE initial provisioning is the only production grant creation path currently wired.

### 5. PWA confirmation backend exists, UI still pending

Authenticated deterministic confirmation APIs exist, but the normal PWA Records UI does not yet render pending title ambiguity/candidate actions.

### 6. Actual LINE Reply AI edit is still not implemented

Safety guard remains correct: Reply-targeted edits are recognized but refused rather than guessing. Remaining work requires deterministic replied Record mapping, point preflight, provider mutation interpretation, title ambiguity handling, version/revision transaction and exactly-once settlement.

### 7. Attachment usage operation classification is still generic

The point ledger records provider cost/points correctly, but attachment usage currently falls back to `operation = UNKNOWN` unless supplied by the persisted usage payload. Add a stable attachment operation tag before relying on per-operation Admin pricing analytics.

### 8. Prelaunch migration baseline/snapshot remain stale — deployment is blocked

`drizzle/0000_worklog_baseline.sql` and `drizzle/meta/0000_snapshot.json` still describe obsolete pre-refactor structures and do not include the final Record/grant/responsibility/confirmation/point-reservation schema. `_journal.json` still points at the stale baseline.

Do **not** hand-fabricate a large Drizzle snapshot just to appear synchronized. Regenerate from the actual current TypeScript schema and exercise a fresh disposable PostgreSQL database once a checked-out pnpm/project toolchain is available.

The branch is not migration/deployment-ready until this is done.

### 9. New point-ledger SQL is not runtime-validated yet

The repository uses PostgreSQL data-modifying CTEs, row locks, expiry restoration, cap holds, multi-grant funding and exactly-once usage insertion. The static design matches the product invariants, but it requires real disposable-Postgres validation before production deployment.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Remove/replace remaining legacy aggregate-quota and Owner funding reads.**
   - inventory old Admin/PWA/subscription usage readers;
   - replace user/group balance views with grant-based current balance + scoped usage;
   - remove legacy provider reservation methods/schema only after no runtime reader remains;
   - remove `owner_user_id` / `subscription_owner_user_id` funding semantics and compatibility gates;
   - retire transitional `ai_units_consumed` when Admin reporting uses customer points/provider cost directly.

2. **Implement grant allocation management for GROUP Sources.**
   - responsible user can select which owned grants fund a GROUP;
   - optional per-GROUP cap;
   - never expose unrelated PRIVATE/other-GROUP balances to other members;
   - active members may see current GROUP-specific availability/history only.

3. **Implement PWA pending-confirmation UI.**
   - show unresolved Record/proposed title/candidates;
   - choose candidate, create/enter title or reject;
   - refresh Record/title list after resolution;
   - no AI call on resolution.

4. **Finish Reply-targeted LINE AI edit on the grant/idempotent layer.**

5. **Wire `SUBSCRIPTION_PERIOD` and `TOP_UP` grant creation after billing/payment lifecycle contract is ready.**

6. **Add Admin grant/point/subsidy/pricing analytics on real grant usage facts.**

7. **Regenerate consolidated prelaunch migration baseline/snapshot and run concentrated validation when a real local project toolchain is available.**
   - typecheck/build/Vitest;
   - disposable PostgreSQL migration;
   - point-ledger concurrency/expiry/overage tests;
   - browser/PWA flows;
   - LINE/Gemini/runtime smoke;
   - then workers.dev deployment.

## Remaining later work

- paid export after core runtime validation;
- provider-native DOCX/XLSX ingestion validation/hardening;
- payment-provider lifecycle after merchant eligibility/fees are confirmed;
- Cloudflare workers.dev deployment/runtime validation.

## Validation status

This run performed static repository edits only. No build, TypeScript typecheck, Vitest execution, migration, browser, Worker, LINE, Gemini or database runtime validation was executed here. New/updated tests encode intended behavior but are **not claimed passing**.

The current branch is an active refactor checkpoint, **not deployment-ready** because the consolidated migration baseline/snapshot are stale and the new point-ledger SQL has not been executed against disposable PostgreSQL yet.

**GitHub Actions were not run, dispatched, rerun, enabled, modified, or otherwise triggered.**

## Planning estimate

Planning-only estimate after this batch:

- product/domain contract: ~99% defined for core MVP;
- Record/manual PWA/HISTORY foundation: materially implemented;
- pending-title resolution backend: materially implemented, UI pending;
- FREE grant + user-owned scoped grant foundation: materially implemented;
- text/attachment provider runtime cutover to point ledger: materially implemented statically;
- GROUP AI responsibility runtime cutover: materially implemented statically;
- major remaining core work: legacy quota/Owner cleanup, group grant allocation, Reply edit, Admin grant analytics, migration/runtime validation;
- rough expectation: **2–3 substantial implementation batches before concentrated migration/runtime validation**, then deployment-fix iterations as required.
