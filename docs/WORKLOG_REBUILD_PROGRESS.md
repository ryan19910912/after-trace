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

The latest documents above are the only product/development specification. Pure UI-only styling tweaks do not require rereading the full set; product/schema/runtime changes do.

## Current checkpoint — 2026-09-06 Dev API/Admin/Web recovery + onboarding/Web-AI decisions

Cloudflare deployment remains manual with six explicit Workers:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`.
- Prod: corresponding `*-prod` Workers.

Environment inputs remain `.env.local` local-only, `.env.dev` Dev, `.env.prod` Prod. API deploy migrates the selected DB, uploads only whitelisted runtime bindings, deploys the exact Worker name, deletes its temporary Wrangler secrets file, and verifies health/readiness.

## Typed commercial plan migration — completed on existing Dev DB

Accepted schema:

- `worklog_plan_type`: `FREE | SUBSCRIPTION | ONE_TIME`
- `worklog_subscription_plans.plan_type`
- `worklog_subscription_plans.grant_points`
- obsolete `subscription_period_points` removed.

User explicitly chose **not** to rebuild the existing Dev DB.

Implemented strategy:

- canonical fresh DB still uses regenerated `0000_worklog_baseline`;
- existing environments run an idempotent forward-compatibility migration before Drizzle migrate;
- old `subscription_period_points` is copied to `grant_points`;
- legacy `FREE` becomes `plan_type=FREE`, other legacy plans become `SUBSCRIPTION`;
- AI runtime/business rows are preserved;
- baseline regeneration preserves the original `0000_worklog_baseline` migration timestamp so an existing DB does not mistake the regenerated baseline for a new migration.

Runtime validation completed by the user:

- forward migration on existing Dev DB — PASS;
- `subscription_period_points` no longer exists — PASS;
- FREE row migrated to `plan_type=FREE` — PASS;
- AI runtime preserved as `GOOGLE / gemini-3.5-flash-lite` — PASS;
- PostgreSQL integrity probes — PASS;
- regenerated baseline guard — PASS;
- regenerated baseline committed as `5cdb77caf024299e5b2a4396699bbded81c4e1fc`.

Do **not** resurrect the obsolete "Dev DB must be rebuilt" instruction. Rebuild only when truly necessary or explicitly chosen; otherwise preserve environment data with reviewed forward migrations.

## Dev API — green

Dev API deployment completed successfully after the migration work.

Verified:

- migration hook — PASS;
- Worker deploy — PASS;
- `/health` -> `ok`;
- `/health/ready` -> `ready`;
- Workers Logs/observability active.

The stale Dashboard `* * * * *` Cron Trigger remains unrelated to logging and should be removed separately; do not add an empty `scheduled()` handler.

## Admin Users/Groups 500 — root cause fixed

Real Dev Users/Groups requests returned structured `ADMIN_USERS_QUERY_FAILED` / `ADMIN_GROUPS_QUERY_FAILED` 500s.

Schema checks confirmed required Grant/scope/reservation/usage columns existed. A direct SQL probe exposed PostgreSQL `42601 syntax error at or near "grant"`.

Root cause:

```sql
FROM worklog_ai_grants grant
```

`GRANT` is a PostgreSQL keyword and was used as an unquoted alias in multiple Admin queries.

Repair:

- replace reserved alias `grant` with safe alias `g` across Users/Groups/detail/funding queries;
- commit `eb3ddbcab05814ff25e0a5ed64acd2b62d8352da` (`[skip ci]`).

Runtime validation after redeploy:

- Admin Users page — PASS;
- Admin Groups page — PASS;
- plan tabs `免費制 / 訂閱制 / 買斷制` — PASS;
- FREE plan editing/grant_points — PASS.

## Dev Web deployment — green at shell/routing level

`pnpm deploy:dev:web` completed successfully.

Verified by user:

- Web Worker opens;
- `/`, `/help`, `/subscription`, `/feedback` route shells open;
- routes that require authentication correctly enter LINE Login rather than failing at Worker routing level.

Dev Web Worker version from that run: `f4d80e1d-637a-4755-94d4-8c0375b4bfbe`.

## LINE Login callback — configured and passing redirect stage

Initial LINE error was `Invalid redirect_uri`. The API-generated callback is:

```text
https://after-trace-api-dev.a0955625660.workers.dev/api/v1/auth/line/callback
```

After registering the exact callback in LINE Developers, LINE Login proceeded and the Web received a valid session. The next request reached `/api/v1/worklog/surfaces`, proving callback/login routing worked.

## Account onboarding decision — accepted, code in progress

The product no longer requires OA friendship merely to create/use an AFTERTRACE Web/PWA account.

Accepted behavior:

- LINE Login may create/update user + workspace + PRIVATE Source;
- first eligible account bootstrap issues `FREE_INITIAL` from Admin-configured FREE `grant_points`;
- login must not set `is_oa_friend=true`;
- real OA follow/unfollow remains the only owner of friendship state;
- Web/PWA manual PRIVATE CRUD remains usable for non-friends;
- non-friends receive a non-blocking "加入 AFTERTRACE LINE 好友" reminder with add-friend link/QR when configured;
- OA friendship unlocks LINE-native capture/edit/navigation but does not own the Web account/data;
- later OA follow must not duplicate FREE_INITIAL.

Branch commits already made toward this behavior include:

- `e4745a147415825bd224b19bb3f04e853772b0ce`
- `50a020556657454af26d50d04fa8b25cd58965f3`
- `a9901064c16046448ab772e9d058c873b76f11b7`

These onboarding changes still require local typecheck/tests + Dev API redeploy/runtime verification after the latest checkout.

The add-friend QR/link UI still needs the actual/configured OA add-friend URL, preferably exposed as a public Web build variable such as `VITE_LINE_OA_ADD_URL` rather than hard-coded source data.

## Web/PWA `AI 幫我記` — accepted product/development contract

Web/PWA will provide explicit AI-assisted Record creation even if LINE remains the primary usage surface.

Reason: LINE and Web should share AI business logic rather than maintain duplicate implementations.

Accepted architecture:

- shared AI interpretation/normalization pipeline for LINE and Web;
- same Source authorization, Entity/title/Alias resolution, ambiguity handling, AI point ledger, provider-cost accounting and Record persistence;
- surface/channel is audit/analytics metadata, e.g. `LINE_AI_CREATE` vs `PWA_AI_CREATE`, not a separate domain model;
- first Web AI input type is text;
- future Web voice/image/PDF may reuse the same pipeline.

Accepted Web interaction:

1. user chooses `AI 幫我記`;
2. enters natural-language text;
3. positive eligible AI balance required before provider execution;
4. shared AI pipeline produces normalized title/content/time/ambiguity result;
5. Web displays preview/confirmation;
6. user explicitly confirms before Record commit;
7. cancel does not create a Record;
8. provider usage already incurred for preview still consumes points;
9. unchanged accepted preview must commit without a second provider call.

Implementation requirement: split/reuse the existing AI path so interpretation and durable commit are separable enough for preview-first Web UX without forking the core logic.

## Durable docs updated for the new decisions

The current product/development contracts now explicitly include onboarding + Web AI behavior in:

- `WORKLOG_PRODUCT_SPEC.md`
- `WORKLOG_AI_POINT_POLICY.md`
- `WORKLOG_DEVELOPMENT_POLICY.md`
- this handoff.

## Stable completed foundation — do not redo without regression

Previously validated foundation includes:

- API/Web/Admin TypeScript and local tests from earlier checkpoints;
- Drizzle baseline generation/guard;
- Source/Grant integrity constraints;
- free PWA manual CRUD/search/filter/title move/batch move/delete/restore/history;
- GROUP manual authorization = active membership;
- deterministic LINE history navigation;
- Reply-targeted LINE AI edit;
- attachment extraction -> durable text;
- positive-balance preflight + atomic reservation;
- actual provider cost -> AI points + subsidy accounting;
- configurable Gemini model identifier;
- payment-disabled checkout and unshipped Export fail closed.

Do not claim old green runs validate newly modified onboarding/Web-AI code until those changes are actually executed.

## Immediate next validation/development order

1. Pull latest branch.
2. Run API typecheck + targeted onboarding/record tests locally; do not use GitHub Actions.
3. Deploy Dev API and verify LINE Login now bootstraps a non-OA-friend Web account successfully.
4. Confirm `/api/v1/worklog/surfaces` returns PRIVATE surface plus friendship status for the login-created user.
5. Confirm FREE_INITIAL is issued once at the current Admin-configured amount and not duplicated by later OA follow.
6. Add/configure non-friend OA add-friend prompt + QR/link in Web and smoke it.
7. Continue PRIVATE manual CRUD smoke.
8. Implement shared interpretation/commit seam and Web `AI 幫我記` preview-first API/UI.
9. Validate point reservation/provider cost/commit idempotency for Web AI.
10. Continue real LINE/Gemini/PWA end-to-end smoke.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **DEV API/ADMIN/WEB BASELINE GREEN; NEW LOGIN-BOOTSTRAP + WEB AI WORK REMAINS TO VALIDATE/IMPLEMENT.**
