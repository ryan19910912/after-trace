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

## Current checkpoint — 2026-09-07 first Web/PWA schema foundation authored; validation and baseline regeneration pending

AFTERTRACE target product is **Web + PWA-first work memory**, with optional Chrome extension. LINE is retired/migration-only and must not drive new product design.

The first target-schema batch is now authored without deleting legacy LINE tables or historical Grant/usage data.

### Completed this run

Record foundation:

- `worklog_records.occurred_at` is now nullable and no longer defaults to current time; a free/manual Record may legitimately have no business event time;
- Record revisions allow nullable previous/new event times;
- direct nullable Record `title` is available without requiring the legacy Entity/Alias model;
- nullable `extracted_metadata` and `ai_enriched_at` were added;
- explicit `worklog_record_ai_enrichment_status = NONE | ENRICHED | LEGACY` was added so historical state is not guessed from nullable metadata;
- existing pre-reset rows are marked `LEGACY` by the forward migration rather than retroactively claiming they are paid-AI enriched;
- record list/read mapping now handles nullable event time and sorts undated Records by `created_at` fallback;
- record title read path uses direct `record.title` first with legacy Entity name fallback.

Web/PWA identity and native GROUP foundation:

- `worklog_users.line_user_id` is nullable in the target schema so future accounts do not require LINE identity;
- new provider-neutral `worklog_auth_identities` table maps `(provider, subject)` to a user;
- GROUP Source now supports a native non-empty `name` without `line_group_id`; legacy LINE GROUP rows remain valid;
- GROUP Source has nullable `created_by_user_id` for migration compatibility;
- Source membership now has explicit `OWNER | MEMBER` role, defaulting existing/unspecified membership to `MEMBER`;
- new `worklog_source_invites` stores only invite-token hashes plus revoke/expiry/use-limit facts; raw invite tokens are not persisted;
- an invite is only metadata and does not itself grant access; authenticated join must still write actual membership in later runtime work.

Paid AI plan foundation:

- plan schema now has `ai_enabled`;
- monthly internal AI point/resource cap;
- monthly actual provider-cost cap in TWD;
- optional per-request AI point cap;
- schema checks require positive cap values and require an AI-enabled plan to be a paid SUBSCRIPTION with both monthly hard caps configured;
- legacy `grant_points` remains temporarily for historical/prelaunch accounting and existing runtime compatibility.

Migration/export foundation:

- `schema-worklog-product.ts` is exported by canonical `schema-all.ts`;
- idempotent forward-compatibility migration was added for existing databases;
- migration preserves all existing user/Record/revision/Grant/usage data and does not delete LINE tables;
- existing LINE identities/group ids remain intact while new target fields/tables are added.

### Files / commits this run

- `63ea7eecb8d70c8973be98c2f93007d293960237` — `[skip ci] make records compatible with free manual capture` — `apps/api/src/db/schema-worklog-record-core.ts`
- `452e3d32dcb26febdcc7e2893033202403b834d3` — `[skip ci] add record product reset forward migration` — `apps/api/scripts/forward-compat.mjs`
- `e57055668950d7055105d7271de082af97be8e4e` — `[skip ci] allow records without event time` — `apps/api/src/worklog/records.ts`
- `a13fde97df9091e53f382a2eeffd97d340059c2d` — `[skip ci] read nullable event times safely` — `apps/api/src/worklog/drizzle-records.ts`
- `3e0b53a3123794d8a3d8a7e66a46e6c227316ec1` — `[skip ci] cover free record schema contract` — `apps/api/src/worklog/product-record-schema.test.ts`
- `1f7c10e82e7b4d39148be8c994ddbba1a6e43be5` — `[skip ci] add native group and AI plan schema foundation` — `apps/api/src/db/schema-worklog.ts`
- `9b7926a4c0eb12050e0aa2a43d93a7a5a2daaf40` — `[skip ci] add web auth identity and group invite schema` — `apps/api/src/db/schema-worklog-product.ts`
- `33b8cb6baf13d7db5a797d331832ab5781bd82a7` — `[skip ci] export web PWA product schema` — `apps/api/src/db/schema-all.ts`
- `0c4363ba7b117f781c9fa26c3545c03d2e34f7cf` — `[skip ci] add web PWA foundation forward migration` — `apps/api/scripts/forward-compat.mjs`
- `e087cefb50c46219b3bc259ae0792e63b585fc06` — `[skip ci] cover native product foundation schema` — `apps/api/src/worklog/product-foundation-schema.test.ts`

### Tests / validation

- `apps/api/src/worklog/product-record-schema.test.ts` — **AUTHORED / NOT RUN**;
- `apps/api/src/worklog/product-foundation-schema.test.ts` — **AUTHORED / NOT RUN**;
- API TypeScript typecheck — **NOT RUN**;
- focused API Vitest tests — **NOT RUN**;
- full API test suite — **NOT RUN**;
- canonical Drizzle baseline regeneration — **NOT RUN**;
- baseline guard — **NOT RUN**;
- forward migration against existing Dev DB — **NOT RUN**;
- Dev runtime verification — **NOT RUN**;
- GitHub Actions — **NOT USED**.

The repository connector can edit GitHub but does not provide a local Node execution environment. A separate container attempt could not reach GitHub, so no test result is being inferred or claimed.

### Known blockers / risks

