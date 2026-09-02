# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for continued development on branch `revive/line-worklog`.

Every development run must:
1. Read this file, `docs/WORKLOG_PRODUCT_SPEC.md`, `docs/WORKLOG_LINE_CONTENT_POLICY.md`, and `docs/WORKLOG_DEPLOYMENT.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to repeated bug audit/repair for logic, data consistency, LINE webhook/idempotency, Reply expiry, cross-source isolation, PWA/Admin UX, deployment isolation, and migrations.

## Baseline / product rules

- AFTERTRACE is a LINE-first work-record product. LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records.
- Reply TEXT/AUDIO/IMAGE/FILE + `@AFTERTRACE` records the quoted source when recoverable.
- `@AFTERTRACE 查詢` opens a short-lived scoped Web/PWA entry without LIFF.
- `@AFTERTRACE 啟用` is the explicit group-owner claim path when reliable add-actor evidence is unavailable; it must never steal an already-bound group.
- Ordinary OA private text without `@AFTERTRACE` is human-support traffic.
- OA friends have personal records; group records are source-scoped; personal and group surfaces must remain visibly separate.
- FREE is personal-only. Group/collaboration requires a plan capability.
- Group AI usage is charged to the stable group owner/subscriber while preserving the triggering member as actor attribution.
- Group owner can disable a member from adding new records without removing intended historical read access.
- Customer/project fixed fields stay intentionally small; computed finance uses typed numeric data; invoice integration and a real payment provider remain postponed.
- Runtime/data stack remains TypeScript + Hono + PostgreSQL/Drizzle.
- Deployment is three independent Cloudflare Workers:
  - `aftertrace-api`: Hono/API Worker
  - `aftertrace-web`: React/Vite via Workers Static Assets
  - `aftertrace-admin`: React/Vite via Workers Static Assets
- Cloudflare Pages is no longer a deployment target. Do not add Pages config/functions/proxies.
- LINE Reply/content retention follows `docs/WORKLOG_LINE_CONTENT_POLICY.md` exactly:
  - only ordinary group TEXT is temporarily cached in PostgreSQL
  - default TEXT cache TTL is 5 days
  - default TEXT cache cap is 1000 messages per group
  - no Redis for this MVP cache
  - AUDIO/IMAGE/FILE are never locally cached; Reply fetches them directly from LINE by `quotedMessageId`
  - expired/unavailable attachment content must return clear resend UX
  - original attachment binaries are not persisted
  - Reply-created records persist both `line_message_id` and `quoted_line_message_id`

## Completed foundations

### Worklog domain/schema

- Added worklog users/OA friendship, workspace, PRIVATE/GROUP sources, source membership, minimal customers/projects, records, typed transactions, subscription plans/capabilities, subscriptions/history, AI runtime pricing, AI usage/cost snapshots, feedback, anomalies and audit models.
- Added stable group owner/binding metadata and member `recording_enabled` state.
- Added race-safe AI quota balance/reservation model so future provider calls can reserve conservatively, commit actual usage, or release on failure.
- Worklog migrations are hand-authored/journaled and still require real PostgreSQL validation before production.

### Bootstrap / ownership

- Added `WorklogBootstrapService` + Drizzle repository for LINE user upsert/touch, OA follow/unfollow, stable personal source creation/reuse, group presence, leave/inactivation and owner binding.
- Added `worklog_pending_groups` / `worklog_pending_group_members` so an unowned group stays pending instead of receiving a guessed owner/workspace.
- Reliable owner evidence or explicit `@AFTERTRACE 啟用` promotes pending group state under the actual owner's workspace.
- A second user cannot overwrite an already-bound owner.

### Record read/write boundaries

- Added scoped worklog record read service:
  - personal read requires active OA friendship and exact private source
  - group read requires exact active source membership
  - personal/group surfaces are discovered separately
- Added `WorklogRecordWriteService` + Drizzle repository for raw TEXT persistence before optional AI normalization.
- LINE `line_message_id` is used for deterministic raw-TEXT idempotency; mismatched same-id writes return an idempotency conflict instead of overwriting.
- Added a second read for the PostgreSQL READ COMMITTED / `ON CONFLICT DO NOTHING` concurrent-winner visibility race.

### Group LINE runtime cutover

- Added `WorklogLineRuntime` before the legacy conversation/Energy/Memory path.
- Group `@AFTERTRACE <text>` now performs bootstrap -> permission/entitlement -> raw record persistence -> LINE reply.
- Group `@AFTERTRACE 查詢` uses the existing one-time Web entry and re-verifies LINE group membership during exchange.
- Group Reply worklog commands are intercepted so unfinished quoted-content handling cannot fall through into legacy Memory.
- Group record/query/owner-claim diagnostics are tracked separately from legacy counters.

### OA/private runtime cutover

- Added a separate OA parser stream for FOLLOW, UNFOLLOW and one-to-one messages so group/OA events cannot be double-processed.
- Added `WorklogOaRuntime`:
  - ordinary private OA text remains human support
  - explicit `@AFTERTRACE <text>` writes personal raw TEXT
  - `@AFTERTRACE 查詢` resolves exact personal user/source target
  - `@AFTERTRACE 啟用` is rejected in private chat
  - quoted media is intercepted pending direct LINE content-fetch implementation
- Wired OA events into `/webhooks/line`.
- A LINE reply-delivery failure after successful DB persistence no longer turns a successful record into a rejected write or reuses the reply token.

### LINE Reply/content policy

- Added `docs/WORKLOG_LINE_CONTENT_POLICY.md`.
- Only ordinary group TEXT may enter the temporary PostgreSQL Reply cache.
- AUDIO/IMAGE/FILE never enter a local cache; future Reply handling must call LINE content API directly.
- Original attachment binaries are discarded after extraction/transcription/understanding; durable worklog content is textual/structured plus trace ids.

### Three-Worker deployment cutover

- Added Workers Static Assets configs for `aftertrace-web` and `aftertrace-admin` with SPA fallback.
- Added independent Web/Admin deployment scripts.
- Kept API deploy independent.
- Deleted obsolete Pages deployment helper and Pages-only Admin Functions proxy.
- Web/Admin require an explicit API origin; Admin does not silently treat its own static origin as the API.
- See `docs/WORKLOG_DEPLOYMENT.md` for production cutover requirements.

## 2026-09-02 latest batch: secure OA private Web entry/auth

Starting branch HEAD for this batch was `35bdf019b7957a561a4fc093b70c752ad99953ba`.

Implemented the highest-priority private `@AFTERTRACE 查詢` path without inventing a group id:

1. **Private entry token type**
   - Added `PRIVATE_WEB_ENTRY` claims separate from group `WEB_ENTRY` and identity `WEB_SESSION`.
   - Claims bind the one-time link to LINE user id + exact internal `userId` + exact PRIVATE `sourceId` + nonce + expiry.
   - Added positive database-id validation and explicit issue/verify helpers.
   - Group/private/session token types cannot be confused with one another.

2. **One-time private nonce persistence**
   - Added `worklog_private_web_entry_nonces` schema and migration `0005_worklog_private_web_entry.sql`.
   - Added expiry/user/source indexes and journal entry.
   - Registered the schema in both `schema-all.ts` and `drizzle.config.ts` so schema checking does not silently omit the table.

3. **Authorization at link creation and exchange**
   - `registerPrivateEntry` inserts only when the LINE identity still maps to the exact worklog user, the user is currently an OA friend, and the exact source is ACTIVE + PRIVATE + owned by that same user.
   - `consumePrivateEntry` atomically consumes a nonce only while those same access conditions still hold.
   - Exchange distinguishes `ALREADY_USED`, `INVALID_OR_EXPIRED`, and `ACCESS_REVOKED` rather than granting a session on stale friendship/source state.
   - PRIVATE exchange intentionally does **not** call LINE group membership APIs.

4. **Web auth service/routes**
   - Added `createPrivateBotEntry` with a 5-minute one-time URL.
   - `/api/v1/auth/entry/exchange` now returns an explicit entry-context union:
     - `{ type: 'GROUP', lineGroupId }`
     - `{ type: 'PRIVATE', userId, sourceId }`
   - PRIVATE success never returns/fakes a group id or group-context token.
   - Existing GROUP success still returns the group context token for backward compatibility with the current group UI.

5. **OA webhook wiring**
   - `/webhooks/line` now passes a real `createQueryUrl` callback into `processWorklogOaWebhook`.
   - OA `@AFTERTRACE 查詢` therefore resolves the personal source in `WorklogOaRuntime`, creates the exact private one-time entry, and returns that URL through LINE.

6. **Web frontend entry separation**
   - Updated Web auth client types/validation to understand PRIVATE vs GROUP entry contexts.
   - Web bootstrap no longer assumes every entry exchange contains `lineGroupId` / `groupContextToken`.
   - PRIVATE entry context is preserved separately in local client state and does not trigger legacy group lookup/Memory management.
   - Generic LINE Login clears stale entry context; logout clears session/group/entry state.
   - PRIVATE currently lands on a dedicated personal-worklog placeholder rather than exposing the legacy group Memory UI. Actual personal records will appear when the new worklog PWA APIs are exposed.

7. **Tests authored**
   - Token tests cover private issue/verify, type separation, invalid ids and session separation.
   - WebAuthService tests cover exact private URL binding, no group fetch on private exchange, and revoked private access.

Code HEAD immediately before this progress-document update was `03534f2936df2679d40fcbd2af0815279f579be6`.

## Validation performed in latest batch

- Read all four durable docs before implementation.
- Verified the branch started exactly at the previously recorded deployment-cutover HEAD.
- Inspected OA runtime/webhook callback seam, auth token/service/repository/routes, DB schema registration, API webhook wiring and Web bootstrap before changing them.
- Compared the branch against the starting SHA after implementation; changes were limited to the private Web-entry/auth path, migration/schema registration, tests, API wiring and Web entry-context handling.
- Statically checked these invariants:
  - PRIVATE entry never needs/fakes a LINE group id
  - PRIVATE exchange does not call LINE group membership API
  - OA friendship and exact private-source ownership are checked at both registration and nonce consumption
  - nonce is single-use and time-limited
  - group entry behavior remains separate
  - Web PRIVATE entry cannot fall into the legacy group Memory surface
  - new Drizzle schema is present in both runtime exports and Drizzle Kit config
- **No build/typecheck/lint/test/migration execution was possible in this connector-only run.** Tests were authored but must not be treated as passing until run in a real checkout/CI environment.

## Known cautions / blockers before production

- Run at minimum before real DB deployment:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm db:schema:check`
  - all worklog migrations on a disposable Neon branch/database
