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

## Current execution checkpoint — 2026-09-04 02:xx batch

This run continued from the completed single-title Record/manual-PWA foundation. It did **not** redo Customer/Project/Finance removal or manual GROUP authorization. The main goal was to eliminate the largest executable mismatch left by that schema refactor: the old Gemini text `summary/category/customer/project` normalization pipeline.

### Scanned this run

- all required product/entity/edit/AI-point/development/LINE-content/deployment/progress docs;
- current branch tree and migration metadata;
- `text-normalization.ts`;
- `drizzle-text-normalization.ts`;
- `gemini-text-normalizer.ts`;
- Record-core schema and normalization-state schema;
- group/private LINE runtimes;
- group runtime tests and text-normalization persistence tests;
- `command.ts` and group webhook to identify the next LINE intent/navigation boundary.

### Completed this run

1. **Removed the legacy text AI output domain from executable code.**
   - `WorklogTextNormalizationOutput` no longer contains `summary`, `category`, `customerHint`, or `projectHint`.
   - New bounded output is:
     - one proposed `title`;
     - `titleRequiresConfirmation`;
     - optional resolved `occurredAt`.
   - The durable raw Record text remains the source of truth and is never rewritten/summarized by this pipeline.

2. **Gemini text interpretation now follows the accepted single-title MVP.**
   - Prompt explicitly asks for exactly one filing title, not RELATED Entities.
   - It may return `title=null` when there is insufficient grounded context and mark confirmation required.
   - Relative event time is resolved against the persisted LINE/create timestamp with `Asia/Taipei` as the product reference timezone.
   - If no explicit/relative event time exists, `occurred_at=null` means preserve the original Record time.
   - Structured output schema contains only `title`, `title_requires_confirmation`, and `occurred_at`.
   - Provider response still preserves real input/output/thinking usage for auditable cost accounting.

3. **The existing provider/idempotency state machine was preserved instead of rewritten.**
   - Raw Record is durable before AI.
   - Provider execution is still single-claim.
   - `PROVIDER_SUCCEEDED` / `USAGE_COMMITTED` remain resumable boundaries.
   - Uncertain post-provider persistence does not release quota or automatically issue a second provider call.
   - The accounting port remains explicitly transitional until the grant/AI-point batch.

4. **AI interpretation now applies to the new Record schema.**
   - Removed all runtime reads/writes of deleted `record.workspace_id`, `normalized_summary`, and `category` columns.
   - Context now reads `source.workspace_id`, Record `source_id`, author, raw text, and `occurred_at`.
   - Only ACTIVE, version-1, unresolved (`entity_id IS NULL`) LINE text Records are eligible for initial title/time interpretation.
   - If a user/manual path edits, deletes, or resolves a Record while AI is in flight, stale AI output is not allowed to overwrite that change.

5. **Source-scoped Entity/Alias resolution is now executable.**
   - Exact title matches search active `worklog_entities` inside the same Source.
   - Exact alias matches search active Source-scoped `worklog_entity_aliases`.
   - A single exact match assigns the existing Entity.
   - A confident title with no plausible existing match creates one Source-scoped Entity and assigns it to the Record.
   - No PRIMARY/RELATED many-to-many model is introduced.

6. **Ambiguous title decisions now create durable confirmation state.**
   - Provider-marked uncertainty, no clear title, multiple exact matches, and conservative possible-existing-title matches create `worklog_ai_confirmations` rather than guessing.
   - Pending confirmation payload stores proposed title, resolved occurred time, reason, and candidate Entity ids/names/match method.
   - Existing pending confirmation for the same Record/user is reused on replay.
   - The AI execution state is completed after durable confirmation creation so LINE redelivery does not call Gemini again.
   - **Resolution UX/commands are not implemented yet**; that is part of the next LINE interaction batch.

7. **Text AI tests were migrated to the new contract.**
   - Service tests now cover title/time output, provider usage persistence, quota failure, durable recovery, and pending-confirmation mapping.
   - Persistence-uncertainty tests now use title/time output and preserve the no-double-provider-call invariant.
   - Added `gemini-text-normalizer.test.ts` to verify:
     - prompt/schema have no legacy summary/category/customer/project fields;
     - title/time response parsing;
     - thinking tokens are retained in billed output usage;
     - null-title confirmation response;
     - legacy response shape is rejected.
   - Tests were authored/updated but **not executed**.

