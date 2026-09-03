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

## Current execution checkpoint — 2026-09-04 00:xx batch

This run continued from the previous manual-GROUP authorization checkpoint. It did **not** redo the backend entitlement split. The main goals were to remove the customer Web dependency on legacy Owner/CRM/finance APIs and to start the accepted single-title Record schema foundation.

### Scanned this run

- all required product/entity/edit/AI-point/development/LINE-content/deployment/progress documents;
- `apps/web/src/WorklogRoot.tsx`;
- `apps/web/src/worklog-api.ts`;
- `apps/web/src/SubscriptionRoot.tsx`;
- `apps/api/src/worklog/routes.ts`;
- current collaboration repository/service boundaries;
- current `schema-worklog.ts` legacy Customer/Project/Transaction/Record structure;
- `schema-all.ts` migration/schema export path.

### Completed this run

1. **Customer Web no longer fetches or depends on GROUP Owner view.**
   - Removed `GroupOwnerView` state/fetch.
   - Removed Owner panel and member `recordingEnabled` controls.
   - Loading a GROUP scope now performs only the already-authorized records request.
   - This closes the previous Web blocker where a valid active group member could still fail because the UI requested an Owner-only endpoint.

2. **Legacy Customer / Project / Finance customer UI was removed from the normal PWA.**
   - Removed `客戶 / 專案` and `收支` tabs from `WorklogRoot`.
   - Removed Customer/Project/Transaction CRUD UI and old Record `category/customer/project/normalizedSummary` editing UI.
   - Record list now renders durable raw Record text and trace time only until the new title/Record editor is wired.
   - Filter UI is intentionally narrowed to fuzzy text + date range. Title filter will be added against the new Entity schema.

3. **Customer Web API client was narrowed to surviving product surfaces.**
   - Removed Owner-view/member-recording methods.
   - Removed Customer/Project/Transaction types and CRUD methods.
   - Removed category/customer/project/input-type filter parameters from the customer records query.
   - Subscription/checkout and feedback surfaces remain.

4. **Customer Worklog API routes no longer expose legacy Owner/CRM/finance operations.**
   - Removed customer-facing Owner-view/member-recording endpoints.
   - Removed Customer/Project/Transaction CRUD endpoints and obsolete old Record metadata-edit endpoint.
   - Route context no longer constructs `DrizzleWorklogWorkspaceManagementRepository`.
   - GROUP read error handling is now only Source/membership authorization, not Owner/plan metadata.
   - Transitional record search SQL no longer joins Customer/Project or normalized summaries/categories; it searches durable raw text and time only until Entity/occurred-at migration lands.

5. **Subscription UI no longer advertises legacy group entitlement/limits.**
   - Removed `groupCollaboration` / `maxGroupCount` presentation.
   - Explicitly states group count is unlimited and manual PWA is not unlocked by subscription.
   - Customer label changed from generic AI allowance wording to **AI 點數** while the API field remains transitional.

6. **Single-title Record schema foundation was added.**
   - Added `apps/api/src/db/schema-worklog-record-core.ts`.
   - Added Source-scoped `worklog_entities`.
   - Added Source-scoped confirmed `worklog_entity_aliases`.
   - Added immutable `worklog_record_revisions` snapshot structure.
   - Added durable `worklog_ai_confirmations` with `ALIAS_MATCH`, `RECORD_TITLE`, `ENTITY_MATCH` and pending/resolved statuses.
   - Added Record/Entity/revision/confirmation enums.
   - Did **not** add a generic `worklog_record_entities` many-to-many table.
   - Exported the new schema from `schema-all.ts`.

7. **FREE AI-point policy inconsistency was corrected.**
   - `WORKLOG_AI_POINT_POLICY.md` now freezes MVP FREE at **400,000 AI points once**.
   - It no longer tells future runs to recalculate the exact FREE balance from live pricing/FX.
   - Historical grants remain immutable; future promotional changes require an explicit new configuration/product decision.

### Files changed this run

- `apps/web/src/WorklogRoot.tsx`
- `apps/web/src/worklog-api.ts`
- `apps/web/src/SubscriptionRoot.tsx`
- `apps/api/src/worklog/routes.ts`
- `apps/api/src/db/schema-worklog-record-core.ts` (new)
- `apps/api/src/db/schema-all.ts`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Important transitional state after this run

The new Record-core tables are a **schema foundation, not yet the final migrated Record runtime**.

Current legacy `worklog_records` still lacks the final accepted fields:

- `entity_id`;
- `occurred_at` as the authoritative event-time field;
- `status` (`ACTIVE` / `DELETED`);
- integer `version`;
- delete actor/time metadata.

It still physically contains old Customer/Project/category/normalized-summary columns in `schema-worklog.ts` and the consolidated prelaunch SQL baseline. Those columns are no longer exposed in customer Web/API but must be removed in the destructive schema batch.

`schema-worklog-record-core.ts` currently references the legacy `worklog_records` id for revision/confirmation foreign keys so the accepted audit structures can be established before the destructive Record-row rewrite. Do not treat the migration baseline as ready until the next schema batch updates `worklog_records` and `drizzle/0000_worklog_baseline.sql` consistently.

The Web Record surface is intentionally browse-only for this short transition. The obsolete metadata editor was removed rather than pretending it satisfied the accepted free manual editing contract. Manual create/edit/delete/restore/title-move will be reintroduced only against the correct Entity/version/revision schema.

