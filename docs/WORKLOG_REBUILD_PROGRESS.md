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
- Internal admin must support system anomaly monitoring, feedback review, user list/filter/sort/detail, plan config, AI model/pricing config, AI usage analytics, and manual plan assignment.
- Main user list/detail must show current AI usage plus TEXT/AUDIO/IMAGE/FILE record counts.
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
- Command parser now defines the intended V1 contract: `@AFTERTRACE 查詢`, text recording, and Reply + `@AFTERTRACE` quoted recording without requiring the word `紀錄`.
- Added unit tests covering query, text record, quoted audio/image-style record instructions, and ignoring normal group chat.
- The new parser is intentionally not wired into the old webhook runtime yet; integration should happen after the new worklog persistence schema exists so we do not route records into legacy memory tables.
- Expanded `docs/WORKLOG_PRODUCT_SPEC.md` with internal admin, OA Rich Menu, OA friendship tracking, human-support fallback, personal/group PWA separation, plan/permission management, feedback fields, user-list/detail requirements, and manual subscription administration.
- Added admin-editable AI quota per plan, AI provider/model configuration, input/output pricing, separate media pricing where needed, historical usage cost snapshots, and per-user AI usage plus TEXT/AUDIO/IMAGE/FILE record counts.

### 2026-09-02 worklog data foundation

- Added an isolated `apps/api/src/db/schema-worklog.ts` instead of mutating legacy LINE/Memory tables before the new runtime is ready.
- Added core worklog tables/enums for:
  - LINE/OA users and OA friendship state
  - workspace
  - private/group source contexts and group membership
  - customer/project
  - record with normalized `TEXT` / `AUDIO` / `IMAGE` / `FILE` input type and broad record category
  - fixed numeric transactions
  - subscription plans with JSON capability flags and bounded AI allowance
  - current user subscription plus assignment history
  - singleton AI runtime model/provider/pricing configuration
  - immutable AI usage events with pricing/model/token/media/cost snapshots
  - feedback
  - anomaly/error events
  - worklog/admin audit log
- Registered the worklog schema in `schema-all.ts` and `drizzle.config.ts`.
- Added `drizzle/0001_worklog_foundation.sql` and registered it in the Drizzle migration journal.
- Added a root `db:migrate` command and fixed its config path.
- Switched the database client to register `schema-all.ts`, so new worklog schema is available to runtime code without discarding legacy tables during migration.
- Added `apps/api/src/worklog/entitlements.ts` with explicit policy that FREE can never enable group collaboration even if bad capability JSON says otherwise.
- Added bounded AI allowance helpers and an immutable AI pricing/cost snapshot helper.
- Added unit tests for FREE/group entitlement, capability JSON sanitization, quota remaining/over-consumption, historical pricing snapshots, token/media cost computation, and negative-price rejection.

### 2026-09-02 scoped record-read layer

- Added `WorklogRecordReadService` and a repository contract that make source scoping explicit before PWA routes exist.
- Personal records are available only when the viewer is an OA friend and only through that viewer's active private source.
- Group records require an active membership check for the exact requested group source before any record query executes.
- PWA surface discovery returns personal and group surfaces separately instead of merging them into one ambiguous timeline.
- Added `DrizzleWorklogRecordReadRepository` using the new worklog tables and filtering inactive members/sources at the query boundary.
- Added tests covering:
  - non-OA users cannot read personal records
  - OA friends can read only their private source
  - arbitrary group source IDs are rejected before querying records
  - exact active group membership grants only that group's records
  - OA friend + group participant receives separate personal/group surfaces
  - group access alone does not create personal access

## Validation performed in this round

- Compared branch before/after the data-foundation changes and confirmed it moved strictly forward from the starting HEAD with schema, migration, entitlement, and scope-layer changes committed on `revive/line-worklog`.
- Performed static consistency review of schema/table names, indexes, migration names, the corrected `db:migrate` relative config path, and group/private query predicates.
- Tests/typecheck were added but were not executed in this connector-only run because there is no checked-out repository/runtime available to execute pnpm. A future run with an executable checkout should run `pnpm typecheck`, `pnpm test`, `pnpm db:schema:check`, and migration against a disposable DB before production use.

