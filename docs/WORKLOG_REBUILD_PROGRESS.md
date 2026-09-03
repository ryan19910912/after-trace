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

## Current execution checkpoint — 2026-09-04 07:29 batch

This run continued from the completed single-title Record/manual-PWA foundation, durable confirmation backend, FREE 400,000-point provisioning, GROUP AI responsibility separation, grant-backed provider settlement and grant-aware Admin reporting. It did not redo those batches.

### Scanned this run

- all required durable product/development/deployment docs;
- customer Web/PWA `WorklogRoot.tsx` and `worklog-api.ts`;
- GROUP funding customer API and its Source/privacy boundaries;
- pending-confirmation customer API and deterministic resolver contract;
- Worker route mounting for funding/confirmation APIs;
- text-AI durable normalization schema/repository;
- grant/point reservation schema;
- remaining Admin subscription assignment and old aggregate-quota repository boundary.

## Completed this run

### 1. Customer PWA GROUP funding surface is now wired

`apps/web/src/worklog-api.ts` and `apps/web/src/WorklogRoot.tsx` now consume the existing grant-backed GROUP funding API.

When the active PWA scope is GROUP, the page now shows only that GROUP's:

- current **AI 額度負責人**;
- whether that responsible user is still active in the group;
- currently available points;
- points reserved by in-flight provider work;
- historical customer points charged to this GROUP;
- historical platform-subsidized points.

Manual PWA remains explicitly available when there is no AI 額度負責人 or the responsible user has left the group.

Only the current AI 額度負責人 receives the `grants` inventory from the backend and sees allocation controls. Ordinary members do not receive or display unrelated PRIVATE/other-GROUP balances.

### 2. Responsible user can allocate only their own grants to the active GROUP

The PWA now exposes bounded controls backed by:

- `GET /api/v1/worklog/funding/group/:sourceId`;
- `PUT /api/v1/worklog/funding/group/:sourceId/grants/:grantId`.

For each of the responsible user's grants the UI can:

- enable/disable that grant for this GROUP;
- set an optional non-negative per-GROUP cap;
- leave cap blank to permit the grant's remaining eligible balance;
- display grant remaining points, GROUP-used points, in-flight reserved points and current Source-available points.

The backend remains authoritative for ownership, active-reservation and cap-below-usage conflicts.

### 3. PWA pending-confirmation UI is now implemented

The Records surface now loads the current user's pending title confirmations for the active Source and supports deterministic resolution without another provider call or point charge.

The UI can:

- choose one of the stored existing Entity/title candidates;
- choose the stored single candidate when it was not duplicated in the candidate array;
- create/adopt a new title;
- reject/skip the AI title suggestion.

The already-durable Record text/time is shown while deciding. After resolution, Records, Entities and the pending-confirmation list are refreshed.

### 4. Found and fixed a critical old-quota foreign-key mismatch

`schema-worklog-normalization.ts` still declared `reservation_token` as a foreign key to the obsolete `worklog_ai_quota_reservations` table, even though the text provider runtime now creates `worklog_ai_point_reservations` tokens.

That mismatch would make a successful grant-backed Gemini result fail when persisting the durable provider result.

The normalization state now correctly references `worklog_ai_point_reservations.token`, matching the already grant-backed `getReservationStatus()` and settlement path.

### Files changed this run

