# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

The user wants large functionality batches. The concentrated local typecheck/test/migration/browser pass is intentionally deferred until major MVP paths and legacy cutover are complete. Keep authoring tests/static checks, but never claim unexecuted verification passed.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Reply + `@AFTERTRACE` records quoted TEXT/AUDIO/IMAGE/FILE.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- Ordinary OA private text without `@AFTERTRACE` remains human-support traffic.
- Personal/group sources remain isolated.
- FREE is personal-only; group collaboration is capability-driven paid functionality.
- Group AI charges stable Owner; triggering member remains actor.
- Owner can disable future member recording, not historical read access.
- Customer/project is minimal; finance is typed/deterministic.
- Original LINE input is immutable source-of-truth.
- Three independent Cloudflare Workers: API, Web Static Assets, Admin Static Assets. No Pages target.

## LINE content rules

- Only ordinary GROUP TEXT is temporarily cached.
- PostgreSQL cache: TTL 5 days, max 1000/group, oldest-first pruning, no Redis.
- AUDIO/IMAGE/FILE are never cached.
- Reply media/file uses direct LINE message-content API by quoted LINE message id.
- Binary is in-memory only and never persists.
- Expired/unavailable media asks user to resend.
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
- `0009_worklog_failure_anomaly_triggers.sql`: terminal attachment and TEXT-normalization failures become structured Worklog anomaly events.
- `0010_worklog_checkout_intents.sql`: idempotent subscription checkout-intent boundary.
- `0011_worklog_active_web_auth.sql`: makes active GROUP one-time-link nonce storage explicit for fresh journal-only databases.

## Completed media ingestion

- Direct LINE content fetch for quoted IMAGE/AUDIO/FILE; media/file never enters local cache.
- Durable flow: claim -> fetch -> runtime pricing -> quota reserve -> Gemini -> record -> usage snapshot -> quota commit -> success.
- Redelivery resumes without another provider call or duplicate quota charge.
- Stale provider-uncertain PROCESSING terminalizes after 15 minutes instead of automatically replaying Gemini.
- IMAGE multimodal analysis, AUDIO transcription/summary, PDF multimodal extraction, text/JSON/XML/CSV/Markdown text input.
- DOCX/XLSX/unknown binary explicitly ask for PDF/text instead of pretending to parse.
- Group media charges Owner; OA private media charges personal user.
- User-facing expired/oversize/unsupported/quota/general failure responses exist.
- Attachment idempotency/quota-resume tests authored; not executed yet.

## Completed Worklog PWA API

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

Record list supports server-side q/type/category/customer/project/from/to filters plus bounded limit/offset pagination with `hasMore` / `nextOffset`, source-level authorization, customer/project joins only through permitted records, and LINE source timestamp ordering.

Workspace management rules:
- CRM/project/finance requires caller's owned personal workspace; mere group membership does not expose another Owner's CRM/finance.
- Customer/project/record links are validated to same workspace.
- When a selected project is already assigned to a customer, that project/customer relationship is authoritative for record and transaction linkage; the server canonicalizes `customer_id` to the project's customer so stale UI combinations cannot persist contradictory CRM/finance links.
- When a project has no customer, an independently selected customer remains allowed.
- Referenced customer/project cannot be deleted.
- Record editing changes normalized summary/category/customer/project only; raw LINE content is immutable.
- Transactions are typed `RECEIVED` / `EXPENSE` / `RECEIVABLE` with exact TWD amount, time and optional links.
- Customer/project/record organization/transaction mutations are audited.
- PWA feedback stores sanitized diagnostic context only, not raw work records.

## Completed Worklog PWA UI

- Personal / Group source switcher.
- Real Worklog records.
- Server-backed filters and Load More pagination.
- Own plan quota/used/remaining and TEXT/AUDIO/IMAGE/FILE counts.
- Group Owner member usage and recording toggle.
- Record summary/category/customer/project organizer; original LINE text clearly immutable.
- Customer create/edit/delete.
- Project create/edit/delete/status/customer association and deterministic finance aggregates.
- Received/expense/receivable create/edit/delete.
- Feedback form.
- Responsive management UI.

