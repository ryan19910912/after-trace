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

## Completed Worklog foundation

- Worklog user/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Stable group Owner, pending bootstrap and explicit `@AFTERTRACE 啟用`.
- Owner-only member `recording_enabled` mutation.
- Race-safe quota reservation/commit/release.
- Secure GROUP and PRIVATE one-time Web entry plus ordinary LINE Login; no fake group ids.
- Raw group/OA TEXT persistence with LINE message-id idempotency.
- Durable TEXT Gemini normalization with runtime DB pricing/model, immutable cost snapshot and no-double-charge resume.
- `0007_worklog_line_text_cache.sql`: bounded Reply-TEXT cache.
- `0008_worklog_attachment_ingestion.sql`: durable attachment ingestion state.
- `0009_worklog_failure_anomaly_triggers.sql`: terminal attachment/TEXT-normalization failures become structured anomalies.
- `0010_worklog_checkout_intents.sql`: idempotent subscription checkout-intent boundary.
- `0011_worklog_active_web_auth.sql`: journaled active GROUP one-time-link nonce storage.
- `drizzle/post-cutover/0012_worklog_legacy_cleanup.sql`: destructive legacy cleanup intentionally kept post-cutover rather than automatic pre-deploy.

## Completed attachment/media ingestion

- Direct LINE content fetch for quoted IMAGE/AUDIO/FILE; media/file never enters the TEXT cache and binaries never persist.
- IMAGE multimodal analysis, AUDIO transcription/summary, PDF multimodal extraction, and text/JSON/XML/CSV/Markdown text input.
- DOCX/XLSX/unknown binary explicitly ask for PDF/text rather than pretending to parse.
- Group media charges Owner; OA private media charges personal user.
- User-facing expired/oversize/unsupported/quota/general failure responses exist.
- Durable high-level flow remains claim -> fetch -> runtime pricing -> quota reserve -> Gemini -> durable record/state -> quota commit -> success.
- Redelivery resumes from `RECORD_CREATED` without another provider call or duplicate quota charge.
- Stale provider-uncertain `PROCESSING` terminalizes after 15 minutes instead of automatically replaying Gemini.

Latest reliability hardening:
- Fixed a split-brain risk where the attachment record insert and ingestion-state advance used to be separate DB operations.
- `persistRecordCreated` now atomically inserts/resolves the idempotent `worklog_records` row and advances `worklog_attachment_ingestions` to `RECORD_CREATED` with reservation token + immutable usage snapshot in one PostgreSQL statement.
- After Gemini has returned successfully, an uncertain database outcome no longer releases quota or overwrites durable state with a failure.
- On persistence uncertainty, the service re-reads the durable claim state. If it finds `RECORD_CREATED`, it resumes settlement; if `SUCCEEDED`, it returns the existing record; if it confidently remains `PROCESSING`, it retries only the atomic DB persistence once using the already-produced provider output in memory. Gemini is never called again for this recovery attempt.
- If the DB outcome remains uncertain after the provider call, the service returns `IN_PROGRESS` and leaves the reservation/state intact for later inspection rather than risking undercharge or duplicate provider cost.
- Genuine terminal settlement failures after `RECORD_CREATED` may still become `FAILED`; `SUCCEEDED` remains immutable.
- LINE runtime already maps `IN_PROGRESS` to the existing “正在處理中，請稍後到 AFTERTRACE 紀錄頁查看” UX, while expired LINE media still asks the user to resend.
- Focused attachment persistence/recovery tests were authored/updated; not executed yet.

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
- If a selected project already belongs to a customer, that project/customer relationship is authoritative: record and typed-transaction writes canonicalize `customer_id` to the project's customer, preventing contradictory customer/project combinations from stale UI state.
- If a project has no customer, an independently selected customer remains allowed.
- Referenced customer/project cannot be deleted.
- Record editing changes normalized summary/category/customer/project only; raw LINE source content remains immutable.
- Transactions are typed `RECEIVED` / `EXPENSE` / `RECEIVABLE` with exact TWD amount, occurred time and optional links.
- Customer/project/record organization/transaction mutations are audited.
- PWA feedback stores sanitized diagnostic context only, never raw work records.

PWA UI already has:
- Personal / Group source switcher.
- Real records and server-backed filters / Load More pagination.
- Own plan quota/used/remaining and TEXT/AUDIO/IMAGE/FILE counts.
- Group Owner member usage + recording toggle.
- Record summary/category/customer/project organizer with immutable original LINE text clearly separated.
- Customer create/edit/delete.
- Project create/edit/delete/status/customer association and finance aggregates.
- Received/expense/receivable create/edit/delete.
- Feedback form and responsive management UI.

