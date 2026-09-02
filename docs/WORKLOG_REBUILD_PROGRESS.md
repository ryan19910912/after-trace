# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

The accelerated MVP implementation/static-audit phase is now considered **feature-complete enough to enter the concentrated local validation phase**. This is not a claim that executable verification passed. Do not use GitHub Actions unless the user explicitly requests it.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Group Reply + `@AFTERTRACE` records cached quoted TEXT while that text is still inside the bounded group cache; Reply AUDIO/IMAGE/FILE uses the direct LINE content API.
- OA/private ordinary support text is not cached; because LINE provides no API to retrieve past text again by message id, a later private Reply-to-TEXT must ask the user to re-enter `@AFTERTRACE 原文` instead of weakening the privacy policy.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- Ordinary OA private text remains human-support traffic unless explicitly triggered.
- Personal/group sources are isolated.
- FREE is personal-only; group collaboration requires current paid entitlement/capability.
- Group AI usage charges the stable group Owner while retaining triggering actor attribution.
- Owner can disable future member recording without removing historical read access.
- Customer/project stays intentionally minimal; finance is typed/deterministic.
- Original LINE input remains immutable source-of-truth.
- Three independent Cloudflare Workers: API, Web Static Assets, Admin Static Assets. No Pages.

## Implemented MVP surface

- Worklog user/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Stable group ownership/bootstrap plus owner member-recording controls.
- Raw TEXT persistence and LINE-message idempotency.
- Reply TEXT temporary PostgreSQL cache: 5 days / 1000 per group, no Redis.
- Reply AUDIO/IMAGE/FILE direct LINE content fetch, no binary persistence, expired content asks user to resend.
- Durable Gemini TEXT normalization and attachment ingestion with pricing/model snapshots and quota reservation/settlement.
- Secure GROUP/PRIVATE one-time Web entry plus ordinary LINE Login; no LIFF.
- PWA personal/group record browsing, server filtering/pagination, owner usage/member controls, customer/project CRUD, record organization, typed finance and feedback.
- Worklog Admin username/password + HMAC session, user/group/plan/quota/AI runtime/feedback/anomaly/audit surfaces.
- Provider-neutral idempotent checkout-intent boundary; payment provider intentionally not connected yet.
- Worklog-only API runtime; retired Memory/Energy/conversation/reminder/commerce runtime removed/tombstoned.

## Data / entitlement hardening already completed

- GROUP read/record authorization checks active membership, bound Owner, non-FREE enabled plan, temporal subscription validity and `groupCollaboration=true`.
- Expired persisted `status='ACTIVE'` does not grant GROUP access.
- No-active-cycle usage no longer displays lifetime AI usage as a current FREE-cycle metric.
- `0012_worklog_quota_cycle_snapshot.sql` protects current billing-cycle allowance snapshots from plan-template/same-period reassignment mutation.
- `0013_worklog_project_customer_consistency.sql` keeps existing project-linked records/transactions consistent when project customer changes.
- `0014_worklog_oa_friend_state_time.sql` adds a dedicated FOLLOW/UNFOLLOW event-time clock so ordinary private-message timing does not corrupt friendship ordering.
- Project customer remains authoritative for newly linked record/transaction writes.
- Admin/PWA subscription presentation computes effective temporal/plan state rather than blindly trusting persisted ACTIVE.
- Checkout-intent creation uses DB conflict handling rather than unsafe SELECT-then-INSERT idempotency.

## Attachment / AI reliability

- Attachment flow is claim -> content fetch -> quota reserve -> Gemini -> atomic record + `RECORD_CREATED` persistence -> quota commit -> success.
- Provider output is never automatically replayed after an uncertain provider attempt.
- Attachment persistence uncertainty does not release quota after provider success and does not call Gemini again.
- Stale uncertain attachment PROCESSING terminalizes for manual review.
- Attachment Admin retry policy distinguishes `SAFE_RETRY`, `RESEND_REQUIRED`, and conservative `MANUAL_REVIEW`.
- Runtime quota settlement uses `SafeDrizzleWorklogSubscriptionRepository`, which locks reservation + matching billing-cycle balance before COMMIT/RELEASE so reservation/balance state cannot split under settlement races.

## Validation-stage bug audit fixes

### 1. TEXT provider-result persistence uncertainty

- Provider-success + DB persistence uncertainty no longer releases quota or allows automatic provider replay.
- Stale uncertain TEXT normalization PROCESSING terminalizes as `AI_NORMALIZATION_PROCESSING_STALE_UNCERTAIN` for operator review.
- Focused tests cover provider-success persistence failure and provider-call failure semantics; not executed yet.

### 2. LINE content endpoint 202 was treated as usable attachment bytes

- `LineMessageContentResolver` maps HTTP 202 to `LINE_CONTENT_NOT_READY` before reading response body.
- No 202 preparation body can reach Gemini.
- Runtime tells the user to wait and Reply `@AFTERTRACE` again without re-uploading.

### 3. Quoted TEXT incorrectly fell through to binary content API when unavailable from cache

