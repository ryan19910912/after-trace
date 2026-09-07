# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policy. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 shared five-minute Cron + native Task Web/PWA surface source-authored; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are explicitly allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

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
- Native Task target schema/service/repository/API and one shared scheduled runtime were source-authored in the previous checkpoint.
- Chrome extension scaffold remains committed to shared account/Source/Record/AI entitlement model.

## This run — Cron activation source + Task Web/PWA product surface

This run continued the exact next planned batch and did not redo a broad static audit.

### One shared five-minute Cloudflare Cron is now in source

`apps/api/wrangler.toml` now intentionally contains exactly one shared Cron Trigger:

```text
*/5 * * * *
```

It targets the existing Worker `scheduled()` handler. The handler performs bounded work in one runtime path:

1. due scheduled ANNOUNCEMENT dispatch;
2. due user-confirmed TASK reminder notification creation;
3. pending PUSH delivery.

No per-task Cron exists and no Cloudflare Queue was added.

Important runtime boundary: the trigger is **source-authored but not manually deployed or runtime verified** in this run. Source configuration must not be confused with an active Cloudflare trigger.

### Immediate Admin PUSH wake-up narrowed to truly SENT announcements

`apps/api/src/worker.ts` previously woke the PUSH dispatcher after every successful announcement-create `201`, including DRAFT/SCHEDULED create responses. Repository claim rules made that harmless, but it was unnecessarily broad.

The worker now clones the successful Admin announcement response and only schedules `deliverPendingPushBatch()` when the returned announcement status is actually `SENT`. Existing `/announcements/:id/send` and SEND_NOW create flows therefore keep the low-latency `waitUntil()` wake-up, while DRAFT/SCHEDULED creation no longer causes a useless dispatcher run.

### Task request parsing hardened

`apps/api/src/worklog/task-routes.ts` now:

- returns field-specific `INVALID_SOURCE_ID` / `INVALID_RECORD_ID` / `INVALID_TASK_DUE_AT` / `INVALID_TASK_REMIND_AT` codes;
- performs PATCH date parsing inside the route error boundary, so malformed dates return HTTP 400 instead of escaping toward a 500;
- keeps durable Web session -> provider-neutral `userId` authorization;
- keeps Source authorization fail-closed.

New `apps/api/src/worklog/task-routes.test.ts` source-authors coverage for:

- userId-only Web session scope;
- malformed reminder/create timestamps;
- Record requiring an explicit Source;
- unauthorized Source create -> 403;
- malformed PATCH dates not reaching the repository;
- complete/cancel scoped to the authenticated account.

### Reminder edit semantics hardened

`apps/api/src/worklog/drizzle-tasks.ts` no longer resets `reminder_notified_at` merely because a PATCH payload contains `remindAt` with the same timestamp.

The marker is reset only when the persisted reminder time is actually distinct from the requested new reminder time. This prevents a user editing only title/body through a full-form UI from accidentally making an already-delivered reminder eligible to fire again.

Changing the reminder timestamp still intentionally resets the marker, allowing the newly confirmed reminder schedule to notify once.

### Web/PWA Task API client

New `apps/web/src/task-api.ts` provides the shared authenticated durable Task API client:

- list;
- create;
- update;
- complete;
- cancel;
- strict task response mapping;
- backend validation codes remain visible to the UI rather than becoming local-only task state.

New `apps/web/src/task-api.test.ts` covers nullable task facts, shared AFTERTRACE Bearer session usage, durable complete/cancel endpoints and backend validation propagation.

### Minimal native Task Web/PWA UI

New `apps/web/src/TaskRoot.tsx` and `task.css` provide `/tasks` and `/tasks/:id` as a real customer surface.

Current source-authored behavior:

- list durable tasks;
- manually create a user-confirmed task;
- optional body;
- optional due time;
- optional reminder time;
- edit OPEN tasks;
- complete task;
- cancel task;
- show OPEN / COMPLETED / CANCELLED state;
- show reminder/due timestamps;
- show whether a reminder notification has already been created;
- `/tasks/:id` deep link visually focuses the referenced task, matching TASK notification deep links;
- no AI call is made for manual task creation/editing;
- reminder copy accurately describes PUSH as optional on top of durable TASK notification state.