- Specifically validate migration `0005_worklog_private_web_entry.sql` and its atomic consume SQL against real PostgreSQL.
- Drizzle snapshot metadata for hand-authored worklog migrations has not been regenerated; journal/schema registration is present, but schema drift must be checked before production.
- AI normalization is not wired yet. Current raw TEXT worklog writes leave `normalized_summary = NULL` and consume no AI quota.
- The 5-day / 1000-message PostgreSQL Reply-to-TEXT cache is documented but not implemented yet.
- Reply AUDIO/IMAGE/FILE is intercepted but direct LINE content fetch + extraction/transcription persistence is not implemented yet.
- The private Web entry is now secure and end-to-end, but the Web personal page is intentionally only a separated placeholder until actual worklog PWA record APIs/UI are exposed; do not route it to legacy Memory data as a shortcut.
- Generic Web LINE-login/group UI and legacy Energy/Memory management still exist temporarily. Remove old product paths only after new worklog equivalents are end-to-end.
- Admin still uses the interim legacy Cloudflare Access verifier while the product contract calls for a simple configured username/password MVP boundary; do not remove protection until the replacement exists.
- Before Workers production cutover, independently validate Web/Admin builds, SPA deep links, API origin/CORS and custom-domain configuration.

## Next prioritized implementation batch

