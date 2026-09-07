# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policy. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 shared notification scheduler + native Task/reminder backend source-authored; executable validation and Cron trigger deployment still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/baseline rebuilds are allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE AFTERTRACE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- Trial points are not a TWD balance, are not hard-coded, do not refresh monthly, and do not retroactively resize already-issued trials.
- Trial/AI_PRO provider calls must use auditable reservation/settlement/provider-cost accounting where it cleanly fits.
- AI Pro keeps internal monthly point/resource caps plus operator-configured provider-cost hard cap.

## Accepted foundation from prior checkpoints

- Provider-neutral identity model for Google / LINE / Apple, with Google + LINE first priority and Apple next.
- Immutable opaque/non-sequential `public_account_id`, Web/PWA account display/copy, Admin exact lookup.
- Native AFTERTRACE GROUP membership/invites independent from LINE group membership.
- Free manual Record CRUD/search with nullable `occurred_at` and content-only create.
- Capture-first PWA/browser speech path without AFTERTRACE provider AI.
- Notification categories exactly `ANNOUNCEMENT | SYSTEM | TASK`, channels `IN_APP | PUSH` independent.
- Durable notification center/unread/read_at.
- Admin ANNOUNCEMENT backend + frontend for ALL/FREE/AI/SPECIFIC, preview, draft/send-now/scheduled/cancel and delivery inspection.
- SYSTEM notification idempotency primitive.
- Web/PWA authenticated header with bell/unread, display name, `帳號 ID`, copy.
- Browser/PWA push subscription storage, category preferences, explicit permission UX, service-worker push/click handling.
- Worker-native encrypted Web Push transport, durable retry/CAS state, preference filtering, invalid endpoint revoke and bounded retry.
- Chrome extension scaffold remains committed to shared account/Source/Record/AI entitlement model.

## This run — shared scheduler + native Task/reminder backend

This run continued the exact next planned batch and did not redo a broad static audit.

### Manual deployment now selects VAPID secrets

`scripts/deploy-workers.mjs` now includes:

- `WEB_PUSH_PUBLIC_KEY`;
- `WEB_PUSH_PRIVATE_KEY`;
- `WEB_PUSH_SUBJECT`.

These are required in the selected `.env.dev` / `.env.prod` for API deployment together with the existing runtime bindings. No deployment was executed in this run.

### Immediate Admin announcement push kick

`apps/api/src/worker.ts` now invokes the existing bounded `deliverPendingPushBatch()` through `executionContext.waitUntil()` after successful Admin announcement POST/send responses.

This keeps Admin HTTP latency independent from PUSH delivery and reuses the same durable push state machine rather than inventing a second sender path.

Current source behavior may also wake the dispatcher after a successful announcement-create response that remains DRAFT/SCHEDULED; this is harmless because the dispatcher only claims already-SENT pending recipients, but it should be narrowed to SENT-only after executable validation/refinement.

### Shared scheduled notification runtime

New `apps/api/src/worklog/scheduled-notifications.ts` provides one bounded runtime batch:

1. find due scheduled ANNOUNCEMENT ids;
2. dispatch each through the existing idempotent announcement repository;
3. dispatch due native TASK reminder notifications;
4. deliver pending PUSH recipients through the existing push dispatcher.

The Worker now exports one `scheduled()` handler that calls this shared batch with bounded limits. This is the intended single-system scheduler architecture; no per-task Cron code exists and no Cloudflare Queue was added.

Important: `apps/api/wrangler.toml` Cron trigger configuration was attempted but the repository write was blocked in this run. The handler exists, but no new `*/5 * * * *` trigger is claimed committed/deployed yet. Do not treat scheduled runtime as active until the trigger is explicitly present and manually deployed.

### Native durable Task schema

New `apps/api/src/db/schema-worklog-task.ts` defines target-schema `worklog_tasks` with:

- user owner;
- optional authorized Source and Record references;
- title/body;
- status `OPEN | COMPLETED | CANCELLED`;
- nullable `due_at` / `remind_at`;
- durable `reminder_notified_at` idempotency marker;
- completed/cancelled timestamps;
- bounded due-reminder indexes/checks.

`schema-all.ts` exports the new schema. Canonical `drizzle/0000` is still behind and has not been regenerated.

### Native Task service / persistence

New `apps/api/src/worklog/tasks.ts` and `drizzle-tasks.ts` source-author:

- list/create/update/complete/cancel domain operations;
- required nonblank task title;
- optional due/reminder timestamps;
- Record-linked task requires an explicit Source;
- create checks active Source membership and Record/source match server-side;
- task state changes are owned by current AFTERTRACE user;
- changing `remind_at` resets `reminder_notified_at` so a newly confirmed schedule can notify again.

Due reminder dispatch is one PostgreSQL statement using `FOR UPDATE SKIP LOCKED` and a claimed-task update. Only OPEN tasks with `remind_at <= NOW()` and no prior reminder notification are claimed. The same statement inserts a durable `TASK` notification and recipient row. If insertion fails, the statement rolls back the claimed marker, preserving retry safety.

### Authenticated Task API

New `apps/api/src/worklog/task-routes.ts` source-authors provider-neutral Web-session task endpoints and `worker.ts` mounts them under `/api/v1/tasks` before the legacy LINE/Gemini runtime boundary.

Current authored endpoints:

- `GET /api/v1/tasks`;
- `POST /api/v1/tasks`;
- `PATCH /api/v1/tasks/:id`;
- `POST /api/v1/tasks/:id/complete`;
- `POST /api/v1/tasks/:id/cancel`.

The routes use signed Web session -> durable AFTERTRACE `userId`; they do not depend on LINE identity or AI entitlement. Task creation is deterministic/user-confirmed and does not call AI.

A follow-up hardening rewrite for route parsing was attempted but blocked by the repository safety layer; therefore the currently committed task route file still needs executable TypeScript validation and malformed-date HTTP smoke before it is considered stable.

### Tests authored

New `apps/api/src/worklog/tasks.test.ts` covers TaskService normalization, Record/Source boundary, empty-update rejection and bounded due-task scheduler dispatch.

## Files changed this run

