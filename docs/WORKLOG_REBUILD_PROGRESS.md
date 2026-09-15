# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-15 shared FREE AI experience authored; validation pending

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. `/` remains the Record home page. Search remains independent. LINE is only provider-neutral LINE Login plus the external LINE OA support link.

Prelaunch Dev data is disposable. Canonical target database remains one generated `drizzle/0000_worklog_baseline.sql` from `apps/api/src/db/schema-all.ts`, with table/column comments and application-side domain validation.

## Current product boundary

FREE is a complete manual product with Record CRUD, latest 10, deterministic keyword/date search, groups, tasks/reminders, notifications and browser/device speech-to-text.

FREE now receives one Admin-configured one-time **shared AI experience allowance**. It does not refresh monthly. While points remain, the same FREE trial entitlement may use the accepted AI feature set:

- AI text capture/organization;
- natural-language AI Search;
- image/audio/file/PDF AI;
- Chrome screenshot AI;
- related Records;
- time-range summaries;
- rewrite suggestions;
- AI task proposals.

Provider-backed operations share the same FREE trial point ledger/reservation/settlement path. Once the trial is exhausted, provider-backed AI stops while normal FREE functions remain available.

AI Pro remains NT$99/month and provides recurring monthly AI resources for the complete AI feature set.

## Latest implementation

- AI text capture now accepts `FREE_TRIAL` or `AI_PRO` and settles usage through the shared ledger.
- media AI now accepts `FREE_TRIAL`; trial media uses conservative limits: 1 image/request, 5 MB/image, 300 sec + 10 MB/audio, 10 MB/file. AI Pro continues to use plan-configured media limits.
- summary, rewrite and AI task proposal now accept `FREE_TRIAL` or `AI_PRO` and settle provider usage normally.
- related Records now accepts FREE trial entitlement; its current PostgreSQL ranking remains deterministic and does not fabricate provider cost/point usage.
- Chrome screenshot AI now accepts any allowed AI entitlement rather than AI Pro only and uses the current `after-lab.workers.dev` origins.
- Web Capture, AI Tools, AI Task and Subscription copy now describe a generic one-time `免費 AI 體驗` rather than a Search-only trial.
- Admin FREE configuration now describes one shared AI experience balance and keeps the internal TWD-to-point calculator.
- FREE trial notification now links to `/capture` and explains that the allowance works across AI features.
- browser/device speech-to-text remains free and does not consume AI points.

## Canonical baseline / Dev DB

The canonical baseline regeneration and guard previously passed. No new database schema change is required for the shared FREE AI experience because the existing FREE_INITIAL grant and generic entitlement/ledger model already support the new capability boundary.

Accepted prelaunch clean-reset procedure remains:

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
```

The Dev schema has since been rebuilt successfully. API deployment/migration completed and schema readiness advanced past `WORKLOG_TARGET_SCHEMA_UNAVAILABLE`; current first-environment bootstrap remains blocked until AI runtime/commercial configuration is initialized.

## Last known executable validation

Before the 2026-09-15 shared FREE AI refactor, the latest local run was PASS:

- monorepo typecheck: PASS;
- Admin tests: 20/20 PASS;
- API tests: 270/270 PASS;
- Web tests: 41/41 PASS;
- lint: PASS;
- Admin/API/Web/Extension builds: PASS.

The current shared FREE AI refactor is **AUTHORED / NOT YET RUN**. Do not reuse the prior PASS as validation for this new batch.

No GitHub Actions were run or modified.

## Database/schema rules

- one canonical prelaunch SQL baseline;
- every persistent table has `COMMENT ON TABLE`;
- every persistent column has `COMMENT ON COLUMN`;
- no PostgreSQL enum for application domain/status values;
- no business/domain CHECK constraints;
- structural PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT stay in PostgreSQL;
- statuses, feature rules, pricing, point/media limits and transitions remain application logic.

## Validation/runtime remaining

Run locally after pulling the latest branch:

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Then runtime-smoke at least:

- FREE trial AI text organization;
- FREE trial AI Search;
- FREE trial image/audio/file and Chrome screenshot AI;
- FREE trial summary/rewrite/task proposal;
- trial depletion blocking provider-backed AI while manual functions continue;
- AI Pro monthly AI path;
- audio duration/media byte limits;
- AI Runtime + FREE/AI Pro bootstrap readiness;
- NewebPay TEST flow and cancellation;
- LINE Login real browser smoke.

GitHub Actions remain disabled unless explicitly requested.
