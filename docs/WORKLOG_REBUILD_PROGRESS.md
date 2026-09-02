# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

The accelerated MVP implementation/static-audit phase is now considered **feature-complete enough to enter the concentrated local validation phase**. Do not interpret this as executable verification: local typecheck/tests/migrations/browser/Worker/LINE/Gemini validation is still intentionally pending. Do not use GitHub Actions unless the user explicitly requests it.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Reply + `@AFTERTRACE` records quoted TEXT/AUDIO/IMAGE/FILE.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- Ordinary OA private text remains human-support traffic unless explicitly triggered.
- Personal/group sources remain isolated.
- FREE is personal-only; group collaboration requires paid entitlement.
- Group AI usage is charged to the stable group Owner; triggering member remains actor.
- Owner may disable future member recording without erasing historical read access.
- Customer/project remains intentionally minimal; finance is typed/deterministic.
- Original LINE input is immutable source-of-truth.
- Three independent Cloudflare Workers: API, Web Static Assets, Admin Static Assets. No Pages.

## LINE content policy implemented

- Only ordinary GROUP TEXT is temporarily cached.
- PostgreSQL only, TTL 5 days, max 1000/group, oldest-first pruning; no Redis.
- AUDIO/IMAGE/FILE are never cached.
- Reply media/file fetches directly from LINE by quoted message id.
- Binary data is in-memory only and never persists.
- Expired/unavailable media asks the user to resend.
- Reply records keep both command `line_message_id` and `quoted_line_message_id`.

## Runtime / product completion

Implemented:
- Worklog users/OA friendship/workspaces/sources/members.
- Stable group Owner binding and explicit activation flow.
- Owner member-recording controls.
- Personal/group record ingestion and read isolation.
- TEXT command and Reply-TEXT persistence/idempotency.
- TEXT Gemini normalization with DB-backed runtime model/pricing and immutable usage snapshots.
- Direct Reply AUDIO/IMAGE/FILE ingestion with no binary persistence.
- Customer CRUD, project CRUD/status/customer association.
- Record organization edits without mutating raw LINE source content.
- Typed `RECEIVED` / `EXPENSE` / `RECEIVABLE` transactions.
- PWA server-side record filtering/pagination and source switcher.
- Owner quota/usage/member usage views.
- Feedback UI/API.
- Provider-neutral subscription plans + checkout-intent boundary.
- Full Worklog Admin: login, overview, users/groups, plans/quota, AI pricing/runtime, feedback, anomalies and audit.
- Worklog-only API runtime; retired Memory/Energy/conversation/reminder runtime removed.
- Three-Worker deployment topology, no Pages, no LIFF.

## Attachment reliability / retry policy

- Durable flow: claim -> LINE fetch -> runtime pricing -> quota reserve -> Gemini -> atomic record/state -> quota commit -> success.
- Record creation and attachment state advance to `RECORD_CREATED` are atomic.
- Provider success followed by uncertain DB persistence never releases quota and never replays Gemini automatically.
- Redelivery from `RECORD_CREATED` settles existing usage without another provider call.
- Stale uncertain `PROCESSING` terminalizes rather than provider replay.
- Admin classification:
  - `SAFE_RETRY`: known pre-provider failure only.
  - `RESEND_REQUIRED`: expired/empty/oversize/unsupported input.
  - `MANUAL_REVIEW`: provider/DB/settlement uncertainty or unknown errors.
- Admin intentionally has no generic one-click provider replay.

## Subscription / quota hardening

- GROUP read/record access rechecks current Owner entitlement, plan enabled state and temporal validity.
- Stale persisted `ACTIVE` after `current_period_end` does not grant group access.
- Expired/no-active-cycle PWA usage no longer displays lifetime AI usage as current FREE-cycle usage.
- `0012_worklog_quota_cycle_snapshot.sql` protects active billing-cycle allowance snapshots from plan-template edits/same-period reassignment.
- Future manual quota changes must be a dedicated audited override path, not implicit plan mutation.
- Admin detail computes effective state (`PLAN_DISABLED`, `NOT_YET_EFFECTIVE`, `PERIOD_NOT_STARTED`, `PERIOD_EXPIRED`, etc.) instead of trusting persisted `ACTIVE`.
- PWA subscription plan listing now uses effective temporal/plan-enabled state as well; expired/disabled plans are not marked current.
- Checkout intent creation is race-safe through `ON CONFLICT (request_key) DO NOTHING` + durable resolve, preserving idempotency conflict detection.

### Quota settlement race fix

Final static audit found an important data-modifying-CTE risk in the original repository: a reservation could be updated to `COMMITTED`/`RELEASED` before a later balance CTE matched zero rows, while the SQL statement itself still succeeded.

Runtime now uses `SafeDrizzleWorklogSubscriptionRepository` for TEXT normalization and attachment ingestion:
- reservation + matching quota-cycle balance are selected and locked together with `FOR UPDATE`;
- only then can COMMIT/RELEASE mutate state;
- COMMIT updates quota balance and inserts the usage event in the same SQL statement;
- RELEASE updates reservation and decrements the locked cycle balance in the same statement;
- concurrent settlement cannot mutate the same reservation/balance between those steps.

The older repository remains as shared assignment/read/reservation implementation, while production AI settlement is routed through the safe wrapper.

## Customer / project / finance consistency

- Record/transaction writes validate same workspace.
- Project-owned customer is authoritative when present.
- `0013_worklog_project_customer_consistency.sql` synchronizes already-linked records/transactions when a project changes from Customer A to a non-null Customer B.
- Removing a project's customer does not erase independently useful existing customer links.
- Referenced customer/project deletion is blocked.
- Finance values are fixed typed numeric/date fields rather than arithmetic in free-form notes.

