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

## Current execution checkpoint — 2026-09-05 production Worker runtime smoke pending

The prelaunch baseline rebuild, fresh PostgreSQL integrity stage, and complete local static/test/build validation are green. Deployment configuration is intentionally simplified: `DATABASE_URL` is the single production database variable for migration/runtime, and `VITE_API_BASE_URL` is the single API base URL used by Web/Admin builds, `release:preflight`, and deployment helpers. `AFTERTRACE_PROD_DATABASE_URL` and `AFTERTRACE_API_URL` are retired. The deploy helper does not load repository `.env.local` itself; the operator must load the intended production environment before deployment.

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
- deployment database environment simplified to a single `DATABASE_URL`;
- API base URL configuration simplified to a single `VITE_API_BASE_URL`.

## Remaining P0 before free/manual + AI-recording launch

### 1. Real release preflight against actual API origin

After an API Worker HTTPS origin exists, set the actual URL in `VITE_API_BASE_URL` and run:

- `pnpm release:preflight`

### 2. Runtime / browser / provider smoke

After deployment/runtime configuration is intentionally started:

- initialize AI runtime pricing row and FREE plan on the intended fresh environment;
- `/health` + `/health/ready`;
- PWA CRUD/version/group-membership/Source-switch/session browser smoke;
- Admin plans/pricing/Overview/Profitability/session browser smoke;
- LINE Login + one-time entry;
- PRIVATE/GROUP TEXT CREATE/HISTORY/Reply EDIT/confirmations;
- image/audio/PDF/text-file extraction + automatic title/time resolution;
- attachment expiry/202/size/duplicate flows;
- real Gemini usage/pricing/point settlement;
- Worker runtime smoke.

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

Executed locally during this prelaunch verification sequence:

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

Not yet executed:

- successful `pnpm release:preflight` with a real deployed HTTPS API origin in `VITE_API_BASE_URL`;
- browser/PWA/Admin runtime smoke;
- Cloudflare Worker runtime/deploy smoke;
- LINE runtime smoke;
- real Gemini runtime smoke;
- final `/health/ready` on initialized launch environment.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, triggered or used as validation.

## Deployment status

**NOT READY yet.**

The regenerated baseline, fresh PostgreSQL migration, database Source/Grant integrity, Entity/Alias case-insensitive uniqueness, and complete local typecheck/lint/test/build/schema-export validation are cleared. The decisive remaining blockers are real release preflight with an actual API Worker origin and browser/LINE/Gemini/Worker runtime smoke.
