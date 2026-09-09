# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-09 source cleanup complete; local release preflight PASS

AFTERTRACE remains Web + PWA-first with the compact Chrome extension fast-capture surface. LINE remains only as provider-neutral LINE Login plus the external official LINE OA support link. Accepted V1 feature scope is source-authored complete. Legacy cleanup is complete. Do not invent further product/domain changes merely to continue work.

Current prelaunch Dev/current Prod data remain disposable while no real customer data exists. Canonical target schema is `apps/api/src/db/schema-all.ts`.

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
- API typecheck — **PASS**.
- full `pnpm typecheck` — **PASS** across Admin/API/Web plus Extension static step.
- Admin lint — **PASS**.
- full monorepo ESLint — **PASS**.
- standalone API Vitest after repair batch — **PASS**: **59 files / 261 tests**.
- `pnpm release:preflight` — **PASS** end-to-end locally.

The successful preflight specifically proved:

1. canonical baseline/migration guard — **PASS**;
2. TypeScript typecheck — **PASS**;
3. ESLint — **PASS**;
4. Vitest — **PASS**;
   - Admin: **6 files / 20 tests**;
   - Web: **11 files / 41 tests**;
   - API: **59 files / 261 tests**;
5. Worker/Web/Admin production builds — **PASS**;
   - API Wrangler `deploy --dry-run` completed successfully;
   - Admin Vite production build completed successfully;
   - Web Vite production build completed successfully;
   - Extension static build step completed and still requires real unpacked-browser smoke;
6. Drizzle schema export from `apps/api/src/db/schema-all.ts` — **PASS**.

Release preflight itself explicitly does **not** apply migrations, deploy Workers, or replace browser/provider/runtime smoke. Do not promote this to full runtime verification.

### Readiness stderr note

During API tests, the loopback readiness test intentionally exercised an invalid/unavailable database string. The target readiness endpoint logged `WORKLOG_TARGET_READINESS_SCHEMA_PROBE_FAILED`, then the test suite still passed all 8 readiness tests because the repaired behavior correctly fails closed as HTTP 503 instead of leaking HTTP 500. This is expected test-path stderr, not a test failure.

## Validation repair commits completed

Admin/Web/API validation repairs completed with `[skip ci]` commits, including:

- Admin API/test synchronization: `28b3b2ed`, `3f7142e0`, `42ffa79e`, `5d8892dc`.
- Web fetch/Web Push typing: `1180ddbc`, `8e5fc267`, `898375ca`.
- API target-only typecheck repairs: `dfb6ee7d`, `02a7a250`, `3e1347f0`, `0b868cef`, `c6282ce7`, `4573b351`, `202fd6bc`, `6b084b53`, `902ccd9f`, `8b63c55b`, `232d5f34`, `5d6d7fd8`, `d862bd31`, `f72dbf17`.
- Admin lint repair: `5ef4fd3a`.
- Web lint repairs: `a61693de`, `89bedfce`.
- Vitest repairs: `5be3161b`, `0abddb52`, `e9010ff1`, `85647414`, `6364e15a`.

The latest Vitest repair batch is now **EXECUTED / PASS**, not merely authored.

GitHub Actions were not run or modified. `apps/api/verify-admin-schema.mjs` was not touched.

## Canonical Drizzle baseline status

Authoritative target schema remains `apps/api/src/db/schema-all.ts`.

Local Windows checkout:

- regenerated canonical baseline guard — **PASS**;
- regenerated baseline SQL/snapshot + `pnpm-lock.yaml` were committed locally with `[skip ci]` and repeatedly rebased while validation fixes landed;
- full local release preflight using those generated artifacts — **PASS**.

Origin synchronization:

- the user has not yet explicitly reported `git push` after the local regenerated-baseline commit/rebases;
- therefore do **not** claim the regenerated canonical baseline is already present on `origin/revive/line-worklog` until push is confirmed.

Generated SQL/snapshot must not be hand-edited to simulate success.

## Current executable status

### PASS

- dependency install;
- canonical baseline guard;
- monorepo TypeScript;
- monorepo ESLint;
- Admin Vitest;
- Web Vitest;
- API Vitest (59 files / 261 tests);
- Worker/API dry-run build;
- Admin production build;
- Web production build;
- Extension static build step;
- Drizzle schema export;
- complete local `pnpm release:preflight`.

### NOT RUN / NOT RUNTIME VERIFIED

- fresh disposable PostgreSQL rebuild from canonical baseline;
- focused PostgreSQL DB smoke for account lookup, Feedback, PRIVATE/GROUP Task authorization, FREE trial/AI Pro Grant accounting, provider-cost concurrency, lifecycle replay/stale cancel and Related ranking;
- NewebPay TEST checkout/callback retry/idempotency/renew/cancel flow;
- Google OAuth runtime smoke;
- LINE Login runtime smoke;
- Apple Login runtime smoke;
- Gemini real provider smoke;
- Chrome unpacked-extension browser smoke;
- Web Push runtime smoke;
- shared Cloudflare Cron runtime smoke;
- Dev end-to-end smoke;
- actual Worker deployment.

No unexecuted item is claimed PASS or RUNTIME VERIFIED.

## Exact next validation plan

1. Run `git status` / `git log --oneline --decorate -5` in the Windows checkout and confirm the locally regenerated baseline commit is still ahead of origin as expected.
2. Push the validated local branch to `origin/revive/line-worklog` using normal `git push`; all commits already contain `[skip ci]` and GitHub Actions must remain unused.
3. Apply the canonical baseline to a fresh disposable PostgreSQL database and prove a clean schema rebuild.
4. Run focused DB smoke for account lookup, Feedback, PRIVATE/GROUP Tasks, FREE trial/AI Pro Grants, provider-cost concurrency, lifecycle replay/stale cancel and Related ranking.
5. Run NewebPay TEST checkout -> callback retry/idempotency -> renewal -> cancel when real TEST credentials/callback URLs are available.
6. Run Google/LINE/Apple + Gemini + Chrome unpacked extension + Push/Cron Dev smoke.
7. Run Dev E2E.
8. Only then consider the branch fully release-ready/runtime-verified.

## Remaining estimate

- Functional feature development: **0 focused hours**.
- Legacy cleanup: **0 focused hours**.
- Static/local release validation: **complete / PASS**.
- Remaining work is database/provider/browser/runtime verification only and depends on external credentials/runtime availability.

`apps/api/verify-admin-schema.mjs` was not staged or committed.