1. **Canonical fresh-DB baseline is temporarily behind the TypeScript schema.** `drizzle/0000` and snapshot metadata must be regenerated with the repository command before any fresh-DB/deployment claim. Do not hand-edit Drizzle snapshot metadata.
2. **Typecheck is still required.** Making `line_user_id` and `occurred_at` nullable may expose legacy TypeScript assumptions that must be adapted; no compile-green claim exists yet.
3. **Forward migration is authored but not executed against Dev.** Preserve Dev DB; run the normal idempotent migration path only after local static/unit validation.
4. **Native GROUP runtime is not implemented yet.** Existing Web/PWA group listing still exposes legacy `lineGroupId`; invite create/join/revoke and OWNER authorization are schema-only so far.
5. **Provider-neutral auth runtime is not implemented yet.** Existing login/bootstrap remains LINE-oriented while `worklog_auth_identities` is only the target storage foundation.
6. **Paid AI hard caps are not enforced yet.** Fields/checks exist, but Admin UI/API and provider admission/settlement still use legacy Grant-era behavior.
7. **Task/reminder/push schema is still pending Phase 1 work.** Do not add an intentional Cloudflare reminder Cron until its durable scheduler/delivery model exists.
8. Legacy LINE runtime/schema remains intentionally present until replacement Web/PWA paths are proven.

## Accepted target product summary

- PWA landing is microphone-first;
- Web is full timeline/search/edit/group/subscription surface;
- Chrome extension is fast desktop capture;
- groups are native AFTERTRACE groups joined by invite link;
- free users have manual Record CRUD + deterministic content/date search;
- free browser/device speech-to-text is allowed when it does not call AFTERTRACE provider AI;
- free Records require content plus system timestamps; `occurred_at` is optional;
- free Records do not require title/keywords/entities;
- AI is a paid per-user subscription capability;
- GROUP AI responsible-user model is retired;
- no historical AI backfill when a free user later subscribes;
- new paid AI operations may generate title/keywords/date/bounded retrieval entities;
- paid AI supports natural-language search, related Records, time-range summaries, AI rewrite, multimodal input and task extraction;
- AI Q&A is later/conditional on grounding quality;
- native tasks + PWA push are accepted before Calendar integration;
- Cloudflare Cron is the intended reminder scheduler, with Queue only when fan-out requires it;
- paid AI has Admin-configurable fair-use/resource caps and actual provider-cost cap in TWD;
- frontend subscription copy discloses fair-use/monthly resource limits;
- product name remains AFTERTRACE for now.

## Target implementation phases

### Phase 1 — schema/domain foundation

Completed/authored in first batch:

- optional Record event time and AI enrichment metadata/status;
- provider-neutral auth identity storage;
- native GROUP name/creator/member roles;
- hashed invite-token storage;
- subscription AI hard-cap fields;
- safe existing-DB forward migration for those fields/tables.

Still pending:

- local validation and canonical baseline regeneration;
- native GROUP/invite service rules;
- target auth service/repository rules;
- task/reminder/push subscription schema;
- optional subscription-period usage aggregate structure only if current usage rows cannot enforce the target caps safely.

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

## Exact next run

1. re-read this checkpoint and inspect only the files needed for the next batch;
2. inspect current native-group-related service/routes and target auth boundary, not the retired LINE feature surface broadly;
3. implement native GROUP repository/service primitives: create named GROUP, OWNER membership, create/revoke invite, authenticated join, membership authorization;
4. ensure invite use is atomic/idempotent and raw invite tokens are never persisted;
5. change the target PWA surface DTO away from mandatory `lineGroupId` toward native group `name`, while preserving any legacy adapter needed temporarily;
6. author focused native-group/invite tests and mark them **AUTHORED / NOT RUN** unless actually executed;
7. if a local execution environment becomes available, run API typecheck plus the two schema tests and new group tests before adding more schema;
8. regenerate canonical Drizzle baseline + guard only in a real repository checkout; do not fabricate snapshot metadata;
9. only after local green, apply the idempotent forward migration to Dev and verify schema/readiness manually;
10. then continue free manual Web/PWA Record CRUD/search before paid AI runtime work.

## Estimated remaining development time

After authoring the first schema foundation batch, current planning estimate is approximately:

- finish Phase 1 validation/native group/auth/task foundations: **~8–15 focused hours**;
- free Web/PWA core: **~14–24 hours**;
- paid AI core and hard-cap runtime/Admin wiring: **~16–28 hours**;
- related Records/summaries/rewrite/tasks-push completion: **~13–22 hours**;
- Chrome extension first usable version: **~8–15 hours**;
- safe LINE cleanup/migration hardening + Dev/Prod smoke: **~8–16 hours**.

Current total range: **~67–120 focused development hours**. This range is slightly wider rather than artificially lower because the first schema inspection exposed real replacement work for provider-neutral auth and native GROUP runtime. Re-estimate after typecheck/migration validation and after the first native GROUP E2E.

## Hourly run handoff format

Every scheduled run must update this checkpoint with:

- **Completed this run**;
- **Files/commits**;
- **Tests** (`AUTHORED`, `NOT RUN`, `PASS`, `FAIL`, `RUNTIME VERIFIED`);
- **Known blockers/risks**;
- **Next run**;
- **Estimated remaining time**.

Do not restart broad static audit each hour. Continue from the exact latest checkpoint and only inspect code needed for the next planned batch.

No GitHub Actions. Preserve Dev DB. Manual deployment only.