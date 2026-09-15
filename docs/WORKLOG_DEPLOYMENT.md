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

workers.dev subdomain: `after-lab`.

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

Core runtime bindings include database, AI provider, Web auth/origins, Google/LINE Login, Web Push and Admin auth/session/origin configuration. LINE Messaging credentials are not part of the target runtime.

## NewebPay / 藍新 configuration

Optional paid-subscription bindings:

- `NEWEBPAY_MERCHANT_ID`;
- `NEWEBPAY_HASH_KEY`;
- `NEWEBPAY_HASH_IV`;
- `NEWEBPAY_MODE` (`TEST` or `PROD`);
- `NEWEBPAY_PERIOD_VERSION`;
- `NEWEBPAY_PERIOD_TIMES`;
- `NEWEBPAY_NOTIFY_URL`;
- `NEWEBPAY_RETURN_URL`.

Secrets/config live only in the API Worker. When NewebPay config is absent, FREE/manual and non-payment behavior remains available while paid checkout reports unavailable.

## Backend-driven paid plans

Paid plan availability is database-driven.

A customer-visible plan must be an enabled, AI-enabled `SUBSCRIPTION` plan with positive monthly price, monthly AI point cap and provider-cost cap. Customer Web/PWA must not filter by an exact code such as `AI_PRO`.

NewebPay checkout flow:

1. customer chooses a backend plan;
2. Web sends `planCode`, payer Email and idempotency request key;
3. API reloads that plan from PostgreSQL and validates it is currently purchasable;
4. API stores the selected plan code in `worklog_checkout_intents`;
5. NewebPay `ProdDesc` and `PeriodAmt` are built from the selected DB plan rather than hard-coded values;
6. callback resolves the plan through the checkout intent;
7. provider amount is validated against the selected plan price;
8. ACTIVATE / RENEW lifecycle writes the exact plan code into subscription/history/Grant state;
9. paid AI entitlement reads limits from the user's actual active plan;
10. cancellation stops future renewal but preserves access through the current paid period end.

Only one active paid subscription is permitted per user. After the paid period expires, the user may start a new checkout for any currently available plan.

NewebPay Period currently uses an integer TWD recurring amount. For online purchase, plan price must therefore be a positive integer TWD value. Do not silently round a fractional Admin price.

## Product authorization boundaries

- PRIVATE manual data: authorized user only;
- GROUP manual data: current AFTERTRACE group member/role only;
- manual Web/PWA CRUD is independent from AI subscription;
- provider-backed AI entitlement is per requesting user;
- GROUP has no AI funding-owner binding;
- provider-backed operations must pass current entitlement/resource/provider-cost checks.

## Cloudflare Cron / notifications

The API Worker has one shared scheduled handler. `apps/api/wrangler.toml` currently uses:

```text
*/5 * * * *
```

It handles scheduled announcements, task reminders and pending Web Push delivery in bounded work. Do not create one Cron per task. PUSH failure must not remove durable in-app notification state.

Handwritten notification SQL must use the current varchar/text domain representation. Do not cast values to removed PostgreSQL application ENUM types.

## Database / canonical baseline policy during prelaunch

Authoritative Drizzle export is `apps/api/src/db/schema-all.ts`.

During the disposable prelaunch stage:

- canonical schema is one `drizzle/0000_worklog_baseline.sql`;
- Drizzle schema/baseline/metadata stay aligned;
- table/column comments remain mandatory;
- no PostgreSQL application-domain ENUM or business CHECK constraints;
- clean rebuild is preferred over compatibility migration when Dev/prelaunch data is explicitly disposable.

### Complete clean reset

A real reset must clear both public application data and Drizzle migration history:

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
```

Then deploy API first:

```text
pnpm deploy:dev:api
```

Do not reset the DB merely for the backend-driven subscription refactor; it uses the existing generic plan/subscription/checkout/lifecycle columns and requires no schema change.

## AI runtime

Before provider execution, runtime checks either:

- remaining one-time FREE AI experience points; or
- an active paid subscription entitlement.

FREE trial may be used across supported AI functions, not only AI Search. Paid resource and provider-cost caps come from the user's active subscription plan. Internal compatibility enum/source names may still say `AI_PRO`, but commercial filtering must never depend on the exact plan code `AI_PRO` or price 99.

## API liveness/readiness

- `GET /health` = Worker liveness;
- `GET /health/ready` = schema/config/runtime readiness.

Readiness requires:

- target schema availability;
- AI runtime model/pricing/FX;
- valid FREE plan;
- at least one valid enabled paid subscription plan compatible with current online billing;
- FREE AI trial configuration;
- required Web Push/auth/Admin bindings.

It no longer requires an exact `AI_PRO` row at NT$99.

## Validation before deploy

Use local validation, never GitHub Actions unless explicitly requested:

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Passing static/unit validation does not replace real Dev smoke for Web/PWA auth, DB, AI provider, plan catalog, NewebPay TEST callback/cancel and push.

## Dynamic subscription runtime smoke

After API + Web deployment verify at minimum:

1. an Admin-created enabled plan such as `AI_PRO_99` appears on `/subscription`;
2. display name, price and monthly point cap match Admin;
3. selecting it sends that exact `planCode` to checkout;
4. NewebPay TEST page receives the DB amount/product description;
5. callback activates the same plan code;
6. entitlement/provider-cost checks use that plan's configured caps;
7. cancellation preserves access until current period end;
8. after expiry, a new checkout can select any enabled paid plan.

## Admin security

Admin login remains the only unauthenticated Admin API surface. Dev/Prod credentials and secrets should be distinct where practical. CORS origins are exact per environment.

GitHub Actions must not be used as deployment or validation unless the user explicitly requests it.
