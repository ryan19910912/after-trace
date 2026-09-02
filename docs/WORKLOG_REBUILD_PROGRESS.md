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

Previous behavior:
- Gemini could return a valid TEXT normalization result.
- Persisting that provider result to PostgreSQL could then fail/transiently become uncertain.
- The service catch path released the AI reservation and attempted to mark the normalization FAILED.
- This could under-account real provider cost; if the failure-state write also failed, the normalization could remain PROCESSING indefinitely.

Current behavior:
- `WorklogTextNormalizationService` tracks whether the provider returned successfully.
- Once provider response exists, a later persistence failure returns `IN_PROGRESS` without releasing quota and without marking the job retryable.
- Automatic provider replay remains disabled.
- `DrizzleWorklogTextNormalizationRepository.begin()` terminalizes PROCESSING rows older than 15 minutes as `AI_NORMALIZATION_PROCESSING_STALE_UNCERTAIN` for operator review instead of reclaiming and calling AI again.
- Focused tests cover provider-success + persistence-failure without quota release/replay and provider-call failure with normal release.

### 2. LINE content endpoint 202 was treated as usable attachment bytes

LINE may return HTTP `202` while large audio/video content is still being prepared. Because `Response.ok` is true for 202, the previous resolver could read the preparation response body and pass it downstream as if it were real binary content.

Current behavior:
- `LineMessageContentResolver` explicitly maps `202` to `LINE_CONTENT_NOT_READY` before reading the body.
- The state is a known pre-provider safe retry condition.
- User-facing group/private runtime tells the user to wait and send a new Reply `@AFTERTRACE` against the same attachment; no upload is required yet.
- The 202 response body can no longer reach Gemini.

### 3. Quoted TEXT was incorrectly falling through to the binary content API when unavailable from cache

LINE only exposes user text in the original webhook and does not provide an API to retrieve past text again by `quotedMessageId`. The binary content endpoint supports image/video/audio/file, so a past/private quoted text can return HTTP 400 rather than retrievable content.

Current behavior:
- `LineMessageContentResolver` maps HTTP 400 to `LINE_CONTENT_NOT_RETRIEVABLE` instead of treating it as generic attachment failure.
- Group Reply-to-TEXT still works from the bounded PostgreSQL TEXT cache. After cache expiry, the user is told to re-enter the original text.
- OA/private ordinary support text remains uncached by policy. Private Reply-to-TEXT therefore gives explicit `@AFTERTRACE 原文` guidance rather than pretending LINE can reconstruct the quoted text.
- No private ordinary-text cache, Redis fallback, or binary persistence was introduced.
- Retry policy classifies `LINE_CONTENT_NOT_READY` as safe pre-provider retry and `LINE_CONTENT_NOT_RETRIEVABLE` as resend/re-entry required.
- Focused `LineMessageContentResolver` and retry-policy tests were authored; not executed yet.

Latest commits in this bug-audit sequence include:
- `c89f856ae94f759a26b9c457b2b442f80966be62` — preserve quota after uncertain TEXT provider-result persistence.
- `43978a6e194db87dfa924b4540473449d2c8d294` — terminalize stale uncertain TEXT normalization.
- `9c2a5a2427518c657bf6ca2c17eee3aa52965fc2` — focused TEXT persistence-uncertainty tests.
- `00bbc715795972f10f45a75dfef4f14ae539f04e` — stable LINE content readiness/non-retrievable error codes.
- `d84d196e51a6d094f3ef2ef093625a874f265a67` — attachment retry classification for LINE content states.
- `e997e5df616ffaa36c672fb7037c510d35654c86` — retry-policy tests for those states.
- `fca46b5274ad4efa107b3efbb55ee1b12be47569` — private OA quoted-text/content-readiness UX.
- `6cf7284512eaa812a1373d5cb5af9505781461c3` — group quoted-content recovery UX.
- `e3f6badc23207b92c13b2e786fb91c1ef09a7ac4` — LINE content resolver tests.
- `584befcae90df3d2b5e4bd8f53ceef821f4fdf15` — durable LINE content policy clarification.

## Static validation performed in latest batch

- Re-read current group and OA runtimes, LINE event parser, LINE content resolver, attachment normalizer, quota-cycle migrations and Worklog content policy.
- Verified GROUP quoted text resolves from the scoped bounded PostgreSQL cache before any binary-content fetch.
- Verified private ordinary support text is not cached, preserving the agreed privacy/content boundary.
- Cross-checked current LINE Messaging API behavior: past text cannot be fetched again and content retrieval is for binary content; 202 indicates content preparation rather than usable bytes.
- Re-checked `0012` quota-cycle snapshot and `0013` project-customer synchronization triggers; no new high-risk static contradiction was found in this pass.
- Tests were authored/updated but **not executed**.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered.** Commits use `[skip ci]` where applicable.

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
10. real LINE TEXT / group Reply TEXT / private Reply-TEXT guidance / AUDIO / IMAGE / FILE E2E;
11. real Gemini TEXT/image/audio/PDF usage + cost snapshot checks.

High-priority cases to hit during validation:
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
- Private Reply-to-TEXT cannot faithfully reconstruct the quoted text without caching ordinary private support traffic; this is a LINE platform capability/privacy-policy boundary, so the safe UX is explicit text re-entry rather than hidden private caching.

## Current planning estimate

Planning estimates only, not test results:

- MVP feature implementation: **about 99%**.
- Static logic/architecture audit: **about 99%+** after the additional LINE API pass.
- Production readiness including still-unrun executable validation: **about 92–93%**.
- Remaining large feature batches before validation: **0**.
- Next work is concentrated local validation + bug fixing.
- Expected validation/fix work: roughly **1–3 bug-fix batches / about 2–6 focused hours** if issues are ordinary compile/migration/browser integration defects; reserve up to roughly one working day if migration or runtime integration reveals deeper problems.

## Next batch

Start concentrated local validation. Do not substitute GitHub Actions. Fix actual typecheck/test/schema/migration/browser/runtime failures as they appear, with special attention to LINE 202/400 content behavior and provider-success persistence uncertainty. Update this handoff after each validation/fix batch and keep reporting completion percentage, remaining work and time estimate.
