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

## Current checkpoint — 2026-09-07 durable-session free manual Record API authored and mounted; Web client/UI and executable/schema/runtime verification remain pending

AFTERTRACE target product remains **Web + PWA-first work memory**, with optional Chrome extension. LINE is retired/migration-only and must not drive new product design.

This run continued directly from the durable user-id Web session + native GROUP HTTP checkpoint. It did not broad-audit the repository, did not run/modify/trigger GitHub Actions, did not reset Dev data, and did not touch the unrelated local `apps/api/verify-admin-schema.mjs`.

## Foundation retained from prior runs

The accepted target foundation remains:

- `worklog_records.occurred_at` nullable with no implicit current-time business default;
- nullable Record `title`, `extracted_metadata`, `ai_enriched_at` and explicit `ai_enrichment_status = NONE | ENRICHED | LEGACY`;
- existing rows forward-migrated to `LEGACY` rather than mislabeled as current paid-AI output;
- `worklog_users.line_user_id` nullable;
- provider-neutral `worklog_auth_identities` schema present;
- signed `WEB_SESSION` supports durable numeric `userId`, with LINE id only as bounded migration fallback;
- shared `resolveWebSessionUserId()` prefers durable `userId` and falls back to LINE only for old signed sessions;
- native GROUP Source `name`, nullable legacy `line_group_id`, `created_by_user_id`;
- GROUP membership `OWNER | MEMBER`;
- `worklog_source_invites` stores token hashes only;
- native GROUP HTTP API supports list/create/invite/revoke/join through durable Web sessions;
- subscription-plan AI hard-cap fields are present in target TypeScript schema;
- PWA GROUP surface model already exposes native `name` / `role` and treats LINE group id as migration-only trace.

Canonical generated `drizzle/0000` is still behind target TypeScript schema. Do not deploy/migrate this branch until executable validation and baseline regeneration are complete.

## Free manual Record target API — authored this run

New files:

- `apps/api/src/worklog/manual-record-routes.ts`
- `apps/api/src/worklog/drizzle-manual-record-routes.ts`
- `apps/api/src/worklog/manual-record-routes.test.ts`

Updated:

- `apps/api/src/worker.ts`

### Durable Web-session authorization

The target free/manual route module no longer resolves the current user from `session.lineUserId` directly.

Request flow is now:

1. verify signed `WEB_SESSION`;
2. create DB connection;
3. resolve authenticated AFTERTRACE user through `resolveWebSessionUserId()`;
4. prefer signed durable `userId`;
5. retain the shared resolver's legacy LINE fallback only for already-issued migration sessions;
6. authorize PRIVATE ownership or active native GROUP membership server-side for every scoped operation.

This means a future provider-neutral login can use the free Record core without acquiring a LINE identity first.

### Mounted target endpoints

`worker.ts` now routes the following `/api/v1/worklog` paths through the target manual Record module before legacy Worklog runtime initialization:

- `GET /surfaces`;
- `GET /records/personal`;
- `GET /records/personal/deleted`;
- `GET /records/group/:sourceId`;
- `GET /records/group/:sourceId/deleted`;
- `POST /records/personal`;
- `POST /records/group/:sourceId`;
- `PATCH /records/:recordId`;
- `DELETE /records/:recordId`;
- `POST /records/:recordId/restore`;
- `GET /records/:recordId/revisions`.

Legacy `/entities`, title move/batch-move, confirmations, funding and other old Worklog routes remain isolated behind the migration runtime for now. The target Web UI must stop depending on those old product surfaces before provider-neutral Web migration is considered complete.

### Free content-only create

Manual create now accepts `rawText` or target-friendly `content` and requires no provider work.

Accepted target behavior:

- content is required;
- `occurredAt` may be omitted/null;
- title may be omitted/null;
- legacy `entityId` is optional compatibility only and is Source-validated when supplied by an older client;
- created manual rows set `search_terms = []` and `ai_enrichment_status = NONE`;
- no title inference, date inference, keyword extraction or any provider AI call occurs.

The compatibility path may copy an explicitly selected legacy Entity name into nullable `record.title`, but new free clients do not need the Entity/Alias model.

### Nullable event date and deterministic retrieval

Manual Record views now preserve missing event dates as `occurredAt: null` instead of constructing an invalid JS `Date` from SQL `NULL`.

Manual update can explicitly clear `occurredAt` back to null. Invalid non-null date strings fail with `INVALID_OCCURRED_AT`.

Free deterministic list/search now:

