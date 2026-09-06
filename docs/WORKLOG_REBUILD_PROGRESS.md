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

The latest documents above are the only product/development specification. Do not use GitHub Actions. Every development commit must contain `[skip ci]`.

## Current checkpoint — 2026-09-06 private OA Rich Menu Postback modes added, local code tests green, schema validation pending

Cloudflare deployment remains manual:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: corresponding `*-prod` Workers
- workers.dev subdomain: `a0955625660`

Do not reintroduce Pages or automatic Git deployment.

## Stable Dev state before the current Rich Menu schema batch

Already verified by the user:

- typed commercial plan forward migration on existing Dev DB — PASS
- canonical baseline regeneration/guard for semantic `search_terms` — PASS
- journal timestamp `1788528481453` preserved — PASS
- existing Dev forward migration for `search_terms` — PASS
- post-migration `search_terms jsonb NOT NULL DEFAULT []` — PASS
- Dev DB currently had 0 Worklog Records before LINE E2E
- AI runtime preserved as `GOOGLE / gemini-3.5-flash-lite` — PASS
- current Dev FREE plan preserved as `FREE / 400000 / enabled=true` — PASS
- targeted normalization tests — PASS, 3 files / 13 tests
- command/history/LINE runtime tests — PASS, 6 files / 57 tests
- history-query tests — PASS, 1 file / 4 tests
- Admin Users/Groups/Plans smoke — PASS
- Dev Web shell/routes — PASS
- LINE Login callback/redirect stage — PASS

The stale Cloudflare Dashboard `* * * * *` Cron Trigger is unrelated to logging and should still be removed separately. Do not add an empty `scheduled()` handler.

## Deterministic LINE history + semantic retrieval — implemented

Current contract:

- history = **Query → Retrieve → Answer → Deep Link**
- no AI history summary in MVP
- resolve same-Source Entity/Alias where possible
- search title/alias/raw text/`search_terms`
- return newest up to 5 matching Records directly in LINE
- append secure filtered PWA link
- never invent payment/project/progress conclusions

AI-assisted Record interpretation may produce bounded grounded `search_terms` in the same provider call as title/date parsing. Manual PWA CRUD remains free and does not silently call AI.

## Event date / Reply-Replay source time — hard rule

Business event semantics are day-precision in Asia/Taipei even though the physical compatibility field is still `occurred_at`.

- direct LINE input reference = original LINE message timestamp
- delayed GROUP Reply-to-TEXT reference = cached quoted message timestamp
- later Reply command time is never the quoted content's date reference
- Worker current time is never a silent substitute
- if required original timestamp is unavailable, fail/request resend

Example: 9/3 original `晴空案今天收3000清潔費`, 9/5 Reply to record it -> event date must remain 9/3.

Delayed attachment Reply still has an open timestamp-recovery gap and must not be claimed fully compliant yet.

## Account onboarding / OA friendship — implemented, runtime smoke still pending

Accepted behavior:

- LINE Login may provision user/workspace/PRIVATE Source/FREE_INITIAL idempotently
- LINE Login does not fabricate OA friendship
- real OA follow/unfollow owns `is_oa_friend`
- Web/PWA PRIVATE manual use does not require OA friendship
- Web non-friend add-OA prompt is optional convenience messaging, not gating
- later OA follow must not duplicate FREE_INITIAL

## NEW: private OA Rich Menu Postback input modes — implemented in branch

Private OA create/query no longer requires the customer to type `@AFTERTRACE` as the primary UX and does not automatically interpret every private sentence as a database action.

Rich Menu Postback contract:

- `aftertrace:record`
- `aftertrace:query`
- `aftertrace:cancel`

Flow:

1. user taps a Rich Menu button;
2. LINE sends an OA `postback` webhook, not a visible chat command;
3. backend parses the Postback separately from normal messages and does not fabricate a message id;
4. `record` or `query` persists `RECORD` / `QUERY` in `worklog_private_pending_actions`;
5. TTL = 10 minutes;
6. OA replies with the appropriate input prompt;
7. next non-empty text consumes the mode exactly once;
8. sticker/image/audio/file does not consume a text mode;
9. expired mode fails clearly and does not guess intent;
10. RECORD -> normal PRIVATE AI grant preflight + Record normalization/persistence;
11. QUERY -> deterministic history retrieval, no AI-point requirement;
12. `aftertrace:cancel` clears the pending action; literal `取消` is also accepted as a safety fallback;
13. unknown Postback data is `NOT_HANDLED` / fail-closed.

