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

## Current checkpoint — 2026-09-07 durable user-id Web sessions and authenticated native GROUP HTTP API authored; executable/schema/runtime verification still pending

AFTERTRACE target product remains **Web + PWA-first work memory**, with optional Chrome extension. LINE is retired/migration-only and must not drive new product design.

This run continued directly from the native GROUP service/persistence checkpoint. It did not broad-audit the repository, did not run/modify/trigger GitHub Actions, did not reset Dev data, and did not touch the unrelated local `apps/api/verify-admin-schema.mjs`.

## Foundation retained from prior runs

The accepted target foundation remains:

- `worklog_records.occurred_at` nullable with no implicit current-time business default;
- nullable Record `title`, `extracted_metadata`, `ai_enriched_at` and explicit `ai_enrichment_status = NONE | ENRICHED | LEGACY`;
- existing rows forward-migrated to `LEGACY` rather than mislabeled as current paid-AI output;
- `worklog_users.line_user_id` nullable;
- provider-neutral `worklog_auth_identities` schema present;
- native GROUP Source `name`, nullable legacy `line_group_id`, `created_by_user_id`;
- GROUP membership `OWNER | MEMBER`;
- `worklog_source_invites` stores token hashes only;
- subscription-plan AI hard-cap fields are present in target TypeScript schema;
- native GROUP service/repository already create owner membership, create/revoke invites and join with concurrency-oriented invite locking;
- invite join never restores historical OWNER role and repeated active-member join does not consume another invite use;
- PWA GROUP surface model no longer requires LINE group id.

Canonical generated `drizzle/0000` is still behind target TypeScript schema. Do not deploy/migrate this branch until executable validation and baseline regeneration are complete.

## Durable Web session identity — authored this run

Changed:

- `apps/api/src/auth/token.ts`
- `apps/api/src/auth/token.test.ts`
- `apps/api/src/auth/session-user.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/service.ts`

### Target session contract

`WEB_SESSION` now carries durable numeric `userId` as the target identity. The session token may also carry the legacy LINE user id during migration, but new target code must prefer `userId`.

A Web session can now be issued with **only numeric `userId`**, so future authentication providers do not need LINE identity.

For bounded source compatibility, `WebSessionClaims.lineUserId` remains a deprecated string field while old route modules are migrated. Empty string means the signed target session has no legacy LINE identity. This is intentionally temporary compatibility data and must not become a new product dependency.

### Backward compatibility

Already-issued LINE-era sessions remain verifiable:

- old LINE-only session -> `userId = null`, valid legacy `lineUserId`;
- new target session -> positive `userId`, legacy LINE field may be empty;
- migration session -> positive `userId` plus real legacy LINE id when the current login provider supplied one.

At least one signed user identity is still required.

### Login/exchange behavior

Current LINE Login remains only a migration-era authentication provider. After bootstrap it now issues a session containing both:

- durable `user.userId`;
- legacy LINE user id for bounded compatibility.

PRIVATE legacy bot-entry exchange already knows durable user id and now preserves it in the resulting Web session.

Retired GROUP bot-entry exchange still issues a LINE-only session because that legacy path does not currently carry durable numeric user id at the exchange boundary. Do not expand that path; remove it later with LINE cleanup.

### Shared session-user resolver

New `resolveWebSessionUserId(database, session)`:

1. prefers signed durable `session.userId` and verifies that user row exists;
2. falls back to `line_user_id` lookup only when a legacy session lacks durable user id;
3. returns no user when neither resolves.

This is the target bridge for Web/PWA route migration.

## Native GROUP list/API — authored this run

Changed:

- `apps/api/src/worklog/native-groups.ts`
- `apps/api/src/worklog/drizzle-native-groups.ts`
- `apps/api/src/worklog/native-groups.test.ts`
- `apps/api/src/worklog/native-group-routes.ts`
- `apps/api/src/worklog/native-group-routes.test.ts`
- `apps/api/src/worker.ts`

### List groups

Native GROUP repository/service can now list only active AFTERTRACE-native GROUPs where the authenticated user has active membership. Returned data is:

- `sourceId`;
- native `name`;
- `OWNER | MEMBER` role.

Legacy LINE-backed GROUP Sources are excluded from this target listing.

### Mounted HTTP API

`worker.ts` now mounts target native GROUP routes at `/api/v1/groups` before the broader legacy-shaped Worklog Web API.

Accepted authored endpoints:

- `GET /api/v1/groups` — list current user's native GROUP memberships;
- `POST /api/v1/groups` — create named GROUP and OWNER membership;
- `POST /api/v1/groups/:sourceId/invites` — OWNER creates invite;
- `DELETE /api/v1/groups/:sourceId/invites/:inviteId` — OWNER revokes invite;
- `POST /api/v1/groups/join` — authenticated user joins by raw invite token.

These routes use signed durable Web sessions through `resolveWebSessionUserId`; they do not require LINE identity when `userId` exists.

Raw invite token is returned only in the successful invite-create response. Persistence continues to receive only the SHA-256 hash. The route does not log the raw token.

Route error boundaries intentionally avoid distinguishing revoked/expired/exhausted/unknown invite tokens: all are exposed as `INVALID_INVITE`.

Invite creation/revocation still relies on repository OWNER authorization. Join results never promote through an invite; the target join role remains `MEMBER`.

## Important remaining auth migration debt

The new `/api/v1/groups` route is user-id first, but several older Web route modules remain LINE-shaped during migration:

- `apps/api/src/worklog/routes.ts`;
- `apps/api/src/worklog/confirmation-routes.ts`;
- `apps/api/src/worklog/subscription-routes.ts`;
- `apps/api/src/worklog/funding-routes.ts` and other legacy funding surfaces.

They still resolve users from `session.lineUserId`. Because target user-only sessions expose an empty deprecated LINE field, those old modules will fail to resolve the user rather than accidentally bind to another account. They must be migrated deliberately to `resolveWebSessionUserId` before provider-neutral Web auth is considered complete.

`worklog/routes.ts` is the next priority because it owns the free manual timeline/CRUD/search surface. Funding routes are legacy Grant/responsible-user product behavior and should not receive new feature work beyond migration safety.

## Free Record route debt still open

`apps/api/src/worklog/routes.ts` still contains pre-reset assumptions:

- `RecordSnapshot.occurredAt` non-null type;
- `new Date(String(row.occurred_at))` on nullable data;
- manual mutation path requires non-null event date;
- ordering/filter logic still centers directly on event date instead of nullable event-date + created-time fallback;
- manual create/move still reflects old required Entity/title behavior.

Handle this as one focused free Web/PWA CRUD/search rewrite after the route auth identity is migrated. Do not fix it inside retired LINE runtime.

## Commits in this run

All commits contain `[skip ci]`:

- `d1052963` — make Web sessions durable-user-id capable;
- `1276e221` — add durable/legacy Web-session token tests;
- `1960146f` — add durable-first Web-session user resolver;
- `c47bd224` — issue durable user session after current LINE Login bootstrap;
- `276bc26f` — preserve durable user id in PRIVATE legacy entry exchange;
- `45e5806e` — add native GROUP listing contract;
- `ff3cbe84` — list active authorized native GROUPs in Drizzle repository;
- `2c3dfb56` — update native GROUP service tests for listing;
- `95653a10` — add authenticated native GROUP HTTP routes;
- `2c9311d5` — author native GROUP HTTP contract tests;
- `2d9101f6` — mount `/api/v1/groups` in Worker routing;
- `ca08fab9` — keep deprecated LINE session field bounded for compile/source migration compatibility;
- `23fb909a` — align target user-only session test with bounded compatibility representation;
- checkpoint doc commit follows this list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Validation status

### Authored / updated

- `apps/api/src/auth/token.test.ts` — **AUTHORED/UPDATED / NOT RUN**
  - durable user-only session;
  - LINE-only legacy session;
  - mixed migration session;
  - identity-required validation;
  - token type/signature separation.
- `apps/api/src/worklog/native-groups.test.ts` — **AUTHORED/UPDATED / NOT RUN**
  - authenticated native GROUP listing plus prior create/invite/join rules.
- `apps/api/src/worklog/native-group-routes.test.ts` — **AUTHORED / NOT RUN**
  - user-id-only authenticated list/create;
  - one-time raw invite response;
  - non-owner invite-create denial;
  - common invalid response for revoked/expired/exhausted/unknown invite;
  - repeated join returns `ALREADY_MEMBER`;
  - invite join remains `MEMBER`;
  - revoke forbidden/not-found non-disclosure.
- preceding `records.test.ts`, `product-record-schema.test.ts`, `product-foundation-schema.test.ts` — **AUTHORED/UPDATED / NOT RUN**.

### Executable validation

