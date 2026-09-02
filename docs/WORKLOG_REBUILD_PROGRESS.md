# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for continued development on branch `revive/line-worklog`.

Every development run must:
1. Read this file, `docs/WORKLOG_PRODUCT_SPEC.md`, `docs/WORKLOG_LINE_CONTENT_POLICY.md`, and `docs/WORKLOG_DEPLOYMENT.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to repeated bug audit/repair for logic, data consistency, LINE webhook/idempotency, Reply expiry, cross-source isolation, PWA/Admin UX, deployment isolation, and migrations.

## Baseline / product rules

- AFTERTRACE is a LINE-first work-record product. LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records.
- Reply TEXT/AUDIO/IMAGE/FILE + `@AFTERTRACE` records the quoted source when recoverable.
- `@AFTERTRACE 查詢` opens a short-lived scoped Web/PWA entry without LIFF.
- `@AFTERTRACE 啟用` is the explicit group-owner claim path when reliable add-actor evidence is unavailable; it must never steal an already-bound group.
- Ordinary OA private text without `@AFTERTRACE` is human-support traffic.
- OA friends have personal records; group records are source-scoped; personal and group surfaces must remain visibly separate.
- FREE is personal-only. Group/collaboration requires a plan capability.
- Group AI usage is charged to the stable group owner/subscriber while preserving the triggering member as actor attribution.
- Group owner can disable a member from adding new records without removing intended historical read access.
- Customer/project fixed fields stay intentionally small; computed finance uses typed numeric data; invoice integration and a real payment provider remain postponed.
- Runtime/data stack remains TypeScript + Hono + PostgreSQL/Drizzle.
- Deployment is three independent Cloudflare Workers:
  - `aftertrace-api`: Hono/API Worker
  - `aftertrace-web`: React/Vite via Workers Static Assets
  - `aftertrace-admin`: React/Vite via Workers Static Assets
- Cloudflare Pages is no longer a deployment target. Do not add Pages config/functions/proxies.
- LINE Reply/content retention follows `docs/WORKLOG_LINE_CONTENT_POLICY.md` exactly:
  - only ordinary group TEXT is temporarily cached in PostgreSQL
  - default TEXT cache TTL is 5 days
  - default TEXT cache cap is 1000 messages per group
  - no Redis for this MVP cache
  - AUDIO/IMAGE/FILE are never locally cached; Reply fetches them directly from LINE by `quotedMessageId`
  - expired/unavailable attachment content must return clear resend UX
  - original attachment binaries are not persisted
  - Reply-created records persist both `line_message_id` and `quoted_line_message_id`

## Completed foundations

### Worklog domain/schema

- Added worklog users/OA friendship, workspace, PRIVATE/GROUP sources, source membership, minimal customers/projects, records, typed transactions, subscription plans/capabilities, subscriptions/history, AI runtime pricing, AI usage/cost snapshots, feedback, anomalies and audit models.
- Added stable group owner/binding metadata and member `recording_enabled` state.
- Added race-safe AI quota balance/reservation model so provider calls can reserve conservatively, commit actual usage, or release on failure.
- Worklog migrations are hand-authored/journaled and still require real PostgreSQL validation before production.

### Bootstrap / ownership

- Added `WorklogBootstrapService` + Drizzle repository for LINE user upsert/touch, OA follow/unfollow, stable personal source creation/reuse, group presence, leave/inactivation and owner binding.
- Added `worklog_pending_groups` / `worklog_pending_group_members` so an unowned group stays pending instead of receiving a guessed owner/workspace.
- Reliable owner evidence or explicit `@AFTERTRACE 啟用` promotes pending group state under the actual owner's workspace.
- A second user cannot overwrite an already-bound owner.

### Record read/write boundaries

- Added scoped worklog record read service:
  - personal read requires active OA friendship and exact private source
  - group read requires exact active source membership
  - personal/group surfaces are discovered separately
- Added `WorklogRecordWriteService` + Drizzle repository for raw TEXT persistence before optional AI normalization.
- LINE `line_message_id` is used for deterministic raw-TEXT idempotency; mismatched same-id writes return an idempotency conflict instead of overwriting.
- Added a second read for the PostgreSQL READ COMMITTED / `ON CONFLICT DO NOTHING` concurrent-winner visibility race.

### Group LINE runtime cutover

- Added `WorklogLineRuntime` before the legacy conversation/Energy/Memory path.
- Group `@AFTERTRACE <text>` performs bootstrap -> permission/entitlement -> raw record persistence -> post-persistence normalization attempt -> LINE reply.
- Group `@AFTERTRACE 查詢` uses the existing one-time Web entry and re-verifies LINE group membership during exchange.
- Group Reply worklog commands are intercepted so unfinished quoted-content handling cannot fall through into legacy Memory.
- Group record/query/owner-claim diagnostics are tracked separately from legacy counters.

### OA/private runtime cutover

- Added a separate OA parser stream for FOLLOW, UNFOLLOW and one-to-one messages so group/OA events cannot be double-processed.
- Added `WorklogOaRuntime`:
  - ordinary private OA text remains human support
  - explicit `@AFTERTRACE <text>` writes personal raw TEXT and then attempts post-persistence normalization
  - `@AFTERTRACE 查詢` resolves exact personal user/source target
  - `@AFTERTRACE 啟用` is rejected in private chat
  - quoted media is intercepted pending direct LINE content-fetch implementation
- Wired OA events into `/webhooks/line`.
- A LINE reply-delivery failure after successful DB persistence no longer turns a successful record into a rejected write or reuses the reply token.

### LINE Reply/content policy

- Added `docs/WORKLOG_LINE_CONTENT_POLICY.md`.
- Only ordinary group TEXT may enter the temporary PostgreSQL Reply cache.
- AUDIO/IMAGE/FILE never enter a local cache; future Reply handling must call LINE content API directly.
- Original attachment binaries are discarded after extraction/transcription/understanding; durable worklog content is textual/structured plus trace ids.

### Three-Worker deployment cutover

- Added Workers Static Assets configs for `aftertrace-web` and `aftertrace-admin` with SPA fallback.
- Added independent Web/Admin deployment scripts.
- Kept API deploy independent.
- Deleted obsolete Pages deployment helper and Pages-only Admin Functions proxy.
- Web/Admin require an explicit API origin; Admin does not silently treat its own static origin as the API.
- See `docs/WORKLOG_DEPLOYMENT.md` for production cutover requirements.

## 2026-09-02 previous batch: secure OA private Web entry/auth

Starting branch HEAD for that batch was `35bdf019b7957a561a4fc093b70c752ad99953ba`.

- Added `PRIVATE_WEB_ENTRY` claims separate from group `WEB_ENTRY` and identity `WEB_SESSION`.
- Added `worklog_private_web_entry_nonces` and migration `0005_worklog_private_web_entry.sql`.
- Private entry creation/consumption checks exact LINE user, current OA friendship, exact ACTIVE PRIVATE source and ownership.
- PRIVATE exchange never calls LINE group membership APIs and never invents a group id.
- `/api/v1/auth/entry/exchange` returns explicit GROUP vs PRIVATE entry context.
- OA `@AFTERTRACE 查詢` is wired to the real private one-time URL.
- Web bootstrap preserves PRIVATE entry state separately and does not fall into legacy group Memory UI.
- Token/WebAuthService tests were authored for private type isolation, one-time binding and revoked access.

That batch finished at `e344045ad23ea5c423a4d50ee5c0996548d7bb9e` after its progress update.

## 2026-09-02 latest batch: post-persistence TEXT AI normalization

Starting branch HEAD for this batch was `e344045ad23ea5c423a4d50ee5c0996548d7bb9e`.

Implemented the highest-priority TEXT normalization path while keeping raw LINE input as the source of truth:

1. **Durable normalization state machine**
   - Added `worklog_record_ai_normalizations` plus hand-authored/journaled migration `0006_worklog_text_normalization.sql`.
   - Registered its Drizzle schema in runtime exports and Drizzle Kit config.
   - State is one row per worklog record with `PENDING`, `PROCESSING`, `PROVIDER_SUCCEEDED`, `USAGE_COMMITTED`, `SUCCEEDED`, `FAILED`.
   - A unique claim token prevents concurrent redelivery from owning the same normalization attempt.
   - Provider output and the exact pending AI-usage commit snapshot are persisted before quota settlement, so a worker interruption can resume without a second provider call.

2. **DB-backed model/pricing source**
   - New normalization repository reads only the singleton `worklog_ai_runtime_config` row for active provider/model/input-output pricing/media pricing/FX.
   - Worklog normalization does not use the old scattered Gemini model/pricing env values as its economics source.
   - Missing DB runtime config defers normalization and leaves raw records intact.

3. **Charging identity and conservative reservation**
   - Normalization derives its context from the durable record/source:
     - GROUP charges `subscription_owner_user_id`, falling back to the stable owner binding while preserving the record author as actor.
     - PRIVATE charges the private user and preserves that user as actor.
   - TEXT reservation uses a conservative token-equivalent upper bound: UTF-8 bytes of the full structured Gemini request plus configured maximum output tokens.
   - Actual TEXT AI units are provider-reported input + output tokens; provider-reported usage is rejected if it exceeds the conservative reservation.

4. **Grounded structured Gemini normalizer**
   - Added a dedicated Worklog Gemini path rather than reusing legacy Memory semantics.
   - Output is restricted to:
     - concise grounded summary
     - broad category (`NOTE`, `WORK`, `ISSUE`, `PAYMENT`, `EXPENSE`, `MATERIAL`, `OTHER`)
     - optional explicit customer hint
     - optional explicit project hint
   - JSON schema + Zod validation rejects malformed output.
   - Prompt explicitly forbids inventing customers/projects/amounts/status/dates/actions.
   - Provider token usage is required and bounded before it can be billed.

5. **Quota/cost settlement**
   - Reuses `WorklogSubscriptionService` atomic reservation/commit/release logic.
   - Successful usage event retains actor, charged user, workspace/source/record, provider/model, input/output tokens, pricing snapshot, optional FX and computed provider cost.
   - `normalized_summary` and category are written only after provider success and quota commit.
   - Customer/project hints remain in the durable normalization result state for later deterministic resolver work; they are not guessed into foreign keys.

6. **Redelivery/idempotency recovery**
   - Raw LINE `CREATED` and exact `ALREADY_RECORDED` outcomes both ask the normalization state machine to make progress.
   - `SUCCEEDED` is a no-op; `PROCESSING` never launches a second provider call.
   - If provider output was saved but quota settlement was interrupted, redelivery retries the same reservation/usage snapshot.
   - If quota was already COMMITTED but normalization state advancement was interrupted, reservation status is read back and the stored result is applied without charging again.
   - If the provider attempt itself is uncertain/failed, the reservation is released and normalization becomes terminal `FAILED`; automatic LINE redelivery intentionally does not call the provider again.

7. **Raw-record success remains independent from AI**
   - Group and OA runtimes invoke normalization only after raw persistence.
   - Normalization exceptions are logged but do not change a successful LINE record into a failed write.
   - No AI runtime config, no subscription, exhausted quota, invalid config, provider failure or parse failure can erase the raw record.

8. **Tests authored**
   - Added service tests covering successful owner-charged settlement, quota deferral without provider execution, provider failure/release, recovery after quota was already committed, and completed-normalization no-op behavior.

Code HEAD immediately before this progress-document update was `73703d1ba5279a315a9a3ce84f93b1d9e145820b`.

## Validation performed in latest batch

- Read all four durable docs before editing and confirmed starting HEAD `e344045ad23ea5c423a4d50ee5c0996548d7bb9e`.
- Inspected raw record write/idempotency code, group/OA runtimes, collaboration charging context, subscription reservation/commit SQL, existing Gemini structured-output implementation, AI cost helpers and the worklog AI runtime schema before designing the new path.
- Statically checked these invariants:
  - raw TEXT is inserted before any AI work
  - missing DB AI config or unavailable quota cannot delete/reject the raw record
  - GROUP actor and charged owner stay distinct through reservation/usage events
  - PRIVATE charges the personal user
  - only one normalization state row exists per record
  - a duplicate LINE delivery cannot start another provider call while state is PROCESSING/SUCCEEDED/FAILED
  - PROVIDER_SUCCEEDED and USAGE_COMMITTED are resumable without a second provider call
  - normalized fields are applied only after quota is known committed
  - AI usage retains immutable provider/model/pricing/cost snapshot
  - no legacy Memory classifier or Energy ledger is used for the new Worklog normalization semantics
- Added the status CHECK constraint to both migration and Drizzle schema to avoid intentionally creating schema drift.
- Attempted a direct branch checkout for `pnpm` verification, but the execution container still cannot resolve `github.com`; no local checkout was available.
- **No build/typecheck/lint/test/migration execution was possible in this connector-only run.** Tests were authored but must not be treated as passing until run in a real checkout/CI environment.

## Known cautions / blockers before production

- Run at minimum before real DB deployment:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm db:schema:check`
  - all worklog migrations on a disposable Neon branch/database
