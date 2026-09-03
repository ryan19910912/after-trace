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

## Current execution checkpoint — 2026-09-04 01:xx batch

This run continued from the previous single-title schema foundation checkpoint. It did **not** redo the GROUP manual-authorization or Customer/Project/Finance customer-surface cleanup. The main goal was to replace the legacy Record domain in TypeScript/runtime code, add free manual PWA CRUD/search/title operations, and remove attachment persistence dependence on category/normalized-summary fields.

### Scanned this run

- all required product/entity/edit/AI-point/development/LINE-content/deployment/progress documents;
- `apps/api/src/db/schema-worklog.ts`;
- `apps/api/src/db/schema-worklog-record-core.ts`;
- `apps/api/src/db/schema-all.ts`;
- normalization/attachment schema FKs;
- `apps/api/src/worklog/records.ts` and `drizzle-records.ts`;
- customer Worklog routes;
- legacy workspace-management runtime;
- attachment ingestion/provider/tests;
- customer Web API client and `WorklogRoot`;
- prelaunch SQL baseline/journal status;
- legacy text-normalization repository, which still needs the dedicated LINE intent/title rewrite.

### Completed this run

1. **The universal TypeScript schema no longer defines Customer/Project/Transaction/category/normalized-summary as Record-core data.**
   - `schema-worklog.ts` no longer declares Customer, Project, Transaction, record-category or transaction/project enums/tables.
   - The old `worklog_records` definition was removed from `schema-worklog.ts`.
   - Users, Sources, memberships, plans, runtime AI pricing, feedback, anomalies and audit remain.
   - Workspace plus legacy Source Owner/subscription-owner/member-recording columns are intentionally marked transitional because bootstrap/AI funding still references them; manual PWA authorization does not.

2. **`schema-worklog-record-core.ts` now owns the accepted single-title Record model.**
   - `worklog_entities`: Source-scoped user-facing 紀錄標題.
   - `worklog_entity_aliases`: confirmed Source-scoped alternate titles.
   - `worklog_records`: `source_id`, single nullable-during-AI-resolution `entity_id`, author, LINE trace ids, input type, durable `raw_text`, authoritative `occurred_at`, `ACTIVE/DELETED`, integer `version`, delete actor/time and timestamps.
   - `worklog_record_revisions`: immutable before/after text/time/title/status snapshots keyed by resulting version.
   - `worklog_ai_confirmations`: durable `ALIAS_MATCH` / `RECORD_TITLE` / `ENTITY_MATCH` ambiguity state.
   - No PRIMARY/RELATED Record-Entity many-to-many model was added.

3. **AI provider usage schema was split from the old base domain.**
   - Added `schema-worklog-ai-usage.ts` so immutable provider usage/cost facts reference the new Record table without reintroducing CRM/finance semantics.
   - `ai_units_consumed` remains explicitly transitional until the grant/AI-point settlement batch.
   - `schema-all.ts`, attachment schema and normalization schema now reference the new Record-core table.

4. **LINE raw TEXT persistence/read paths now use the final Record columns.**
   - `drizzle-records.ts` no longer inserts workspace/category/source_timestamp/normalized-summary fields.
   - New LINE text Records persist raw text + `occurred_at`, status/version and trace ids.
   - `entity_id` may temporarily be null only while the later AI title pipeline resolves/asks for confirmation.
   - Record reads join the current title, hide deleted rows and sort by `occurred_at`.

5. **Free manual PWA Record APIs were implemented against Source/member authorization, not billing entitlement.**
   - PRIVATE = active PRIVATE Source owned by current user.
   - GROUP = current user is an active member of an active GROUP Source.
   - Added title/entity autocomplete endpoints for PRIVATE/GROUP.
   - Added manual create with existing-title reuse / deterministic new-title creation and date-time `occurredAt`.
   - Added manual edit with `expectedVersion` optimistic concurrency and immutable revision insert.
   - Added single Record title move.
   - Added same-Source batch title move (max 100) with expected versions and all-or-none update/revision CTE.
   - Added soft delete, recycle-bin list, restore and revision-history read.
   - Search now composes `entityId`, fuzzy title/alias/raw-text query and `occurred_at` date range.
   - Manual operations do not call AI or inspect subscription/quota.

6. **The old workspace Customer/Project/Finance runtime was physically deleted.**
   - Deleted `drizzle-workspace-management.ts`.
   - Deleted its obsolete test file.

