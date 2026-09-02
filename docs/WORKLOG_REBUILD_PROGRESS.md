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

Record list now supports server-side:
- q/type/category/customer/project/from/to filters
- bounded limit/offset pagination with `hasMore` / `nextOffset`
- source-level authorization before query
- customer/project name join through permitted records
- LINE source timestamp ordering

Workspace management rules:
- CRM/project/finance requires caller's owned personal workspace; mere group membership does not expose another Owner's CRM/finance.
- Customer/project/record links are validated to same workspace.
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
- deleted obsolete `apps/web/src/App.tsx`
- deleted obsolete `apps/web/src/WebRoot.tsx`
- deleted obsolete legacy `apps/web/src/api.ts`
- deleted obsolete rewarded-ad client from retired Memory/Energy Web surface

## Completed subscription boundary

- Dedicated `/api/v1/subscription` boundary mounted in API Worker.
- Enabled plan catalog exposed to authenticated PWA users.
- Current plan is identified separately from public plan definitions.
- Durable `worklog_checkout_intents` with user/plan/request-key idempotency.
- PWA `/subscription` page shows plan price, AI allowance and selected capabilities.
- Checkout intent client/UI exists and redirects when a provider URL exists.
- Payment provider is intentionally **not configured yet**; current UI says so instead of faking successful payment.
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

`docs/WORKLOG_DEPLOYMENT.md` and `.env.example` now describe configured Worklog Admin auth and three independent Workers.

## Static consistency work completed in the latest batch

- PWA client aligned to deterministic customer/project/transaction APIs.
- Record list maps DB snake_case rows to typed camelCase UI model.
- Raw-text mutation removed from PWA.
- Group record edit UI only appears for group Owner; API still enforces workspace ownership.
- Customer/project/finance UI appears only when caller has personal workspace.
- Admin CORS allows Authorization while restricting exact `ADMIN_WEB_ORIGIN`.
- Admin credentials/session secret remain API-only.
- Legacy customer/project routes that previously allowed raw record mutation were replaced by audited deterministic workspace management.
- Structured failure anomalies now exist at DB boundary for attachment/normalization terminal failure.

## Verification status

Intentionally **not executed yet** for the accelerated branch state:
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- migrations `0001`–`0010` on disposable PostgreSQL/Neon
- real LINE Reply media E2E
- real Gemini image/audio/PDF calls
- PWA CRUD/filter/pagination/subscription browser smoke
- Admin login/plan/runtime/manual-subscription browser smoke
- Web/Admin Workers build/deploy smoke

Tests are authored but are **not claimed passing**.

Before production explicitly validate private auth, normalization race recovery, TEXT TTL/cap pruning, attachment idempotency/quota settlement, anomaly triggers and checkout-intent idempotency. Worklog migrations are hand-authored/journaled; check Drizzle drift locally.

## Known remaining risks / debt

1. Payment provider is not connected. Checkout intent is durable but cannot charge/activate a plan yet.
2. Plan definition allowance edits do not yet have an explicit policy for rewriting an already-active cycle's quota balance. Decide whether change is next-period-only or immediate-with-floor-at-used+reserved; never silently destroy used/reserved quota.
3. Provider-uncertain attachment failures intentionally have no automatic retry because replay can double bill. Any Admin retry must be explicit and semantics-safe.
4. Old Memory/Energy/commerce/conversation routes/runtime still exist in API code. Most important cutover audit: ordinary group messages currently still fall through old conversation/memory flow after Worklog's temporary TEXT cache. Remove/disable legacy product behavior once required Worklog replacement boundaries are confirmed.
5. Group display name remains generic because Worklog source persists LINE group id, not durable summary display metadata.
6. Dedicated local compile/test/migration/schema/browser validation is still pending by user request.

## Next large batch

1. Finish payment-provider decision/integration only if provider requirements are known; otherwise preserve honest disabled checkout.
2. Perform legacy API cutover audit and remove old Memory/Energy/conversation behavior that is no longer part of Worklog, especially ordinary group-message fallthrough.
3. Static TypeScript/API contract audit across the large Admin/PWA/subscription changes; add focused authorization/immutability/transaction/idempotency tests.
4. Remove remaining dead files/routes/config instead of keeping compatibility debt.
5. Then do the user's requested concentrated local checkout/typecheck/test/migration/schema/browser smoke pass and fix all failures as one focused phase.
