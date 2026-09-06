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

## Current checkpoint — 2026-09-06 LINE group profile 24h lazy-refresh batch committed, local validation pending

Cloudflare deployment remains manual:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: corresponding `*-prod` Workers
- workers.dev subdomain: `a0955625660`

Do not reintroduce Pages or automatic Git deployment.

## Stable Dev foundation

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
- history-query tests — PASS, 1 file / 4 tests
- Admin Users/Groups/Plans smoke — PASS
- Dev Web shell/routes — PASS
- LINE Login callback/redirect stage — PASS
- PWA-first / unified 小跡 LINE refactor — PASS typecheck + 6 files / 55 tests

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

## Accepted product direction — PWA-first, LINE-integrated

PWA/Web is the primary product surface.

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

## LINE group name / picture — current implementation batch

PWA uses the original current LINE group name/picture. No separate AFTERTRACE custom group display name.

Accepted policy:

- cache group name/picture + sync timestamp
- refresh only when actual use occurs and cache is at least 24h old
- no scheduled/cron profile refresh
- within 24h use cached metadata
- LINE lifecycle/member state remains primary authorization evidence

Current code now includes:

- `worklog_source_line_profiles` table: one cached LINE profile row per GROUP Source
- `group_name`, optional `picture_url`, `synced_at`, created/updated timestamps
- `LineGroupSummaryClient` using `GET /v2/bot/group/{groupId}/summary`
- 24h `WorklogGroupProfileService` stale check
- Drizzle cache repository
- GROUP webhook lazy-refresh hook for explicit handled 小跡 commands only
- profile refresh failure is best-effort/non-blocking: the user command still succeeds and an anomaly is recorded
- ordinary group chat does not trigger profile refresh
- LINE 404 during a live group command does not revoke access or overwrite cached metadata; webhook/lifecycle evidence remains the authorization source
- readiness now probes the new table
- existing Dev DB is preserved through an idempotent forward-compat migration; do not rebuild merely for this table
- PWA Source-list/open-group invocation of the same lazy-refresh service is still pending until that PWA surface is implemented

Official LINE behavior used by this batch: group summary returns group ID/name/optional picture URL for a group the OA participates in; 404 also covers a group the OA does not participate in. Runtime access is therefore not inferred solely from summary fetch failure.

## Unified LINE command language — 小跡

OA and GROUP share one Chinese command prefix: `小跡`.

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

It has been removed from the branch and requires no DB rollback.

## Current validation status

Last completed batch:

- PWA-first / unified 小跡 refactor: `pnpm --filter @aftertrace/api typecheck` — PASS
- targeted current LINE batch — PASS, 6 files / 55 tests
- expected stderr logs were deliberate simulated anomaly/failure tests, not failures

Current LINE group profile batch is **not yet locally validated**. Do not claim it green until the user runs typecheck and targeted tests.

Because this batch adds a canonical table, after code tests pass the required order is:

1. regenerate canonical baseline with `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
2. run `pnpm db:baseline:guard`
3. review generated Drizzle artifacts for `worklog_source_line_profiles`
4. commit generated artifacts with `[skip ci]`
5. run the existing Dev forward migration using `.env.dev`; do not rebuild Dev DB
6. verify table/index exist and AI runtime/FREE plan are preserved
7. only then deploy Dev API and verify `/health` + `/health/ready`

## Immediate next order

1. locally typecheck/test the current LINE group-profile lazy-refresh batch;
2. regenerate/guard canonical baseline;
3. forward-migrate existing Dev DB and verify preservation;
4. deploy Dev API only after schema/runtime green;
5. then implement durable non-expiring PWA AI Draft + last-used Source preference + Quick Capture shared pipeline incrementally;
6. wire PWA Source-list/open-group use into the same 24h lazy profile refresh service;
7. add Voice as another input modality on top of the same preview/commit core.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.
