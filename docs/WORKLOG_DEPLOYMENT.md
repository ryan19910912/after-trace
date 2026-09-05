# AFTERTRACE Deployment Baseline

Durable deployment contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE uses three logical Worker surfaces in each shared environment. Do not reintroduce Cloudflare Pages.

Actual Cloudflare Worker names are explicit and already created:

### Dev

- `after-trace-api-dev` — Hono / TypeScript API Worker.
- `after-trace-web-dev` — React/Vite customer PWA through Workers Static Assets.
- `after-trace-admin-dev` — React/Vite internal Admin through Workers Static Assets.

### Prod

- `after-trace-api-prod` — Hono / TypeScript API Worker.
- `after-trace-web-prod` — React/Vite customer PWA through Workers Static Assets.
- `after-trace-admin-prod` — React/Vite internal Admin through Workers Static Assets.

Configs remain:

- API: `apps/api/wrangler.toml`.
- Web: `apps/web/wrangler.toml` with `not_found_handling = "single-page-application"`.
- Admin: `apps/admin/wrangler.toml` with `not_found_handling = "single-page-application"`.

The customer-facing brand remains `AFTERTRACE`; the hyphenated names are infrastructure/deployment slugs only.

Manual deployment is the accepted operating model. `pnpm deploy:dev` and `pnpm deploy:prod` pass the exact Wrangler `--name` target for each Worker. Do not depend on Wrangler automatically appending `-dev` or `-prod`, and do not enable automatic Git branch deployment unless the user explicitly changes this policy.

## Product authorization boundaries that deployment must preserve

- PRIVATE manual data: current PRIVATE user only.
- GROUP manual data: active Source member only.
- Manual PWA read/create/edit/delete/restore/title move/batch move is free and independent from subscription/AI funding.
- GROUP Source existence is independent from AI 額度負責人.
- GROUP AI requires current AI 額度負責人 + active requesting member + eligible user-owned Grant scope.
- PRIVATE AI requires positive eligible user-owned Grant points for that PRIVATE Source.
- AI CREATE/EDIT/media eligibility is **not** a plan-capability gate. Retired flags such as `privateOaRecording`, `aiTextRecording`, and `aiMediaIngestion` must not return as a second entitlement system.
- `worklog_workspaces.owner_user_id` is transitional storage only; it is never GROUP data authority/payment responsibility/AI 額度負責人.
- Customer/Project/Finance/Transaction/category/normalized-summary must not return as universal Worklog schema.

## Environment configuration source

**Cloudflare deployed Workers do not read repository `.env.local`, `.env.dev`, or `.env.prod` directly at request time.**

Repository files are operator/deployment inputs:

- `.env.local` — local development/tooling only.
- `.env.dev` — authoritative input for manual Dev deployment tooling and Dev API runtime bindings.
- `.env.prod` — authoritative input for manual Prod deployment tooling and Prod API runtime bindings.

For API deployment, the root manual deploy script whitelists only the required API runtime keys from the selected `.env.dev` / `.env.prod`, writes them to a temporary JSON secrets file, passes that file to `wrangler deploy --secrets-file`, and deletes the temporary file immediately after deployment. The whole environment file is never uploaded. `VITE_API_BASE_URL` remains deployment/build input only and is not uploaded as an API runtime binding.

This makes the selected root environment file the single operator source for both migration and API Worker runtime configuration, while still keeping Dev and Prod isolated. Manual dashboard duplication is not required for the normal root deploy flow.

Required API bindings include:

- `DATABASE_URL` — runtime PostgreSQL connection.
- `LINE_CHANNEL_SECRET` — secret.
- `LINE_CHANNEL_ACCESS_TOKEN` — secret.
- `GEMINI_API_KEY` — secret.
- `WEB_APP_URL` — exact deployed Web HTTPS origin for the same environment.
- `WEB_APP_ORIGIN` — same exact Web HTTPS origin.
- `WEB_AUTH_SECRET` — >= 32 chars, secret.
- `LINE_LOGIN_CHANNEL_ID` — public identifier, uploaded as a protected Worker binding by the manual deploy flow.
- `LINE_LOGIN_CHANNEL_SECRET` — secret.
- `ADMIN_USERNAME` — configured Admin identity, uploaded as a protected Worker binding by the manual deploy flow.
- `ADMIN_PASSWORD` — **at least 8 characters**; Dev/Prod should still use distinct non-reused values.
- `ADMIN_SESSION_SECRET` — >= 32 characters, secret.
- `ADMIN_WEB_ORIGIN` — exact deployed Admin HTTPS origin for the same environment.

Do not put API secrets in `VITE_*` variables.

Web/Admin use the public build-time API origin `VITE_API_BASE_URL`.

## Deployment helper target variables

- `VITE_API_BASE_URL` = the single canonical API Worker base URL used by Web/Admin builds and deployment helpers in the selected environment.
- `DATABASE_URL` = the intended PostgreSQL URL for that environment. The same value is used by deployment migration and uploaded as the API Worker runtime binding by the root manual deploy flow.

