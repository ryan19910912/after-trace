# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

## Current stable product contract

- Product/domain is general-purpose work recording, not construction/finance-specific.
- Core universal data model is Source + Entity + Alias + Record + RecordEntity + Revision + pending AI confirmation.
- PRIVATE/GROUP Sources are isolated data spaces.
- PWA manual CRUD/search is free baseline; AI compute is what consumes allowance.
- FREE/PRO/TEAM have unlimited group count.
- AI allowance is user-owned through separate FREE/subscription/top-up grants; each grant independently permits PRIVATE/selected GROUP scopes and optional caps.
- Customer-facing role name is **AI 額度負責人**.
- Any AI operation requires positive eligible balance at request start. Balance=0 means no AI call. If >0 at start and actual usage exceeds remaining units, user floors at 0 and platform subsidy is recorded with user/source/group/provider cost.
- AI-assisted Record creation consumes AI allowance normally. Final customer-unit economics must be calibrated from measured real provider cost.
- AI-assisted new Record parsing targets PRIMARY Entity, meaningful RELATED Entities, Entity/Alias matching, Alias confirmation candidates and `occurred_at`.
- PRIMARY/RELATED are per-Record roles. The same Record exists once but can be found through every attached Entity.
- Alias means a genuine alternate name for the same Entity. Ambiguous alias/entity/primary decisions create durable pending confirmation rather than guessing.
- PWA manual create fields are `紀錄標題`, `紀錄內容`, `發生時間` via date/time picker. `紀錄標題` is user-facing PRIMARY Entity/context; selecting existing title reuses Entity, new title creates Entity. Manual create does not infer RELATED Entities because it does not call AI.
- PWA search is bounded to Entity/title, fuzzy Entity/title/content search, and `occurred_at` date range.
- LINE lookup/history requests do not become a broad autonomous AI retrieval agent. If a specific Entity is resolved, return PWA link with Entity id; otherwise return Source PWA history link. PWA performs actual retrieval.
- Broad AI historical analysis/query is not MVP unless separately approved later.
- Persistent per-record AI summaries are not maintained.
- PWA manual edits are free, write immutable revisions, use integer version optimistic concurrency, and do not re-run AI/reassign Entity automatically.
- LINE natural-language edit requires Reply-targeted deterministic Record id plus positive AI allowance; AI may change text and Entity associations when the edit intent requires it.
- Record delete is soft delete with recycle bin/restore. Revision and RecordEntity history remain durable.
- Entity merge is reversible. Undo restores originally moved associations even if Record text changed later.
- Generic RecordRelation is not required for MVP.
- PWA manual record input is text-only; no permanent attachment library. LINE image/audio/file can be converted to durable text then binary discarded.
- GitHub Actions must not be run/triggered unless explicitly requested.

## Durable docs added/updated during product refactor

- `WORKLOG_PRODUCT_SPEC.md`: general-purpose product, grant model, Entity-first Record model, bounded PWA retrieval/navigation.
- `WORKLOG_ENTITY_MODEL.md`: PRIMARY/RELATED, Alias, pending confirmation, PWA manual title semantics, PWA search/navigation.
- `WORKLOG_RECORD_EDIT_POLICY.md`: revisions, soft delete, optimistic version, LINE Reply editing, PWA no-AI edit rule.
- `WORKLOG_DEVELOPMENT_POLICY.md`: authoritative implementation rules aligned with the new model; old personal-only/max-group/Owner-presence assumptions removed.

## Major legacy code/schema debt to remove/refactor

Current implementation still contains substantial assumptions from the older model. Do not patch around them indefinitely.

High-priority cleanup includes:

1. remove `maxGroupCount`, stable group ordinal and `GROUP_LIMIT_REACHED` end-to-end;
2. remove/reframe generic paid `groupCollaboration` gates that block free group/manual use;
3. separate group/source data existence from AI allowance responsible-user binding;
4. split manual PWA authorization from LINE AI allowance entitlement;
5. replace universal Customer/Project/finance-centric core assumptions with Entity/Record foundation;
6. add `worklog_entities`, `worklog_entity_aliases`, `worklog_record_entities`, `worklog_ai_confirmations` and revision/version/delete-state support;
7. implement PWA manual create with title/content/date-time picker and free Entity reuse/create;
8. implement PWA Entity/title + fuzzy content + date range search;
9. implement bounded LINE history-link navigation with optional Entity id instead of arbitrary AI query function calls;
10. implement user-owned grant/allocation/cap ledger and migrate AI reservation/settlement to eligible grants;
11. add billing type + durable FREE/PRO/TEAM period grants + separate one-time top-up purchases;
12. implement AI 額度負責人 transfer/recovery using the new terminology/domain separation;
13. expose current/historical group AI usage plus platform-subsidized usage in Admin/PWA without leaking unrelated private balances;
14. implement LINE success reply/deep link and Reply-based natural-language edit using revision/version safety;
15. implement paid export after core Record/Entity model is stable;
16. verify provider-native DOCX/XLSX ingestion and finish attachment hardening.

## Cost measurement requirement before final pricing/unit packs

Current plan unit counts are launch placeholders until representative cost measurements exist.

Need measurement fixtures for:

- short/long text Entity parsing;
- image/audio/file ingestion;
- LINE natural-language edit;
- Gemini thinking/modality usage;
- provider actual cost vs customer unit charge and platform subsidy.

Do not finalize top-up pack sizes/prices without this evidence.

## Future discussion backlog — do not implement implicitly

- invoice integration;
- automatic reminders/follow-up;
- project/engineering scheduling;
- broad AI historical analysis/reporting beyond bounded PWA navigation;
- final product/brand name and go-to-market positioning.

## Validation status

Recent product/schema changes are documentation/domain decisions. Concentrated executable validation remains pending.

Do not claim build/typecheck/test/schema/browser/Worker/LINE/Gemini/E2E success unless actually executed locally/runtime.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Because the product has shifted from the older Customer/Project/aggregate-quota architecture to a simpler but materially different Entity/Record + grant-allocation model, percentage estimates from earlier checkpoints are no longer very meaningful.

Planning-only estimate from current branch state:

- static product/domain contract: ~95% defined for the core MVP;
- implementation against the latest domain: significant refactor still required;
- expect roughly 5–7 substantial internal implementation batches before concentrated validation;
- rough internal coding range before validation: ~18–32 focused hours, with payment-provider integration still separate;
- after concentrated validation begins, reserve additional time for compile/schema/browser/runtime fixes.

Do not use GitHub Actions as validation.
