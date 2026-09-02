# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

The accelerated MVP implementation/static-audit phase is now considered **feature-complete enough to enter the concentrated local validation phase**, but the newly agreed subscription billing/renewal model adds implementation work that is not complete yet. This is not a claim that executable verification passed. Do not use GitHub Actions unless the user explicitly requests it.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Group Reply + `@AFTERTRACE` records cached quoted TEXT while that text is still inside the bounded group cache; Reply AUDIO/IMAGE/FILE uses the direct LINE content API.
- OA/private ordinary support text is not cached; because LINE provides no API to retrieve past text again by message id, a later private Reply-to-TEXT must ask the user to re-enter `@AFTERTRACE 原文` instead of weakening the privacy policy.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- Ordinary OA private text remains human-support traffic unless explicitly triggered.
- Personal/group sources are isolated.
- FREE is personal-only; group collaboration requires current paid entitlement/capability.
- The LINE user who reliably initiated/invited the Bot into a group becomes that group's stable AFTERTRACE Owner. If the inviter cannot be identified from the LINE join context, `@AFTERTRACE 啟用` is the explicit fallback owner-claim path.
- Owner identity is stable and is not silently reassigned when the Owner leaves; conflicting manual claims must not overwrite an existing Owner. Explicit Owner transfer remains a future feature.
- Group AI usage charges the stable group Owner while retaining triggering actor attribution.
- `groupCollaboration` is the plan-level on/off gate for group use; `maxGroupCount` is an enforced runtime entitlement for both group read/query and recording.
- For a paid entitled Owner, active owned groups are ordered by stable ownership/binding time with deterministic tie-breaking; only the first `maxGroupCount` active groups may use AFTERTRACE. If an earlier group becomes inactive, the next group becomes eligible automatically.
- FREE / no-group-capability messaging should prefer the configured plan display name: `目前 {{方案顯示名稱}} 方案沒有開啟群組紀錄功能，升級方案後即可在 LINE 群組使用該功能。`
- Over-limit messaging should include the plan display name and numeric limit: `目前 {{方案顯示名稱}} 方案最多可使用 {{maxGroupCount}} 個 LINE 群組，已超過方案上限。請停用其他群組或升級方案。`
- Owner can disable future member recording without removing historical read access.
- Customer/project stays intentionally minimal; finance is typed/deterministic.
- Original LINE input remains immutable source-of-truth.
- Three independent Cloudflare Workers: API, Web Static Assets, Admin Static Assets. No Pages.
- Plan billing cadence is a dedicated plan property, not a generic capability. Initial supported product types are `ONE_TIME` and `MONTHLY`; add quarterly/yearly only when actually offered.
- A paid `MONTHLY` plan requires provider-supported recurring-payment authorization/token/mandate (or equivalent), not merely a temporary card authorization hold.
- A new paid monthly quota period is created only after a confirmed successful recurring renewal payment. Failed renewal must not grant a new paid allowance.
- A new monthly period receives a fresh plan allowance snapshot. Unused allowance from the previous period does not roll over; historical used/reserved units and provider-cost events remain attached to the old period.
- Whether FREE is ultimately `ONE_TIME` or `MONTHLY` is still an explicit product/pricing decision and must not be inferred from price `0`.
- Product/subscription decisions agreed in conversation must be persisted to the durable product/progress/development documents in the same batch rather than left only in chat history.

## Implemented MVP surface

