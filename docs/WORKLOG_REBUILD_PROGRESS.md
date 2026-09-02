# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for continued development on branch `revive/line-worklog`.

Every development run must:
1. Read this file, `docs/WORKLOG_PRODUCT_SPEC.md`, `docs/WORKLOG_LINE_CONTENT_POLICY.md`, and `docs/WORKLOG_DEPLOYMENT.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to bug audit, edge cases, data consistency, LINE webhook behavior, error recovery, PWA UX, admin UX, deployment isolation, and tests.

## Baseline / product rules

- Branch was revived from the last full LINE-first assistant state before the sports-availability rebuild.
- Reuse LINE webhook signature verification, quotedMessageId/content fetch, reply/push clients, group identity, Web entry/auth utilities, PostgreSQL/Drizzle, React/Vite web/admin apps and existing tests.
- Do not merge sports/radar product behavior from newer `main` unless a generic utility is clearly reusable.
- `@AFTERTRACE <text>` records; Reply AUDIO/IMAGE/FILE + `@AFTERTRACE` records quoted content; `@AFTERTRACE 查詢` opens scoped Web/PWA without LIFF.
- `@AFTERTRACE 啟用` is the MVP explicit group-owner claim path when no reliable add-actor evidence exists; it must never transfer an already-bound group to a different user.
- Ordinary OA private text without `@AFTERTRACE` is human support traffic.
- OA friends have personal records; group records are source-scoped; users with both see separate personal/group surfaces.
- FREE is personal-only. Plans (`FREE`, `SUB1`, `SUB2`, future codes), price, capability flags and bounded AI allowance are operator-configurable.
- AI provider/model/input-output-media prices are DB/admin editable; historical usage stores immutable model/pricing/cost snapshots.
- Group owner is only a reliably identified add/bind actor or explicit claimant; never guess ownership from the first/random speaker.
- Group AI usage is charged to owner while preserving triggering member as actor attribution.
- Owner can disable each non-owner member from **adding** records; this must not silently remove historical group-read access.
- Owner/admin usage views need quota/used/reserved/remaining, group/member AI attribution, and TEXT/AUDIO/IMAGE/FILE counts.
- Keep customer/project shape minimal; computed finance uses typed numeric data; invoice/Amego and real payment provider integration remain postponed.
- Runtime/data stack remains TypeScript + Hono + PostgreSQL/Drizzle.
- Deployment is now **three independent Cloudflare Workers**:
  - `aftertrace-api`: Hono/API Worker
  - `aftertrace-web`: React/Vite via Workers Static Assets
  - `aftertrace-admin`: React/Vite via Workers Static Assets
- Cloudflare Pages is no longer a deployment target. Do not add new Pages config/functions/proxies. See `docs/WORKLOG_DEPLOYMENT.md`.
- `docs/WORKLOG_LINE_CONTENT_POLICY.md` is the durable LINE Reply/content-retention contract: only ordinary group TEXT is temporarily cached in PostgreSQL, with MVP defaults of **5 days / 1000 messages per group**; AUDIO/IMAGE/FILE are never locally cached and are fetched directly from LINE when the user Replies. Do not add Redis for this cache.

## Completed foundations

### Product contract / command parsing

- Added `docs/WORKLOG_PRODUCT_SPEC.md` as the durable product contract.
- Added `apps/api/src/worklog/command.ts` and tests for query, text record, Reply record and ordinary-chat ignore behavior.
- Added explicit `CLAIM_GROUP` parsing for `@AFTERTRACE 啟用` / 認領 / 綁定 aliases so pending groups can be claimed deliberately instead of inferring ownership from a random speaker.

### Worklog schema / migration foundation

- Added isolated worklog data models/migrations for LINE/OA users, workspace, private/group sources and members, customer/project, records, typed transactions, plans/capabilities/AI allowance, subscription/history, AI runtime pricing, AI usage, feedback, anomalies and audit.
- Added entitlement tests including invariant that FREE can never gain group collaboration from malformed capability JSON.
- Added immutable AI pricing/cost snapshot helpers/tests.
- Worklog migrations `0001` through `0004` remain hand-authored/journaled; snapshot metadata has not been regenerated.

### Scoped record-read layer

- Added `WorklogRecordReadService` + Drizzle repository.
- Personal records require OA friendship and exact private source.
- Group reads require exact active membership before record query.
- PWA surface discovery keeps personal/group surfaces separate.

### Group ownership / permissions / usage / quota

- GROUP source has stable owner identity/binding metadata.
- Source members have `recording_enabled` plus updater/time metadata.
- AI usage identity is split into `actor_user_id` and `charged_user_id`.
- Added `WorklogCollaborationService` + Drizzle repository for active membership, recording-disabled checks, FREE/group entitlement, owner quota preflight, owner-only permission changes and write-once owner binding.
- Added `WorklogUsageService` + Drizzle repository for user/owner quota summaries, reserved units, provider cost, TEXT/AUDIO/IMAGE/FILE counts, group burn and per-member actor attribution.
- Added subscription domain/repository with active-plan evaluation, calendar-month period calculation, manual/admin plan assignment/history/audit and group activation checks.
- Added period-scoped `worklog_ai_quota_balances` and `worklog_ai_quota_reservations`.
- Atomic reservation prevents concurrent requests from consuming the same final AI units.
- Provider success commits actual usage + immutable AI event; provider failure releases reservation; stale reservations expire.
- Actual usage cannot exceed conservative reservation; callers must reserve a safe maximum before AI invocation.

### LINE user/source bootstrap + safe pending groups

- Added `WorklogBootstrapService` and Drizzle repository for LINE user upsert/touch, OA friend state, stable personal workspace/private source, group presence, leave/inactivation and reliable/explicit owner binding.
- Added `worklog_pending_groups` / `worklog_pending_group_members` so unowned groups remain pending instead of receiving a guessed/fake owner/workspace.
- Reliable owner evidence or explicit claim promotes the pending group/members under the real owner's workspace.
- Promotion records `promoted_source_id` / `promoted_at` for idempotency/diagnostics.
- Added migration `0004_worklog_pending_group_bootstrap.sql` and tests for stable private source, pending group behavior, promotion, owner conflict and member rejoin.

### Group TEXT webhook cutover

- Added `WorklogRecordWriteService` and Drizzle repository for raw TEXT persistence before optional AI normalization.
- TEXT records are idempotent by LINE message id; same-id mismatches return an idempotency conflict instead of overwriting.
- Added a second DB read for the PostgreSQL READ COMMITTED / `ON CONFLICT DO NOTHING` concurrent-winner visibility race.
- Added `WorklogLineRuntime` before legacy conversation/Energy/Memory routing.
- `@AFTERTRACE 啟用` binds/promotes a pending group safely.
- `@AFTERTRACE <text>` now performs bootstrap -> permission/entitlement -> raw record persistence -> LINE reply.
- Raw TEXT currently reserves **0 AI units** because AI normalization is intentionally a separate post-persistence step.
- Group `@AFTERTRACE 查詢` creates the existing short-lived group/caller Web entry; exchange re-verifies LINE membership.
- Recording permission gates creation only; disabled members retain intended historical read access.
- Quoted worklog commands are intercepted so unfinished media ingestion cannot fall into legacy Memory.
- Added runtime/write tests for ordinary chat bypass, pending owner, explicit claim, recording-disabled, idempotency, query/read independence and quoted-command interception.

### OA/private parser + runtime + webhook cutover

- Added separate OA parser stream for FOLLOW, UNFOLLOW and one-to-one messages; group and OA parsers ignore the other source type.
- Reused the narrow `@AFTERTRACE` parser in private context.
- Added `bootstrapPrivateInteraction` with OA-friend gating and stable personal source reuse.
- Added `WorklogOaRuntime`:
  - ordinary private OA text remains human support traffic
  - explicit `@AFTERTRACE <text>` writes personal raw TEXT
  - `@AFTERTRACE 查詢` resolves personal source/user target
  - `@AFTERTRACE 啟用` is rejected in private chat
  - quoted media is intercepted pending the content-fetch path
- Wired OA events into `/webhooks/line`; OA-only webhook deliveries are no longer discarded as `NO_WORK`.
- Added OA-specific diagnostics and a private-query URL callback seam `{ lineUserId, sourceId, userId, at }` without inventing a group id.
- Fixed reply-delivery consistency: a LINE reply API failure after successful DB persistence does not turn the record result into a rejection or reuse the same reply token.
- Added tests for OA lifecycle, human-support bypass, personal recording/idempotency, private query target, runtime failures and reply-delivery failure.

### LINE Reply/content retention policy

- Added `docs/WORKLOG_LINE_CONTENT_POLICY.md`.
- Only ordinary **group TEXT** is eligible for temporary local cache: PostgreSQL only, default 5 days, max 1000/group, never AI input/permanent record until explicit Reply + `@AFTERTRACE`.
- AUDIO / IMAGE / FILE are never cached locally. Reply handling uses `quotedMessageId` to call LINE content API directly; unavailable/expired content must produce resend UX.
- Original attachment binaries are discarded after extraction/transcription/understanding; durable records retain textual/structured results plus LINE trace ids.

### 2026-09-02 three-Worker frontend deployment cutover

- Read the newest deployment/product docs and confirmed branch HEAD at the start of this run was `716ae80ea425515876cd3aeeaf50c0b1bc7e44a3`.
- Verified current Cloudflare Workers Static Assets SPA configuration semantics against current Cloudflare documentation before changing deployment config.
- Added `apps/web/wrangler.toml` for Worker `aftertrace-web`:
  - `assets.directory = "./dist"`
  - `assets.not_found_handling = "single-page-application"`
- Added `apps/admin/wrangler.toml` for Worker `aftertrace-admin` with the same SPA/static-assets behavior.
- Added independent `web-worker-deploy.ps1` and `admin-worker-deploy.ps1` helpers:
  - branch/dirty-tree guard
  - frozen-lockfile install
  - package-specific typecheck/lint/test/build
  - explicit HTTPS API origin injected as `VITE_API_BASE_URL`
  - Wrangler deploy against the frontend's own config
  - optional post-deploy URL check
- Kept `worker-deploy.ps1` API-only and removed its Pages assumptions so API/Web/Admin can deploy independently.
- Deleted obsolete `pages-deploy.ps1` rather than carrying a second deployment path.
- Deleted the Pages-only `apps/admin/functions/api/v1/admin/[[path]].ts` proxy. New Admin builds call the configured API Worker origin directly.
- Tightened Admin bootstrap so missing `VITE_API_BASE_URL` renders an explicit configuration error instead of silently calling the static Admin Worker origin as though it hosted API routes.
- Updated `.env.example` to use Web/Admin Worker origins rather than `pages.dev`.
- Expanded `docs/WORKLOG_DEPLOYMENT.md` with the implemented file/script layout, direct API-origin rule and remaining production cutover settings.

## Validation performed in latest pass

- Read `WORKLOG_PRODUCT_SPEC.md`, `WORKLOG_REBUILD_PROGRESS.md`, `WORKLOG_LINE_CONTENT_POLICY.md`, `WORKLOG_DEPLOYMENT.md`, recent commits and relevant deployment/runtime files before editing.
- Confirmed the latest product decision supersedes the old Pages baseline: Web and Admin are separate Workers using Workers Static Assets.
- Checked current Cloudflare documentation for assets-only SPA deployment. The chosen config uses a static assets directory and `not_found_handling = "single-page-application"`, with no unnecessary frontend Worker script.
- Statically reviewed the deployment split for:
  - unique Worker names (`aftertrace-api`, `aftertrace-web`, `aftertrace-admin`)
  - Web/Admin separate `dist` roots
  - SPA deep-link fallback config
  - API secrets remaining outside frontend config
  - explicit Web/Admin API origin
  - no remaining production use of the deleted Pages deploy helper/proxy
  - API deployment remaining independent from frontend deployment
- No package dependency/lockfile changes were required; the deployment helpers reuse the already-installed Wrangler CLI from the API workspace.
- **Build/typecheck/lint/test/deploy were not executed in this connector-only environment.** Do not interpret the authored deployment scripts/config as production-verified until these commands run in a real checkout/CI environment.

## Known cautions / blockers before production

- Before first real DB deployment run at minimum:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm db:schema:check`
  - all worklog migrations on a disposable Neon branch/database
