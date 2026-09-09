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

- `pnpm install --frozen-lockfile` — **PASS** (`pnpm 10.15.0`).
- first `pnpm release:preflight` with local `http://127.0.0.1:8787` API URL — **FAIL** before validation because release preflight correctly requires an absolute HTTPS Worker origin.
- rerun with `VITE_API_BASE_URL=https://after-trace-api-dev.a0955625660.workers.dev` — preflight entered validation and baseline guard **FAIL** because checked-in canonical Drizzle SQL/snapshot were stale legacy artifacts.
- after local baseline regeneration, `pnpm db:baseline:guard` — **PASS**: `AFTERTRACE V1 target baseline + Drizzle metadata guard passed.`
- next `pnpm release:preflight` — baseline guard **PASS**, then TypeScript stage **FAIL** in Admin.
- after Admin repair commits, `pnpm --filter @aftertrace/admin typecheck` — **PASS**.
- `pnpm --filter @aftertrace/web typecheck` after Web repair commits — **PASS**.
- subsequent monorepo `pnpm typecheck` — Admin **PASS**, Web **PASS**, Extension static check **PASS**, API **FAIL** with a concrete second batch of TypeScript defects.

The user did not provide the direct stdout from the baseline regeneration command itself, so record only the executed guard as PASS. The regenerated baseline SQL/snapshot plus the workspace lockfile were committed locally with `[skip ci]` before rebasing; the local branch remained one commit ahead of `origin/revive/line-worklog`. The post-rebase local SHA was not provided, so do not invent it or claim the generated artifacts are already on GitHub until pushed.

### Admin/Web TypeScript repair batch

Fixed with `[skip ci]` commits and then locally verified by the user:

- `28b3b2ed` — target Admin account lookup API.
- `3f7142e0` — target account lookup for announcement user search.
- `42ffa79e` — remove stale Admin subscription-helper tests.
- `5d8892dc` — align Admin AI Pro fixture/request with `aiTaskProposal`.
- `1180ddbc` — type fetch mocks in AI capture tests.
- `8e5fc267` — use an `ArrayBuffer` Web Push application-server key.
- `898375ca` — align browser push test with the `ArrayBuffer` key.

Execution status:

- Admin typecheck — **PASS**.
- Web typecheck — **PASS**.

### API TypeScript repair batch

The first API typecheck attempt surfaced stale result-union access, removed presentation/import helpers, legacy LINE/Entity/media type references, AI capability fixture drift, strict WebCrypto/Fetch buffer typing, a stale Gemini request-helper name, nullable fixture typing and Hono route-param typing.

Fixed with `[skip ci]` commits:

- `dfb6ee7d` — align AI media tests with target-native `AiMediaProvider` / `AiMediaInputType`.
- `02a7a250` — remove retired attachment type dependency from Drizzle AI media repository.
- `3e1347f0` — remove retired `legacyLineUserId` from provider-neutral account identity test.
- `0b868cef` — remove retired `../line/content` type dependency from Gemini media tests.
- `c6282ce7` — remove stale missing Admin presentation import and return the already-normalized profitability report.
- `4573b351` — align commercial config tests with the `aiTaskProposal` capability.
- `202fd6bc` — remove retired Entity fixture fields from manual Record capture-context tests.
- `6b084b53` — explicitly narrow notification service result unions before reading `announcement`.
- `902ccd9f` — explicitly narrow native group invite result unions before reading invite/token.
- `8b63c55b` — use the exported `buildGeminiNaturalSearchRequest` helper consistently.
- `232d5f34` — type time-range summary fixtures as target `AiTimeRangeSummaryRecord[]`, allowing nullable titles.
- `5d6d7fd8` — align Web Push fetch/HKDF buffers with strict DOM/WebCrypto types without changing RFC 8291/8292 flow.
- `d862bd31` — align Apple Login crypto test buffers with strict WebCrypto `BufferSource` types.
- `f72dbf17` — accept Hono's optional route-param typing in the manual Record positive-id helper.

These API fixes are **AUTHORED / NOT YET EXECUTED** after the latest commits. Do not claim API typecheck PASS until the user pulls them and executes it.

No product feature was added, no retired behavior was restored, GitHub Actions were not used or modified, and `apps/api/verify-admin-schema.mjs` was not touched.

## Canonical Drizzle baseline status

Authoritative target schema remains `apps/api/src/db/schema-all.ts`.

Local Windows checkout status:

- regenerated target baseline guard — **PASS**.
- regenerated baseline SQL/snapshot + lockfile were committed locally and rebased; local branch remained one commit ahead of origin at the last reported `git status`.

GitHub branch status:

- do not claim the generated Drizzle artifacts are on origin until the user's local commit is explicitly pushed.
- do not hand-edit generated SQL/snapshot to simulate success.

After the generated artifacts are pushed, apply the canonical baseline to a fresh disposable PostgreSQL database and verify clean rebuild.

## Executable verification status

Current known status:

- dependency install — **PASS**.
- canonical baseline guard on user's regenerated local artifacts — **PASS**.
- Admin TypeScript typecheck — **PASS**.
- Web TypeScript typecheck — **PASS**.
- Extension static typecheck step — **PASS** (`static extension package: no TypeScript yet`).
- API TypeScript typecheck before latest API fixes — **FAIL**.
- latest API repair batch — **AUTHORED / NOT RUN**.
- full monorepo TypeScript typecheck — **FAIL** until API rerun proves otherwise.
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

1. Pull/rebase the latest API repair commits into the executable Windows checkout without losing the one local regenerated-baseline commit.
2. Run `pnpm --filter @aftertrace/api typecheck`.
3. If API passes, run `pnpm typecheck` to prove the whole workspace.
4. Push the user's rebased local canonical-baseline/lockfile commit to `origin/revive/line-worklog` once the working tree is clean and validation state is understood.
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