- Worklog user/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Stable group ownership/bootstrap plus owner member-recording controls.
- Group join parsing now preserves a reliable `source.userId` actor so a known Bot inviter can be bound as Owner automatically; explicit `@AFTERTRACE 啟用` remains fallback for unbound/legacy cases.
- Group LINE-runtime authorization now enforces `maxGroupCount` using stable active-group ordinal ordering and returns plan display-name-aware entitlement/limit messages before AI/provider work.
- Raw TEXT persistence and LINE-message idempotency.
- Reply TEXT temporary PostgreSQL cache: 5 days / 1000 per group, no Redis.
- Reply AUDIO/IMAGE/FILE direct LINE content fetch, no binary persistence, expired content asks user to resend.
- Durable Gemini TEXT normalization and attachment ingestion with pricing/model snapshots and quota reservation/settlement.
- Secure GROUP/PRIVATE one-time Web entry plus ordinary LINE Login; no LIFF.
- PWA personal/group record browsing, server filtering/pagination, owner usage/member controls, customer/project CRUD, record organization, typed finance and feedback.
- Worklog Admin username/password + HMAC session, user/group/plan/quota/AI runtime/feedback/anomaly/audit surfaces.
- Admin capability definitions are backend-defined and exposed independently of persisted plan rows, allowing dynamic Admin controls even on an empty/fresh DB.
- Provider-neutral idempotent checkout-intent boundary exists, but no payment provider, recurring authorization, renewal webhook/state transition, or automatic new paid quota period is implemented yet.
- Worklog-only API runtime; retired Memory/Energy/conversation/reminder/commerce runtime removed/tombstoned.

## Data / entitlement hardening already completed

- GROUP LINE-runtime read/record authorization checks active membership, bound Owner, non-FREE enabled plan, temporal subscription validity and `groupCollaboration=true`.
- GROUP LINE-runtime read/record authorization also enforces the Owner plan's numeric `maxGroupCount`; over-limit groups are rejected before provider work.
- Expired persisted `status='ACTIVE'` does not grant GROUP access through the collaboration authorization path.
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

### 8. Group Owner bootstrap and plan group-limit semantics

- LINE group `join` parsing retains reliable `source.userId` when supplied; the join lifecycle binds that inviter/initiator as the stable AFTERTRACE Owner.
- If the inviter cannot be identified, the group remains pending and `@AFTERTRACE 啟用` is the explicit fallback owner-claim flow.
- Existing Owner binding is not silently transferred when the Owner leaves and conflicting claims remain rejected.
- `maxGroupCount` is now enforced for group query/read and record authorization in the LINE collaboration path rather than existing only as plan metadata.
- Entitled active groups use stable ownership/binding ordering; groups beyond the configured limit are rejected and later become eligible automatically when earlier groups become inactive.
- LINE entitlement failures now prefer the plan display name in user-facing messages.
- These changes were reviewed statically; executable tests were not run in this batch.

## Current document/code consistency audit queue

The following are confirmed or high-confidence mismatches discovered while comparing the durable product/development documents with current branch code. Scheduled hourly audits must continue from this queue, mark items fixed only after source-level review, and add newly discovered mismatches rather than restarting from the beginning.

### A. Billing type missing from implementation — confirmed, unresolved

Product contract now requires plan billing type `ONE_TIME` / `MONTHLY`, but current plan schema/API/Admin/PWA do not carry it.

Affected areas currently confirmed:
- `worklog_subscription_plans` has no `billing_type` column/enum.
- Admin `AdminPlanInput`, plan parsing, repository select/upsert and Admin frontend plan types/editor have no billing type.
- subscription `/plans` API and Web `SubscriptionPlan` type/UI have no billing type.

Recommended fix:
- add a dedicated plan billing-type enum/column and migration;
- thread billing type through Admin API/types/editor and Web subscription API/types/UI;
- render cadence explicitly (`一次性`, `每月`) rather than inferring from price;
- do not add quarterly/yearly until actually offered.

### B. Monthly recurring renewal/new quota period missing — confirmed, unresolved

`WorklogSubscriptionService.assignPlan()` currently defaults an assignment to `currentPeriodEnd = +1 calendar month`, but there is no recurring renewal workflow that charges the user and creates the next successful paid period/quota snapshot.

Recommended fix:
- make period semantics billing-type aware;
- add an idempotent renewal-domain operation where a confirmed provider renewal success advances the paid period and creates a fresh quota snapshot;
- failed renewal must not grant new quota and should move to an appropriate state such as `PAST_DUE`;
- do not grant quota merely because a calendar boundary was reached;
- preserve prior-period balances/usage and do not roll unused units forward.

### C. Payment boundary has no recurring authorization/provider lifecycle — expected external gap, unresolved

Current checkout intent is provider-neutral and `checkoutEnabled` remains false. There is no recurring payment token/mandate, provider webhook, renewal success/failure, cancellation, or payment-event idempotency yet.

