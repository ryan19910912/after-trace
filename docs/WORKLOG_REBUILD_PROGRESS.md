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

## Current checkpoint — 2026-09-06 typed plan rebuild + Admin 500 repair in progress

Cloudflare deployment remains manual with six explicit Workers:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`.
- Prod: corresponding `*-prod` Workers.

Environment inputs remain `.env.local` local-only, `.env.dev` Dev, `.env.prod` Prod. API deploy migrates the selected DB, uploads only whitelisted runtime bindings, deploys exact Worker name, deletes temporary secrets file, and verifies health/readiness.

## Previously runtime-verified before the current schema change

- Dev API deployment/migration/upload — PASS.
- Dev API runtime bindings — present.
- `/health` — PASS.
- `/health/ready` — reached bootstrap blockers correctly, then returned `ready` after Admin configured AI runtime + FREE under the previous plan schema.
- Dev Admin Worker deployed and opened successfully.
- Admin login works.
- AI runtime accepted `GOOGLE + gemini-3.5-flash-lite` after removal of the stale model allowlist.
- Current model id is runtime configuration; provider adapter remains GOOGLE-specific.
- Local API/Web/Admin startup/browser open were previously PASS.
- Admin/Web time-display work previously standardized presentation to Asia/Taipei `yyyy-MM-dd HH:mm:ss` while DB/API remain UTC/ISO.

## Real Dev issue discovered after readiness was green

Admin **使用者** and **群組** pages both returned `ADMIN_API_INVALID_RESPONSE_500`.

`wrangler tail after-trace-api-dev` showed real database query failures for:

- `GET /api/v1/admin/users?sort=DESC`
- `GET /api/v1/admin/groups`

The tail output also showed a separate stale Cloudflare scheduled invocation every minute:

```text
* * * * *
Error: Handler does not export a scheduled() function
```

These are separate issues:

1. Users/Groups 500 = Admin SQL/Dev schema compatibility problem.
2. Cron error = Dashboard has a stale `* * * * *` Cron Trigger even though AFTERTRACE does not currently define an intentional scheduled handler in repository Wrangler config.

The stale Cron Trigger should be removed from Cloudflare Dashboard; do not add an empty `scheduled()` merely to silence it.

## Root cause / repair direction for Admin 500

The prelaunch baseline had previously been regenerated while keeping the same `0000_worklog_baseline` migration identity. A Dev DB that already recorded the older `0000` can therefore remain schema-drifted even when migration reports success. The old readiness probe did not touch enough Admin-required fields/tables, so it could return a false green.

Current branch repairs:

- Admin Users/Groups query parameters now use explicit text casts for nullable prepared values.
- `/admin/users` and `/admin/groups` catch DB failures, write the underlying exception to Worker logs, and return structured JSON `ADMIN_USERS_QUERY_FAILED` / `ADMIN_GROUPS_QUERY_FAILED` instead of an opaque non-JSON 500.
- readiness schema probe now touches current Source/member/subscription/plan/Grant-scope/reservation structures and current plan fields so an obsolete DB should fail with `WORKLOG_DATABASE_OR_SCHEMA_UNAVAILABLE` rather than appear ready.

Because the accepted commercial plan schema changed in the same round, Dev DB should be rebuilt once from the regenerated baseline rather than patching the old disposable schema piecemeal.

## Commercial plan model changed — accepted current contract

Admin plan management now has exactly three types:

### 免費制 / `FREE`

- exactly one `code=FREE`;
- cannot add a second FREE;
- cannot delete FREE;
- Admin may edit it;
- price fixed at 0;
- `grant_points` = **首次贈送 AI 點數**;
- new eligible user receives current configured value once as `FREE_INITIAL`;
- no calendar refresh;
- existing FREE Grants never resize when the template changes.

The old source constant `FREE_INITIAL_AI_POINTS = 400_000` is removed. 400,000 may remain the current operator-entered launch value, but it is no longer hard-coded product behavior.

### 訂閱制 / `SUBSCRIPTION`

- Admin can add/edit/disable/delete when unused;
- `grant_points` = **訂閱週期 AI 點數**;
- each successful period/renewal freezes current template amount into a separate immutable `SUBSCRIPTION_PERIOD` Grant;
- existing Grants never change when template changes.

### 買斷制 / `ONE_TIME`

- Admin can add/edit/disable/delete when unused;
- `grant_points` = **購買可得 AI 點數**;
- one successful purchase later creates one immutable one-time/TOP_UP Grant;
- no recurring refresh and not assignable through subscription lifecycle.

Deletion of a non-FREE template fails closed when durable subscriptions/history/checkout facts still reference it; disabling is the fallback.

## Admin UI for plans — current branch changes

方案管理 now has internal tabs:

- 免費制
- 訂閱制
- 買斷制

Behavior:

- 免費制 shows only FREE and no delete action.
- 訂閱制 shows add/edit/delete for subscription templates.
- 買斷制 shows add/edit/delete for one-time products.
- point field label changes by type: 首次贈送 / 訂閱週期 / 購買可得 AI 點數.
- ONE_TIME products are excluded from the user subscription assignment dropdown.

These UI changes are committed but have not yet been built/runtime-verified after the current round.

## Workers Logs

`apps/api/wrangler.toml` now explicitly enables persisted Workers Logs + invocation logs:

```toml
[observability]
enabled = true