- Specifically validate migrations `0005_worklog_private_web_entry.sql` and `0006_worklog_text_normalization.sql`, including normalization claim races and quota-settlement recovery, against real PostgreSQL.
- Drizzle snapshot metadata for hand-authored worklog migrations has not been regenerated; journal/schema registration is present, but schema drift must be checked before production.
- Worklog TEXT AI normalization requires:
  - a valid singleton `worklog_ai_runtime_config` DB row
  - `GEMINI_API_KEY`
  - an active subscription/quota balance for the charged user
  If any are absent, raw records still succeed and normalization remains deferred.
- A provider-attempt failure/uncertainty is intentionally terminal for automatic redelivery to avoid accidental duplicate provider billing. An explicit/admin retry flow for `FAILED` normalization has not been built yet.
- Post-persistence normalization is currently awaited inside the LINE webhook runtime. Raw durability is protected, but production latency should be measured; consider moving the already-idempotent normalization call behind `executionCtx.waitUntil` once end-to-end behavior is verified so AI latency cannot delay LINE replies.
- The 5-day / 1000-message PostgreSQL Reply-to-TEXT cache is documented but not implemented yet.
- Reply AUDIO/IMAGE/FILE is intercepted but direct LINE content fetch + extraction/transcription persistence is not implemented yet.
- The private Web entry is secure and end-to-end, but the Web personal page is intentionally only a separated placeholder until actual worklog PWA record APIs/UI are exposed; do not route it to legacy Memory data as a shortcut.
- Generic Web LINE-login/group UI and legacy Energy/Memory management still exist temporarily. Remove old product paths only after new worklog equivalents are end-to-end.
- Admin still uses the interim legacy Cloudflare Access verifier while the product contract calls for a simple configured username/password MVP boundary; do not remove protection until the replacement exists.
- Before Workers production cutover, independently validate Web/Admin builds, SPA deep links, API origin/CORS and custom-domain configuration.

