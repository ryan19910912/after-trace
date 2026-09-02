# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

The user wants large functionality batches. Concentrated local install/typecheck/test/migration/schema/browser/Worker verification is intentionally deferred until the major MVP paths and final static bug audit are complete. Keep authoring tests and doing source-level consistency review, but never claim unexecuted verification passed. Do not use GitHub Actions unless the user explicitly asks for it.

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

## Completed runtime / product paths

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

## Attachment/media ingestion

- Direct LINE content fetch for quoted IMAGE/AUDIO/FILE; media/file never enters the TEXT cache and binaries never persist.
- IMAGE multimodal analysis, AUDIO transcription/summary, PDF multimodal extraction, and text/JSON/XML/CSV/Markdown text input.
- DOCX/XLSX/unknown binary ask for PDF/text rather than pretending to parse.
- Group media charges Owner; OA private media charges personal user.
- Durable flow: claim -> fetch -> runtime pricing -> quota reserve -> Gemini -> durable record/state -> quota commit -> success.
- `persistRecordCreated` atomically inserts/resolves the Worklog record and advances attachment ingestion to `RECORD_CREATED` with reservation token + immutable usage snapshot.
- After Gemini returns, uncertain DB persistence does not release quota or replay Gemini. Recovery re-reads durable state and retries only DB persistence with the already-produced provider output.
- `RECORD_CREATED` redelivery settles existing quota usage without another provider call. `SUCCEEDED` is immutable.
- Stale provider-uncertain `PROCESSING` terminalizes rather than automatically replaying Gemini.
- Attachment retry classification exists:
  - `SAFE_RETRY`: known pre-provider failure only.
  - `RESEND_REQUIRED`: expired/empty/oversize/unsupported content.
  - `MANUAL_REVIEW`: provider/DB/settlement uncertainty or unknown error; never automatic replay.
- Admin anomaly UI shows the operator disposition/guidance and warns against replaying uncertain provider attempts.
- Focused retry-policy and attachment persistence/recovery tests are authored; not executed yet.

## Worklog PWA API/UI

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

Record list supports server-side q/type/category/customer/project/from/to filters plus bounded limit/offset pagination with `hasMore` / `nextOffset`, source authorization and LINE source timestamp ordering.

Workspace rules:
- CRM/project/finance requires the caller's owned personal workspace; group membership alone never exposes another Owner's management surface.
- Customer/project/record/transaction links are same-workspace validated.
- If a project belongs to a customer, that project's customer is authoritative for linked record/transaction writes.
- Referenced customer/project cannot be deleted.
- Record editing changes normalized summary/category/customer/project only; raw LINE input stays immutable.
- Transactions are typed `RECEIVED` / `EXPENSE` / `RECEIVABLE` with exact TWD amount, occurred time and optional links.
- Mutations are audited.
- PWA feedback stores sanitized diagnostic context only, never raw work records.

PWA UI already has personal/group source switching, server-backed filtering + Load More pagination, quota/usage, group-owner member controls, record organization, customer/project management, typed finance, feedback, help and subscription surfaces.

## Subscription / entitlement / quota hardening

- Dedicated `/api/v1/subscription` boundary mounted in API Worker.
- Enabled plan catalog exposed to authenticated PWA users.
- Durable provider-neutral, idempotent checkout intents.
- Payment provider remains intentionally disabled; UI does not fake activation.
- GROUP authorization requires active membership, bound Owner, enabled non-FREE plan, temporal subscription validity and `groupCollaboration=true`.
- Owner disabling future recording does not erase historical read access.
- Stale persisted `status='ACTIVE'` past `current_period_end` no longer grants GROUP access.
- No-active-cycle usage views no longer present lifetime AI usage as current FREE-cycle usage; current-cycle AI counters/cost become zero while historical record counts remain visible.
- `0012_worklog_quota_cycle_snapshot.sql` now protects `worklog_ai_quota_balances.allowance_units` as an immutable billing-cycle snapshot. Plan-template edits or same-period reassignment cannot silently rewrite an existing cycle's allowance.
- Future explicit quota adjustments must use a dedicated audited override path rather than implicit plan assignment.

