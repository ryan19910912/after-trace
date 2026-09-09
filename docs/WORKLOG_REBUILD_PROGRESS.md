# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-09 target-only cleanup complete; executable validation in progress

AFTERTRACE is Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the Record/GROUP/AI product surface and remains only as:

- provider-neutral LINE Login;
- the external official LINE OA support contact link.

Accepted V1 feature scope remains **100% source-authored**. Legacy cleanup is complete. Current work is release validation only: canonical Drizzle artifacts, compile/lint/test/build, database smoke and real provider/runtime smoke.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds remain allowed while no real customer data exists.

## Product/commercial contract

- V1 exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No one-time top-up / extra paid tier.
- FREE remains a complete manual product.
- New eligible FREE accounts receive one idempotent Admin-configured `free_initial_ai_trial_points` grant.
- AI entitlement is per requesting user; GROUP only authorizes Source data.
- AI Pro has monthly point/resource cap, provider-cost hard cap, optional per-request cap and capability toggles.
- V1 payment transport is NewebPay / 藍新信用卡定期定額.
- No target GROUP AI funding-owner/responsible-user concept.

## V1 functional scope — source-authored complete

Current branch source-authors provider-neutral Google/LINE/Apple auth, public account id, native groups/invites, manual Record CRUD/search/revisions/delete/restore, Tasks/reminders, notifications/PUSH/Admin announcements, Feedback/Admin workflow, FREE AI trial, AI Pro entitlement/accounting/cost caps, text/image/audio/file/PDF AI, natural-language search, Related Records, summaries, rewrite, AI Task proposal, Record-level AI actions, Chrome Extension V1 capture including screenshot/image AI, NewebPay periodic subscription transport, and target-first Admin surfaces.

## Target-only legacy cleanup — COMPLETE

Removed from active source/schema/test/document surfaces:

- LINE Messaging webhook/runtime and `apps/api/src/line` runtime tree;
- 小跡 command / LINE GROUP bot behavior;
- LINE Reply/cache/edit orchestration;
- LINE attachment quoted-message ingestion runtime/schema;
- bot-entry / LINE GROUP Web-entry nonce schema;
- LINE OA friendship/product identity state;
- LINE GROUP ids as Source identity/authorization;
- Entity/Alias master-data workflow;
- title/entity confirmation workflow;
- legacy Record entity/message-id persistence;
- GROUP AI responsible-user/funding-owner schema/runtime;
- `ONE_TIME` / `TOP_UP` commercial product shape;
- retired LINE/CRM validation notes and obsolete tests;
- final legacy attachment compatibility shim.

Allowed LINE-related code remains provider-neutral LINE Login plus the external OA support link/config only.

## Latest validation batches — 2026-09-09

Earlier release-tooling alignment:

- `2efce4b9` — `[skip ci]` align baseline regeneration success guidance with the current disposable-prelaunch database policy.

Executable validation then started on the user's Windows checkout at `D:\Project\after-trace`.

Actually executed by the user:

- `pnpm install --frozen-lockfile` — **PASS** (`pnpm 10.15.0`, lockfile up to date).
- first `pnpm release:preflight` with local `http://127.0.0.1:8787` API URL — **FAIL** before validation because release preflight correctly requires an absolute HTTPS Worker origin.
- rerun with `VITE_API_BASE_URL=https://after-trace-api-dev.a0955625660.workers.dev` — preflight entered validation and baseline guard **FAIL** because checked-in canonical Drizzle SQL/snapshot were stale legacy artifacts.
- after local baseline regeneration, `pnpm db:baseline:guard` — **PASS**: `AFTERTRACE V1 target baseline + Drizzle metadata guard passed.`
- next `pnpm release:preflight` — baseline guard **PASS**, then TypeScript stage **FAIL** in Admin.

The user did not provide the direct stdout from the baseline regeneration command itself, so record only the executed guard as PASS. The user's regenerated Drizzle files are local until separately committed/pushed; do not assume the GitHub branch currently contains those generated artifacts merely because the local guard passed.

The Admin typecheck surfaced these real stale-integration defects:

1. `AdminAccountsPage.tsx` called removed `api.accounts(...)` instead of target `accountLookup(...)`.
2. announcement specific-user search called removed `api.users(...)` instead of target `accountLookup(...)`.
3. `api.test.ts` imported/tested removed `effectiveSubscriptionState` helper.
4. `commercial-api.test.ts` AI Pro fixture/request omitted current `aiTaskProposal` capability.

Fixed on branch with `[skip ci]` commits:

- `28b3b2ed` — use target Admin account lookup API in account search page.
- `3f7142e0` — use target account lookup for announcement user search.
- `42ffa79e` — remove stale Admin subscription-helper tests rather than restoring removed code.
- `5d8892dc` — align AI Pro Admin test fixture/request with `aiTaskProposal`.

These fixes are **AUTHORED / NOT YET EXECUTED** after the commits. The user must pull/sync them into the executable Windows checkout and rerun typecheck/preflight.

No product feature was added, no retired behavior was restored, GitHub Actions were not used or modified, and `apps/api/verify-admin-schema.mjs` was not touched.

## Canonical Drizzle baseline status

Authoritative target schema remains `apps/api/src/db/schema-all.ts`.

Local Windows checkout status:

- regenerated target baseline guard — **PASS**.

GitHub branch status:

- generated Drizzle artifacts still require explicit synchronization from the user's local checkout unless they have already been committed/pushed separately.
- do not hand-edit generated SQL/snapshot to simulate success.

After the generated artifacts are committed, apply the canonical baseline to a fresh disposable PostgreSQL database and verify clean rebuild.

## Executable verification status

Current known status:

- dependency install — **PASS**.
- canonical baseline guard on user's regenerated local artifacts — **PASS**.
- Admin/monorepo TypeScript typecheck before latest fixes — **FAIL**.
- latest four Admin fixes — **AUTHORED / NOT RUN**.
- ESLint — **NOT RUN** in successful preflight sequence yet.
- Vitest — **NOT RUN** in successful preflight sequence yet.
- Worker/Web/Admin builds — **NOT RUN** in successful preflight sequence yet.
- Drizzle schema export — **NOT RUN** in successful preflight sequence yet.
- clean PostgreSQL rebuild — **NOT RUN**.
- lifecycle/provider-cost concurrency DB smoke — **NOT RUN**.
- NewebPay TEST checkout/callback/renew/cancel — **NOT RUN**.
- Google/LINE/Apple OAuth smoke — **NOT RUN**.
- Gemini provider smoke — **NOT RUN**.
- Chrome unpacked-extension smoke — **NOT RUN**.
- Push/Cron runtime smoke — **NOT RUN**.
- Dev E2E — **NOT RUN**.

No unexecuted item is claimed PASS or RUNTIME VERIFIED.

## Exact next validation plan

1. Preserve/commit the user's locally regenerated `drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and matching journal if modified, using `[skip ci]`; do not include unrelated files.
2. Sync/pull the four Admin validation-fix commits into the Windows checkout without losing the regenerated Drizzle artifacts.
3. Run `pnpm --filter @aftertrace/admin typecheck`.
4. If PASS, run `pnpm typecheck`.
5. Run `pnpm release:preflight` and fix only real lint/test/build/schema-export failures surfaced by execution.
6. Apply canonical baseline to a fresh disposable PostgreSQL database and run focused DB smoke for account lookup, Feedback, Tasks PRIVATE/GROUP authorization, FREE trial/AI Pro Grants, provider-cost concurrency, lifecycle replay/stale cancel and Related ranking.
7. Run NewebPay TEST checkout -> callback retry/idempotency -> renewal -> cancel.
8. Run Google/LINE/Apple + Gemini + Chrome + Push/Cron Dev smoke.
9. Only then consider the branch release-ready.

## Remaining estimate

- Functional feature development: **0 focused hours**.
- Legacy product source/schema/test cleanup: **0 focused hours**.
- Remaining validation/release-readiness depends on actual failures discovered during local execution.

`apps/api/verify-admin-schema.mjs` was not staged or committed.
