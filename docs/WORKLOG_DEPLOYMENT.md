# AFTERTRACE Deployment Baseline

Durable deployment contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE deploys as three independent Cloudflare Workers. Do not reintroduce Cloudflare Pages.

### `after-trace-api`

- Hono / TypeScript Worker.
- LINE webhook, auth/session, Worklog APIs, Admin APIs, subscription boundary, Grant/point/provider orchestration and PostgreSQL/Drizzle.
- Config: `apps/api/wrangler.toml`.
- Production helper: `worker-deploy.ps1`.

### `aftertrace-web`

- React/Vite customer PWA through Workers Static Assets.
- Config: `apps/web/wrangler.toml`.
- `not_found_handling = "single-page-application"` is required so authenticated/history deep links survive direct refresh.

### `aftertrace-admin`

- React/Vite internal Admin through Workers Static Assets.
- Config: `apps/admin/wrangler.toml`.
- Includes `/profitability` factual AI point/provider-cost reporting.
- `not_found_handling = "single-page-application"` is required.

## Product authorization boundaries that deployment must preserve

- PRIVATE manual data: current PRIVATE user only.
- GROUP manual data: active Source member only.
- Manual PWA read/create/edit/delete/restore/title move/batch move is free and independent from subscription/AI funding.
- GROUP Source existence is independent from AI 額度負責人.
- GROUP AI requires current AI 額度負責人 + active requesting member + eligible user-owned Grant scope.
- `worklog_workspaces.owner_user_id` is transitional storage only; it is never GROUP data authority/payment responsibility/AI 額度負責人.
- Customer/Project/Finance/Transaction/category/normalized-summary must not return as universal Worklog schema.

## Production configuration source

**Cloudflare production Workers do not read repository `.env.local` or `.env`.**

Repository `.env.local` is local development/tooling input only.

Production API Worker values come from Cloudflare Worker Variables/Secrets plus checked-in non-secret `wrangler.toml` values.

Required API production bindings include:

- `DATABASE_URL` — Cloudflare secret for the runtime production database.
- `LINE_CHANNEL_SECRET` — secret.
- `LINE_CHANNEL_ACCESS_TOKEN` — secret.
- `GEMINI_API_KEY` — secret.
- `WEB_APP_URL` — exact deployed Web HTTPS origin.
- `WEB_APP_ORIGIN` — same exact Web HTTPS origin.
- `WEB_AUTH_SECRET` — >= 32 chars, secret.
- `LINE_LOGIN_CHANNEL_ID` — public variable.
- `LINE_LOGIN_CHANNEL_SECRET` — secret.
- `ADMIN_USERNAME` — configured Admin identity.
- `ADMIN_PASSWORD` — **at least 16 characters**, use a unique random production value.
- `ADMIN_SESSION_SECRET` — >= 32 chars, secret.
- `ADMIN_WEB_ORIGIN` — exact deployed Admin HTTPS origin.

Do not put API secrets in `VITE_*` variables.

Web/Admin use only public build-time config, primarily `VITE_API_BASE_URL`.

## Deployment helper target variables

- `AFTERTRACE_API_URL` = actual deployed API Worker HTTPS origin.
- `AFTERTRACE_PROD_DATABASE_URL` = explicit PostgreSQL URL used by **production migration**.

`worker-deploy.ps1` must never silently use repository `.env.local` as the production migration target. It requires `AFTERTRACE_PROD_DATABASE_URL` or explicit `-DatabaseUrl` and temporarily sets that value as `DATABASE_URL` only around the migration command.

The runtime Worker `DATABASE_URL` secret must point to the intended production database as well. Post-deploy readiness is expected to catch missing/unmigrated runtime DB state, but operators must still verify the migration URL and Worker secret identify the same intended environment.

## workers.dev launch direction

A purchased custom domain is not required for initial launch.

Expected shape:

- API: `https://after-trace-api.<account-subdomain>.workers.dev`
- Web: `https://aftertrace-web.<account-subdomain>.workers.dev`
- Admin: `https://aftertrace-admin.<account-subdomain>.workers.dev`

Do not hard-code one account subdomain into source/deployment defaults before the actual Cloudflare account confirms it.

## Web / LINE destinations

Typical customer paths:

- `/` — Worklog records.
- `/help` — help.
- `/subscription` — plan/subscription surface.
- `/feedback` — feedback.

LINE history links carry only deterministic non-secret filters such as `entityId`, `q`, `from`, `to` after a scoped authenticated entry is established.

Bot Web-entry tokens are short-lived/one-time and must resolve exact PRIVATE/GROUP context; raw Record ids are never authorization.