The displayed `UserUsage` / plan `ai_allowance_units` shape is also still the legacy aggregate quota representation. It remains temporarily for continuity and must be replaced by grants/points later.

## Next implementation batch — highest priority

Continue directly with the destructive core Record schema replacement:

1. rewrite `worklog_records` around the accepted universal fields:
   - `source_id`;
   - single `entity_id`;
   - `author_user_id`;
   - durable `raw_text`;
   - `input_type` and LINE trace ids;
   - `occurred_at`;
   - `status`;
   - integer `version`;
   - `deleted_at` / `deleted_by_user_id`;
   - normal timestamps;
2. remove universal Customer/Project/Transaction/category/normalized-summary schema from `schema-worklog.ts` and then delete dead workspace-management runtime/tests when references are gone;
3. update the prelaunch consolidated migration baseline and schema snapshot/journal consistently; do not leave the new schema only in TypeScript;
4. implement a Drizzle Record/Entity repository with Source-scoped title lookup/autocomplete, alias lookup, fuzzy title/alias/raw-text search and `occurred_at` date range;
5. implement free manual API operations with authorization + optimistic concurrency + immutable revisions:
   - create;
   - edit content/time;
   - move title;
   - batch move;
   - soft delete;
   - recycle-bin list;
   - restore;
   - revision history;
6. wire the PWA manual create/editor/title autocomplete and these operations for PRIVATE owner / active GROUP member;
7. only after manual core is stable, replace LINE Gemini normalization output with CREATE/EDIT/HISTORY title/time intent and then move AI funding to grants + AI 額度負責人.

## Stable product contract

- General-purpose work recording; no universal construction/finance/Customer/Project domain.
- Core model: Source + single Entity/title + Alias + Record + Revision + pending AI confirmation.
- PRIVATE/GROUP Sources are isolated data spaces.
- Active GROUP members can manually browse/create/edit/delete/restore/move records without subscription, legacy Owner or AI points.
- PWA manual CRUD/search is free; only actual AI compute consumes AI points.
- No group-count limit.
- Customer-facing role is **AI 額度負責人**.
- AI allowance is user-owned through independent FREE/subscription/top-up grants with scope allocation/caps.
- FREE launch grant = **400,000 AI points once**, no calendar refresh/expiry.
- 1 AI point = 1 output-price-equivalent token; real provider cost is separately auditable.
- Zero eligible points before AI start means no provider call. Positive-start overage floors customer balance at zero and records platform subsidy.
- PWA search contract: title + fuzzy title/alias/content + `occurred_at` date range.
- LINE history AI converts natural language to deterministic PWA filters; it is not a broad historical answering agent.
- Persistent per-record AI summaries are not MVP.
- PWA edits use immutable revisions and integer-version optimistic concurrency.
- Delete is soft delete with recycle bin/restore.
- Record title move and batch move are MVP; duplicate-title Merge/Undo is not.
- PWA manual input is text-only. LINE binary attachments are converted to durable text then discarded.
- Brand/product/LINE OA name is frozen as **AFTERTRACE**; current slogan direction is **隨筆落墨，AI 循跡。**
- First deployment may use Cloudflare `workers.dev`; no purchased domain is required.
- Payment provider remains not frozen; NewebPay is the current early-MVP preferred candidate, ECPay fallback, Oen only if a materially better negotiated quote appears.

## Remaining major debt

1. **COMPLETE for customer manual read path:** remove legacy max-group/groupCollaboration/Owner gating from GROUP browse.
2. **COMPLETE for customer UI/API surface:** remove Owner member-recording UI/API plus Customer/Project/Finance customer features.
3. **FOUNDATION ADDED / MIGRATION PENDING:** Entity/Alias/Revision/AI-confirmation schema.
4. **NEXT:** final Record row + destructive migration baseline.
5. manual PWA CRUD/title/search/revision/delete/restore/batch move.
6. replace pending-group/legacy data Owner bootstrap so GROUP Source exists independently of an Owner claim.
7. bounded LINE CREATE/EDIT/HISTORY intent + filtered deep links + Reply edit.
8. replace Gemini summary/category/customer/project output with title/time/history-filter interpretation.
9. user-owned AI grant/scope/cap ledger and AI 額度負責人 transfer/recovery.
10. AI settlement conversion from provider cost to output-equivalent points, plus platform subsidy rather than customer overdraw.
11. FREE/PRO/TEAM billing types, FREE one-time grant and monthly/top-up independent grants.
12. Admin pricing calculator, utilization/profitability/subsidy analytics.
13. paid export after manual core.
14. provider-native DOCX/XLSX ingestion validation/hardening.
15. payment-provider lifecycle after merchant eligibility/fees are confirmed.
16. Workers deployment/runtime validation.

## Validation status

Static code/schema/doc changes only in this run. No local build, typecheck, unit test, migration, browser, Worker, LINE or Gemini runtime validation was executed, so none is claimed successful.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Planning-only estimate after this batch:

- static product/domain contract: ~99% defined for core MVP;
- customer browse surface legacy cleanup: largely complete;
- core Record schema migration + manual CRUD remains the largest near-term block;
- expect roughly 4–5 substantial implementation batches before concentrated validation;
- rough internal coding range before validation: ~12–24 focused hours, payment-provider integration separate;
- reserve additional time for compile/schema/browser/runtime fixes once validation begins.
