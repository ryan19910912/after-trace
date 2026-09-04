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

## Current execution checkpoint — 2026-09-04 fresh PostgreSQL green

This run completed the prelaunch baseline rebuild and fresh PostgreSQL integrity stage.

## Completed in this validation round

- `pnpm install --frozen-lockfile` completed successfully.
- API/Web/Admin TypeScript typecheck passed locally.
- ESLint passed locally for API/Web/Admin.
- Vitest passed locally:
  - API: 42 files / 240 tests passed.
  - Admin: 3 files / 11 tests passed.
  - Web: no test files; `passWithNoTests` returned success.
- Windows-safe baseline regeneration flow fixed.
- `pnpm db:baseline:regenerate --confirm-prelaunch-reset` completed successfully.
- `pnpm db:baseline:guard` passed.
- regenerated `0000_worklog_baseline.sql`, snapshot and journal were committed.
- migration tooling now loads root `.env.local` for local tooling and uses the Neon HTTP Drizzle migrator instead of the failing Drizzle Kit WebSocket migration path.
- fresh Neon PostgreSQL migration completed successfully.
- composite Source/Grant FK referenced keys were changed from unique indexes to real UNIQUE constraints where PostgreSQL requires referenced uniqueness to exist before FK creation.
- fresh PostgreSQL integrity probe was added and executed successfully.
- PostgreSQL rejects invalid writes for:
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
- Entity/Alias case-only duplicate behavior was reproduced on real PostgreSQL.
- Source-scoped case-insensitive uniqueness is now enforced for Entity names and Aliases.
- fresh PostgreSQL re-migration after that change completed successfully.
- final `pnpm db:integrity` passed, including:
  - case-only Entity duplicate rejected within same Source;
  - same Entity spelling allowed in another Source;
  - case-only Alias duplicate rejected within same Source;
  - same Alias spelling allowed in another Source.

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
- Web/Admin Workers SPA fallback/deep-link checks.

## Remaining P0 before free/manual + AI-recording launch

### 1. Run local release preflight

Run:

- `pnpm release:preflight`

This still requires an actual HTTPS `AFTERTRACE_API_URL` according to deployment policy.

Preflight must cover:

- baseline guard;
- API/Web/Admin TypeScript;
- ESLint;
- Vitest;
- API/Web/Admin production builds / Worker dry-run;
- Drizzle schema export.

### 2. Runtime / browser / provider smoke

After preflight is green:

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
- baseline regeneration;
- baseline guard;
- Drizzle migration to fresh Neon PostgreSQL;
- fresh PostgreSQL integrity probes;
- case-insensitive Entity/Alias collision reproduction and final rejection validation.

Not yet executed:

- `pnpm release:preflight` after the latest DB/schema fixes;
- browser/PWA/Admin runtime smoke;
- Cloudflare Worker runtime/deploy smoke;
- LINE runtime smoke;
- real Gemini runtime smoke;
- final `/health/ready` on initialized launch environment.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, triggered or used as validation.

## Deployment status

**NOT READY yet.**

The regenerated baseline, fresh PostgreSQL migration, database Source/Grant integrity, and Entity/Alias case-insensitive uniqueness blockers are now cleared. The decisive remaining blockers are local release preflight and real browser/LINE/Gemini/Worker runtime smoke.
