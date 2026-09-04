# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run, in this order:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- this file

The latest product/development documents above are the only product specification. Do not revive old Customer/Project/Finance/Owner/aggregate-quota assumptions from older code, migrations, or tests.

## Current execution checkpoint — 2026-09-04 final launch blocker / fail-closed production audit

This run continued from the latest Source/Grant DB-integrity checkpoint and **did not redo** the completed composite Source/Grant constraints, attachment quota-schema cleanup, PWA optimistic concurrency, LINE CREATE/HISTORY/Reply EDIT, Grant accounting, Admin profitability or migration guard work.

The goal was to find only concrete issues that could make a seemingly successful Workers deployment unsafe or misleading.

The run fixed several launch-level gaps:

- `/health/ready` no longer accepts the obsolete baseline merely because `worklog_users` exists; it probes rebuilt-only Entity/Alias/Revision/Confirmation/Grant/AI-charge/subsidy/responsibility structures;
- readiness also refuses a schema-only fresh DB until DB-backed AI runtime pricing is initialized and an enabled zero-price `FREE` plan shell exists;
- release preflight now requires the actual HTTPS `AFTERTRACE_API_URL` and forces Web/Admin production builds to use it as `VITE_API_BASE_URL`;
- Admin passwords now require at least 16 characters and readiness enforces the same rule;
- production migration no longer risks silently reading the local/dev `.env.local` database: `worker-deploy.ps1` requires explicit `AFTERTRACE_PROD_DATABASE_URL` / `-DatabaseUrl`;
- paid plan buttons and the checkout API both fail closed while the payment provider is disabled, preventing useless `PENDING_PROVIDER` intent growth;
- users with no effective paid subscription now see the FREE plan consistently marked as the current plan;
- LINE binary fetching is bounded while streaming even when LINE omits `Content-Length`, preventing an oversized unknown-length response from being fully buffered before the 10/20 MiB product limit is enforced;
- deployment documentation now distinguishes repository local env from Cloudflare production bindings and documents the first fresh-DB bootstrap sequence.

## Scanned this run

- all eight required durable documents;
- latest branch checkpoint after concurrent Source/Grant integrity work;
- API liveness/readiness and Worker routing;
- root release preflight and production deploy helpers;
- `.env.example` / `.gitignore` / Drizzle env behavior;
- Web/Admin Static Assets SPA fallback and representative deep links;
- subscription plan UI, provider-neutral checkout boundary and subscription effective-state handling;
- Admin auth/session configuration;
- Web LINE Login callback, bot-entry/session token lifecycle and open-redirect/token-removal behavior;
- FREE initial Grant bootstrap/idempotency;
- LINE content fetch size/202/expired behavior and attachment provider-settlement state machine;
- GROUP TEXT cache TTL/cap pruning;
- current export capability declaration vs actual customer export implementation;
- checked-in migration baseline state from the prior checkpoint.

## Files changed this run

Launch readiness / release safety:

- `apps/api/src/index.ts`
- `apps/api/src/index-readiness.test.ts`
- `scripts/release-preflight.mjs`
- `worker-deploy.ps1`
- `.env.example`

Admin security:

- `apps/api/src/admin/auth.ts`
- `apps/api/src/admin/auth.test.ts`

Subscription / payment fail-closed behavior:

- `apps/api/src/worklog/subscription-routes.ts`
- `apps/api/src/worklog/subscription-routes.test.ts` — new
- `apps/web/src/SubscriptionRoot.tsx`

LINE attachment safety:

- `apps/api/src/line/content.ts`
- `apps/api/src/line/content.test.ts`

Durable docs:

- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. Readiness cannot false-positive on the obsolete migration baseline

The known stale baseline also contains `worklog_users`, so the previous single-table readiness query was not a sufficient rebuilt-schema test.

`/health/ready` now probes rebuilt-only structures including:

- Entity/Alias;
- Revision/Pending Confirmation;
- AI Grants;
- `customer_points_charged`;
- `platform_subsidized_points`;
- GROUP AI responsibility.

A reachable PostgreSQL created from the old pre-rebuild baseline should therefore fail `WORKLOG_DATABASE_OR_SCHEMA_UNAVAILABLE` instead of reporting ready.

### 2. Fresh schema is not considered ready until operator configuration exists

Schema migration does not seed model pricing or commercial plan configuration.

Readiness now additionally requires:

- `worklog_ai_runtime_config.id = 1` with non-empty provider/model and positive output-token reference price;
- enabled `FREE` plan with price `0` and `subscription_period_points = 0`.

The one-time 400,000 FREE acquisition points remain provisioned separately by the idempotent bootstrap Grant flow; they are **not** recurring FREE plan-template points.

PRO/TEAM point amounts remain explicit Admin configuration and are not invented in migration/readiness code.

