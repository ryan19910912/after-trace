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

## Current execution checkpoint — 2026-09-05 Dev deployment/bootstrap in progress

Cloudflare deployment is manual and split into the six explicit Workers:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`.
- Prod: `after-trace-api-prod`, `after-trace-web-prod`, `after-trace-admin-prod`.

Root environment inputs:

- `.env.local` — local only.
- `.env.dev` — Dev migration/deploy/API runtime binding source.
- `.env.prod` — Prod migration/deploy/API runtime binding source.

Root deployment helper loads exactly the selected environment, validates Worker origins, applies the selected DB migration before API deployment, uploads only whitelisted API runtime bindings using a temporary Wrangler secrets file, deploys to the exact Worker name, deletes the temporary file, and verifies API health/readiness.

`workers_dev = true` and `preview_urls = false` are explicit in API/Web/Admin Wrangler configuration so the intended workers.dev URLs stay enabled without per-deployment Preview URLs.

### Dev API runtime — verified so far

Real Dev deployment has established:

- Dev database migration — PASS.
- API Worker upload/deploy to `after-trace-api-dev` — PASS.
- API runtime bindings from `.env.dev` — visible on the deployed Worker.
- `GET /health` — PASS with `status: ok`.
- `GET /health/ready` — reached the expected fresh-environment blocker `AI_RUNTIME_CONFIG_NOT_INITIALIZED`.

The earlier first-request Cloudflare Error 1101 was resolved by ensuring deployed runtime bindings are carried by the manual API deploy and by keeping health/readiness dispatch ahead of eager Worklog DB/Gemini runtime construction.

### Dev Admin runtime — verified so far

- Admin production build — PASS during real deployment.
- static asset upload — PASS.
- Worker deploy to `after-trace-admin-dev` — PASS.
- Admin URL: `https://after-trace-admin-dev.a0955625660.workers.dev`.

The first attempt to save `gemini-3.5-flash-lite` exposed a real configuration bug: Admin/runtime/provider code had incorrectly hard-coded `gemini-3.5-flash` and returned `AI_MODEL_NOT_SUPPORTED`.

That hard-coded model contract is now removed in the branch:

- provider implementation is currently `GOOGLE` and may remain provider-restricted because the adapter is provider-specific;
- model is an operator-configured non-empty identifier, not a code allowlist;
- Admin no longer rejects a new Gemini model merely because the string was unknown when AFTERTRACE was compiled;
- readiness checks provider + non-empty model + valid positive output reference pricing, not equality to one model name;
- text normalization, LINE AI edit, and attachment Gemini requests use the configured model identifier;
- real Gemini calls are responsible for reporting model-not-found, permission, or feature compatibility errors;
- current intended model is `gemini-3.5-flash-lite`, but future compatible Gemini model identifiers must be selectable without a code deployment.

These configurable-model changes and their test updates were committed but have **not been executed locally/runtime yet**. Do not claim them PASS until the user pulls/redeploys and completes runtime smoke.

## Previously completed / actually verified foundation

Do not redo these without a concrete regression:

- `pnpm install --frozen-lockfile` — PASS.
- API/Web/Admin TypeScript typecheck — PASS before the latest deployment/model hotfixes.
- API/Web/Admin ESLint — PASS before the latest deployment/model hotfixes.
- API Vitest — 42 files / 240 tests PASS before the latest hotfixes.
- Admin Vitest — 3 files / 11 tests PASS before the latest hotfixes.
- Web test command with no tests / passWithNoTests — PASS.
- API Worker dry-run — PASS.
- Web production build — PASS.
- Admin production build — PASS, and also PASS in the real Dev Admin deployment.
- Drizzle baseline regeneration and guard — PASS.
- Drizzle schema export/check — PASS.
- fresh Neon PostgreSQL migration — PASS.
- fresh PostgreSQL integrity probes — PASS.
- Source/Grant cross-boundary DB constraints — verified.
- Source-scoped case-insensitive Entity/Alias uniqueness — verified.
- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation.
- free PWA manual CRUD/search/filter/title move/batch move/delete/recycle/restore/history.
- GROUP manual authorization = active membership only.
- optimistic Record version checks + stale conflict handling.
- deterministic LINE HISTORY -> filtered PWA.
- Reply-targeted PRIVATE/GROUP LINE AI EDIT.
- attachment extraction -> durable text -> title/time normalization wiring.
- FREE 400,000 one-time Grant policy.
- user-owned Grant scopes/caps + GROUP AI 額度負責人.
- positive-balance AI preflight + final atomic reservation.
- provider actual cost -> output-price-equivalent AI points + platform subsidy.
- retired aggregate quota / legacy Customer/Project/Finance assumptions removed from accepted core.
- factual Admin profitability + pricing calculator.
- payment-disabled checkout and unshipped Export fail closed.
- bounded attachment streaming / no permanent LINE binaries.
- local API/Web/Admin startup and browser open — PASS.
- local Admin password minimum aligned to 8 characters.
- Admin/Web display time standardized to Asia/Taipei `yyyy-MM-dd HH:mm:ss` while DB/API remain UTC/ISO.

