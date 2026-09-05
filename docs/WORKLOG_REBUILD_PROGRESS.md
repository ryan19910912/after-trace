# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run, in this exact order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

The latest documents above are the only product/development specification. Do not revive Customer/Project/Finance/Owner/aggregate-quota assumptions from legacy code, migrations, README history or old tests.

## Current execution checkpoint — 2026-09-05 Dev API runtime deploy smoke in progress

The prelaunch baseline rebuild, fresh PostgreSQL integrity stage, and complete local static/test/build validation are green. Deployment configuration is intentionally simplified: `DATABASE_URL` is the single database variable for migration/runtime inside each environment, and `VITE_API_BASE_URL` is the single API base URL used by Web/Admin builds and deployment helpers. `AFTERTRACE_PROD_DATABASE_URL` and `AFTERTRACE_API_URL` are retired.

Cloudflare deployment is explicitly split into manual Dev / Prod targets. No Git push, non-production branch build, or GitHub Actions workflow is used as an automatic deployment trigger.

Actual Cloudflare Worker names are frozen to the six Workers already created in the account:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`.
- Prod: `after-trace-api-prod`, `after-trace-web-prod`, `after-trace-admin-prod`.

Root deployment inputs:

- `.env.dev` is authoritative for `pnpm deploy:dev` and Dev API runtime bindings.
- `.env.prod` is authoritative for `pnpm deploy:prod` and Prod API runtime bindings.
- `.env.local` remains local development only.

The manual API deployment command now loads the selected environment file, validates the selected Worker origins, applies that environment's DB migration, whitelists the required API runtime bindings, uploads them alongside the API Worker through Wrangler `--secrets-file`, deletes the temporary JSON, deploys to the exact `--name`, then verifies `/health` and `/health/ready`. `VITE_API_BASE_URL` remains build/deploy input only and is not uploaded as an API runtime binding.

### Dev API deployment smoke observed

The first real Dev API deployment command reached Cloudflare successfully:

- `.env.dev` target validation — PASS.
- Dev database migration — PASS (`AFTERTRACE database migrations applied successfully`).
- API Worker upload — PASS.
- `after-trace-api-dev` deployment — PASS.
- resulting Worker URL — `https://after-trace-api-dev.a0955625660.workers.dev`.
- first runtime request returned Cloudflare **Error 1101 / Worker threw exception**.

Root cause identified from current code/config contract:

1. the previous root deploy helper intentionally did **not** upload `.env.dev` runtime bindings, so the remote Worker did not have the required DB/LINE/Gemini/Web/Admin bindings even though the local file was complete;
2. `worker.ts` eagerly initialized DB/Gemini/attachment runtime before dispatching `/health` or `/health/ready`, so a missing binding threw before readiness could return `RUNTIME_CONFIG_INCOMPLETE`.

Fixes committed:

- `/health` and `/health/ready` now bypass eager Worklog runtime initialization so liveness/readiness stay diagnosable even with incomplete runtime configuration;
- root `deploy:dev:api` / `deploy:prod:api` now upload the whitelisted runtime binding set from the selected root env file in the same Wrangler deploy using a temporary `--secrets-file`;
- temporary secrets JSON is deleted after deploy;
- API deployment now verifies `/health` and `/health/ready` automatically;
- first-environment readiness may continue only for `AI_RUNTIME_CONFIG_NOT_INITIALIZED` or `FREE_PLAN_NOT_INITIALIZED`; runtime config/schema failures abort.

The user must `git pull` and rerun `pnpm deploy:dev:api` to validate these fixes against Cloudflare. Do not claim the Error 1101 fix is runtime-verified until that rerun succeeds.

### Local runtime smoke already completed

- `pnpm dev:api` starts Wrangler on `http://127.0.0.1:8787`.
- `pnpm dev:web` starts Vite on `http://localhost:5173`.
- `pnpm dev:admin` starts Vite on `http://localhost:5174`.
- all three local surfaces opened successfully in the browser.
- readiness exposed a real validation mismatch: local loopback HTTP origins were incorrectly rejected even though `.env.example` documents localhost HTTP. Readiness now accepts HTTP only for loopback hosts (`localhost`, `127.0.0.1`, `::1`) while retaining HTTPS-only behavior for non-loopback deployed origins.
- user explicitly changed the Admin operator password minimum from 16 to **8 characters**. Admin auth, readiness validation, tests, `.env.example`, and deployment documentation now use the same 8-character minimum.
- frontend timestamp presentation is standardized to **Asia/Taipei (UTC+8)** with display format **`yyyy-MM-dd HH:mm:ss`**. API/DB timestamps remain UTC/ISO; only Admin/Web presentation is converted. PostgreSQL timestamptz strings such as `2026-09-05 13:35:17.936087+00` are normalized before display.

## 已完成 / 已實際驗證

以下項目均已在本機或 fresh Neon PostgreSQL 實際執行並成功，不是僅做靜態閱讀或推測：

### Local toolchain / static validation