7. **Customer Web client and PWA were wired to the new manual Record contract.**
   - Record DTO now uses title/entity, `occurredAt`, status, version and delete state.
   - Added entity autocomplete/list APIs, create/edit/move/batch-move/delete/restore/revision/recycle APIs.
   - PWA now exposes:
     - 紀錄標題 filter;
     - fuzzy title/alias/content search;
     - occurred-time date range;
     - `＋新增紀錄` with title/content/date-time picker;
     - edit content/time;
     - single-title move;
     - checkbox batch move;
     - 回收桶 and restore;
     - revision history.
   - Editor state was separated from persisted Record state so partial `datetime-local` editing no longer attempts `toISOString()` on every keystroke.
   - PRIVATE/GROUP discriminated API scope construction was made explicit to avoid a union-literal typing hazard.

8. **Attachment storage no longer depends on removed category/summary/attachment Record columns.**
   - Attachment ingestion now persists only durable extracted/transcribed `raw_text`, trace ids, input type, occurred time and Record state/version.
   - Gemini attachment structured output now returns only `raw_text` for durable content; it no longer asks for or persists `summary` or `category`.
   - Provider metadata remains transient to processing; there is still no permanent PWA attachment library.
   - Attachment tests were updated to the new durable-text output contract, but were **not executed**.

### Files changed this run

- `apps/api/src/db/schema-worklog.ts`
- `apps/api/src/db/schema-worklog-record-core.ts`
- `apps/api/src/db/schema-worklog-ai-usage.ts` (new)
- `apps/api/src/db/schema-all.ts`
- `apps/api/src/db/schema-worklog-normalization.ts`
- `apps/api/src/db/schema-worklog-attachment.ts`
- `apps/api/src/worklog/records.ts`
- `apps/api/src/worklog/drizzle-records.ts`
- `apps/api/src/worklog/routes.ts`
- `apps/api/src/worklog/drizzle-attachment-ingestion.ts`
- `apps/api/src/worklog/attachment-ingestion.ts`
- `apps/api/src/worklog/gemini-attachment-normalizer.ts`
- `apps/api/src/worklog/attachment-ingestion.test.ts`
- `apps/api/src/worklog/gemini-attachment-normalizer.test.ts`
- `apps/api/src/worklog/drizzle-workspace-management.ts` (deleted)
- `apps/api/src/worklog/drizzle-workspace-management.test.ts` (deleted)
- `apps/web/src/worklog-api.ts`
- `apps/web/src/WorklogRoot.tsx`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Important transitional / blocking state after this run

### 1. Prelaunch migration baseline is still old and therefore deployment is **not ready**

`drizzle/0000_worklog_baseline.sql` still physically creates the old Customer/Project/Transaction/category/normalized-summary Record schema. `drizzle/meta/0000_snapshot.json` is also still based on that old schema, while `_journal.json` has only the `0000_worklog_baseline` entry.

Do **not** run the current migration against a fresh environment and do **not** claim the new schema is deployable yet. The next schema-focused run must regenerate/safely replace the consolidated prelaunch baseline + snapshot/journal from the final TypeScript schema. Because no local repository/toolchain was available in this run, fabricating a large Drizzle snapshot by hand was intentionally avoided.

### 2. Legacy text normalization is now the main runtime mismatch

`drizzle-text-normalization.ts`, `text-normalization.ts` and `gemini-text-normalizer.ts` still implement the old post-persist output:

- summary;
- category;
- customer/project hints;
- writes to `normalized_summary` / `category`;
- legacy charged-user/Owner aggregate quota context.

Those columns no longer exist in the accepted Record schema. This path must be rewritten before runtime validation/deployment. The existing **idempotent provider execution / reservation / durable settlement state machine should be preserved**, but its output must become the bounded AFTERTRACE intent/title/time domain:

- CREATE / EDIT / HISTORY classification where appropriate;
- one title proposal + Source-scoped Entity/Alias resolution;
- durable pending confirmation on ambiguity;
- `occurred_at` resolution;
- deterministic filtered PWA link for HISTORY;
- Reply-targeted Record id for EDIT.

Until that rewrite lands, do not consider LINE AI text creation runtime-complete even though raw TEXT persistence itself uses the new Record row.

### 3. AI accounting is intentionally still aggregate/subscription-based

`worklog_ai_quota_balances`, reservations, `WorklogSubscriptionService`, UI `UserUsage` and Admin allowance views are still the legacy aggregate model. They remain temporarily so the Record/manual batch did not mix a second major accounting rewrite into the same change.

Next AI-accounting batch must replace this with independent FREE/subscription/top-up grants/scopes/caps, output-equivalent points and platform subsidy.

### 4. Legacy Source Owner/bootstrap fields still exist

