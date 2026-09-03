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

## Current execution checkpoint — 2026-09-03 late batch

This run continued directly from the entitlement cleanup checkpoint and completed the **backend manual GROUP access separation** rather than redoing the previous work.

### Scanned this run

- all required product/development/AI-point/LINE-content/deployment/progress documents;
- `apps/api/src/worklog/collaboration.ts`;
- `apps/api/src/worklog/drizzle-collaboration.ts`;
- `apps/api/src/worklog/drizzle-records.ts`;
- `apps/api/src/worklog/collaboration.test.ts`;
- relevant `apps/api/src/worklog/routes.ts` group/surface/filter helpers;
- current `apps/api/src/db/schema-worklog.ts` and bootstrap schema to plan the next destructive domain batch;
- customer Web flow enough to identify the remaining group Owner-panel blocker.

### Completed this run

1. **Manual GROUP access is no longer Owner/subscription/plan gated in the collaboration service.**
   - Added a dedicated lightweight `GroupManualAccessContext`.
   - `authorizeGroupAccess()` now checks only GROUP Source existence/status plus active membership.
   - It no longer checks Owner binding, Owner presence, subscription period, plan enabled state or AI allowance.
   - Legacy Owner/subscription data stays isolated inside `authorizeGroupRecord()` only as a temporary AI path pending the grant refactor.

2. **Manual GROUP surface discovery/read membership no longer joins subscriptions/plans.**
   - `DrizzleWorklogRecordReadRepository.listActiveGroupSurfaces()` now returns every active GROUP Source where the user is an active member.
   - `isActiveGroupMember()` now checks only membership + active GROUP Source state.
   - FREE/manual group visibility therefore no longer depends on paid plan capability JSON.

3. **Legacy stable group ordinal query was physically removed from collaboration repository.**
   - `owner_group_position` calculation is gone.
   - This finishes the repository-side removal of the old `maxGroupCount` ordinal mechanism.

4. **Collaboration tests were rewritten to match the new boundary.**
   - Manual access tests now assert that Owner absence and invalid legacy billing state do not block an active member.
   - Legacy AI-path tests remain explicitly labeled temporary until the grant + AI 額度負責人 model replaces them.
   - Tests were edited only; they were **not executed** in this run.

5. **Durable docs were corrected where older wording still contradicted the accepted product.**
   - `WORKLOG_RECORD_EDIT_POLICY.md`: removed PRIMARY/RELATED assumptions, made single-title edit/move semantics authoritative, added explicit manual GROUP authorization boundary.
   - `WORKLOG_LINE_CONTENT_POLICY.md`: removed persistent normalized-summary assumptions; attachment outputs now persist durable textual Record content + normal title/time interpretation only.
   - `WORKLOG_DEPLOYMENT.md`: removed Customer/Project/Finance and max-group validation assumptions; documented workers.dev launch direction, FREE 400,000 points, manual GROUP vs AI-funding separation and new validation targets.

### Files changed this run

- `apps/api/src/worklog/collaboration.ts`
- `apps/api/src/worklog/drizzle-collaboration.ts`
- `apps/api/src/worklog/drizzle-records.ts`
- `apps/api/src/worklog/collaboration.test.ts`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

### Remaining blocker before manual GROUP PWA is fully usable

Backend surface/read authorization is now decoupled, but the current customer Web implementation still carries an old Owner-centric UI dependency:

- `WorklogRoot.loadScope()` fetches `/groups/:sourceId/owner-view` whenever a GROUP scope loads;
- non-owner active members can therefore still hit an Owner-only response in the Web flow even though the records API is now correctly authorized;
- `canEditCurrentRecords` also still derives GROUP editability from the existence of `ownerView`;
- the Owner usage/member recording panel and per-member `recordingEnabled` controls are legacy UI under the latest product contract.

**Next run must remove that Web dependency before claiming free manual GROUP PWA access is complete.**

### Next implementation batch

Continue in this order:

1. remove customer Web GROUP `ownerView` as an access/edit prerequisite and remove obsolete Owner/member-recording controls from the normal PWA flow;
2. clean dead Owner-specific manual-access branches in `worklog/routes.ts` once Web no longer depends on them;
3. then perform the core schema/domain replacement:
   - remove universal Customer/Project/Transaction/category/normalized-summary assumptions;
   - add Source-scoped `worklog_entities` and `worklog_entity_aliases`;
   - change Record to one `entity_id`, `occurred_at`, `status`, integer `version`, delete metadata;
   - add immutable `worklog_record_revisions`;
   - add durable `worklog_ai_confirmations`;
   - do not add a generic `worklog_record_entities` many-to-many table;