Recommended fix after provider selection:
- obtain provider-supported recurring authorization at initial checkout;
- persist provider customer/subscription/authorization references without storing raw card data;
- process provider events idempotently;
- successful renewal creates next paid period/quota; failed renewal creates no new quota;
- cancellation stops future renewals while preserving historical usage/current earned period according to product policy.

### D. Plan capability enforcement is incomplete — confirmed/high priority

The backend exposes configurable capabilities, but several capabilities are not yet consistently enforced in runtime/API paths.

Confirmed examples:
- `privateOaRecording`: OA private recording currently checks OA friendship but does not check this capability before recording.
- `aiTextRecording`: text normalization reserves quota/calls AI without an explicit plan capability check.
- `aiMediaIngestion`: attachment ingestion reserves quota/calls provider without an explicit plan capability check.
- `pwaEditing`: shown Web mutation routes authorize workspace ownership but do not visibly check `pwaEditing`.
- `export`: capability exists but no export feature/API was found in this audit pass.

Recommended fix:
- centralize entitlement/capability checks rather than scatter frontend-only conditionals;
- raw TEXT persistence may remain successful when AI text enrichment is disabled, while normalization is skipped cleanly;
- reject media capability before provider work;
- define exact PWA-editing scope (record-only vs all customer/project/finance mutations) in product spec, then enforce server-side;
- keep `export` as future/unavailable or implement it, but do not present a configurable capability as if it already controls an existing feature.

### E. Web group record read may bypass paid/max-group entitlement — high priority, needs immediate follow-up

`GET /records/group/:sourceId` currently checks active group membership in the inspected route code, but does not visibly call `authorizeGroupAccess()`. LINE `@AFTERTRACE 查詢` does perform collaboration authorization before creating the link, but an already-authenticated Web session may be able to call the group-record API directly.

Product contract requires group read/query to obey current paid entitlement and `maxGroupCount`.

Recommended fix:
- route all Web group-record read authorization through `WorklogCollaborationService.authorizeGroupAccess()`;
- audit `/surfaces` so it does not advertise inaccessible/over-limit groups inconsistently;
- map disabled/expired/over-limit states consistently without relying on link-generation authorization alone.

### F. Admin server-label adapter overwrites raw enum/status values — confirmed design risk

Admin API presentation returns raw code plus `*_label`, but frontend `applyServerLabels()` rewrites the base field to the label and moves the original into `*_code`. This makes display easy but can break logic that expects raw enum/status values.

Recommended fix:
- preserve backend payload semantics (`status` remains raw code, `status_label` remains display label);
- make table/detail display helpers prefer the sibling label while business logic always reads the raw code;
- audit current Admin branches that compare `status`, `subscription_status`, etc. before removing the adapter behavior.

### G. FREE entitlement/bootstrap persistence is ambiguous — confirmed design gap

Some presentation/query paths fall back to the string `FREE` when no active subscription row exists, while subscription entitlement evaluation treats no row as `NO_SUBSCRIPTION`. If FREE has real AI allowance, this can produce inconsistent quota behavior.

Recommended fix after deciding FREE billing type:
- define one canonical FREE entitlement lifecycle;
- preferably materialize an explicit FREE subscription/quota state when appropriate, or implement one well-defined virtual FREE entitlement resolver used everywhere;
- do not let UI fallback `FREE` imply quota that runtime cannot actually reserve.

### H. Manual Admin assignment is implicitly monthly for every plan — confirmed, unresolved

Admin plan assignment calls `assignPlan()`, whose default end date is one month later regardless of future billing type.

Recommended fix:
- make assignment derive standard period behavior from plan billing type;
- ONE_TIME must not accidentally inherit monthly expiration/replenishment behavior;
- keep manual end-date override only as an explicit advanced admin behavior if still needed.

### I. Price presentation has no cadence — confirmed, unresolved

Admin/PWA currently display a numeric price without distinguishing one-time vs monthly.

Recommended fix:
- after billing type is added, render `NT$ X / 一次` vs `NT$ X / 月` (Chinese copy may be refined later);
- do not infer cadence from `price_twd` or whether price is zero.

