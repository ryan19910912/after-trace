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

## Current checkpoint — 2026-09-06 one-call LINE natural-language interpreter wired in branch; local validation and Dev E2E still pending

Cloudflare deployment remains manual:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: corresponding `*-prod` Workers
- workers.dev subdomain: `a0955625660`

Do not reintroduce Pages or automatic Git deployment.

## Latest accepted LINE interaction contract

Customer-facing fixed commands are only:

- `小跡 幫助`
- GROUP `小跡 啟用 AI`
- GROUP `小跡 取消 AI`

`小跡 啟用 AI` binds the sender as GROUP AI 額度負責人 only when no different responsible user is already bound. It is deterministic/provider-free and must not overwrite another responsible user.

`小跡 取消 AI` may be executed only by the currently bound AI 額度負責人. Success deletes only the responsibility binding: the user remains in the LINE group, remains a normal member, GROUP Source/history remain intact, and normal membership-based access is unchanged. The GROUP then has no AI responsible user until another member runs `小跡 啟用 AI`.

OA/private rejects GROUP AI responsibility controls and tells the user to operate them inside the corresponding LINE group.

Everything else after `小跡` is a natural-language request. Initial intents:

- `RECORD`
- `QUERY`
- `EDIT`
- `UNKNOWN`

Future room may include `DELETE`, `RESTORE`, `MOVE`, `SYSTEM_QUERY`, but destructive or mutating actions must never guess a target.

## One-call LINE natural-language implementation — now wired, not yet locally validated

The text path now follows:

**fixed-command check -> one bounded Gemini interpretation -> deterministic backend action**

There is no classifier-call followed by a second normalizer/editor call for normal LINE text RECORD/QUERY/EDIT.

### RECORD

The same Gemini response returns:

- `intent=RECORD`
- durable Record content
- one title/Entity proposal
- title-confirmation flag
- event date
- bounded grounded `search_terms`

The backend then:

1. writes the Record deterministically/idempotently through the existing Record write service;
2. applies title/date/search metadata through `WorklogInterpretedRecordService` + `DrizzleWorklogInterpretedRecordRepository`;
3. performs same-Source exact/fuzzy title checks and creates a normal durable confirmation when required;
4. does **not** call `GeminiWorklogTextNormalizer` again for that LINE text request.

### QUERY

The same Gemini response returns `intent=QUERY` plus bounded query text. The backend derives existing deterministic history filters and performs PostgreSQL retrieval. Returned history is not sent back to AI for summarization.

### EDIT

The runtime resolves the exact Reply target before interpretation when available and supplies that target context to Gemini. The same Gemini response returns:

- `intent=EDIT`
- normalized edit instruction
- complete proposed Record text
- optional date change
- optional title move + confirmation flag

The backend applies that already-interpreted plan through `WorklogInterpretedEditService`. It reuses the existing `worklog_line_ai_edits` idempotency/revision/apply machinery by staging the already-billed result as `USAGE_COMMITTED`; it does **not** call `GeminiWorklogLineRecordEditor` again.

EDIT still requires an exact deterministic Reply target. If AI understands that the user wants to edit but no exact target exists, reject and ask the user to Reply the correct Record. Never let AI guess `剛剛那筆`/`上面那筆` without a durable target.

### AI accounting

`WorklogLineNaturalInterpreterService` uses the existing grant-backed reservation/settlement ledger. Natural-language provider usage is audited under operation `LINE_NATURAL_INTERPRET`; hidden routing calls are not treated as free.

Current provider is still runtime-configured `GOOGLE`; current Dev model remains `gemini-3.5-flash-lite`. Model id is not hard-coded/allowlisted.

### New runtime/code in this batch

- `line-natural-interpreter.ts`
- `gemini-line-natural-interpreter.ts`
- `interpreted-record.ts`
- `drizzle-interpreted-record.ts`
- `interpreted-edit.ts`
- `drizzle-interpreted-edit.ts`
- `line-natural-runtime.ts`
- `oa-natural-runtime.ts`
- `index.ts` now wires GROUP/OA webhook handling to the new natural runtimes
- `command.ts` routes every non-fixed `小跡 ...` sentence to `NATURAL_TEXT`
- old fixed query/record/edit wording is no longer a parser contract
- runtime tests were rewritten around the natural-language path
- Gemini interpreter/accounting tests were added

The older `WorklogLineRuntime`, `WorklogOaRuntime`, `GeminiWorklogTextNormalizer`, and `GeminiWorklogLineRecordEditor` files remain in the tree because other types/legacy paths still reference them, but the LINE webhook composition in `index.ts` no longer uses them for normal text requests.

### Attachment caveat

Quoted binary attachment processing remains a separate multimodal ingestion path. A natural-language text interpretation may currently precede attachment ingestion, so attachment cases are **not yet guaranteed to be one provider call total**. Do not claim the one-call guarantee for AUDIO/IMAGE/FILE Reply ingestion until that path is explicitly unified. Normal text RECORD/QUERY/EDIT is the target of this batch.

### Idempotency caveat to review before Prod

The deterministic Record/edit persistence layers remain idempotent, but the new generic natural-language interpretation currently reserves/calls/settles before a universal `line_message_id`-scoped interpreter-result cache exists. A LINE webhook redelivery could therefore potentially repeat the interpretation call even when the later deterministic mutation deduplicates. This must be reviewed/fixed before calling the new interpreter production-hard exactly-once. Do not hide this debt.

