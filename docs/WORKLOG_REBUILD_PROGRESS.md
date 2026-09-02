# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Every development run must first read:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

Then inspect current branch HEAD before editing. Prefer meaningful multi-part batches. The user explicitly prefers pushing core functionality quickly now and running the full local typecheck/test/migration pass after the major MVP paths are implemented; do not falsely claim unexecuted tests passed.

## Product / architecture baseline

- LINE-first work-record product: LINE records, Web/PWA browses and manages.
- `@AFTERTRACE <text>` records direct text.
- Reply + `@AFTERTRACE` records quoted TEXT/AUDIO/IMAGE/FILE when recoverable.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- Ordinary OA private text without `@AFTERTRACE` remains human-support traffic.
- Personal and group records remain clearly separated and source-scoped.
- FREE is personal-only; group collaboration requires plan capability.
- Group AI usage is charged to stable group Owner while preserving triggering member as actor.
- Owner can disable member recording without removing historical read access.
- Minimal customer/project fields; typed finance only for arithmetic. Invoice/payment-provider integrations remain postponed.
- AI runtime model/pricing is DB-admin configurable; historical usage stores immutable pricing/model/cost snapshots.
- Deployment is three independent Cloudflare Workers:
  - `aftertrace-api`: Hono API Worker
  - `aftertrace-web`: React/Vite Workers Static Assets
  - `aftertrace-admin`: React/Vite Workers Static Assets
- Cloudflare Pages is no longer a deployment target.

## LINE content policy

- Only ordinary GROUP TEXT is temporarily cached locally.
- PostgreSQL cache defaults: TTL 5 days, max 1000 messages/group, deterministic oldest pruning.
- No Redis.
- AUDIO/IMAGE/FILE are never locally cached.
- Reply media/file uses `quotedMessageId` to fetch LINE message content directly.
- Binary content is processed in memory and never permanently stored.
- Expired/unavailable LINE content must return clear resend UX.
- Reply-created records persist both command `line_message_id` and source `quoted_line_message_id`.

## Completed backend foundations

### Worklog data/domain
- Worklog users/OA friendship, workspaces, PRIVATE/GROUP sources, memberships, minimal customers/projects, records, typed transactions, plans/capabilities, subscriptions/history, AI runtime pricing, AI usage snapshots, feedback, anomalies and audit models exist.
- Stable group owner and per-member `recording_enabled` exist.
- Pending groups prevent guessed ownership; explicit `@AFTERTRACE 啟用` safely binds owner.
- Race-safe AI quota balance/reservation/commit/release exists.
- Scoped record-read service enforces personal OA friendship and exact active group membership.

### LINE/OA runtime
- Group and OA webhook streams are separated.
- Group direct TEXT and OA private direct TEXT persist raw record first.
- Ordinary OA text stays human support.
- LINE raw record writes are idempotent by LINE message id.
- Recording-disabled members are rejected before new record/AI work.
- Group query remains allowed independently of recording permission.
- OA follow/unfollow and stable private source bootstrap are wired.

### Secure Web entry
- Group Web entry remains membership-verified.
- PRIVATE Web entry uses its own one-time token/nonce bound to exact LINE user + private source; no fake group id.
- OA `@AFTERTRACE 查詢` is wired to real private entry URL.

### TEXT AI normalization
- Post-persistence Worklog TEXT normalization is implemented with a durable state machine.
- Raw records survive missing config, quota exhaustion, provider failure and parse failure.
- DB-backed active model/pricing is used.
- GROUP charges owner while retaining member actor; PRIVATE charges self.
- Provider/model/token/media/pricing/cost snapshots are persisted.
- Redelivery does not rerun already-completed provider work or double-charge quota.

### Reply TEXT cache
- `worklog_line_text_cache` + migration `0007_worklog_line_text_cache.sql` exist.
- Ordinary group TEXT enters temporary cache best-effort without becoming a work record or AI input.
- Non-text never enters cache.
- Exact group + quoted message lookup enforces cross-group isolation.
- Reply TEXT cache hit creates a real TEXT work record with both LINE ids and original source timestamp, then uses normal TEXT normalization.

## Latest accelerated batch: attachment ingestion + real PWA + Owner management

This batch intentionally implemented multiple previously separate roadmap items before local verification.

### Quoted AUDIO / IMAGE / FILE ingestion
- Generalized `LineMessageContentResolver.content()` to fetch arbitrary LINE content with bounded byte limits while preserving legacy image fetch behavior.
- Added `worklog_attachment_ingestions` and `0008_worklog_attachment_ingestion.sql` for durable command-level attachment state.
- Added `WorklogAttachmentIngestionService`:
  - claim by command LINE message id
  - direct LINE content fetch by quoted id
  - DB AI runtime config
  - conservative owner/personal quota reservation before Gemini
  - provider execution
  - durable record insert with `AUDIO`/`IMAGE`/`FILE`
  - no binary persistence
  - durable `line_message_id` + `quoted_line_message_id`
  - immutable usage/cost commit
  - resume from `RECORD_CREATED` without second provider call
  - completed redelivery returns duplicate without LINE refetch/provider call
- Added `GeminiWorklogAttachmentNormalizer`:
  - IMAGE multimodal understanding
  - AUDIO transcription/summary
  - PDF multimodal document extraction
  - text-like files (`text/*`, JSON, XML, CSV, Markdown) decoded/read and normalized
  - DOCX/XLSX/other unsupported binary files currently fail clearly and ask for PDF/text rather than using an unreliable parser
  - grounded structured output: raw/extracted text, concise summary, broad category
