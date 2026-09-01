# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for continued development on branch `revive/line-worklog`.

Every development run must:
1. Read this file and `docs/WORKLOG_PRODUCT_SPEC.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to bug audit, edge cases, data consistency, LINE webhook behavior, error recovery, PWA UX, and tests.

## Baseline / product rules

- Branch was revived from the last full LINE-first assistant state before the sports-availability rebuild.
- Reuse LINE webhook signature verification, quotedMessageId/content fetch, reply/push clients, group identity, Web entry/auth utilities, PostgreSQL/Drizzle, React/Vite web/admin apps and existing tests.
- Do not merge sports/radar product behavior from newer `main` unless a generic utility is clearly reusable.
- `@AFTERTRACE <text>` records; Reply AUDIO/IMAGE/FILE + `@AFTERTRACE` records quoted content; `@AFTERTRACE 查詢` opens scoped Web/PWA without LIFF.
- Ordinary OA private text without `@AFTERTRACE` is human support traffic.
- OA friends have personal records; group records are source-scoped; users with both see separate personal/group surfaces.
- FREE is personal-only. Plans (`FREE`, `SUB1`, `SUB2`, future codes), price, capability flags and bounded AI allowance are operator-configurable.
- AI provider/model/input-output-media prices are DB/admin editable; historical usage stores immutable model/pricing/cost snapshots.
- Group owner is only a reliably identified add/bind actor or explicit claimant; never guess ownership from the first/random speaker.
- Group AI usage is charged to owner while preserving triggering member as actor attribution.
- Owner can disable each non-owner member from recording; blocked members must be rejected before provider usage.
- Owner/admin usage views need quota/used/reserved/remaining, group/member AI attribution, and TEXT/AUDIO/IMAGE/FILE counts.
- Keep customer/project shape minimal; computed finance uses typed numeric data; invoice/Amego and real payment provider integration remain postponed.
- Stack remains TypeScript + Hono/Cloudflare Workers + React/Vite Pages + PostgreSQL/Drizzle.

## Completed foundations

### Command + product contract

- Added `docs/WORKLOG_PRODUCT_SPEC.md` as the durable product contract.
- Added `apps/api/src/worklog/command.ts` and tests for query, text record, Reply record and ordinary-chat ignore behavior.

### Worklog schema / migration foundation

- Added isolated worklog data models/migrations for LINE/OA users, workspace, private/group sources and members, customer/project, records, typed transactions, plans/capabilities/AI allowance, subscription/history, AI runtime pricing, AI usage, feedback, anomalies and audit.
- Added entitlement tests including invariant that FREE can never gain group collaboration from malformed capability JSON.
- Added immutable AI pricing/cost snapshot helpers/tests.

### Scoped record-read layer

- Added `WorklogRecordReadService` + Drizzle repository.
- Personal records require OA friendship and exact private source.
- Group reads require exact active membership before record query.
- PWA surface discovery keeps personal/group surfaces separate.

### Group ownership / member permissions / usage

- Group source has stable owner identity/binding metadata.
- Source members have `recording_enabled` plus updater/time metadata.
- AI usage identity is split into `actor_user_id` and `charged_user_id`.
- Added `WorklogCollaborationService` + Drizzle repository for active membership, recording-disabled checks, FREE/group entitlement, owner quota preflight, owner-only permission changes and write-once owner binding.
- Added `WorklogUsageService` + Drizzle repository for user/owner quota summaries, reserved units, provider cost, TEXT/AUDIO/IMAGE/FILE counts, group burn and per-member actor attribution.

### Subscription lifecycle / race-safe AI quota

- Added subscription domain/repository with active-plan evaluation, calendar-month period calculation, manual/admin plan assignment/history/audit and group activation checks.
- Added period-scoped `worklog_ai_quota_balances` and `worklog_ai_quota_reservations`.
- Atomic reservation prevents concurrent requests from consuming the same final AI units.
- Provider success commits actual usage + immutable AI event; provider failure releases reservation; stale reservations expire.
- Actual usage cannot exceed conservative reservation; callers must reserve a safe maximum before AI invocation.

### 2026-09-02 LINE user/source bootstrap + safe pending groups

- Added `apps/api/src/worklog/bootstrap.ts` with a new bootstrap boundary for:
  - LINE user upsert/touch
  - OA follow/unfollow state
  - stable personal workspace/private source creation on follow
  - group interaction/member-presence bootstrap
  - group leave/inactivation
  - reliable/explicit owner binding
- Added `apps/api/src/worklog/drizzle-bootstrap.ts` with DB-backed implementations.
- Resolved the previously open unowned-group storage problem without assigning a fake workspace:
  - added `worklog_pending_groups`
  - added `worklog_pending_group_members`
  - a group observed before owner evidence remains in pending storage only
  - random member activity does **not** create a workspace and does **not** bind an owner
  - once reliable owner evidence exists, pending identity/members are promoted to a normal GROUP source under the owner's real workspace
  - pending row records `promoted_source_id` / `promoted_at` for idempotency/diagnostics
- Added `schema-worklog-bootstrap.ts`, registered it in runtime/Drizzle configuration, and added/journaled hand-authored migration `0004_worklog_pending_group_bootstrap.sql`.
- Added bootstrap tests for:
  - stable personal source across unfollow/refollow
  - unowned group stays pending with zero workspace/owner promotion
  - explicit/reliable owner evidence promotes pending group and members
  - second user cannot steal already-bound ownership
  - member leave/rejoin presence updates
- Tightened legacy collaboration owner binding so an unbound GROUP source is rebound to the owner's actual workspace and subscription owner, rather than keeping an arbitrary pre-existing workspace.

## Validation performed in latest pass

- Read latest product spec/progress before editing and inspected current worklog schema, collaboration repository, migration journal and subscription test style.
- Statically reviewed pending -> promoted flow for:
  - no workspace creation during ordinary unbound group activity
  - write-once ownership/conflict behavior
  - pending member migration to the bound source
  - group leave deactivating both bound and pending membership states
  - OA unfollow preserving personal workspace/source rather than deleting records
  - collaboration binding using owner workspace
- Tests/typecheck were authored but cannot be executed in this connector-only environment because there is no checked-out runtime where `pnpm` can run.

## Known cautions before real DB deployment

- Worklog migrations `0001` through `0004` are hand-authored/journaled; Drizzle snapshot metadata has not been regenerated for these additions.
- Before first production DB deployment run at minimum:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm db:schema:check`
  - all migrations on a disposable Neon branch/database