`AFTERTRACE_API_URL` and `AFTERTRACE_PROD_DATABASE_URL` are intentionally not used.

The manual deploy script loads only the selected `.env.dev` or `.env.prod`, validates `VITE_API_BASE_URL`, `WEB_APP_URL`, `WEB_APP_ORIGIN`, and `ADMIN_WEB_ORIGIN`, rejects an obvious Dev/Prod host mismatch, validates minimum secret/password shape, migrates the same selected database, and deploys the API with the whitelisted runtime binding set.

Post-deploy verification is part of API manual deployment:

- `/health` must return liveness `ok`;
- `/health/ready` must return `ready`, or on a first fresh environment may temporarily return only `AI_RUNTIME_CONFIG_NOT_INITIALIZED` or `FREE_PLAN_NOT_INITIALIZED` while Admin bootstrap is still pending;
- runtime binding/schema failures remain deployment failures.

## workers.dev launch direction

A purchased custom domain is not required for initial launch.

Expected Dev shape:

- API: `https://after-trace-api-dev.a0955625660.workers.dev`
- Web: `https://after-trace-web-dev.a0955625660.workers.dev`
- Admin: `https://after-trace-admin-dev.a0955625660.workers.dev`

Expected Prod shape:

- API: `https://after-trace-api-prod.a0955625660.workers.dev`
- Web: `https://after-trace-web-prod.a0955625660.workers.dev`
- Admin: `https://after-trace-admin-prod.a0955625660.workers.dev`

## Manual Dev / Prod deployment commands

Standard commands:

```text
pnpm deploy:dev
pnpm deploy:prod
```

Per-component commands:

```text
pnpm deploy:dev:api
pnpm deploy:dev:web
pnpm deploy:dev:admin
pnpm deploy:prod:api
pnpm deploy:prod:web
pnpm deploy:prod:admin
```

The deployment script:

1. loads the selected `.env.dev` or `.env.prod` as authoritative process values;
2. validates `VITE_API_BASE_URL`, `WEB_APP_URL`, `WEB_APP_ORIGIN`, and `ADMIN_WEB_ORIGIN` against the exact selected workers.dev names when using workers.dev;
3. applies the selected environment's PostgreSQL migration before API deployment;
4. whitelists the required API runtime bindings and deploys them together with API code through Wrangler `--secrets-file`;
5. deletes the temporary secrets JSON immediately after the Wrangler command;
6. deploys with explicit `wrangler deploy --name after-trace-<component>-<environment>` targets;
7. verifies API liveness/readiness after API deployment.

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

The checked-in baseline must remain coherent with the current TypeScript schema and pass the baseline guard before migration/deployment.

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

1. Apply the regenerated baseline to the intended environment DB.
2. Ensure the selected `.env.dev` / `.env.prod` has all required API runtime values.
3. Run the root API deploy command; it migrates, uploads the whitelisted runtime bindings, deploys API code, then checks liveness/readiness.
4. On a first fresh DB, readiness may temporarily report only `AI_RUNTIME_CONFIG_NOT_INITIALIZED` or `FREE_PLAN_NOT_INITIALIZED`; this means API is live but Admin bootstrap is still required.
5. Deploy/open Admin against that API.
6. Initialize DB-backed AI runtime pricing through Admin `/ai-runtime` with the chosen provider/model/pricing/FX snapshot. `output_usd_per_million` must be positive.
7. Create/enable the `FREE` plan through Admin with:
   - code `FREE`;
   - price `0`;
   - `subscription_period_points = 0` because the frozen one-time 400,000 FREE Grant is provisioned separately by bootstrap;
   - no stale AI capability flags.
8. Configure PRO/TEAM only with explicitly approved/Admin-entered point amounts. Do not invent them during migration.
9. Recheck `/health/ready` until it returns `ready`. **Do not expose the product publicly while first-environment bootstrap remains not-ready.**

The API/Admin routes remain available while readiness is 503 specifically so first-deploy operator configuration can be completed. A readiness 503 is not equivalent to Worker liveness failure.

## FREE vs subscription-period point display

The FREE plan shell correctly has `subscription_period_points = 0`; FREE does not have a monthly allowance.

Customer plan API/UI must expose the frozen launch acquisition grant separately:

- FREE `one_time_initial_points = 400000`;
- one-time only;
- no calendar refresh;
- no calendar expiry;
- bootstrap provisions the actual durable Grant idempotently.

PRO/TEAM cards use `subscription_period_points` because their included points are created per successful paid renewal. Do not show FREE as “0 AI points” merely because its recurring-template field is zero.

## API liveness vs launch readiness

- `GET /health` = Worker liveness only and must not require eager DB/Gemini runtime initialization.
- `GET /health/ready` = launch readiness and must remain reachable even when bindings are incomplete, so it can report a diagnosable 503 instead of Cloudflare Error 1101.

