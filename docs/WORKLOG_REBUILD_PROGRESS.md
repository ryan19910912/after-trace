# AFTERTRACE Worklog Rebuild Progress

Durable hourly-development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, plus the latest subscription/account/support/notification policies when called out by the run prompt. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 durable notification center + SYSTEM idempotency + Admin ANNOUNCEMENT backend authored; executable/schema runtime verification still pending

AFTERTRACE remains Web + PWA-first work memory with optional Chrome extension. LINE is no longer a Record/group/AI product surface. LINE remains only as:

- one supported login provider;
- official LINE OA external customer-support contact channel.

Current prelaunch Dev and Prod data are disposable. Clean canonical baseline/database/application rebuilds are allowed while there is no real customer data. Once real customer/durable Prod data exists, destructive Prod permission expires and requires a new explicit decision.

## Current commercial/product contract retained

Launch commercial shape is exactly:

- `FREE` — NT$0;
- `AI_PRO` — NT$99/month;
- no one-time AI top-up product and no extra paid tier in V1.

FREE remains a complete manual product. A newly eligible FREE account receives one idempotent, one-time AI trial allowance using internal AI points.

Trial rules that remain authoritative:

- Admin configures `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`;
- do not configure or display a TWD trial price;
- do not hard-code the point amount;
- trial does not refresh monthly;
- later Admin template changes affect only users who have not already received the trial;
- already-issued trial balances are never resized retroactively;
- trial provider calls use the same reservation/settlement and immutable provider-cost audit path as paid AI;
- after trial exhaustion, provider-backed AI stops while FREE manual/product features continue and the UI may offer AI Pro upgrade.

AI Pro retains internal monthly point/resource caps plus a configurable provider-cost hard cap in TWD. Current planning may begin around NT$30/month provider cost, but that is operator configuration, not customer cash value or a source-code constant.

## Product foundation retained from earlier batches

The accepted target foundation remains:

- provider-neutral Google / LINE / Apple identity bindings;
- Google + LINE are first implementation priorities; Apple follows if sequencing is needed;
- provider email/id/display-name data is not the AFTERTRACE account identity;
- accounts are never silently merged from matching email;
- each account has immutable opaque `public_account_id`, displayed as `帳號 ID` and usable for exact Admin support lookup;
- current LINE Login callback provisions through the provider-neutral account service;
- native AFTERTRACE GROUP membership/invites exist without LINE group authorization;
- free manual Record CRUD/search supports nullable event date and no required AI title/entities;
- capture-first PWA/browser speech foundation exists and does not consume AFTERTRACE provider AI;
- notification schema already defines exactly `ANNOUNCEMENT | SYSTEM | TASK` and independent `IN_APP | PUSH` delivery concepts;
- LINE OA remains support-only and must not reintroduce legacy Record/group/AI bot behavior.

## Notification domain/service contract — authored this run

New `apps/api/src/worklog/notifications.ts` defines the shared notification contract.

Current service boundaries include:

- notification center item/page types;
- `ANNOUNCEMENT | SYSTEM | TASK` categories;
- `ALL_USERS | FREE_USERS | AI_SUBSCRIBERS | SPECIFIC_USERS` audiences;
- Admin announcement create/dispatch/cancel/list/detail contracts;
- deterministic SYSTEM notification input/result contract;
- title/body/channel/audience validation;
- strict `SPECIFIC_USERS` validation so an empty or malformed explicit audience can never silently widen to all users;
- explicit deduplication of selected user ids;
- bounded SYSTEM event-key suffix length so the persisted user-scoped key remains within the schema limit.

The shared service does not invent a SYSTEM event merely because an Admin typed a message. Manual Admin messages are always ANNOUNCEMENT through this path.

## Durable notification persistence — authored this run

New `apps/api/src/worklog/drizzle-notifications.ts` implements the schema-backed repository.

### IN_APP notification center

Auth-scoped persistence now supports:

- list current user's durable sent IN_APP notifications;
- unread count;
- mark one owned notification read;
- mark all current user's IN_APP notifications read;
- `read_at` remains durable;
- push status is independent from IN_APP visibility.

A push-only logical notification is not returned in the IN_APP center merely because a recipient row exists.

### SYSTEM idempotency