### J. AI media pricing fallback can undercount outside current Admin UI — confirmed risk

Current Admin UI sends audio/image price equal to input price, but backend/runtime still stores and consumes separate nullable audio/image prices. Attachment cost calculation treats null media price as zero rather than falling back to input price.

Recommended fix:
- if current product invariant is one common input price for text/audio/image input, enforce/fallback on the backend as well (`audio/image ?? input`) so API/manual DB writes cannot undercount cost;
- alternatively keep separate provider pricing formally supported, but then Admin UI/spec must expose that difference intentionally.

### K. AI quota unit semantics for media need definition — confirmed product/accounting risk

Attachment provider cost includes audio/image input units, while committed `actualUnits` currently uses input tokens + output tokens. Reservation units are provider-defined. Plan allowance sustainability therefore depends on a unit model that is not yet formally consistent across text/media.

Recommended fix before locking plan allowances:
- define internal AI credit/unit semantics independent of raw provider units;
- ensure reservation and final committed units use the same conversion model;
- keep provider token/media metrics separately for cost audit;
- do not finalize production FREE/paid allowance numbers until this is coherent.

### L. Admin `user_type` can describe ownership rather than current entitlement — confirmed semantic mismatch

Admin currently derives `GROUP_ENABLED` from owning an ACTIVE group, even if current plan entitlement would not allow group collaboration (for example historical group ownership after downgrade to FREE).

Recommended fix:
- either rename the field/filter to factual ownership semantics (`擁有群組`) or compute `GROUP_ENABLED` from current entitlement + eligible owned group;
- product decision required before changing semantics.

### M. LINE join actor semantics require official-platform verification — external contract check

The implementation now uses group `join` event `source.userId` as reliable inviter/initiator when supplied, matching the product rule. This must be verified against official LINE Messaging API event semantics during external integration validation; do not treat mere presence of a user id as proof of inviter identity unless LINE documents it accordingly.

Recommended action:
- verify against current official LINE docs before production E2E;
- if LINE does not guarantee inviter identity, keep groups pending and use explicit claim instead of guessing.

## Static validation performed in latest batch

- Re-read current `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_DEVELOPMENT_POLICY.md` before auditing implementation.
- Persisted the new durable-documentation rule: agreed product/subscription decisions must be written to docs, not left only in chat.
- Persisted initial billing types `ONE_TIME` / `MONTHLY`, recurring-authorization requirement, successful-renewal quota creation, and no-rollover semantics.
- Audited subscription schema/service/Admin/PWA and confirmed billing type and recurring-renewal implementation are missing.
- Audited configurable capability usage and identified multiple server-side enforcement gaps (`privateOaRecording`, `aiTextRecording`, `aiMediaIngestion`, likely `pwaEditing`; `export` currently has no implementation found).
- Audited Web group record route and found a high-priority apparent gap where membership is checked without the full collaboration entitlement/max-group authorization used by LINE flows.
- Audited Admin enum-label adapter and identified raw-code mutation risk.
- Audited current AI pricing/attachment accounting and identified nullable media-price undercount risk plus unresolved internal AI-unit semantics for media.
- Scheduled an hourly document/code consistency audit that must continue from the queue above and update this handoff each run.
- No tests, typecheck, schema checks, migrations, browser smoke, Worker smoke, LINE E2E, Gemini E2E, or GitHub Actions were run in this batch.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered.**

## Concentrated validation still pending

Run locally as one deliberate validation phase after the newly identified high-priority contract gaps are resolved or deliberately scoped:

1. install/frozen-install and remove/regenerate the remaining unused `packages/shared` legacy workspace/lockfile importer;
2. `pnpm typecheck`;
3. `pnpm test`;
4. `pnpm db:schema:check`;
5. journaled PostgreSQL migrations on a disposable database, including any new billing-type migration;
6. post-cutover legacy cleanup on disposable DB;
7. PWA CRUD/filter/pagination/subscription/browser entitlement smoke;
8. Admin login/plan/billing-type/runtime/manual-subscription/anomaly smoke;
9. API/Web/Admin Worker build/local smoke;
10. real LINE lifecycle + TEXT / group Reply TEXT / private Reply-TEXT guidance / AUDIO / IMAGE / FILE E2E;
11. real Gemini TEXT/image/audio/PDF usage + cost/quota snapshot checks;
12. payment-provider recurring authorization/renewal webhook validation once a provider is selected.

