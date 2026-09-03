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

## Current execution checkpoint — 2026-09-03

Latest interactive batch started the implementation refactor rather than only documenting it.

Completed in this batch:

- removed Admin plan capability definitions for obsolete `groupCollaboration` and `maxGroupCount`;
- removed `maxGroupCount` from typed plan capabilities;
- made the temporary legacy `canUseGroupCollaboration()` compatibility helper non-blocking so plan capabilities cannot disable baseline group/manual collaboration;
- removed `GROUP_LIMIT_REACHED`, `maxGroupCount`, `ownerGroupPosition` and configured group-limit checks from `WorklogCollaborationService`;
- preserved the remaining legacy Owner/subscription checks for AI paths temporarily; these still need separation from manual PWA access in the next batch;
- no GitHub Actions were run or triggered.

Files changed in this batch:

- `apps/api/src/admin/capabilities.ts`
- `apps/api/src/worklog/entitlements.ts`
- `apps/api/src/worklog/collaboration.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

Next batch starts from **manual group authorization separation**:

1. make GROUP Source existence/member access independent from Owner/subscription;
2. remove/rework PWA `OWNER_UNBOUND`, `OWNER_ABSENT`, plan-entitlement access blockers;
3. keep AI authorization separate until the new AI allowance responsible-user/grant ledger replaces legacy Owner quota;
4. then begin schema replacement for Customer/Project/Finance -> single Entity/title + Record.

Validation: static code/doc edits only so far; no local build/typecheck/test/runtime validation has been executed yet.

## Current stable product contract

- Product/domain is general-purpose work recording, not construction/finance-specific.
- Core universal data model is Source + single Entity/title + Alias + Record + Revision + pending AI confirmation.
- Each Record belongs to exactly one user-facing `紀錄標題` / internal Entity. Do not create automatic RELATED Entities for every person/object mentioned in Record content.
- PRIVATE/GROUP Sources are isolated data spaces.
- PWA manual CRUD/search is free baseline; AI compute is what consumes allowance.
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
- GitHub Actions must not be run/triggered unless explicitly requested.

## Durable docs added/updated during product refactor

- `WORKLOG_PRODUCT_SPEC.md`: general-purpose single-title Record model, PWA transfer/search, bounded LINE navigation, payment and brand direction.
- `WORKLOG_ENTITY_MODEL.md`: one-Record/one-title semantics, Alias, pending confirmation, manual title semantics and fuzzy search.
- `WORKLOG_RECORD_EDIT_POLICY.md`: revisions, soft delete, optimistic version, LINE Reply editing, PWA no-AI edit rule.
- `WORKLOG_AI_POINT_POLICY.md`: 1:1 output-price-equivalent point unit, 40%/50% commercial targets, FREE launch subsidy direction and Admin profitability analytics.
- `WORKLOG_DEVELOPMENT_POLICY.md`: authoritative implementation rules aligned with the latest model; old personal-only/max-group/Owner-presence assumptions removed.

## Major legacy code/schema debt to remove/refactor

Current implementation still contains substantial assumptions from the older model. Do not patch around them indefinitely.

High-priority cleanup includes:

1. **IN PROGRESS:** remove `maxGroupCount`, stable group ordinal and `GROUP_LIMIT_REACHED` end-to-end. Runtime service/Admin capability definitions are cleaned; repository/query/tests/UI references still require audit/removal.
2. **IN PROGRESS:** remove/reframe generic paid `groupCollaboration` gates that block free group/manual use. Admin definition is removed and compatibility helper no longer blocks, but manual PWA access still depends on legacy Owner/subscription authorization and must be separated next.
3. separate group/source data existence from AI allowance responsible-user binding;
4. split manual PWA authorization from LINE AI allowance entitlement;
5. replace universal Customer/Project/finance-centric core assumptions with Source + Entity/title + Record foundation;
6. add/rework `worklog_entities`, `worklog_entity_aliases`, `worklog_ai_confirmations`, revision/version/delete-state support; do not add a generic multi-Entity Record relation table for MVP;
7. implement PWA manual create with title/content/date-time picker and free title reuse/create;
8. implement PWA title + fuzzy content + date range search;
9. implement direct Record title move plus batch title transfer; no Merge/Undo subsystem;
10. implement bounded LINE history-link navigation using deterministic PWA filters instead of arbitrary AI query function calls;
11. implement user-owned grant/allocation/cap ledger and migrate AI reservation/settlement to eligible grants;
12. replace legacy 500/500/2500 allowance values with explicit AI-point values under the frozen point unit; configure FREE as 400,000 points;
13. add billing type + durable FREE/PRO/TEAM period grants + separate one-time top-up purchases;
14. implement AI 額度負責人 transfer/recovery using the new terminology/domain separation;
15. expose current/historical group AI usage plus platform-subsidized usage in Admin/PWA without leaking unrelated private balances;
16. implement Admin pricing calculator and profitability/usage analytics required by `WORKLOG_AI_POINT_POLICY.md`;
17. implement LINE success reply/deep link and Reply-based natural-language edit using revision/version safety;
18. implement paid export after core Record/title model is stable;
19. verify provider-native DOCX/XLSX ingestion and finish attachment hardening;
20. select and integrate payment provider after recurring-payment eligibility/fees are confirmed;
21. remove old PWA Customer/Project/Finance tabs, filters and APIs after the new title/Record manual surface is in place;
22. replace Gemini text-normalization output (`summary/category/customer_hint/project_hint`) with bounded intent/title/occurred-at/history-filter output while preserving the existing provider-call/idempotent settlement infrastructure;
23. change AI point settlement from `inputTokens + outputTokens` to full provider-cost / output-reference-price conversion and record platform-subsidized overage instead of allowing customer usage to exceed allowance.

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

## Validation status

Current implementation refactor has started. This checkpoint includes static code/doc edits only.

Do not claim build/typecheck/test/schema/browser/Worker/LINE/Gemini/E2E success unless actually executed locally/runtime.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Because the product has shifted from the older Customer/Project/aggregate-quota architecture to a simpler but materially different single-title Record + grant-allocation model, percentage estimates from earlier checkpoints are no longer very meaningful.

Planning-only estimate from current branch state:

- static product/domain contract: ~98% defined for the core MVP;
- implementation against latest domain: first entitlement cleanup batch started; significant refactor remains;
- expect roughly 5–7 substantial internal implementation batches before concentrated validation;
- rough internal coding range before validation: ~17–30 focused hours, payment-provider integration still separate;
- after concentrated validation begins, reserve additional time for compile/schema/browser/runtime fixes.

Do not use GitHub Actions as validation.