`apps/web/src/main.tsx` routes `/tasks` and `/tasks/:id` to this surface and preserves `/tasks` through the existing migration-era login return flow.

`AuthenticatedAppChrome.tsx` now exposes a compact authenticated `待辦` shortcut next to the notification bell so the Task surface is discoverable from Web/PWA without adding another full workspace navigation system.

### Deployment policy brought in sync with current prelaunch permission

`docs/WORKLOG_DEPLOYMENT.md` had stale language saying destructive rebuild was a last resort even though the latest accepted product/development contract explicitly says current Dev and prelaunch Prod data are disposable.

It now matches the current authority:

- clean Dev/current-Prod rebuild is allowed while there is no real customer/durable production data;
- canonical `drizzle/0000` may be regenerated;
- target architecture is preferred over compatibility migration complexity for disposable test data;
- destructive permission expires when real production data exists;
- the intentional `*/5 * * * *` shared scheduler and VAPID runtime bindings are documented;
- no deployment is implied by source changes.

## Files changed this run

- `apps/api/wrangler.toml` — exactly one shared five-minute Cron trigger;
- `apps/api/src/worker.ts` — SENT-only immediate announcement PUSH wake-up;
- `apps/api/src/worklog/task-routes.ts` — hardened request parsing/errors;
- `apps/api/src/worklog/task-routes.test.ts` — Task HTTP contract tests authored;
- `apps/api/src/worklog/drizzle-tasks.ts` — unchanged-reminder edit no longer re-arms delivery;
- `apps/web/src/task-api.ts` — durable Task API client;
- `apps/web/src/task-api.test.ts` — Task API tests authored;
- `apps/web/src/TaskRoot.tsx` — minimal Task/reminder customer surface;
- `apps/web/src/task.css` — responsive dark Task UI;
- `apps/web/src/main.tsx` — `/tasks` + `/tasks/:id` route/login return support;
- `apps/web/src/AuthenticatedAppChrome.tsx` — authenticated Task shortcut;
- `apps/web/src/account-notification.css` — Task shortcut styling;
- `docs/WORKLOG_DEPLOYMENT.md` — current prelaunch rebuild/Cron/VAPID contract;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `72bc4d90` — add shared five minute notification cron;
- `9c303d42` — narrow immediate announcement push wakeup;
- `0c8a459a` — harden native task request parsing;
- `58e51723` — author native task route tests;
- `1c256fa2` — add Web task API client;
- `22d61723` — add minimal Web task reminder surface;
- `b6feace1` — style Web task reminder surface;
- `2dec64ce` — route Web task reminder surface;
- `82b41e69` — expose task shortcut in authenticated chrome;
- `d23e443a` — style authenticated task shortcut;
- `c744c1ca` — author Web task API tests;
- `6d15b25c` — harden Web task API test assertions;
- `0cd94536` — align task surface with dark Web shell;
- `df76a80d` — avoid duplicate reminder after unchanged edit;
- `9d067da0` — align deployment baseline with prelaunch target;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/task-routes.test.ts` — **AUTHORED / NOT RUN**;
- `apps/web/src/task-api.test.ts` — **AUTHORED / NOT RUN**;
- Task route hardening — **AUTHORED / NOT RUN**;
- reminder re-arm SQL semantics — **AUTHORED / NOT RUN**;
- `/tasks` Web/PWA surface — **AUTHORED / NOT RUN**;
- `*/5 * * * *` Worker Cron config — **AUTHORED / NOT RUN**;
- SENT-only immediate PUSH wake-up — **AUTHORED / NOT RUN**.

### Executable verification actually attempted

- executable AFTERTRACE checkout discovery — **FAIL**; no mounted checkout was found;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- `tasks.test.ts` — **NOT RUN**;
- `task-routes.test.ts` — **NOT RUN**;
- push/scheduled notification focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web TypeScript typecheck — **NOT RUN**;
- `task-api.test.ts` — **NOT RUN**;
- Web focused/full Vitest — **NOT RUN**;
- Web production build — **NOT RUN**;
- `/tasks` browser/PWA create/edit/complete/cancel smoke — **NOT RUN**;
- `/tasks/:id` notification deep-link smoke — **NOT RUN**;
- PostgreSQL Task `FOR UPDATE SKIP LOCKED`/rollback/idempotency smoke — **NOT RUN**;
- PostgreSQL unchanged-reminder re-arm regression smoke — **NOT RUN**;
- Cloudflare Cron scheduled invocation — **NOT RUN / NOT DEPLOYED**;
- scheduled ANNOUNCEMENT due dispatch smoke — **NOT RUN**;
- immediate Admin PUSH `waitUntil` smoke — **NOT RUN**;
- real FCM/Apple/Firefox Web Push endpoint smoke — **NOT RUN**;
- Service Worker device receipt/click smoke — **NOT RUN**;
- Admin typecheck/tests/build — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable in this development path, so new Task/Worker/Web TypeScript and SQL have not compiled/executed.
2. Canonical `drizzle/0000` is behind current target schema, including provider-neutral auth/public-account, notification/PUSH retry and native Task structures.
3. The shared `*/5 * * * *` Cron is now committed in Wrangler config but has not been manually deployed or observed executing.
4. Native Task UI/API are source-complete enough for the current manual MVP batch but need browser/runtime validation, especially datetime-local conversion, narrow PWA layout and `/tasks/:id` deep links.
5. PostgreSQL reminder claim/re-arm semantics need real DB smoke; source review does not prove `FOR UPDATE SKIP LOCKED`/timestamp comparison behavior.
6. Real Web Push protocol compatibility still needs provider/browser/device smoke.
7. SYSTEM notification primitive still needs deterministic payment/subscription/FREE-trial/AI-limit callers.
8. FREE one-time AI trial issuance/runtime is not implemented to the current contract.
9. Google Login and Apple Login callbacks remain incomplete; LINE Login must stay provider-neutral.
10. AI Pro entitlement/provider-cost-hard-cap runtime remains incomplete.
11. Extension real auth handoff/Source picker/durable Record persistence remains incomplete.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix first:
   - API typecheck;
   - `tasks.test.ts` + `task-routes.test.ts`;
   - existing push-delivery/web-push/notification focused tests;
   - API Worker dry-run build;
   - Web typecheck + `task-api.test.ts` + existing focused Web tests + production build;
   - then PostgreSQL Task reminder/scheduled ANNOUNCEMENT/PUSH smoke.
2. If executable checkout remains unavailable, continue the next bounded backend batch:
   - wire deterministic SYSTEM notification callers around current subscription lifecycle/state changes that already exist;
   - keep deterministic event keys stable and idempotent;
   - do not let Admin arbitrary text masquerade as SYSTEM;
   - then implement FREE one-time AI trial Admin config + idempotent account issuance using `free_initial_ai_trial_points` and existing Grant/reservation/settlement infrastructure where clean.
3. Complete Google + LINE priority authentication path and Apple next, preserving provider-neutral identity/no silent email merge.
4. Complete AI Pro entitlement/monthly point-resource caps/provider-cost hard cap and customer fair-use state.
5. Continue Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page context -> selected text -> quick voice -> screenshot/image AI entitlement -> permission/privacy/browser smoke/package.
6. Regenerate canonical baseline, rebuild disposable Dev/Prod when safe, then run runtime E2E and final legacy cleanup.

## Current estimated remaining development time

Approximately **26–52 focused development hours** remain.

Largest uncertainty remains the first real API/Web/Admin compile/test pass, PostgreSQL target-schema rebuild, Web Push provider/browser smoke, and Dev runtime E2E. Narrow this estimate again after those execute.