Legacy Web technical debt removed:
- obsolete `apps/web/src/App.tsx`
- obsolete `apps/web/src/WebRoot.tsx`
- obsolete legacy `apps/web/src/api.ts`
- obsolete rewarded-ad client from retired Memory/Energy Web surface

## Completed subscription boundary

- Dedicated `/api/v1/subscription` boundary mounted in API Worker.
- Enabled plan catalog exposed to authenticated PWA users.
- Current plan identified separately from public plan definitions.
- Durable `worklog_checkout_intents` with user/plan/request-key idempotency.
- PWA `/subscription` shows plan price, AI allowance and selected capabilities.
- Checkout intent client/UI redirects when a provider URL exists.
- Payment provider is intentionally **not configured yet**; UI says so instead of faking payment.
- Provider integration can reuse the checkout-intent boundary without redesigning plan/subscription domain.

## Completed Worklog Admin conversion

Authentication:
- Removed legacy Cloudflare Access verifier from Worklog Admin flow.
- API-only `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`.
- `/api/v1/admin/login` returns signed bearer session; all other Admin routes require it.
- Session defaults 12h, max 24h; secret rotation invalidates sessions.
- Admin SPA stores session in `sessionStorage`; credentials/secrets are never Vite constants.
- Auth tests authored for configuration, credentials, expiry and tampering; not executed yet.

Admin surfaces now read/write Worklog domain:
- Overview Worklog users/OA friends/groups/records/AI cost/anomalies/failures/feedback.
- OA-primary Users with q/plan/type/sort, plan/quota/record-type/group counts.
- User detail with subscription/quota/groups/memberships/AI usage/subscription history.
- Manual plan assignment via Worklog subscription service, audited.
- Group list/detail with stable Owner/binding/plan/quota/member record+AI usage.
- Plan create/edit price/rank/enabled/capabilities/AI allowance; FREE group collaboration forced off; audited.
- AI provider/model/input/output/audio/image pricing and USD/TWD editor; audited; historical usage retains execution snapshot.
- Feedback review.
- Structured anomaly status controls plus attachment/normalization failure views.
- Worklog audit viewer.

## Completed live legacy runtime cutover

- `apps/api/src/index.ts` is a Worklog-only LINE entrypoint.
- Group events run through `processWorklogGroupWebhook`; OA private events remain separate Worklog OA boundary.
- Ordinary group messages stop after `WorklogLineRuntime`: only ordinary TEXT can use bounded PostgreSQL cache; there is no conversation ingestion, Energy grant, extraction, background Memory, old AI chat or reminder fallthrough.
- Worker-level HTTP 410 tombstones remain for old URLs without mounting legacy routers.
- Removed legacy `/api/v1/auth/groups` and `/api/v1/auth/memories` implementation code; one-time GROUP/PRIVATE entry exchange and LINE Login remain.
- Auth no longer reads legacy `line_groups`, `group_members` or `memories`.
- GROUP entry exchange returns only Worklog session + typed entry context; obsolete `groupContextToken` is gone.
- `.env.example` exposes only active Worklog AI provider credential (`GEMINI_API_KEY`); model/pricing are DB/Admin-controlled.
- Group reply delivery is failure-isolated: persisted records remain successful if LINE reply delivery fails.

## Completed repository-level legacy deletion

Latest deletion batch removed the retired API implementation surface rather than merely leaving it unreachable:

