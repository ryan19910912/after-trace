# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

The user wants large functionality batches. The concentrated local typecheck/test/migration/browser pass is intentionally deferred until major MVP paths and the final static bug audit are complete. Keep authoring tests and doing source-level consistency review, but never claim unexecuted verification passed. Do not use GitHub Actions unless the user explicitly asks for it.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Reply + `@AFTERTRACE` records quoted TEXT/AUDIO/IMAGE/FILE.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- Ordinary OA private text without `@AFTERTRACE` remains human-support traffic.
- Personal/group sources remain isolated.
- FREE is personal-only; group collaboration is paid/capability-driven.
- Group AI usage is charged to the stable group Owner; triggering member remains actor.
- Owner may disable future member recording without removing historical read access.
- Customer/project stays intentionally minimal; finance is typed/deterministic.
- Original LINE input is immutable source-of-truth.
- Three independent Cloudflare Workers: API, Web Static Assets, Admin Static Assets. No Pages target.

## LINE content rules

- Only ordinary GROUP TEXT is temporarily cached.
- Cache is PostgreSQL only: TTL 5 days, max 1000/group, oldest-first pruning; no Redis.
- AUDIO/IMAGE/FILE are never cached.
- Reply media/file uses the direct LINE message-content API by quoted LINE message id.
- Binary content is in-memory only and never persists.
- Expired/unavailable media asks the user to resend.
- Reply records retain both command `line_message_id` and `quoted_line_message_id`.

## Completed foundation / runtime

- Worklog user/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Stable group Owner, pending bootstrap and explicit `@AFTERTRACE 啟用`.
- Owner-only member `recording_enabled` mutation.
- Race-safe quota reservation/commit/release.
- Secure GROUP and PRIVATE one-time Web entry plus ordinary LINE Login; no fake group ids.
- Raw group/OA TEXT persistence with LINE message-id idempotency.
- Durable TEXT Gemini normalization with runtime DB pricing/model, immutable cost snapshot and no-double-charge resume.
- Worklog-only LINE runtime; ordinary group traffic no longer falls through to retired Memory/Energy/conversation/reminder code.
- Retired API source/test/schema modules removed; legacy URLs return HTTP 410 tombstones.
- Three-Worker deployment model retained: API + Web Static Assets + Admin Static Assets, no Pages.

## Completed migrations / cleanup boundary

- `0007_worklog_line_text_cache.sql`: bounded Reply-TEXT cache.
- `0008_worklog_attachment_ingestion.sql`: durable attachment ingestion state.
- `0009_worklog_failure_anomaly_triggers.sql`: terminal attachment/TEXT-normalization failures become structured anomalies.
- `0010_worklog_checkout_intents.sql`: provider-neutral, idempotent checkout-intent boundary.
- `0011_worklog_active_web_auth.sql`: journaled active GROUP one-time-link nonce storage.
- `drizzle/post-cutover/0012_worklog_legacy_cleanup.sql`: destructive legacy cleanup intentionally kept post-cutover rather than automatic pre-deploy.
- Deploy migration helper now uses the real Drizzle journal.

## Completed attachment/media ingestion

- Direct LINE content fetch for quoted IMAGE/AUDIO/FILE; media/file never enters the TEXT cache and binaries never persist.
- IMAGE multimodal analysis, AUDIO transcription/summary, PDF multimodal extraction, and text/JSON/XML/CSV/Markdown text input.
- DOCX/XLSX/unknown binary explicitly ask for PDF/text rather than pretending to parse.
- Group media charges Owner; OA private media charges personal user.
- User-facing expired/oversize/unsupported/quota/general failure responses exist.
- Durable flow: claim -> fetch -> runtime pricing -> quota reserve -> Gemini -> durable record/state -> quota commit -> success.
- `persistRecordCreated` atomically inserts/resolves the Worklog record and advances attachment ingestion to `RECORD_CREATED` with reservation token + immutable usage snapshot.
- After Gemini returns, uncertain DB persistence no longer releases quota or replays Gemini. Recovery re-reads durable state and retries only atomic DB persistence with the already-produced provider output.
- `RECORD_CREATED` redelivery settles existing quota usage without another provider call. `SUCCEEDED` is immutable.
- Stale provider-uncertain `PROCESSING` terminalizes rather than automatically replaying Gemini.
- Added pure attachment retry classification:
  - `SAFE_RETRY`: known pre-provider failure only.
  - `RESEND_REQUIRED`: expired/empty/oversize/unsupported content.
  - `MANUAL_REVIEW`: provider/DB/settlement uncertainty or unknown error; never automatic replay.