## Completed subscription boundary and entitlement audit

- Dedicated `/api/v1/subscription` boundary mounted in API Worker.
- Enabled plan catalog exposed to authenticated PWA users.
- Current plan is separated from public plan definitions.
- Durable `worklog_checkout_intents` with user/plan/request-key idempotency.
- PWA `/subscription` shows price, AI allowance and capabilities.
- Checkout intent redirects when a provider URL exists.
- Payment provider remains intentionally disabled; UI says payment is not enabled rather than faking activation.

Access-control fixes completed:
- Fixed a FREE-personal-only leak where GROUP query/history/PWA discovery previously depended on active membership but did not consistently re-check the Owner's current group entitlement.
- `authorizeGroupAccess` requires active group/member, bound Owner, enabled non-FREE plan and `groupCollaboration=true`, while deliberately ignoring `recording_enabled`/AI quota so disabling future recording does not erase history.
- LINE `@AFTERTRACE 查詢`, PWA group discovery and group record reads all use paid-entitlement gates.
- Fixed a second stale-period leak: an Owner subscription row could remain `status='ACTIVE'` after `current_period_end`, letting direct GROUP read paths continue until some external process updated status.
- Group read/record authorization now carries subscription status, effective time, period start/end and plan-enabled state and rejects not-yet-effective, not-yet-started, expired, inactive or disabled plans before capability/quota checks.
- Direct PWA group-surface/group-read SQL now applies the same temporal period checks at DB time.
- Active usage-window lookup also ignores stale ACTIVE periods.
- Focused collaboration tests cover paid historical read, recording-disabled historical read, FREE rejection, expired ACTIVE period, future-effective period and stale-period record rejection; not executed yet.

## Completed Worklog Admin conversion

Authentication:
- Removed legacy Cloudflare Access verifier from the Worklog Admin flow.
- API-only `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`.
- `/api/v1/admin/login` returns signed bearer session; all other Admin routes require it.
- Session defaults 12h, max 24h; secret rotation invalidates sessions.
- Admin SPA stores session in `sessionStorage`; credentials/secrets are never Vite constants.

Admin surfaces:
- Overview Worklog users/OA friends/groups/records/AI cost/anomalies/failures/feedback.
- OA-primary Users with q/plan/type/sort and plan/quota/record/group counts.
- User detail with subscription/quota/groups/memberships/AI usage/subscription history.
- Manual plan assignment through Worklog subscription service, audited.
- Group list/detail with Owner/binding/plan/quota/member record+AI usage.
- Plan create/edit price/rank/enabled/capabilities/AI allowance; FREE group collaboration forced off; audited.
- AI provider/model/input/output/audio/image pricing and USD/TWD editor; audited; historical usage keeps execution snapshot.
- Feedback review, anomaly controls, attachment/normalization failure views and Worklog audit viewer.

## Completed live legacy cutover / repository cleanup

- `apps/api/src/index.ts` is Worklog-only LINE runtime.
- Ordinary group messages terminate after `WorklogLineRuntime`; only ordinary group TEXT can use the bounded PostgreSQL cache. There is no old conversation/Memory/Energy/extraction/reminder fallthrough.
- Worker-level HTTP 410 tombstones remain for retired URLs without mounting old routers.
- Removed retired API implementation directories: `ai`, `commerce`, `config`, `conversation`, `credits`, `energy`, `extraction`, `management`, `memory`, `proactive`, `reminders`, `retention`.
- Removed retired LINE helpers/tests and old Drizzle schema declarations.
- `schema-all.ts` and `drizzle.config.ts` are Worklog-only active schema exports/config.
- Replaced the old bespoke DB deploy helper with real `drizzle-kit migrate --config=../../drizzle.config.ts`.
- Removed the no-op scheduled Worker handler; API `wrangler.toml` has no cron trigger.
- Replaced stale root README with the Worklog product / three-Worker topology.
- Legacy Web App/WebRoot/api/rewarded-ad client removed from the current PWA surface.

## Static validation performed in the latest batch