High-priority cases to hit during validation:
- Admin malformed path/body input returns 400 rather than 500;
- OA delayed older UNFOLLOW after newer FOLLOW must not revoke friendship;
- OA follow + immediately later ordinary message delivered message-first must still accept FOLLOW via the independent lifecycle timestamp;
- LINE group join actor semantics match official LINE behavior; reliable inviter binds Owner, otherwise pending explicit claim;
- group bot leave -> re-add -> existing source/Owner becomes ACTIVE and works again without silently transferring ownership;
- a different user cannot steal an already-bound group through `@AFTERTRACE 啟用`;
- FREE/no-group-capability reply includes the configured plan display name;
- `maxGroupCount` rejects over-limit groups on LINE and Web group read/record paths, and an over-limit group becomes eligible when an earlier active group is disabled/leaves;
- `privateOaRecording`, `aiTextRecording`, `aiMediaIngestion` and chosen `pwaEditing` scope are server-enforced;
- ONE_TIME vs MONTHLY assignment creates the intended period behavior;
- MONTHLY successful renewal creates exactly one new quota period and duplicate provider webhook does not duplicate allowance;
- failed renewal does not create new paid quota;
- unused allowance does not roll over;
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
- concurrent customer/project deletion versus record/transaction linking;
- fresh DB creation of active Web-auth, lifecycle timestamps, billing type, quota-cycle and cleanup schema.

## Remaining known debt / external work

Code/static-audit work:
- implement billing type through schema/domain/Admin/PWA;
- implement full recurring period/quota transition domain boundary;
- close server-side capability-enforcement gaps;
- close Web group-read entitlement bypass if follow-up confirms it;
- normalize Admin code/label handling;
- resolve FREE entitlement/bootstrap behavior after FREE billing type is decided;
- resolve AI media price fallback and AI-credit semantics;
- continue full docs-vs-code audit via the hourly schedule;
- explicit Owner transfer remains future work unless product scope changes;
- `packages/shared` legacy cleanup and remaining validation debt still exist.

External/payment/configuration work:
- select payment provider;
- verify provider supports recurring authorization and merchant-initiated/subscription charges appropriate for the target market;
- define provider webhook, cancellation, retry/grace, refund and failed-payment behavior;
- verify LINE group join actor semantics against current official LINE docs;
- production LINE/Gemini/Worker/payment E2E configuration.

Final subscription prices, exact FREE/paid AI allowance matrix, and whether FREE is `ONE_TIME` or `MONTHLY` are intentionally not locked yet and must be persisted when explicitly decided.

## Current planning estimate

Planning estimates only, not test results. The new subscription/capability consistency audit found material unimplemented contract work, so previous estimates are reduced:

- MVP feature implementation: **about 94–96%**.
- Static logic/architecture audit: **about 92–95%**, with the hourly audit continuing.
- Production readiness including unrun executable validation and unresolved recurring payment: **about 80–85%**.
- Remaining large code/static batches before concentrated validation: roughly **2–4** (billing/renewal model, capability/Web entitlement hardening, audit cleanup, then local validation).
- Practical estimate to reach concentrated local validation after decisions are settled: roughly **4–8 focused development hours** for internal code/static work, excluding payment-provider integration.
- Payment-provider recurring integration is separate external work and cannot be estimated tightly until the provider is chosen; after provider integration, reserve additional validation/fix time for webhook/idempotency/renewal edge cases.

## Next batch

Continue the document/code consistency audit from section `Current document/code consistency audit queue`; do not restart from scratch. Highest-priority next checks are Web group read/surface authorization, capability enforcement across private/group/Web paths, FREE entitlement/bootstrap lifecycle, subscription/quota period transitions, and AI unit accounting. Fix clear low-risk inconsistencies, but leave product-decision-dependent behavior documented for user approval. Do not substitute GitHub Actions for local validation.