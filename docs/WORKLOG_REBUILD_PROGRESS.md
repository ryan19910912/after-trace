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

## Current execution checkpoint — 2026-09-04 03:xx batch

This run continued from the completed single-title Record/manual-PWA foundation and the new title/time Gemini create interpreter. It did **not** redo Customer/Project/Finance removal, Record CRUD, or title/time interpretation. The goals were:

1. prevent obvious LINE HISTORY/EDIT requests from being silently persisted as new Records;
2. carry bounded history filters all the way into the authenticated PWA deep link and correct Source scope;
3. remove the obsolete `PENDING_OWNER` group-data bootstrap so GROUP Source existence/manual history no longer depends on an AI funding user.

### Scanned this run

- all required product/entity/edit/AI-point/development/LINE-content/deployment/progress docs;
- `command.ts` and command tests;
- group/private LINE runtimes and webhook adapters;
- secure bot-entry URL creation in `index.ts` / auth service;
- Web/PWA bootstrap, entry exchange, scope selection and filter handling;
- group bootstrap service/repository and lifecycle-ordering tests;
- obsolete pending-group schema/export;
- related runtime/webhook tests that depended on old QUERY/PENDING_OWNER result shapes.

### Completed this run

1. **Added a conservative pre-persistence LINE intent safety boundary.**
   - Exact `@AFTERTRACE 查詢` remains deterministic unfiltered navigation.
   - Strong history phrases such as `王大明這週做了什麼` and `這個群組今天發生什麼？` are now classified as HISTORY navigation instead of `RECORD_TEXT`.
   - Ordinary facts containing time words, e.g. `王大明今天去晴空案換冷氣`, remain CREATE/Record input and are not mistaken for history merely because they contain `今天`.
   - Obvious edit phrases such as `幫我改成 2800` are separated into `EDIT_REQUEST` before persistence, so they cannot accidentally create a new Record.

2. **Added deterministic history-filter construction without broad AI answering.**
   - New `history-navigation.ts` converts bounded natural-language history phrases into PWA filters only.
   - Supported deterministic Taiwan-time ranges currently include:
     - today / yesterday;
     - this week / last week;
     - this month / last month;
     - recent 7 days.
   - Keyword stripping leaves terms such as `王大明` / `晴空案` as fuzzy `q` when no exact Entity resolution is available at this layer.
   - This layer does **not** query historical Records itself and does not compose an AI answer.

3. **History filters now survive the secure LINE -> PWA entry flow.**
   - Group/private runtime QUERY results now carry `entityId? / query? / from? / to?` filters.
   - Webhook adapters pass those filters to the query-entry callback.
   - Existing short-lived authenticated `t` entry token remains unchanged; deterministic filters are appended as normal URL query parameters.
   - PWA now reads the URL filters on first load and applies them to the existing deterministic Record API.

4. **PWA deep links now open the correct Source rather than a remembered/default scope.**
   - The entry-exchange `entryContext` is now consumed by `WorklogRoot`.
   - A GROUP bot link selects the authorized Source matching its `lineGroupId`.
   - A PRIVATE bot link selects the matching personal Source.
   - Only when there is no valid entry context does PWA fall back to remembered/default scope.
   - This fixes the previous case where a correct filtered LINE link could open the user's last-used unrelated group.

5. **LINE edit commands are now fail-safe instead of destructive while full Reply-AI edit is unfinished.**
   - Obvious edit request without Reply returns `EDIT_TARGET_REQUIRED` and asks for deterministic Reply/PWA editing.
   - Obvious edit request with Reply returns `EDIT_NOT_READY` instead of guessing or persisting a new Record.
   - Actual AI mutation/version/revision application is **not claimed implemented yet**.

