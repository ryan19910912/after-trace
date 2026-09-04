# AFTERTRACE Deployment Baseline

Durable deployment contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE deploys as three independent Cloudflare Workers.

### aftertrace-api

- Hono / TypeScript Worker.
- LINE webhook, Worklog runtime, auth/session, Web/Admin/subscription APIs, AI grant/point/provider orchestration and PostgreSQL/Drizzle.
- Config: `apps/api/wrangler.toml`.
- Production helper: `worker-deploy.ps1`.

### aftertrace-web

- React + Vite customer Web/PWA served with Workers Static Assets.
- Config: `apps/web/wrangler.toml`.
- Customer records, free manual create/edit/delete/restore/search/filter/title move/batch move, AI point usage/settings/history, subscription/top-up, export, help and feedback.

### aftertrace-admin

- React + Vite internal Admin served with Workers Static Assets.
- Config: `apps/admin/wrangler.toml`.
- Users/groups/plans/grants/usage/subsidy, AI pricing/profitability, anomalies, feedback, payment/subscription operations and audit.

Do not reintroduce Cloudflare Pages for this branch.

## Web / LINE destinations

Typical Web paths:

- `/help` → 使用教學
- `/` → 查看紀錄
- `/subscription` → 方案／付款訂閱
- `/feedback` → 意見回饋

Admin includes `/profitability` for the factual AI point/provider-cost report.

Both Web and Admin Workers use Cloudflare Static Assets with `not_found_handling = "single-page-application"`. Production deployment helpers must verify representative deep links after deploy so a homepage-only success cannot hide broken SPA routing.

LINE-created Record edit links should use short-lived/scoped Web-entry tokens that resolve to the exact Record and Source authorization; do not expose raw unauthenticated Record ids as authorization.

LINE history/navigation links may carry deterministic non-secret filters such as title/entity id, keyword and date range after normal authenticated/scoped entry is established.

## Manual group access vs AI funding

Deployment/runtime validation must preserve the product boundary:

- active GROUP members can use manual PWA functions without a subscription, legacy Owner or AI allowance responsible user;
- GROUP Source existence and membership are data authorization facts;
- group AI requires a valid **AI 額度負責人** plus an eligible user-owned grant allowed for that group;
- AI funding/eligibility must never be used to hide an otherwise authorized group's manual records.

Legacy Owner/subscription authorization code is transitional only and must not become the production manual-access contract.

## Subscription / checkout boundary

- Enabled plans are exposed through authenticated subscription APIs.
- Provider-neutral checkout intent exists.
- Payment provider remains undecided.
- Paid MONTHLY plans require recurring authorization and idempotent renewal success/failure handling.
- Only confirmed renewal success creates the next subscription-period AI grant.
- Monthly included points do not roll over.
- FREE is ONE_TIME, grants **400,000 AI points once**, has no calendar refresh and no calendar expiry under the current launch policy.
- One-time top-ups create independent grants rather than mutating a single aggregate subscription balance.
- Never store raw card data.

## Admin authentication

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET` (>= 32 chars)
- `ADMIN_WEB_ORIGIN`

Only Admin login is unauthenticated; all other Admin APIs require the HMAC bearer session. Do not put API secrets into `VITE_*` variables.

## AI runtime

- `GEMINI_API_KEY` remains server-side only.
- Current selected worklog model/pricing configuration is DB-backed and must retain immutable pricing snapshots for historical usage.
- Customer allowance is AI points; **1 AI point = 1 output-price-equivalent token**.
- Actual provider input/output/thinking/modality cost is converted to points using the request's pricing snapshot and output-token reference price.
- Historical provider cost remains immutable.
- Thinking usage and modality-specific usage must be accounted exactly once.
- If a request starts with positive eligible points but exceeds remaining balance, customer charge floors at the remaining balance and the shortfall is recorded as platform subsidy.

## Architecture rules

- Keep API/Web/Admin independently deployable.
- Do not merge frontend apps into API merely to reduce Worker count.
- No SSR unless a real requirement appears.
- API secrets stay on API Worker.
- Web/Admin receive public build-time config only, mainly `VITE_API_BASE_URL`.
- Customer/Project/Finance must not reappear as universal Worklog domain requirements.

## Database integrity rules for launch

The fresh prelaunch baseline must encode the accepted Source/Grant boundaries as database constraints, not merely application conventions:

- a `PRIVATE` Source has `private_user_id` and no `line_group_id`; a `GROUP` Source has `line_group_id` and no `private_user_id`;
- PRIVATE Web-entry nonce `(user_id, source_id)` must resolve to that user's PRIVATE Source;
- Entity Alias, Record title Entity, Pending Confirmation Record/candidate Entity, LINE AI edit Record/confirmation/applied Entity and attachment-created Record cannot cross Source boundaries;
- LINE AI edit and attachment reservation tokens must belong to the same Source as their orchestration row;
- reservation/usage funding cannot pair a Grant with a `grant_scope_id` owned by another Grant;
- attachment ingestion uses `worklog_ai_point_reservations`; the retired aggregate-quota schema/reservation must never return.

`scripts/check-worklog-baseline.mjs` must require these constraints by name in both regenerated SQL and Drizzle snapshot. A missing constraint is launch-blocking even when application code currently performs an equivalent check.

The historical `worklog_workspaces.owner_user_id` remains a transitional storage parent only. It is not GROUP manual authorization and not AI funding responsibility.

## workers.dev launch direction

A purchased custom domain is not required for the first deployment. The current launch/dev direction is to use Cloudflare-provided `workers.dev` hosts for all three Workers until a later explicit domain purchase decision.

Expected shape:

- API: `https://after-trace-api.<account-subdomain>.workers.dev`
- Web: `https://aftertrace-web.<account-subdomain>.workers.dev`
- Admin: `https://aftertrace-admin.<account-subdomain>.workers.dev`