GROUP manual CRUD is already independent of Owner/billing. However bootstrap/source schema and AI runtime still retain `owner_user_id`, `subscription_owner_user_id`, owner binding and member-recording fields. These are not accepted long-term data-ownership semantics and must be replaced/reframed when the AI 額度負責人/grant flow lands.

## Next implementation batch — highest priority

Continue from this exact checkpoint, in this order:

1. **Finish schema/migration consistency before deployment work.**
   - obtain a usable local/toolchain path to regenerate or safely rebuild `drizzle/0000_worklog_baseline.sql` + `drizzle/meta/0000_snapshot.json` + journal consistently;
   - remove old Customer/Project/Transaction/category/normalized-summary DB artifacts;
   - include Entity/Alias/final Record/Revision/AI-confirmation tables and all current non-Record operational tables;
   - do not handwave migration success without executing it.

2. **Rewrite the old text normalization domain while preserving its idempotent state machine.**
   - remove summary/category/customer/project output types and prompt;
   - make AI-assisted Record creation determine one title and optional `occurred_at` adjustment;
   - Source-scope title/Alias matching;
   - store ambiguity in `worklog_ai_confirmations` rather than guessing;
   - never create RELATED Entities.

3. **Implement bounded LINE intent/navigation/edit contract.**
   - distinguish CREATE / EDIT / HISTORY instead of treating every `@AFTERTRACE ...` as RECORD_TEXT;
   - HISTORY -> deterministic PWA `entityId?/q?/from?/to?` URL;
   - EDIT requires reliable Reply-target Record id and writes revision/version transaction;
   - success replies include scoped PWA deep link.

4. **Then replace aggregate quota with user-owned AI grants / points.**
   - FREE 400,000 once;
   - monthly subscription grants;
   - independent top-ups;
   - per-grant PRIVATE/GROUP scopes/caps;
   - AI 額度負責人 transfer/recovery;
   - positive-start rule;
   - provider actual cost -> output-equivalent AI points;
   - customer balance floors at zero and excess is platform subsidy, never user overdraw.

5. **After code/schema consistency, perform concentrated local/runtime validation** before Workers deployment.

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

1. **COMPLETE in TypeScript/customer runtime; DB baseline pending:** universal Customer/Project/Finance/category/normalized-summary Record core removal.
2. **COMPLETE in customer runtime:** active-member GROUP manual authorization independent from legacy Owner/billing.
3. **COMPLETE in customer API/PWA implementation:** free manual create/edit/title search/move/batch move/soft delete/recycle/restore/revision operations.
4. **BLOCKER:** regenerate/synchronize consolidated prelaunch SQL baseline + Drizzle snapshot/journal and execute migration validation.
5. **BLOCKER:** replace legacy Gemini text summary/category normalization with single-title/time/intent semantics.
6. replace pending-group/legacy data Owner bootstrap with independent GROUP Source + explicit AI 額度負責人 semantics.
7. bounded LINE CREATE/EDIT/HISTORY intent + filtered deep links + Reply edit.
8. user-owned AI grant/scope/cap ledger and AI 額度負責人 transfer/recovery.
9. AI settlement conversion from provider cost to output-equivalent points + platform subsidy rather than customer overdraw.
10. FREE/PRO/TEAM billing types, FREE one-time grant and monthly/top-up independent grants.
11. Admin pricing calculator, utilization/profitability/subsidy analytics.
12. paid export after core validation.
13. provider-native DOCX/XLSX ingestion validation/hardening.
14. payment-provider lifecycle after merchant eligibility/fees are confirmed.
15. Workers deployment/runtime validation.

## Validation status

This run made static code/schema/test/doc edits only. The container did not have a local checkout/toolchain and outbound git clone was unavailable, so **no local build, typecheck, unit test, migration, browser, Worker, LINE or Gemini runtime validation was executed**. Test files were updated where their compile-time fixture shape clearly changed, but they are not claimed passing.

The current branch should therefore be treated as an active refactor checkpoint, **not deployment-ready** until migration consistency and concentrated executable validation are completed.

**GitHub Actions were not run, dispatched, rerun, enabled, modified or otherwise triggered.**

## Planning estimate

Planning-only estimate after this batch:

- static product/domain contract: ~99% defined for core MVP;
- final Record/manual customer behavior: materially implemented in code;
- migration + LINE intent/title rewrite are now the two largest immediate blockers;
- expect roughly 3–4 substantial implementation batches before concentrated validation;
- rough internal coding range before validation: ~9–20 focused hours, payment-provider integration separate;
- reserve additional time for migration/build/browser/runtime fixes once a local executable toolchain is available.