- `pnpm install --frozen-lockfile` — PASS.
- API TypeScript typecheck — PASS.
- Web TypeScript typecheck — PASS.
- Admin TypeScript typecheck — PASS.
- API ESLint — PASS.
- Web ESLint — PASS.
- Admin ESLint — PASS.
- API Worker `wrangler deploy --dry-run` build — PASS.
- Web production build — PASS.
- Admin production build — PASS.
- `pnpm db:schema:check` Drizzle schema export — PASS.

### Automated tests

- API Vitest: **42 test files / 240 tests passed**.
- Admin Vitest: **3 test files / 11 tests passed**.
- Web: no test files; configured `passWithNoTests` completed successfully.

### Drizzle baseline

- Windows-safe baseline regeneration flow fixed and verified.
- `pnpm db:baseline:regenerate --confirm-prelaunch-reset` — PASS.
- `pnpm db:baseline:guard` — PASS after final schema changes.
- regenerated `drizzle/0000_worklog_baseline.sql` — committed.
- regenerated `drizzle/meta/0000_snapshot.json` — committed.
- regenerated `drizzle/meta/_journal.json` — committed.
- retired Customer/Project/Transaction/category/aggregate-quota/recording schema markers are no longer accepted by the baseline guard.

### Fresh PostgreSQL migration

- migration tooling loads repository-root `.env.local` for local tooling.
- local migration uses the Neon HTTP Drizzle migrator instead of the failing Drizzle Kit WebSocket CLI path.
- migration against a freshly reset Neon PostgreSQL database — PASS.
- composite FK referenced keys required by PostgreSQL were changed to real UNIQUE constraints where needed.
- fresh re-migration after the final Entity/Alias uniqueness fix — PASS.

### Fresh PostgreSQL integrity probes

`pnpm db:integrity` — PASS.

Database constraints were actually verified to reject:

- mixed PRIVATE/GROUP Source identity;
- cross-Source Alias -> Entity;
- cross-Source Record -> Entity;
- cross-Source Pending Confirmation -> Record;
- PRIVATE Web entry user/Source mismatch;
- cross-Source LINE AI edit target Record;
- cross-Source attachment Record;
- cross-Source attachment reservation;
- reservation funding Grant/Scope mismatch;
- usage funding Grant/Scope mismatch.

Entity/Alias case behavior was reproduced against real PostgreSQL and fixed. Final verified behavior:

- Entity case-only duplicate rejected within the same Source;
- the same Entity spelling is allowed in another Source;
- Alias case-only duplicate rejected within the same Source;
- the same Alias spelling is allowed in another Source.

### Release-preflight-equivalent local checks

`pnpm release:preflight` itself was invoked, but correctly stopped before its internal checks because deployment policy requires a real absolute HTTPS `VITE_API_BASE_URL`.

The checks that can be executed before deployment were then run directly and all passed:

- TypeScript;
- ESLint;
- Vitest;
- API Worker dry-run build;
- Web production build;
- Admin production build;
- baseline guard;
- Drizzle schema export.

Do not mark the `release:preflight` wrapper itself as PASS until a real deployed API Worker HTTPS origin exists in `VITE_API_BASE_URL` and the wrapper is rerun.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- free PWA manual CRUD/search/filter/title move/batch move/delete/recycle/restore/history;
- GROUP manual authorization = active membership only;
- optimistic Record version checks + PWA stale-conflict recovery;
- deterministic LINE HISTORY -> filtered PWA;
- Reply-targeted PRIVATE/GROUP LINE AI EDIT;
- truthful raw-first TEXT normalization replies;
- attachment extract -> durable text -> title/time normalization source wiring;
- FREE 400,000 one-time Grant;
- user-owned Grant scopes/caps + separate GROUP AI 額度負責人;
- positive-balance preflight + final atomic reservation;
- provider actual cost -> output-price-equivalent points + platform subsidy;
- immutable/idempotent subscription-period Grants;
- retired aggregate quota / `ai_units_consumed` / `actualUnits` removed;
- factual Admin profitability + pricing calculator;
- Admin/runtime/readiness agree on `GOOGLE + gemini-3.5-flash`;
- payment-disabled checkout and unshipped Export fail closed;
- bounded attachment streaming / no permanent binaries;
- safe baseline regeneration/guard;
- fresh PostgreSQL migration + Source/Grant integrity validation;
- Source-scoped case-insensitive Entity/Alias uniqueness;
- liveness/readiness + first-fresh-DB bootstrap mode;
- Web/Admin Workers SPA fallback/deep-link checks;
- deployment database environment simplified to a single `DATABASE_URL` per environment;
- API base URL configuration simplified to a single `VITE_API_BASE_URL` per environment;
- Worker deployment slugs normalized to the six actual `after-trace-*-dev` / `after-trace-*-prod` Workers;
- manual `pnpm deploy:dev` / `pnpm deploy:prod` flow with per-component variants, exact `--name` targeting, and environment-host mismatch protection;
- local readiness origin validation allows only loopback HTTP and deployed HTTPS;
- Admin password minimum aligned to 8 characters across auth/readiness/config docs;
- Admin/Web displayed timestamps use Asia/Taipei UTC+8 and `yyyy-MM-dd HH:mm:ss`, while durable/API time remains UTC/ISO;
- API health endpoints no longer depend on eager Worklog runtime initialization;
- root API deploy flow now carries the whitelisted selected-environment runtime bindings with the deployment.

