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

## Current checkpoint — 2026-09-07 native GROUP domain/persistence primitives authored; HTTP/auth wiring and executable validation pending

AFTERTRACE target product is **Web + PWA-first work memory**, with optional Chrome extension. LINE is retired/migration-only and must not drive new product design.

This checkpoint continues the first Web/PWA schema foundation and adds the first target AFTERTRACE-native GROUP runtime primitives. No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Web/PWA schema foundation already present

The preceding foundation remains the accepted starting point:

- `worklog_records.occurred_at` is nullable with no implicit current-time business default;
- Record revisions permit nullable prior/new event dates;
- Record has nullable direct `title`, `extracted_metadata`, `ai_enriched_at` and explicit `ai_enrichment_status = NONE | ENRICHED | LEGACY`;
- existing rows are forward-migrated to `LEGACY` enrichment state instead of being mislabeled as current paid AI output;
- record list/read paths can expose nullable `occurredAt` and use `created_at` as ordering fallback where already migrated;
- `worklog_users.line_user_id` is nullable so future accounts are not structurally required to have LINE identity;
- provider-neutral `worklog_auth_identities` exists;
- GROUP Source supports a native `name`, nullable legacy `line_group_id`, and `created_by_user_id`;
- GROUP membership has `OWNER | MEMBER` role;
- `worklog_source_invites` stores token hash metadata only;
- subscription plans carry `ai_enabled`, monthly AI-point/resource cap, monthly provider-cost TWD hard cap, and optional per-request cap;
- forward migration preserves existing Dev/legacy data and adds target structures without destructive reset;
- target product schema is exported through the canonical Drizzle schema export.

The canonical generated `drizzle/0000` baseline is still behind these TypeScript schema changes and must be regenerated only in a real repository checkout after executable validation.

## Native GROUP service — authored this run

New target domain module:

- `apps/api/src/worklog/native-groups.ts`

It defines provider/channel-neutral GROUP contracts for:

- create named native GROUP;
- minimal `OWNER | MEMBER` roles;
- create invite;
- revoke invite;
- authenticated join by invite token;
- idempotent `ALREADY_MEMBER` result;
- invalid/revoked/expired/exhausted invite result;
- one-time raw invite token return with persistence receiving only SHA-256 token hash.

`WebCryptoNativeGroupInviteTokenCodec` generates 32 random bytes, returns a URL-safe raw token to the caller, and hashes it with SHA-256 before repository persistence. Raw invite token must never be stored in PostgreSQL or logs.

Service validation currently enforces:

- positive user/source/invite ids;
- trimmed non-empty GROUP name, max 255 characters;
- future expiry when supplied;
- positive max-use count when supplied;
- SHA-256 hex token-hash shape.

## Native GROUP persistence — authored this run

New target Drizzle repository:

- `apps/api/src/worklog/drizzle-native-groups.ts`

Implemented primitives:

### Create GROUP

- derives the creator's existing workspace;
- inserts a native `GROUP` Source with `name`, `created_by_user_id`, and `line_group_id = NULL`;
- atomically inserts the creator as active `OWNER` membership;
- returns `USER_NOT_READY` when the required bootstrap workspace does not yet exist.

### Create invite

- only an active `OWNER` of an active AFTERTRACE-native GROUP may create an invite;
- only token hash reaches the table;
- optional expiry and max-use metadata are persisted;
- legacy LINE-backed GROUP rows are deliberately not mutated through this repository.

### Revoke invite

- only an active native-GROUP `OWNER` may revoke;
- revocation is durable and idempotent through `COALESCE(revoked_at, NOW())`;
- no raw token is required to revoke by invite id.

### Join invite

Join is one SQL statement with the invite row locked for concurrent use-count correctness.

- active existing member -> `ALREADY_MEMBER` and does not consume another invite use;
- eligible non-member/inactive former member -> membership upsert + one invite-use increment;
- revoked, expired, exhausted, unknown, inactive-source, or non-native invite -> `INVALID_INVITE`;
- invite join always grants/re-grants `MEMBER`, never `OWNER`;
- an inactive historical OWNER row therefore cannot regain owner authority merely by possessing a member invite;
- Source authorization after join remains ordinary active-membership authorization.

