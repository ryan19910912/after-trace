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
- `docs/WORKLOG_LINE_CONTENT_POLICY.md` is now the durable LINE Reply/content-retention contract: only ordinary group TEXT is temporarily cached in PostgreSQL, with MVP defaults of **5 days / 1000 messages per group**; AUDIO/IMAGE/FILE are never locally cached and are fetched directly from LINE when the user Replies. Do not add Redis for this cache.

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

### 2026-09-02 OA/private webhook cutover

- Added `processWorklogOaWebhook` as an explicit OA-only processing boundary between parsed LINE events and `WorklogOaRuntime`.
- `/webhooks/line` now parses **both** group and OA streams before deciding there is no work, so OA-only webhook deliveries are no longer silently returned as `NO_WORK`.
- OA `FOLLOW` / `UNFOLLOW` events now reach `WorklogOaRuntime.handleLifecycle`, which delegates to the new worklog bootstrap state.
- OA private messages now reach `WorklogOaRuntime.handleMessage` and therefore support end-to-end personal raw TEXT recording with the same LINE message-id idempotency used by groups.
- Ordinary OA private text remains human-support traffic:
  - it is counted separately as `oaHumanSupportMessages`
  - it is never passed into the legacy group conversation/Energy/Memory runtime because that runtime consumes only the separately parsed group stream
  - even if the OA touch/bootstrap persistence call throws, the webhook does **not** emit an automated product-error reply to an ordinary support message
- Explicit OA worklog commands receive replies; lifecycle events and ordinary support messages do not receive automatic product replies.
- Added OA webhook diagnostics:
  - lifecycle events
  - worklog commands
  - records
  - duplicate records
  - rejected commands
  - queries
  - human-support messages
  - processing/reply errors
- Added a private-query URL callback seam. It receives only `{ lineUserId, sourceId, userId, at }`; no fake group id is introduced. The real private Web-auth implementation remains the next batch.
- Fixed an important delivery-consistency bug while wiring the boundary: a LINE reply API failure after a successful DB record write no longer changes the record outcome to `REJECTED` or attempts a second reply with the same reply token. Record success remains success; reply failure is tracked independently in `oaErrors`.
- Added tests for human-support bypass/no reply, personal record result/duplicate counters, private query callback shape, explicit runtime failure, ordinary support runtime failure, lifecycle processing, and successful-record preservation when LINE reply delivery fails.

### 2026-09-02 LINE Reply/content retention policy

- Added `docs/WORKLOG_LINE_CONTENT_POLICY.md` as the durable implementation contract for LINE Reply recovery and attachment retention.
- Only ordinary **group TEXT** is eligible for temporary local cache:
  - PostgreSQL only
  - 5-day default TTL
  - 1000-message default per-group cap
  - cached text is not a work record and is not AI input until an explicit Reply + `@AFTERTRACE`
- AUDIO / IMAGE / FILE are never cached locally. Reply handling uses `quotedMessageId` to call LINE content API directly; unavailable/expired LINE content must produce clear resend UX.
- Original attachment binaries are discarded after successful extraction/transcription/understanding; durable records retain textual/structured results plus LINE trace ids rather than the binary.

## Validation performed in latest pass

- Read the latest product spec and progress document before editing.
- Confirmed branch HEAD at the start of this pass was `46e3703b335cb736efb997dbb863219d315c28dc` and inspected the latest OA parser/runtime, group webhook cutover, command parser, bootstrap and Web-auth boundaries before changing anything.
- Inspected the recent branch commit chain and kept the existing group parser/runtime contract intact while adding a separate OA processor.
- Statically reviewed the cutover for:
  - OA-only payloads no longer being discarded by the old group-only early return
  - group/OA source separation and no legacy Energy/Memory fallthrough for ordinary OA support messages
  - follow/unfollow lifecycle delegation
  - personal TEXT idempotency reuse
  - reply-token single-use behavior on delivery failure
  - record outcome remaining durable when the LINE reply API fails
  - private query seam not inventing/reusing a group id
  - OA diagnostics remaining separate from group/legacy counters
- Code HEAD after the implementation/test batch was `7f710689748f555d7c08362996fbc2408772eb15`.
- The branch then advanced by two docs-only commits defining/clarifying the LINE content policy; reviewed those commits and aligned this progress file. Branch HEAD immediately before this progress update was `8f0a1a813c631f89beb93de4a854f7b529845a93`.
- Unit tests were authored/expanded but **not executed** in this connector-only environment. A direct repository checkout attempt was unavailable because the execution container cannot resolve GitHub; CI only runs on `main`/pull requests, not direct pushes to this branch.

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
- Reply AUDIO/IMAGE/FILE is deliberately intercepted but not persisted yet until the new content-fetch/attachment processing path is connected.
- Personal `@AFTERTRACE 查詢` now reaches the webhook and resolves a personal source/user target, but the external Web-entry/auth boundary still needs a real private-user token/nonce path; do not fake a group id to reuse group membership verification.
- The 5-day / 1000-message PostgreSQL TEXT cache policy is documented but not implemented yet. It must be group/source isolated, safely pruned, and must never cache AUDIO/IMAGE/FILE.
- Ordinary non-`@AFTERTRACE` group chat still flows through the legacy conversation runtime temporarily. New worklog commands do not. Remove the old path only after the new MVP runtime is proven end-to-end.

## Next prioritized implementation batch

1. Add a **private-user Web entry/auth path** for `@AFTERTRACE 查詢`:
   - do not invent a group id
   - bind the one-time entry nonce/token to the LINE user + personal source
   - verify the user still has active OA friendship/personal-source access before issuing the Web session
   - plug the resulting URL creator into the existing OA webhook query callback
   - continue to expose personal/group surfaces separately after login
2. Add AI-assisted TEXT normalization as a **post-persistence** step:
   - add narrow normalized-record contract (summary/category/customer/project hints only)
   - load DB-backed active model/pricing
   - reserve conservative AI units atomically for the charged user (group owner; personal user for OA)
   - call provider
   - commit actual usage with actor/charged/source/model/pricing snapshots
   - update normalized fields only after provider success
   - release reservation and retain raw record on every provider/error/parse failure
   - make normalization itself idempotent on LINE redelivery/retry
3. Implement the documented PostgreSQL Reply-to-TEXT cache:
   - only ordinary group TEXT enters the cache
   - keyed by LINE message id + exact group/source identity
   - 5-day TTL and 1000-message per-group cap
   - deterministic oldest-first cap pruning and expired-row cleanup
   - Reply-to-TEXT resolves `quotedMessageId` from the cache and persists both command + quoted LINE ids
   - cross-group lookup must be impossible
   - no Redis and no AUDIO/IMAGE/FILE cache rows
4. Reuse existing LINE content fetch for quoted AUDIO/IMAGE/FILE:
   - use `quotedMessageId` to fetch directly from LINE; do not add an attachment cache
   - resolve quoted content type safely
   - persist durable extracted/transcribed text + metadata/source references, not binaries
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
- only TEXT entering the temporary cache; no AUDIO/IMAGE/FILE cache rows/binaries
- 5-day TEXT TTL pruning and 1000-message cap pruning order
- Reply-to-TEXT cache expiry and cross-group isolation
- quoted attachment expiry/wrong content type/content API errors
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
- LINE reply failures after successful persistence must not cause duplicate writes or false rejection state
- PWA mobile/desktop usability, admin filtering/sorting and migration/bootstrap reliability