Configure exact deployed hosts into:

- API `WEB_APP_URL` / `WEB_APP_ORIGIN` → Web Worker host;
- API `ADMIN_WEB_ORIGIN` → Admin Worker host;
- Web/Admin build-time `VITE_API_BASE_URL` → API Worker host;
- LINE webhook/login callbacks → the API/Web workers.dev URLs as applicable.

Do not hard-code an account subdomain in the repository before the actual Cloudflare account deployment confirms it.

Deployment helpers follow the same rule:

- `worker-deploy.ps1` reads the target API URL from `AFTERTRACE_API_URL` or explicit `-WorkerUrl`;
- `web-worker-deploy.ps1` and `admin-worker-deploy.ps1` read the API origin from `AFTERTRACE_API_URL` or explicit `-ApiOrigin`;
- a missing/invalid target URL must fail deployment rather than silently falling back to an old account hostname.

## Prelaunch database / migration policy

AFTERTRACE is not live yet. The user has explicitly confirmed that both development and production databases may be destructively rebuilt while the schema is being finalized.

Current checked-in migration files are:

- `drizzle/0000_worklog_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

**These checked-in baseline/snapshot files are currently known stale and MUST NOT be applied.** They still contain pre-rebuild Customer/Project/Transaction/category/aggregate-AI structures and do not represent the accepted Source + Entity/Alias + Record/Revision/Confirmation + Grant model.

`apps/api/src/db/schema-all.ts` is the authoritative Drizzle schema export surface. `drizzle.config.ts` must point to that single export so newly split schema modules cannot be silently omitted and deleted compatibility modules cannot be retained.

Local API development uses repository-root `.env.local`. Drizzle tooling must read the same `.env.local` first, with `.env` only as a compatibility fallback, so local runtime and migration commands do not silently use different `DATABASE_URL` values.

### Safe baseline regeneration

Baseline generation is a schema-only operation and does **not** require `DATABASE_URL`. Database credentials are required only when a command actually connects to PostgreSQL, such as migration/apply validation.

After confirming the repository is still prelaunch/disposable and there is no production migration history to preserve, regenerate with:

```text
pnpm db:baseline:regenerate --confirm-prelaunch-reset
```

`scripts/regenerate-worklog-baseline.mjs` is intentionally destructive but fail-closed:

- it refuses to run without the explicit `--confirm-prelaunch-reset` flag;
- it refuses to delete the migration directory if files other than the expected prelaunch `0000_worklog_baseline.sql` + two metadata files are present;
- it backs up the entire current `drizzle` directory before deletion;
- it generates from `apps/api/src/db/schema-all.ts` through the project-pinned Drizzle Kit;
- it immediately runs `pnpm db:baseline:guard` logic against the generated artifacts;
- if **Drizzle generation itself** fails or leaves an unusable partial artifact set, the previous `drizzle` directory is restored in full;
- if generation succeeds but the AFTERTRACE guard finds a real product/schema drift, the generated artifacts are intentionally **kept for inspection** while the command still exits non-zero and deployment remains blocked. Do not restore the known-stale baseline merely to hide that drift.

Do not bypass these checks by manually deleting unexpected migrations. Unexpected migration files mean the prelaunch reset assumption must be reviewed first.

Before any migration or API Worker deployment:

1. Regenerate `0000_worklog_baseline.sql`, `meta/0000_snapshot.json`, and `_journal.json` together using the safe command above.
2. Inspect the generated diff and run `pnpm db:baseline:guard` again. The guard must see exactly one coherent prelaunch baseline, all launch integrity constraints listed above, and no retired Customer/Project/Transaction/category/aggregate-quota/recording markers.
3. If the regeneration command stopped on a guard failure, inspect and fix the **kept generated artifacts/schema mismatch**, regenerate again, and do not continue to database apply until the guard passes.
4. Configure `DATABASE_URL` for a **fresh disposable PostgreSQL database** and apply the regenerated baseline.
5. Run schema drift / SQL validation and exercise the Grant reservation/settlement plus Record revision/confirmation paths against PostgreSQL.
6. Only after database validation should the migration set be considered deployable.

Do not hand-edit or fabricate Drizzle snapshot metadata merely to make the guard pass.

### Current rule

- Old dev/prod migration history does **not** need reconciliation merely to preserve empty/non-live environments.
- If an environment was created from an obsolete migration history, drop/recreate or otherwise rebuild it from the newly regenerated prelaunch baseline.
- New schema work may destructively replace/refactor the prelaunch baseline without carrying Customer/Project/Finance or aggregate-quota compatibility solely for empty databases.
- Before any destructive reset, confirm that there is still no real user/business data that must be preserved.
- Once the service is live with real production data, this rule ends immediately: migrations then become forward-only and destructive reset is no longer acceptable.

## Local release preflight

Before any production deployment, run from a clean checked-out current branch with the pinned pnpm version:

```text
pnpm install --frozen-lockfile
pnpm release:preflight
```

`pnpm release:preflight` first parses the root `packageManager` pin and compares it with `pnpm --version`. A missing pin or different executable version fails before validation, so a release cannot silently run with a different pnpm than the lockfile contract.

The command is intentionally non-deploying/non-migrating. It must fail fast if any of these do not pass locally/runtime:

1. Worklog baseline/snapshot/journal guard;
2. API/Web/Admin TypeScript typecheck;
3. ESLint;
4. Vitest;
5. API Worker dry-run plus Web/Admin production builds;
6. Drizzle schema export from `schema-all.ts`.

Passing this command is necessary but **not sufficient** for launch: PostgreSQL migration/application and browser/LINE/Gemini smoke still have to run separately.

`worker-deploy.ps1` also runs the stale-baseline guard before dependency install/build/test so a known-invalid baseline fails immediately.

## API liveness vs readiness

The API exposes two operational checks:

- `GET /health` → Worker process/liveness only. It may return `ok` even if launch secrets or the database schema are missing.
- `GET /health/ready` → launch readiness. It verifies required production bindings/origins/secrets and queries the rebuilt `worklog_users` table. Missing config, unreachable DB, or unapplied/stale Worklog schema returns HTTP 503.

Production-facing origin bindings must be exact HTTPS origins: no credentials, path, query or hash. `WEB_APP_URL` and `WEB_APP_ORIGIN` must resolve to the same origin, otherwise readiness fails before database access.

The API production deployment helper must require **both** liveness and readiness after deployment. A Worker that deployed successfully but fails `/health/ready` is not considered launched.

The readiness check validates presence/shape, not secret correctness against external providers. LINE Login, LINE Messaging and Gemini still need real runtime smoke.

## Post-deploy SPA checks

When `-ExpectedUrl` is supplied:

- `web-worker-deploy.ps1` verifies `/`, `/help`, and `/subscription`;
- `admin-worker-deploy.ps1` verifies `/` and `/profitability`.

These checks exist to catch broken Static Assets SPA fallback/deep links. They do not replace authenticated browser flows.

## External configuration still required

1. Actual Cloudflare account `workers.dev` subdomain / deployed hosts.
2. `WEB_APP_URL` / `WEB_APP_ORIGIN`.
3. `ADMIN_WEB_ORIGIN`.
4. `AFTERTRACE_API_URL` (or explicit deployment-script URL argument).
5. API secrets/vars for Admin, LINE, Gemini and DB.
6. Web/Admin builds with correct `VITE_API_BASE_URL`.
7. LINE OA Rich Menu configuration.
8. Payment provider selection and recurring-payment lifecycle implementation.
9. Final database rebuild from the then-current regenerated migration baseline before launch.
10. Concentrated local build/typecheck/test/schema/migration/browser/Worker/LINE/Gemini validation.

## Validation expectations before launch

Validate locally/runtime, not through GitHub Actions unless explicitly requested:

- `pnpm release:preflight` with the exact pinned pnpm version;
- `pnpm db:baseline:guard` against the regenerated migration artifacts;
- fresh database migration from current repository journal;
- schema drift plus explicit Source/Grant integrity constraint inspection;
- attempt representative invalid cross-Source Record/Entity/confirmation/attachment/LINE-edit writes and confirm PostgreSQL rejects them;
- attempt mismatched Grant/grant-scope and Source/reservation attribution and confirm PostgreSQL rejects them;
- `/health` and `/health/ready` after API deploy;
- Admin authentication/CORS;
- Web deep links and scoped Record-edit links;
- private manual Record access restricted to the owning user;
- group manual browse/create/edit/delete/restore available to active group members without subscription/Owner/AI funding gates;
- inactive/removed group members denied group data access;
- AI 額度負責人 absence/transfer/rejoin/takeover behavior;
- FREE 400,000 one-time point grant semantics;
- independent subscription-period and top-up grant semantics where implemented;
- zero-balance provider preflight and overage/platform-subsidy accounting;
- paid MONTHLY renewal semantics once provider integration exists;
- LINE TEXT/Reply-TEXT/image/audio/PDF/file flows;
- real Gemini thinking/modality usage and provider-cost/point snapshots;
- Web `/`, `/help`, `/subscription` direct navigation;
- Admin `/`, `/profitability` direct navigation;
- XLSX/DOCX extraction resource limits when Office support is implemented;
- export authorization once export is implemented.

No GitHub Actions workflow may be used as a substitute for these checks unless the user explicitly requests it.
