# AFTERTRACE Deployment Baseline

This document is part of the durable development contract for branch `revive/line-worklog`.

## Deployment topology

AFTERTRACE deploys as three independent Cloudflare Workers.

### 1. aftertrace-api

- Hono / TypeScript Cloudflare Worker.
- Responsibilities: LINE webhook, Worklog runtime, auth/session, PWA/Admin/subscription APIs, AI quota/provider orchestration and PostgreSQL/Drizzle.
- Deployment config: `apps/api/wrangler.toml`.
- Production helper: `worker-deploy.ps1` and API-only.
- The API entrypoint is Worklog-only; ordinary group traffic cannot fall through to retired Memory/Energy/conversation behavior.
- There is no active scheduled handler/cron binding for the retired reminder/proactive runtime.

### 2. aftertrace-web

- React + Vite customer-facing Web/PWA deployed with Cloudflare Workers Static Assets.
- Config: `apps/web/wrangler.toml`; assets: `apps/web/dist`; SPA fallback enabled.
- Production helper: `web-worker-deploy.ps1`.
- Responsibilities: personal/group records, customers/projects, typed finance, owner usage/member permissions, feedback, help, plan/subscription UI.
- Calls `aftertrace-api` through explicit `VITE_API_BASE_URL`.

### 3. aftertrace-admin

- React + Vite internal Admin deployed with Cloudflare Workers Static Assets.
- Config: `apps/admin/wrangler.toml`; assets: `apps/admin/dist`; SPA fallback enabled.
- Production helper: `admin-worker-deploy.ps1`.
- Responsibilities: username/password login, anomaly monitoring, feedback, Worklog users/groups/plans/quota, AI model/pricing, manual subscription changes and audit.
- Calls `aftertrace-api` through explicit `VITE_API_BASE_URL`.
- Do not reintroduce Pages Functions proxy or legacy Cloudflare Access JWT auth.

## Web / LINE OA destinations

Stable Web Worker paths for LINE OA Rich Menu:

- `https://<aftertrace-web>/help` → 使用教學
- `https://<aftertrace-web>/` → 查看紀錄
- `https://<aftertrace-web>/subscription` → 付款訂閱 / 方案
- `https://<aftertrace-web>/feedback` → 意見回饋

`/subscription` and `/feedback` use normal LINE Login when needed. LIFF is intentionally not required for the MVP.

## Subscription / checkout deployment boundary

- Enabled `worklog_subscription_plans` are exposed to authenticated users at `GET /api/v1/subscription/plans`.
- `POST /api/v1/subscription/checkout-intents` creates an idempotent provider-neutral checkout intent.
- Payment provider remains undecided; until configured, the UI/API must never claim payment succeeded.
- The current provider-neutral boundary is **not yet a complete monthly subscription system**. The product contract now requires dedicated `ONE_TIME` / `MONTHLY` plan billing type plus recurring-payment authorization and idempotent renewal success/failure events.
- A paid monthly renewal may create the next billing/quota period only after confirmed successful provider payment. Calendar passage alone must not grant new paid quota, and unused prior-period quota does not roll forward.
- Do not store raw card data in AFTERTRACE. Persist only provider-approved customer/subscription/authorization identifiers after a provider is selected.

## Admin authentication boundary

- `ADMIN_USERNAME`: configured operator username.
- `ADMIN_PASSWORD`: configured operator password.
- `ADMIN_SESSION_SECRET`: at least 32 characters; signs short-lived Admin bearer sessions.
- `ADMIN_WEB_ORIGIN`: exact browser origin allowed for Admin APIs.
- `POST /api/v1/admin/login` is the only unauthenticated Admin endpoint.
- Other Admin endpoints require the HMAC bearer session.
- Frontend never receives/bundles password or session secret; do not put API secrets in `VITE_*`.

## AI runtime configuration boundary

- `GEMINI_API_KEY` is the Worklog Gemini provider credential expected from Worker environment/secrets.
- Model name, pricing and USD/TWD conversion are DB-backed Admin configuration.
- Historical Worklog AI usage keeps its own execution snapshot; changing current configuration must not rewrite historical cost.
- Before production pricing/quota is finalized, reconcile the exact AI-unit and modality-pricing semantics. Current code records input/output token usage plus media fields; quota and provider-cost units must not accidentally double-count the same modality usage.

## Architecture rules