- Admin anomaly UI now displays this operator disposition/guidance and explicitly warns against replaying uncertain Gemini requests.
- Focused retry-policy and attachment persistence/recovery tests are authored; not executed yet.

## Completed Worklog PWA API/UI

Authenticated `/api/v1/worklog` includes:
- surfaces
- personal/group records
- own usage
- group Owner usage/member recording control
- customer CRUD
- project CRUD
- record organization edit
- typed transaction CRUD
- feedback submission

Record list supports server-side q/type/category/customer/project/from/to filters plus bounded limit/offset pagination with `hasMore` / `nextOffset`, source authorization, customer/project joins only through permitted records, and LINE source timestamp ordering.

Workspace rules:
- CRM/project/finance requires the caller's owned personal workspace; mere group membership never exposes another Owner's CRM/finance.
- Customer/project/record/transaction links are same-workspace validated.
- If a selected project belongs to a customer, the project's customer is authoritative and record/transaction writes canonicalize `customer_id` to it.
- Referenced customer/project cannot be deleted.
- Record editing changes normalized summary/category/customer/project only; raw LINE source content stays immutable.
- Transactions are typed `RECEIVED` / `EXPENSE` / `RECEIVABLE` with exact TWD amount, occurred time and optional links.
- Customer/project/record/transaction mutations are audited.
- PWA feedback stores sanitized diagnostic context only, never raw work records.

PWA UI already has personal/group source switching, server-backed filtering + Load More pagination, quota/usage, group owner member controls, record organization, customer/project management, typed finance, feedback, help and subscription surfaces.

## Subscription / entitlement status

- Dedicated `/api/v1/subscription` boundary mounted in API Worker.
- Enabled plan catalog exposed to authenticated PWA users.
- Durable `worklog_checkout_intents` with user/plan/request-key idempotency.
- Payment provider remains intentionally disabled; UI does not fake activation.
- GROUP read/record authorization requires active membership, bound Owner, enabled non-FREE plan, temporal subscription validity and `groupCollaboration=true`.
- Owner disabling a member's future recording does not erase historical read access.
- GROUP surfaces/records and LINE `@AFTERTRACE 查詢` re-check paid entitlement.
- Stale `status='ACTIVE'` rows past `current_period_end` no longer grant GROUP access.
- Active usage-window lookup ignores not-yet-effective/not-started/expired periods.
- Plan editor now documents the intended quota policy: plan allowance is a template for a new/no-balance cycle; an existing active-cycle quota balance is its cycle snapshot and must not be retroactively reduced by a plan-template edit.

### Usage-window bug fixed in latest batch

Previously, when no active usage window existed, `WorklogUsageService` called repository aggregates with null dates; the Drizzle repository interprets null/null as 1970..9999, so lifetime AI usage could be displayed as if it were current FREE-cycle usage.

Now:
- no active window => current-cycle AI allowance/used/reserved/remaining/cost are all zero;
- historical Worklog record counts remain visible;
- group Owner/member current-cycle AI metrics are zeroed when no active Owner cycle exists;
- Admin historical usage remains available separately and is not erased.

Focused tests cover personal and group-owner no-active-window behavior; authored but not executed.

## Completed Worklog Admin conversion

- Username/password + HMAC bearer session; no Cloudflare Access JWT dependency.
- Overview, Worklog Users, User detail, Groups, Group detail, Plans, AI pricing/runtime, Feedback, Anomalies and Audit.
- Manual plan assignment is audited.
- FREE `groupCollaboration` forced off.
- Historical AI usage keeps immutable provider/model/pricing snapshots.
- Attachment failure rows now expose operator retry guidance in the UI.
- Plan page explains active-cycle quota snapshot semantics.

## Static validation performed in latest batch