## Prelaunch database policy

AFTERTRACE is not live yet. Development/production DBs may still be destructively rebuilt while finalizing schema. Once real production data exists, immediately switch to forward-only migration policy.

Current migration artifacts are:

- `drizzle/0000_worklog_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

`apps/api/src/db/schema-all.ts` is the authoritative Drizzle export surface.

**The currently checked-in baseline/snapshot are known stale until regenerated and MUST NOT be applied.** The stale baseline still contains retired pre-rebuild structures.

### Safe baseline regeneration

After confirming prelaunch/disposable state:

```text
pnpm db:baseline:regenerate --confirm-prelaunch-reset
```

The regeneration script:

- requires the explicit reset flag;
- refuses unexpected extra migration artifacts;
- backs up the old `drizzle/` directory;
- generates from `schema-all.ts` using the project-pinned Drizzle Kit;
- restores the old set only when generation itself fails;
- when generation succeeds but the AFTERTRACE guard detects drift, keeps generated artifacts for inspection and exits non-zero;
- never fabricates snapshot metadata by hand.

Then run:

```text
pnpm db:baseline:guard
```

The guard must verify one coherent `0000_worklog_baseline` SQL/snapshot/journal set, accepted rebuilt tables/accounting facts/integrity constraints, and absence of retired Customer/Project/Transaction/category/aggregate-quota/recording markers.

## Database integrity launch requirements

Fresh PostgreSQL must enforce Source/Grant boundaries in constraints, not only application code. At minimum validate:

- PRIVATE vs GROUP Source identity shape;
- Entity/Alias/Record/Confirmation Source consistency;
- LINE AI edit Record/confirmation/applied Entity Source consistency;
- attachment-created Record and reservation Source consistency;
- Grant scope belongs to its Grant;
- usage/reservation funding cannot attribute another Grant's scope;
- attachment and LINE AI edit use `worklog_ai_point_reservations`, never retired aggregate quota reservations.

Entity/Alias case-insensitive matching vs database uniqueness must be reproduced against the fresh PostgreSQL schema before launch. Do not guess a collation/index migration from static inspection alone.

## First fresh-database bootstrap

A migration creates schema, not business/operator configuration.

Before `/health/ready` can become green on a brand-new DB:

1. Apply the regenerated baseline to the intended production DB.
2. Configure API Worker Variables/Secrets.
3. Deploy API Worker (liveness may work while readiness is still 503).
4. Initialize DB-backed AI runtime pricing through Admin `/ai-runtime` with the chosen provider/model/pricing/FX snapshot. `output_usd_per_million` must be positive.
5. Create/enable the `FREE` plan through Admin with:
   - code `FREE`;
   - price `0`;
   - `subscription_period_points = 0` because the frozen one-time 400,000 FREE Grant is provisioned separately by bootstrap;
   - desired non-paid capabilities.
6. Configure PRO/TEAM only with explicitly approved/Admin-entered point amounts. Do not invent them during migration.
7. Recheck `/health/ready` until it returns `ready`.

The API/Admin routes remain available while readiness is 503 specifically so first-deploy operator configuration can be completed. A readiness 503 is not equivalent to Worker liveness failure.

## API liveness vs launch readiness

- `GET /health` = Worker liveness only.
- `GET /health/ready` = launch readiness.

Readiness fails with HTTP 503 when any required launch binding is missing/invalid, Admin password is weaker than the configured minimum, rebuilt schema probes fail, AI runtime pricing row is absent/invalid, or the frozen FREE plan shell is not initialized correctly.

The schema probe touches rebuilt-only Entity/Alias/Revision/Confirmation/Grant/AI charge/subsidy/responsibility structures. Checking `worklog_users` alone is insufficient because the obsolete baseline also contained that table.

Readiness validates configured shape/presence, not external-provider credential correctness. LINE and Gemini still require real smoke tests.

## Local release preflight

From a clean current checkout using the pinned pnpm version:

```text
pnpm install --frozen-lockfile
pnpm release:preflight
```

`release:preflight`:

- loads root `.env.local` then `.env` only for local tooling;
- requires an actual HTTPS `AFTERTRACE_API_URL`;
- forces `VITE_API_BASE_URL` to that production API origin for Web/Admin production builds;
- runs baseline guard;
- API/Web/Admin TypeScript typecheck;
- ESLint;
- Vitest;
- Worker/Web/Admin production builds / Worker dry-run;
- Drizzle schema export.

It deliberately does **not** migrate or deploy.

Passing preflight is necessary but not sufficient. Fresh PostgreSQL and runtime smoke remain mandatory.

## Production helpers

### API

`worker-deploy.ps1` must:

1. require main/clean tree unless explicitly overridden;
2. reject stale baseline immediately;
3. install from lockfile unless skipped;
4. typecheck/lint/test/build;
5. export Drizzle schema;
6. require explicit production migration URL (`AFTERTRACE_PROD_DATABASE_URL` / `-DatabaseUrl`);
7. migrate that explicit DB;
8. deploy API Worker;
9. verify `/health`;
10. verify `/health/ready`.

### Web

`web-worker-deploy.ps1` builds with the explicit API origin and, when `-ExpectedUrl` is supplied, verifies:

- `/`
- `/help`
- `/subscription`

### Admin

`admin-worker-deploy.ps1` builds with the explicit API origin and verifies:

- `/`
- `/profitability`

These Static Assets checks catch broken SPA fallback but do not replace authenticated browser smoke.

## LINE attachment operational limits

Original LINE attachment binaries are never permanently stored.

- Image default max: 10 MiB.
- General attachment default max: 20 MiB.
- LINE `202` is a transient not-ready state and never reaches Gemini as bytes.
- Missing `Content-Length` does not disable the limit: the resolver reads the response stream incrementally and cancels as soon as the configured byte ceiling is crossed.

## Subscription / checkout launch state

Payment provider remains intentionally unselected/unimplemented.

While checkout is disabled:

- `/subscription` shows plans but paid buttons are disabled as `尚未開放`;
- `POST /checkout-intents` fails closed with `CHECKOUT_NOT_ENABLED` before persistence;
- no unusable `PENDING_PROVIDER` rows should be created by customer traffic.

When payment integration is later enabled, it must add idempotent recurring success/failure handling, successful-payment facts, renewal Grant creation, TOP_UP purchase identity, refunds according to approved policy, and no raw card storage.

Do not infer realized revenue from plan list price/current subscription state.

## Export launch state

Product spec still defines Export as MVP and initially paid, but the current branch does not yet contain the customer export endpoint/UI.

Do not advertise `export=true` on a launch plan until the actual export surface and entitlement checks are implemented and validated. GROUP data authorization must remain active-membership based; any paid export entitlement must not be confused with AI 額度負責人 unless a later explicit product decision says otherwise.

This is a **paid/full-MVP gap**, distinct from the free/manual Worklog + AI-recording launch path.

## Admin security

- Admin login is the only unauthenticated Admin API.
- `ADMIN_PASSWORD` minimum length is 16 characters; use a unique random production value rather than a human-reused password.
- `ADMIN_SESSION_SECRET` >= 32 characters.
- Admin bearer sessions expire (default 12h, max 24h).
- Admin Web origin must be an exact HTTPS origin.

A Cloudflare edge rate-limit/WAF rule for `/api/v1/admin/login` is recommended before broad public exposure. Do not implement unreliable per-isolate in-memory rate limiting and treat it as globally authoritative.

## Validation expectations before launch

Validate locally/runtime, never substitute GitHub Actions unless explicitly requested:

- regenerated baseline guard passes;
- fresh disposable PostgreSQL migration succeeds;
- schema drift/export matches current TypeScript schema;
- invalid cross-Source/Grant-scope writes are rejected by PostgreSQL;
- Entity/Alias case collision behavior is verified;
- `pnpm release:preflight` passes;
- `/health` and `/health/ready` after API deploy;
- Admin login/CORS and strong credential config;
- LINE Login callback and one-time Web entry;
- PRIVATE manual access isolation;
- GROUP active-member manual access and inactive-member denial;
- manual create/edit/version/move/batch/delete/restore/revisions;
- FREE 400,000 one-time Grant idempotency;
- GROUP AI responsibility + Grant scope authorization;
- zero-point preflight and provider-overrun subsidy;
- CREATE/HISTORY/Reply EDIT + both Pending Confirmation operations;
- LINE cached TEXT TTL/cap and expired Reply handling;
- LINE image/audio/file size/202/expired flows;
- Gemini usage/pricing snapshots;
- Admin `/profitability` browser smoke;
- Web deep-link smoke;
- Workers dry-run/runtime smoke.

## External configuration still required

- actual Cloudflare workers.dev hosts;
- Worker Variables/Secrets listed above;
- explicit production migration DB URL;
- LINE OA webhook and LINE Login callback URLs;
- LINE OA Rich Menu;
- initialized AI runtime pricing row;
- initialized FREE plan;
- payment provider for paid launch;
- paid Export implementation for full MVP paid capability.

No GitHub Actions workflow may be executed, dispatched, rerun, enabled, modified, or used as validation unless the user explicitly requests it.
