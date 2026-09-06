# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every substantive development run, in this exact order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

Latest docs are the only product/development specification. Never use GitHub Actions unless explicitly requested. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-06 PWA-first product pivot + unified 小跡 LINE command language locally green

Cloudflare deployment remains manual:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: corresponding `*-prod` Workers
- workers.dev subdomain: `a0955625660`

Do not reintroduce Pages or automatic Git deployment.

## Stable Dev foundation before this pivot

Already user/runtime verified:

- commercial-plan forward migration on existing Dev DB — PASS
- semantic `search_terms` canonical baseline/guard — PASS
- original journal timestamp `1788528481453` preserved — PASS
- existing Dev forward migration for `search_terms` — PASS
- `worklog_records.search_terms jsonb NOT NULL DEFAULT []` — PASS
- Dev DB had 0 Records before first LINE E2E attempt
- AI runtime preserved `GOOGLE / gemini-3.5-flash-lite` — PASS
- FREE plan preserved `FREE / grant_points=400000 / enabled=true` — PASS
- normalization tests — PASS, 3 files / 13 tests
- prior command/history/LINE runtime tests — PASS, 6 files / 57 tests
- history-query tests — PASS, 1 file / 4 tests
- Admin Users/Groups/Plans smoke — PASS
- Dev Web shell/routes — PASS
- LINE Login callback/redirect stage — PASS

The stale Dashboard `* * * * *` Cron Trigger remains unrelated to logging. Remove it separately; do not add an empty `scheduled()` handler.

## Deterministic history / semantic retrieval — retained

- history = **Query -> Retrieve -> Answer -> Deep Link**
- no AI historical summary in MVP
- same-Source Entity/Alias resolution
- title/alias/raw/search_terms lookup
- newest up to 5 matching stored facts returned in LINE
- total count when available
- secure filtered PWA link
- never invent payment/progress/business conclusions

`search_terms` may be produced during the same AI-assisted Record interpretation call; manual PWA CRUD/search never silently calls AI.

## Event-date / Reply source time — retained hard rule

- day-precision Asia/Taipei business semantics
- direct LINE input reference = original command message timestamp
- GROUP Reply-to-TEXT reference = cached quoted timestamp
- later Reply command time never substitutes quoted content time
- Worker current time never silently substitutes missing source time
- if source timestamp cannot be recovered, fail/request resend

Regression:

- 9/3 original `晴空案今天收3000清潔費`
- 9/5 Reply `小跡 記`
- event date remains 9/3

Delayed attachment Reply original-timestamp recovery remains open debt and must not be claimed fully compliant.

## NEW accepted product direction — PWA-first, LINE-integrated

PWA/Web is now the primary product surface.

Primary MVP customer flow:

1. open installed PWA Quick Capture;
2. selected Source defaults to last still-authorized choice;
3. Source is visibly identified as PRIVATE or a LINE GROUP;
4. voice or text capture;
5. shared AI interpretation;
6. durable Preview/Draft;
7. user may edit;
8. explicit confirm creates Record;
9. unfinished Draft remains until confirmed or explicitly deleted.

Normal browser/Web entry may emphasize timeline/records while installed PWA icon may land on Quick Capture. Both share one PWA/account/API/data model.

### Quick Capture rules accepted, implementation pending

- Voice + Text
- explicit microphone tap; never auto-record on open
- PRIVATE or currently authorized GROUP Source
- last selected valid Source default, otherwise PRIVATE
- strong destination warning before capture and on Preview
- no persistent offline audio storage requirement
- upload failure -> retry/re-record UI
- AI-point remaining indicator near capture UX
- Preview shows Source/title/content/event date and supports manual corrections
- provider usage incurred for preview is chargeable even if user does not commit
- unchanged/manually corrected Draft commit does not call provider again merely to persist

### Draft rules accepted, implementation pending

- durable
- does **not** auto-expire
- remains until confirmed or explicitly deleted
- not included in normal Record history until committed
- GROUP Draft re-authorized on every read/edit/commit
- losing GROUP membership immediately removes Draft access

### PWA timeline/search direction accepted

- Timeline: 今天 / 最近 7 天 / 全部
- Search: Source + title + date + keyword/semantic
- deterministic title/Alias/raw/search_terms matching
- full free manual CRUD/revision remains available

## GROUP access hard rule

When a user leaves/is removed from LINE GROUP, immediately revoke **all** GROUP Source rights:

- read/search
- Quick Capture selection
- create/edit/delete/restore/title move
- Draft read/edit/commit
- deep-link access

Data remains with GROUP Source.

Authorization must be server-side on every operation.

## LINE group name / picture decision

PWA uses the original current LINE group name/picture. No separate AFTERTRACE custom group display name.

Accepted refresh policy, implementation pending:

- cache group name/picture + sync timestamp
- if older than 24h, refresh only when group is actually used
- use includes LINE 小跡 group command, PWA Source-list access, opening group surface
- no scheduled/cron profile refresh
- within 24h use cached metadata
- LINE lifecycle/member state remains primary authorization evidence

