# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-12 latest Web/PWA UI refinement authored; validation still pending

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE remains only as provider-neutral LINE Login plus the external official LINE OA support link. Apple Login source remains available but is intentionally disabled for the current launch because the user is not enrolled in the paid Apple Developer Program. Current active launch login providers are Google + LINE.

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

## Executable validation proven before latest UI redesign/refinement

User checkout: `D:\Project\after-trace`.

PASS before the latest UI-only commit batches: frozen install, canonical baseline guard, monorepo TypeScript/ESLint, Admin/Web/API Vitest, Worker/Admin/Web builds, extension static build, Drizzle export, release preflight, PostgreSQL migration/integrity and local health/readiness checks.

The latest visual/UI commits have NOT YET been revalidated locally. Do not claim they passed until the user runs the Web validation commands again.

## Google Login runtime smoke — PASS

Real browser Google OAuth was exercised locally. The user successfully logged in with Google and reached the authenticated Worklog UI after account-provisioning defects were repaired. LINE Login real browser smoke is still pending.

## Current runtime configuration

Readiness-required local config is proven present: target PostgreSQL schema, Google Login, LINE Login, Web Push VAPID, Gemini, AI runtime config, FREE/AI_PRO plans, FREE initial AI trial config and Admin runtime config. Apple Login is intentionally blank/disabled and is not a readiness requirement.

## Field-worker UI/UX direction

Target audience: field workers, small workshops and small companies. Product UI should feel simple, practical and mobile-first rather than like an engineering/admin console.

Latest screenshot-driven refinement now includes:

- Record `目前紀錄 / 回收桶` segmented switch, smaller create action and denser day-level filters.
- Personal-only `我的紀錄` scope selector is hidden when there is nothing else to switch to; it reappears when multiple authorized record spaces exist.
- Selected states are intentionally stronger across desktop primary navigation, Worklog tabs, Record view switch and Task status switch.
- Task page removes the redundant `我的待辦` summary card. Its main controls are now `進行中 / 已結束` plus `＋新增待辦`; completed and cancelled items remain distinguished by badges inside the combined closed view.
- Task layout uses `align-content:start`, avoiding viewport-height row stretching.
- AI Pro wording is simplified to `使用 AI 快速紀錄、整理、搜尋與理解工作紀錄。` and `使用次數受限於方案 AI 用量上限`.
- Subscription waits for required bootstrap data before showing API-derived content and has a dedicated bootstrap error state.
- Feedback wording is softer and invitational.
- Help support action is now `LINE 聯絡客服`; configured OA add URLs are converted to LINE OA message URLs so mobile users can go directly toward the official-account chat instead of the add-friend QR flow.

Current visual principles:

- dark mode remains, but avoid pure-black empty expanses;
- current/selected state must be immediately recognizable rather than only slightly different from inactive controls;
- panels/cards are reserved for meaningful grouping;
- Worklog Records read as a chronological work stream rather than an admin dashboard;
- setup/configuration surfaces stay quieter than daily work;
- customer-facing copy avoids internal terminology;
- empty states explain the next action;
- authenticated pages avoid visibly incomplete API-derived layouts while required bootstrap data is loading.

## Validation status for latest UI batch

AUTHORED / NOT YET EXECUTED:

- `pnpm --filter @aftertrace/web typecheck`
- `pnpm --filter @aftertrace/web lint`
- `pnpm --filter @aftertrace/web test`
- `pnpm --filter @aftertrace/web build`

No GitHub Actions were run, rerun, enabled or modified.

## Remaining runtime verification

NOT RUN / NOT RUNTIME VERIFIED: clean-from-empty PostgreSQL rebuild unless separately proven; LINE Login real browser smoke; focused DB smoke; Gemini provider smoke; Chrome extension smoke; Web Push delivery smoke; shared Cron smoke; NewebPay TEST flow; Dev end-to-end smoke; actual Worker deployment.

## Exact next steps

1. Pull `revive/line-worklog`.
2. Run focused Web typecheck/lint/test/build.
3. Start local Web/API and capture representative desktop + mobile screenshots of Worklog and Tasks first.
4. Verify stronger active states, conditional scope selector, Task open/closed switch and LINE support behavior on mobile.
5. Continue runtime smoke after UI is accepted.

`apps/api/verify-admin-schema.mjs` was not staged or committed. GitHub Actions were not run or modified.
