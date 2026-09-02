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

### 2. aftertrace-web

- React + Vite customer-facing Web/PWA.
- Build output is deployed with Cloudflare Workers Static Assets.
- Do not target Cloudflare Pages for new deployment/configuration work.
- Responsibilities:
  - personal records
  - group records
  - customers/projects
  - owner group usage/member permission management
  - subscription UI
  - feedback UI
- Must call `aftertrace-api` through the configured API origin.

### 3. aftertrace-admin

- React + Vite internal admin.
- Build output is deployed with Cloudflare Workers Static Assets.
- Do not target Cloudflare Pages for new deployment/configuration work.
- Responsibilities:
  - simple configured username/password login
  - anomaly/system monitoring
  - feedback review
  - user/subscription/group usage views
  - plan price/capability/AI quota management
  - AI model/provider/pricing management
  - manual subscription changes
- Must remain a separate Worker from the public Web/PWA and API.

## Architecture rules

- Keep all three deployments independently configurable and deployable.
- Do not combine Web/Admin into the API Worker merely to reduce project count.
- Do not add new Cloudflare Pages-specific functions/configuration.
- Existing Pages-era config/scripts may be migrated or deleted incrementally after equivalent Workers Static Assets deployment exists.
- Prefer ordinary Vite static builds for Web/Admin; do not add SSR/server rendering unless a real product requirement appears.
- Web/Admin custom domains/routes, environment variables, secrets and access policies should be independently configurable.
- API secrets such as LINE/Gemini/DB credentials belong only to `aftertrace-api`, never in Web/Admin client bundles.
- Admin login credentials/backend validation belong to API/admin server boundary, not exposed as frontend constants.

## Migration work

Development should gradually replace old Pages assumptions with Worker Static Assets equivalents:

1. Add/normalize Worker deployment configuration for `apps/web`.
2. Add/normalize Worker deployment configuration for `apps/admin`.
3. Update package scripts / CI deployment commands from Pages deploy to Workers deploy.
4. Remove obsolete Pages Functions/proxy shims once equivalent API-origin calls are working.
5. Update environment examples/documentation so Web/Admin receive only public build-time configuration such as API base URL.
6. Verify SPA fallback/routing works correctly through Workers Static Assets.
7. Keep API deployment independent.

## Validation expectations

Before production use, validate each Worker independently:

- build succeeds
- deployment config points to correct static asset directory or Worker entrypoint
- SPA deep links work for Web/Admin
- Web/Admin point to the correct API origin
- API CORS/origin policy accepts intended Web/Admin origins only where needed
- API secrets are absent from frontend bundles
- admin routes remain behind the intended simple login boundary