- Verify `0004` pending-group tables and promotion SQL against real PostgreSQL before production traffic.
- The provider integration still must reserve a conservative maximum AI-unit estimate before each AI call, then commit actual usage or release on failure.

## Next prioritized implementation batch

1. Wire bootstrap into the LINE webhook incrementally, but keep legacy behavior isolated:
   - support OA follow/unfollow identity updates
   - bootstrap group user/source/member before worklog command handling
   - route only new worklog commands away from legacy Energy/Memory
2. Implement TEXT recording end-to-end first:
   - parse `@AFTERTRACE <text>`
   - require bound/entitled group or valid OA personal context
   - enforce member recording permission
   - persist raw TEXT record idempotently by LINE message id
   - keep AI normalization optional/fallback-safe so raw recording is never lost
3. For AI-assisted TEXT normalization:
   - authorize collaboration/personal entitlement
   - reserve conservative AI units atomically
   - call provider
   - commit actual usage with actor/charged/source snapshots
   - release on provider failure and retain raw record
4. Extend LINE event handling for private OA source events without making ordinary OA text an automatic record command.
5. Reuse existing LINE content fetch for quoted AUDIO/IMAGE/FILE recording and return resend UX when LINE content has expired.
6. Add `@AFTERTRACE 查詢` short-lived entry token/redirect and expose scoped personal/group surfaces.
7. Add Owner PWA APIs/UI for quota/used/reserved/remaining, group burn, member counts/AI usage and recording-permission controls.
8. Repurpose internal admin around anomaly feed, feedback, user list/detail, quota/usage/balance, group owner/member details, plan/quota/capability management, AI model/pricing and manual plan changes.
9. Add OA Rich Menu setup plus payment-provider-neutral subscription UI/backend boundary.
10. After end-to-end worklog runtime is proven, remove legacy Energy/Memory/commerce/reminder/proactive product code while retaining genuinely reusable utilities/tests.

## Bug-audit phase checklist

After core MVP flow exists, repeatedly audit:
- duplicate LINE delivery/idempotency
- quoted content expiry/wrong content type
- group leave/rejoin and pending -> promoted race
- owner binding ambiguity/reassignment/transfer edge cases
- blocked member still writing or consuming AI
- actor/charged identity swap or wrong owner charge
- quota reservation overspend/leak/double commit/release/cycle-boundary behavior
- plan downgrade/allowance edits vs snapshotted active period
- OA friend/unfriend drift and ordinary support messages accidentally routed to AI
- cross-group/personal scope leakage and FREE collaboration leakage
- historical AI price snapshots, record counters and member usage attribution drift
- concurrent edits/audit, AI fallback, transaction duplication, feedback attribution, anomaly noise
- PWA mobile/desktop usability, admin filtering/sorting and migration/bootstrap reliability