4. rewire API/PWA manual CRUD/search/title move/batch move/recycle bin to the new schema;
5. only after manual core stabilizes, replace legacy Owner/subscription AI authorization with user-owned grants + AI 額度負責人.

### Validation status

Static code/doc changes only in this run. No local build, typecheck, unit test, migration, browser, Worker, LINE or Gemini runtime validation was executed, so none is claimed successful.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Current stable product contract

- Product/domain is general-purpose work recording, not construction/finance-specific.
- Core universal data model is Source + single Entity/title + Alias + Record + Revision + pending AI confirmation.
- Each Record belongs to exactly one user-facing `紀錄標題` / internal Entity. Do not create automatic RELATED Entities for every person/object mentioned in Record content.
- PRIVATE/GROUP Sources are isolated data spaces.
- PWA manual CRUD/search is free baseline; AI compute is what consumes allowance.
- Active GROUP members may manually collaborate without subscription, legacy Owner or positive AI allowance.
- FREE/PRO/TEAM have unlimited group count.
- AI allowance is user-owned through separate FREE/subscription/top-up grants; each grant independently permits PRIVATE/selected GROUP scopes and optional caps.
- Customer-facing role name is **AI 額度負責人**.
- Any AI operation requires positive eligible balance at request start. Balance=0 means no AI call. If >0 at start and actual usage exceeds remaining points, user floors at 0 and platform subsidy is recorded with user/source/group/provider cost.
- Customer-facing allowance is **AI 點數** with frozen unit: `1 AI point = 1 output-price-equivalent token`. Real provider input/output/thinking/modality cost is converted into this point basis; provider cost remains separately auditable.
- Subscription included allowance currently targets about 40% gross margin; one-time top-up products target about 50% gross margin. Admin calculates a recommendation but final included points are manually confirmed/persisted.
- FREE launch allowance is **400,000 AI points once**, no calendar refresh and no calendar expiry.
- Admin must expose average AI usage, average provider cost, utilization/exhaustion, FREE subsidy/conversion, platform subsidy and realized gross margin for pricing tuning.
- AI-assisted new Record parsing stays narrow: classify create/edit/history navigation, determine one title, resolve title/Alias, create pending confirmation for ambiguity, resolve `occurred_at`, preserve durable content.
- PWA manual create fields are `紀錄標題`, `紀錄內容`, `發生時間` via date/time picker. Selecting existing title reuses Entity; new title creates Entity. No AI relationship inference.
- PWA search is bounded to title, fuzzy title/alias/content search, and `occurred_at` date range.
- LINE lookup/history requests convert natural language into deterministic PWA filters (`entity_id?`, `keyword?`, `from?`, `to?`) and return a PWA link. LINE AI does not become a broad historical retrieval/answering agent.
- Persistent per-record AI summaries are not maintained.
- PWA manual edits are free, write immutable revisions, use integer-version optimistic concurrency, and do not re-run AI/reassign title automatically.
- LINE natural-language edit requires Reply-targeted deterministic Record id plus positive AI allowance; AI may change content/title when the edit intent requires it.
- Record delete is soft delete with recycle bin/restore.
- Record may be moved to another title manually; PWA supports single-record and batch title transfer. Title transfer preserves Record content/time and does not require previous-title history.
- Duplicate-title Merge/Undo is not MVP. Use manual/batch title transfer; reconsider Merge only if real users request it.
- Generic RecordRelation is not required for MVP.
- PWA manual record input is text-only; no permanent attachment library. LINE image/audio/file can be converted to durable text then binary discarded.
- Payment provider is not yet frozen. NewebPay is the current early-MVP preferred candidate for a low-fixed-cost individual-studio SaaS; ECPay remains a mature fallback. Oen is not currently preferred under the publicly shown high monthly/platform fee structure unless a materially better negotiated quote is available.
- Brand/product/LINE OA name is frozen for MVP as **AFTERTRACE**. Current slogan direction: **隨筆落墨，AI 循跡。**
- First deployment may use Cloudflare-provided `workers.dev` hosts; no purchased domain is required.
- GitHub Actions must not be run/triggered unless explicitly requested.

