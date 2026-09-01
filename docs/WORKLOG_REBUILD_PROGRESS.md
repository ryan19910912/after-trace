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
- `@AFTERTRACE 啟用` is the MVP explicit group-owner claim path when no reliable add-actor evidence exists; it must never transfer an already-bound group to a different user.
- Ordinary OA private text without `@AFTERTRACE` is human support traffic.
- OA friends have personal records; group records are source-scoped; users with both see separate personal/group surfaces.
- FREE is personal-only. Plans (`FREE`, `SUB1`, `SUB2`, future codes), price, capability flags and bounded AI allowance are operator-configurable.
- AI provider/model/input-output-media prices are DB/admin editable; historical usage stores immutable model/pricing/cost snapshots.
- Group owner is only a reliably identified add/bind actor or explicit claimant; never guess ownership from the first/random speaker.
- Group AI usage is charged to owner while preserving triggering member as actor attribution.
- Owner can disable each non-owner member from **adding** records; this recording permission must not silently remove that member's historical group-read access.
- Owner/admin usage views need quota/used/reserved/remaining, group/member AI attribution, and TEXT/AUDIO/IMAGE/FILE counts.
- Keep customer/project shape minimal; computed finance uses typed numeric data; invoice/Amego and real payment provider integration remain postponed.
- Stack remains TypeScript + Hono/Cloudflare Workers + React/Vite Pages + PostgreSQL/Drizzle.

## Completed foundations

### Command + product contract

- Added `docs/WORKLOG_PRODUCT_SPEC.md` as the durable product contract.
- Added `apps/api/src/worklog/command.ts` and tests for query, text record, Reply record and ordinary-chat ignore behavior.
- Added explicit `CLAIM_GROUP` parsing for `@AFTERTRACE 啟用` / 認領 / 綁定 aliases so pending groups can be claimed deliberately instead of inferring ownership from a random speaker.

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

### 2026-09-02 group TEXT webhook cutover

- Added `WorklogRecordWriteService` and `DrizzleWorklogRecordWriteRepository` for raw TEXT persistence before any AI normalization.
- TEXT records are idempotent by LINE message id using the existing unique constraint:
  - exact LINE redelivery returns `ALREADY_RECORDED`
  - same LINE message id with different source/author/text returns `IDEMPOTENCY_CONFLICT` instead of overwriting data
  - a second DB read handles the PostgreSQL READ COMMITTED / `ON CONFLICT DO NOTHING` snapshot race where a concurrent winner may not be visible to the original command snapshot
- Added `WorklogLineRuntime` as an isolated pre-legacy routing boundary. It now handles only the new worklog contract and leaves ordinary group chat untouched.
- Wired the runtime into `/webhooks/line` **before** legacy conversation/Energy/Memory ingestion, so handled worklog commands no longer get routed into the old product runtime.
- Group lifecycle integration now updates the new bootstrap state for:
  - group leave/inactivation
  - member joined
  - member left
- `@AFTERTRACE 啟用` explicitly binds/promotes an unowned pending group to the claimant's real workspace; an existing different owner is never overwritten.
- `@AFTERTRACE <text>` now runs end-to-end through:
  - group/user bootstrap
  - bound-group check
  - active membership / member recording permission
  - owner paid-collaboration entitlement
  - raw TEXT record insert
  - LINE reply
- Raw TEXT persistence currently requests **0 AI units**. This intentionally separates durable source-of-truth persistence from the later optional AI normalization step so provider/quota failure cannot erase the user's record.
- `@AFTERTRACE 查詢` now creates the existing short-lived external Web entry for the current LINE group/caller after bound-group bootstrap. The Web entry exchange still verifies actual LINE membership before issuing a session.
- Recording permission is creation-only: a member whose owner disabled new recording can still open historical group records. Query does not call the record-authorization gate.
- Reply/quoted worklog commands are intercepted by the new runtime and explicitly return a not-yet-ready message rather than falling through to legacy Memory. This prevents new-product input from creating records in the wrong tables while media ingestion is unfinished.
- Added runtime/write tests covering:
  - ordinary chat bypass
  - pending-owner rejection
  - explicit owner claim
  - recording-disabled rejection before persistence
  - raw TEXT write with zero AI units
  - exact LINE redelivery idempotency
  - idempotency conflict detection
  - query access independent of recording permission
  - quoted-command interception away from legacy Memory