- Deleted API source/test directories: `ai`, `commerce`, `config`, `conversation`, `credits`, `energy`, `extraction`, `management`, `memory`, `proactive`, `reminders`, `retention`.
- Deleted retired LINE helpers/tests: old command parser, Energy status and push transport. Active LINE directory now contains only content fetch, event parsing, reply and signature code/tests.
- Deleted old Drizzle declarations `schema.ts` and `schema-round5/6/8/9/11/16/17/18/19/20.ts`.
- `schema-all.ts` and `drizzle.config.ts` are Worklog-only active schema exports/config.
- Moved the still-active physical `web_auth_entry_nonces` declaration into `schema-worklog-web-auth.ts`; its historical table name is retained intentionally so GROUP one-time links do not need a risky rename.
- Added journaled `0011_worklog_active_web_auth.sql`, fixing a fresh-database gap where the old bespoke deploy helper created `web_auth_entry_nonces` but the Drizzle journal did not.
- Replaced API `db:deploy:migrate` bespoke script with real `drizzle-kit migrate --config=../../drizzle.config.ts`; deleted the old script that only created auth nonce storage and removed a subset of Group Credit tables.
- Authored `drizzle/post-cutover/0012_worklog_legacy_cleanup.sql` covering retired pre-Worklog tables/types. It is intentionally post-cutover/destructive rather than pre-deploy journaled so an older Worker is never left running against already-dropped tables.
- Removed the no-op scheduled Worker handler; current `apps/api/wrangler.toml` already has no cron trigger.
- Replaced the stale root README that still described an unrelated sports-venue/radar rebuild and Cloudflare Pages architecture; README now points to the Worklog contract and three-Worker topology.

## Static consistency work completed

Earlier cutover static coverage:
- `worklog/group-webhook.test.ts` covers ordinary-message termination, scoped query links, lifecycle state, explicit-command failure and reply-delivery failure behavior.
- Auth service tests cover exact LINE membership verification on GROUP one-time entry exchange and no-consume behavior after membership loss.
- Existing attachment failure UX remains: expired/unavailable content asks resend; provider-uncertain processing is not automatically replayed.

Repository deletion audit:
- Re-read active API entrypoints before deletion and confirmed retained `admin`, `auth`, `line`, `worklog`, `index.ts`, `worker.ts` imports do not depend on deleted legacy directories.
- Re-read Worklog Drizzle repositories and confirmed they use Worklog tables/raw SQL rather than old schema module exports.
- Re-read the post-delete Git tree: API `src` now contains only `admin`, `auth`, `db`, `line`, `worklog`, `index.ts`, `worker.ts`; active LINE tree contains only content/events/reply/signature.
- Historical `0000_tough_scalphunter.sql` is preserved because migration history must remain reproducible; active Drizzle schema declarations no longer advertise those tables as current product schema.

Access-control audit:
- Fixed a FREE-personal-only contract leak: `@AFTERTRACE 查詢`, PWA group surface discovery and `/records/group/:sourceId` now require the Owner's paid `groupCollaboration` entitlement rather than only active membership.
- `authorizeGroupAccess` deliberately ignores `recording_enabled` and AI quota so disabling future recording does not erase historical reads.
- LINE `@AFTERTRACE 查詢` uses the access authorization before producing a scoped query link.
- PWA group surface discovery and group record reads require an enabled non-FREE group-capable plan; personal source access remains independent.
- Focused collaboration/LINE runtime tests were authored for entitled historical read, recording-disabled historical read and FREE rejection; not executed yet.