## Next prioritized implementation batch

1. Implement PostgreSQL Reply-to-TEXT cache:
   - only ordinary group TEXT enters cache
   - exact group/source isolation
   - 5-day TTL
   - max 1000 per group with deterministic oldest-first pruning
   - Reply resolves `quotedMessageId`, persists both command and quoted ids
   - expired cache row => clear resend/re-enter UX
   - no Redis and no AUDIO/IMAGE/FILE rows
   - ordinary cached text must never trigger AI normalization until explicit Reply + `@AFTERTRACE`
2. Implement quoted AUDIO/IMAGE/FILE ingestion:
   - direct LINE content API by `quotedMessageId`
   - no attachment cache
   - permission/quota preflight before expensive work where possible
   - extract/transcribe/understand enough durable textual content
   - persist safe metadata/text/summary + both LINE ids, never binary
   - unavailable/expired LINE content => clear resend UX
   - handle unsupported/oversized files and partial failures deterministically
3. Expose actual worklog PWA APIs using the scoped record-read layer:
   - PRIVATE and GROUP surfaces remain distinct
   - private entry page starts showing actual personal worklog records
   - group UI migrates away from legacy Memory search/management
   - users with both scopes can navigate clearly separated personal/group sections
4. Add owner PWA group usage/member recording-permission APIs/UI.
5. Repurpose internal Admin for worklog users/groups/plans/AI pricing/anomalies/feedback and replace interim Access-only auth with configured username/password.
6. Add OA Rich Menu setup and payment-provider-neutral subscription UI/backend boundary.
7. Add explicit/admin retry/inspection for terminal `FAILED` normalization and move provider work off the LINE reply critical path if latency measurements warrant it.
8. After new worklog runtime/PWA/Admin paths are proven end-to-end, delete obsolete Energy/Memory/commerce/reminder/proactive product code while retaining genuinely reusable utilities.