- Keep all three Workers independently configurable/deployable.
- Do not combine Web/Admin into API merely to reduce project count.
- No new Cloudflare Pages configuration/functions.
- No SSR unless a real requirement appears.
- API secrets (LINE/Gemini/DB/Admin credentials) live only on `aftertrace-api`.
- Web/Admin receive public build-time configuration only, primarily `VITE_API_BASE_URL`.

## Current migration reality

**Current branch source is authoritative for fresh databases.** As of this audit, the repository contains:

- `drizzle/0000_worklog_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

The current Drizzle journal contains **one entry only: `0000_worklog_baseline`**. There are no separate journal files `0001`–`0014`, and there is no current `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql` path in this branch.

The current `0000_worklog_baseline.sql` is a consolidated Worklog baseline, not a pre-Worklog historical schema. It already includes current Worklog structures and DB-level guards including the quota-cycle allowance snapshot trigger and project/customer link synchronization; the current schema also contains `oa_friend_state_at`.

Older handoff text that described journaled migrations `0000`–`0014` plus `post-cutover/9000` was stale after migration-history consolidation and must not be used as an execution plan.

### Fresh database

For a brand-new disposable database, validation should use the migration journal that actually exists in the repository and verify `0000_worklog_baseline` against the active Drizzle schema.

### Existing production/development database

**Do not blindly run the consolidated journal against an existing database until its Drizzle migration history has been inspected and reconciled.** An existing database may have been created from an older multi-migration history while the repository is now squashed to a single baseline. This can make a normal `drizzle-kit migrate` attempt unsafe or fail with already-existing objects.

Before production deployment:

1. Inspect the target database's Drizzle migration-history table and current schema.
2. Compare it with the consolidated `0000_worklog_baseline` and active schema declarations.
3. Decide and document the one-time migration-history reconciliation strategy for that database.
4. Test that strategy on a disposable clone/backup first.
5. Only after that proof should automated `db:deploy:migrate` remain enabled in the production deploy path.

`worker-deploy.ps1` currently calls `pnpm --filter @aftertrace/api db:deploy:migrate` automatically. Until the existing target DB history is reconciled, treat this step as a **production deployment blocker**, not as a verified safe operation.

## Current source/dependency state

- Active pnpm workspace is `apps/*` only.
- Current lockfile importers are root, `apps/admin`, `apps/api`, and `apps/web`.
- There is no current `packages/shared` workspace/importer in the repository; older progress notes asking to remove it are stale.
- Active Drizzle schema configuration points only at Worklog schema modules.

## External configuration still required

1. Configure actual Web/Admin custom domains or workers.dev hostnames.
2. Set API `WEB_APP_URL` / `WEB_APP_ORIGIN` to the Web Worker origin.
3. Set `ADMIN_WEB_ORIGIN` to the Admin Worker origin.
4. Set API Worker secrets/vars including Admin, LINE, Gemini and DB credentials.
5. Build Web/Admin with `VITE_API_BASE_URL` pointing to `aftertrace-api`.
6. Configure LINE OA Rich Menu links/image externally.
7. Select a payment provider that supports the required recurring-payment authorization/renewal model, then implement provider webhook lifecycle.
8. Reconcile existing database migration history before allowing the production deploy helper to run migrations automatically.
9. Run the concentrated local build/typecheck/test/schema/migration/browser/Worker/LINE/Gemini validation pass.

## Validation expectations

Before production use validate independently:

- API/Web/Admin builds
- current consolidated migration on a fresh disposable DB
- existing-target migration-history reconciliation on a disposable clone before production migrate
- Drizzle schema drift
- SPA deep links including `/help`, `/subscription`, `/feedback`
- correct CORS origins and secrets absent from frontend bundles
- Admin credential/session behavior and malformed-input handling
- subscription billing-type/effective-state presentation and quota snapshot semantics
- monthly renewal success/failure idempotency once provider integration exists
- group Owner explicit binding, stable ownership, current entitlement and `maxGroupCount` across both LINE and Web APIs
- capability enforcement server-side (`privateOaRecording`, AI text/media gates, PWA editing once its exact scope is finalized)
- OA FOLLOW/UNFOLLOW ordering under delayed/reordered webhook delivery
- LINE webhook TEXT/Reply TEXT/media E2E
- real Gemini text/image/audio/PDF usage and cost snapshots

Workers Static Assets follows Cloudflare's SPA model: assets directory plus `not_found_handling = "single-page-application"`; no frontend Worker script is required for the current React/Vite apps.
