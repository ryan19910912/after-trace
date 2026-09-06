# AFTERTRACE Deployment Baseline

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

Manual deployment remains the accepted operating model. Do not enable automatic Git deployment or GitHub Actions unless explicitly requested.

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

- `.env.local` — local development only;
- `.env.dev` — Dev migration/deploy/runtime source;
- `.env.prod` — Prod migration/deploy/runtime source.

Target API runtime requires Web/PWA auth, database, AI provider and Admin bindings. LINE-specific bindings may remain temporarily during migration but are legacy and should be removed once no retained runtime depends on them.

Target core bindings include equivalents of:

- `DATABASE_URL`;
- `GEMINI_API_KEY` or configured provider credential;
- `WEB_APP_URL`;
- `WEB_APP_ORIGIN`;
- `WEB_AUTH_SECRET`;
- Admin auth/session/origin secrets.

Do not put API secrets in `VITE_*` variables.

## Product authorization boundaries

- PRIVATE manual data: authorized user only;
- GROUP manual data: current AFTERTRACE group member/role only;
- manual Web/PWA CRUD is independent from AI subscription;
- paid AI entitlement is per requesting user;
- GROUP does not require an AI responsible-user binding;
- provider-backed operations must pass current subscription/resource-cap checks.

## Cloudflare Cron for reminders

Task/reminder delivery may use one Cloudflare Worker Cron Trigger, initially at an interval such as every 5 minutes.

Rules:

- one shared scheduler scans due reminders in bounded batches;
- do not create one Cron Trigger per task;
- delivery is idempotent using durable notification state;
- if due volume grows, enqueue jobs to Cloudflare Queue and let a consumer deliver PWA push;
- Dev and Prod schedules may differ; avoid accidental production-like push from Dev;
- Cron execution is unrelated to Workers Logs.

The previously stale Dashboard `* * * * *` trigger is legacy and must not be mistaken for the new reminder scheduler. Add an intentional schedule only when the new `scheduled()` reminder implementation exists.

## PWA push

Target notification architecture may include durable Web Push subscriptions per user/device and task reminder delivery facts. Push failures/revocations must not corrupt tasks. Invalid subscriptions should be deactivated/removed safely.

## Database migration policy

Authoritative Drizzle export remains `apps/api/src/db/schema-all.ts`.

Preserve existing Dev/Prod databases through forward-compatible migrations whenever a safe mapping exists. Destructive rebuild is a last resort.

The product reset will likely require schema cleanup/additions for:

- optional AI metadata on Records;
- AFTERTRACE-native group invites/memberships;
- subscription resource/cost caps;
- tasks/reminders;
- push subscriptions/delivery state;
- removal or retirement of LINE-specific structures when safe.

Do not delete legacy LINE tables in the same step that introduces replacements unless retained data/dependencies have been reviewed.

## AI subscription runtime

Before any provider call, runtime must check:

- active paid AI entitlement;
- feature capability for the requested operation;
- current-period resource/point cap;
- current-period provider-cost cap;
- optional per-request/modality cap.

Provider usage/cost remains auditable. Customer UI does not expose internal provider pricing/margin.

## API liveness/readiness

- `GET /health` = Worker liveness;
- `GET /health/ready` = schema/config/runtime readiness.

Readiness should evolve with the target Web/PWA product and must not permanently require retired LINE credentials once LINE runtime has been removed.

## Local release validation

Use local validation, never GitHub Actions unless explicitly requested.

```text
pnpm install --frozen-lockfile
pnpm release:preflight
```

Passing static/unit validation does not replace real Dev runtime smoke for Web/PWA auth, DB, AI provider, tasks or push.

## Payment / paid launch

Payment provider remains a separate implementation decision. When paid subscription is enabled, successful payment/renewal must create durable entitlement/period facts idempotently and must not store raw card data.

## Admin security

Admin login remains the only unauthenticated Admin API surface. Dev/Prod credentials/secrets should be distinct where practical. CORS origins are exact per environment.

GitHub Actions must not be used as deployment or validation unless the user explicitly requests it.