## Bug-audit phase checklist

After core MVP flow exists, repeatedly audit:
- duplicate LINE delivery/idempotency and concurrent redelivery
- TEXT normalization claim races, stuck PROCESSING states and provider-success/quota-success recovery
- provider output persisted but quota commit interrupted; quota committed but record apply interrupted
- normalization reservation leaks, stale reservations and actor/charged-user swaps
- normalization FAILED retry policy and accidental second provider calls
- PRIVATE token accidentally gaining GROUP scope or vice versa
- nonce replay/expiry and OA unfollow between URL creation/exchange/use
- private source replacement/inactivation and stale client entry context
- cross-group/personal record leakage
- only TEXT entering temporary cache
- 5-day TTL and 1000-message pruning correctness
- Reply-to-TEXT expiry and cross-group lookup isolation
- attachment expiry/wrong type/content API failures; no binary leakage to DB/logs
- group pending->promoted races, leave/rejoin and owner-binding ambiguity
- recording-disabled member writes/AI consumption while historical read remains intact
- actor/charged-user swaps, quota overspend/reservation leaks/double commit/release
- subscription period/downgrade/allowance edit edge cases
- OA support text accidentally entering AI/worklog paths
- personal/group Web surface separation and stale session/client state
- historical AI price snapshots and usage counters
- Workers Static Assets SPA fallback, API origin/CORS and deployment isolation
- migration/bootstrap reproducibility on a clean disposable DB