### 3. Release preflight builds frontends against the actual production API origin

`pnpm release:preflight` now:

- loads root `.env.local` / `.env` for local tooling only;
- requires a valid absolute HTTPS `AFTERTRACE_API_URL`;
- exports that value as `VITE_API_BASE_URL` before Web/Admin production builds.

This prevents a build from passing while the deployed frontend would contain a missing/local API base URL.

### 4. Production DB migration cannot silently use the local development DB

`worker-deploy.ps1` now requires:

- `AFTERTRACE_PROD_DATABASE_URL`, or
- explicit `-DatabaseUrl`.

It validates `postgresql://` / `postgres://`, temporarily sets that value as `DATABASE_URL` only for the migration command, and restores the previous process value afterwards.

A production deploy must not fall back to repository `.env.local` for migration.

`.env.example` documents local `DATABASE_URL` and production migration URL separately.

### 5. Admin credential configuration is stronger and internally consistent

`ADMIN_PASSWORD` now requires at least 16 characters in Admin auth configuration.

`/health/ready` uses the same minimum instead of accepting any non-empty password. Source tests cover the weak-password rejection contract.

Admin HMAC session behavior remains unchanged: default 12h, maximum 24h, session secret >=32 chars.

For broad public exposure, use a Cloudflare edge rate-limit/WAF rule for `/api/v1/admin/login`; do not rely on per-isolate in-memory counters as global protection.

### 6. Payment-disabled product state is now fail-closed at both UI and API

Payment provider is still intentionally unimplemented.

While disabled:

- paid plan buttons display `尚未開放` and cannot call checkout;
- `POST /checkout-intents` returns `503 CHECKOUT_NOT_ENABLED` **before database persistence**;
- direct authenticated API calls therefore cannot fill the DB with never-progressing `PENDING_PROVIDER` rows.

When there is no effective paid subscription, the FREE plan row is now marked `current=true`, matching `currentPlanCode = FREE` and customer UI wording.

### 7. LINE content limits are enforced while streaming

The existing product limits remain:

- image: 10 MiB;
- general attachment: 20 MiB.

Previously, when LINE omitted `Content-Length`, `response.arrayBuffer()` could buffer an arbitrarily large body before the application checked the final length.

The resolver now reads the body incrementally, tracks total bytes and cancels the stream immediately when the configured ceiling is exceeded. Original binaries remain in-memory only and are never persisted.

A focused test source covers chunked/no-Content-Length overflow. It has **not been executed** here.

### 8. Web auth/token lifecycle was re-audited and did not need changes

Confirmed current behavior:

- bot Web-entry tokens default to 5 minutes and max 15 minutes;
- entry nonce is durably consumed once;
- GROUP exchange re-checks actual LINE membership;
- PRIVATE entry revalidates PRIVATE Source access;
- Web session default TTL is 30 days and max 90 days;
- callback session hash and one-time `t` query token are removed from the browser URL after persistence/exchange;
- Rich Menu return destination is restricted to a local allowlist (`/subscription`, `/feedback`) rather than arbitrary redirect input.

### 9. GROUP TEXT cache cleanup was re-audited and did not need changes

Every remembered GROUP text triggers pruning that:

- removes all globally expired cache rows;
- keeps only the newest 1000 rows for that group.

Private ordinary text and attachment binaries remain outside this temporary cache as required.

## Stable completed foundation — do not redo without a real regression

- Source + single Entity/title + Alias + Record + immutable Revision + Pending Confirmation;
- DB-enforced Source identity and Source-scoped Entity/Record/Confirmation/LINE-edit/attachment relations;
- DB-enforced PRIVATE Web-entry Source ownership and Grant/grant-scope funding consistency;
- Customer/Project/Transaction/Finance/category/normalized-summary removed from customer core;
- free PWA manual CRUD/search/title move/batch move/delete/recycle/restore/revision history;
- GROUP manual authorization = active membership only;
- early route-level + final DB optimistic version checks;
- deterministic HISTORY filtered PWA links;
- deterministic Reply-targeted PRIVATE/GROUP LINE AI EDIT and bot-success reply mapping;
- title ambiguity durable confirmation without second AI charge;
- FREE 400,000 one-time user Grant;
- user-owned Grants/scopes/caps + separate GROUP AI 額度負責人;
- provider full-cost -> output-price-equivalent AI points;
- platform subsidy for post-start overage;
- subscription-period immutable/idempotent Grants;
- stale aggregate quota/`ai_units_consumed`/`actualUnits` removed from active accounting contract;
- factual Admin profitability;
- provider `reservationPoints` vocabulary;
- old Owner/group-paid-gate/recording-preference assumptions removed from current execution contract;
- safe baseline regeneration/guard;
- release preflight;
- API liveness/readiness split;
- Web/Admin SPA deep-link deployment checks;
- hard-coded workers.dev account hostname removed.

