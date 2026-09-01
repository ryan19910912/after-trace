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
- Subscription plans are data-driven and operator-configurable (`FREE`, `SUB1`, `SUB2`, future codes), including price and capability flags.
- FREE is personal-only; collaboration/group access requires an enabled paid capability.
- Internal admin must support system anomaly monitoring, feedback review, user list/filter/sort/detail, plan config, and manual plan assignment.
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

## Next prioritized implementation batch

1. Design and add worklog domain/schema/migration for:
   - workspace
   - LINE user / OA friendship state
   - group/private source context
   - customer
   - project
   - record
   - transaction
   - subscription plan + capability flags
   - user subscription assignment/history
   - feedback
   - application anomaly/error events
   - edit/admin audit metadata
2. Add repository/service tests for source scoping:
   - group reads only its own records
   - OA friend gets personal records
   - OA friend + group participant can see separate personal/group surfaces
   - FREE cannot activate group capability
3. Wire the new worklog command parser into the webhook path incrementally so worklog commands bypass legacy Energy/Memory flow.
4. Track OA friend/add/remove/link events where LINE webhook/API allows it and preserve display name + last interaction.
5. Reuse LINE content fetch for quoted audio/image; return expired-content UX on fetch failure.
6. Add `@AFTERTRACE 查詢` entry-token/redirect path without LIFF dependency.
7. Reshape PWA around records, customers, projects, personal/group tabs, feedback, subscription UI, mobile/desktop responsive browsing.
8. Repurpose/rebuild internal admin around:
   - login with one configured username/password
   - overview/anomaly feed
   - feedback list with user id, display name, channel, time
   - user list filters (plan, user id, nickname, individual/group-enabled), updated-time sorting
   - user detail showing related group users excluding self
   - plan price/capability config
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
- Subscription/usage counters based on the new plan model; do not revive old Energy complexity by default.

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