- Verify `0004` pending-group promotion SQL and TEXT insert/idempotency SQL against real PostgreSQL.
- Before frontend Worker production cutover:
  - run both frontend package typecheck/lint/test/build
  - run Wrangler deploy/dry-run against both new configs
  - verify SPA deep links
  - configure actual Worker/custom-domain origins
  - set API `WEB_APP_URL` / `WEB_APP_ORIGIN` and `ADMIN_WEB_ORIGIN`
  - build Web/Admin with the real `VITE_API_BASE_URL`
- Admin still uses the **legacy Cloudflare Access verifier on API routes** while the product contract now calls for a simple configured username/password MVP login. Direct Admin -> API deployment must preserve that interim protection until the planned admin-auth cutover; do not remove auth merely to simplify deployment.
- AI normalization is **not wired yet**. New TEXT records persist raw text with `normalized_summary = NULL` and currently consume no AI quota.
- Reply AUDIO/IMAGE/FILE is intercepted but not persisted yet until the new direct LINE content-fetch/processing path is connected.
- Personal `@AFTERTRACE 查詢` resolves a personal source/user target, but the one-time private-user Web entry/token exchange is not wired yet; do not fake a group id.
- The 5-day / 1000-message PostgreSQL TEXT cache policy is documented but not implemented yet.
- Ordinary non-`@AFTERTRACE` group chat still flows through legacy conversation runtime temporarily. Remove it only after the new MVP runtime is proven end-to-end.

