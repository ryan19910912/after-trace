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

## Current checkpoint — 2026-09-06 fixed provider-free `小跡 狀態` + natural DELETE/RESTORE/MOVE wired in branch; local validation and Dev E2E pending

Cloudflare deployment remains manual:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: corresponding `*-prod` Workers
- workers.dev subdomain: `a0955625660`

Do not reintroduce Pages or automatic Git deployment.

## Latest accepted LINE interaction contract

Customer-facing fixed commands are now exactly:

- `小跡 幫助`
- `小跡 狀態`
- GROUP `小跡 啟用 AI`
- GROUP `小跡 取消 AI`

`小跡 狀態` is deterministic/provider-free and must work even when AI points are zero.

GROUP status requires active GROUP membership and shows:

- current AI 額度負責人;
- current remaining AI points / current total effective allowance scoped to this GROUP;
- current allowance utilization percentage;
- whether GROUP AI is usable.

If no GROUP AI 額度負責人 exists, status shows AI paused and directs the user to `小跡 啟用 AI`.

OA/private `小跡 狀態` shows the PRIVATE allowance and `AI 負責人：你`.

The displayed total is the current effective allowance pool, not a lifetime immutable denominator. A later TOP_UP/SUBSCRIPTION/ADMIN Grant may increase the pool and therefore lower the displayed current utilization percentage.

`小跡 啟用 AI` binds the sender as GROUP AI 額度負責人 only when no different responsible user is already bound. It is provider-free and must not overwrite another responsible user.

`小跡 取消 AI` may be executed only by the currently bound AI 額度負責人. Success removes only the responsibility binding: the user remains in the LINE group, normal membership access remains, and GROUP Source/history remain intact.

OA/private rejects the two GROUP AI responsibility controls.

## Current natural-language intent contract

Everything else after `小跡` goes through the bounded natural-language interpreter. Current intents are:

- `RECORD`
- `QUERY`
- `EDIT`
- `DELETE`
- `RESTORE`
- `MOVE`
- `UNKNOWN`

`SYSTEM_QUERY` has been removed from the accepted AI intent contract. System status is intentionally the fixed provider-free `小跡 狀態` path.

Examples:

- `小跡 幫我記一下今天晴空案收了三千`
- `小跡 我要查詢一下晴空案最近的內容`
- Reply Record -> `小跡 我想把金額改成 2800`
- Reply Record -> `小跡 把這筆刪掉`
- Reply deleted Record -> `小跡 幫我還原這筆`
- Reply Record -> `小跡 把這筆移到晴空案`

EDIT/DELETE/RESTORE/MOVE require an exact deterministic target. Never guess `剛剛那筆` / `上面那筆` without a validated Reply target or equivalent durable target.

## One-call natural-language implementation — wired, not yet locally validated

Normal LINE text follows:

**fixed-command check -> one bounded Gemini interpretation -> deterministic backend action**

Fixed `小跡 狀態` bypasses Gemini and AI-point start checks entirely.

### RECORD

The same Gemini response returns:

- `intent=RECORD`
- durable Record content
- one title/Entity proposal
- title-confirmation flag
- event date
- bounded grounded `search_terms`

Backend then writes/applies the Record deterministically. It must not issue a second text-normalization provider request for the same normal LINE text Record.

### QUERY

The same Gemini response returns `intent=QUERY` plus bounded query text. PostgreSQL performs deterministic history retrieval. Stored history is not sent back to AI for a second summary pass.

### EDIT

Runtime resolves an exact Reply target and provides target context to Gemini. The same response returns the complete interpreted edit plan; backend applies it through existing optimistic-version/revision machinery without calling the old Gemini editor again.

### DELETE / RESTORE / MOVE

The interpreter identifies only the bounded action/destination title. Backend performs:

- active membership/private ownership authorization;
- exact Reply target resolution;
- soft delete / restore / title move;
- optimistic version protection;
- immutable revision writing.

`MOVE` changes the filing Entity/title only and does not rewrite Record content/date.

## Fixed status implementation in branch

Current implementation files include:

- `command.ts`: recognizes `小跡 狀態` as a fixed system command via `isWorklogStatusCommand`; help teaches all four fixed commands.
- `line-system-query.ts`: provider-free GROUP/PRIVATE status formatting.
- `drizzle-line-system-query.ts`: durable DB read of GROUP responsible user and current effective scoped allowance totals.
- `line-natural-runtime.ts`: handles GROUP status before GROUP AI funding authorization/provider interpretation.
- `oa-natural-runtime.ts`: handles PRIVATE status before AI balance/provider interpretation.
- `line-natural-interpreter.ts`: no `SYSTEM_QUERY` union anymore.
- `gemini-line-natural-interpreter.ts`: Gemini schema no longer includes `SYSTEM_QUERY` or AI status fields.
- `line-system-query.test.ts`, `command.test.ts`, `gemini-line-natural-interpreter.test.ts`: tests authored for the new contract.

The current GROUP status shape is equivalent to:

```text
AFTERTRACE 群組狀態

AI 負責人：Ryan Hsu
AI 點數：320,000 / 400,000
目前額度使用率：20%
AI 功能：可使用
```

No responsible user:

```text
AFTERTRACE 群組狀態

AI 負責人：尚未設定
AI 點數：—
目前額度使用率：—
AI 功能：暫停

請輸入「小跡 啟用 AI」設定負責人。
```

Status currently uses the stored display name as plain text. The existing real LINE textV2 mention path is retained for successful `小跡 啟用 AI`; status-specific mention rendering has not been added and is not required by the current accepted contract.