- `scripts/deploy-workers.mjs` — VAPID bindings added to manual API deploy selection;
- `apps/api/src/worklog/scheduled-notifications.ts` — bounded scheduled ANNOUNCEMENT/TASK/PUSH orchestration;
- `apps/api/src/worker.ts` — immediate push `waitUntil`, native task route mount, shared `scheduled()` handler;
- `apps/api/src/db/schema-worklog-task.ts` — native Task target schema;
- `apps/api/src/db/schema-all.ts` — exports Task schema;
- `apps/api/src/worklog/tasks.ts` — Task domain/service;
- `apps/api/src/worklog/drizzle-tasks.ts` — persistence + idempotent reminder notification creation;
- `apps/api/src/worklog/task-routes.ts` — authenticated Task HTTP API;
- `apps/api/src/worklog/tasks.test.ts` — Task domain tests;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `aaf2f933` — wire Web Push secrets into manual deploy;
- `cf0d4229` — add bounded scheduled notification runtime;
- `a667128a` — fix scheduled push batch accounting;
- `73888af4` — wire shared notification runtime triggers;
- `d61f0164` — add native task reminder schema;
- `2cf92b01` — export native task schema;
- `7f8b4dd9` — add native task reminder domain;
- `d5120d3e` — persist native tasks and idempotent reminders;
- `539f84c0` — include due task reminders in shared scheduler;
- `b173b43a` — enforce task record source boundary;
- `9cddec07` — author native task reminder tests;
- `a2ab7b3b` — expose authenticated native task API;
- `c780bc5d` — mount native task API;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/tasks.test.ts` — **AUTHORED / NOT RUN**;
- Task schema/service/repository/routes — **AUTHORED / NOT RUN**;
- shared scheduled notification runtime — **AUTHORED / NOT RUN**;
- Worker immediate push/scheduled handler wiring — **AUTHORED / NOT RUN**;
- manual deploy VAPID binding selection — **AUTHORED / NOT RUN**.

### Executable verification

- API TypeScript typecheck — **NOT RUN**;
- Task focused Vitest — **NOT RUN**;
- Push/scheduled notification focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- Worker dry-run build — **NOT RUN**;
- PostgreSQL Task `FOR UPDATE SKIP LOCKED`/rollback/idempotency smoke — **NOT RUN**;
- scheduled ANNOUNCEMENT due dispatch smoke — **NOT RUN**;
- immediate Admin PUSH waitUntil smoke — **NOT RUN**;
- real FCM/Apple/Firefox Web Push endpoint smoke — **NOT RUN**;
- Service Worker device receipt/click smoke — **NOT RUN**;
- Web/Admin typecheck/tests/build — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable in this development path, so new Task TypeScript/SQL and Worker scheduled handler have not compiled/executed.
2. Canonical `drizzle/0000` is behind current target schema, now including native Task and push retry columns.
3. `worker.scheduled()` exists, but the Cloudflare `*/5 * * * *` trigger is not committed/deployed yet because the attempted `wrangler.toml` write was blocked.
4. Current immediate Admin announcement hook can wake the push dispatcher after any successful announcement-create 201; repository claim rules prevent draft/scheduled recipients from sending, but narrow this hook to actually `SENT` announcements during validation/refinement.
5. `task-routes.ts` needs TypeScript compile and malformed date/reference HTTP smoke; a route-hardening rewrite was attempted but blocked.
6. Real Web Push protocol compatibility still needs provider/browser smoke.
7. SYSTEM notification primitive still needs deterministic payment/subscription/trial/AI-limit callers.
8. FREE one-time AI trial issuance/runtime is not implemented to the current contract.
9. Google Login and Apple Login callbacks remain incomplete; LINE Login must stay provider-neutral.
10. AI Pro entitlement/provider-cost-hard-cap runtime remains incomplete.
11. Extension real auth handoff/Source picker/durable Record persistence remains incomplete.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix first:
   - API typecheck;
   - `tasks.test.ts`;
   - existing push-delivery/web-push/notification focused tests;
   - Worker dry-run build;
   - PostgreSQL Task reminder + scheduled ANNOUNCEMENT + push smoke.
2. If executable checkout remains unavailable:
   - retry committing exactly one `*/5 * * * *` Cloudflare Cron trigger after re-reading `wrangler.toml`;
   - narrow immediate Admin push wake-up to actual SENT announcement results;
   - harden/author `task-routes.test.ts` for userId-only auth, malformed dates, Source authorization and completion/cancel ownership;
   - add minimal Web/PWA Task list/create/edit/complete/reminder UI using `/api/v1/tasks`;
   - keep task creation user-confirmed and provider-free unless a later explicit AI proposal is accepted.
3. Wire deterministic SYSTEM callers for payment/subscription/FREE-trial/AI-limit events.
4. Implement FREE one-time AI trial Admin config + idempotent account issuance + reservation/settlement/cost accounting.
5. Complete Google + LINE priority auth path and Apple next.
6. Complete AI Pro entitlement/monthly point-resource caps/provider-cost hard cap.
7. Continue Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page context -> selected text -> quick voice -> screenshot/image AI entitlement -> permission/privacy/browser smoke/package.
8. Regenerate canonical baseline, rebuild disposable Dev/Prod when safe, then run runtime E2E and final legacy cleanup.

## Current estimated remaining development time

Approximately **29–56 focused development hours** remain.

Largest uncertainty remains the first real API/Web/Admin compile/test pass, PostgreSQL target-schema rebuild, Web Push provider/browser smoke, and Dev runtime E2E. Narrow this estimate again after those execute.
