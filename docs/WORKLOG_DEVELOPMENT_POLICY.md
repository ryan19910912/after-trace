# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

Before substantive product/domain/schema/runtime work, read in this order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. this file
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. `docs/WORKLOG_REBUILD_PROGRESS.md`

The latest documents above are the only product/development specification.

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

Every development commit on this branch must include `[skip ci]`.

## Current architecture direction

AFTERTRACE is **Web + PWA-first** with optional Chrome extension fast capture.

- LINE is retired from the target customer product;
- PWA is capture-first with microphone as the primary action;
- Web is the full timeline/search/edit/group/subscription surface;
- Chrome extension reuses the same API/domain model;
- groups are created in AFTERTRACE and joined through invite links;
- free users get manual CRUD/search/date filtering and non-provider browser speech-to-text where available;
- paid AI entitlement is per user;
- no GROUP AI responsible-user concept in the target product;
- no automatic AI backfill when a free user subscribes later.

## Product behavior boundary

Free/manual Record:

- content;
- nullable user-entered event date/time;
- created timestamp;
- updated timestamp;
- no required AI title/keywords/entities.

Paid AI may add title, keywords/search terms, date interpretation and bounded retrieval metadata for new AI operations only.

Do not silently call AI during manual CRUD.

## AI features currently accepted

High-priority paid AI capabilities:

- natural-language text capture;
- AI voice capture;
- image/file/PDF input;
- automatic title/keywords/date;
- bounded extraction metadata for retrieval;
- natural-language search;
- related Records;
- time-range summary;
- explicit AI rewrite;
- task extraction/proposal;
- later grounded Q&A when retrieval quality is sufficient.

Do not prioritize project/group AI summaries as a standalone feature.

## Subscription fair-use / hard-cap rule

Paid AI must not be marketed as mathematically unlimited compute. Frontend must disclose fair-use/monthly resource limits.

Admin/runtime must support hard caps including:

- monthly internal AI resource/point cap;
- monthly actual provider-cost cap in TWD;
- optional per-request/modality limits;
- feature capability toggles.

New provider work fails closed once a hard cap is reached. Actual provider cost is the operational safety boundary.

## Tasks / reminders

Native AFTERTRACE task list + PWA push is accepted before Calendar integration.

Target reminder architecture:

- durable task/reminder timestamp;
- Cloudflare Worker Cron at a bounded interval such as 5 minutes;
- bounded due-row scan;
- idempotent delivery state;
- Cloudflare Queue only when volume/fan-out justifies it.

AI may interpret a reminder phrase but persisted schedule/action is deterministic and user-confirmed.

## Migration away from LINE

Do not continue adding LINE product features.

LINE-specific code/schema may remain temporarily while replacements are implemented. Remove only when safe and preserve unrelated durable data.

Priority is to replace product dependencies in this order:

1. authentication/account assumptions;
2. native AFTERTRACE group membership/invites;
3. PWA/Web capture and manual Record model;
4. per-user paid AI entitlement/caps;
5. natural-language search and AI enrichment;
6. tasks/reminders/push;
7. Chrome extension;
8. delete/isolate retired LINE runtime/schema after dependency review.

## SQL / PostgreSQL safety rules

Raw SQL and Drizzle templates must avoid PostgreSQL reserved/command keywords as unquoted aliases/CTE names/identifiers.

Hard rule:

- never use `grant` as a SQL alias;
- for `worklog_ai_grants`, use `g`, `ai_grant`, or `grant_row`;
- apply the same discipline to `user`, `group`, `order`, `limit`, `offset`, `constraint`, `table`, `column`, etc.;
- when PostgreSQL returns `42601`, inspect alias/identifier collisions before speculative schema/date changes;
- retain repository regression coverage for the known `grant` alias issue.

## Database migration policy

Preserve existing Dev DB unless safe forward migration is genuinely impossible.

- do not rebuild Dev/Prod simply because target schema changes;
- add replacements before dropping legacy dependencies where needed;
- preserve Record/revision/user/subscription/usage/audit facts;
- remove LINE-specific schema only after dependency review;
- keep migration scripts idempotent.

The unrelated local untracked `apps/api/verify-admin-schema.mjs` must not be staged/committed unless separately reviewed/approved.

## Validation policy

Prefer focused local validation after each coherent batch, then broader package/release validation at milestones.

Do not claim a test passed unless the user actually ran it or an available execution environment ran it and returned PASS. Never infer passing tests from compilation or code inspection.

## Hourly development handoff format

Every scheduled development run must first read the latest product docs and the latest `WORKLOG_REBUILD_PROGRESS.md`, then continue from the recorded checkpoint rather than restarting analysis.

Each run must update `WORKLOG_REBUILD_PROGRESS.md` with:

- what was completed in this run;
- commits/files changed;
- tests actually completed and their real status;
- tests still required;
- known blockers/risks;
- the exact next work batch;
- estimated remaining development time/range based on current scope;
- a short `next run` checklist.

The report must distinguish `AUTHORED`, `NOT RUN`, `PASS`, `FAIL`, `RUNTIME VERIFIED` and must never label an unexecuted test as passed.

## Commit discipline

Prefer small coherent commits. Every development commit includes `[skip ci]`. Do not touch GitHub Actions.