Latest subscription-period and workspace-link audit:
- Found a second group entitlement leak: multiple direct read paths trusted `worklog_user_subscriptions.status = 'ACTIVE'` even when `current_period_end` had already passed. `WorklogSubscriptionService` and the atomic quota reservation SQL already rejected expired periods, but group query/PWA discovery could still expose historical group data until some external process changed the status row.
- Group collaboration authorization now carries subscription status, effective time, period start/end and plan-enabled state into the service. Both group read and group record authorization reject not-yet-effective, not-yet-started, expired, inactive or disabled plans before capability/quota checks.
- PWA group surface discovery and group membership read authorization now also require the subscription window to be current at database time, closing the direct-SQL bypass.
- Usage-window lookup now rejects stale ACTIVE periods rather than presenting them as the current quota cycle.
- Added focused collaboration tests for an ACTIVE-but-expired period, a future-effective period and stale-period record authorization. Tests are authored but were not executed.
- Resolved the customer/project semantic ambiguity deterministically: if a project already belongs to a customer, record and typed-transaction writes canonicalize their customer link to the project's customer; if the project is unassigned, the selected customer remains independent. Same-workspace customer/project/record validation remains in place.
- Added focused pure tests for project-customer canonicalization; not executed.
- Re-reviewed record editing and confirmed this batch still changes only normalized summary/category/customer/project metadata; raw LINE input remains untouched.
- No concentrated local command suite was run in this batch, per user direction.

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

Before production explicitly validate private auth, normalization race recovery, TEXT TTL/cap pruning, attachment idempotency/quota settlement, anomaly triggers, checkout-intent idempotency, fresh-db creation of `web_auth_entry_nonces`, group entitlement downgrade/period-expiry behavior, deterministic project/customer linkage, and post-cutover cleanup safety. Worklog migrations are hand-authored/journaled; check Drizzle drift locally.

## Known remaining risks / debt

1. Payment provider is not connected. Checkout intent is durable but cannot charge/activate a plan yet.
2. Plan definition allowance edits do not yet have an explicit policy for rewriting an already-active cycle's quota balance. Decide whether change is next-period-only or immediate-with-floor-at-used+reserved; never silently destroy used/reserved quota.
3. Provider-uncertain attachment failures intentionally have no automatic retry because replay can double bill. Any Admin retry must be explicit and semantics-safe.
4. Attachment record persistence and ingestion-state advancement are still separate repository operations. A rare database/network failure after the record insert but before durable `RECORD_CREATED` state can leave a persisted record with terminal ingestion failure/uncertain quota settlement; this should be made atomic or explicitly recoverable before final validation.
5. The destructive `post-cutover/0012` cleanup is authored but intentionally not in the automatic pre-deploy journal. It must be exercised on disposable DB first and run only after the Worklog Worker is deployed/healthy.
6. `packages/shared` still contains legacy Memory/Credit constants and appears unused by current apps. Remove it only with the lockfile/workspace cleanup in the final repository audit so frozen-install behavior is not changed blindly.
7. Some old non-Worklog documentation may still exist outside the four Worklog contract docs/README; it should be classified as historical or removed during the final repo audit so future contributors are not misled.
8. Usage views intentionally separate authorization from historical analytics, but the no-active-window fallback still deserves one final UI/API semantics pass so an expired paid period is not presented confusingly as FREE with lifetime AI aggregates.
9. Group display name remains generic because Worklog source persists LINE group id, not durable summary display metadata.
10. Dedicated local compile/test/migration/schema/browser validation is still pending by user request.

## Next large batch

1. Make attachment record persistence + durable `RECORD_CREATED` ingestion state atomic/recoverable, then define an explicit Admin retry path only for states that are safe to retry without duplicate provider cost.
2. Continue the dedicated static Worklog bug audit: Reply idempotency, PRIVATE/GROUP Web auth boundaries, subscription display/renewal semantics, quota settlement races, immutable raw input and pagination edges.
3. Review Admin subscription/plan views for stale-period presentation and active-cycle allowance edit semantics; fix deterministic cases and add focused tests.
4. Finish final repository cleanup: unused `packages/shared`, stale non-Worklog docs/config references, migration/deployment comments and any dead frontend/Admin code found by static inspection.
5. Keep payment-provider integration disabled until provider requirements are known.
6. Then do the user's requested concentrated local checkout/typecheck/test/migration/schema/browser smoke pass and fix all failures as one focused phase, including `0000`–`0011` plus post-cutover `0012` on a disposable DB.
