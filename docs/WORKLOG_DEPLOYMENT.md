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

Target API runtime requires Web/PWA auth, database, AI provider, notification PUSH and Admin bindings. LINE-specific bindings may remain temporarily during migration but are legacy and should be removed once no retained runtime depends on them.

Target core bindings include equivalents of:

- `DATABASE_URL`;
- `GEMINI_API_KEY` or configured provider credential;
- `WEB_APP_URL`;
- `WEB_APP_ORIGIN`;
- `WEB_AUTH_SECRET`;
- `WEB_PUSH_PUBLIC_KEY`;
- `WEB_PUSH_PRIVATE_KEY`;
- `WEB_PUSH_SUBJECT`;
- Admin auth/session/origin secrets.

Do not put API secrets in `VITE_*` variables. The manual deploy script selects the Web Push VAPID values from the environment-specific file and uploads them as API Worker bindings; no deployment is implied merely because source configuration exists.

## Product authorization boundaries

- PRIVATE manual data: authorized user only;
- GROUP manual data: current AFTERTRACE group member/role only;
- manual Web/PWA CRUD is independent from AI subscription;
- paid AI entitlement is per requesting user;
- GROUP does not require an AI responsible-user binding;
- provider-backed operations must pass current subscription/resource-cap checks.

## Cloudflare Cron for reminders / scheduled notifications

The API Worker has one shared `scheduled()` handler for the notification system. `apps/api/wrangler.toml` intentionally configures one approximately five-minute Cron Trigger:

```text
*/5 * * * *
```

The shared runtime processes bounded work in this order:

1. due scheduled ANNOUNCEMENTs;
2. due user-confirmed TASK reminders;
3. pending PUSH recipients.

Rules:

- one shared scheduler only;
- do not create one Cron Trigger per task;
- due scans and delivery are bounded;
- task reminder creation and push delivery are idempotent/retry-safe through durable state;
- Cloudflare Queue is optional later only when actual fan-out/volume justifies it;
- PUSH failure must not remove durable IN_APP notifications;
- the previously stale Dashboard `* * * * *` trigger is legacy and must not be recreated or mistaken for the accepted scheduler;
- Cron configuration is deployed only through the accepted manual Worker deployment flow; source presence is not runtime verification.

Dev and Prod currently share the source Cron cadence when their API Workers are manually deployed. If environment-specific cadence is needed later, split configuration deliberately rather than adding an extra task-level scheduler.

## PWA push

Target notification architecture includes durable Web Push subscriptions per user/browser installation and retry-safe delivery facts. Push failures/revocations must not corrupt tasks or notification-center data. Permanently invalid subscriptions are revoked independently from the AFTERTRACE account.

Notification permission must still be requested only from explicit user action in Web/PWA. Supported iOS/iPadOS PUSH assumes the installed Home Screen PWA path; denied/unsupported PUSH falls back to durable IN_APP behavior.

## Database / canonical baseline policy during prelaunch

Authoritative Drizzle export remains `apps/api/src/db/schema-all.ts`.

AFTERTRACE is currently prelaunch/test-stage and the user has explicitly confirmed that existing Dev and current Prod data are disposable. While that remains true:

- Dev and current prelaunch Prod may be dropped/recreated from a clean target schema;
- canonical `drizzle/0000` may be regenerated after accepted schema changes;
- clean baseline rebuild is preferred over compatibility migrations when it produces a simpler target architecture;
- legacy LINE-era test users, Records, Grants, runtime config and other disposable test data do not need preservation;
- after reset, recreate only explicit target seed/runtime configuration required by the current product;
- do not add migration complexity solely to preserve disposable prelaunch data.

Current target-schema work includes provider-neutral identities/public account ids, native groups/invites, manual Records, notifications/PUSH, native tasks/reminders, FREE one-time AI trial and AI Pro entitlement/cost caps.

Safety boundary: this destructive permission expires once real customers or durable production data exist. At that point, destructive Prod rebuilds require a new explicit user decision and the development/deployment policies must be updated before proceeding.

## AI subscription runtime

Before any provider call, runtime must check the current accepted entitlement source:

- eligible FREE one-time trial points; or
- active AI_PRO entitlement.

Then enforce the relevant capability/resource/cost boundaries:

- feature capability for the requested operation;
- remaining FREE trial points or AI Pro current-period point/resource cap;
- AI Pro current-period provider-cost hard cap;
- optional per-request/modality cap.

Provider usage/cost remains auditable. Customer UI does not expose internal provider pricing/margin or present trial points/provider-cost caps as TWD cash balances.

Launch commercial contract remains exactly FREE NT$0 + AI_PRO NT$99/month. Do not add one-time top-up products or extra paid tiers for V1.

## API liveness/readiness

- `GET /health` = Worker liveness;
- `GET /health/ready` = schema/config/runtime readiness.

Readiness should evolve with the target Web/PWA product and must not permanently require retired LINE credentials once legacy LINE runtime has been removed.

## Local release validation

Use local validation, never GitHub Actions unless explicitly requested.

```text
pnpm install --frozen-lockfile
pnpm release:preflight
```

Passing static/unit validation does not replace real Dev runtime smoke for Web/PWA auth, DB, AI provider, tasks or push.

## Payment / paid launch

Payment provider remains a separate implementation decision. When paid subscription is enabled, successful payment/renewal must create durable entitlement/period facts idempotently and must not store raw card data.

Deterministic payment/subscription state changes should emit idempotent SYSTEM notifications through the shared Notification Service rather than handwritten Admin messages.

## Admin security

Admin login remains the only unauthenticated Admin API surface. Dev/Prod credentials/secrets should be distinct where practical. CORS origins are exact per environment.

GitHub Actions must not be used as deployment or validation unless the user explicitly requests it.