6. **GROUP Source existence is now independent from AI funding responsibility in executable bootstrap code.**
   - First known group interaction now creates a durable ACTIVE `worklog_sources` GROUP row immediately, with `owner_user_id = NULL` / no subscription owner.
   - The speaking/observed user is recorded as a Source member immediately.
   - Later members reuse the same Source.
   - Group reactivation works on the Source directly and preserves lifecycle timestamp ordering.
   - `@AFTERTRACE 啟用` can assign the transitional AI responsible user later without changing Source identity.
   - Manual/history access can therefore proceed on an unowned GROUP Source; only AI-backed create/attachment paths continue to hit the transitional funding authorization.

7. **Removed obsolete pending-group runtime/schema debt.**
   - `GroupBootstrapResult` no longer has `PENDING_OWNER`.
   - Runtime no longer rejects all group commands simply because no legacy Owner is bound.
   - Removed `worklog_pending_groups` / `worklog_pending_group_members` TypeScript Drizzle schema file and schema export.
   - Removed pending-group repository/interface usage and migration logic from executable bootstrap repository.
   - Note: the stale consolidated SQL baseline/snapshot still contains old pending-group definitions until migration regeneration; see blocker below.

8. **Kept current legacy AI funding checks intentionally isolated.**
   - `authorizeGroupAccess` remains the free/manual active-member path.
   - `authorizeGroupRecord` is now invoked only for AI-backed create/attachment paths.
   - An unowned Source can browse/history manually but an AI create still receives `OWNER_UNBOUND` from the transitional funding layer until the grant ledger replaces it.
   - This matches the product invariant better than the previous all-or-nothing Owner gate without pretending the grant model is already complete.

9. **Tests were updated/added for the new contracts.**
   - command tests cover strong history detection, ordinary time-bearing CREATE text, and edit guards;
   - new history-navigation tests cover Taipei today/week/month boundaries and keyword extraction;
   - group/private runtime tests now include QUERY filters and edit non-persistence guards;
   - group/private webhook tests carry filter metadata/query targets;
   - bootstrap tests now verify immediate unowned Source creation, stable Source identity, later AI responsibility assignment and lifecycle reactivation;
   - lifecycle-ordering test now uses direct GROUP Sources instead of pending-group state.
   - Tests were authored/updated but **not executed**.

### Files changed this run

- `apps/api/src/worklog/command.ts`
- `apps/api/src/worklog/command.test.ts`
- `apps/api/src/worklog/history-navigation.ts` (new)
- `apps/api/src/worklog/history-navigation.test.ts` (new)
- `apps/api/src/worklog/line-runtime.ts`
- `apps/api/src/worklog/line-runtime.test.ts`
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/worklog/oa-runtime.test.ts`
- `apps/api/src/worklog/group-webhook.ts`
- `apps/api/src/worklog/group-webhook.test.ts`
- `apps/api/src/worklog/oa-webhook.ts`
- `apps/api/src/worklog/oa-webhook.test.ts`
- `apps/api/src/index.ts`
- `apps/web/src/WorklogRoot.tsx`
- `apps/api/src/worklog/bootstrap.ts`
- `apps/api/src/worklog/drizzle-bootstrap.ts`
- `apps/api/src/worklog/bootstrap.test.ts`
- `apps/api/src/worklog/bootstrap-lifecycle-ordering.test.ts`
- `apps/api/src/db/schema-worklog-bootstrap.ts` (deleted)
- `apps/api/src/db/schema-all.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Important transitional / blocking state after this run

### 1. Prelaunch migration baseline/snapshot are still stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql` and `drizzle/meta/0000_snapshot.json` still describe substantial pre-refactor schema, including Customer/Project/Transaction/category/normalized-summary and now-obsolete pending-group structures. `_journal.json` still references only that baseline.

The available execution environment has not provided a reliable checked-out pnpm/project toolchain for regenerating Drizzle metadata and exercising a disposable PostgreSQL migration. Do **not** hand-fabricate a large Drizzle snapshot just to make files appear synchronized. Until consolidated baseline + snapshot/journal are regenerated and actually exercised, this branch is not migration/deployment-ready.

