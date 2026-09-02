# AFTERTRACE Deployment Baseline

This document is part of the durable development contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE deploys as three independent Cloudflare Workers.

### 1. aftertrace-api

- Hono / TypeScript Cloudflare Worker.
- Responsibilities: LINE webhook, Worklog runtime, auth/session, PWA/Admin/subscription APIs, AI quota/provider orchestration and PostgreSQL/Drizzle.
- Deployment config: `apps/api/wrangler.toml`.
- Production helper: `worker-deploy.ps1` and API-only.
- The API entrypoint is Worklog-only: LINE group traffic is terminated at the Worklog group boundary, so ordinary group chat can only hit the bounded PostgreSQL TEXT cache path and cannot fall through to retired conversation/Energy/Memory logic.
- Legacy `/management`, `/energy`, old commerce/proactive API prefixes plus old `/auth/groups` and `/auth/memories` endpoints return HTTP 410 tombstones without mounting their old routers.
- The previous reminder/proactive/legacy-retention scheduled handler is a no-op until its Cloudflare cron binding is removed.

### 2. aftertrace-web

- React + Vite customer-facing Web/PWA deployed with Cloudflare Workers Static Assets.
- Config: `apps/web/wrangler.toml`; assets: `apps/web/dist`; SPA fallback enabled.
- Production helper: `web-worker-deploy.ps1`.
- Responsibilities: personal/group records, customers/projects, typed finance, owner usage/member permissions, feedback, help, plan/subscription UI.
- Must call `aftertrace-api` through explicit `VITE_API_BASE_URL`.

### 3. aftertrace-admin

- React + Vite internal Admin deployed with Cloudflare Workers Static Assets.
- Config: `apps/admin/wrangler.toml`; assets: `apps/admin/dist`; SPA fallback enabled.
- Production helper: `admin-worker-deploy.ps1`.
- Responsibilities: username/password login, anomaly monitoring, feedback, Worklog users/groups/plans/quota, AI model/pricing, manual subscription changes and audit.
- Must call `aftertrace-api` through explicit `VITE_API_BASE_URL`.
- Do not reintroduce Pages Functions proxy or legacy Cloudflare Access JWT auth.

## Web / LINE OA destinations

The Web Worker uses SPA fallback, so these stable paths can be used directly by the LINE OA Rich Menu:

- `https://<aftertrace-web>/help` → 使用教學
- `https://<aftertrace-web>/` → 查看紀錄
- `https://<aftertrace-web>/subscription` → 付款訂閱 / 方案
- `https://<aftertrace-web>/feedback` → 意見回饋

`/subscription` and `/feedback` use the normal LINE Login session when needed. Because LIFF is intentionally not used, the web app preserves the requested destination in local storage and moves the LINE Login callback session hash back to that path after OAuth returns to `WEB_APP_URL`.

The actual Rich Menu object/image is a LINE OA external configuration step and is not a reason to add LIFF.

## Subscription / checkout deployment boundary

- Admin-managed enabled `worklog_subscription_plans` are exposed to authenticated users at `GET /api/v1/subscription/plans`.
- `POST /api/v1/subscription/checkout-intents` creates an idempotent provider-neutral checkout intent.
- Checkout intents are stored in `worklog_checkout_intents` (`0010_worklog_checkout_intents.sql`).
- The payment provider remains intentionally undecided. Until a provider is configured, the API returns the intent with `checkoutEnabled=false` / no checkout URL; the UI must never claim payment succeeded.
- Future payment integration should transition an existing intent to `READY` with provider/id/url, then process provider webhook completion into subscription assignment. Do not couple PWA components directly to a specific payment provider.

## Admin authentication boundary

- `ADMIN_USERNAME`: configured operator username.
- `ADMIN_PASSWORD`: configured operator password.
- `ADMIN_SESSION_SECRET`: at least 32 characters; signs short-lived Admin bearer sessions.
- `ADMIN_WEB_ORIGIN`: exact browser origin allowed for Admin APIs.
- `POST /api/v1/admin/login` is the only unauthenticated Admin endpoint.
- Other Admin endpoints require the HMAC bearer session.
- Frontend never receives/bundles password or session secret; do not put API secrets in `VITE_*`.