## Next prioritized implementation batch

1. Add a **private-user Web entry/auth path** for OA `@AFTERTRACE 查詢`:
   - no fake group id
   - bind one-time nonce/token to LINE user + exact personal source
   - verify active OA friendship + exact private-source ownership before issuing Web session
   - wire URL creator into the existing OA webhook callback
   - make frontend entry exchange distinguish PRIVATE vs GROUP and preserve separate surfaces
2. Add AI-assisted TEXT normalization as a **post-persistence** step:
   - narrow summary/category/customer/project hints only
   - load DB-backed active model/pricing
   - reserve conservative AI units atomically for charged user
   - call provider
   - commit immutable usage/pricing snapshots
   - update normalized fields only on provider success
   - release reservation and retain raw record on every failure
   - make normalization retry/idempotency explicit
3. Implement PostgreSQL Reply-to-TEXT cache:
   - only ordinary group TEXT enters cache
   - key by LINE message id + exact group/source identity
   - 5-day TTL / 1000 per-group cap / deterministic oldest-first pruning
   - Reply-to-TEXT resolves `quotedMessageId`, persists command + quoted ids
   - cross-group lookup impossible
   - no Redis and no AUDIO/IMAGE/FILE rows
4. Reuse existing LINE content fetch for quoted AUDIO/IMAGE/FILE:
   - direct `quotedMessageId` fetch only; no attachment cache
   - resolve content type safely
   - persist extracted/transcribed text + safe metadata/source references, never binaries
   - clear resend UX for expired content
   - permission/quota checks before expensive fetch/provider work where possible