`createSystemNotification()` now persists a deterministic key as:

`user:<userId>:<domainEventKey>`

This makes idempotency user-scoped and prevents the same caller event suffix from accidentally sharing one logical SYSTEM notification across different accounts.

Persistence behavior:

- logical SYSTEM row is `SENT` and `SPECIFIC_USERS`;
- `ON CONFLICT (system_event_key) DO NOTHING` provides retry/webhook idempotency;
- per-user recipient insertion is also conflict-safe;
- repeated calls return the existing logical notification with `idempotent: true`;
- IN_APP is durable; PUSH remains pending/skipped according to requested channel and is delivered later by the push layer.

No payment/subscription caller is wired to this service yet; the idempotent primitive is now available for those deterministic domain events.

## Admin ANNOUNCEMENT persistence / audience fan-out — authored this run

The repository now supports Admin announcement lifecycle:

- create `DRAFT` announcement;
- create `SCHEDULED` announcement with `scheduled_at`;
- claim DRAFT/SCHEDULED rows into `SENDING` before fan-out;
- deterministic recipient fan-out;
- finalize as `SENT`;
- cancel pending DRAFT/SCHEDULED rows;
- list/detail with recipient/unread/push success/failure summary counts.

Audience fan-out rules authored:

- `ALL_USERS` — all AFTERTRACE users;
- `AI_SUBSCRIBERS` — users with a current ACTIVE subscription whose enabled plan has `ai_enabled = TRUE`;
- `FREE_USERS` — users without such an active AI-enabled subscription. FREE users with remaining one-time trial points remain FREE for announcement audience purposes;
- `SPECIFIC_USERS` — only the explicit ids stored in controlled announcement metadata.

Recipient insertion is unique on notification + user, so retry cannot duplicate a recipient row.

This synchronous fan-out is intentionally acceptable for current prelaunch scale. Cloudflare Queue remains deferred until volume/fan-out demonstrates a need.

## Customer notification-center HTTP API — authored this run

New `apps/api/src/worklog/notification-routes.ts` provides provider-neutral Web-session routes:

- `GET /api/v1/notifications` — list IN_APP items + unread count;
- `PATCH /api/v1/notifications/:id/read` — durable single-item read;
- `POST /api/v1/notifications/read-all` — durable mark-all-read.

Authorization resolves signed Web session -> durable AFTERTRACE `userId`; it does not depend on Google email, LINE id, Apple id or OA friendship.

Origin/CORS/no-store handling follows the existing account/native Web route boundary.

## Admin ANNOUNCEMENT HTTP API — authored this run

New `apps/api/src/admin/notification-routes.ts` provides a separately mounted Admin surface so the large legacy Admin route file did not need to be expanded further.

Current routes:

- `GET /api/v1/admin/notifications/announcements`;
- `GET /api/v1/admin/notifications/announcements/:id`;
- `POST /api/v1/admin/notifications/announcements/preview`;
- `POST /api/v1/admin/notifications/announcements`;
- `POST /api/v1/admin/notifications/announcements/:id/send`;
- `DELETE /api/v1/admin/notifications/announcements/:id`.

Create mode is explicit:

- `DRAFT`;
- `SEND_NOW`;
- `SCHEDULED`.

Scheduled creation requires a valid future timestamp. Preview is non-persisting and preserves exact audience/channel selection. `SEND_NOW` creates then claims/fans out through the same durable dispatch path. Scheduled dispatch by Cron is not wired yet.

Admin authentication remains the existing signed Admin session. Actor username is persisted on authored announcements; cancellation also records the cancelling actor in metadata.

## Worker boundary — authored this run

`apps/api/src/worker.ts` now mounts:

- `/api/v1/notifications/*`;
- `/api/v1/admin/notifications/*`.

Both are routed before migration-era Gemini/LINE runtime initialization, so opening the notification center or Admin announcement screen does not construct retired LINE attachment/Gemini product runtime.

Admin notification routing is checked before the generic `/api/v1/admin/*` mount, avoiding route shadowing by the legacy Admin router.

## Tests authored this run

New:

- `apps/api/src/worklog/notifications.test.ts`;
- `apps/api/src/worklog/notification-routes.test.ts`;
- `apps/api/src/admin/notification-routes.test.ts`.