## Current model/runtime rule — frozen until explicitly changed

The current provider adapter is Google Gemini, but **Gemini model names are runtime data, not compile-time entitlement**.

- `provider = GOOGLE` is accepted because that is the implemented provider adapter.
- `model` must be non-empty and bounded in length; do not maintain an `AI_MODEL_NOT_SUPPORTED` allowlist for model IDs.
- current intended model: `gemini-3.5-flash-lite`.
- pricing snapshot entered in Admin must correspond to the actual selected model.
- changing the active model affects future requests only; historical usage/pricing snapshots remain auditable.
- an incompatible/non-existent model fails on the real provider request and should surface a truthful provider/model error rather than requiring an AFTERTRACE release just to enter the model name.

## Remaining P0 — immediate next actions

### 1. Pull and redeploy Dev API

The model validation/runtime changes live in the API Worker, so the next operator steps are:

```text
git pull
pnpm deploy:dev:api
```

Expected API deployment result:

- migration remains successful;
- Worker deploy succeeds;
- `/health` returns `ok`;
- `/health/ready` may still report `AI_RUNTIME_CONFIG_NOT_INITIALIZED` until Admin saves the runtime config.

### 2. Save Dev AI runtime config in Admin

Use the Dev Admin and configure the intended current model:

- provider: `GOOGLE`;
- model: `gemini-3.5-flash-lite`;
- model-specific input/output/media pricing snapshot;
- positive `output_usd_per_million`;
- applicable USD/TWD rate.

Then recheck `/health/ready`.

The next expected first-bootstrap blocker is `FREE_PLAN_NOT_INITIALIZED` if the AI runtime row is now valid.

### 3. Initialize FREE plan shell

Create/enable FREE through Admin with:

- code `FREE`;
- price `0`;
- `subscription_period_points = 0`;
- enabled `true`.

The frozen 400,000 FREE acquisition Grant is separate from the recurring plan template field.

Recheck `/health/ready` until it returns `ready`.

### 4. Deploy Dev Web

After Dev API readiness is green:

```text
pnpm deploy:dev:web
```

Then continue full Dev browser/runtime smoke.

### 5. Runtime/provider smoke

Before Prod:

- Admin login/CORS and AI runtime save.
- real Gemini call using the configured model.
- LINE Login + one-time Web entry.
- PRIVATE/GROUP TEXT CREATE/HISTORY/Reply EDIT/confirmations.
- image/audio/PDF/text-file extraction.
- attachment expiry/202/size/duplicate flows.
- AI point/pricing/provider-cost settlement.
- PWA CRUD/version/group membership/source switch.
- Admin Overview/Plans/Pricing/Profitability.
- successful `pnpm release:preflight` against the real deployed HTTPS API origin.

### 6. Prod only after Dev is green

Use `.env.prod` and the `*-prod` Workers only after complete Dev smoke is green.

## P1

- Customer AI usage percentage/progress denominator polish.
- Admin main navigation shortcuts to profitability/pricing calculator.
- Attachment LINE success copy can expose pending title-normalization state more explicitly.

## P2 / paid full-MVP gaps

- payment provider selection/integration;
- successful-payment ledger;
- recurring renewal success/failure + idempotent webhooks;
- TOP_UP purchase/refund lifecycle;
- paid Export endpoint/UI;
- proration/mid-period paid-plan change policy;
- advanced paid-cohort profitability/conversion analytics.

## Attachment coverage limitation

Image, audio, PDF and text-like files are active. DOCX/XLSX/legacy Office MIME types remain explicitly `ATTACHMENT_UNSUPPORTED`; this is fail-closed, not silent corruption.

## Validation status for latest changes

The latest configurable-model code/tests/docs were **not rerun by the assistant**. GitHub Actions were not executed, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **DEV BOOTSTRAP IN PROGRESS — NOT READY FOR PROD**.