No role-transfer/remove-member product flow is implemented yet; do not invent one until accepted product rules require it.

## PWA GROUP surfaces — moved away from LINE identity this run

Changed:

- `apps/api/src/worklog/records.ts`
- `apps/api/src/worklog/drizzle-records.ts`
- `apps/api/src/worklog/records.test.ts`

Target `WorklogGroupSurface` is now:

- `sourceId`;
- display `name`;
- `role: OWNER | MEMBER`;
- nullable `legacyLineGroupId` migration trace only.

Native GROUP rows no longer require `line_group_id` to appear in PWA surfaces. The repository derives display name from native `source.name`, with legacy `line_group_id` only as a temporary fallback for old rows.

`WorklogPwaSurfaces` no longer exposes `isOaFriend`, and `WorklogRecordReadRepository` no longer queries OA friendship merely to render Web/PWA surfaces. This removes one LINE-only runtime dependency from the target PWA read model.

Legacy LINE record-write/reply-cache code remains in the same files only for migration compatibility and was not expanded.

## Current auth boundary discovered this run

Native GROUP persistence is intentionally not mounted to HTTP yet because the current Web session claim is still LINE-shaped:

- `WebSessionClaims` currently requires `lineUserId`;
- `issueWebSessionToken` currently accepts only LINE user identity;
- `apps/api/src/worklog/routes.ts` sets Hono context variable `lineUserId` and resolves `worklog_users` from that value;
- LINE Login callback already knows the durable numeric `user.userId`, but does not put it into the Web session token;
- legacy bot-entry exchange also issues LINE-only Web sessions.

Do not add new native GROUP routes on top of a new LINE-specific identity dependency. The next runtime batch should first make the normal Web session capable of carrying/resolving durable `userId` while keeping a bounded compatibility path for already-issued LINE sessions during migration.

The new `worklog_auth_identities` schema exists but provider-neutral login/runtime binding has not yet been implemented.

## Record-route debt observed but not changed this run

`apps/api/src/worklog/routes.ts` still contains pre-reset manual Record assumptions that must be corrected in the later free CRUD batch:

- `RecordSnapshot.occurredAt` is still typed as non-null `Date`;
- snapshot mapping constructs `new Date(String(row.occurred_at))`, which is invalid for null event dates;
- mutation input still requires non-null `occurredAt`;
- some timeline/filter ordering remains based directly on `record.occurred_at` rather than the accepted nullable-event semantics;
- manual title/entity creation paths still reflect the older required-Entity model and must be reconciled with the free Record rule where content alone is sufficient.

Do not fix these piecemeal inside retired LINE code. Handle them as a focused Web/PWA free-manual CRUD/search batch after native auth/GROUP HTTP wiring.

## Commits in this run

All commits contain `[skip ci]`:

- `13b05ef4` — add native group domain service;
- `6ebd57c8` — persist native groups and invites;
- `493cd7da` — cover native group service contract;
- `82acd8ba` — expose native group PWA surfaces;
- `9b1ac81b` — list native groups in PWA surfaces;
- `15bcfa1a` — align record surface tests with native groups;
- `8bd9487b` — prevent invite joins from restoring owner role;
- checkpoint doc commit follows this list.

No schema file was changed in this run; this runtime batch consumes the native GROUP/invite schema authored in the preceding foundation.

## Validation status

### Authored / updated tests

- `apps/api/src/worklog/native-groups.test.ts` — **AUTHORED / NOT RUN**
  - name normalization;
  - one-time raw invite token vs hash-only persistence boundary;
  - hash-before-join boundary;
  - expiry rejection before persistence;
  - repository authorization result propagation.
- `apps/api/src/worklog/records.test.ts` — **AUTHORED/UPDATED / NOT RUN**
  - native GROUP name/role surface without LINE group id;
  - nullable legacy LINE id migration trace.
- preceding `product-record-schema.test.ts` — **AUTHORED / NOT RUN**
- preceding `product-foundation-schema.test.ts` — **AUTHORED / NOT RUN**