## Customer / project / finance consistency hardening

- Record and transaction writes canonicalize customer from a selected project's fixed customer.
- Static audit found a stale-link edge: changing an existing project's customer A -> B could leave already-linked records/transactions at customer A.
- `0013_worklog_project_customer_consistency.sql` now synchronizes existing project-linked records/transactions when a project is reassigned to a non-null customer, preventing contradictory customer/project combinations.
- Removing a project's customer does not erase independently useful customer links from existing records/transactions; a project with no customer permits independent customer association per product rules.

## Worklog Admin

- Username/password + HMAC bearer session; no Cloudflare Access JWT dependency.
- Overview, Users, User detail, Groups, Group detail, Plans, AI pricing/runtime, Feedback, Anomalies and Audit.
- Manual plan assignment is audited.
- FREE `groupCollaboration` forced off.
- Historical AI usage retains immutable provider/model/pricing snapshots.
- Attachment failure rows expose operator retry guidance.
- Plan page explains billing-cycle quota snapshot semantics.
- Admin detail now computes an effective subscription state instead of blindly trusting persisted `ACTIVE`:
  - `NO_SUBSCRIPTION`
  - persisted inactive states such as `PAST_DUE` / `CANCELED`
  - `PLAN_DISABLED`
  - `NOT_YET_EFFECTIVE`
  - `PERIOD_NOT_STARTED`
  - `PERIOD_EXPIRED`
  - `ACTIVE`
- Focused Admin effective-state tests are authored, including disabled-plan and stale-period cases; not executed yet.

## Migrations / deployment boundary

Journaled migrations now run through:
- `0011_worklog_active_web_auth.sql`
- `0012_worklog_quota_cycle_snapshot.sql`
- `0013_worklog_project_customer_consistency.sql`

The destructive legacy cleanup is deliberately outside the journal and has been renamed to:
- `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql`

This avoids ambiguity with journaled `0012`/`0013`. Run `post-cutover/9000` only after the Worklog-only API Worker is deployed and smoke-healthy.

`docs/WORKLOG_DEPLOYMENT.md` has been updated to the `0000`–`0013` + post-cutover `9000` sequence.

## Latest static validation / audit

- Re-read latest branch and durable Worklog docs.
- Re-checked Worklog subscription repository same-period conflict behavior; closed implicit allowance mutation at DB level with `0012`.
- Re-checked Admin subscription presentation; added temporal + plan-enabled effective state instead of stale persisted-status presentation on detail surfaces.
- Re-checked Worklog workspace-management customer/project/finance flows; found and closed project-customer reassignment drift with `0013`.
- Re-checked Web auth group exchange: GROUP token exchange revalidates current LINE membership before nonce consumption; subsequent PWA GROUP reads independently re-check Worklog membership + current paid entitlement.
- Re-checked TEXT record idempotency: mismatched replay identity produces `IDEMPOTENCY_CONFLICT` rather than silently treating a different record as the same command.
- `packages/shared` remains intentionally undeleted because it is still represented as a workspace/lockfile importer; remove/regenerate together during the concentrated local frozen-install pass rather than risk lockfile drift blindly.
- Tests authored/updated in this and previous batches are **not executed**.
- No concentrated local typecheck/test/schema/migration/browser/Worker suite was run, per user direction.
- **GitHub Actions were not run, dispatched, rerun, enabled or otherwise triggered in this batch.**

## Verification still intentionally pending

- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- journaled migrations `0000`–`0013` on disposable PostgreSQL/Neon
- post-cutover `9000_worklog_legacy_cleanup.sql` on disposable PostgreSQL/Neon
- real LINE Reply media E2E
- real Gemini image/audio/PDF calls
- PWA CRUD/filter/pagination/subscription browser smoke
- Admin login/plan/runtime/manual-subscription/anomaly browser smoke
- Web/Admin/API Workers build/deploy smoke