- searches raw Record content;
- also remains compatible with explicit title / legacy Entity / existing `search_terms` metadata when present;
- scopes by authorized Source;
- excludes deleted rows from normal lists;
- date-filters on `COALESCE(occurred_at, created_at)`;
- orders by `COALESCE(occurred_at, created_at) DESC, id DESC`.

Therefore a content-only Record with no event time remains visible and date-filterable by storage time without inventing a business event time.

### Revision / optimistic concurrency

Manual PATCH/delete/restore use the current integer `version` and fail stale mutations with `RECORD_VERSION_CONFLICT`.

The Drizzle mutation CTE writes the updated Record and immutable `worklog_record_revisions` snapshot in the same SQL statement. `previous_occurred_at` and `new_occurred_at` remain nullable and are not coerced to current time.

Soft delete/restore remains status-based and keeps Record history.

### Free paths no longer eagerly construct LINE/Gemini runtime

Previously `worker.ts` called `configureWorklogRuntime(env)` before every non-health request. That function constructs legacy LINE attachment and Gemini normalization clients.

The Worker now routes Admin, Subscription, native GROUP and the new free/manual Record core before the legacy runtime boundary. Only migration-era confirmations/funding/old Worklog fallback and other retained legacy paths proceed through `configureWorklogRuntime`.

This is an important product boundary: provider-free manual Web/PWA use no longer needs to initialize retired LINE/Gemini machinery merely to read or edit Records.

## Tests authored this run

`apps/api/src/worklog/manual-record-routes.test.ts` covers the intended route contract with injected fake repository/session resolution:

- durable user-id-only signed session can reach target surfaces;
- signed LINE-only legacy session remains resolvable during migration;
- content-only free Record create with null event date/title;
- legacy Entity selection remains optional compatibility rather than a title requirement;
- malformed `occurredAt` is rejected;
- event date can be explicitly cleared to null;
- GROUP membership is enforced before list/create;
- delete/restore preserve optimistic version progression.

Test harness and query-row typing received small cleanup commits after authoring. These changes are source-level only until executable validation runs.

## Web client/UI mismatch discovered and intentionally left for next batch

`apps/web/src/worklog-api.ts` and `apps/web/src/WorklogRoot.tsx` still reflect the retired pre-reset product assumptions:

- `WorklogRecord.occurredAt` is typed as non-null string;
- API parsing currently turns SQL/API null into the string `"null"`;
- revision event dates are typed non-null;
- GROUP scope still carries `lineGroupId`;
- create/edit UI requires both title and event date;
- Record cards call `new Date(record.occurredAt)` unconditionally;
- the screen still eagerly loads legacy Entity, confirmation and GROUP-funding surfaces;
- primary login copy/flow still describes LINE Login;
- title move/batch-move and GROUP responsible-user funding UI remain visible legacy concepts.

Do not paper over these mismatches in the backend. The next coherent product batch is the Web/PWA client reset so the customer surface actually consumes the new free Record contract.

## Commits in this run

All commits contain `[skip ci]`:

- `46785dce` — add durable-session manual Record routes;
- `0062dda1` — persist nullable manual Records without AI;
- `68ce9321` — type manual route helpers explicitly;
- `c3d473a7` — route free core before legacy LINE/Gemini runtime;
- `ba9dafbf` — author durable manual Record route tests;
- `8a1ba925` — simplify manual route test harness;
- `4a524bc6` — normalize Drizzle manual Record query row typing;
- checkpoint doc commit follows this list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Validation status

### Authored / updated this run

- `apps/api/src/worklog/manual-record-routes.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/manual-record-routes.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/drizzle-manual-record-routes.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worker.ts` target-route boundary — **UPDATED / NOT RUN**

### Retained earlier tests still awaiting execution

