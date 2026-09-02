# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first on every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

The user prefers large functionality batches and wants the concentrated local typecheck/test/migration pass after the major MVP paths are implemented. Continue static consistency review and author tests now, but never claim unexecuted verification passed.

## Stable product rules

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records direct text.
- Reply + `@AFTERTRACE` records quoted TEXT/AUDIO/IMAGE/FILE when recoverable.
- `@AFTERTRACE 查詢` opens scoped Web/PWA without LIFF.
- Ordinary OA private text without `@AFTERTRACE` remains human-support traffic.
- Personal and group records remain source-isolated and visibly separate.
- FREE is personal-only; group collaboration is paid-capability driven.
- Group AI charges stable Owner; triggering member remains actor.
- Owner may disable member recording, not historical read access.
- Customer/project stays minimal; finance that requires arithmetic is typed.
- Original LINE input is durable source-of-truth and is not overwritten from the PWA.
- Three independent Cloudflare Workers: API, Web Static Assets, Admin Static Assets. Pages is not a deployment target.

## LINE content contract

- Only ordinary GROUP TEXT is cached locally.
- PostgreSQL cache: 5-day TTL, max 1000/group, oldest-first pruning, no Redis.
- AUDIO/IMAGE/FILE are never cached.
- Reply media/file uses direct LINE message-content API by `quotedMessageId`.
- Binary is in-memory only and never persisted.
- Expired/unavailable content returns resend UX.
- Reply records keep both command `line_message_id` and `quoted_line_message_id`.

## Completed foundations

- Worklog users/OA friendship, workspace, PRIVATE/GROUP sources, membership, customer/project, record, typed transaction, plan/subscription, AI config/usage, feedback, anomaly and audit schema foundations.
- Stable group owner, pending-group bootstrap and explicit `@AFTERTRACE 啟用`.
- Member `recording_enabled` and Owner-only mutation.
- Race-safe AI quota reservation/commit/release.
- Scoped personal/group reads.
- Group and OA raw TEXT recording with LINE message-id idempotency.
- Secure group Web entry and separate PRIVATE one-time entry; no fake group id and no LIFF dependency.
- Post-persistence TEXT Gemini normalization with durable state, DB model/pricing, immutable cost snapshot and resume/no-double-charge behavior.
- Reply TEXT PostgreSQL cache + migration `0007_worklog_line_text_cache.sql`.
- Quoted AUDIO/IMAGE/FILE direct LINE fetch + migration `0008_worklog_attachment_ingestion.sql`.
- Three-Worker deployment baseline; Web/Admin use Workers Static Assets.

## Completed media ingestion

- Generalized bounded LINE content fetch while retaining image helper.
- `worklog_attachment_ingestions` durable state tracks command + quoted ids.
- Attachment flow: claim -> direct LINE fetch -> runtime pricing -> quota reserve -> Gemini -> worklog record -> durable usage snapshot -> quota commit -> success.
- Completed/redelivered work resumes without another provider call or duplicate quota charge.
- Stale `PROCESSING` older than 15 minutes terminalizes as uncertain instead of automatically replaying Gemini.
- Images use multimodal analysis; audio is transcribed/summarized; PDF is multimodal-extracted; text/JSON/XML/CSV/Markdown is treated as text input.
- DOCX/XLSX and unknown binary formats fail explicitly and ask for PDF/text rather than pretending to parse them.
- Group media charges Owner; OA private media charges personal user.
- Binary never persists in PostgreSQL.
- User-facing expired/oversize/unsupported/quota/general failure responses exist.
- Tests exist for first execution, completed duplicate and quota-settlement resume; not yet executed in the deferred local pass.

## Completed Worklog PWA backend

Authenticated `/api/v1/worklog` now includes:

- `GET /surfaces`
- `GET /records/personal`
- `GET /records/group/:sourceId`
- `PATCH /records/:id`
- `GET /usage/me`
- `GET /groups/:sourceId/owner-view`
- `PATCH /groups/:sourceId/members/:memberUserId/recording`
- Customer CRUD
- Project CRUD
- Typed transaction CRUD
- PWA feedback submission

Record-list scale behavior:

- server-side q/type/category/customer/project/from/to filters
- bounded limit/offset pagination with `hasMore` / `nextOffset`
- exact active group membership rechecked before group query
- customer/project names joined only through records in the permitted source
- LINE `source_timestamp` is the primary list timestamp/order when available

Workspace management/security behavior:

- CRM/project/finance endpoints require the caller's own personal OA surface/workspace; being another user's group member does not expose Owner CRM/finance.
- Customer/project links are validated to the same workspace.
- Customer/project deletes fail while referenced instead of cascading/removing history.
- Record editing changes normalized summary/category/customer/project only; raw LINE content remains immutable.
- Typed transactions support `RECEIVED`, `EXPENSE`, `RECEIVABLE`, exact TWD amount, occurred time, optional customer/project/record and note.
- Create/update/delete customer/project/record organization/finance mutations write Worklog audit events.
- PWA feedback records channel `PWA` with sanitized page/viewport/browser/source context and does not attach raw work-record content.

## Completed Worklog PWA UI

`aftertrace-web` now provides:

- one-time bot entry plus ordinary LINE Login session
- separate Personal / Group scopes
- actual Worklog records with server-backed filters and Load More pagination
- plan allowance / used / remaining AI usage and TEXT/AUDIO/IMAGE/FILE counts
- group Owner member usage and recording toggle
- record organization editor for normalized summary/category/customer/project while explicitly preserving original LINE text
- customer create/edit/delete
- project create/edit/delete/status/customer association
- typed received/expense/receivable create/edit/delete
- project finance aggregates from deterministic transactions
- PWA feedback form with diagnostic context
- mobile/responsive layouts for management surfaces