## Current hard blocker — checked-in baseline is still stale

The checked-in `drizzle/0000_worklog_baseline.sql` remains from the pre-rebuild world and MUST NOT be applied.

The latest TypeScript schema also includes the newer Source/Grant composite constraints from the preceding checkpoint, so manually editing old SQL/snapshot is especially unsafe.

The next useful work requires the actual pinned project toolchain.

## Remaining / blocking work

### 1. Regenerate baseline/snapshot/journal — primary launch blocker

From a real latest checkout:

1. `pnpm install --frozen-lockfile`
2. verify pinned `pnpm --version`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. fix real Drizzle errors/drift exposed by the new composite FKs/check constraints
6. `pnpm db:baseline:guard` until green

Do not hand-fabricate Drizzle snapshot metadata.

### 2. Apply to fresh PostgreSQL and validate invariants

Use a fresh disposable DB first. Validate:

- generated FK/check/index/type names;
- malformed PRIVATE/GROUP Source rejection;
- cross-Source Entity/Record/Alias/Confirmation/LINE-edit/attachment rejection;
- PRIVATE Web-entry user/Source mismatch rejection;
- reservation Source mismatch rejection;
- Grant/grant-scope attribution mismatch rejection;
- normal Record CRUD/revision/confirmation paths under those constraints;
- Grant reserve/commit/release/expire/subsidy/concurrency state.

Then initialize AI runtime config + FREE plan and confirm `/health/ready` becomes green.

### 3. Entity/Alias case-collision behavior

Runtime resolution uses case-insensitive `lower(...)` while current DB uniqueness is case-sensitive. Reproduce this against real PostgreSQL and choose the smallest normalization/index/collation fix only after observing actual behavior.

### 4. Run real release validation

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- authenticated PWA CRUD/version/group-membership browser/API smoke;
- Admin login + `/profitability`;
- LINE Login and one-time scoped entry;
- LINE CREATE/HISTORY/Reply EDIT/confirmation;
- attachment TEXT/image/audio/file limits/expiry/202;
- real Gemini pricing/usage/point settlement;
- API `/health` + `/health/ready`;
- Web/Admin deep links;
- Workers dry-run/runtime deploy checks.

### 5. Full paid MVP still has separate gaps

Payment provider, recurring payment success/failure, TOP_UP purchase lifecycle/refunds/proration remain intentionally unfinished and must not be invented from current plan state.

**Export is still defined by the product spec as MVP and initially paid, but the current branch has no customer export endpoint/UI.** Do not advertise `export=true` on launch plans until the feature and entitlement checks exist. GROUP export data authorization must remain active-membership based; do not conflate a paid export entitlement with AI 額度負責人 without an explicit product decision.

This means:

- free/manual + AI-recording launch path can be evaluated once the migration/runtime blockers are green;
- full paid-MVP launch is not complete until payment and paid Export scope are resolved/implemented.

## Next implementation target

Continue from this exact checkpoint. Do not redo the launch fail-closed fixes above or the DB integrity constraints from the preceding checkpoint.

Highest priority:

1. obtain/use a real latest checkout with pinned pnpm/Drizzle;
2. regenerate baseline immediately;
3. fix any actual TypeScript/Drizzle errors from the latest schema;
4. pass baseline guard;
5. apply to fresh PostgreSQL and execute integrity probes;
6. initialize AI runtime config + FREE plan;
7. run `pnpm release:preflight`;
8. run browser/LINE/Gemini/Worker smoke.

If local execution remains unavailable, only continue static audit for concrete launch blockers; do not broaden into speculative redesign.

## Validation status

This run performed source/document audit and direct GitHub source edits only.

No checked-out local project/toolchain became available in this environment, so source tests authored in this and prior batches were **not executed**.

**Not executed:**

- `pnpm install`;
- baseline regeneration/guard;
- release preflight;
- TypeScript typecheck;
- ESLint;
- Vitest;
- production builds/Worker dry-run;
- Drizzle generation/export/migration;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker deploy/runtime;
- LINE runtime;
- Gemini runtime.

Therefore no test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY yet.**

Static/source-level launch safety is substantially stronger, and the remaining blockers are now sharply defined. The decisive next step is no longer another broad refactor: it is real migration generation + PostgreSQL + preflight/runtime validation.

## Rough remaining work

Assuming the next environment has a current checkout/toolchain and disposable PostgreSQL:

- baseline regeneration + fix actual generated-schema/type errors: **1 focused batch**;
- fresh PostgreSQL/integrity/concurrency validation: **1 focused batch**;
- release preflight + browser/LINE/Gemini/Workers smoke: **1 focused validation batch**;
- payment + paid Export: separate full-paid-MVP work unless first public launch is explicitly scoped before those features.