- Re-read product/progress/LINE-content/deployment/development-policy docs and latest branch HEAD.
- Inspected attachment ingestion/repository recovery paths and added operator retry classification/tests.
- Inspected Admin anomaly and plan UI and added explicit retry/quota-cycle guidance.
- Inspected Worklog usage service + Drizzle usage repository and confirmed the null-window path was lifetime aggregation; fixed the service to avoid presenting lifetime AI as current FREE-cycle usage.
- Re-checked Worklog text idempotency service: existing TEXT records are compared on source/author/command/quoted id/raw text and return `IDEMPOTENCY_CONFLICT` rather than silently treating mismatched replay as success.
- Inspected `packages/shared`; it is still a workspace importer in `pnpm-lock.yaml`, so it was intentionally not deleted without lockfile regeneration during the future concentrated local pass.
- Tests added/updated in this batch are **not executed**.
- No concentrated local typecheck/test/schema/migration/browser/Worker suite was run, per user direction.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered in this batch.**

## Verification status

Intentionally not executed yet:
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- journaled migrations `0000`–`0011` on disposable PostgreSQL/Neon
- post-cutover `0012_worklog_legacy_cleanup.sql`
- real LINE Reply media E2E
- real Gemini image/audio/PDF calls
- PWA CRUD/filter/pagination/subscription browser smoke
- Admin login/plan/runtime/manual-subscription/anomaly browser smoke
- Web/Admin/API Workers build/deploy smoke

Tests are authored but are **not claimed passing**.

## Known remaining risks / debt

1. Payment provider is not connected. Checkout intent is durable but cannot charge/activate a plan yet.
2. The active-cycle quota snapshot policy is now explicit in UI/docs, but `DrizzleWorklogSubscriptionRepository.assignPlan` still updates `allowance_units` on conflict for the same `(user_id, period_start)`. Normal Admin assignment starts a new period at assignment time, but the same-period conflict path deserves one final floor/preservation hardening before production.
3. Admin classifies attachment failures but does not expose a one-click provider replay. This is intentional for now: safe operational retry needs enough durable context to prove the provider was never called. Uncertain states remain manual-review/resend only.
4. If provider succeeds and DB remains unavailable through both atomic persistence attempts, the ingestion intentionally remains `IN_PROGRESS`; stale processing later terminalizes rather than replaying Gemini. Final operator UX should continue to favor avoiding duplicate provider cost.
5. `0012_worklog_legacy_cleanup.sql` remains intentionally post-cutover and must be exercised on a disposable DB before production.
6. `packages/shared` still contains retired Memory/Credit constants and is still represented in the lockfile importer list. Remove/regenerate together during the concentrated local/frozen-install phase.
7. Some old non-Worklog docs/config references may remain outside the core Worklog docs/README.
8. Admin user/group SQL still presents persisted subscription status directly; actual authorization is date-safe, but Admin presentation should get one final computed-state pass for expired/not-yet-effective labels.
9. Group display name remains generic because Worklog persists LINE group id but not durable group summary metadata.
10. Dedicated executable compile/test/migration/schema/browser validation remains pending by explicit user request.

## Latest branch work in this batch

- `3762113a55b1698a8540c8f0f1887585a60e19f0` — classify attachment retry safety.
- `39b979fa01d2878f87f5d50637fe7b10b9744c8f` — cover attachment retry policy.
- `43581862f4d45bbc51cb83f1ad08b692cb259216` — surface attachment retry safety + quota cycle policy in Admin.
- `f5e2c385f9ecc6bd73a8a1ce4a71efc181fd7a41` — prevent lifetime AI usage leaking into expired/current FREE usage views.
- `481172477bab83f353713d58e79bfe42f461b18c` — cover inactive usage-window semantics.

## Next large batch

1. Harden same-period Admin/manual plan reassignment so an existing quota balance can never be reduced below used+reserved and preferably preserves the current-cycle snapshot unless explicitly overridden.
2. Add computed Admin subscription presentation (`ACTIVE`, `PERIOD_EXPIRED`, `NOT_YET_EFFECTIVE`, etc.) instead of showing stale persisted `ACTIVE` as if currently entitled.
3. Continue static bug audit across Reply idempotency, PRIVATE/GROUP Web auth, quota settlement races, pagination/filter invalid-input edges, immutable raw input and typed-finance consistency.
4. Finish stale docs/config cleanup; defer `packages/shared` removal until lockfile can be regenerated/checked locally.
5. Keep payment-provider integration disabled until provider requirements are known.
6. Then perform the user's requested concentrated local install/typecheck/test/migration/schema/browser/Worker smoke pass and fix the executable failures together. Do not substitute GitHub Actions for this phase.