### Executable validation

- API TypeScript typecheck — **NOT RUN**
- `native-groups.test.ts` — **NOT RUN**
- `records.test.ts` — **NOT RUN**
- focused schema tests — **NOT RUN**
- full API Vitest — **NOT RUN**
- Drizzle baseline regenerate / guard — **NOT RUN**
- Dev DB forward migration — **NOT RUN**
- Native GROUP Dev runtime smoke — **NOT RUN**

Reason: this run has GitHub repository mutation access but no mounted executable checkout/dependency environment. No test result is being inferred from authored code or GitHub state.

## Known blockers / risks

1. **Executable validation is still pending.** New TypeScript and SQL have not yet been executed.
2. **Canonical Drizzle baseline remains behind target schema.** Do not deploy/migrate until real-checkout validation and baseline regeneration are green.
3. **Web session remains LINE-shaped.** Native GROUP HTTP routes should not deepen that dependency.
4. **Provider-neutral auth runtime is not implemented.** `worklog_auth_identities` is schema-only so far.
5. **Native GROUP HTTP/UI is not wired.** Service/repository primitives exist but customers cannot create/join/revoke through Web yet.
6. **Invite SQL needs real PostgreSQL concurrency smoke.** The intended locking/idempotency behavior is authored but not runtime verified.
7. **Manual Web Record routes still assume required event date/title in important paths.** They need a focused target-model rewrite.
8. **AI subscription hard caps are schema-only.** Runtime admission/accounting still follows legacy Grant-era paths.
9. **Tasks/reminders/push and Chrome extension remain unimplemented.**
10. Legacy LINE runtime remains for migration compatibility; do not extend it.

## Exact next development order

1. Re-read this checkpoint and the required product docs; do not broad-audit the repo.
2. Update Web session token contract to carry durable numeric `userId` for target Web/PWA sessions.
3. Preserve bounded verification compatibility for already-issued legacy LINE-only sessions while migration is in progress; do not require future providers to have LINE ids.
4. Change target Worklog route authentication/context to prefer durable `userId`; legacy `lineUserId` lookup should be fallback only.
5. Wire authenticated native GROUP HTTP endpoints for:
   - create named GROUP;
   - create invite as OWNER;
   - revoke invite as OWNER;
   - join via raw invite token as authenticated user;
   - list/display via the already-migrated PWA surfaces.
6. Keep raw invite token response one-time and never log/store it.
7. Add route-level tests for owner/member authorization, revoked/expired/exhausted token, idempotent repeated join, and no owner escalation.
8. If a real executable checkout is available, run API typecheck plus focused `token`, native-group, records, route and schema tests. Record exact PASS/FAIL only from actual execution.
9. After local green, regenerate canonical `drizzle/0000`, run baseline guard, then apply the forward migration to Dev while preserving existing data.
10. Run Dev native GROUP smoke: create -> invite -> second authenticated user join -> surfaces/list -> revoke -> rejected new join -> existing member still authorized.
11. Then perform the focused free Web/PWA manual Record CRUD/search rewrite for nullable date and optional AI metadata/title.
12. Only after the free core is stable, wire paid per-user AI entitlement/hard caps, Related Records, summaries/rewrite, Tasks/Push, Chrome extension, and final LINE cleanup.

## Remaining development estimate

Current estimate: **about 61–111 focused development hours** remaining.

Approximate remaining buckets:

- provider-neutral Web auth + native GROUP HTTP/UI/runtime verification: 8–16h;
- free Web/PWA Record CRUD/search model cleanup + PWA UX: 10–18h;
- paid per-user AI entitlement/caps + capture/enrichment/search: 15–28h;
- Related Records + summary/rewrite: 7–12h;
- Tasks/reminders + PWA Push/Cron: 7–13h;
- Chrome extension: 6–10h;
- baseline/migration/Dev/Prod hardening and LINE cleanup: 8–14h.

This estimate should be tightened after the first successful executable typecheck/migration and native GROUP E2E, because those will reveal the actual compatibility cost of the legacy LINE-era route/auth code.