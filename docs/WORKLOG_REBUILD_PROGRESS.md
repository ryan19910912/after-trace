# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for continued development on branch `revive/line-worklog`.

Every development run must:
1. Read this file and `docs/WORKLOG_PRODUCT_SPEC.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to bug audit, edge cases, data consistency, LINE webhook behavior, error recovery, PWA UX, and tests.

## Baseline

- Branch was revived from commit `bfa722166f44661c06af9fd338d8217217e5dbd7`, the last full LINE-first assistant state before the sports-availability rebuild.
- Reusable foundations include LINE webhook signature verification, group event parsing, `quotedMessageId`, reply/push clients, attachment content fetch, `@AFTERTRACE` mention parsing, web entry/auth utilities, PostgreSQL/Drizzle, React/Vite web/admin apps, and tests.
- Existing sports availability/radar code on newer `main` must not be merged into this branch unless a generic utility is clearly reusable.

## Product decisions locked for MVP

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Reply attachment/audio/image/file + `@AFTERTRACE` records quoted content.
- Expired quoted LINE content returns a clear resend message; do not permanently buffer every group message only to support old replies.
- `@AFTERTRACE 查詢` returns a scoped Web/PWA entry link; LIFF is not required.
- No natural-language PWA record search initially.
- Group users may read only records from that group.
- OA-friend users have personal records; users who also participate in groups see personal/group surfaces separately.
- Ordinary OA private text without `@AFTERTRACE` is human-customer-service traffic, not automatic AI recording.
- Track LINE OA friendship/link state in DB.
- OA Rich Menu needs: 使用教學 / 查看紀錄 / 付款訂閱 / 意見回饋.
- Plans are operator-configurable (`FREE`, `SUB1`, `SUB2`, future codes), including price, AI allowance and capability flags.
- FREE is personal-only; group collaboration requires a non-FREE enabled plan/capability.
- AI usage is bounded; there is no unlimited AI default.
- AI provider/model and input/output/media prices are DB/admin editable. Historical usage keeps immutable pricing/cost snapshots.
- Group owner is the reliably identified user who adds/binds the Bot; if LINE does not expose a trustworthy actor, ownership stays unbound until an explicit claim/bind flow.
- Group AI usage is charged to the group owner while retaining the triggering member as actor attribution.
- Owner can disable individual members from recording; blocked members must be rejected before provider usage.
- Owner PWA must expose owner quota/used/remaining plus group/member AI usage, TEXT/AUDIO/IMAGE/FILE counts and member recording permission controls.
- Internal admin needs anomaly monitoring, feedback, user list/filter/sort/detail, quota/usage/balance, record counts, group owner/member detail, plan/capability/quota editing, AI model/pricing editing and manual plan assignment.
- Admin auth stays intentionally lightweight for MVP: one configured username/password.
- Customer/project fields remain minimal with free-text notes; no custom-field builder initially.
- Computed financial data uses typed numeric fields/tables rather than note text.
- Invoice/Amego integration is postponed until real users request it.
- Payment provider remains undecided; build payment-neutral subscription/checkout boundaries first.
- Keep TypeScript + Hono/Cloudflare Workers + React/Vite Pages + PostgreSQL/Drizzle.
- AI assists ingestion; DB/query logic remains accounting/access truth.

## Completed

### 2026-09-02 initial revival

- Created `revive/line-worklog` from the legacy LINE-first branch state.
- Added `docs/WORKLOG_PRODUCT_SPEC.md` as the product contract.
- Added `apps/api/src/worklog/command.ts` and tests for:
  - `@AFTERTRACE 查詢`
  - text recording
  - Reply + `@AFTERTRACE` quoted recording
  - ignoring ordinary group chat
- Intentionally kept the new command parser out of the old Energy/Memory runtime until new worklog persistence exists.
- Expanded product spec for admin, Rich Menu, OA friendship, human-support fallback, personal/group PWA separation, subscription/permissions, AI quota/model pricing, owner/member usage and member recording permission.

### 2026-09-02 worklog data foundation

- Added isolated worklog schema rather than mutating legacy Memory/Energy tables.
- Added worklog data models for:
  - LINE/OA users
  - workspace
  - private/group source contexts and membership
  - customer/project
  - TEXT/AUDIO/IMAGE/FILE records
  - fixed typed transactions
  - plans/capabilities/AI allowance
  - current subscription + assignment history
  - AI runtime pricing config
  - immutable AI usage events
  - feedback
  - anomaly events
  - audit logs
- Added the first worklog migration and registered worklog schema with Drizzle/runtime.
- Added entitlement helpers/tests, including the invariant that FREE cannot gain group collaboration from malformed capability JSON.
- Added AI pricing/cost snapshot helpers/tests.

### 2026-09-02 scoped record-read layer

- Added `WorklogRecordReadService` and Drizzle repository.
- Personal records require OA friendship and the viewer's exact private source.
- Group records require exact active membership before records are queried.
- Surface discovery returns personal and group surfaces separately.
- Added tests for non-OA personal denial, exact group isolation and OA+group combined surfaces.

### 2026-09-02 group ownership, billing attribution and usage layer

- Extended group sources with stable `owner_user_id`, binding method and bound timestamp.
- Added per-member `recording_enabled` and who/when updated it.
- Split AI usage identity into:
  - `actor_user_id`: member who triggered AI work
  - `charged_user_id`: owner/subscriber whose allowance is consumed
- Added migration/backfill and indexes for owner/member/usage attribution.
- Added `WorklogCollaborationService` + Drizzle repository:
  - write-once owner binding unless a future explicit transfer flow is added
  - active membership enforcement
  - recording-disabled enforcement before provider work
  - FREE/group-entitlement enforcement
  - owner quota preflight
  - owner-only member permission changes
  - owner cannot disable self
- Added tests for blocked members, FREE rejection, exhausted quota, stale membership, owner-only permission changes and owner reassignment conflict.
- Added `WorklogUsageService` + Drizzle repository:
  - user AI allowance/used/remaining/provider cost
  - TEXT/AUDIO/IMAGE/FILE counts
  - owner total usage
  - group-specific usage charged to owner
  - per-member actor AI usage and record counts
  - member display name/permission/last interaction
  - non-owner denial for owner management view

### 2026-09-02 subscription lifecycle and race-safe AI quota reservations

- Added `apps/api/src/worklog/subscription.ts` with a new subscription/quota domain boundary.
- Added plan/subscription entitlement evaluation for:
  - no subscription
  - inactive subscription
  - disabled plan
  - future effective time
  - period not started
  - period expired
  - active allowance/capabilities
- Added manual/admin plan assignment behavior:
  - plan code normalization
  - enabled-plan validation
  - ADMIN assignment requires an actor for auditability
  - default billing period is one calendar month
  - end-of-month dates clamp correctly (for example Jan 31 -> Feb 28/29)
  - FREE remains personal-only through the shared entitlement policy
- Added `apps/api/src/worklog/drizzle-subscription.ts` with history/audit writes for plan assignment.
- Added period-scoped `worklog_ai_quota_balances` rather than storing one mutable lifetime counter on the subscription row. Each balance snapshots:
  - user
  - billing period start/end
  - allowance units for that period
  - committed used units
  - currently reserved units
- Added `worklog_ai_quota_reservations` with:
  - unique token
  - charged owner/user
  - actual triggering actor
  - optional source/group
  - reserved units
  - committed units
  - RESERVED / COMMITTED / RELEASED / EXPIRED state
  - period snapshot
  - expiry timestamp
- Added hand-authored `0003_worklog_ai_quota_reservations.sql` and registered it in the migration journal.
- Added a dedicated `schema-worklog-quota.ts`, exported it via `schema-all.ts`, and registered it in `drizzle.config.ts`.
- Migration backfills current period quota balances from existing subscription plan allowance and existing charged AI usage events.
- Implemented atomic reservation with one PostgreSQL data-modifying statement:
  - increments `reserved_units` only when `used + reserved + requested <= allowance`
  - validates active subscription, enabled plan and current period in the same update
  - inserts the reservation in the same statement
  - concurrent requests therefore cannot both consume the same final units
- Implemented stale reservation expiry so abandoned provider calls release their held units.
- Implemented atomic commit:
  - reservation changes to COMMITTED only once
  - reserved units are released from the matching period balance
  - actual committed units are added to used units
  - the immutable `worklog_ai_usage_events` row is inserted in the same SQL statement with actor/charged/source/model/token/media/pricing/cost snapshot
- Implemented release for provider failures/cancellations without consuming quota.
- Actual usage is not allowed to exceed the conservative reservation; callers must reserve a safe maximum before the provider call.
- A preflight success followed by an atomic reservation miss is treated as quota exhaustion rather than allowing overspend.
- Updated collaboration preflight to include both committed **and reserved** units from the current quota balance, so in-flight requests are visible before the final atomic reserve.
- Updated admin/PWA usage summaries to expose `aiReservedUnits`; visible remaining balance now subtracts committed usage plus in-flight reservations.
- Added subscription/quota tests for:
  - used + reserved remaining calculation
  - disabled/expired plans
  - month-end billing cycle calculation
  - normalized/admin plan assignment
  - missing admin actor rejection
  - FREE collaboration denial
  - stale-hold expiry
  - atomic reserve race loss
  - commit reserved -> used
  - actual usage exceeding reservation rejection
  - release without consumption
- Updated usage tests so owner/user balances include in-flight reserved units.

## Validation performed in this development pass

- Reviewed branch HEAD and both durable worklog docs before editing.
- Performed static consistency review across:
  - subscription service contract vs Drizzle repository
  - period balance schema vs hand-authored migration
  - actor/charged identity propagation
  - reservation/commit/release state transitions
  - stale hold cleanup
  - usage summary remaining-balance math
  - collaboration preflight using current reserved units
- The race-sensitive path no longer relies only on `SUM(worklog_ai_usage_events)`; the authoritative consumption gate is the atomic quota-balance update.
- Tests were added/updated but cannot be executed in this connector-only environment because there is no checked-out runtime where `pnpm` can run.

## Known cautions before real DB deployment

- `0001`, `0002` and `0003` worklog migrations are hand-authored/journaled. Existing Drizzle snapshot metadata has not been regenerated for these worklog additions.
- Before using generated future migrations, regenerate/verify Drizzle snapshots from an executable checkout.
- Before first production deployment run, at minimum:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm db:schema:check`
  - all migrations against a disposable Neon branch/database
