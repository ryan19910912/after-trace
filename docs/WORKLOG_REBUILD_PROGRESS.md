# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-13 Record/AI entitlement + baseline hardening authored; validation pending

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. `/` remains the Record home page for Web and installed PWA. Search remains an independent page. LINE remains only provider-neutral LINE Login plus the external LINE OA support link.

Prelaunch Dev data remains disposable. Canonical target database is still a single `drizzle/0000_worklog_baseline.sql` generated from `apps/api/src/db/schema-all.ts`, with table/column comments and application-side domain validation.

## Current product boundary

### FREE

FREE is a complete manual product:

- optional user-entered Record title;
- required text content;
- optional occurred time;
- create/edit/delete/restore;
- latest 10 Records on home;
- deterministic keyword/date search;
- groups;
- tasks/reminders;
- notifications;
- browser/device speech-to-text where supported.

FREE receives one Admin-configured one-time **AI Search trial**. Those points may be spent only by natural-language AI Search.

### AI Pro

AI Pro is required for every other provider-backed AI capability:

- AI text capture/organization;
- natural-language AI Search;
- related Records;
- time-range summaries;
- rewrite suggestions;
- AI task proposals;
- image AI;
- audio AI;
- file/PDF AI;
- Chrome visible-tab screenshot AI.

The generic `FREE_TRIAL` entitlement must not accidentally unlock non-search AI services.

## Latest authored implementation

Record/client consistency:

- `WorklogApi.updateRecord()` now types optional `title` directly; no cast workaround is needed.
- manual Record backend supports title/content/time editing.
- Drizzle Record revision schema source includes `previous_title` and `new_title` so title changes can be preserved in immutable revision history.

Media limit path:

- Web sends audio duration to `/api/v1/ai/capture/audio`;
- route requires/validates `durationSeconds` and passes it to `AiMediaCaptureService`;
- `AiMediaCaptureService` checks the active plan's configured audio-duration limit before provider work;
- route/client transport ceilings are intentionally above plan defaults: 20 MB image, 30 MB audio, 30 MB file;
- active plan limits remain the effective operator controls (recommended 5 MB image, 300 sec/10 MB audio, 10 MB file, one image/request until multi-image ships).

FREE AI Search trial enforcement:

- AI Search continues to accept FREE_TRIAL or AI_PRO;
- AI text capture requires AI_PRO;
- related Records require AI_PRO;
- time-range summary requires AI_PRO;
- AI rewrite requires AI_PRO;
- AI task proposal requires AI_PRO;
- media AI requires AI_PRO;
- Chrome screenshot AI therefore also requires AI_PRO through the media backend;
- customer/Admin/subscription/notification wording calls the free allowance an AI Search experience rather than an AI Pro trial.

Focused tests were updated to reflect the new product boundary for:

- AI text capture;
- media AI + audio duration limits;
- related Records;
- time-range summaries;
- AI rewrite;
- summary/rewrite route boundaries.

These tests are AUTHORED but have not yet been executed locally.

## Canonical database baseline hardening

The baseline guard now requires:

- `previous_title` and `new_title` in `worklog_record_revisions`;
- comments for those fields;
- PostgreSQL comments for **every table and every column** found in the canonical baseline;
- no PostgreSQL application-domain ENUM types;
- no business/domain CHECK constraints;
- exactly one canonical `0000_worklog_baseline.sql` and one Drizzle snapshot/journal pair.

The baseline regeneration script now:

- regenerates `0000_worklog_baseline.sql` + Drizzle snapshot from `schema-all.ts`;
- preserves the existing canonical migration identity timestamp;
- carries forward all existing table/column comments;
- supplies comments for the newly added Record revision title fields;
- fails instead of silently producing a baseline when a newly introduced table/column has no meaningful comment;
- runs the canonical baseline guard before reporting success.

### Remaining schema synchronization step

The checked-in `drizzle/0000_worklog_baseline.sql` and `drizzle/meta/0000_snapshot.json` still represent the previous generated schema. They must be regenerated once from the updated schema source before clean Dev rebuild/deployment.

Required one-time prelaunch command:

```powershell
pnpm db:baseline:regenerate --confirm-prelaunch-reset
```

Expected result after that command:

- revision table contains `previous_title` / `new_title`;
- both columns have PostgreSQL comments;
- snapshot matches schema source;
- only `0000_worklog_baseline.sql` remains as the SQL migration;
- baseline guard passes.

Do not deploy/rebuild the database before this regeneration is completed and reviewed.

## Database/schema rules

Target rules remain:

- one canonical prelaunch SQL baseline;
- every persistent table has `COMMENT ON TABLE`;
- every persistent column has `COMMENT ON COLUMN`;
- no PostgreSQL enum for application domain/status values;
- no business/domain CHECK constraints;
- PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT remain structural DB responsibility;
- legal statuses, feature rules, pricing/point/media limits and transitions are application logic.

## Validation status

Current batch is **AUTHORED / NOT RUN**.

No GitHub Actions were run or modified.

After baseline regeneration, run:

- `pnpm db:baseline:guard`
- `pnpm --filter @aftertrace/api typecheck`
- `pnpm --filter @aftertrace/web typecheck`
- `pnpm --filter @aftertrace/admin typecheck`
- focused API/Web/Admin tests
- Web/Admin/API builds
- clean disposable Dev DB rebuild
- manual smoke: Record title edit/delete/restore, FREE AI Search trial, FREE rejection from non-search AI, AI Pro media/audio duration, Chrome screenshot AI, logout/login.

## Runtime verification remaining

NOT RUNTIME VERIFIED for this latest batch:

- clean canonical baseline regeneration;
- title-aware Record revision against a rebuilt schema;
- AI Search FREE trial depletion;
- FREE blocked from text/media/tools/task AI;
- AI Pro full AI paths;
- audio duration configured limit;
- configured media byte limits;
- Chrome screenshot-to-AI-Pro path;
- NewebPay TEST flow after latest code;
- LINE Login real browser smoke.

GitHub Actions were not run or modified.