## AI runtime configuration boundary

- `GEMINI_API_KEY` is the only Worklog Gemini provider credential expected from Worker environment/secrets.
- Model name, token pricing, image/audio pricing and USD/TWD conversion are stored in the Worklog runtime configuration tables and edited through Worklog Admin.
- Retired Energy/free-budget/rewarded-ad/Memory AI environment settings are not part of the Worklog deployment contract.
- Historical Worklog AI usage keeps its own execution snapshot; changing Admin runtime configuration must not rewrite historical cost.

## Architecture rules

- Keep all three Workers independently configurable/deployable.
- Do not combine Web/Admin into API merely to reduce project count.
- No new Cloudflare Pages configuration/functions.
- No SSR unless a real requirement appears.
- API secrets (LINE/Gemini/DB/Admin credentials) live only on `aftertrace-api`.
- Web/Admin receive public build-time configuration only, primarily `VITE_API_BASE_URL`.

## Current migration state

Completed deployment-direction work:

1. Web/Admin Workers Static Assets configs + SPA fallback.
2. Independent Web/Admin/API deployment helpers.
3. Removed old Pages deployment helper and Pages Admin proxy.
4. Removed `pages.dev` assumptions from active API config.
5. Configured username/password + HMAC Admin auth and Worklog Admin UI.
6. Cut production Worker routing away from legacy Energy/Memory/commerce/proactive surfaces.
7. Added user-facing `/help`, `/subscription`, `/feedback` destinations.
8. Added provider-neutral subscription plan/checkout-intent boundary.
9. Added DB failure-to-anomaly triggers (`0009`) for attachment and TEXT normalization failures so Admin monitoring receives structured events.
10. Replaced the mixed legacy LINE webhook entrypoint with Worklog-only group/OA processors; ordinary group traffic no longer invokes conversation, Energy, extraction or Memory services.
11. Removed legacy group-list/memory-search auth reads from the mounted auth router while preserving one-time GROUP/PRIVATE entry exchange and LINE Login.

Still required before production cutover:

1. Configure actual Web/Admin custom domains or workers.dev hostnames.
2. Set API `WEB_APP_URL` / `WEB_APP_ORIGIN` to the Web Worker origin.
3. Set `ADMIN_WEB_ORIGIN` to Admin Worker origin.
4. Set API Worker secrets/vars including `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, LINE/Gemini/DB credentials.
5. Build Web/Admin with `VITE_API_BASE_URL` pointing to `aftertrace-api`.
6. Remove the obsolete Cloudflare cron binding for the retired legacy scheduled runtime.
7. Configure LINE OA Rich Menu links/image externally.
8. Decide/payment provider and connect it to existing checkout-intent boundary when ready.
9. Run concentrated local build/typecheck/test/migration validation after major MVP paths are complete.
10. After the Worklog schema cleanup migration is designed, remove retired legacy DB tables/schema declarations rather than leaving permanent storage debt.

## Validation expectations

Before production use validate independently:

- API/Web/Admin builds
- migrations and Drizzle schema drift
- SPA deep links including `/help`, `/subscription`, `/feedback`
- correct CORS origins
- secrets absent from frontend bundles
- Admin credential/session behavior
- subscription plan list + checkout intent idempotency / no false-success while provider disabled
- deploying each Worker does not redeploy the others
- legacy API prefixes return 410 and ordinary group chat does not enter old conversation/Memory storage
- group command persistence remains successful even when LINE reply delivery fails
- LINE webhook TEXT/Reply TEXT/media E2E
- real Gemini image/audio/PDF usage/cost snapshots

Workers Static Assets follows Cloudflare's SPA model: assets directory plus `not_found_handling = "single-page-application"`; no frontend Worker script is required for the current React/Vite apps.