- The provider integration must reserve a conservative maximum AI-unit estimate before making the AI request, then commit actual units or release on failure. If actual usage could exceed the reservation, the caller must treat that as an anomaly instead of silently overcharging.
- Old quota data is backfilled from existing usage events into the active period only; verify this on a disposable copy before production because these migrations have not yet been executed here.

## Next prioritized implementation batch

1. Add source/user bootstrap write service:
   - resolve/create LINE user
   - update display name and last interaction
   - track OA follow/unfollow friendship state
   - ensure user's workspace/private OA source
   - resolve/create group source
   - maintain active group membership
   - bind owner only from a reliable actor or explicit claim; never guess
2. Resolve the pending-group storage detail cleanly before webhook integration: a LINE group may be seen before owner binding, so the new source model must be able to retain an unbound group identity without incorrectly assigning a workspace/owner.
3. Wire the new worklog command parser into LINE webhook incrementally:
   - bypass legacy Energy/Memory for worklog commands
   - bootstrap user/source/member first
   - run collaboration authorization
   - atomically reserve owner AI units before provider work
   - persist TEXT records first
   - commit actual usage / release reservation on failure
4. Reuse LINE content fetch for quoted AUDIO/IMAGE/FILE recording and return expired-content UX on fetch failure.
5. Add `@AFTERTRACE 查詢` short-lived entry token/redirect without LIFF and expose scoped personal/group surfaces.
6. Add owner PWA APIs/UI for quota/used/reserved/remaining, group burn, member counts/AI usage and recording-permission controls.
7. Repurpose internal admin around anomaly feed, feedback, user list/detail, quota/usage/balance, record counts, group owner/member details, plans/capabilities/quota, AI model pricing and manual plan changes.
8. Add OA Rich Menu setup plus payment-provider-neutral subscription UI/backend boundary.
9. After end-to-end worklog runtime is proven, remove legacy Energy/Memory/commerce/reminder/proactive product code while retaining genuinely reusable utilities/tests.

