# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first on every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

The user currently prefers large functionality batches and wants the concentrated local typecheck/test/migration pass after the major MVP paths are implemented. Continue static consistency review and author tests now, but never claim unexecuted verification passed.

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
- Scoped record read service for personal OA and exact group membership.
- Group and OA raw TEXT recording with LINE message-id idempotency.
- Secure group Web entry and separate PRIVATE one-time entry; no fake group id.
- Post-persistence TEXT Gemini normalization with durable state, DB model/pricing, immutable cost snapshot and resume/no-double-charge behavior.
- Reply TEXT PostgreSQL cache + migration `0007_worklog_line_text_cache.sql`; cache hit writes real TEXT record with both LINE ids and original cached timestamp.
- Three-Worker deployment baseline; Web/Admin use Workers Static Assets.

## Latest accelerated batch completed

### Quoted AUDIO / IMAGE / FILE

- Generalized LINE content fetcher to bounded arbitrary content fetch while retaining image helper.
- Added `worklog_attachment_ingestions` and migration `0008_worklog_attachment_ingestion.sql`.
- Added durable `WorklogAttachmentIngestionService`:
  - claim by command LINE id
  - fetch direct LINE content by quoted id
  - load DB AI runtime config
  - reserve charged Owner/personal AI quota before Gemini
  - analyze media/document
  - persist durable worklog record with AUDIO/IMAGE/FILE input type
  - persist both LINE ids
  - commit immutable usage/cost snapshot
  - resume `RECORD_CREATED` without another provider call
  - completed redelivery returns duplicate without refetch/provider rerun
  - provider/LINE/quota failure does not persist binary
- Added Gemini attachment normalizer:
  - images: multimodal text/factual description + summary
  - audio: transcript + summary
  - PDF: multimodal document extraction
  - text-like files: text/JSON/XML/CSV/Markdown extraction
  - DOCX/XLSX and unsupported binary formats fail clearly and ask for PDF/text instead of unreliable parsing
  - structured output: raw/extracted text, concise summary, broad category
- Group Reply resolves TEXT cache first; cache miss goes to direct attachment ingestion and charges Owner.
- OA private Reply goes directly to attachment ingestion and charges personal user.
- User-facing handling exists for expired content, oversized content, unsupported formats, insufficient quota and generic failures.
- Added attachment ingestion tests for first execution, completed duplicate and quota-settlement resume.
- Stale attachment `PROCESSING` older than 15 minutes is terminalized as uncertain rather than automatically replayed, preventing potential double provider billing. Explicit retry/admin retry can be added later.

### Real Worklog PWA backend

Mounted authenticated `/api/v1/worklog` routes:
- `GET /surfaces`
- `GET /records/personal`
- `GET /records/group/:sourceId`
- `GET /usage/me`
- `GET /groups/:sourceId/owner-view`
- `PATCH /groups/:sourceId/members/:memberUserId/recording`

Behavior:
- WEB_SESSION bearer identity resolves actual Worklog user.
- Group records recheck exact active membership.
- Owner usage/member routes recheck stable Owner identity.
- CORS is restricted to configured `WEB_APP_ORIGIN`.

### Real Worklog PWA UI

- `aftertrace-web` now boots `WorklogRoot` instead of legacy Memory management UI.
- Supports one-time entry token and normal LINE login session.
- Shows actual `worklog_records`.
- Separate Personal / Group scopes.
- Basic non-AI text/input-type/category filters.
- Uses LINE `source_timestamp` for ordering/display when available.
- Shows plan AI allowance / used / remaining and TEXT/AUDIO/IMAGE/FILE counts.
- Group Owner view shows member counts/AI usage and recording enable/disable toggle; owner cannot disable self.
- Responsive mobile styling added.
- Removed duplicate initial PWA load.

### Static/deployment cleanup

- Fixed missing runtime export for line TEXT cache schema.
- Registered attachment schema in runtime schema, Drizzle config and journal.
- Aligned attachment status CHECK between Drizzle schema and migration.
- API `wrangler.toml` no longer hard-codes old `after-trace.pages.dev`; deployment must configure Web Worker URL/origin explicitly.
- Record read model now exposes `sourceTimestamp`; fixtures were updated.

Latest code commit immediately before this progress update: `6351d668b5c5c94c7abcb23ecef2c6d16ecd2292`.

## Verification status

Per current user direction, the concentrated local verification run is intentionally deferred until more MVP features are complete.

Not executed yet for this accelerated branch state:
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- migrations `0001`–`0008` on disposable PostgreSQL/Neon
- real LINE Reply media E2E
- real Gemini image/audio/PDF calls
- Web/Admin Workers build/deploy smoke tests

Tests are authored but are **not claimed passing**.

Before production, explicitly validate `0005` private auth, `0006` normalization race recovery, `0007` TEXT TTL/cap pruning and `0008` attachment idempotency/quota settlement. Worklog migrations remain hand-authored/journaled; check Drizzle drift locally.

## Remaining important product work

### 1. Internal Admin conversion — next large priority
- Worklog user list/detail with plan, groups, AI quota/usage and TEXT/AUDIO/IMAGE/FILE counts.
- Group owner/member usage detail.
- Create/edit plan levels, price, capabilities and AI allowance.
- Manual user plan assignment/history.
- Edit active AI provider/model/input-output-media pricing/FX.
- Feedback list and anomaly/system-error list.
- Replace interim legacy Cloudflare Access-only assumption with simple configured username/password MVP boundary.

### 2. Customer / Project / record management PWA
- Minimal customer CRUD: name, phone, address, note.
- Minimal project CRUD: customer, name, address, status, note.
- Deterministic attach/detach record to customer/project; do not auto-link ambiguous AI hints.
- Record edit flow.
- Typed transaction CRUD for received/expense/receivable.

### 3. PWA scale / UX
- Server pagination and filters for larger histories.
- Customer/project/time/type filtering on server.
- Better group display label if group-summary retrieval is later added.
- Retry/error/empty states and mobile polish.

### 4. Attachment reliability polish
- Explicit/admin retry for terminal failed attachment/AI operations.
- Verify actual LINE status codes for old quoted TEXT versus expired attachment so final expired wording is exact.
- Tune media/file byte limits and actual Gemini cost accounting with real provider calls.
- Original attachment file name is not retained by design because attachment messages are not cached; current durable metadata keeps MIME/byte length/source.

### 5. Legacy removal + bug audit
- Remove old Energy/Memory/commerce/reminder paths only after Worklog equivalents are complete.
- Audit cross-source leakage, LINE redelivery/idempotency, quota races, transaction duplication, concurrent edits, CORS/origin/deep-link Worker deployment, bootstrap/migration reliability.

### 6. Concentrated local verification requested by user
After major MVP features are done:
- checkout/install locally
- typecheck/lint/test
- disposable DB migration/schema check
- fix all failures
- manual LINE + PWA + Admin smoke/E2E
- production cutover only after that.