Coverage authored includes:

- shared SYSTEM input normalization and user-scoped boundary;
- at least one delivery channel is required;
- empty SPECIFIC_USERS cannot broaden to ALL_USERS;
- explicit user ids are deduplicated;
- durable Web session user id is used for center lookup;
- other users' recipient rows cannot be marked read through the route contract;
- mark-all-read remains scoped to the signed user;
- Admin preview does not persist;
- Admin preview retains exact SPECIFIC_USERS ids;
- SEND_NOW uses create + dispatch and returns recipient summary;
- empty SPECIFIC_USERS is rejected before persistence.

Status for all above: **AUTHORED / NOT RUN**.

Repository SQL fan-out/idempotency still requires real PostgreSQL execution before it may be considered verified.

## Commits in this run

All commits contain `[skip ci]`:

- `337f36ad` — add notification service contract;
- `930ad495` — add durable notification persistence;
- `f8755711` — add notification center API;
- `19a7bc08` — add Admin announcement API;
- `a24b3335` — mount notification APIs before legacy runtime;
- `369b7d2e` — cover notification domain rules;
- `f55da092` — cover notification center routes;
- `3317fed2` — cover Admin announcement routes;
- `75563f80` — bound notification event keys safely;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Notification work from this run

- `notifications.ts` — **AUTHORED / NOT RUN**;
- `drizzle-notifications.ts` — **AUTHORED / NOT RUN**;
- `notification-routes.ts` — **AUTHORED / NOT RUN**;
- `admin/notification-routes.ts` — **AUTHORED / NOT RUN**;
- worker route mounts — **AUTHORED / NOT RUN**;
- `notifications.test.ts` — **AUTHORED / NOT RUN**;
- `notification-routes.test.ts` — **AUTHORED / NOT RUN**;
- `admin/notification-routes.test.ts` — **AUTHORED / NOT RUN**;
- PostgreSQL SYSTEM idempotency smoke — **NOT RUN**;
- PostgreSQL announcement audience/fan-out smoke — **NOT RUN**;
- Admin announcement HTTP E2E — **NOT RUN**;
- Web notification-center HTTP E2E — **NOT RUN**.

### Existing target work still awaiting executable verification

- API TypeScript typecheck — **NOT RUN**;
- API focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- Web TypeScript typecheck / Vitest / production build — **NOT RUN**;
- Drizzle canonical baseline regeneration — **NOT RUN**;
- baseline guard — **NOT RUN**;
- clean Dev/Prod rebuild — **NOT RUN**;
- PostgreSQL concurrent provider-provisioning smoke — **NOT RUN**;
- native GROUP/manual Record Dev HTTP E2E — **NOT RUN**;
- PWA browser/install/speech smoke — **NOT RUN**.

No test in this run is labelled PASS or RUNTIME VERIFIED.

Execution environment check this run: there is still no mounted AFTERTRACE checkout, and direct `git ls-remote https://github.com/ryan19910912/after-trace.git refs/heads/revive/line-worklog` failed with `Could not resolve host: github.com`. GitHub repository source read/write remains available through the connected GitHub service, but that is not executable validation.

## Known blockers / risks

1. **Executable validation remains the immediate release blocker.** New TypeScript, Hono routes and SQL have not been compiled/executed.
2. **Canonical `drizzle/0000` remains behind current target schema.** Notification/auth/public-account/product schema must be regenerated into a clean canonical baseline before database rebuild/deploy.
3. **Announcement audience SQL is source-reviewed only.** Real PostgreSQL must verify ALL/FREE/AI/SPECIFIC audience fan-out, JSONB specific-user selection and retry idempotency.
4. **Scheduled ANNOUNCEMENT dispatch is not connected to Worker `scheduled()` yet.** The repository can dispatch a scheduled row, but the single shared ~5 minute Cron handler still has to claim due announcements/tasks.
5. **Push is schema/state only.** Subscription CRUD, preferences API, VAPID/Web Push delivery, invalid-endpoint revocation, service-worker push handlers and iOS installed-PWA smoke remain incomplete.
6. **Notification UI is not wired.** Web/PWA still needs top-right bell/unread center plus the required display name / 帳號 ID / copy UI.
7. **Admin announcement backend exists but Admin UI does not.** Audience/channel/schedule preview, explicit confirmation, cancellation and delivery summary still need the admin frontend.
8. **SYSTEM primitive has no domain callers yet.** Payment/subscription/trial/AI-limit events still need deterministic calls with stable event keys.
9. **Google Login and Apple Login callbacks remain incomplete.** Provider-neutral persistence is ready; LINE is currently the first migrated provider.
10. **FREE one-time AI trial issuance/runtime remains not implemented to the latest contract.** Existing legacy Grant infrastructure should be reused cleanly, but new account provisioning must issue the configured trial idempotently rather than the retired hard-coded legacy FREE_INITIAL behavior.
11. **Paid AI entitlement/hard-cap runtime and task/reminder execution remain incomplete.**