5. Expose actual worklog PWA APIs using the scoped record-read layer. Keep personal/group surfaces separate and do not expose legacy Memory search as the new worklog record UI.
6. Add Owner PWA usage/member-permission APIs/UI.
7. Repurpose internal admin to worklog data and replace legacy Cloudflare Access-only auth with the agreed simple configured username/password boundary.
8. Add OA Rich Menu setup plus payment-provider-neutral subscription UI/backend boundary.
9. After end-to-end worklog runtime is proven, delete legacy Energy/Memory/commerce/reminder/proactive product code while retaining genuinely reusable utilities/tests.

## Bug-audit phase checklist

After core MVP flow exists, repeatedly audit:
- duplicate LINE delivery/idempotency, including concurrent redelivery snapshot behavior
- only TEXT entering temporary cache; no AUDIO/IMAGE/FILE cache rows/binaries
- 5-day TTL and 1000-message cap pruning correctness
- Reply-to-TEXT expiry and cross-group isolation
- quoted attachment expiry/wrong content type/content API errors
- group leave/rejoin and pending -> promoted race
- owner binding ambiguity/reassignment/transfer edge cases
- blocked member still writing/consuming AI while retaining intended read access
- actor/charged identity swap or wrong-owner charge
- quota reservation overspend/leak/double commit/release/cycle-boundary behavior
- plan downgrade/allowance edits vs snapshotted active period
- OA friend/unfriend drift and ordinary support messages accidentally routed to AI
- mixed-source webhook double processing
- private Web-entry token accidentally gaining group scope or vice versa
- cross-group/personal scope leakage and FREE collaboration leakage
- historical AI price snapshots, counters and member usage attribution drift
- concurrent edits/audit, AI fallback, transaction duplication, feedback attribution, anomaly noise
- LINE reply failure after persistence causing duplicate write or false rejection
- PWA mobile/desktop usability and admin filtering/sorting
- migration/bootstrap reliability
- Worker deployment isolation, SPA deep links, wrong API origin, CORS drift and accidental frontend secret exposure