- Webhook response diagnostics now include worklog command/record/duplicate/rejected/query/owner-claim counters separately from legacy counters.

### 2026-09-02 OA/private parser + runtime foundation

- Added a separate `parseOaWebhook` stream instead of widening the existing group parser union immediately. This keeps the already-cut-over group webhook type stable while OA wiring is introduced incrementally.
- Added OA/private event types for:
  - `FOLLOW`
  - `UNFOLLOW`
  - one-to-one private LINE messages with reply token, quoted message id, message type, text and attachment metadata
- Group and OA parsers intentionally ignore the other source type, preventing accidental double processing when both are called on the same LINE webhook payload.
- Generalized `parseWorklogCommand` to a minimal message contract so the exact same narrow `@AFTERTRACE` command parser is reusable in group and OA-private contexts without depending on group identity.
- Added `bootstrapPrivateInteraction`:
  - requires currently active OA friendship
  - reuses the user's stable existing workspace/private source
  - does not recreate/activate personal scope after unfollow until friendship is active again
- Added `WorklogOaRuntime` with explicit source behavior:
  - ordinary private OA text only touches last interaction and remains `NOT_HANDLED` for human support
  - only explicit `@AFTERTRACE ...` enters worklog product handling
  - `@AFTERTRACE <text>` writes raw TEXT to the personal source using the same idempotent record writer as groups
  - `@AFTERTRACE 查詢` returns the personal source/user target for later Web-entry wiring
  - `@AFTERTRACE 啟用` is rejected in private chat and must be used inside a group
  - quoted private AUDIO/IMAGE/FILE is intercepted but not yet persisted until the new content-fetch path is connected
  - inactive OA friendship rejects explicit personal record/query commands
- Added tests for OA parser event order/source isolation/attachment metadata, stable private bootstrap, unfollow gating, human-support bypass, personal TEXT recording, personal query target, private group-command rejection, quoted interception, lifecycle delegation and duplicate-record propagation.

## Validation performed in latest pass

- Read the latest product spec and progress document before editing.
- Confirmed branch HEAD at the start of this pass was `b2f94fa618c8fc371e47615af1aa309c1b66af06` and inspected the current group webhook cutover, LINE parser, bootstrap service, command parser and record writer before changing anything.
- Kept the existing group `ParsedLineWebhook` contract unchanged, so the currently deployed-style group loop in `index.ts` is not forced into a new union before OA events are actually wired.
- Statically reviewed the new OA flow for:
  - group/OA parser source separation
  - preservation of webhook event order within OA events
  - ordinary private support text not becoming worklog records
  - active OA-friend requirement before personal source access
  - stable personal source reuse rather than source churn
  - raw personal TEXT persistence before future AI normalization
  - existing TEXT idempotency behavior being reused for private records
  - explicit group-owner command being rejected outside group context
- Latest code HEAD before this progress-doc update is `9277afa1e725f56307195cf0c18966dcd0646b56`.
- Unit tests were authored/expanded but **not executed** in this connector-only environment because there is no checked-out runtime where `pnpm` can run.

## Known cautions / blockers before real DB deployment