- `apps/web/src/worklog-api.ts`
- `apps/web/src/WorklogRoot.tsx`
- `apps/api/src/db/schema-worklog-normalization.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Stable completed foundation from earlier batches

Do not redo these unless a regression is found:

- universal Customer/Project/Finance/category/normalized-summary removed from the TypeScript/customer Record core;
- Source + single Entity/title + Alias + Record + immutable Revision schema/runtime foundation;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization uses active membership, not billing;
- GROUP Source exists independently from AI funding user; obsolete pending-group TypeScript runtime/schema removed;
- old Gemini summary/category/customer/project normalization replaced by single-title/`occurred_at` interpretation;
- durable pending-confirmation creation and deterministic backend resolution;
- PWA pending-confirmation resolution surface;
- obvious LINE HISTORY requests route to deterministic Source-correct filtered PWA links;
- obvious LINE EDIT requests cannot accidentally become new Records while Reply AI edit is unfinished;
- FREE initial grant is exactly 400,000 AI points once, no expiry/refresh, idempotently provisioned to the user's PRIVATE Source;
- text and attachment provider execution use the user-owned grant ledger;
- actual provider cost converts to customer points through the frozen output-price-equivalent rule;
- customer balances do not go negative and provider overage is recorded as platform subsidy;
- GROUP provider charged-user resolution uses `worklog_source_ai_responsibility`, not legacy Owner/subscription-owner fields;
- provider result/usage settlement remains resumable/idempotent;
- customer usage backend is Source/grant based;
- GROUP customer funding/allocation UI is Source-scoped and grant-backed;
- Admin user/group reporting is grant/responsibility based and the old Admin aggregate-quota reporting SQL has been removed;
- normalization durable reservation FK now points to the grant-backed point reservation table.

## Important transitional / blocking state

### 1. PRIVATE PWA top usage summary is still transitional

GROUP scopes now use `GroupFunding` and no longer display `/usage/me` aggregate quota data.

The PRIVATE top usage bar still consumes the old compatibility `/usage/me` shape. Replace it with a PRIVATE grant-ledger summary/history surface before deleting the remaining aggregate usage reader.

### 2. Actual LINE Reply AI edit is still pending

Safety behavior remains correct: obvious edit requests cannot become new Records and a missing Reply target is refused.

Remaining implementation needs:

- deterministic `quotedLineMessageId` -> Record mapping inside the same Source;
- reliable target rejection when no unique active Record exists;
- positive grant point preflight before provider edit interpretation;
- bounded AI edit output for content/occurred-at/title change;
- normal Entity/Alias/pending-confirmation behavior when title changes;
- optimistic `version` + immutable Revision mutation;
- provider result / point settlement idempotency so LINE redelivery cannot double-call or double-charge.

### 3. Legacy subscription aggregate quota implementation still exists

Provider execution, GROUP PWA funding and Admin customer usage reporting no longer depend on it, but Admin plan assignment still imports `DrizzleWorklogSubscriptionRepository` / `WorklogSubscriptionService` and that repository still creates/reads:

- `worklog_ai_quota_balances`;
- `worklog_ai_quota_reservations`;
- aggregate reserve/commit/release methods.

Subscription must become metadata/lifecycle whose successful period creates an independent `SUBSCRIPTION_PERIOD` grant. It must not remain a second live AI balance system.

After Admin/payment lifecycle callers are migrated, remove:

- `schema-worklog-quota.ts`;
- `DrizzleWorklogSubscriptionRepository` aggregate reservation methods;
- the old subscription service AI reserve/commit/release contract;
- old quota-focused tests/readers;
- transitional aggregate usage fields when no UI/API needs them.

### 4. SUBSCRIPTION_PERIOD and TOP_UP grant provisioning are not wired

The ledger supports these types, but successful subscription renewal/payment and one-time top-up provisioning still need idempotent grant-origin keys and PRIVATE/default + selected GROUP scope handling.

FREE initial provisioning remains the only fully wired lifecycle grant creator.

### 5. Plan billing type is not yet represented explicitly in schema

Product contract is:

- FREE = `ONE_TIME`;
- PRO/TEAM = `MONTHLY`.

`worklog_subscription_plans` still has the transitional `ai_allowance_units` template field but no explicit billing-type column. Add the durable billing-type model while converting subscription lifecycle to grant creation.

### 6. Admin pricing/profitability analytics are incomplete

Provider cost/points/subsidy facts exist and overview backend exposes daily charged/subsidized facts. Remaining work includes:

- surface those new overview point/subsidy metrics in Admin UI;
- selectable-period average/median usage and cost;
- utilization/exhaustion;
- FREE subsidy/conversion;
- realized gross margin;
- pricing recommendation calculator with explicit Admin-confirmed persisted points.

### 7. Attachment operation classification is still generic

Attachment accounting is grant-correct, but operation may still fall back to `UNKNOWN`. Add stable operation tags before relying on per-operation pricing analytics.

### 8. Prelaunch migration baseline/snapshot remain stale — deployment is blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and journal still describe obsolete structures, including old aggregate quota and pre-refactor schema.

Do not hand-fabricate the large Drizzle snapshot. Regenerate it from the actual TypeScript schema and run a fresh disposable PostgreSQL migration when a checked-out pnpm/project toolchain is available.

### 9. New grant/funding SQL is still not runtime-validated

The grant ledger and funding configuration use PostgreSQL row locks, CTEs, cap/reservation invariants and exactly-once settlement. Static edits are not production proof; real disposable PostgreSQL validation is required before Workers deployment.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Finish Reply-targeted LINE AI edit on the grant/idempotent layer.**
   - start with deterministic same-Source Reply-to-Record resolution;
   - refuse ambiguous/missing/deleted/stale targets;
   - then wire bounded provider edit interpretation + point settlement + version/revision mutation.

2. **Replace PRIVATE `/usage/me` aggregate summary with grant-ledger customer usage.**

3. **Collapse subscription entitlement to metadata/lifecycle and remove aggregate quota.**
   - add explicit plan billing type;
   - subscription period creates an immutable `SUBSCRIPTION_PERIOD` grant;
   - PRIVATE scope may be provisioned automatically for the grant owner while GROUP scopes remain explicit;
   - provider AI eligibility stays grant-only;
   - then delete old quota schema/service/repository paths.

4. **Wire TOP_UP grant creation when payment lifecycle is ready.**

5. **Finish Admin pricing/profitability analytics and surface existing overview point/subsidy metrics.**

6. **Regenerate prelaunch Drizzle baseline/snapshot and run concentrated validation when a real local project toolchain is available.**
   - typecheck/build/Vitest;
   - disposable PostgreSQL migration;
   - point-ledger/funding concurrency tests;
   - browser/PWA flows;
   - LINE/Gemini/runtime smoke;
   - then workers.dev deployment.

## Rough remaining work

Planning-only estimate from the current branch state:

- core product/domain contract: essentially defined;
- major non-payment runtime work before concentrated validation: roughly 2–3 substantial batches;
- Reply AI edit and final subscription/quota collapse are now the largest core implementation items;
- payment provider integration remains a separate later batch;
- deployment should not start until migration regeneration and runtime validation succeed.

## Validation status

This run performed static GitHub repository edits and static cross-file review only. No local build, TypeScript typecheck, Vitest execution, migration, browser, Worker, LINE, Gemini or PostgreSQL runtime validation was executed here.

No GitHub Actions were run, dispatched, rerun, enabled, modified, or otherwise triggered.

The branch remains an active refactor checkpoint and is **not deployment-ready** because the migration baseline/snapshot are stale and the new grant/funding SQL has not yet run against disposable PostgreSQL.
