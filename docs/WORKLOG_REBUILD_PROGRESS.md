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

Previous behavior:
- LINE `LEAVE` marked the bound group source and members inactive.
- Later `bootstrapGroupInteraction()` found the same bound source and reactivated the interacting member, but did not reactivate the source itself.
- Authorization therefore continued returning `GROUP_INACTIVE`, effectively bricking that group after a bot remove/re-add cycle.

Current behavior:
- `WorklogBootstrapRepository` exposes `reactivateBoundGroup(sourceId, at)`.
- A known bound source in `INACTIVE` state is restored to `ACTIVE` with `inactive_at = NULL` on the first new valid group interaction or active member-presence event.
- The existing source id, stable Owner and prior member recording permissions are preserved; no replacement group/source is created.
- Focused bootstrap test covers leave -> new interaction -> same source/Owner ACTIVE again; test authored but not executed yet.

### 5. Delayed/out-of-order LINE lifecycle events could overwrite newer group/member state

Previous behavior:
- `markGroupInactive()` applied a `LEAVE` regardless of whether a newer rejoin/interaction had already been observed.
- `memberJoined` / `memberLeft` upserts always overwrote `is_active`, even when the incoming webhook event timestamp was older than `last_seen_at`.
- A delayed/redelivered old `LEAVE` or `memberLeft` could therefore turn an already rejoined group/member inactive again.

Current behavior:
- Group reactivation only applies when the incoming interaction timestamp is not older than the source's current lifecycle `updated_at`.
- Group `LEAVE` only deactivates the source when the leave timestamp is at least as new as the source lifecycle state.
- Bound and pending member presence updates change `is_active` only when the incoming event timestamp is at least as new as existing `last_seen_at`.
- Group leave deactivation applies to members only when their own `last_seen_at` is not newer than the leave event.
- Pending-group activation/deactivation follows the same monotonic timestamp rule.
- Promotion/migration of pending members no longer lets older pending presence overwrite newer bound-member presence.
- Focused ordering tests were added for delayed `LEAVE` after a newer rejoin and delayed `memberLeft` after a newer `memberJoined`; tests are authored but not executed.

Latest commits in this validation-stage sequence include:
- `c89f856ae94f759a26b9c457b2b442f80966be62` — preserve quota after uncertain TEXT provider-result persistence.
- `43978a6e194db87dfa924b4540473449d2c8d294` — terminalize stale uncertain TEXT normalization.
- `9c2a5a2427518c657bf6ca2c17eee3aa52965fc2` — focused TEXT persistence-uncertainty tests.
- `00bbc715795972f10f45a75dfef4f14ae539f04e` — stable LINE content readiness/non-retrievable error codes.
- `fca46b5274ad4efa107b3efbb55ee1b12be47569` / `6cf7284512eaa812a1373d5cb5af9505781461c3` — private/group quoted-content recovery UX.
- `e3f6badc23207b92c13b2e786fb91c1ef09a7ac4` — LINE content resolver tests.
- `06300934276d66728fc85c22254ed0e2cc21f0ea` — reactivate known group source during bootstrap.
- `e7df94dd1f9a13d0a9125412879052e904bcb179` — persist Worklog group source reactivation.
- `58883a38e09ae8004f3b4d3264b83d11daa7371e` — rejoin/reactivation regression test.
- `a3adaf12f84b5abdb3ed501d6db6e07743ee1992` — enforce monotonic lifecycle/member timestamps in PostgreSQL bootstrap persistence.
- `4a6fdab173bf848c5b5ca4399f9650a15583aa52` — add out-of-order lifecycle regression tests.

## Static validation performed in latest batch

- Re-read current branch, group bootstrap/runtime, collaboration/entitlement, Web auth, LINE text cache, LINE content resolver and quota/project consistency migrations.
- Confirmed group read/record authorization remains tied to active source/member + current Owner entitlement.
- Confirmed group reactivation preserves source/Owner identity and does not reset existing `recording_enabled` on conflict updates.
- Confirmed delayed lifecycle/member events now cannot overwrite newer event-time state in the bootstrap repository.
- Re-checked quota settlement concurrency: the first COMMIT locks and transitions the reservation; a concurrent redelivery subsequently observes non-`RESERVED` durable state and does not insert a second usage event.
- Re-checked private one-time nonce consumption and source/OA-friend validation; no new high-risk static auth contradiction found.
- Re-checked `0012` quota-cycle snapshot and `0013` project-customer synchronization triggers; no new high-risk static contradiction found in this pass.
- Tests were authored/updated but **not executed**.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered.** Commits use `[skip ci]`.

## Concentrated validation still pending

Run locally as one deliberate validation phase:

1. install/frozen-install and remove/regenerate the remaining unused `packages/shared` legacy workspace/lockfile importer;
2. `pnpm typecheck`;
3. `pnpm test`;
4. `pnpm db:schema:check`;
5. journaled PostgreSQL migrations `0000`–`0013` on a disposable database;
6. post-cutover `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql` on disposable DB;
7. PWA CRUD/filter/pagination/subscription browser smoke;
8. Admin login/plan/runtime/manual-subscription/anomaly smoke;
9. API/Web/Admin Worker build/local smoke;
10. real LINE lifecycle + TEXT / group Reply TEXT / private Reply-TEXT guidance / AUDIO / IMAGE / FILE E2E;
11. real Gemini TEXT/image/audio/PDF usage + cost snapshot checks.

High-priority cases to hit during validation:
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
- fresh DB creation of active Web-auth tables and post-cutover cleanup safety.

## Remaining known debt / non-blockers

- Payment provider is not connected; provider-neutral boundary is complete.
- `packages/shared` still contains retired Memory/Credit constants and should be removed together with lockfile regeneration during local validation.
- Some malformed record pagination inputs still fall back to bounded safe defaults instead of always returning HTTP 400; this is API-polish debt, not an unbounded-query or authorization issue.
- Group display name is generic because durable LINE group summary metadata is not stored; cosmetic/non-blocking for MVP.
- Attachment/TEXT provider-uncertain states deliberately prefer manual review over automatic replay to avoid duplicate AI cost.
- Private Reply-to-TEXT cannot faithfully reconstruct quoted text without caching ordinary private support traffic; safe UX is explicit re-entry.

## Current planning estimate

Planning estimates only, not test results:

- MVP feature implementation: **about 99%**.
- Static logic/architecture audit: **about 99%+**.
- Production readiness including still-unrun executable validation: **about 93–94%**.
- Remaining large feature batches before validation: **0**.
- Next work is concentrated local validation + bug fixing.
- Expected validation/fix work: roughly **1–3 bug-fix batches / about 2–6 focused hours** if issues are ordinary compile/migration/browser integration defects; reserve up to roughly one working day if migration or runtime integration reveals deeper problems.

## Next batch

Start concentrated local validation. Do not substitute GitHub Actions. Fix actual typecheck/test/schema/migration/browser/runtime failures as they appear, with special attention to lifecycle event ordering, group leave/rejoin lifecycle, LINE 202/400 content behavior and provider-success persistence uncertainty. Update this handoff after each validation/fix batch and keep reporting completion percentage, remaining work and time estimate.