## Auth / source isolation audit

Static review confirmed:
- GROUP one-time entry revalidates current LINE membership before nonce consumption/session issuance.
- PRIVATE one-time entry validates durable private source/user ownership and revocation state.
- PWA GROUP reads independently recheck Worklog active membership + current paid group entitlement.
- PWA personal scope requires current OA-friend/private source relationship.
- CRM/project/finance remains owner-personal-workspace only; ordinary group membership does not expose another Owner's management domain.
- TEXT idempotency compares source/actor/command LINE id/quoted LINE id/raw content; mismatched replay returns `IDEMPOTENCY_CONFLICT` rather than false duplicate success.

## Repository / migration cleanup

Journaled migrations currently run through:
- `0011_worklog_active_web_auth.sql`
- `0012_worklog_quota_cycle_snapshot.sql`
- `0013_worklog_project_customer_consistency.sql`

Destructive retired-schema cleanup remains explicitly post-cutover:
- `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql`

Run `9000` only after the Worklog-only Worker is deployed and smoke-healthy.

Removed obsolete documentation that directly contradicted the current Worklog architecture:
- old Cloudflare Pages/Access Admin documentation;
- LIFF management documentation;
- old LIFF/Energy production checklist;
- old Memory/Energy rebuild plan/progress;
- Reminder delivery/recovery docs;
- retired retention documentation.

`packages/shared` still contains retired Memory/Credit constants and remains represented in `pnpm-lock.yaml`. Do **not** hand-edit the lockfile. Remove the package and regenerate/validate the workspace together during the concentrated local/frozen-install phase.

## Final static-audit judgement

No remaining known source-level blocker requires another large feature-development batch before local validation.

Non-blocking polish intentionally deferred:
- malformed record `limit`/`offset` values currently fall back to safe bounded defaults rather than always returning HTTP 400; reads remain bounded and authorized;
- Admin list rows still show persisted plan/status fields while detail and customer subscription surfaces expose effective state;
- LINE group display name is not persisted, so generic group identifiers remain in some UI;
- payment provider is intentionally unselected/unconnected; provider-neutral checkout boundary is complete.

These do not justify delaying the first complete executable validation pass.

## Verification status — still NOT executed

The following are intentionally pending and **must not be claimed passing**:
- dependency/frozen install integrity after final workspace cleanup;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm db:schema:check`;
- journaled migrations `0000`–`0013` on disposable PostgreSQL/Neon;
- post-cutover `9000_worklog_legacy_cleanup.sql` on disposable PostgreSQL/Neon;
- LINE TEXT / Reply TEXT / Reply AUDIO/IMAGE/FILE E2E;
- real Gemini text/image/audio/PDF calls and usage snapshots;
- PWA CRUD/filter/pagination/subscription browser smoke;
- Admin login/plan/runtime/manual-subscription/anomaly browser smoke;
- Web/Admin/API Worker build/local/deploy smoke;
- CORS/custom-domain/LINE Login/Rich Menu production configuration.

Tests have been authored throughout the rebuild but are **not claimed passing**.

## Latest batch changes

- `080a0275a630947b1865d06908598e5acc59e41d` — harden PWA effective subscription listing and race-safe checkout idempotency.
- `d8930becf05d55a8f4a7cec019b5e427aa4064e3` — add safe runtime quota-settlement repository.
- `8e48af817ed080a64a15da92a921f6a3d6a813a5` — route TEXT-normalization settlement through the safe repository.
- `3cabc807e427c3049c7150ac8aceb5956a5701d3` — route attachment settlement through the safe repository.
- `f750b5cd97f9b2a1b5864a3b8e8659c37feaa527` — remove obsolete LIFF/Pages/Energy/Memory/Reminder docs (`[skip ci]`).
- `cc6de9692bd12a98e6045f3c6631c435e37ed3f4` — lock reservation + quota balance together during COMMIT/RELEASE (`[skip ci]`).

## GitHub Actions / validation policy

- No GitHub Actions workflow was manually run, dispatched, rerun, enabled or modified in this batch.
- Existing workflow files were left untouched.
- Final cleanup commits use `[skip ci]` where practical to avoid using commits as CI requests.
- Concentrated executable validation remains local/runtime work, not GitHub Actions work.

## Current completion estimate

Planning estimate only, not test results:

- **MVP feature implementation: ~98–99%**.
- **Static source-level architecture/logic audit: ~98% complete**.
- **Production readiness including still-unexecuted validation: ~90%**.

Remaining before calling the branch production-ready:
1. concentrated local dependency/typecheck/test/schema/migration pass;
2. remove retired `packages/shared` + regenerate/verify lockfile as part of that local pass;
3. fix any compile/test/migration failures found;
4. local/browser smoke for PWA/Admin/API Workers;
5. real LINE/Gemini integration smoke;
6. configure actual Cloudflare domains/secrets/CORS and LINE OA Rich Menu/Login/provider settings;
7. payment-provider integration later when a provider is selected (not required to validate the provider-neutral MVP boundary).

## Time / batch estimate

- Additional large feature-development batches before concentrated local validation: **0**.
- The branch is now ready to start the concentrated local validation phase.
- Expected concentrated local validation + straightforward fixes: roughly **1–3 focused bug-fix batches / ~2–6 hours**.
- If migrations/Drizzle/browser integration reveal deeper issues, keep a conservative buffer of **up to ~1 additional day of focused work** before production deployment.

## Next action

Do not add more speculative product functionality. Next, when the user is ready, perform the concentrated local checkout/frozen-install cleanup, remove `packages/shared` with lockfile regeneration, run typecheck/tests/schema/migrations (`0000`–`0013` + disposable post-cutover `9000`), then browser/Worker/LINE/Gemini smoke and fix concrete failures together.