- Re-read product/progress/LINE-content/deployment docs from branch HEAD and adopted the newly added `WORKLOG_DEVELOPMENT_POLICY.md` as part of the durable handoff contract.
- Re-read subscription service/repository paths and confirmed atomic quota reservation already enforced temporal subscription bounds; fixed the direct GROUP read paths that did not.
- Re-read Worklog record and workspace-management repositories; raw LINE content is not modified by record organization edits.
- Re-read attachment ingestion service/repository after the atomic persistence refactor, including redelivery, settlement and stale-processing paths.
- Re-read `line-runtime.ts` and `group-webhook.ts`; attachment `IN_PROGRESS` UX and reply-delivery failure isolation remain consistent with the product contract.
- Added/updated focused tests for subscription-window authorization, deterministic project/customer linkage and attachment persistence recovery. These tests were authored but **not executed**.
- No concentrated local typecheck/test/schema/migration/browser/Worker suite was run in this batch, per user direction.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered in this batch.**

## Verification status

Intentionally **not executed yet** for the accelerated branch state:
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- journaled migrations `0000`–`0011` on disposable PostgreSQL/Neon
- post-cutover `0012_worklog_legacy_cleanup.sql` on disposable PostgreSQL/Neon
- real LINE Reply media E2E
- real Gemini image/audio/PDF calls
- PWA CRUD/filter/pagination/subscription browser smoke
- Admin login/plan/runtime/manual-subscription browser smoke
- Web/Admin/API Workers build/deploy smoke

Tests are authored but are **not claimed passing**.

Before production explicitly validate private auth, normalization race recovery, TEXT TTL/cap pruning, attachment idempotency/atomic persistence/quota settlement, anomaly triggers, checkout-intent idempotency, fresh-db creation of `web_auth_entry_nonces`, group downgrade/period-expiry behavior, deterministic customer/project linkage, and post-cutover cleanup safety. Worklog migrations are hand-authored/journaled; check Drizzle drift locally.

## Known remaining risks / debt

1. Payment provider is not connected. Checkout intent is durable but cannot charge/activate a plan yet.
2. Plan-definition allowance edits do not yet have an explicit policy for an already-active cycle's quota balance. Decide next-period-only vs immediate-with-floor-at-used+reserved; never silently destroy used/reserved quota.
3. Provider-uncertain attachment failures intentionally have no automatic retry because replay can double bill. Admin currently shows failures but has no explicit semantics-safe retry control. Any future retry path must classify safe pre-provider failures separately from provider-uncertain failures.
4. If a provider call succeeds and the database remains unavailable through both atomic persistence attempts, the request deliberately remains `IN_PROGRESS`; the reservation will eventually expire and stale PROCESSING will terminalize rather than replay Gemini. This is safer than duplicate cost but should receive final operator/admin UX review.
5. The destructive post-cutover `0012` cleanup is authored but intentionally outside the automatic pre-deploy journal. Exercise it on a disposable DB and run only after the Worklog Worker is healthy.
6. `packages/shared` still contains legacy Memory/Credit constants and appears unused by current apps. Remove it only with lockfile/workspace cleanup during the final repo audit so frozen-install behavior is not changed blindly.
7. Some old non-Worklog docs/config references may remain outside the core Worklog docs/README and should be classified historical or removed.
8. Usage views separate authorization from historical analytics, but the no-active-window fallback deserves one final semantics pass so an expired paid period is not confusingly shown as FREE with lifetime AI aggregates.
9. Admin user/group screens currently read persisted subscription fields directly; stale-period presentation and active-cycle allowance-edit behavior still need a dedicated UI/API semantics audit even though actual GROUP authorization is now date-safe.
10. Group display name remains generic because Worklog source persists LINE group id, not durable group summary metadata.
11. Dedicated executable compile/test/migration/schema/browser validation is still pending by explicit user request.

## Next large batch

1. Audit and implement attachment operator UX around terminal states: add a pure safe-retry classifier first, then expose only retry actions that cannot replay an uncertain provider call or double bill. Unsafe/provider-uncertain states must remain resend/manual-review only.
2. Audit Admin subscription presentation and plan allowance edits: stale periods, renewal/display semantics, and active-cycle quota mutation policy.
3. Continue final static bug audit across Reply idempotency, PRIVATE/GROUP Web auth boundaries, quota settlement races, immutable raw input, pagination/filter edges and typed-finance consistency.
4. Finish repository cleanup: unused `packages/shared`, stale non-Worklog docs/config references, migration/deployment comments and dead frontend/Admin code found by static inspection.
5. Keep payment-provider integration disabled until provider requirements are known.
6. Then perform the user's requested concentrated local checkout/typecheck/test/migration/schema/browser smoke phase and fix failures together, including `0000`–`0011` plus post-cutover `0012` on a disposable DB. Do not substitute GitHub Actions for this local/runtime validation phase.
