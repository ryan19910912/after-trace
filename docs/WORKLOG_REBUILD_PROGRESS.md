# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every substantive development run, in this exact order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

Latest docs are the only product/development specification. Never use GitHub Actions unless explicitly requested. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 product reset accepted

AFTERTRACE target product changed from LINE-integrated worklog to **Web + PWA-first work memory**, with optional Chrome extension.

Accepted product changes now documented:

- LINE OA/GROUP is retired from target product;
- PWA landing is microphone-first;
- Web is full timeline/search/edit/group/subscription surface;
- Chrome extension is fast desktop capture;
- groups are native AFTERTRACE groups joined by invite link;
- free users have manual Record CRUD + deterministic content/date search;
- free browser/device speech-to-text is allowed when it does not call AFTERTRACE provider AI;
- free Records require content + occurred/created/updated times only;
- free Records do not require title/keywords/entities;
- AI is a paid per-user subscription capability;
- GROUP AI responsible-user model is retired;
- no historical AI backfill when a free user later subscribes;
- new paid AI operations may generate title/keywords/date/bounded retrieval entities;
- paid AI supports natural-language search, related Records, time-range summaries, AI rewrite, multimodal input and task extraction;
- AI Q&A is later/conditional on grounding quality;
- native tasks + PWA push are accepted before Calendar integration;
- Cloudflare Cron is the intended reminder scheduler, with Queue only when fan-out requires it;
- paid AI must have Admin-configurable fair-use/resource caps and actual provider-cost cap in TWD;
- frontend subscription copy must disclose fair-use/monthly resource limits;
- product name remains AFTERTRACE for now.

## Documentation changes completed in this reset

Updated:

- `WORKLOG_PRODUCT_SPEC.md`;
- `WORKLOG_ENTITY_MODEL.md`;
- `WORKLOG_RECORD_EDIT_POLICY.md`;
- `WORKLOG_AI_POINT_POLICY.md`;
- `WORKLOG_DEVELOPMENT_POLICY.md`;
- `WORKLOG_LINE_CONTENT_POLICY.md` now marks LINE as retired/migration-only;
- `WORKLOG_DEPLOYMENT.md` now includes native reminder Cron/PWA push target.

## Current code state

The codebase still contains substantial legacy LINE runtime/schema and old Grant/responsible-user concepts. These are **migration debt**, not the target product.

Do not spend new feature time polishing LINE E2E. Preserve data and remove dependencies gradually as Web/PWA replacements land.

Recent repository safety work before product reset also added a regression test preventing PostgreSQL `worklog_ai_grants grant` alias usage. Keep that protection until legacy Grant code is removed.

## Target implementation phases

### Phase 1 — schema/domain foundation

- make Record title/search metadata nullable/optional according to free/manual Record rules;
- confirm `occurred_at`, `created_at`, `updated_at` semantics;
- define explicit AI enrichment status/audit markers if needed;
- define AFTERTRACE-native group/invite/membership schema;
- define subscription-period resource/cost cap fields/capabilities;
- define task/reminder/push subscription schema;
- add safe forward migrations preserving existing Dev data.

### Phase 2 — free Web/PWA core

- manual Record create/edit/delete/restore;
- deterministic content/date search;
- PRIVATE + native GROUP authorization;
- invite-link group join;
- PWA microphone-first capture shell;
- free speech-to-text path where browser support permits;
- no provider AI on free/manual paths.

### Phase 3 — paid AI core

- per-user AI entitlement checks;
- hard monthly resource/point cap;
- hard monthly actual provider-cost cap TWD;
- feature capability gates;
- AI text/voice/image/file interpretation;
- new-record title/keywords/date/entity enrichment only;
- no old-record backfill.

### Phase 4 — retrieval/value features

- natural-language search across old raw content + new AI metadata;
- related Records;
- time-range summary;
- AI rewrite preview/accept;
- grounded Q&A only after retrieval quality is adequate.

### Phase 5 — tasks/reminders

- task list;
- AI task proposal + confirmation;
- reminder timestamps;
- PWA Web Push subscription;
- Cloudflare `scheduled()` due scan;
- idempotent notification delivery;
- Queue fan-out only if needed.

### Phase 6 — Chrome extension

- auth/session handoff;
- quick text;
- microphone capture;
- destination Source/group;
- optional current-page title/URL later.

### Phase 7 — legacy cleanup

- remove LINE webhook/OA/GROUP command runtime;
- remove Reply cache/attachment replay/mentions/profile refresh;
- remove LINE membership authorization dependencies;
- remove GROUP AI responsible-user runtime;
- remove obsolete schema/bindings only after retained data/dependency review;
- update readiness/deployment env requirements.

## Validation status at product reset

No new product-reset code tests have been run yet because this batch is documentation-only.

Status:

- product/domain docs — **UPDATED**;
- implementation tests for new Web/PWA product — **NOT RUN / not yet authored for new behavior**;
- legacy API targeted tests from immediately before reset had mixed recent results and must not be treated as proof of the new product;
- GitHub Actions — **NOT USED**.

## Immediate next work batch

1. inspect current canonical schema and Web/PWA routes against the new product spec;
2. identify which existing tables/services can be retained unchanged;
3. design the smallest forward-compatible schema delta for optional Record AI metadata + native groups/invites + subscription caps;
4. implement the first schema/domain batch without deleting legacy LINE tables;
5. author focused tests;
6. ask/run local validation before deployment;
7. continue to free Web/PWA manual flow before paid AI features.

## Estimated remaining development time

Current rough estimate, assuming one developer and reuse of existing API/Admin/Web foundation:

- target MVP foundation through free Web/PWA + paid AI core: **~30–50 focused development hours**;
- add related Records, summaries, rewrite, tasks/push: **~15–25 hours**;
- Chrome extension first usable version: **~8–15 hours**;
- safe LINE cleanup/migration hardening + Dev/Prod smoke: **~10–20 hours**.

Total current range: **~63–110 focused development hours**. This is a planning estimate, not a deadline. Re-estimate after each major phase based on actual schema/runtime findings.

## Hourly run handoff format

Every scheduled run must append/update this checkpoint with:

- **Completed this run**;
- **Files/commits**;
- **Tests** (`AUTHORED`, `NOT RUN`, `PASS`, `FAIL`, `RUNTIME VERIFIED`);
- **Known blockers/risks**;
- **Next run**;
- **Estimated remaining time**.

Do not restart broad static audit each hour. Continue from the exact latest checkpoint and only inspect code needed for the next planned batch.

No GitHub Actions. Preserve Dev DB. Manual deployment only.
