# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-13 Record/AI entitlement refinement authored; validation pending

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
- Drizzle Record revision schema source now includes previous/new title fields so the target schema matches title-aware revision code.

Media limit path:

- Web sends audio duration to `/api/v1/ai/capture/audio`;
- route now requires/validates `durationSeconds` and passes it to `AiMediaCaptureService`;
- `AiMediaCaptureService` checks the active plan's configured audio-duration limit before provider work;
- route/client transport ceilings are intentionally above plan defaults: 20 MB image, 30 MB audio, 30 MB file;
- active plan limits remain the effective operator controls (recommended 5 MB image, 300 sec/10 MB audio, 10 MB file, one image/request until multi-image ships).

FREE AI Search trial enforcement:

- AI Search continues to accept FREE_TRIAL or AI_PRO;
- AI text capture now requires AI_PRO;
- related Records now require AI_PRO;
- time-range summary now requires AI_PRO;
- AI rewrite now requires AI_PRO;
- AI task proposal now requires AI_PRO;
- media AI already requires AI_PRO;
- Chrome screenshot AI therefore also requires AI_PRO through the media backend;
- customer/Admin/subscription/notification wording now calls the free allowance an AI Search experience rather than an AI Pro trial.

Documents aligned:

- `WORKLOG_PRODUCT_SPEC.md`;
- `WORKLOG_SUBSCRIPTION_POLICY.md`;
- `WORKLOG_AI_POINT_POLICY.md`;
- `WORKLOG_DEVELOPMENT_POLICY.md`;
- `WORKLOG_EXTENSION_POLICY.md`.

## Database/schema rules

Target rules remain:

- one canonical prelaunch SQL baseline;
- every persistent table has `COMMENT ON TABLE`;
- every persistent column has `COMMENT ON COLUMN`;
- no PostgreSQL enum for application domain/status values;
- no business/domain CHECK constraints;
- PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT remain structural DB responsibility;
- legal statuses, feature rules, pricing/point/media limits and transitions are application logic.

### Known schema synchronization item

AUTHORED in Drizzle schema source: Record revision history now has `previous_title` and `new_title`.

The checked-in canonical `drizzle/0000_worklog_baseline.sql` still needs to be regenerated/updated to include those two columns and their comments before the next clean database rebuild. Do not claim the canonical baseline is fully synchronized until this is completed.

## Validation status

Current batch is **AUTHORED / NOT RUN**.

No GitHub Actions were run or modified.

Recommended local validation after schema baseline synchronization:

- `pnpm --filter @aftertrace/api typecheck`
- `pnpm --filter @aftertrace/web typecheck`
- `pnpm --filter @aftertrace/admin typecheck`
- focused API/Web/Admin tests
- Web/Admin/API builds
- canonical baseline guard
- clean disposable Dev DB rebuild
- manual smoke: Record title edit/delete/restore, FREE AI Search trial, FREE rejection from non-search AI, AI Pro media/audio duration, Chrome screenshot AI, logout/login.

## Runtime verification remaining

NOT RUNTIME VERIFIED for this latest batch:

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
