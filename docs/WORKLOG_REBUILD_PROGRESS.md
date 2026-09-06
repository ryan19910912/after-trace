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

## Current checkpoint — 2026-09-06 natural-language 小跡 contract accepted; explicit GROUP AI enable/cancel implementation in branch; one-call AI interpreter still pending local validation/implementation

Cloudflare deployment remains manual:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: corresponding `*-prod` Workers
- workers.dev subdomain: `a0955625660`

Do not reintroduce Pages or automatic Git deployment.

## Latest accepted LINE interaction contract

Customer-facing fixed commands are now only:

- `小跡 幫助`
- GROUP `小跡 啟用 AI`
- GROUP `小跡 取消 AI`

`小跡 啟用 AI` binds the sender as GROUP AI 額度負責人 only when no different responsible user is already bound. It is deterministic/provider-free and must not overwrite another responsible user.

`小跡 取消 AI` may be executed only by the currently bound AI 額度負責人. Success deletes only the responsibility binding: the user remains in the LINE group, remains a normal member, GROUP Source/history remain intact, and normal membership-based access is unchanged. The GROUP then has no AI responsible user until another member runs `小跡 啟用 AI`.

Everything else after `小跡` is intended to become a natural-language request interpreted into a bounded structured plan. Initial intents: `RECORD`, `QUERY`, `EDIT`, `UNKNOWN`; future room may include `DELETE`, `RESTORE`, `MOVE`, `SYSTEM_QUERY`, but mutating/destructive actions may never guess a target.

Target architecture is fixed-command check -> one bounded provider interpretation whenever practical -> deterministic backend action. Do not build an open-ended function/tool loop. For RECORD, the same provider interpretation should also return title/date/search terms so there is not a classifier call followed by a second normalization call. QUERY may use provider interpretation for filters but historical retrieval/answer remains deterministic and is never AI-summarized. EDIT still requires an exact Reply/PWA target.

Natural-language provider work remains audited/charged under the existing AI-point policy. Do not make hidden routing provider calls free; reduce duplicate calls instead.

### Code already changed in this migration batch

- `command.ts`: formal fixed wording changed to `小跡 啟用 AI` / `小跡 取消 AI`; help text now teaches natural-language examples. Old query/record/edit parsing branches remain **temporary compatibility only** until the one-call interpreter is wired.
- `ai-responsibility.ts`: added owner-checked responsibility release domain result/service.
- `drizzle-ai-responsibility.ts`: added responsibility delete + immutable history row (`previous_user_id -> NULL`) with `EXPLICIT_RELEASE`.
- `grant-collaboration.ts`: exposes GROUP AI release without conflating it with manual membership access.
- `line-runtime.ts`: supports `AI_RESPONSIBILITY_RELEASED`, rejects non-owner cancellation, and points unbound AI guidance to `小跡 啟用 AI`.
- `oa-runtime.ts`: rejects both GROUP AI controls in OA/private.
- `command.test.ts`, `line-runtime.test.ts`, new `ai-responsibility.test.ts`: coverage authored for the new contract/release semantics.
- Previous mention UX remains: successful GROUP responsibility bind can use LINE textV2 user mention and fallback to plain text if mention delivery fails.

No schema migration is required for cancellation because existing `worklog_source_ai_responsibility_history.previous_user_id/next_user_id` already allow nullable endpoints.

**Important:** tests/typecheck for this new migration batch have NOT been executed yet. Do not claim green until local validation is run. Do not deploy this batch to Dev before that validation.

## Stable Dev foundation

Already user/runtime verified before the current unvalidated migration batch:

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
- earlier PWA-first / unified 小跡 refactor — PASS typecheck + 6 files / 55 tests, before the latest command migration

The stale Dashboard `* * * * *` Cron Trigger remains unrelated to logging. Remove it separately; do not add an empty `scheduled()` handler.

## Deterministic history / semantic retrieval — retained

- history retrieval = **Query -> Retrieve -> Answer -> Deep Link** after any current-request interpretation step
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
- 9/5 Reply asks 小跡 to record it
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

Current code includes:

- `worklog_source_line_profiles` table: one cached LINE profile row per GROUP Source
- `group_name`, optional `picture_url`, `synced_at`, created/updated timestamps
- `LineGroupSummaryClient` using `GET /v2/bot/group/{groupId}/summary`
- 24h `WorklogGroupProfileService` stale check
- Drizzle cache repository
- GROUP webhook lazy-refresh hook for explicit handled 小跡 requests only
- profile refresh failure is best-effort/non-blocking: the user request still succeeds and an anomaly is recorded
- ordinary group chat does not trigger profile refresh
- LINE 404 during a live group request does not revoke access or overwrite cached metadata; webhook/lifecycle evidence remains the authorization source
- readiness probes the new table
- existing Dev DB is preserved through an idempotent forward-compat migration; do not rebuild merely for this table
- PWA Source-list/open-group invocation of the same lazy-refresh service is still pending until that PWA surface is implemented

## OA Rich Menu pending-mode experiment — fully retired before DB migration

The short-lived Postback/pending-action implementation was prototyped and locally green (42 targeted tests) but was rejected by subsequent product decision **before baseline regeneration or Dev migration**.

It has been removed from the branch and requires no DB rollback.

## Previous group-profile validation status — PASS before current command migration

Latest user-executed local validation before this migration batch:

- `pnpm --filter @aftertrace/api typecheck` — **PASS**
- targeted group-profile batch — **PASS, 5 files / 40 tests**
  - `src/line/group-summary.test.ts` — 4 tests
  - `src/worklog/group-profile.test.ts` — 4 tests
  - `src/worklog/group-webhook.test.ts` — 10 tests
  - `src/worklog/line-runtime.test.ts` — 14 tests
  - `src/worklog/command.test.ts` — 8 tests
- stderr logs were expected simulated failures (`LINE unavailable`, `boom`) and were not test failures.

Canonical fresh-database baseline was regenerated and committed successfully:

- Drizzle reports **33 tables**
- new `worklog_source_line_profiles` table is present
- FK to `worklog_sources(id)` is present
- `worklog_source_line_profile_synced_idx` is present
- original canonical baseline migration timestamp `1788528481453` was preserved
- `pnpm db:baseline:guard` — **PASS**
- generated baseline commit was rebased onto the latest remote branch and pushed successfully

Existing Dev DB forward migration was applied without rebuilding and verified:

- `worklog_source_line_profiles` exists — **PASS**
- primary key `worklog_source_line_profiles_pkey` exists — **PASS**
- index `worklog_source_line_profile_synced_idx` exists — **PASS**
- AI runtime preserved: `GOOGLE / gemini-3.5-flash-lite` — **PASS**
- AI pricing preserved: input `0.30000000`, output `2.50000000` USD per million — **PASS**
- FREE plan preserved: `FREE / FREE / 0.00 / 400000 / enabled=true` — **PASS**

Dev API was manually deployed and runtime health verified before this latest command migration:

- `https://after-trace-api-dev.a0955625660.workers.dev/health` -> `status=ok` — **PASS**
- `https://after-trace-api-dev.a0955625660.workers.dev/health/ready` -> `status=ready` — **PASS**

The unrelated local untracked file `apps/api/verify-admin-schema.mjs` remains outside this batch and must not be staged/committed unless separately reviewed.

## Immediate next order

1. locally validate the new explicit AI control/release batch with typecheck + targeted tests;
2. fix any compile/test regressions before Dev deployment;
3. implement the bounded one-call natural-language interpreter shared by GROUP/OA without introducing classifier + normalizer/editor duplicate provider calls;
4. keep QUERY retrieval deterministic and EDIT target deterministic;
5. update/retire transitional parser compatibility once the interpreter is actually wired;
6. manually deploy Dev API only after validation;
7. E2E `小跡 啟用 AI`, mention display, `小跡 取消 AI`, re-enable by another member, and natural-language RECORD/QUERY/EDIT;
8. then continue durable non-expiring PWA AI Draft + last-used Source preference + Quick Capture shared pipeline;
9. wire PWA Source-list/open-group use into the same 24h lazy profile refresh service;
10. add Voice as another input modality on top of the same preview/commit core.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.