- API TypeScript typecheck — **NOT RUN**
- `auth/token.test.ts` — **NOT RUN**
- `native-groups.test.ts` — **NOT RUN**
- `native-group-routes.test.ts` — **NOT RUN**
- `records.test.ts` — **NOT RUN**
- focused schema tests — **NOT RUN**
- full API Vitest — **NOT RUN**
- Drizzle baseline regenerate / guard — **NOT RUN**
- Dev DB forward migration — **NOT RUN**
- Native GROUP PostgreSQL concurrency smoke — **NOT RUN**
- Native GROUP Dev HTTP E2E — **NOT RUN**

Reason: this run has GitHub repository mutation access but no network-capable/mounted executable repository checkout. A direct container GitHub access attempt cannot resolve `github.com`. No PASS/RUNTIME VERIFIED result is inferred from authored source.

## Known blockers / risks

1. **Executable validation is still pending.** New token/session/route TypeScript has not been compiled or executed.
2. **Canonical Drizzle baseline remains behind target schema.** Do not deploy/migrate until real-checkout validation and baseline regeneration are green.
3. **Old Worklog Web routes are not yet user-id first.** User-only target sessions currently work for `/api/v1/groups` but not the older manual Worklog routes.
4. **Provider-neutral login itself is not implemented.** `worklog_auth_identities` exists only at schema level; current login remains LINE migration-era bootstrap.
5. **Legacy GROUP bot-entry Web sessions remain LINE-only.** This is intentionally not being expanded.
6. **Native GROUP invite SQL still needs real PostgreSQL concurrency/runtime verification.**
7. **Native GROUP API has no Web/PWA UI yet.** HTTP/domain/persistence are authored only.
8. **Manual Record CRUD/search still has nullable-date/required-title legacy assumptions.**
9. **AI subscription hard caps are schema-only.** Runtime still contains legacy Grant-era accounting paths.
10. **Worker/readiness still eagerly retain legacy LINE/Gemini runtime bindings.** These must be isolated as target replacements become complete.
11. **Tasks/reminders/push and Chrome extension remain unimplemented.**

## Exact next development order

1. Re-read required docs and this checkpoint; do not broad-audit.
2. Migrate `apps/api/src/worklog/routes.ts` Web authentication/context from LINE lookup to signed session -> `resolveWebSessionUserId`, preferring durable `userId` and retaining fallback only inside the shared resolver.
3. Migrate active target confirmation/subscription Web routes to the same durable-user session resolver where required; do not invest new product work in legacy GROUP funding/responsible-user behavior.
4. Add focused auth-route tests proving user-id-only sessions can access manual Worklog surfaces once route migration is complete and that legacy LINE-only signed sessions still resolve during migration.
5. Perform the free manual Record CRUD/search rewrite as one coherent batch:
   - nullable `occurred_at` create/edit/read;
   - nullable title/Entity for free records;
   - content-only manual create;
   - deterministic raw-content/date search;
   - ordering fallback to `created_at` when event time is absent;
   - revision snapshots preserve nullable event date.
6. If an executable checkout becomes available, run API typecheck and focused token/native-group/route/record/schema tests before any deploy claim.
7. After local green, regenerate canonical `drizzle/0000`, run baseline guard, then apply the idempotent forward migration to Dev while preserving existing data.
8. Run Dev native GROUP HTTP smoke: authenticated creator list -> create -> invite -> second authenticated user join -> both list -> revoke -> new join rejected -> existing member still authorized.
9. Only after free core/native GROUP are runtime green, wire paid per-user AI entitlement/hard caps and new AI capture/enrichment/search.
10. Then Related Records, summaries/rewrite, Tasks/Push, Chrome extension, readiness/runtime LINE isolation and final LINE schema cleanup.

## Remaining development estimate

Current estimate: **about 57–104 focused development hours** remaining.

Approximate buckets:

- complete durable Web auth migration + native GROUP UI/runtime verification: 5–11h;
- free Web/PWA Record CRUD/search model cleanup + capture-first PWA UX: 10–18h;
- paid per-user AI entitlement/caps + capture/enrichment/search: 15–27h;
- Related Records + summary/rewrite: 7–12h;
- Tasks/reminders + PWA Push/Cron: 7–13h;
- Chrome extension: 6–10h;
- baseline/migration/Dev/Prod hardening, readiness isolation and LINE cleanup: 7–13h.

This estimate should be tightened after the first successful executable typecheck/baseline migration and native GROUP Dev E2E, because those are the main remaining uncertainty around legacy compatibility cost.
