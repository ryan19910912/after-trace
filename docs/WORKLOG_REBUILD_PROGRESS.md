# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-09 target-only cleanup complete; executable validation in progress

AFTERTRACE is Web + PWA-first with a compact Chrome extension fast-capture surface. LINE remains only as provider-neutral LINE Login plus the external official LINE OA support link. Accepted V1 feature scope remains source-authored complete; no further product/legacy-cleanup work should be invented merely to continue development.

Current prelaunch Dev/current Prod data are disposable while no real customer data exists. Canonical target schema is `apps/api/src/db/schema-all.ts`.

## Product/commercial contract

- V1 exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No ONE_TIME/TOP_UP or extra paid tier.
- FREE remains a complete manual product plus one idempotent Admin-configured AI trial grant.
- AI entitlement is per requesting user; GROUP only authorizes Source data.
- AI Pro uses monthly point/resource cap, provider-cost hard cap, optional per-request cap and capability toggles.
- V1 payment transport is NewebPay periodic card billing.
- No GROUP AI responsible-user/funding-owner concept.

## Target-only legacy cleanup — COMPLETE

Physically removed from target source/schema/tests/docs: LINE Messaging webhook/runtime, 小跡/GROUP bot, LINE Reply/cache/attachment runtime, bot-entry nonce/group identity state, Entity/Alias/Confirmation workflow, legacy Record entity/message ids, GROUP AI funding/responsibility, ONE_TIME/TOP_UP, and obsolete compatibility tests/docs. Do not restore them.

## Executable validation performed on Windows checkout

User checkout: `D:\Project\after-trace`.

Actually executed and proven:

- `pnpm install --frozen-lockfile` — **PASS**.
- canonical Drizzle regeneration was performed locally; direct regeneration stdout was not supplied.
- `pnpm db:baseline:guard` after regeneration — **PASS** (`AFTERTRACE V1 target baseline + Drizzle metadata guard passed.`).
- Admin typecheck — **PASS**.
- Web typecheck — **PASS**.
- API typecheck — **PASS** after API repair batch.
- full `pnpm typecheck` — **PASS** across Admin/API/Web plus Extension static step.
- Admin lint — **PASS**.
- full preflight baseline guard — **PASS**.
- full preflight TypeScript stage — **PASS**.
- full preflight ESLint stage — **PASS**.
- Admin Vitest — **PASS**: 6 files / 20 tests.
- Web Vitest — **PASS**: 11 files / 41 tests.
- API Vitest attempt — **FAIL**: 5 files failed, 54 passed; 7 tests failed, 254 passed.
- Build / Drizzle export did not execute because Vitest stopped preflight.

The user's locally regenerated baseline SQL/snapshot plus `pnpm-lock.yaml` were committed locally with `[skip ci]` and rebased repeatedly. The user has not yet explicitly reported pushing that local commit to origin; do not claim origin contains the regenerated artifacts until push is confirmed.

## Validation repair commits already completed

Earlier Admin/Web/API typecheck/lint repair commits include:

- `28b3b2ed`, `3f7142e0`, `42ffa79e`, `5d8892dc` — Admin API/test synchronization.
- `1180ddbc`, `8e5fc267`, `898375ca` — Web fetch/Web Push type fixes.
- `dfb6ee7d`, `02a7a250`, `3e1347f0`, `0b868cef`, `c6282ce7`, `4573b351`, `202fd6bc`, `6b084b53`, `902ccd9f`, `8b63c55b`, `232d5f34`, `5d6d7fd8`, `d862bd31`, `f72dbf17` — API target-only typecheck repairs.
- `5ef4fd3a` — remove explicit `any` from Admin commercial parser.
- `a61693de`, `89bedfce` — Web lint unused-parameter fixes.

All were `[skip ci]`. GitHub Actions were not run or modified. `apps/api/verify-admin-schema.mjs` was not touched.

## Latest Vitest failure analysis and authored fixes

The 2026-09-09 preflight reached Vitest and surfaced exactly 7 API test failures:

1. `commercial-config.test.ts` FREE-trial invalid quantity used `.rejects` even though validation throws synchronously.
2. `commercial-config.test.ts` per-request cap validation had the same synchronous-throw assertion bug.
3. `notifications.test.ts` no-channel validation used `.rejects` for synchronous validation.
4. `notifications.test.ts` SPECIFIC_USERS validation used `.rejects` for synchronous validation.
5. `ai-time-range-summary.test.ts` expected exactly 5 Records, but the bounded implementation intentionally admits 5 full Records plus one truncated final Record while staying under the provider character cap.
6. `web-push-transport.test.ts` expected fetch body `Uint8Array`, while runtime now intentionally converts the strict DOM `BodyInit` boundary to `ArrayBuffer`.
7. `index-readiness.test.ts` observed HTTP 500 because `createDatabase()` could throw before the readiness schema-probe try/catch. Readiness should fail closed as 503 instead of leaking an internal 500.

Authored `[skip ci]` fixes:

- `5be3161b` — use synchronous `.toThrow` assertions for CommercialConfig validation.
- `0abddb52` — use synchronous `.toThrow` assertions for NotificationService validation.
- `e9010ff1` — align bounded-summary test with the intentionally truncated sixth Record and assert the final Record is truncated.
- `85647414` — assert the Web Push fetch body as `ArrayBuffer` and keep encrypted-body size verification.
- `6364e15a` — include database client construction in readiness fail-closed handling so malformed/unavailable DB config returns 503 `WORKLOG_TARGET_SCHEMA_UNAVAILABLE` rather than HTTP 500.

These latest Vitest fixes are **AUTHORED / NOT YET EXECUTED**. Do not claim them PASS until the user pulls and runs tests.

## Current executable status

- dependency install — **PASS**.
- canonical baseline guard on user's regenerated local artifacts — **PASS**.
- monorepo TypeScript — **PASS**.
- monorepo ESLint — **PASS**.
- Admin tests — **PASS**.
- Web tests — **PASS**.
- API tests before latest 5 commits — **FAIL** (254 passed / 7 failed).
- latest Vitest repair batch — **AUTHORED / NOT RUN**.
- Worker/Web/Admin production builds — **NOT RUN** in a successful preflight sequence.
- Drizzle schema export — **NOT RUN** in a successful preflight sequence.
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

1. Pull/rebase the latest Vitest repair commits into the Windows checkout.
2. Run `pnpm --filter @aftertrace/api test` first.
3. If API tests pass, run `pnpm release:preflight` again; this should then continue into production builds and Drizzle schema export.
4. Push the user's rebased regenerated-baseline/lockfile commit to `origin/revive/line-worklog` once working tree/history are clean.
5. Apply canonical baseline to a fresh disposable PostgreSQL database and run focused DB smoke for account lookup, Feedback, Tasks PRIVATE/GROUP authorization, FREE trial/AI Pro Grants, provider-cost concurrency, lifecycle replay/stale cancel and Related ranking.
6. Run NewebPay TEST checkout -> callback retry/idempotency -> renewal -> cancel.
7. Run Google/LINE/Apple + Gemini + Chrome + Push/Cron Dev smoke.
8. Only then consider the branch release-ready.

## Remaining estimate

- Functional feature development: **0 focused hours**.
- Legacy cleanup: **0 focused hours**.
- Remaining work is validation/release-readiness only and depends on failures discovered by execution.

`apps/api/verify-admin-schema.mjs` was not staged or committed.