8. **Cleaned a stale `GROUP_LIMIT_REACHED` compile/runtime branch left after the earlier unlimited-group decision.**
   - `line-runtime.ts` no longer exposes or handles `GROUP_LIMIT_REACHED`.
   - Group runtime messages now use customer-facing `AI 額度負責人` wording where the transitional legacy owner path is still present.
   - Group runtime tests no longer construct obsolete `groupCollaboration` / `maxGroupCount` manual-access results and now model query access as active-member baseline access.
   - This does **not** mean the legacy Owner/bootstrap/accounting model is finished; it only removes the already-dead group-limit path and keeps current code structurally aligned while the grant batch is pending.

9. **Normalization schema documentation was aligned with executable behavior.**
   - `worklog_record_ai_normalizations` keeps its historical DB name for now, but the schema comment now accurately states that `result_json` is title/time interpretation rather than summary/category normalization.

### Files changed this run

- `apps/api/src/worklog/text-normalization.ts`
- `apps/api/src/worklog/gemini-text-normalizer.ts`
- `apps/api/src/worklog/drizzle-text-normalization.ts`
- `apps/api/src/worklog/text-normalization.test.ts`
- `apps/api/src/worklog/text-normalization-persistence.test.ts`
- `apps/api/src/worklog/gemini-text-normalizer.test.ts` (new)
- `apps/api/src/db/schema-worklog-normalization.ts`
- `apps/api/src/worklog/line-runtime.ts`
- `apps/api/src/worklog/line-runtime.test.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Important transitional / blocking state after this run

### 1. Prelaunch migration baseline/snapshot are still stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql` and `drizzle/meta/0000_snapshot.json` still describe the pre-refactor Customer/Project/Transaction/category/normalized-summary schema. `_journal.json` still references only that baseline.

The current execution container has Node but no installed pnpm/project toolchain; invoking package tooling cannot be relied upon without external package access. A fresh Drizzle snapshot should **not** be fabricated by hand just to make files look synchronized. Until the consolidated baseline + snapshot/journal are regenerated and actually exercised against a disposable database, do not treat this branch as migration- or deployment-ready.

### 2. LINE command intent is still the next major product/runtime mismatch

`command.ts` still deterministically maps almost every `@AFTERTRACE <text>` to `RECORD_TEXT`. Therefore a request such as `@AFTERTRACE 王大明這週做了什麼` can still be misclassified as a new Record.

The next LINE batch must introduce a bounded pre-persistence intent interpreter:

- `CREATE_RECORD`;
- `EDIT_RECORD` only with reliable Reply target;
- `HISTORY_NAVIGATION` -> deterministic PWA filters/link;
- deterministic commands such as explicit enable/confirmation handling remain outside open-ended AI mutation.

Do not turn this into a broad autonomous history-answering agent.

### 3. Durable confirmation creation exists, but confirmation resolution does not

The title interpreter can now persist ambiguity safely, but no LINE/PWA confirmation-resolution path currently consumes `worklog_ai_confirmations`. Next batch must add deterministic confirm/reject handling and safely assign/create the title + optional occurred time without a second provider call.

### 4. GROUP bootstrap/funding still carries legacy Owner semantics

Manual PWA GROUP authorization is already active-member based and independent of billing. LINE/bootstrap and AI funding still retain:

- pending group before legacy Owner bind;
- `owner_user_id` / `subscription_owner_user_id`;
- owner presence/recording flags;
- owner subscription/capability checks.

These must be replaced/reframed as independent GROUP Source existence plus explicit **AI 額度負責人** and eligible user-owned grant selection. Group data/manual access must survive absence of an AI responsible user.

### 5. AI accounting is still aggregate/subscription-based

The text interpretation pipeline still uses the old reservation port and transitional `actualUnits = inputTokens + outputTokens`. This is intentionally not presented as the final AI-point implementation.

The grant batch must implement:

- FREE 400,000-point one-time grant;
- monthly subscription grants;
- independent top-ups;
- per-grant PRIVATE/GROUP scope and optional caps;
- output-price-equivalent point conversion from real provider cost;
- customer charge floors at remaining balance;
- excess for an already-started request recorded as platform subsidy, never customer overdraw.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Bounded LINE intent/navigation/edit layer.**
   - Add a pre-persistence intent interpreter for CREATE / EDIT / HISTORY.
   - HISTORY produces deterministic filters (`entityId?`, `q?`, `from?`, `to?`) and a scoped PWA link.
   - EDIT requires a deterministic Reply target and uses Record version/revision transaction.
   - CREATE continues into the now-completed single-title/time interpretation path.

