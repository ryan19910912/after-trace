# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-13 validation PASS; clean Dev rebuild in progress

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. `/` remains the Record home page. Search remains independent. LINE is only provider-neutral LINE Login plus the external LINE OA support link.

Prelaunch Dev data is disposable. Canonical target database remains one generated `drizzle/0000_worklog_baseline.sql` from `apps/api/src/db/schema-all.ts`, with table/column comments and application-side domain validation.

## Current product boundary

FREE is a complete manual product with Record CRUD, latest 10, deterministic keyword/date search, groups, tasks/reminders, notifications and browser/device speech-to-text.

FREE receives one Admin-configured one-time **AI Search trial**. Those points may be spent only by natural-language AI Search.

AI Pro is required for every other provider-backed AI capability: AI text capture/organization, related Records, time-range summaries, rewrite suggestions, AI task proposals, image/audio/file AI and Chrome visible-tab screenshot AI.

## Latest implementation

- Record title is editable and revision history preserves `previous_title` / `new_title`.
- Web/API Record CRUD is title-aware.
- AI Search accepts FREE_TRIAL or AI_PRO; all non-search AI services require AI_PRO.
- AI media plan limits are backend-configured; current recommended defaults are 5 MB/image, 300 sec + 10 MB/audio, 10 MB/file, one image/request until multi-image ships.
- Audio duration is sent by Web, validated by API and enforced by the media service before provider work.
- Transport ceilings remain above plan defaults: 20 MB image, 30 MB audio, 30 MB file.
- Customer/Admin wording now describes the free allowance as an AI Search experience rather than an AI Pro trial.

## Canonical baseline

The baseline regeneration and guard now require:

- exactly one canonical `0000_worklog_baseline.sql`;
- matching Drizzle snapshot/journal metadata;
- `previous_title` / `new_title` on Record revisions;
- PostgreSQL comments for every persistent table and column;
- no PostgreSQL application-domain ENUM types;
- no business/domain CHECK constraints.

The user locally ran:

```text
pnpm db:baseline:regenerate --confirm-prelaunch-reset
```

Result: canonical generation completed and the baseline guard passed.

## Executable validation

Latest local run is PASS:

- monorepo typecheck: PASS;
- Admin tests: 20/20 PASS;
- API tests: 270/270 PASS;
- Web tests: 41/41 PASS;
- lint: PASS;
- Admin/API/Web/Extension builds: PASS.

No GitHub Actions were run or modified.

## Clean Dev rebuild finding

A first reset removed only `public`. API migration then printed success, but `/health/ready` returned `WORKLOG_TARGET_SCHEMA_UNAVAILABLE` because Drizzle migration history still existed separately and caused the canonical `0000` migration to be skipped.

Accepted prelaunch clean-reset procedure now clears both application tables and Drizzle migration history:

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
```

Then deploy API first:

```text
pnpm deploy:dev:api
```

The migration runner has been hardened to verify canonical core tables after Drizzle migration completion. It must fail if the migrator returns successfully but required public tables are missing.

`WORKLOG_DEPLOYMENT.md` now documents this complete reset procedure and the active workers.dev subdomain `after-lab`.

## Database/schema rules

- one canonical prelaunch SQL baseline;
- every persistent table has `COMMENT ON TABLE`;
- every persistent column has `COMMENT ON COLUMN`;
- no PostgreSQL enum for application domain/status values;
- no business/domain CHECK constraints;
- structural PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT stay in PostgreSQL;
- statuses, feature rules, pricing, point/media limits and transitions remain application logic.

## Runtime verification remaining

NOT YET RUNTIME VERIFIED for the current clean rebuild:

- Dev API readiness after clearing both `drizzle` and `public`;
- title-aware Record revision against rebuilt schema;
- AI Search FREE trial depletion;
- FREE blocked from non-search AI;
- AI Pro full AI paths;
- audio duration/media byte limits;
- Chrome screenshot-to-AI-Pro path;
- NewebPay TEST flow;
- LINE Login real browser smoke;
- Web/Admin deployment after API readiness.

Next operator step: perform the complete disposable Dev reset, rerun `pnpm deploy:dev:api`, and confirm `/health/ready` passes before deploying Web/Admin.