## Remaining P0 before free/manual + AI-recording launch

### 1. Rerun real Dev API deployment after Error 1101 fix

From the updated checkout:

- `git pull`
- `pnpm deploy:dev:api`

Expected flow:

- migration succeeds;
- API code + whitelisted `.env.dev` runtime bindings deploy together;
- `/health` returns `ok`;
- `/health/ready` either returns `ready`, or reports only `AI_RUNTIME_CONFIG_NOT_INITIALIZED` / `FREE_PLAN_NOT_INITIALIZED` while the fresh Dev DB still needs Admin bootstrap.

Do not move to Dev Web/Admin runtime smoke until the Dev API no longer returns Error 1101.

### 2. Deploy Dev Web/Admin

After Dev API liveness is green:

- `pnpm deploy:dev:web`
- `pnpm deploy:dev:admin`

Then initialize Dev AI runtime/FREE plan through Admin if readiness is still in expected first-bootstrap state, and rerun `/health/ready` until `ready`.

### 3. Real release preflight against Dev API origin

After Dev API is live:

- run `pnpm release:preflight` with the real HTTPS Dev API origin as required by the current wrapper.

### 4. Runtime / browser / provider smoke

After deployment/runtime configuration is intentionally started:

- `/health` + `/health/ready`;
- PWA CRUD/version/group-membership/Source-switch/session browser smoke;
- Admin plans/pricing/Overview/Profitability/session browser smoke;
- LINE Login + one-time entry;
- PRIVATE/GROUP TEXT CREATE/HISTORY/Reply EDIT/confirmations;
- image/audio/PDF/text-file extraction + automatic title/time resolution;
- attachment expiry/202/size/duplicate flows;
- real Gemini usage/pricing/point settlement;
- Worker runtime smoke.

### 5. Prod only after Dev is green

Use the same root flow with `.env.prod` and the `*-prod` Workers only after the complete Dev smoke is green.

## P1 — useful polish after P0

- Customer AI usage percentage/progress UI still needs a denominator that does not mix expired/capped/lifetime facts.
- Admin main navigation can add shortcuts to `/profitability` and `/pricing-calculator`.
- Attachment LINE success text can later expose title-normalization pending/confirmation state more explicitly.

## P2 — full paid MVP remains separate

- payment provider;
- successful-payment durable ledger;
- recurring renewal success/failure + idempotent webhooks;
- TOP_UP purchase/refund lifecycle;
- paid Export endpoint/UI;
- proration/mid-period paid-plan change policy;
- advanced subscriber profitability/conversion analytics requiring payment facts.

## Attachment coverage limitation

Image, audio, PDF and text-like files are active. DOCX/XLSX/legacy Office MIME types remain explicitly `ATTACHMENT_UNSUPPORTED`; this is a clear fail-closed limitation, not silent corruption.

## Validation status

Previously executed locally during prelaunch verification:

- install;
- API/Web/Admin typecheck;
- ESLint;
- Vitest;
- API/Web/Admin production builds / Worker dry-run;
- baseline regeneration;
- baseline guard;
- Drizzle schema export;
- fresh Neon PostgreSQL migration;
- fresh PostgreSQL integrity probes;
- case-insensitive Entity/Alias collision reproduction and final rejection validation.

Executed during current runtime/deployment smoke:

- local API startup — PASS;
- local Web startup — PASS;
- local Admin startup — PASS;
- browser open for all three local surfaces — PASS;
- first Dev DB migration via `pnpm deploy:dev:api` — PASS;
- first Dev API Worker upload/deploy to `after-trace-api-dev` — PASS;
- first Dev API runtime request — FAIL with Cloudflare Error 1101 before current fixes.

Current Error 1101 fixes changed runtime/deployment code and docs but were **not yet rerun by the user**. Do not claim them runtime-verified until `pnpm deploy:dev:api` is rerun successfully.

Not yet executed after current fixes:

- successful Dev API `/health`;
- Dev API `/health/ready` bootstrap result;
- Dev Web deployment;
- Dev Admin deployment;
- successful `pnpm release:preflight` with a real deployed HTTPS API origin;
- full browser/PWA/Admin Dev smoke;
- LINE Dev runtime smoke;
- real Gemini Dev runtime smoke;
- Prod deployment/runtime smoke.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, triggered or used as validation.

## Deployment status

**NOT READY yet.**

The first real Dev API code upload and DB migration succeeded, but runtime returned Error 1101 because remote bindings were absent and health routes eagerly initialized runtime. Both issues are now corrected in the branch; the decisive next action is to pull and rerun `pnpm deploy:dev:api`, then continue with Dev Web/Admin only after Dev API liveness is green.
