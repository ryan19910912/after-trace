# AFTERTRACE Deployment Baseline

This document is part of the durable development contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE deploys as three independent Cloudflare Workers.

### 1. aftertrace-api

- Hono / TypeScript Cloudflare Worker.
- Responsibilities:
  - LINE webhook handling
  - worklog command/runtime
  - auth/session/token/redirect APIs
  - PWA APIs
  - admin APIs
  - subscription/AI quota logic
  - AI provider orchestration
  - PostgreSQL/Drizzle access
- Must remain independently deployable from both frontends.
- Deployment config remains `apps/api/wrangler.toml`.
- Production helper remains `worker-deploy.ps1` and is API-only.

### 2. aftertrace-web

- React + Vite customer-facing Web/PWA.
- Build output is deployed with Cloudflare Workers Static Assets.
- Do not target Cloudflare Pages for new deployment/configuration work.
- Worker config is `apps/web/wrangler.toml`.
- Static assets come from `apps/web/dist`.
- SPA fallback is configured with `not_found_handling = "single-page-application"`.
- Production helper is `web-worker-deploy.ps1`.
- Responsibilities:
  - personal records
  - group records
  - customers/projects
  - typed finance transactions
  - owner group usage/member permission management
  - feedback UI
- Must call `aftertrace-api` through the configured `VITE_API_BASE_URL`.

### 3. aftertrace-admin

- React + Vite internal admin.
- Build output is deployed with Cloudflare Workers Static Assets.
- Do not target Cloudflare Pages for new deployment/configuration work.
- Worker config is `apps/admin/wrangler.toml`.
- Static assets come from `apps/admin/dist`.
- SPA fallback is configured with `not_found_handling = "single-page-application"`.
- Production helper is `admin-worker-deploy.ps1`.
- Responsibilities:
  - configured username/password login backed by the API Worker
  - anomaly/system monitoring
  - feedback review
  - Worklog user/subscription/group usage views
  - plan price/capability/AI quota management
  - AI model/provider/pricing management
  - manual subscription changes
  - Worklog audit review
- Must call `aftertrace-api` through the configured `VITE_API_BASE_URL`.
- The removed Pages Functions proxy and legacy Cloudflare Access JWT verifier must not be reintroduced for the MVP Admin flow.

## Admin authentication boundary

The Worklog MVP Admin auth cutover is implemented at the API boundary:

- `ADMIN_USERNAME`: configured operator username.
- `ADMIN_PASSWORD`: configured operator password.
- `ADMIN_SESSION_SECRET`: at least 32 characters; signs short-lived Admin bearer sessions. Rotating it invalidates existing Admin sessions.
- `ADMIN_WEB_ORIGIN`: exact browser origin allowed to call Admin APIs.
- `POST /api/v1/admin/login` validates credentials on `aftertrace-api` and returns a signed bearer session.
- All other Admin endpoints require that bearer session.
- The Admin frontend stores the session in `sessionStorage`; it never receives or bundles the configured password or session secret.
- Do not put any of these API secrets in `VITE_*` variables.

## Architecture rules

- Keep all three deployments independently configurable and deployable.
- Do not combine Web/Admin into the API Worker merely to reduce project count.
- Do not add new Cloudflare Pages-specific functions/configuration.
- Do not reintroduce `pages-deploy.ps1` or `apps/admin/functions`.
- Prefer ordinary Vite static builds for Web/Admin; do not add SSR/server rendering unless a real product requirement appears.
- Web/Admin custom domains/routes, environment variables, secrets and access policies should be independently configurable.
- API secrets such as LINE/Gemini/DB/Admin credentials belong only to `aftertrace-api`, never in Web/Admin client bundles.
- Web/Admin builds receive only public build-time configuration such as `VITE_API_BASE_URL`.
- Admin login credentials/backend validation belong to API/admin server boundary, not exposed as frontend constants.
- `VITE_API_BASE_URL` is required for the Admin build/runtime; do not silently fall back to the Admin Worker origin because that Worker is static-assets-only and does not host `/api/v1/admin`.

## Current migration state

Completed:

1. Added Workers Static Assets config for `apps/web` as `aftertrace-web`.
2. Added Workers Static Assets config for `apps/admin` as `aftertrace-admin`.
3. Both frontends use SPA fallback through Workers Static Assets.
4. Added independent Web/Admin deployment helpers that build with an explicit API origin and deploy through Wrangler.
5. Kept `worker-deploy.ps1` API-only so one frontend deployment does not force an API deploy.
6. Removed the obsolete Cloudflare Pages deployment helper.
7. Removed the Pages-only Admin Functions proxy.
8. Updated `.env.example` away from `pages.dev` assumptions.
9. Replaced the legacy Cloudflare Access Admin verifier with configured username/password plus HMAC bearer sessions at the API Worker.
10. Rebuilt the Admin frontend around Worklog data instead of legacy Memory/Energy operational tables.

Still required before production cutover:

1. Configure the actual Web/Admin Worker custom domains or workers.dev hostnames.
2. Set API `WEB_APP_URL` / `WEB_APP_ORIGIN` to the Web Worker origin.
3. Set API `ADMIN_WEB_ORIGIN` to the Admin Worker origin.
4. Configure API Worker secrets/vars `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`.
5. Build both frontends with `VITE_API_BASE_URL` pointing to `aftertrace-api`.
6. Run the dedicated local build/typecheck/test/migration validation batch after the remaining MVP paths are complete.
7. Remove any remaining documentation/runtime assumptions that refer to Pages or legacy Admin Access when encountered; do not preserve compatibility code solely for either.

## Validation expectations

Before production use, validate each Worker independently:

- build succeeds
- deployment config points to the correct static asset directory or API Worker entrypoint
- SPA deep links work for Web/Admin
- Web/Admin point to the correct API origin
- API CORS/origin policy accepts intended Web/Admin origins only where needed
- API secrets are absent from frontend bundles
- Admin login rejects bad credentials, accepts configured credentials, expires/tamper-rejects sessions, and protects every route except `/login`
- deploying Web alone does not redeploy API/Admin
- deploying Admin alone does not redeploy API/Web
- deploying API alone does not rebuild or redeploy either frontend

The Workers Static Assets configuration intentionally follows Cloudflare's SPA model: assets directory plus `not_found_handling = "single-page-application"`; no frontend Worker script is required for the current static React/Vite apps.