- Worklog migrations `0001` through `0004` are hand-authored/journaled; Drizzle snapshot metadata has not been regenerated for these additions.
- Before first production DB deployment run at minimum:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm db:schema:check`
  - all migrations on a disposable Neon branch/database
- Verify `0004` pending-group tables/promotion SQL and the new TEXT insert/idempotency SQL against real PostgreSQL before production traffic.
- AI normalization is **not wired yet**. New TEXT records currently persist with raw text and `normalized_summary = NULL`; they do not consume AI quota yet.
- The provider integration still must reserve a conservative maximum AI-unit estimate before each AI call, then commit actual usage or release on failure.
- Reply AUDIO/IMAGE/FILE is deliberately intercepted but not persisted yet until the new content-fetch/attachment storage path is connected.
- OA parsing/runtime now exists, but `/webhooks/line` still only calls the existing group parser/runtime. The next pass must wire `parseOaWebhook` + `WorklogOaRuntime` into the webhook without routing ordinary private text into legacy Energy/Memory.
- Personal `@AFTERTRACE 查詢` now resolves a personal source/user target inside `WorklogOaRuntime`, but the external Web-entry/auth boundary still needs a private-user entry path; do not fake a group id to reuse group membership verification.
- Ordinary non-`@AFTERTRACE` group chat still flows through the legacy conversation runtime temporarily. New worklog commands do not. Remove the old path only after the new MVP runtime is proven end-to-end.

## Next prioritized implementation batch

1. Wire the completed OA/private parser/runtime into `/webhooks/line`:
   - process OA follow/unfollow through `handleOaFollow` / `handleOaUnfollow`
   - route private messages through `WorklogOaRuntime`
   - keep ordinary OA text as human-support traffic and do not send it to legacy group conversation/Energy/Memory
   - reply only for explicit private worklog commands/results
   - add separate OA diagnostics counters
2. Add a **private-user Web entry/auth path** for `@AFTERTRACE 查詢`:
   - do not invent a group id
   - bind token/session to the LINE user and personal source
   - continue to expose personal/group surfaces separately after login
3. Add AI-assisted TEXT normalization as a **post-persistence** step:
   - add narrow normalized-record contract (summary/category/customer/project hints only)
   - load DB-backed active model/pricing
   - reserve conservative AI units atomically for the charged user (group owner; personal user for OA)
   - call provider
   - commit actual usage with actor/charged/source/model/pricing snapshots
   - update normalized fields only after provider success
   - release reservation and retain raw record on every provider/error/parse failure
   - make normalization itself idempotent on LINE redelivery/retry
4. Reuse existing LINE content fetch for quoted AUDIO/IMAGE/FILE:
   - resolve quoted content type safely
   - persist attachment metadata/source reference in new worklog tables
   - return resend UX when LINE content has expired
   - enforce recording permission before content fetch/provider usage where possible
5. Expose actual worklog PWA APIs using the new scoped read service and existing/new Web session identity:
   - personal/group surfaces remain separate
   - group reads require exact active membership
   - do not expose legacy Memory search as the new worklog record UI
6. Add Owner PWA APIs/UI for quota/used/reserved/remaining, group burn, member TEXT/AUDIO/IMAGE/FILE counts, member AI attribution, and recording-permission controls.
7. Repurpose internal admin around anomaly feed, feedback, user list/detail, quota/usage/balance, group owner/member details, plan/quota/capability management, AI model/pricing and manual plan changes.
8. Add OA Rich Menu setup plus payment-provider-neutral subscription UI/backend boundary.
9. After end-to-end worklog runtime is proven, remove legacy Energy/Memory/commerce/reminder/proactive product code while retaining genuinely reusable utilities/tests.

## Bug-audit phase checklist

After core MVP flow exists, repeatedly audit:
- duplicate LINE delivery/idempotency, including concurrent redelivery snapshot behavior
- quoted content expiry/wrong content type
- group leave/rejoin and pending -> promoted race
- owner binding ambiguity/reassignment/transfer edge cases
- blocked member still writing or consuming AI while retaining intended read access
- actor/charged identity swap or wrong owner charge
- quota reservation overspend/leak/double commit/release/cycle-boundary behavior
- plan downgrade/allowance edits vs snapshotted active period
- OA friend/unfriend drift and ordinary support messages accidentally routed to AI
- OA parser/group parser double-processing when the webhook contains mixed source types
- private Web-entry token accidentally gaining group scope or vice versa
- cross-group/personal scope leakage and FREE collaboration leakage
- historical AI price snapshots, record counters and member usage attribution drift
- concurrent edits/audit, AI fallback, transaction duplication, feedback attribution, anomaly noise
- PWA mobile/desktop usability, admin filtering/sorting and migration/bootstrap reliability