## Exact next run order

1. If an executable checkout becomes available, stop adding speculative layers long enough to run/fix:
   - API TypeScript typecheck;
   - focused notification/auth/account/native-GROUP/manual-Record/schema tests;
   - Web TypeScript typecheck + focused tests + production build;
   - PostgreSQL notification idempotency/fan-out smoke if a test database is available.
   Never mark them PASS without actual execution.
2. If executable checkout is still unavailable, implement the **Web/PWA authenticated account header + notification center UI**:
   - load `/api/v1/account/profile`;
   - show display name + `帳號 ID`;
   - one-tap copy with visible `已複製` confirmation;
   - notification bell/unread count;
   - notification center list with category/title/body/time/read state;
   - mark one/read-all actions;
   - keep narrow PWA layout usable without provider identity exposure.
3. Implement Admin ANNOUNCEMENT frontend against the new backend:
   - title/body;
   - audience ALL/FREE/AI/SPECIFIC;
   - IN_APP/PUSH selection;
   - DRAFT/SEND_NOW/SCHEDULED;
   - preview + explicit send confirmation;
   - cancel pending scheduled item;
   - delivery summary/detail.
4. Add Web Push subscription/preferences APIs and explicit `開啟通知` UX. Never auto-prompt permission. Update service worker push/notificationclick handlers and degrade to durable IN_APP on unsupported/denied push.
5. Add native Tasks/reminders and one shared scheduled handler/Cron (~5 minutes) that claims due TASK reminders + scheduled ANNOUNCEMENT dispatch idempotently. Do not create one Cron per task. Queue remains conditional on volume.
6. Wire deterministic SYSTEM events for subscription/payment/trial/AI-limit state using stable event keys.
7. Implement the latest FREE one-time AI trial contract:
   - Admin `free_initial_ai_trial_points` setting;
   - idempotent grant once per account;
   - no monthly refresh / no retroactive resize;
   - shared reservation/settlement/provider-cost audit;
   - exhausted trial -> FREE manual continues + AI Pro upgrade offer.
8. Complete Google Login, then LINE provider UI polish, then Apple Login. Account linking remains explicit/authenticated and must never merge by email heuristic.
9. Regenerate clean canonical `drizzle/0000`, run baseline guard/tests, rebuild disposable Dev/Prod as appropriate, then run auth/account/notification/PWA runtime E2E.
10. Continue AI Pro per-user entitlement/caps, AI capture/search/related records/summary/rewrite, Chrome extension and final legacy LINE product cleanup.

## Estimated remaining development time

Current estimate: **about 41–77 focused development hours**.

Approximate remaining buckets:

- executable validation + canonical baseline/rebuild + current free/PWA/native-GROUP/account/notification E2E: 7–13h;
- Web account header + notification center + Admin announcement UI: 4–8h;
- Push subscriptions/preferences/delivery + Tasks/reminders/shared Cron + iOS/browser smoke: 7–12h;
- FREE one-time AI trial issuance/accounting/Admin control: 3–6h;
- Google/LINE/Apple login completion + account UI/Admin cleanup: 4–8h;
- AI Pro per-user entitlement/capture/search/hard caps: 10–18h;
- Related Records/range summary/rewrite: 4–7h;
- Chrome extension/final readiness/legacy cleanup: 2–5h.

Tighten the estimate after the first executable typecheck/test pass, regenerated canonical baseline and real Dev runtime E2E.