Legacy frontend technical debt removed:

- deleted obsolete `apps/web/src/App.tsx`
- deleted obsolete `apps/web/src/WebRoot.tsx`
- deleted obsolete legacy `apps/web/src/api.ts`
- deleted obsolete rewarded-ad client from the retired Memory/Energy Web surface

## Completed Worklog Admin conversion

Admin authentication:

- Removed legacy Cloudflare Access JWT verifier from Worklog Admin flow.
- API-only configured `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`.
- `/api/v1/admin/login` validates credentials and returns HMAC-signed bearer session; all subsequent Admin routes require it.
- Session defaults to 12h and maxes at 24h; secret rotation invalidates existing sessions.
- Admin SPA keeps bearer token in `sessionStorage`; credentials/secrets are never Vite constants.
- Added auth tests for config, credentials, expiry and tamper rejection; not yet executed.

Admin operational surfaces now use Worklog tables, not legacy Memory/Energy tables:

- Overview: Worklog users/OA friends/groups/records/today's AI cost/open anomalies/attachment+normalization failures/feedback.
- Users: OA-primary list, query/plan/type/update-time filters, plan/quota/remaining, TEXT/AUDIO/IMAGE/FILE counts, owned/member group counts.
- User detail: profile, current subscription/quota, owned groups, memberships, recent AI usage, subscription history.
- Manual plan assignment through `WorklogSubscriptionService`, source `ADMIN`, audited.
- Groups: stable owner/binding method, Owner plan/quota, group AI usage/cost, active member and record counts.
- Group detail: member recording status, member-attributed AI usage/cost, record-type counts, recent records and usage.
- Plans: create/edit display price/rank/enabled/capabilities/AI allowance; FREE forcibly disables group collaboration; changes audited.
- AI runtime: edit provider/model/input/output/audio/image pricing and optional USD/TWD conversion; changes audited; historical usage retains its captured snapshot.
- Feedback list.
- Structured anomaly list and status update plus terminal attachment/text-normalization failures.
- Worklog audit log viewer.

Deployment docs and `.env.example` now describe configured Worklog Admin auth rather than interim Cloudflare Access.

## Static consistency review completed in this batch

- PWA client was aligned from legacy PATCH/raw-text mutation calls to deterministic PUT customer/project and typed transaction APIs.
- PWA record API maps DB snake_case rows into the existing typed camelCase UI model.
- Raw record text mutation was removed from the PWA editor.
- Group record editing is only surfaced to the group Owner (and still enforced by workspace ownership in API routes).
- Customer/project/finance UI is only surfaced when a personal OA workspace exists.
- Server-side record filters retain source-level authorization before querying records.
- Admin CORS now allows `Authorization` and restricts browser origin to `ADMIN_WEB_ORIGIN`.
- Admin password/session secrets remain API-only.

Latest code commit immediately before this progress update: `70c49e3cd23e486792ac727394b38ee8460d1565`.

## Verification status

Per current user direction, the concentrated local verification run remains intentionally deferred until the last major MVP/legacy-removal batch is complete.

Not executed yet for this accelerated branch state:

- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- migrations `0001`–`0008` on disposable PostgreSQL/Neon
- real LINE Reply media E2E
- real Gemini image/audio/PDF calls
- browser PWA CRUD/filter/pagination smoke tests
- Worklog Admin login/plan/runtime/manual subscription browser smoke tests
- Web/Admin Workers build/deploy smoke tests

Tests are authored but are **not claimed passing**.

Before production, explicitly validate `0005` private auth, `0006` normalization race recovery, `0007` TEXT TTL/cap pruning and `0008` attachment idempotency/quota settlement. Worklog migrations remain hand-authored/journaled; check Drizzle drift locally.

## Known risks / items to audit next

1. Plan allowance edits currently change the plan definition; confirm desired policy for whether an already-active cycle's quota balance should be immediately rewritten or only new/reassigned periods should adopt the new allowance. Do not silently destroy already-used/reserved quota while changing this behavior.
2. Explicit retry for attachment provider-uncertain terminal failures is intentionally not automatic because re-calling the provider can double bill. Admin currently surfaces the failure; design retry only with a deliberate operator action and clear semantics.
3. Structured anomaly table exists, but not every runtime catch path has been converted from Cloudflare logs into `worklog_anomaly_events`; finish high-value Worklog error capture in the bug-audit batch.
4. Group names are still generic in PWA because current Worklog source stores LINE group id, not durable group-summary display metadata.
5. Payment/subscription self-service UI is not yet rebuilt on the Worklog PWA; manual Admin assignment and plan/quota backend are ready.
6. Legacy API Memory/Energy/commerce/reminder code still exists behind older routes/runtime. Do not delete until remaining Worklog replacement/cutover needs are audited, but remove dead product paths rather than carrying compatibility debt.

## Next large batch

Prioritize completing the last MVP/cutover gaps rather than repeatedly running local verification:

1. Audit and finish user-facing subscription/plan surface or explicitly scope it out of the first local MVP test based on the product spec.
2. Capture high-value attachment/normalization/webhook failures into structured Worklog anomalies where safe.
3. Audit/remove remaining dead legacy Web/Admin code and identify legacy API routes that can now be deleted without affecting LINE Worklog runtime.
4. Static review for TypeScript/API contract mismatches introduced by the large Admin/PWA batch; add focused tests for authorization/immutability/typed transaction rules where useful.
5. Then perform the dedicated concentrated local checkout/typecheck/test/migration/schema/browser smoke pass requested by the user and fix all failures in one focused phase.