Ordinary private text without a pending mode remains support/non-product traffic and is not auto-saved or auto-queried.

GROUP behavior is unchanged and still requires `@AFTERTRACE`.

Legacy private `@AFTERTRACE` parsing remains temporarily as a compatibility/debug fallback, including existing Reply-edit/attachment behavior, but is not the customer-facing OA interaction contract.

### New durable schema

Canonical table:

`worklog_private_pending_actions`

Fields/invariants:

- one row per `user_id` (PK/FK to `worklog_users`)
- `action IN ('RECORD','QUERY')`
- `expires_at`
- created/updated timestamps
- expiry index

Cloudflare Worker memory is not used for pending mode state.

Files added/changed include:

- `apps/api/src/db/schema-worklog-oa-mode.ts`
- `apps/api/src/db/schema-all.ts`
- `apps/api/scripts/forward-compat.mjs`
- `apps/api/src/line/events.ts`
- `apps/api/src/worklog/oa-input-mode.ts`
- `apps/api/src/worklog/drizzle-oa-input-mode.ts`
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/worklog/oa-webhook.ts`
- `apps/api/src/index.ts`
- targeted tests for input-mode TTL/cancel, Postback parsing, OA runtime Postback behavior and OA webhook routing
- product/development docs

Readiness now probes `worklog_private_pending_actions` because OA record/query operation depends on it.

## Rich Menu operator configuration after backend is green

In LINE Official Account Manager, configure the private OA Rich Menu with **Postback actions**:

- button label: `快速記錄`; Postback data: `aftertrace:record`
- button label: `查詢紀錄`; Postback data: `aftertrace:query`
- cancellation UI (Rich Menu or later Quick Reply): Postback data: `aftertrace:cancel`

For mode-selection actions, leave visible `displayText` empty unless a later product decision explicitly wants a visible chat line. The goal is that tapping the Rich Menu does not send a fake user message such as `快速記錄`.

Additional buttons can link to `我的紀錄` and `方案 / AI 點數` Web/PWA destinations later.

## Web/PWA `AI 幫我記`

Accepted architecture remains preview-first and shared with LINE AI interpretation. Implementation is still pending after the current LINE/OA runtime work is green.

## Current validation status for the Rich Menu/Postback batch

Latest local validation executed by the user on Windows after commit `c530b50c65e6fe49ebca6747b07f80469dcd910f`:

- `pnpm --filter @aftertrace/api typecheck` — PASS
- targeted Postback/OA tests — PASS, 5 files / 42 tests:
  - `src/line/events.test.ts`
  - `src/worklog/oa-input-mode.test.ts`
  - `src/worklog/oa-runtime-mode.test.ts`
  - `src/worklog/oa-runtime.test.ts`
  - `src/worklog/oa-webhook.test.ts`
- expected stderr anomaly logs from deliberate simulated failure cases were present; they were not test failures.
- legacy OA text path duplicate AI preflight bug was fixed before the green run so text Record creation now performs one preflight rather than two.

Because the pending-action canonical table was added in this Rich Menu batch, do **not** deploy yet. Required validation order now:

1. regenerate canonical baseline with `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
2. run `pnpm db:baseline:guard`
3. review baseline diff for `worklog_private_pending_actions`; commit generated Drizzle artifacts with `[skip ci]`
4. run the existing Dev forward migration using `.env.dev`; do not rebuild Dev DB
5. verify new pending-action table + preserved AI runtime/FREE plan
6. deploy Dev API and verify `/health` + `/health/ready`
7. configure Dev OA Rich Menu Postbacks exactly as above
8. real OA E2E:
   - tap `快速記錄` -> prompt -> `晴空案今天收3000清潔費` -> Record + AI semantic terms
   - tap `查詢紀錄` -> prompt -> `晴空案目前收款進度如何` -> DB facts + deep link
   - tap cancel -> pending action cleared, next ordinary sentence must not be recorded/queried
9. if OA still gives no webhook response, inspect Cloudflare Worker logs and LINE Developers webhook delivery/config rather than guessing from the UI

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **PREVIOUS DEV DB/SEMANTIC-SEARCH FOUNDATION GREEN; PRIVATE OA POSTBACK TYPECHECK + 42 TARGETED TESTS PASS; BASELINE REGEN/GUARD + DEV FORWARD MIGRATION + DEPLOYED OA E2E STILL PENDING.**
