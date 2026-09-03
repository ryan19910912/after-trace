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

## Prelaunch database / migration policy

AFTERTRACE is not live yet. The user has explicitly confirmed that both development and production databases may be destructively rebuilt while the schema is being finalized.

Current repository migration state:

- `drizzle/0000_worklog_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

The consolidated `0000_worklog_baseline` is the current authoritative baseline until the current domain refactor replaces it with the final prelaunch schema.

### Current rule

- Old dev/prod migration history does **not** need reconciliation merely to preserve empty/non-live environments.
- If an environment was created from an obsolete migration history, drop/recreate or otherwise rebuild it from the current repository baseline.
- New schema work may destructively replace/refactor the prelaunch baseline without carrying Customer/Project/Finance or aggregate-quota compatibility solely for empty databases.
- Before any destructive reset, confirm that there is still no real user/business data that must be preserved.
- Once the service is live with real production data, this rule ends immediately: migrations then become forward-only and destructive reset is no longer acceptable.

`worker-deploy.ps1` may continue to execute the repository's current migration flow only after the target database has been rebuilt/aligned with the current journal.

## External configuration still required

1. Actual Cloudflare account `workers.dev` subdomain / deployed hosts.
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

- API/Web/Admin builds and typecheck/tests;
- fresh database migration from current repository journal;
- schema drift;
- Admin authentication/CORS;
- Web deep links and scoped Record-edit links;
- private manual Record access restricted to the owning user;
- group manual browse/create/edit/delete/restore available to active group members without subscription/Owner/AI funding gates;
- inactive/removed group members denied group data access;
- AI 額度負責人 absence/transfer/rejoin/takeover behavior once the grant model is implemented;
- FREE 400,000 one-time point grant semantics;
- independent subscription-period and top-up grant semantics;
- zero-balance provider preflight and overage/platform-subsidy accounting;
- paid MONTHLY renewal semantics once provider integration exists;
- LINE TEXT/Reply-TEXT/image/audio/PDF/file flows;
- real Gemini thinking/modality usage and provider-cost/point snapshots;
- XLSX/DOCX extraction resource limits when Office support is implemented;
- export authorization once export is implemented.
