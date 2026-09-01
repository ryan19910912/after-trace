# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for scheduled development on branch `revive/line-worklog`.

Every development run must:
1. Read this file and `docs/WORKLOG_PRODUCT_SPEC.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to bug audit, edge cases, data consistency, LINE webhook behavior, error recovery, PWA UX, and tests.

## Baseline

- Branch created from commit `bfa722166f44661c06af9fd338d8217217e5dbd7`, the last full LINE-first AI assistant state before the sports-availability rebuild.
- Existing reusable LINE foundations include webhook signature verification, group event parsing, `quotedMessageId`, reply/push clients, attachment content fetch, `@AFTERTRACE` mention parsing, group identity, web auth/entry URLs, PostgreSQL/Drizzle, React/Vite web app, and tests.
- Existing repo also contains a legacy internal admin app that can be repurposed instead of rebuilt from zero.
- Do not merge sports availability/radar product logic from current `main` into this branch unless a generic utility is clearly reusable.

## Product decisions locked for MVP

- LINE records; Web/PWA browses/manages.
- Group trigger is `@AFTERTRACE`.
- `@AFTERTRACE <text>` = record text.
- Reply attachment/audio/image + `@AFTERTRACE` = record quoted content.
- If quoted attachment content expired at LINE, return a simple expired-content response; do not permanently buffer every group message just to support old replies.
- `@AFTERTRACE 查詢` = generate PWA entry link for current group + caller.
- No natural-language PWA search for MVP.
- PWA filters primarily by customer/project and basic metadata.
- Group users may browse only records originating from that group.
- OA-friend users get a personal/private record surface; if they also participate in group collaboration, PWA shows personal and group records separately.
- Track LINE OA friendship/link state in DB.
- Ordinary private OA text without `@AFTERTRACE` is human-customer-service traffic, not automatic AI recording.
- OA bottom menu/Rich Menu needs: 使用教學, 查看紀錄, 付款訂閱, 意見回饋.
- Subscription plans are data-driven and operator-configurable (`FREE`, `SUB1`, `SUB2`, future codes), including price, AI quota, and capability flags.
- Every plan has bounded AI usage; no unlimited AI by default.
- AI model/provider and input/output pricing must be DB-backed/admin-editable so future model/pricing changes do not require a code deploy.
- AI usage events must preserve model/token/media/cost snapshots for historical cost audit even after prices change.
- FREE is personal-only; collaboration/group access requires an enabled paid capability.
- Group owner is the user who adds/binds the Bot to that group when that actor can be identified reliably; do not guess if LINE does not expose it.
- Group AI usage is charged to the group owner's/subscriber's AI allowance while preserving the triggering member as actor attribution.
- Group owner PWA must show owner AI quota/usage/remaining plus per-member TEXT/AUDIO/IMAGE/FILE record counts and AI usage.
- Group owner can disable recording permission for individual group members to prevent unrelated/noisy users from creating records or burning AI quota.
- Internal admin must support system anomaly monitoring, feedback review, user list/filter/sort/detail, plan config, AI model/pricing config, AI usage analytics, group ownership/usage visibility, member recording permission visibility, and manual plan assignment.
- Main user list/detail must show current AI quota, usage, remaining balance, plus TEXT/AUDIO/IMAGE/FILE record counts.
- Admin security is intentionally lightweight for MVP: one configured username/password; no complex RBAC/SSO/MFA.
- Customer/project schemas stay minimal; industry-specific information goes in free-text notes.
- No custom-field builder in MVP.
- Finance requiring calculations uses fixed typed fields/tables, not note text.
- Electronic invoice/Amego integration is postponed until real users ask for it.
- Payment provider is undecided; build checkout intent/subscription domain/UI boundary first.
- Keep TypeScript + Hono Workers + React/Vite Pages + PostgreSQL/Drizzle.
- AI is ingestion assistance, not accounting/query truth.

## Completed

### 2026-09-02 initial revival

- Created `revive/line-worklog` from legacy LINE Bot commit `bfa7221`.
- Confirmed old branch contains the useful LINE foundations instead of rebuilding them from sports `main`.
- Added `docs/WORKLOG_PRODUCT_SPEC.md` with the current MVP contract and scope.
- Added `apps/api/src/worklog/command.ts`, a new narrow command parser independent of legacy Energy/Memory behavior.
- Command parser defines `@AFTERTRACE 查詢`, text recording, and Reply + `@AFTERTRACE` quoted recording without requiring the word `紀錄`.
- Added unit tests covering query, text record, quoted audio/image-style record instructions, and ignoring normal group chat.
- Expanded product spec with internal admin, OA Rich Menu, OA friendship tracking, human-support fallback, personal/group PWA separation, plan/permission management, feedback, manual subscription administration, AI quota/model pricing, and owner/member usage requirements.

### 2026-09-02 worklog data foundation

- Added isolated `apps/api/src/db/schema-worklog.ts` instead of mutating legacy LINE/Memory tables before the new runtime is ready.
- Added core worklog tables/enums for LINE/OA users, workspace, sources, membership, customer/project, records, transactions, plans/capabilities, subscriptions/history, AI runtime config, AI usage snapshots, feedback, anomaly events, and audit log.
- Registered the worklog schema and added the first migration.
- Added explicit FREE/group entitlement policy and bounded AI allowance helpers.
- Added immutable AI pricing/cost snapshot helpers and tests.

### 2026-09-02 scoped record-read layer

- Added `WorklogRecordReadService` and repository contract with explicit personal/group source scoping.
- Personal records require OA friendship/private source; group records require exact active membership.
- PWA surface discovery returns personal and group surfaces separately.
- Added tests for personal/group isolation and combined OA+group surfaces.

### 2026-09-02 group ownership, billing attribution, and usage layer

- Extended `worklog_sources` with stable group `owner_user_id`, owner binding method, and bound timestamp while retaining the earlier subscription-owner field for compatibility/future billing separation.
- Extended `worklog_source_members` with `recording_enabled` plus who/when changed that permission.
- Replaced ambiguous AI usage `user_id` semantics with explicit `actor_user_id` and `charged_user_id`:
  - actor = member who triggered AI work
  - charged = owner/subscriber whose quota is consumed
- Added indexes for owner lookup, source/member recording checks, source+author record aggregation, charged-user quota aggregation, and source+actor usage aggregation.
- Added hand-authored `0002_worklog_group_ownership.sql` migration with safe backfill:
  - existing group subscription owner becomes initial owner when present
  - existing AI usage actor is also charged user for historical rows
- Added `WorklogCollaborationService` and Drizzle repository:
  - stable owner binding is write-once unless a future explicit transfer flow is added
  - owner binding uses compare/update semantics so two claims cannot silently replace each other
  - only active group members can record
  - blocked members are rejected before AI usage
  - FREE/disabled group entitlement is rejected
  - owner AI quota is checked before provider work
  - successful authorization returns separate actor and charged owner ids
  - only owner can change member recording permission
  - owner cannot disable their own recording permission
- Added collaboration tests for owner charge attribution, blocked members, FREE rejection, exhausted owner quota, stale membership, owner-only permission changes, self-disable protection, and ownership reassignment conflict.
- Added `WorklogUsageService` and Drizzle repository for admin/PWA usage surfaces:
  - current plan AI allowance, used units, remaining units, provider cost
  - TEXT/AUDIO/IMAGE/FILE record counts per user
  - owner total quota burn across personal/groups
  - group-specific AI burn charged to owner
  - per-member actor AI usage inside a group
  - per-member record counts, display name, recording permission, last interaction, and update time
  - group owner usage view is forbidden to non-owners
- Added usage tests covering AI balance math, record counters, group burn, per-member attribution, and non-owner access denial.

## Validation / caution

- Connector-only development cannot execute pnpm/typecheck/tests/migrations directly.
- Static review was performed for the new schema/migration alignment, authorization order, owner write-once behavior, actor-vs-charged attribution, quota aggregation scope, and PWA owner access boundary.
- Before first real DB deployment, run `pnpm typecheck`, `pnpm test`, `pnpm db:schema:check`, and migrations against a disposable Neon DB.
- `0001_worklog_foundation.sql` and `0002_worklog_group_ownership.sql` are hand-authored/journaled; regenerate/verify Drizzle snapshot metadata before relying on generated follow-up migrations.
- Quota authorization currently performs a read/preflight. Before webhook AI calls are enabled at scale, add an atomic reservation/consume mechanism so concurrent group messages cannot both pass against the same final remaining units.

## Next prioritized implementation batch

1. Add subscription-plan repository/service with:
   - current plan lookup and capability parsing
   - manual admin assignment + history/audit
   - billing-cycle computation
   - plan enabled/expired-period behavior
   - group activation checks
   - atomic AI quota reservation/commit/release or another race-safe consumption design
2. Add source/user bootstrap write service:
   - resolve/create LINE user
   - update display name and last interaction
   - track OA friend/follow/unfollow state
   - resolve/create private OA source
   - resolve/create group source
   - maintain active group membership
   - bind group owner from a reliable actor when available; otherwise leave owner unbound for explicit claim instead of guessing
3. Wire the new worklog command parser into LINE webhook incrementally:
   - bypass legacy Energy/Memory paths
   - run group authorization before AI/provider calls
   - persist actor/charged owner on AI usage
   - persist TEXT records first
4. Reuse LINE content fetch for quoted AUDIO/IMAGE/FILE recording and return expired-content UX on fetch failure.
5. Add `@AFTERTRACE 查詢` entry-token/redirect without LIFF and expose scoped personal/group surfaces.
6. Add owner PWA APIs/UI for:
   - owner allowance/used/remaining
   - group AI burn
   - member TEXT/AUDIO/IMAGE/FILE counts
   - member AI usage
   - enable/disable member recording permission
7. Repurpose admin around anomaly feed, feedback, user list/detail, AI quota/usage/balance, record counts, group owner/member details, plans/capabilities/AI quota, AI model pricing, and manual plan changes.
8. Add OA Rich Menu setup and payment-provider-neutral subscription UI/backend boundary.
9. After end-to-end worklog runtime is proven, remove legacy Energy/Memory/commerce/reminder/proactive product code while keeping reusable utilities/tests.

## Bug-audit phase checklist

After core features are complete, repeatedly audit:
- duplicate LINE webhook delivery/idempotency
- quoted content expiration and wrong content type
- group leave/rejoin and inactive contexts
- group owner binding ambiguity or accidental ownership reassignment
- owner transfer edge cases if introduced
- blocked member still consuming AI or creating records
- AI usage charged to wrong user/owner
- owner quota exhausted while member submits work
- concurrent AI requests overspending owner quota
- per-member usage attribution drift
- OA friend/unfriend/link state drift
- ordinary OA support messages accidentally routed to AI
- user/group token leakage or cross-group record access
- personal/group PWA scope leakage
- FREE user accidentally gaining collaboration access
- manual admin plan changes and capability cache consistency
- plan edits affecting active subscribers incorrectly
- AI quota reset/cycle boundaries and over-consumption races
- AI model/pricing configuration changes during in-flight calls
- historical AI cost snapshots changing incorrectly after admin price edits
- record-type counters drifting from actual records
- concurrent edits and audit trail
- AI parse failures/fallback to raw record
- transaction consistency and duplicate financial records
- feedback attribution correctness
- anomaly logging noise/missing critical failures
- mobile WebView usability and desktop responsive layout
- admin filtering/sorting correctness
- error recovery and migration/bootstrap safety