- `apps/api/src/auth/token.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/native-groups.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/native-group-routes.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/records.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `product-record-schema.test.ts` — **AUTHORED / NOT RUN**
- `product-foundation-schema.test.ts` — **AUTHORED / NOT RUN**

### Executable validation

- API TypeScript typecheck — **NOT RUN**
- focused auth/native-group/manual-record tests — **NOT RUN**
- full API Vitest — **NOT RUN**
- Web TypeScript/build tests for target nullable contract — **NOT RUN**
- Drizzle baseline regenerate / guard — **NOT RUN**
- Dev DB forward migration — **NOT RUN**
- Native GROUP PostgreSQL invite concurrency smoke — **NOT RUN**
- free manual Record PostgreSQL smoke — **NOT RUN**
- Native GROUP + manual Record Dev HTTP E2E — **NOT RUN**

Reason: GitHub repository read/write access is available, but this run still has no mounted executable repository checkout. Container inspection found no `after-trace` working tree. No PASS or RUNTIME VERIFIED result is inferred from source review or commits.

## Known blockers / risks

1. **Executable validation remains the main immediate blocker.** New route/repository/Worker TypeScript and SQL have not been compiled or executed.
2. **Canonical Drizzle baseline remains behind target TypeScript schema.** Do not deploy/migrate until local executable validation and baseline regeneration are green.
3. **Current Web UI cannot safely consume nullable event dates yet.** It may parse null as `"null"` and render invalid dates.
4. **Current Web UI still requires title/date and retains Entity/move/funding/confirmation product concepts.** Backend target contract is ahead of the customer surface.
5. **Provider-neutral login itself is not implemented.** `worklog_auth_identities` exists at schema level; current real login is still LINE migration-era bootstrap.
6. **Several legacy Worklog routes remain LINE-shaped.** The target UI must stop depending on them or they must be migrated if a retained feature still needs them.
7. **Native GROUP API still has no target Web/PWA UI.** Domain/persistence/routes are authored only.
8. **Native GROUP invite locking and new manual Record SQL still need real PostgreSQL verification.**
9. **AI subscription hard caps are schema-only.** Runtime still contains legacy Grant-era provider accounting paths.
10. **Readiness/main app bindings still retain LINE migration dependencies.** Target free route isolation is improved, but full runtime cleanup is later.
11. **Tasks/reminders/push and Chrome extension remain unimplemented.**

## Exact next development order

1. Re-read required docs and this checkpoint; do not broad-audit.
2. If an executable checkout becomes available, immediately run API typecheck plus focused `auth/token`, native GROUP, manual Record, `records` and product-schema tests. Fix compile/test failures before claiming further runtime progress.
3. Reset `apps/web/src/worklog-api.ts` to the target free contract:
   - `occurredAt: string | null`;
   - revision previous/new event dates nullable;
   - preserve API null rather than converting it to `"null"`;
   - native GROUP surfaces carry `name` / `role` with only optional migration `legacyLineGroupId`;
   - manual create/edit accept omitted/null event date and omitted title.
4. Reset the primary `WorklogRoot.tsx` free UX:
   - GROUP scope no longer requires `lineGroupId`;
   - title is optional, not a save gate;
   - event date is optional and may be cleared;
   - no-event-date cards use `createdAt` for timeline presentation and label it as record/storage time rather than fabricated event time;
   - stop eagerly loading/showing legacy GROUP funding/responsible-user and pending LINE AI confirmations on the target free surface;
   - retire title move/batch-move from the primary free workflow unless later product requirements reintroduce an explicit user title feature;
   - keep manual text capture free/provider-free.
5. Add target native GROUP UI using `/api/v1/groups`: list/create, owner invite creation, invite join and revoke, with invite raw token displayed only at creation/share time.
6. Add focused Web/API contract tests for nullable dates, native GROUP surface shape and content-only manual create.
7. After API/Web local green, regenerate canonical `drizzle/0000`, run baseline guard, then apply the idempotent forward migration to Dev while preserving existing durable data.
8. Run Dev E2E:
   - target signed session -> surfaces;
   - create content-only PRIVATE Record with null event date -> list/search/edit -> set/clear date -> delete/restore -> revision history;
   - create native GROUP -> invite -> second authenticated user joins -> both can use manual GROUP Records -> revoke invite -> new join rejected while existing member retains access.
9. Only after free core/native GROUP are runtime green, wire paid per-user AI entitlement/hard caps and new AI capture/enrichment/natural-language search.
10. Then Related Records, summaries/rewrite, Tasks/Push, Chrome extension, readiness/runtime LINE isolation and final legacy schema cleanup.

## Remaining development estimate

Current estimate: **about 54–98 focused development hours** remaining.

Approximate buckets:

- executable validation, baseline/forward migration and native GROUP/manual API Dev E2E: 6–12h;
- target Web/PWA free UI reset + native GROUP UI + capture-first/browser speech-to-text work: 9–16h;
- paid per-user AI entitlement/caps + capture/enrichment/search: 15–27h;
- Related Records + summary/rewrite: 7–12h;
- Tasks/reminders + PWA Push/Cron: 7–13h;
- Chrome extension: 6–10h;
- readiness isolation, release hardening and final LINE cleanup: 4–8h.

This estimate should be tightened after the first successful executable typecheck/baseline migration and target Dev E2E. Those remain the largest uncertainty around legacy compatibility cost.
