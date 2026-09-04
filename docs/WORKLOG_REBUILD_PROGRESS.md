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

## Current execution checkpoint — 2026-09-04 08:26 batch

This run continued from the completed single-title Record/manual-PWA foundation, durable confirmation backend/UI, FREE 400,000-point provisioning, GROUP AI responsibility separation, grant-backed provider settlement, GROUP funding UI and grant-aware Admin reporting. It did not redo those batches.

The highest-priority work this run was the first safety-critical half of Reply-targeted LINE AI edit: deterministic same-Source Reply-to-Record resolution. Provider-backed edit interpretation/mutation remains intentionally disabled until its own durable idempotent pipeline is wired.

### Scanned this run

- all required durable product/development/deployment docs;
- `records.ts` and `drizzle-records.ts` LINE identity fields and current single-title/version state;
- GROUP `line-runtime.ts` edit interception and active-member authorization boundary;
- PRIVATE `oa-runtime.ts` edit interception and personal Source boundary;
- current command parser EDIT/HISTORY separation;
- existing runtime/service tests around LINE edit safety;
- the remaining legacy collaboration/subscription boundary to ensure this batch did not accidentally route manual Reply target lookup through billing.

## Completed this run

### 1. Deterministic same-Source Reply edit target resolution now exists

`WorklogRecordWriteService` now exposes a bounded `resolveReplyEditTarget(sourceId, quotedLineMessageId)` contract.

The PostgreSQL repository resolves a Reply only against Records in the exact current Source and only through durable LINE identity already stored on the Record:

- `record.line_message_id = quotedLineMessageId`; or
- `record.quoted_line_message_id = quotedLineMessageId`.

This covers Reply to a directly recorded LINE message and Reply to original content that was recorded through the existing Reply-recording path.

The resolver never performs a global LINE-message lookup and therefore cannot cross PRIVATE/GROUP Sources or cross two different GROUP Sources.

Resolution is conservative:

- exactly one matching ACTIVE Record -> `FOUND` with the current `recordId`, `entityId`, `rawText`, `occurredAt` and optimistic `version` snapshot;
- more than one matching ACTIVE Record -> `AMBIGUOUS`;
- no ACTIVE match but one or more deleted matches -> `DELETED`;
- no same-Source match -> `NOT_FOUND`.

The query orders ACTIVE rows first and reads at most three candidates, which is enough to distinguish a unique active target from an ambiguous one without loading unbounded history.

### 2. GROUP LINE edit now checks membership and target identity before any future AI work

For an obvious `EDIT_REQUEST` with a Reply target, GROUP runtime now:

1. boots/touches the current GROUP Source as before;
2. requires free/manual active-member authorization;
3. resolves the Reply target only inside that exact Source;
4. returns explicit safe failures for missing, ambiguous or deleted targets.

It does **not** call the legacy group funding authorization or any Gemini/provider path for these unresolved edit cases.

A uniquely resolved active target is still returned as `EDIT_NOT_READY`; no Record mutation occurs yet. This is deliberate: reliable targeting is now established, while the provider edit + grant settlement + version/revision transaction remains a separate next batch.

### 3. PRIVATE LINE edit now resolves only inside the user's personal Source

After OA-friend/private Source bootstrap succeeds, a private EDIT request with Reply now uses the same deterministic resolver with `personal.sourceId`.

Missing, ambiguous and deleted private targets are rejected explicitly. A unique active target is still not mutated until the AI edit pipeline is wired.

### 4. Reply edit target contract carries the optimistic version snapshot needed by the next mutation stage

The resolved target contains:

- Record ID;
- Source ID;
- author user ID;
- current single Entity ID;
- durable raw content;
- durable `occurred_at`;
- current integer `version`.

This lets the next provider-backed edit stage capture the exact pre-provider target state and later refuse mutation if manual/PWA editing changed the version while Gemini was running.

### 5. Fixed a stale Record test model left by the old Customer/Project/category refactor

`records.test.ts` was still constructing `WorklogRecordListItem` with removed fields such as `category`, `normalizedSummary`, `customerId`, `projectId` and `sourceTimestamp`.

The fixture now matches the current single-title Record contract (`entityId`, `title`, `occurredAt`, `status`, `version`, `deletedAt`). Reply-target service/runtime test doubles were also updated to the new bounded resolver contract.

### Files changed this run