- Group Reply flow now resolves TEXT cache first; cache miss proceeds to direct LINE attachment ingestion and charges group Owner.
- OA private Reply media/file proceeds directly to attachment ingestion and charges personal user.
- LINE content expiry, oversized content, unsupported format, quota failure and general provider failure have explicit user-facing outcomes.
- Attachment ingestion tests were authored for first execution, completed duplicate, and quota-settlement resume.

### Real Worklog PWA APIs
- Added authenticated `/api/v1/worklog` routes mounted at Worker entry:
  - `GET /surfaces`
  - `GET /records/personal`
  - `GET /records/group/:sourceId`
  - `GET /usage/me`
  - `GET /groups/:sourceId/owner-view`
  - `PATCH /groups/:sourceId/members/:memberUserId/recording`
- Routes use WEB_SESSION bearer token and resolve the actual Worklog user from LINE identity.
- Group record API rechecks active membership; owner APIs recheck actual owner identity.
- CORS is limited to configured `WEB_APP_ORIGIN`.

### Real Worklog PWA UI
- `aftertrace-web` main entry now renders the new `WorklogRoot`, not legacy Memory management UI.
- Handles one-time LINE entry tokens and normal LINE login session.
- Clearly separates personal vs accessible group surfaces.
- Displays actual `worklog_records` rather than legacy Memory.
- Basic non-AI client filters: record text, input type, category.
- Uses original LINE `source_timestamp` for display/order when available.
- Shows current plan AI allowance/used/remaining and TEXT/AUDIO/IMAGE/FILE counts.
- For a group Owner, shows member usage and per-member recording toggle; owner cannot disable self.
- Added mobile responsive styling.

### Deployment cleanup
- API Worker now mounts Worklog routes separately from legacy routes.
- API `wrangler.toml` no longer hard-codes obsolete `after-trace.pages.dev`; deployment must configure `WEB_APP_URL` / `WEB_APP_ORIGIN` to the independent `aftertrace-web` Worker origin.
- Web/Admin remain separate Workers Static Assets deployments.

### Static fixes made during acceleration
- Added missing runtime export for `schema-worklog-line-text-cache`.
- Registered attachment schema in runtime schema and Drizzle config/journal.
- Aligned attachment status CHECK in schema with migration.
- Updated record fixtures/types for `sourceTimestamp`.
- Removed duplicate initial PWA record load.

## Current validation policy / status

Per user direction, finish more of the MVP first, then perform one concentrated local verification pass.

Not yet executed for this accelerated batch:
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- migrations on a disposable Neon/PostgreSQL DB
- real LINE webhook/media E2E
- real Gemini media calls
- Web/Admin Workers build/deploy smoke test

Therefore all tests mentioned above are **authored, not yet claimed passing**.

Before real deployment, validate migrations `0001` through `0008`, especially:
- `0005` private entry/auth
- `0006` TEXT normalization race recovery
- `0007` TEXT cache TTL/cap pruning
- `0008` attachment ingestion idempotency/quota settlement

Worklog migrations are still hand-authored/journaled; Drizzle schema/snapshot drift must be checked locally.

## Known cautions to address before production

- Attachment `PROCESSING` state still needs an explicit stale/uncertain terminal policy so a Worker death during provider execution cannot leave a command visually pending forever; automatic re-execution must not risk duplicate provider billing.
- Reply TEXT cache miss is treated as possible attachment. Final expired UX depends on LINE content API response mapping; verify actual LINE status codes for old text vs expired attachment during E2E.
- Attachment original file name is unavailable if not retained from the original webhook; by product decision attachments themselves are not cached. Current durable metadata stores MIME type/byte length/source.
- Office DOCX/XLSX direct parsing is intentionally not implemented yet; MVP supports images, audio, PDF and text-like files.
- PWA filter currently operates on the loaded recent record window; server-side pagination/filtering is still needed for larger histories.
- Group display name is not yet stored/exposed; PWA currently labels accessible groups generically.
- Legacy Energy/Memory/commerce/reminder paths remain in the API repository and should be removed only after Worklog replacement surfaces are complete and verified.
- Admin UI still needs the full Worklog conversion and simple configured username/password boundary.

## Next prioritized batches

1. **Admin conversion (large batch)**
   - Worklog user list/detail
   - plan level / price / capabilities / AI quota editing
   - manual plan assignment/history
   - AI provider/model/pricing editing
   - group Owner/member usage
   - feedback and anomaly list
   - simple configured username/password auth replacing interim legacy Access-only dependency
2. **Customer / Project / record management in PWA**
   - CRUD minimal customer/project
   - attach/detach records deterministically
   - edit normalized/raw record fields where allowed
   - typed transaction CRUD for received/expense/receivable
   - avoid ambiguous AI auto-linking
3. **Attachment reliability polish**
   - stale PROCESSING terminalization
   - explicit/admin retry for terminal failed AI operations
   - actual LINE expiry status mapping
   - file/media limits and provider cost tuning
4. **PWA scaling/UX polish**
   - server pagination/time/customer/project/type filters
   - group labels if LINE profile/group-summary retrieval is added
   - mobile empty/error/retry states
5. **Legacy removal / final bug audit**
   - remove old Memory/Energy paths no longer reachable/needed
   - cross-source isolation audit
   - LINE redelivery/idempotency audit
   - AI/quota race/error recovery
   - three-Worker CORS/origin/deep-link/deploy audit
   - migrations/bootstrap reliability
6. **Concentrated local verification requested by user**
   - install/checkout locally
   - typecheck/lint/test
   - disposable DB migration/schema check
   - fix all failures
   - then manual LINE + PWA + Admin smoke/E2E before production.