### 2. HISTORY safety routing is implemented, but this is not the final provider-backed intent interpreter

The new history/edit classifier is deliberately conservative and deterministic. It fixes the dangerous current behavior (history/edit silently becoming CREATE) without adding an unaccounted pre-persistence Gemini call.

A provider-backed CREATE/EDIT/HISTORY classifier should only be added once it can obey the frozen AI accounting invariant:

- positive eligible grant before provider start;
- durable/idempotent provider accounting;
- no provider call at zero balance;
- provider cost/customer charge/platform subsidy retained exactly once.

Until the grant ledger exists, do not insert a new Gemini intent call before raw persistence that bypasses these invariants.

### 3. Actual LINE Reply edit mutation is still not implemented

Target safety is now enforced, but the remaining edit work is:

- resolve Reply target to a deterministic AFTERTRACE Record id (not merely arbitrary quoted LINE content);
- authorize Source/member/private access;
- reserve eligible AI points;
- interpret requested mutation;
- apply content/title/time change through integer-version optimistic concurrency;
- write immutable revision;
- handle title ambiguity through existing durable confirmation state;
- settle provider usage exactly once.

Current safe behavior is to refuse mutation and direct the user to PWA rather than risk changing the wrong Record.

### 4. Durable confirmation creation exists, but confirmation resolution does not

The title interpreter already persists ambiguity in `worklog_ai_confirmations`; no deterministic confirm/reject consumer is wired yet. Resolution must apply an existing candidate Entity or create the proposed same-Source title, optionally apply stored occurred time, and never re-call Gemini merely to finish a stored confirmation.

### 5. GROUP data Source is now independent, but AI funding schema still uses legacy Owner columns

The data/bootstrap behavior is corrected, but these transitional fields/logic remain:

- `owner_user_id` / `subscription_owner_user_id` on Source;
- `recording_enabled` legacy member flag;
- owner subscription/capability/presence logic inside AI authorization;
- explicit enable command still calls the legacy binding function internally.

Next grant batch should replace this with explicit **AI 額度負責人** + eligible user-owned grants, then remove legacy Owner/funding columns and recording flag where no longer needed.

### 6. AI accounting is still aggregate/subscription-based

The create interpreter/attachment pipeline still use the old reservation port and transitional aggregate quota. The final grant batch must implement:

- FREE 400,000-point one-time grant;
- monthly subscription grants;
- independent top-ups;
- per-grant PRIVATE/GROUP scope and optional caps;
- output-price-equivalent point conversion from real provider cost;
- customer charge floors at remaining balance;
- excess for an already-started request recorded as platform subsidy, never customer overdraw.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Implement deterministic pending-confirmation resolution.**
   - Fetch current PENDING confirmation for actor/Source/Record.
   - Confirm selected existing candidate or create proposed title in same Source.
   - Apply stored occurred time where allowed by version/state guard.
   - Reject/expire safely.
   - Never issue a second provider call merely to resolve a stored decision.

2. **Begin user-owned grant/AI-point ledger and replace legacy AI funding authorization.**
   - Grant identity/type/status/points.
   - PRIVATE/GROUP scope allocation and optional caps.
   - FREE 400,000-point one-time provisioning.
   - Reservation/funding selection from eligible grants.
   - Provider-cost -> output-price-equivalent points.
   - customer-charged vs platform-subsidized settlement.
   - explicit AI 額度負責人 binding independent from group data Source.

3. **Use the grant/idempotent execution layer to finish provider-backed LINE EDIT and optional richer intent interpretation.**
   - Reply target resolver.
   - edit mutation plan.
   - optimistic Record version/revision transaction.
   - ambiguity routed to durable confirmation.

4. **Remove remaining legacy Owner/recording/quota schema/runtime once grant path owns AI authorization.**

5. **Regenerate consolidated prelaunch migration baseline/snapshot when an executable local project toolchain is available, then run concentrated validation.**

## Stable product contract