- `apps/api/src/worklog/records.ts`
- `apps/api/src/worklog/drizzle-records.ts`
- `apps/api/src/worklog/line-runtime.ts`
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/worklog/records.test.ts`
- `apps/api/src/worklog/line-runtime.test.ts`
- `apps/api/src/worklog/oa-runtime.test.ts`
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
- obvious LINE EDIT requests cannot accidentally become new Records;
- deterministic same-Source Reply-to-Record resolution now exists for existing durable Record LINE IDs and refuses missing/ambiguous/deleted targets;
- FREE initial grant is exactly 400,000 AI points once, no expiry/refresh, idempotently provisioned to the user's PRIVATE Source;
- text and attachment provider execution use the user-owned grant ledger;
- actual provider cost converts to customer points through the frozen output-price-equivalent rule;
- customer balances do not go negative and provider overage is recorded as platform subsidy;
- GROUP provider charged-user resolution uses `worklog_source_ai_responsibility`, not legacy Owner/subscription-owner fields;
- provider result/usage settlement remains resumable/idempotent;
- customer usage backend is Source/grant based;
- GROUP customer funding/allocation UI is Source-scoped and grant-backed;
- Admin user/group reporting is grant/responsibility based and the old Admin aggregate-quota reporting SQL has been removed;
- normalization durable reservation FK points to the grant-backed point reservation table.

## Important transitional / blocking state

### 1. Reply-targeted LINE AI edit is only half complete

Safety behavior is now stronger: obvious edit requests cannot become new Records, GROUP membership/private Source is checked first, and durable Reply IDs resolve only inside the exact Source.

Remaining implementation needs:

- persist/resolve a bounded mapping for Reply to a bot success/result message when LINE gives a bot-message Reply ID that is not the original Record LINE ID;
- positive grant point preflight before provider edit interpretation;
- bounded provider output for content/`occurred_at`/single-title change only;
- durable edit-specific provider state so LINE redelivery cannot double-call Gemini after provider success is uncertain;
- normal Entity/Alias/pending-confirmation behavior when title changes;
- optimistic `version` check against the captured target version;
- immutable Revision + Record mutation in one transaction;
- idempotent point settlement so redelivery cannot double-charge;
- safe user-facing response when the target changed while the provider call was in flight.

Do not weaken the new resolver by guessing from content, author, latest Record or nearest timestamp.

### 2. PRIVATE PWA top usage summary is still transitional

GROUP scopes use `GroupFunding` and no longer display `/usage/me` aggregate quota data.

The PRIVATE top usage bar still consumes the old compatibility `/usage/me` shape. Replace it with a PRIVATE grant-ledger summary/history surface before deleting the remaining aggregate usage reader.

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

### 9. New grant/funding and Reply-target SQL is still not runtime-validated

The grant ledger/funding configuration use PostgreSQL row locks, CTEs, cap/reservation invariants and exactly-once settlement. The new Reply-target resolver also relies on the current Record LINE identity columns and PostgreSQL query behavior.

Static edits are not production proof; real disposable PostgreSQL validation is required before Workers deployment.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Finish provider-backed Reply-targeted LINE AI edit on top of the new resolver.**
   - first inspect/persist bot-success Reply mapping if the LINE outbound path exposes the sent message ID needed by product policy;
   - capture target `version` before provider call;
   - require a positive eligible grant balance before provider call;
   - add bounded edit provider output for `rawText`/`occurredAt`/single title only;
   - persist provider-success state before settlement/mutation so redelivery cannot double-call;
   - settle actual provider cost through the grant ledger;
   - apply optimistic version + immutable Revision transaction;
   - route ambiguous changed titles through durable Pending Confirmation rather than guessing.

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
   - Reply-target and edit idempotency tests;
   - point-ledger/funding concurrency tests;
   - browser/PWA flows;
   - LINE/Gemini/runtime smoke;
   - then workers.dev deployment.

## Rough remaining work

Planning-only estimate from the current branch state:

- core product/domain contract: essentially defined;
- major non-payment runtime work before concentrated validation: roughly 2–3 substantial batches;
- the unsafe target-selection part of Reply AI edit is now addressed; provider-backed edit mutation and final subscription/quota collapse remain the largest core implementation items;
- payment provider integration remains a separate later batch;
- deployment should not start until migration regeneration and runtime validation succeed.

## Validation status

This run performed static GitHub repository edits and static cross-file review only. The current execution environment has no checked-out AFTERTRACE project/toolchain, so no local build, TypeScript typecheck, Vitest execution, migration, browser, Worker, LINE, Gemini or PostgreSQL runtime validation was executed here.

The tests changed this run are authored/updated specifications only; they are **not claimed as passing**.

No GitHub Actions were run, dispatched, rerun, enabled, modified, or otherwise triggered.

The branch remains an active refactor checkpoint and is **not deployment-ready** because the migration baseline/snapshot are stale and the new grant/funding/Reply-target SQL has not yet run against disposable PostgreSQL.