## Major legacy code/schema debt to remove/refactor

1. **MOSTLY COMPLETE:** remove `maxGroupCount`, stable group ordinal and `GROUP_LIMIT_REACHED` end-to-end. Admin/service/repository ordinal logic is removed; continue auditing old UI/docs/fixtures as touched.
2. **BACKEND COMPLETE / WEB PENDING:** remove paid `groupCollaboration` gates from manual GROUP access. Backend surface/read authorization is separated; Web still loads Owner-only panel and must be cleaned next.
3. **IN PROGRESS:** separate group/source data existence from AI allowance responsible-user binding. Manual backend access is separated; schema/bootstrap and AI path still carry legacy owner fields.
4. **IN PROGRESS:** split manual PWA authorization from LINE AI allowance entitlement. Backend group read is split; edit/create and Web UI still need migration.
5. replace universal Customer/Project/finance-centric core assumptions with Source + Entity/title + Record foundation;
6. add/rework `worklog_entities`, `worklog_entity_aliases`, `worklog_ai_confirmations`, revision/version/delete-state support; do not add a generic multi-Entity Record relation table for MVP;
7. implement PWA manual create with title/content/date-time picker and free title reuse/create;
8. implement PWA title + fuzzy content + date range search;
9. implement direct Record title move plus batch title transfer; no Merge/Undo subsystem;
10. implement bounded LINE history-link navigation using deterministic PWA filters instead of arbitrary AI query function calls;
11. implement user-owned grant/allocation/cap ledger and migrate AI reservation/settlement to eligible grants;
12. replace legacy allowance values with explicit AI-point values under the frozen point unit; FREE is fixed at 400,000 launch points;
13. add billing type + durable FREE/PRO/TEAM period grants + separate one-time top-up purchases;
14. implement AI 額度負責人 transfer/recovery using the new terminology/domain separation;
15. expose current/historical group AI usage plus platform-subsidized usage in Admin/PWA without leaking unrelated private balances;
16. implement Admin pricing calculator and profitability/usage analytics required by `WORKLOG_AI_POINT_POLICY.md`;
17. implement LINE success reply/deep link and Reply-based natural-language edit using revision/version safety;
18. implement paid export after core Record/title model is stable;
19. verify provider-native DOCX/XLSX ingestion and finish attachment hardening;
20. select and integrate payment provider after recurring-payment eligibility/fees are confirmed;
21. remove old PWA Customer/Project/Finance tabs, filters and APIs after the new title/Record manual surface is in place;
22. replace Gemini text-normalization output (`summary/category/customer_hint/project_hint`) with bounded intent/title/occurred-at/history-filter output while preserving provider-call/idempotent settlement infrastructure;
23. change AI point settlement from `inputTokens + outputTokens` to full provider-cost / output-reference-price conversion and record platform-subsidized overage instead of allowing customer usage to exceed allowance;
24. replace pending-group/legacy data Owner bootstrap semantics so GROUP Source creation does not wait for an Owner/workspace claim.

## Cost measurement requirement before final paid plan/top-up point packs

Need representative measurement fixtures for:

- short/long text title parsing;
- image/audio/file ingestion;
- LINE natural-language edit;
- Gemini thinking/modality usage;
- provider actual cost vs customer point charge and platform subsidy.

FREE is fixed at 400,000 launch points. PRO/TEAM/top-up point amounts should still be checked against representative usage and Admin pricing assumptions before launch.

## Future discussion backlog — do not implement implicitly

- invoice integration;
- automatic reminders/follow-up;
- project/engineering scheduling;
- broad AI historical analysis/reporting beyond bounded PWA navigation;
- duplicate-title Merge/Undo unless requested by users;
- future rebrand only if explicitly approved.

## Planning estimate

Planning-only estimate from current branch state:

- static product/domain contract: ~99% defined for the core MVP;
- manual GROUP backend entitlement separation: largely complete;
- core schema/API/PWA domain replacement: still the largest remaining batch;
- expect roughly 4–6 substantial implementation batches before concentrated validation;
- rough internal coding range before validation: ~15–27 focused hours, payment-provider integration still separate;
- reserve additional time after concentrated validation begins for compile/schema/browser/runtime fixes.

Do not use GitHub Actions as validation.