- LINE has no API to reconstruct past text by message id; binary content API is image/video/audio/file only.
- Group quoted TEXT works only through the scoped 5-day/1000-message PostgreSQL cache; after expiry the user must re-enter the original text.
- OA/private ordinary support text remains uncached by policy, so private Reply-to-TEXT explicitly asks for `@AFTERTRACE 原文`.
- HTTP 400 from content retrieval is mapped to `LINE_CONTENT_NOT_RETRIEVABLE` instead of generic attachment failure.

### 4. Previously-left Worklog group could remain permanently INACTIVE after the bot was re-added

- LINE `LEAVE` marks the bound source/members inactive.
- A known bound source in `INACTIVE` state is now restored to `ACTIVE` on a new valid group interaction or active member-presence event.
- Existing source id, stable Owner and prior member recording permissions are preserved.
- Focused leave -> rejoin regression test is authored; not executed yet.

### 5. Delayed/out-of-order LINE group lifecycle events could overwrite newer state

- Group reactivation/deactivation is event-time monotonic.
- Bound/pending member `is_active` updates only apply when the incoming event timestamp is at least as new as existing `last_seen_at`.
- Older delayed `LEAVE` / `memberLeft` cannot overwrite a newer rejoin / `memberJoined`.
- Promotion from pending to bound does not let older pending presence overwrite newer bound-member state.
- Focused ordering tests are authored; not executed yet.

### 6. Invalid Admin request input could escape parsing as HTTP 500

Previous behavior:
- `/users/:id`, `/groups/:id`, and `/anomalies/:id` called a throwing `id()` parser outside route-level error handling.
- Manual subscription parsing also called `requiredPlanCode()` / `optionalDate()` before entering the route's guarded assignment block.
- Malformed client input such as `users/not-a-number`, `groups/0`, an invalid anomaly id, bad plan code, or malformed period-end date could therefore surface as an uncaught 500 instead of a client 400.

Current behavior:
- Admin path ids use non-throwing positive-id parsing and return explicit `INVALID_USER_ID`, `INVALID_GROUP_ID`, or `INVALID_ANOMALY_ID` with HTTP 400.
- Manual subscription plan/date parsing is explicitly caught before any database access and returns a 400 validation error.
- Focused Admin route tests cover malformed ids, bad plan code and bad period-end date; tests are authored but not executed yet.

### 7. OA FOLLOW / UNFOLLOW could be reordered or incorrectly conflated with ordinary-message time

Initial bug:
- `setOaFriendState()` unconditionally changed `is_oa_friend`, so an older delayed `unfollow` could revoke a newer `follow`.

A first attempted guard using `last_interaction_at` was rejected during the same audit because it had its own flaw:
- a legitimate FOLLOW at 12:00 followed immediately by an ordinary private message at 12:01 can be delivered message-first;
- if friendship ordering used `last_interaction_at`, the later-delivered 12:00 FOLLOW would look stale even though it is the newest friendship lifecycle event.

Final behavior:
- `0014_worklog_oa_friend_state_time.sql` adds `worklog_users.oa_friend_state_at`.
- Drizzle schema includes the same column.
- `setOaFriendState()` compares only FOLLOW/UNFOLLOW timestamps against `oa_friend_state_at`; ordinary interaction timestamps remain independent.
- `first_oa_added_at` keeps the earliest known follow time, while `last_interaction_at` continues tracking general interaction activity.
- Focused tests cover older delayed unfollow after a newer follow and delivery inversion where a later ordinary message arrives before the earlier FOLLOW event; tests are authored but not executed.

Latest commits in this validation-stage sequence include:
- `26619796e91361c9f2bcbfc425d360a22e708d46` — return explicit 400 for invalid Admin inputs.
- `290bd4931344c1c2e7e9b5adbd774a9908ff13ea` — Admin invalid-input regression tests.
- `50e7045c6b40326f77f18bc7f7bd04e3b0484ef8` — initial OA stale-event guard found during audit; superseded by dedicated lifecycle-clock hardening below.
- `ebca0c6c49c462c3a894c2698f979e63d377f237` — add `oa_friend_state_at` to active Drizzle schema.
- `8dc166a2031c50cf00a8ebdffe9eb9e8282c7c15` — order OA friendship changes by dedicated lifecycle timestamp.
- `b79e37d5f41e4b1bfe251115c51c09d4d1feee8b` — add journaled `0014_worklog_oa_friend_state_time.sql`.
- `f1e63b94e3ed2a8f2e86c62d17e8b67a46b6628e` — journal migration `0014`.
- `76ec4cf6be95bcaa31981011a775dfcffd205575` — OA lifecycle ordering regression tests.
- `06ec506bcb39ba2b0d349887d3b02b961c81f901` — deployment sequence updated through `0014`.

## Static validation performed in latest batch