## NEW unified LINE command language — 小跡

OA and GROUP now share one Chinese command prefix: `小跡`.

Accepted customer syntax:

- `小跡 晴空案今天收了三千` -> Record
- `小跡 記錄 晴空案今天收了三千` -> Record
- `小跡 查 晴空案收款` / `小跡 查詢 ...` -> deterministic Query
- `小跡 今天` -> today query
- `小跡 最近` -> newest query
- `小跡 幫助` -> help
- Reply -> `小跡 記` -> quoted Record when recoverable
- Reply -> `小跡 幫我改成 ...` -> deterministic target edit
- GROUP `小跡 啟用` may remain AI 額度負責人 claim

Prefix must be sentence-start and may be followed by whitespace / Chinese comma / colon.

No `@` is required, avoiding LINE mention UI conflicts.

Query intent is explicit. `小跡 <內容>` defaults to Record; a question is not silently changed to Query without `查/查詢` or fixed query shortcuts.

Retired before launch:

- `@AFTERTRACE`
- `@紀錄` / `@查詢`
- `/紀錄` slash-command design
- OA Rich Menu Postback record/query pending mode
- `worklog_private_pending_actions`

## OA Rich Menu pending-mode experiment — fully retired before DB migration

The short-lived Postback/pending-action implementation was prototyped and locally green (42 targeted tests) but was rejected by subsequent product decision **before baseline regeneration or Dev migration**.

It has now been removed from the branch:

- no pending-action schema export
- no forward migration for the table
- no repository/service/runtime wiring
- no OA Postback product route
- no readiness dependency
- obsolete tests removed

Because the table was never migrated into Dev and never included in a regenerated canonical baseline, **no DB rollback is required**.

The previous 42-test green result applies only to the retired prototype.

## Current branch work in this pivot

Implemented in code/docs and locally validated:

- shared `小跡` parser for OA/GROUP
- explicit query commands + Record-first default
- HELP command
- Reply `小跡 記`
- OA runtime simplified back to stateless command handling
- GROUP runtime aligned to 小跡
- OA Postback/pending schema/runtime removed
- readiness/index/forward-compat cleanup
- PRODUCT_SPEC rewritten PWA-first
- ENTITY_MODEL / RECORD_EDIT_POLICY / LINE_CONTENT_POLICY / DEVELOPMENT_POLICY aligned
- command/OA runtime/OA webhook/event/GROUP runtime/GROUP webhook tests updated for new syntax

Not yet implemented:

- PWA Quick Capture UI/API
- durable non-expiring AI Draft schema/API/UI
- last-used capture Source preference
- PWA Source picker with strict GROUP authorization
- LINE group name/picture persistence + lazy 24h refresh
- PWA Voice capture/provider integration

These are accepted next development work, not claimed shipped.

## Current validation status — PASS

Latest user-executed local validation on Windows after the small test-fixture fixes:

- `pnpm --filter @aftertrace/api typecheck` — **PASS**
- targeted current LINE/PWA-first command batch — **PASS, 6 files / 55 tests**
  - `src/line/events.test.ts` — 7 tests
  - `src/worklog/command.test.ts` — 8 tests
  - `src/worklog/oa-runtime.test.ts` — 10 tests
  - `src/worklog/oa-webhook.test.ts` — 8 tests
  - `src/worklog/line-runtime.test.ts` — 14 tests
  - `src/worklog/group-webhook.test.ts` — 8 tests
- expected stderr logs came from deliberate simulated failure/anomaly tests (`reply unavailable`, `boom`) and were not test failures.

The prior stale-fixture issues were test-only:

- OA/GROUP webhook mock `WorklogHistoryQueryResult` still used obsolete `totalCount` shape; fixed to current `total/title/query/records/filters` shape.
- GROUP `MEMBER_LEFT` lifecycle expectation omitted the propagated source timestamp; fixed to expect the correct `at` field rather than changing runtime behavior.

No new schema is currently required solely from the retired pending-mode work, so do not regenerate baseline for `worklog_private_pending_actions`.

## Immediate next order

1. implement LINE GROUP profile metadata persistence + 24h lazy refresh as the next bounded schema/runtime batch;
2. refresh only on actual use, never on cron; preserve original LINE group name/picture;
3. enforce current active membership on all GROUP reads/actions and use member-left evidence for immediate revocation;
4. locally typecheck/test that bounded batch;
5. apply reviewed Dev forward migration without rebuilding the existing Dev DB if a new profile schema column/table is required;
6. then implement durable non-expiring PWA AI Draft + last-used Source preference + Quick Capture shared pipeline incrementally;
7. add Voice as another input modality on top of the same preview/commit core;
8. deploy Dev only after each selected batch is locally green and any required migration has been verified.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **PREVIOUS DEV SEARCH/DB FOUNDATION GREEN; PWA-FIRST/小跡 PRODUCT + LINE CODE REFACTOR LOCALLY GREEN (TYPECHECK + 55/55 TARGETED TESTS); QUICK CAPTURE/DRAFT/GROUP PROFILE IMPLEMENTATION PENDING.**