## Known blocker / migration caution

- `0001_worklog_foundation.sql` is hand-authored and journaled because this run cannot execute Drizzle Kit generation. The existing Drizzle snapshot metadata has not been regenerated for the new schema. Do not use `drizzle-kit generate` for the next migration until the snapshot is regenerated from an executable checkout; meanwhile migrations can remain explicitly hand-authored/journaled. Before first real DB deployment, verify exported schema and migration on a disposable Neon branch/database.

## Next prioritized implementation batch

1. Add reliable admin/user usage aggregation for:
   - current-cycle AI units/cost from `worklog_ai_usage_events`
   - TEXT/AUDIO/IMAGE/FILE record counts from `worklog_records`
   - last interaction / updated time
2. Add subscription-plan repository/service with:
   - current plan lookup
   - capability parsing
   - manual admin plan assignment + history/audit
   - AI allowance cycle computation and safe over-consumption preflight
   - group-source activation check that refuses FREE or plans without collaboration capability
3. Add source/user bootstrap write service for the new runtime:
   - resolve/create LINE user
   - resolve/create private OA source
   - resolve/create group source
   - maintain active group membership
   - update OA friendship/display name/last interaction
4. Wire the new worklog command parser into the LINE webhook incrementally so worklog commands bypass legacy Energy/Memory flow and persist to new worklog tables.
5. Reuse LINE content fetch for quoted audio/image; return expired-content UX on fetch failure.
6. Add `@AFTERTRACE 查詢` entry-token/redirect path without LIFF dependency.
7. Reshape PWA around records, customers, projects, personal/group tabs, feedback, subscription UI, mobile/desktop responsive browsing.
8. Repurpose/rebuild internal admin around:
   - login with one configured username/password
   - overview/anomaly feed
   - feedback list with user id, display name, channel, time
   - user list filters (plan, user id, nickname, individual/group-enabled), updated-time sorting
   - per-user AI usage + TEXT/AUDIO/IMAGE/FILE counts
   - user detail showing quota/usage and related group users excluding self
   - plan price/capability/AI-quota config
   - AI model/provider/input/output/media-price config
   - global/recent AI usage and cost view for quota tuning
   - manual user plan change
9. Add OA Rich Menu configuration/setup for 使用教學 / 查看紀錄 / 付款訂閱 / 意見回饋 and keep normal OA text for human service unless `@AFTERTRACE` is used.
10. Add payment-provider-neutral checkout intent/API and subscription UI only; do not choose provider or implement real payment settlement yet.
11. After the new runtime works end-to-end, remove old Energy/Memory/commerce/reminder/proactive product code that is no longer needed, but keep generic reusable utilities/tests.

## Later MVP batch

- AI record normalization and multimodal ingestion behind a narrow structured contract.
- Customer/project fuzzy association with confirmation when ambiguous.
- Fixed financial transactions and simple received/expense views.
- Workspace owner settings/export if real users need export.
- Richer anomaly resolution workflow if admin usage proves useful.
- Real payment-provider integration after provider choice.
- Usage dashboards/alerts for unexpectedly high AI cost or quota burn.

## Bug-audit phase checklist

After core features are complete, repeatedly audit:
- duplicate LINE webhook delivery/idempotency
- quoted content expiration and wrong content type
- group leave/rejoin and inactive contexts
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
- ambiguous customer/project association
- concurrent edits and audit trail
- AI parse failures/fallback to raw record
- transaction consistency and duplicate financial records
- feedback channel/user attribution correctness
- anomaly logging volume/noise and missing critical failures
- mobile WebView usability, font/button size, old Android browsers
- desktop responsive layout
- admin user-list filtering/sorting correctness
- error recovery and user-visible error messages
- migration safety and fresh database bootstrap