## Bug-audit phase checklist

After core features are complete, repeatedly audit:
- duplicate LINE webhook delivery/idempotency
- quoted content expiration and wrong content type
- group leave/rejoin and inactive contexts
- group owner binding ambiguity or accidental reassignment
- owner transfer edge cases if introduced
- blocked member still creating records or consuming AI
- actor/charged user swapped or wrong owner charged
- owner quota exhaustion while member submits work
- concurrent reservations overspending allowance
- reservation leaked after provider failure/timeout
- stale reservation cleanup subtracting the wrong period
- double commit/release/idempotency
- actual AI units greater than conservative reservation
- billing-cycle boundary while an AI request is in flight
- plan downgrade below already-used units
- plan/AI allowance edits and whether active-period allowance should remain snapshotted or be explicitly changed
- member usage attribution drift
- OA friend/unfriend/link drift
- ordinary OA support messages accidentally routed to AI
- cross-group/personal scope leakage
- FREE accidentally gaining collaboration
- admin plan change/audit correctness
- AI price/model change during in-flight calls
- historical cost snapshots changing incorrectly
- record counters drifting from source records
- concurrent edits/audit trail
- AI parse fallback/error recovery
- transaction duplication/consistency
- feedback attribution
- anomaly logging noise/missing critical failures
- mobile WebView and desktop responsive usability
- admin filtering/sorting correctness
- migration/bootstrap safety
