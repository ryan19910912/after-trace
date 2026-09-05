# AFTERTRACE Deployment Baseline

Durable deployment contract for branch `revive/line-worklog`.

## Deployment topology

Cloudflare Workers only. Do not reintroduce Pages.

### Dev

- `after-trace-api-dev`
- `after-trace-web-dev`
- `after-trace-admin-dev`

### Prod

- `after-trace-api-prod`
- `after-trace-web-prod`
- `after-trace-admin-prod`

workers.dev subdomain: `a0955625660`.

Manual deployment is the accepted operating model. Root commands target exact Worker names; do not enable automatic Git branch deployment unless explicitly requested.

## Commands

```text
pnpm deploy:dev
pnpm deploy:prod

pnpm deploy:dev:api
pnpm deploy:dev:web
pnpm deploy:dev:admin
pnpm deploy:prod:api
pnpm deploy:prod:web
pnpm deploy:prod:admin
```

## Environment input

Repository environment files are deployment/operator inputs, not request-time files inside Cloudflare:

- `.env.local` — local development only.
- `.env.dev` — Dev migration/deploy/API runtime source.
- `.env.prod` — Prod migration/deploy/API runtime source.

API deployment loads exactly the selected environment file, validates the expected workers.dev origins, applies DB migration, uploads only the required whitelisted API bindings through a temporary Wrangler secrets file, deletes that temporary file, deploys to the exact Worker name, then checks health/readiness.

Required API runtime bindings include:

- `DATABASE_URL`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GEMINI_API_KEY`
- `WEB_APP_URL`
- `WEB_APP_ORIGIN`
- `WEB_AUTH_SECRET` >= 32
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` >= 8
- `ADMIN_SESSION_SECRET` >= 32
- `ADMIN_WEB_ORIGIN`

Web/Admin use public build-time `VITE_API_BASE_URL`. Do not put API secrets in `VITE_*` variables.

## workers.dev URLs

Dev:

- API `https://after-trace-api-dev.a0955625660.workers.dev`
- Web `https://after-trace-web-dev.a0955625660.workers.dev`
- Admin `https://after-trace-admin-dev.a0955625660.workers.dev`

Prod uses the corresponding `*-prod` hosts.

## Wrangler exposure / observability

Each Worker explicitly uses `workers_dev = true` and `preview_urls = false`.

API Worker observability/logging is checked into `apps/api/wrangler.toml`:

```toml
[observability]
enabled = true

[observability.logs]
enabled = true
invocation_logs = true
```

This enables persisted Workers Logs after the next API deployment. `wrangler tail` remains useful for live debugging; persisted Workers Logs allow later lookup when a failure happened while no tail session was open.

A Cloudflare **Cron Trigger is unrelated to logging**. If Dashboard has a stale `* * * * *` Cron while the Worker has no intentional scheduled workload/`scheduled()` handler, remove that stale Trigger rather than adding an empty handler. Repository Wrangler config currently does not define an AFTERTRACE cron schedule.

## Product authorization boundaries

- PRIVATE manual data: current PRIVATE user only.
- GROUP manual data: active Source member only.
- Manual PWA CRUD/title operations are free and independent from subscription/AI funding.
- GROUP Source existence is independent from AI 額度負責人.
- GROUP AI requires active requesting member + current AI 額度負責人 + eligible user-owned Grant scoped to that GROUP.
- PRIVATE AI requires positive eligible user-owned Grant for the PRIVATE Source.
- Retired AI capability flags must not return as a second entitlement system.

## Prelaunch database policy

AFTERTRACE is not live yet. Dev/prod databases may be destructively rebuilt while schema is finalized. Once real production data exists, immediately switch to forward-only migrations.

Authoritative Drizzle export: `apps/api/src/db/schema-all.ts`.

Current baseline artifacts:

- `drizzle/0000_worklog_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

Never hand-fabricate snapshot metadata.

After an accepted prelaunch schema change, regenerate using:

```text
pnpm db:baseline:regenerate --confirm-prelaunch-reset
pnpm db:baseline:guard
```

If the environment DB already recorded an older `0000_worklog_baseline`, merely rerunning migration may not apply the changed baseline. For a disposable prelaunch Dev DB, reset/recreate the Dev schema/database and then apply the regenerated baseline once. This is especially important after changing existing baseline columns such as plan fields.

## Current commercial plan schema

`worklog_subscription_plans` uses:

- `plan_type`: `FREE | SUBSCRIPTION | ONE_TIME`
- `grant_points`: generic template amount

Meaning:

- FREE -> initial one-time points
- SUBSCRIPTION -> per successful subscription period
- ONE_TIME -> per successful one-time purchase

The obsolete `subscription_period_points` column is no longer canonical.

Exactly one FREE plan is required:

- `code = FREE`
- `plan_type = FREE`
- `price_twd = 0`
- `enabled = true`
- `grant_points` = explicit Admin-configured first-grant amount (0 or greater; operator currently may choose 400,000)

FREE `grant_points` is **not hard-coded**. Changing it affects only users who have not already received `FREE_INITIAL`.

## First fresh-database bootstrap

1. Apply the current regenerated baseline.
2. Deploy API with complete environment bindings.
3. `/health` must return `ok`.
4. `/health/ready` may temporarily return `AI_RUNTIME_CONFIG_NOT_INITIALIZED` or `FREE_PLAN_NOT_INITIALIZED` only while Admin bootstrap is pending.
5. Deploy/open Admin.
6. Configure AI runtime provider/model/pricing/FX through `/ai-runtime`; output reference price must be positive.
7. Configure FREE in Admin with the invariant above and the desired initial `grant_points`.
8. Recheck `/health/ready` until `ready`.
9. Only then continue Web/runtime smoke.

Readiness schema probe must cover current plan fields plus current Source/Grant/reservation structures. It must fail when an obsolete DB schema is missing fields required by Admin/runtime; a shallow false-green readiness is not acceptable.

## API liveness vs readiness

- `GET /health` = Worker liveness only.
- `GET /health/ready` = launch/runtime/schema/bootstrap readiness.

Readiness must remain diagnosable without eager Worklog/Gemini construction. It validates local configuration/schema/business-config shape, not external LINE/Gemini credential correctness; real provider smoke is still required.

## Admin list API failures

Admin Users/Groups database query failures must return JSON errors (`ADMIN_USERS_QUERY_FAILED` / `ADMIN_GROUPS_QUERY_FAILED`) and log the underlying exception to Worker logs. Frontend should not receive an opaque non-JSON `ADMIN_API_INVALID_RESPONSE_500` when the API can return a structured server error.

## Local release preflight

```text
pnpm install --frozen-lockfile
pnpm release:preflight
```

Preflight includes baseline guard, API/Web/Admin TypeScript, ESLint, Vitest, builds/dry-run, and Drizzle schema export. It deliberately does not migrate/deploy. Passing preflight is necessary but runtime/fresh-DB smoke is still required.

## LINE attachment operational limits

- Original LINE binaries are never permanently stored.
- Image default max 10 MiB.
- General attachment default max 20 MiB.
- LINE content 202 never reaches Gemini as bytes.
- Missing `Content-Length` does not disable streaming limits.

## Checkout / paid launch state

Payment provider remains unselected/unimplemented and checkout stays disabled. When enabled later:

- SUBSCRIPTION successful renewals create `SUBSCRIPTION_PERIOD` Grants.
- ONE_TIME successful purchases create one-time/TOP_UP Grants.
- FREE never requires checkout.
- payment handling must be idempotent, store no raw card data, and retain successful-payment/refund facts.

## Export launch state

Paid Export remains intended MVP functionality but is currently unshipped/fail-closed. Do not advertise it as active until endpoint/UI/entitlement tests exist.

## Admin security

Admin login is the only unauthenticated Admin API surface. Dev/Prod credentials/secrets must be distinct where practical. CORS origins are exact per environment.

GitHub Actions must not be used as deployment or validation unless the user explicitly requests it.