[observability.logs]
enabled = true
invocation_logs = true
```

This takes effect on the next API deployment. `wrangler tail` remains available for live debugging.

## Baseline status — IMPORTANT

TypeScript schema has changed from the old plan columns to:

- `worklog_plan_type` enum: `FREE | SUBSCRIPTION | ONE_TIME`
- `worklog_subscription_plans.plan_type`
- `worklog_subscription_plans.grant_points`

The obsolete `subscription_period_points` column is now forbidden by the baseline guard.

**The checked-in Drizzle SQL/snapshot/journal have NOT yet been regenerated after this current schema change.** Do not deploy the new API yet.

Required next operator step from an updated checkout:

```text
pnpm db:baseline:regenerate --confirm-prelaunch-reset
pnpm db:baseline:guard
```

Never hand-edit Drizzle snapshot metadata.

After regeneration succeeds, the generated `drizzle/` artifacts must be committed to the branch before deployment.

## Dev DB rebuild requirement

After regenerated baseline is committed, recreate/reset the disposable **Dev** PostgreSQL schema/database so the old recorded `0000_worklog_baseline` cannot mask schema changes. Then deploy Dev API against that fresh schema.

Do not reset Prod merely because Dev is being rebuilt. Prod remains prelaunch but should only be touched after Dev is green and the intended Prod reset is explicitly performed.

## Expected Dev bootstrap after reset

1. Fresh baseline migration.
2. Deploy Dev API.
3. `/health` -> `ok`.
4. `/health/ready` -> likely `AI_RUNTIME_CONFIG_NOT_INITIALIZED` first because business rows were wiped.
5. Deploy/open Dev Admin if needed.
6. Re-enter AI runtime pricing/model.
7. Configure FREE:
   - code FREE
   - type FREE
   - price 0
   - enabled
   - desired first-grant `grant_points` (e.g. 400000 if still desired)
8. `/health/ready` -> `ready`.
9. Verify Admin Users/Groups return structured successful responses rather than 500.
10. Continue Dev Web deployment/runtime smoke.

## Stable completed foundation — do not redo without regression

Previously verified before latest schema/UI hotfixes:

- install frozen lockfile;
- API/Web/Admin TypeScript;
- ESLint;
- API Vitest 42 files / 240 tests;
- Admin Vitest 3 files / 11 tests;
- Web passWithNoTests;
- API Worker dry-run;
- Web/Admin production builds;
- baseline regeneration/guard;
- Drizzle schema export;
- fresh Neon migration;
- fresh PostgreSQL Source/Grant integrity probes;
- Source-scoped case-insensitive Entity/Alias uniqueness;
- free PWA CRUD/search/filter/title move/batch move/delete/restore/history;
- GROUP manual authorization = active membership;
- deterministic LINE history navigation;
- Reply-targeted LINE AI edit;
- attachment extraction -> durable text;
- positive-balance preflight + atomic reservation;
- actual provider cost -> AI points + subsidy accounting;
- configurable Gemini model identifier;
- payment-disabled checkout and unshipped Export fail closed.

Do not claim these old green runs validate the current typed-plan/schema/UI changes.

## Current validation status

The latest typed-plan schema/API/Admin UI/readiness/logging/test/doc changes have **not** been executed locally by the assistant and have not been runtime-verified.

Immediate validation order after baseline artifacts are regenerated/committed:

1. API/Admin TypeScript typecheck.
2. targeted/new Vitest or full local tests as practical.
3. baseline guard.
4. fresh Dev DB migration.
5. `pnpm deploy:dev:api`.
6. `/health` and `/health/ready` bootstrap.
7. `pnpm deploy:dev:admin`.
8. Admin Users/Groups/Plans/AI browser smoke.
9. real Gemini/LINE/PWA smoke.
10. Dev Web deploy only after API/Admin are green.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **DEV REBUILD REQUIRED — DO NOT DEPLOY CURRENT SCHEMA UNTIL DRIZZLE BASELINE IS REGENERATED AND DEV DB IS FRESH.**
