# AFTERTRACE Deployment Baseline

Durable deployment contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE deploys as three independent Cloudflare Workers.

### aftertrace-api

- Hono / TypeScript Worker.
- LINE webhook, Worklog runtime, auth/session, Web/Admin/subscription APIs, AI quota/provider orchestration and PostgreSQL/Drizzle.
- Config: `apps/api/wrangler.toml`.
- Production helper: `worker-deploy.ps1`.

### aftertrace-web

- React + Vite customer Web/PWA served with Workers Static Assets.
- Config: `apps/web/wrangler.toml`.
- Customer records, editing, customers/projects/finance, owner usage/member controls, subscription, export, help and feedback.

### aftertrace-admin

- React + Vite internal Admin served with Workers Static Assets.
- Config: `apps/admin/wrangler.toml`.
- Users/groups/plans/quota, AI pricing, anomalies, feedback, manual subscriptions and audit.

Do not reintroduce Cloudflare Pages for this branch.

## Web / LINE destinations

Typical Web paths:

- `/help` → 使用教學
- `/` → 查看紀錄
- `/subscription` → 方案／付款訂閱
- `/feedback` → 意見回饋

LINE-created record edit links should use short-lived/scoped Web-entry tokens that resolve to the exact record and source authorization; do not expose raw unauthenticated record ids as authorization.

## Subscription / checkout boundary

- Enabled plans are exposed through authenticated subscription APIs.
- Provider-neutral checkout intent exists.
- Payment provider remains undecided.
- Paid MONTHLY plans require recurring authorization and idempotent renewal success/failure handling.
- Only confirmed renewal success creates the next paid quota period.
- Monthly unused quota does not roll over.
- FREE is ONE_TIME and does not refresh.
- Never store raw card data.

## Admin authentication

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET` (>= 32 chars)
- `ADMIN_WEB_ORIGIN`

Only Admin login is unauthenticated; all other Admin APIs require the HMAC bearer session. Do not put API secrets into `VITE_*` variables.

## AI runtime

- `GEMINI_API_KEY` remains server-side only.
- Current approved production target: `gemini-3.5-flash`.
- Model/pricing/FX configuration is DB-backed Admin configuration, but runtime currently supports the approved Gemini 3.5 model family rather than maintaining Gemini 2.5 compatibility.
- Historical provider cost remains immutable.
- Thinking usage and modality-specific usage must be accounted exactly once.

## Architecture rules

- Keep API/Web/Admin independently deployable.
- Do not merge frontend apps into API merely to reduce Worker count.
- No SSR unless a real requirement appears.
- API secrets stay on API Worker.
- Web/Admin receive public build-time config only, mainly `VITE_API_BASE_URL`.

## Prelaunch database / migration policy

AFTERTRACE is not live yet. The user has explicitly confirmed that both development and production databases may be destructively rebuilt while the schema is being finalized.

Current repository migration state:

- `drizzle/0000_worklog_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

The consolidated `0000_worklog_baseline` is the current authoritative baseline.

### Current rule

- Old dev/prod migration history does **not** need reconciliation merely to preserve empty/non-live environments.
- If an environment was created from an obsolete migration history, drop/recreate or otherwise rebuild it from the current repository baseline.
- New schema work may use the current baseline plus new forward migration(s) without carrying legacy compatibility branches for the disposable databases.
- Before any destructive reset, confirm that there is still no real user/business data that must be preserved.
- Once the service is live with real production data, this rule ends immediately: migrations then become forward-only and destructive reset is no longer acceptable.

`worker-deploy.ps1` may continue to execute the repository's current migration flow only after the target database has been rebuilt/aligned with the current journal.

## External configuration still required

1. Web/Admin production domains or workers.dev hosts.
2. `WEB_APP_URL` / `WEB_APP_ORIGIN`.
3. `ADMIN_WEB_ORIGIN`.
4. API secrets/vars for Admin, LINE, Gemini and DB.
5. Web/Admin builds with correct `VITE_API_BASE_URL`.
6. LINE OA Rich Menu configuration.
7. Payment provider selection and recurring-payment lifecycle implementation.
8. Final database rebuild from the then-current migration baseline before launch.
9. Concentrated local build/typecheck/test/schema/migration/browser/Worker/LINE/Gemini validation.

## Validation expectations before launch

Validate locally/runtime, not through GitHub Actions unless explicitly requested:

- API/Web/Admin builds and typecheck/tests
- fresh database migration from current repository journal
- schema drift
- Admin authentication/CORS
- Web deep links and scoped record-edit links
- private record edit restricted to owning user
- group record edit available to currently authorized group members
- group Owner absence/rebind/rejoin flows
- group entitlement and `maxGroupCount` through LINE and Web
- FREE one-time quota semantics
- paid MONTHLY renewal semantics once provider integration exists
- LINE TEXT/Reply-TEXT/image/audio/PDF/file flows
- real Gemini 3.5 thinking/modality usage and provider-cost snapshots
- XLSX/DOCX extraction resource limits when Office support is implemented
- CSV export authorization once export is implemented