## AI accounting

Natural-language provider work uses the existing Grant-backed point reservation/settlement path with operation `LINE_NATURAL_INTERPRET`.

Provider/model remains runtime configured. Current verified Dev runtime before this unvalidated batch:

- provider: `GOOGLE`
- model: `gemini-3.5-flash-lite`
- input price: `0.30000000` USD / million
- output price: `2.50000000` USD / million

Current verified FREE configuration before this unvalidated batch:

- `FREE / FREE / 0.00 / 400000 / enabled=true`

`小跡 幫助`, `小跡 狀態`, `小跡 啟用 AI`, `小跡 取消 AI` are provider-free.

## Known interpreter / attachment debt

### Generic LINE redelivery idempotency

The deterministic Record/edit mutation layers remain idempotent, but the generic natural interpreter still does not have a universal `line_message_id`-scoped durable interpretation-result cache. A LINE webhook redelivery could potentially repeat the interpretation provider call before later deterministic mutation dedupes it.

Fix/review this before calling the new interpreter production-hard exactly-once.

### Attachment one-call caveat

Quoted binary attachment processing remains a separate multimodal ingestion path. Do not claim one provider call total for AUDIO/IMAGE/FILE Reply ingestion yet.

Delayed attachment Reply original-timestamp recovery also remains open debt; never substitute later command time for missing original attachment time.

## GROUP AI responsibility controls — implemented, current batch still unvalidated locally

- explicit wording: `小跡 啟用 AI` / `小跡 取消 AI`;
- only current responsible user can cancel;
- cancellation deletes only current responsibility and writes immutable responsibility history (`previous_user_id -> NULL`, reason `EXPLICIT_RELEASE`);
- no schema change required for cancellation;
- successful bind can use LINE textV2 user mention with plain-text fallback;
- unbound AI guidance points to `小跡 啟用 AI`.

## Stable Dev foundation — verified before current unvalidated batches

Previously user/runtime verified:

- commercial-plan forward migration — PASS
- semantic `search_terms` canonical baseline/guard — PASS
- existing Dev forward migration for `search_terms` — PASS
- group profile table/cache forward migration — PASS
- canonical baseline had 33 tables after group-profile batch — PASS
- AI runtime preserved — PASS
- FREE plan preserved — PASS
- Admin Users/Groups/Plans smoke — PASS
- Dev Web shell/routes — PASS
- LINE Login callback/redirect stage — PASS
- Dev API `/health` and `/health/ready` — PASS before latest natural-language/status batches

The stale Dashboard `* * * * *` Cron Trigger remains unrelated to logging. Remove it separately; do not add an empty `scheduled()` handler.

## GROUP access hard rule

When a user leaves/is removed from LINE GROUP, immediately revoke all GROUP Source rights:

- read/search;
- Quick Capture selection;
- create/edit/delete/restore/title move;
- Draft read/edit/commit;
- deep-link access.

Data remains with GROUP Source. Authorization is server-side on every operation.

## Event-date / Reply source time hard rule

- day-precision Asia/Taipei business semantics;
- direct LINE input reference = original command message timestamp;
- GROUP Reply-to-TEXT reference = cached quoted timestamp;
- later Reply command time never substitutes quoted text time;
- Worker current time never silently substitutes missing source time;
- if required source timestamp cannot be recovered, fail/request resend.

Regression:

- 9/3 original `晴空案今天收3000清潔費`
- 9/5 Reply asks 小跡 to record it
- event date remains 9/3.

## PWA direction retained

PWA/Web remains the primary product surface.

Still pending:

- durable non-expiring PWA AI Draft;
- last-used valid Source preference;
- Quick Capture Voice + Text;
- explicit Source warnings;
- Preview/confirm flow;
- PWA Source-list/open-group integration with same 24h lazy LINE group profile refresh;
- Voice on top of the shared preview/commit core.

## Current validation status

**The one-call natural-language, DELETE/RESTORE/MOVE, responsibility-cancel, and fixed-status batches have not yet been executed locally as one current branch validation.**

Do not claim typecheck/tests/runtime green until the user runs them.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

No schema files were changed by the fixed-status / natural intent batch, so it does not require baseline regeneration or DB migration.

The unrelated local untracked file `apps/api/verify-admin-schema.mjs` remains outside this work and must not be staged/committed unless separately reviewed.

## Immediate next order

1. `git pull` current branch;
2. run API typecheck;
3. run targeted parser/interpreter/status/record-action/GROUP/OA/AI-responsibility/webhook/reply tests;
4. fix all compile/test regressions before Dev deployment;
5. do not rebuild or migrate Dev DB for this batch;
6. manually deploy Dev API only after local green;
7. E2E GROUP `小跡 狀態` before responsible user, `小跡 啟用 AI`, `小跡 狀態`, natural RECORD/QUERY, Reply EDIT/DELETE/RESTORE/MOVE, `小跡 取消 AI`, `小跡 狀態`, then re-enable;
8. verify `小跡 狀態` creates no Gemini/provider usage event and works at zero AI balance;
9. verify normal text RECORD produces only one `LINE_NATURAL_INTERPRET` provider usage event and no second `TEXT_RECORD_CREATE` provider event;
10. verify natural EDIT similarly produces no second `TEXT_RECORD_EDIT` provider event;
11. address generic interpreter redelivery idempotency and attachment one-call caveat before Prod;
12. then continue PWA Draft/Quick Capture work.