Tests are authored but are **not claimed passing**.

## Known remaining risks / debt

1. Payment provider is not connected. Checkout intent is durable but cannot charge/activate a plan yet. This is an external/provider decision, not a blocker for finishing the provider-neutral MVP code boundary.
2. Attachment Admin intentionally has no one-click provider replay. A safe retry action should only be added if durable state proves the provider was never called; uncertain states remain resend/manual review.
3. If provider succeeds and DB remains unavailable through both atomic persistence attempts, ingestion remains `IN_PROGRESS`; stale processing later terminalizes rather than replaying Gemini. This favors avoiding duplicate provider cost.
4. `packages/shared` still contains retired Memory/Credit constants and remains in `pnpm-lock.yaml`; remove/regenerate together during concentrated local/frozen-install verification.
5. Some old non-Worklog docs/config references may remain outside the core Worklog docs/README and need one final repository sweep.
6. Record filter/pagination invalid-input handling deserves one last API review; current bounds prevent unbounded reads, but some malformed pagination values may fall back rather than return explicit 400.
7. Admin list rows still expose persisted subscription fields; detail surfaces now compute effective state. Decide during final static audit whether list-level effective-state columns are worth the extra API/query work for MVP.
8. Group display name remains generic because Worklog persists LINE group id but not durable group summary metadata. This is cosmetic/non-blocking for MVP.
9. Dedicated executable compile/test/migration/schema/browser/runtime validation is still pending by explicit user request.

## Latest branch changes in this batch

- `a3f9406f0df7dcf28d9849df5262dd6f1a0194b7` — add DB-level active quota-cycle snapshot protection (`0012`).
- `0d8b81a8a78de37e18229a3232b5fd2dc436a993` — surface effective subscription state in Admin detail.
- `68a510eec8c5a98e83280515e6d055ec9be58fc9` — add effective-state tests.
- `ae84e9c4f713441cf8a0be8a2fbfccc964fba7b0` — include disabled plans in effective-state semantics.
- `6ed14ceb82d664707702f07885e84414f54fed0e` — add disabled-plan tests.
- `b35314ad98617522714f04a0a8003e216a7e7b87` — add DB-level project/customer reassignment consistency (`0013`).
- `b453f6500e5d0d645372a53a2844194d6cb8a8b8` — rename destructive post-cutover cleanup to `9000`.
- `8f171d733db2dc94f0cb38290f6980ad2fddb73d` — align deployment documentation through journaled `0013` + post-cutover `9000`.
- `bda796a578f1fcc0bdbe1075a254bf5108e425d9` — require completion/readiness/remaining-work estimates in every future handoff.

## Current planning estimate

These are planning estimates, not verification results:

- MVP feature implementation: **about 96%**.
- Production readiness including deferred executable validation: **about 86–88%**.
- Remaining code/static-audit work before concentrated local validation: **about 1–2 large batches**.
- Expected work to reach concentrated local validation: roughly **2–4 focused development hours** at the current batch size.
- After the first concentrated local validation, reserve roughly **1–3 bug-fix batches** (often about **2–6 focused hours**, highly dependent on actual compile/migration/browser failures).

## Next large batch

1. Final static bug audit: Reply/redelivery idempotency, PRIVATE/GROUP Web auth boundaries, quota settlement races, record filter/pagination malformed-input behavior, immutable raw input and typed-finance edges.
2. Sweep stale docs/config/dead source references. Keep `packages/shared` removal coupled to local lockfile regeneration/frozen-install validation.
3. Decide whether Admin list-level effective subscription state is necessary for MVP; detail-level computed state is already implemented.
4. Keep payment-provider integration disabled until provider requirements are known.
5. Once static audit is clean, move to the user's requested concentrated local install/typecheck/test/migration/schema/browser/Worker smoke phase, including journaled `0000`–`0013` and post-cutover `9000` on disposable PostgreSQL/Neon. Do not substitute GitHub Actions for that phase.
