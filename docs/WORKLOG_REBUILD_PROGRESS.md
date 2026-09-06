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

## Current checkpoint — 2026-09-06 private OA Rich Menu modes added, schema validation pending

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
- API typecheck — PASS before this latest Rich Menu batch
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

## NEW: private OA Rich Menu input modes — implemented in branch

Private OA create/query no longer requires the customer to type `@AFTERTRACE` as the primary UX and does not automatically interpret every private sentence as a database action.

Rich Menu message actions:

- `快速記錄`
- `查詢紀錄`

Flow:

1. user taps a Rich Menu button;
2. OA receives the button's text message;
3. backend persists `RECORD` or `QUERY` in `worklog_private_pending_actions`;
4. TTL = 10 minutes;
5. OA replies with the appropriate input prompt;
6. next non-empty text consumes the mode exactly once;
7. sticker/image/audio/file does not consume a text mode;
8. expired mode fails clearly and does not guess intent;
9. RECORD -> normal PRIVATE AI grant preflight + Record normalization/persistence;
10. QUERY -> deterministic history retrieval, no AI-point requirement.

Ordinary private text without a pending mode remains support/non-product traffic and is not auto-saved or auto-queried.

GROUP behavior is unchanged and still requires `@AFTERTRACE`.

Legacy private `@AFTERTRACE` parsing remains as a compatibility fallback, including existing Reply-edit/attachment behavior, but is not the customer-facing OA interaction contract.

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
- `apps/api/src/worklog/oa-input-mode.ts`
- `apps/api/src/worklog/drizzle-oa-input-mode.ts`
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/worklog/oa-webhook.ts`
- `apps/api/src/index.ts`
- targeted new tests for input-mode TTL and OA runtime mode behavior
- product/development docs

Readiness now probes `worklog_private_pending_actions` because OA record/query depends on it.

## Rich Menu operator configuration after backend is green

In LINE Official Account Manager, configure the private OA Rich Menu so the first two buttons send these **exact text messages**:

- button label: `快速記錄`; action/message text: `快速記錄`
- button label: `查詢紀錄`; action/message text: `查詢紀錄`

Additional buttons can link to `我的紀錄` and `方案 / AI 點數` Web/PWA destinations later. No LINE postback protocol is required for this first version.

## Web/PWA `AI 幫我記`

Accepted architecture remains preview-first and shared with LINE AI interpretation. Implementation is still pending after the current LINE/OA runtime work is green.

## Current validation status for the Rich Menu batch

The assistant has authored the code/tests/docs but has **not** executed them locally and has not deployed them.

Because a new canonical table was added, do **not** deploy yet. Required validation order:

1. pull latest branch
2. API typecheck
3. run `oa-input-mode.test.ts`, `oa-runtime-mode.test.ts`, existing `oa-runtime.test.ts`, `oa-webhook.test.ts`
4. regenerate canonical baseline with `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
5. run `pnpm db:baseline:guard`
6. review baseline diff for `worklog_private_pending_actions`; commit generated Drizzle artifacts with `[skip ci]`
7. run the existing Dev forward migration using `.env.dev`; do not rebuild Dev DB
8. verify new pending-action table + preserved AI runtime/FREE plan
9. deploy Dev API and verify `/health` + `/health/ready`
10. configure Dev OA Rich Menu exact action texts
11. real OA E2E:
    - tap `快速記錄` -> prompt -> `晴空案今天收3000清潔費` -> Record + AI semantic terms
    - tap `查詢紀錄` -> prompt -> `晴空案目前收款進度如何` -> DB facts + deep link
12. if OA still gives no webhook response, inspect Cloudflare Worker logs and LINE Developers webhook delivery/config rather than guessing from the UI

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **PREVIOUS DEV DB/SEMANTIC-SEARCH FOUNDATION GREEN; NEW PRIVATE OA INPUT-MODE SCHEMA/CODE REQUIRES TYPECHECK + TARGETED TESTS + BASELINE REGEN/GUARD + DEV FORWARD MIGRATION BEFORE DEPLOYMENT.**