Readiness fails with HTTP 503 when any required launch binding is missing/invalid, Admin password is shorter than the configured 8-character minimum, rebuilt schema probes fail, AI runtime pricing row is absent/invalid, or the frozen FREE plan shell is not initialized correctly.

The schema probe touches rebuilt-only Entity/Alias/Revision/Confirmation/Grant/AI charge/subsidy/responsibility structures. Checking `worklog_users` alone is insufficient because obsolete schema may also contain that table.

Readiness validates configured shape/presence, not external-provider credential correctness. LINE and Gemini still require real smoke tests.

## Local release preflight

From a clean current checkout using the pinned pnpm version:

```text
pnpm install --frozen-lockfile
pnpm release:preflight
```

`release:preflight`:

- loads root `.env.local` then `.env` only for local tooling;
- requires an actual HTTPS `VITE_API_BASE_URL` pointing to the deployed API Worker;
- uses that same `VITE_API_BASE_URL` for Web/Admin production builds;
- runs baseline guard;
- API/Web/Admin TypeScript typecheck;
- ESLint;
- Vitest;
- Worker/Web/Admin production builds / Worker dry-run;
- Drizzle schema export.

It deliberately does **not** migrate or deploy.

Passing preflight is necessary but not sufficient. Fresh PostgreSQL and runtime smoke remain mandatory.

## Legacy production helpers

`worker-deploy.ps1`, `web-worker-deploy.ps1`, and `admin-worker-deploy.ps1` remain production-oriented helpers. Their checked-in Wrangler default names point to the `*-prod` Workers. The preferred two-environment workflow is the root `pnpm deploy:dev*` / `pnpm deploy:prod*` command family above.

## LINE AI zero-balance boundary

Both GROUP and PRIVATE LINE AI paths follow the same product rule:

- QUERY/history navigation remains free;
- direct CREATE and quoted attachment processing require positive eligible points before starting the AI path;
- Reply EDIT resolves the deterministic Record target first, then checks positive eligible points before invoking the editor;
- the point ledger still performs the final atomic reservation immediately before provider execution, so a preflight check is not treated as a balance lock;
- if eligible points are zero at request start, no provider call starts and manual PWA remains available.

PRIVATE uses the current user's PRIVATE-scoped Grants; GROUP uses the current AI 額度負責人 and explicitly scoped Grants.

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

AI availability is Grant-backed, not gated by plan feature flags. The retired `privateOaRecording`, `aiTextRecording`, and `aiMediaIngestion` keys are removed from current Admin capability definitions and stripped from customer plan payloads if stale prelaunch JSON still contains them.

When payment integration is later enabled, it must add idempotent recurring success/failure handling, successful-payment facts, renewal Grant creation, TOP_UP purchase identity, refunds according to approved policy, and no raw card storage.

Do not infer realized revenue from plan list price/current subscription state.

## Export launch state

Product spec still defines Export as MVP and initially paid, but the current branch does not yet contain the customer export endpoint/UI.

`export` remains the only current non-AI plan capability definition and is marked unshipped/fail-closed. Admin must reject `export=true` until the actual export surface and entitlement tests exist, and customer plan payloads must not advertise it as active.

GROUP data authorization must remain active-membership based; any paid export entitlement must not be confused with AI 額度負責人 unless a later explicit product decision says otherwise.

This is a **paid/full-MVP gap**, distinct from the free/manual Worklog + AI-recording launch path.

## Admin security

- Admin login is the only unauthenticated Admin API.
- `ADMIN_PASSWORD` minimum length is 8 characters. This is the accepted MVP operator policy; Dev/Prod should still use distinct non-reused values.
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
- Admin login/CORS and configured credential validation;
- LINE Login callback and one-time Web entry;
- PRIVATE manual access isolation;
- GROUP active-member manual access and inactive-member denial;
- manual create/edit/version/move/batch/delete/restore/revisions;
- FREE 400,000 one-time Grant idempotency and customer display;
- PRIVATE/GROUP zero-point preflight and provider-overrun subsidy;
- GROUP AI responsibility + Grant scope authorization;
- CREATE/HISTORY/Reply EDIT + both Pending Confirmation operations;
- LINE cached TEXT TTL/cap and expired Reply handling;
- LINE image/audio/file size/202/expired flows;
- Gemini usage/pricing snapshots;
- Admin `/profitability` browser smoke;
- Web deep-link smoke;
- Workers dry-run/runtime smoke.

## External configuration still required

- actual Dev/Prod Cloudflare workers.dev hosts;
- `.env.dev` / `.env.prod` with complete matching runtime values and DB migration targets;
- LINE OA webhook and LINE Login callback URLs for each environment;
- LINE OA Rich Menu;
- initialized AI runtime pricing row;
- initialized FREE plan;
- payment provider for paid launch;
- paid Export implementation for full MVP paid capability.