- General-purpose work recording; no universal construction/finance/Customer/Project domain.
- Core model: Source + single Entity/title + Alias + Record + Revision + pending AI confirmation.
- PRIVATE/GROUP Sources are isolated data spaces.
- Active GROUP members can manually browse/create/edit/delete/restore/move records without subscription, legacy Owner, or AI points.
- GROUP Source existence is independent from the user funding AI.
- PWA manual CRUD/search is free; only actual AI compute consumes AI points.
- No group-count limit.
- Customer-facing role is **AI 額度負責人**.
- AI allowance is user-owned through independent FREE/subscription/top-up grants with scope allocation/caps.
- FREE launch grant = **400,000 AI points once**, no calendar refresh/expiry.
- `1 AI point = 1 output-price-equivalent token`; real provider cost is separately auditable.
- Zero eligible points before AI start means no provider call. Positive-start overage floors customer balance at zero and records platform subsidy.
- PWA search contract: title + fuzzy title/alias/content + `occurred_at` date range.
- LINE history requests route to deterministic PWA filters; LINE is not a broad historical answering agent.
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
3. **COMPLETE:** GROUP Source bootstrap independent from AI responsible user; pending-group runtime/schema removed from TypeScript.
4. **COMPLETE:** free manual PWA create/edit/title search/move/batch move/soft delete/recycle/restore/revisions.
5. **COMPLETE in current text-create pipeline:** legacy Gemini summary/category/customer/project normalization replaced by single-title/time interpretation with durable ambiguity creation.
6. **COMPLETE as bounded safe navigation:** obvious LINE HISTORY requests no longer create Records; deterministic filters/deep links open the correct Source.
7. **COMPLETE as safety guard only:** obvious LINE EDIT requests do not create Records and require Reply; actual AI edit mutation remains pending.
8. **BLOCKER:** consolidated prelaunch SQL baseline + Drizzle snapshot/journal regeneration and executed migration validation.
9. pending AI confirmation resolution UX/commands.
10. user-owned AI grant/scope/cap ledger and responsible-user transfer/recovery.
11. provider-cost -> output-equivalent points + platform subsidy settlement.
12. removal of legacy Source Owner/subscription-owner/recording aggregate funding fields and paths.
13. FREE/PRO/TEAM billing types, FREE one-time grant and monthly/top-up independent grants.
14. provider-backed Reply edit/idempotent mutation and optional richer intent layer after grant accounting exists.
15. Admin pricing calculator, utilization/profitability/subsidy analytics.
16. paid export after core validation.
17. provider-native DOCX/XLSX ingestion validation/hardening.
18. payment-provider lifecycle after merchant eligibility/fees are confirmed.
19. Workers deployment/runtime validation.

## Validation status

This run made static code/schema/test/doc edits only. No build, typecheck, unit test, migration, browser, Worker, LINE, or Gemini runtime validation was executed in this environment. Tests were updated/added to encode the intended contract, but are **not claimed passing**.

The branch is an active refactor checkpoint, **not deployment-ready** until migration consistency and concentrated executable validation are complete.

**GitHub Actions were not run, dispatched, rerun, enabled, modified, or otherwise triggered.**

## Planning estimate

Planning-only estimate after this batch:

- static product/domain contract: ~99% defined for core MVP;
- Record/manual PWA foundation: materially implemented;
- text CREATE title/time interpretation: materially implemented, pending executable validation;
- bounded HISTORY navigation and Source-correct deep link: materially implemented, pending executable validation;
- GROUP data Source bootstrap no longer depends on funding user;
- remaining largest implementation work: confirmation resolution + grant/AI-point accounting + Reply edit, then migration/runtime validation;
- expect roughly 2–3 substantial implementation batches before concentrated validation;
- rough internal coding range before validation: ~6–14 focused hours, payment-provider integration separate;
- reserve additional time for migration/build/browser/runtime fixes once a local executable project toolchain is available.