## GROUP AI responsibility controls — implemented in branch, unvalidated in this batch

- explicit wording is `小跡 啟用 AI` / `小跡 取消 AI`;
- only the current responsible user can cancel;
- cancellation deletes only current responsibility and writes immutable responsibility history (`previous_user_id -> NULL`, reason `EXPLICIT_RELEASE`);
- no schema change was required for cancellation;
- successful responsibility bind can use LINE textV2 user mention with fallback to plain text;
- unbound AI guidance now points to `小跡 啟用 AI`.

## Stable Dev foundation — verified before the current unvalidated interpreter batch

Already user/runtime verified:

- commercial-plan forward migration on existing Dev DB — PASS
- semantic `search_terms` canonical baseline/guard — PASS
- original journal timestamp `1788528481453` preserved — PASS
- existing Dev forward migration for `search_terms` — PASS
- `worklog_records.search_terms jsonb NOT NULL DEFAULT []` — PASS
- AI runtime preserved `GOOGLE / gemini-3.5-flash-lite` — PASS
- AI pricing preserved input `0.30000000`, output `2.50000000` USD per million — PASS
- FREE plan preserved `FREE / grant_points=400000 / enabled=true` — PASS
- normalization tests — PASS, 3 files / 13 tests
- history-query tests — PASS, 1 file / 4 tests
- Admin Users/Groups/Plans smoke — PASS
- Dev Web shell/routes — PASS
- LINE Login callback/redirect stage — PASS
- earlier PWA-first / unified 小跡 refactor — PASS before this latest interpreter migration

The stale Dashboard `* * * * *` Cron Trigger remains unrelated to logging. Remove it separately; do not add an empty `scheduled()` handler.

## Deterministic history / semantic retrieval — retained

- history retrieval = **Interpret current request -> Query -> Retrieve -> Answer -> Deep Link**
- no AI historical summary in MVP
- same-Source Entity/Alias resolution
- title/alias/raw/search_terms lookup
- newest up to 5 matching stored facts returned in LINE
- total count when available
- secure filtered PWA link
- never invent payment/progress/business conclusions

Manual PWA search remains provider-free. LINE natural-language QUERY now uses one provider interpretation because the user explicitly invoked `小跡`, but the stored history itself is still retrieved/answered deterministically.

## Event-date / Reply source time — retained hard rule

- day-precision Asia/Taipei business semantics
- direct LINE input reference = original command message timestamp
- GROUP Reply-to-TEXT reference = cached quoted timestamp
- later Reply command time never substitutes quoted text time
- Worker current time never silently substitutes missing source time
- if original timestamp cannot be recovered, fail/request resend

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

Data remains with GROUP Source. Authorization must be server-side on every operation.

## LINE group name / picture — implemented foundation

PWA uses original current LINE group name/picture. No separate AFTERTRACE custom group display name.

Accepted/implemented foundation:

- `worklog_source_line_profiles`
- `group_name`, optional `picture_url`, `synced_at`
- 24h lazy refresh only on actual use
- no cron/scheduled refresh
- ordinary group chat does not refresh
- lifecycle/member state remains authorization evidence
- refresh failure is best-effort/non-blocking
- readiness probes the table
- existing Dev DB was migrated forward without rebuild
- PWA Source-list/open-group invocation of same refresh service remains pending

## Previous group-profile validation — PASS before this interpreter batch

User-executed local validation previously passed:

- `pnpm --filter @aftertrace/api typecheck`
- targeted group-profile batch — 5 files / 40 tests
- canonical baseline — 33 tables, group profile table/FK/index present
- baseline guard — PASS
- Dev forward migration — PASS
- Dev API `/health` and `/health/ready` — PASS

The unrelated local untracked file `apps/api/verify-admin-schema.mjs` remains outside this batch and must not be staged/committed unless separately reviewed.

## Current validation status

**The one-call natural-language interpreter batch has not yet been executed locally.**

Do not claim typecheck/tests/runtime green until the user runs them. No GitHub Actions workflow has been run, triggered, modified, enabled, dispatched, or used as validation.

No schema files were changed in this one-call batch, so this batch itself does not require baseline regeneration or DB migration.

## Immediate next order

1. pull the current branch;
2. run API typecheck;
3. run targeted tests for parser, interpreter, GROUP/OA natural runtimes, AI responsibility, group webhook and LINE reply mention;
4. fix all compile/test regressions locally before deployment;
5. do **not** rebuild Dev DB for this batch;
6. manually deploy Dev API only after local green;
7. E2E GROUP `小跡 啟用 AI` + real mention, natural RECORD, natural QUERY, Reply natural EDIT, `小跡 取消 AI`, then re-enable;
8. verify a normal text RECORD produces only one `LINE_NATURAL_INTERPRET` provider usage event and does not create a second `TEXT_RECORD_CREATE` provider usage event;
9. verify natural EDIT similarly does not create a second `TEXT_RECORD_EDIT` provider usage event;
10. then address generic interpreter redelivery idempotency and the attachment one-call caveat before Prod;
11. after LINE text path is stable, continue durable non-expiring PWA AI Draft + last-used Source preference + Quick Capture shared pipeline;
12. wire PWA Source-list/open-group use into the same 24h lazy profile refresh service;
13. add Voice as another input modality on top of the same preview/commit core.