2. **Confirmation resolution.**
   - Add deterministic confirm/reject commands/UI for pending title decisions.
   - Confirmation applies the selected existing Entity or creates the proposed title within the same Source.
   - Never re-call provider merely to finish a stored confirmation.

3. **Remove legacy GROUP data-owner bootstrap semantics.**
   - GROUP Source exists independently of AI funding.
   - Replace legacy Owner role with AI 額度負責人 semantics and grant eligibility.

4. **Replace aggregate quota with user-owned AI grants/points.**
   - Implement the accepted 400,000 FREE launch grant and point/subsidy accounting.

5. **Regenerate consolidated prelaunch migration baseline/snapshot when an executable local project toolchain is available, then run concentrated validation.**

## Stable product contract

- General-purpose work recording; no universal construction/finance/Customer/Project domain.
- Core model: Source + single Entity/title + Alias + Record + Revision + pending AI confirmation.
- PRIVATE/GROUP Sources are isolated data spaces.
- Active GROUP members can manually browse/create/edit/delete/restore/move records without subscription, legacy Owner, or AI points.
- PWA manual CRUD/search is free; only actual AI compute consumes AI points.
- No group-count limit.
- Customer-facing role is **AI 額度負責人**.
- AI allowance is user-owned through independent FREE/subscription/top-up grants with scope allocation/caps.
- FREE launch grant = **400,000 AI points once**, no calendar refresh/expiry.
- `1 AI point = 1 output-price-equivalent token`; real provider cost is separately auditable.
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

1. **COMPLETE in TypeScript/customer runtime; DB baseline pending:** Customer/Project/Finance/category/normalized-summary core removal.
2. **COMPLETE:** active-member GROUP manual authorization independent from billing.
3. **COMPLETE:** free manual PWA create/edit/title search/move/batch move/soft delete/recycle/restore/revisions.
4. **COMPLETE in current text-create pipeline:** legacy Gemini summary/category/customer/project normalization replaced by single-title/time interpretation with durable ambiguity creation.
5. **BLOCKER:** consolidated prelaunch SQL baseline + Drizzle snapshot/journal regeneration and executed migration validation.
6. bounded LINE CREATE/EDIT/HISTORY intent + filtered deep links + Reply edit.
7. pending AI confirmation resolution UX/commands.
8. independent GROUP Source bootstrap + AI 額度負責人 semantics.
9. user-owned AI grant/scope/cap ledger and transfer/recovery.
10. provider-cost -> output-equivalent points + platform subsidy settlement.
11. FREE/PRO/TEAM billing types, FREE one-time grant and monthly/top-up independent grants.
12. Admin pricing calculator, utilization/profitability/subsidy analytics.
13. paid export after core validation.
14. provider-native DOCX/XLSX ingestion validation/hardening.
15. payment-provider lifecycle after merchant eligibility/fees are confirmed.
16. Workers deployment/runtime validation.

## Validation status

This run made static code/schema/test/doc edits only. No build, typecheck, unit test, migration, browser, Worker, LINE, or Gemini runtime validation was executed in this environment. Tests were updated/added to encode the intended contract, but are **not claimed passing**.

The branch is an active refactor checkpoint, **not deployment-ready** until migration consistency and concentrated executable validation are complete.

**GitHub Actions were not run, dispatched, rerun, enabled, modified, or otherwise triggered.**

## Planning estimate

Planning-only estimate after this batch:

- static product/domain contract: ~99% defined for core MVP;
- Record/manual PWA foundation: materially implemented;
- text CREATE title/time interpretation: materially implemented, pending executable validation;
- remaining largest implementation work: LINE intent/edit/history + confirmation resolution, then grant/accounting/bootstrap replacement;
- expect roughly 2–4 substantial implementation batches before concentrated validation;
- rough internal coding range before validation: ~7–16 focused hours, payment-provider integration separate;
- reserve additional time for migration/build/browser/runtime fixes once a local executable project toolchain is available.