1. Add AI-assisted TEXT normalization as a **post-persistence** step:
   - keep raw record durable regardless of AI result
   - narrow normalized output to summary/category/customer/project hints
   - load DB-backed active provider/model/pricing
   - reserve conservative AI units atomically for the charged user
   - group: charge owner while preserving actor; private: charge the personal user
   - call provider, validate structured output, commit actual usage/pricing snapshot
   - update normalized fields only after provider success
   - release reservation on provider/parse/error paths
   - make normalization retry/idempotency explicit so LINE redelivery cannot double-charge
2. Implement PostgreSQL Reply-to-TEXT cache:
   - only ordinary group TEXT enters cache
   - exact group/source isolation
   - 5-day TTL
   - max 1000 per group with deterministic oldest-first pruning
   - Reply resolves `quotedMessageId`, persists both command and quoted ids
   - expired cache row => clear resend/re-enter UX
   - no Redis and no AUDIO/IMAGE/FILE rows
3. Implement quoted AUDIO/IMAGE/FILE ingestion:
   - direct LINE content API by `quotedMessageId`
   - no attachment cache
   - permission/quota preflight before expensive work where possible
   - extract/transcribe/understand enough durable textual content
   - persist safe metadata/text/summary + both LINE ids, never binary
   - unavailable/expired LINE content => clear resend UX
   - handle unsupported/oversized files and partial failures deterministically
4. Expose actual worklog PWA APIs using the scoped record-read layer:
   - PRIVATE and GROUP surfaces remain distinct
   - private entry page starts showing actual personal worklog records
   - group UI migrates away from legacy Memory search/management
   - users with both scopes can navigate clearly separated personal/group sections
5. Add owner PWA group usage/member recording-permission APIs/UI.
6. Repurpose internal Admin for worklog users/groups/plans/AI pricing/anomalies/feedback and replace interim Access-only auth with configured username/password.
7. Add OA Rich Menu setup and payment-provider-neutral subscription UI/backend boundary.
8. After new worklog runtime/PWA/Admin paths are proven end-to-end, delete obsolete Energy/Memory/commerce/reminder/proactive product code while retaining genuinely reusable utilities.

## Bug-audit phase checklist

After core MVP flow exists, repeatedly audit:
- duplicate LINE delivery/idempotency and concurrent redelivery
- PRIVATE token accidentally gaining GROUP scope or vice versa
- nonce replay/expiry and OA unfollow between URL creation/exchange/use
- private source replacement/inactivation and stale client entry context
- cross-group/personal record leakage
- only TEXT entering temporary cache
- 5-day TTL and 1000-message pruning correctness
- Reply-to-TEXT expiry and cross-group lookup isolation
- attachment expiry/wrong type/content API failures; no binary leakage to DB/logs
- group pending->promoted races, leave/rejoin and owner-binding ambiguity
- recording-disabled member writes/AI consumption while historical read remains intact
- actor/charged-user swaps, quota overspend/reservation leaks/double commit/release
- subscription period/downgrade/allowance edit edge cases
- OA support text accidentally entering AI/worklog paths
- personal/group Web surface separation and stale session/client state
- historical AI price snapshots and usage counters
- Workers Static Assets SPA fallback, API origin/CORS and deployment isolation
- migration/bootstrap reproducibility on a clean disposable DB