- Re-read current branch and durable progress/deployment contract.
- Audited Admin route parsing and closed malformed-input 500 paths.
- Re-audited OA friendship lifecycle ordering and rejected the first `last_interaction_at`-based fix after identifying its message/follow delivery-inversion flaw; replaced it with a dedicated lifecycle clock.
- Confirmed group read/record authorization remains tied to active source/member + current Owner entitlement.
- Re-checked quota settlement concurrency: the first COMMIT locks and transitions the reservation; a concurrent redelivery subsequently observes non-`RESERVED` durable state and does not insert a second usage event.
- Re-checked private one-time nonce consumption/source/OA-friend validation after friendship-ordering changes.
- Re-read `0001_worklog_foundation.sql`: core Worklog CRM/record/transaction relationships currently rely on application validation rather than FK constraints. This creates a potential concurrent delete/link TOCTOU risk that should be exercised during disposable-DB validation before deciding whether to add a dedicated DB constraint/locking migration.
- Tests were authored/updated but **not executed**.
- No concentrated local typecheck/test/schema/migration/browser/Worker suite was run in this batch.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered.** Commits use `[skip ci]`.

## Concentrated validation still pending

Run locally as one deliberate validation phase:

1. install/frozen-install and remove/regenerate the remaining unused `packages/shared` legacy workspace/lockfile importer;
2. `pnpm typecheck`;
3. `pnpm test`;
4. `pnpm db:schema:check`;
5. journaled PostgreSQL migrations `0000`–`0014` on a disposable database;
6. post-cutover `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql` on disposable DB;
7. PWA CRUD/filter/pagination/subscription browser smoke;
8. Admin login/plan/runtime/manual-subscription/anomaly smoke;
9. API/Web/Admin Worker build/local smoke;
10. real LINE lifecycle + TEXT / group Reply TEXT / private Reply-TEXT guidance / AUDIO / IMAGE / FILE E2E;
11. real Gemini TEXT/image/audio/PDF usage + cost snapshot checks.

High-priority cases to hit during validation:
- Admin malformed path/body input returns 400 rather than 500;
- OA delayed older UNFOLLOW after newer FOLLOW must not revoke friendship;
- OA follow + immediately later ordinary message delivered message-first must still accept FOLLOW via the independent lifecycle timestamp;
- group bot leave -> re-add -> existing source/Owner becomes ACTIVE and works again;
- delayed older `LEAVE` after a newer rejoin must not deactivate the group;
- delayed older `memberLeft` after newer `memberJoined` must not deactivate the member;
- TEXT provider succeeds then DB result persistence fails;
- attachment provider succeeds then DB persistence fails;
- quota COMMIT/RELEASE concurrency and redelivery;
- subscription expiry/downgrade during GROUP access;
- cross-group Reply TEXT cache isolation;
- Group Reply-to-TEXT after cache expiry;
- Private Reply-to-TEXT explicit re-entry behavior;
- LINE attachment content endpoint returns 202, 400, 404 and 410;
- checkout-intent concurrent same/different request-key identity;
- project customer reassignment with existing records/transactions;
- concurrent customer/project deletion versus record/transaction linking, because foundation tables currently do not have FK constraints;
- fresh DB creation of active Web-auth tables, `0014` friendship timestamp, and post-cutover cleanup safety.

## Remaining known debt / non-blockers

- Payment provider is not connected; provider-neutral boundary is complete.
- `packages/shared` still contains retired Memory/Credit constants and should be removed together with lockfile regeneration during local validation.
- Some malformed record pagination inputs still fall back to bounded safe defaults instead of always returning HTTP 400; this is API-polish debt, not an unbounded-query or authorization issue.
- Core Worklog CRM/record/transaction tables currently have application-level same-workspace/link validation but no FK constraints in the foundation migration. Static review found a possible concurrent delete/link TOCTOU edge; validate this on disposable PostgreSQL before deciding whether to add DB-level RESTRICT/FK or locking guards.
- Group display name is generic because durable LINE group summary metadata is not stored; cosmetic/non-blocking for MVP.
- Attachment/TEXT provider-uncertain states deliberately prefer manual review over automatic replay to avoid duplicate AI cost.
- Private Reply-to-TEXT cannot faithfully reconstruct quoted text without caching ordinary private support traffic; safe UX is explicit re-entry.

## Current planning estimate

Planning estimates only, not test results:

- MVP feature implementation: **about 99%**.
- Static logic/architecture audit: **about 99%+**.
- Production readiness including still-unrun executable validation: **about 94%**.
- Remaining large feature batches before validation: **0**.
- Next work is concentrated local validation + actual failure-driven bug fixing.
- Expected validation/fix work: roughly **1–3 bug-fix batches / about 2–6 focused hours** if issues are ordinary compile/migration/browser integration defects; reserve up to roughly one working day if migration/runtime/DB-integrity validation reveals deeper problems.

## Next batch

Start concentrated local validation. Do not substitute GitHub Actions. Fix actual typecheck/test/schema/migration/browser/runtime failures as they appear, with special attention to OA/group lifecycle event ordering, Admin malformed-input handling, CRM delete/link concurrency, LINE 202/400 content behavior and provider-success persistence uncertainty. Update this handoff after each validation/fix batch and keep reporting completion percentage, remaining work and time estimate.
