# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 Web Push subscription/preferences + explicit PWA opt-in authored; outbound delivery/runtime verification still pending

AFTERTRACE remains a Web + PWA-first work-memory product with a committed Chrome extension fast-capture surface. LINE is retired from the core Record/group/AI product surface. LINE remains only as:

- one supported login provider;
- the official LINE OA external customer-support contact channel.

Current prelaunch Dev and Prod data are disposable. Clean canonical baseline/database/application rebuilds are allowed while there is no real customer data. Once real customer/durable Prod data exists, destructive Prod permission expires and requires a new explicit decision.

## Current commercial/product contract

Launch commercial shape is exactly:

- `FREE` — NT$0;
- `AI_PRO` — NT$99/month;
- no one-time AI top-up product and no extra paid tier in V1.

FREE remains a complete manual product. A newly eligible FREE account receives one idempotent, one-time AI trial allowance using internal AI points.

Trial rules remain:

- Admin configures `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`;
- no TWD trial price/value in Admin or customer UI;
- point amount is never hard-coded;
- trial is issued once per AFTERTRACE account and never refreshes monthly;
- later template changes affect only accounts that have not received the trial;
- already-issued balances are never resized retroactively;
- provider-backed trial calls use the normal reservation/settlement/provider-cost audit path;
- when trial points reach zero, provider-backed AI stops while FREE manual features continue.

AI Pro retains monthly internal resource/point limits plus a configurable provider-cost hard cap in TWD. A planning value around NT$30/month may be used as operator configuration only, never as a customer balance or source-code constant.

## Product foundation retained from earlier batches

Current accepted source-authored foundation includes:

- provider-neutral Google / LINE / Apple identity binding model;
- Google + LINE first implementation priority; Apple follows if sequencing is needed;
- immutable opaque `public_account_id` / `帳號 ID` and Admin exact lookup foundation;
- no silent account merge from matching provider email/id/display name;
- current LINE Login callback provisions through the provider-neutral account service;
- native AFTERTRACE GROUP membership/invites independent from LINE group authorization;
- free manual Record CRUD/search with nullable event date and no required AI title/entities;
- capture-first PWA/browser speech foundation without AFTERTRACE provider AI;
- durable notification domain with exactly `ANNOUNCEMENT | SYSTEM | TASK` and independent `IN_APP | PUSH` channel concepts;
- notification recipient rows preserve durable `read_at` independently from push delivery state;
- Admin ANNOUNCEMENT backend + frontend for ALL/FREE/AI/SPECIFIC audience, draft/send-now/scheduled lifecycle, preview, cancellation and delivery summary;
- SYSTEM notification creation with user-scoped deterministic idempotency keys;
- authenticated Web/PWA account header with notification bell/unread count, display name, copyable `帳號 ID`;
- Chrome extension scaffold/contract for compact fast capture, without extension-only durable Record storage;
- LINE OA support-only boundary, with no return of legacy 小跡/Reply cache/LINE GROUP/AI-responsibility product behavior.

## Web Push subscription/preferences batch — authored this run

This run completed the next bounded notification batch from the previous checkpoint. It adds the durable browser/PWA subscription and preference path, but **does not yet claim outbound Web Push delivery is implemented or runtime verified**.

### API push domain/service

New `apps/api/src/worklog/push-notifications.ts` defines a provider-neutral push delivery-endpoint domain:

- subscription belongs to the authenticated AFTERTRACE `userId`, never to Google/LINE/Apple identity;
- endpoint must be bounded HTTPS with no embedded basic-auth credentials;
- `p256dh` and `auth` keys are required/bounded;
- user-agent/platform are optional bounded delivery metadata;
- preferences are independent booleans for `ANNOUNCEMENT`, `SYSTEM`, `TASK` PUSH;
- empty preference patches fail closed;
- durable IN_APP state is not modified by push preferences.

### PostgreSQL push persistence

New `apps/api/src/worklog/drizzle-push-notifications.ts` reuses the notification schema already authored in `schema-worklog-notification.ts`:

- counts only non-revoked subscriptions for the authenticated user;
- defaults PUSH preferences to enabled until the user stores an explicit preference row;
- upserts a browser endpoint for the same AFTERTRACE user;
- refuses to silently reassign an existing endpoint owned by a different AFTERTRACE account (`PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT`);
- revocation is soft/durable through `revoked_at`;
- preference updates use one per-user row.

The schema keeps push subscriptions as device/browser delivery endpoints only. They are not account identity and do not replace `public_account_id` or provider-neutral user identity.

### Authenticated customer API

`apps/api/src/worklog/notification-routes.ts` now exposes, under the existing authenticated `/api/v1/notifications` surface:

- `GET /push` — server capability/public VAPID key + active subscription count + preferences;
- `POST /push/subscription` — register/re-activate the current browser/PWA subscription;
- `DELETE /push/subscription` — revoke one endpoint owned by the current user;
- `PATCH /push/preferences` — update category-specific PUSH preferences.

Rules retained:

- durable signed Web session -> provider-neutral AFTERTRACE `userId` authorization;
- no LINE identity dependency;
- CORS stays exact-origin;
- subscription registration fails closed with `PUSH_NOT_CONFIGURED` when the server public push key is absent;
- an endpoint already owned by another AFTERTRACE account returns conflict rather than being silently transferred.

### Web/PWA API + browser push helpers

`apps/web/src/account-notification-api.ts` now maps the authenticated push state, subscription registration/revocation, and preference APIs through the same bearer Web session.

New `apps/web/src/browser-push.ts` provides the browser boundary:

- capability detection for Service Worker + PushManager + Notification;
- explicit `enableBrowserPush()` flow;
- VAPID public-key base64url conversion;
- current subscription lookup;
- explicit unsubscribe helper;
- bounded browser platform metadata;
- iOS/iPadOS wording that distinguishes installed Home Screen PWA push from a normal Safari tab.

`Notification.requestPermission()` is called only inside `enableBrowserPush()`. That helper is only invoked from the explicit customer `開啟通知` button; no bootstrap/effect path asks for notification permission automatically.

### PWA notification settings UI

New `apps/web/src/PushNotificationSettings.tsx` is embedded inside the authenticated notification center.

Customer behavior:

- `開啟通知` explicitly requests browser permission and then registers the browser/PWA endpoint with AFTERTRACE;
- `停用此裝置` revokes the backend endpoint and unsubscribes the current browser subscription;
- user can independently toggle PUSH for 公告通知 / 系統通知 / 待辦通知;
- unsupported/denied push leaves durable IN_APP notifications working;
- UI says `IN_APP 通知永遠保留；PUSH 是額外提醒。`;
- iPhone/iPad guidance tells the user to add AFTERTRACE to the Home Screen and then explicitly choose `開啟通知`;
- the UI does not claim that a normal Safari tab is identical to the installed PWA push path.

### Service Worker push/click handling

`apps/web/public/sw.js` now handles source-authored push payload display and click navigation:

- bounded title/body parsing;
- optional notification id/tag;
- same-origin relative deep-link validation;
- notification click focuses/navigates an existing AFTERTRACE window or opens one;
- no automatic capture or authenticated Record/API response caching was added.

### Important boundary: outbound push transport is still incomplete

This batch establishes subscription storage/preferences/customer opt-in/service-worker receiving behavior. It does **not** yet implement the server-side Web Push sender/VAPID signing path.

Still required before PUSH can be called runtime complete:

- private VAPID credential configuration and server-side sender transport;
- bounded pending recipient/subscription delivery scan;
- category preference check before PUSH delivery;
- idempotent recipient delivery state transitions;
- `last_success_at` updates on successful endpoint delivery;
- permanent-invalid endpoint revocation (for example provider 404/410 equivalents) without deleting IN_APP history;
- transient failure/retry policy;
- scheduled ANNOUNCEMENT + TASK integration through one shared Worker `scheduled()` handler.

Until that path is implemented and runtime tested, `PUSH` configuration in Admin represents requested delivery intent, not a claim that actual device delivery is verified.

## Files changed in this run

- `apps/api/src/worklog/push-notifications.ts` — new push domain/service;
- `apps/api/src/worklog/drizzle-push-notifications.ts` — new push persistence;
- `apps/api/src/worklog/notification-routes.ts` — authenticated push state/subscription/preferences endpoints;
- `apps/api/src/worklog/push-notifications.test.ts` — new domain tests;
- `apps/api/src/worklog/notification-routes.test.ts` — push route tests added;
- `apps/web/src/account-notification-api.ts` — Web Push API client/mapping;
- `apps/web/src/account-notification-api.test.ts` — push API mapping tests added;
- `apps/web/src/browser-push.ts` — browser capability/subscription helpers;
- `apps/web/src/browser-push.test.ts` — browser push helper tests;
- `apps/web/src/PushNotificationSettings.tsx` — explicit customer push settings;
- `apps/web/src/AuthenticatedAppChrome.tsx` — embeds push settings in notification center;
- `apps/web/src/account-notification.css` — push settings styles;
- `apps/web/public/sw.js` — push display/click handling.

## Commits in this run

All development commits contain `[skip ci]`:

- `31f426c8` — add push notification domain service;
- `327843f4` — add push notification persistence;
- `7ae98422` — add authenticated push settings routes;
- `a076c7b4` — author push notification domain tests;
- `48f90c3d` — add Web Push API client contract;
- `7cc17ea6` — add explicit browser push helpers;
- `7472d8f7` — add explicit PWA push settings UI;
- `3b6b992d` — wire push controls into notification center;
- `eab44004` — style push notification settings;
- `3930e0e4` — add service worker push handling;
- `aac2e866` — author push notification route tests;
- `693662eb` — author Web Push API mapping tests;
- `3650f060` — author browser push helper tests;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Tests authored/updated this run

- `apps/api/src/worklog/push-notifications.test.ts` — **AUTHORED / NOT RUN**;
- `apps/api/src/worklog/notification-routes.test.ts` push cases — **AUTHORED (updated) / NOT RUN**;
- `apps/web/src/account-notification-api.test.ts` push cases — **AUTHORED (updated) / NOT RUN**;
- `apps/web/src/browser-push.test.ts` — **AUTHORED / NOT RUN**.

### API/Web executable verification still required

- API TypeScript typecheck — **NOT RUN**;
- push notification focused Vitest — **NOT RUN**;
- notification route focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- Web TypeScript typecheck — **NOT RUN**;
- account-notification/browser-push focused Vitest — **NOT RUN**;
- full Web Vitest — **NOT RUN**;
- Web production build — **NOT RUN**;
- browser `開啟通知` explicit-permission smoke — **NOT RUN**;
- browser register/revoke/preferences smoke — **NOT RUN**;
- service-worker push display/click smoke — **NOT RUN**;
- installed iOS/iPadOS Home Screen PWA push smoke — **NOT RUN**;
- Android/desktop PWA push smoke — **NOT RUN**;
- PostgreSQL endpoint ownership/revocation/preferences smoke — **NOT RUN**.

### Existing Admin/schema/runtime verification still required

- Admin TypeScript typecheck/focused/full tests/build — **NOT RUN**;
- `/announcements` browser smoke — **NOT RUN**;
- PostgreSQL SYSTEM idempotency smoke — **NOT RUN**;
- PostgreSQL announcement audience/fan-out smoke — **NOT RUN**;
- provider-provisioning concurrency smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- clean Dev/Prod rebuild — **NOT RUN**;
- native GROUP/manual Record Dev HTTP E2E — **NOT RUN**.

### Execution environment result this run

- executable AFTERTRACE checkout discovery — **FAIL** (no mounted checkout found);
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL** with `Could not resolve host: github.com`;
- therefore no TypeScript/Vitest/build/browser/PostgreSQL/runtime command is claimed **PASS** or **RUNTIME VERIFIED**.

GitHub source read/write through the repository connector remains available, but source inspection is not executable validation.

## Known blockers / risks

1. **Executable validation remains an immediate release blocker.** Push/Admin/Web/API/extension source is not compiled/executed in this environment.
2. **Canonical `drizzle/0000` remains behind the current target schema.** Regenerate before clean DB rebuild/deploy.
3. **Outbound Web Push delivery is not implemented yet.** No private VAPID sender/recipient delivery loop means device PUSH is not runtime complete even though subscription opt-in/storage and Service Worker receiving code exist.
4. **Invalid subscription lifecycle is only user-revocation today.** Automatic permanent-invalid endpoint revocation and last-success/failure delivery bookkeeping require the sender path.
5. **Scheduled ANNOUNCEMENT/TASK dispatch is not connected to Worker `scheduled()` yet.**
6. **Native Task/reminder persistence/runtime is still incomplete.**
7. **SYSTEM notification primitive still needs deterministic domain callers for payment/subscription/trial/AI-limit events.**
8. **FREE one-time AI trial issuance/runtime is still not implemented to the latest contract.**
9. **Google Login and Apple Login callbacks remain incomplete.** LINE Login is only one provider and must not regain core product authority.
10. **Paid AI entitlement/hard-cap runtime remains incomplete.**
11. **Extension auth/session handoff, Source picker and durable Record persistence remain incomplete.**
12. Existing legacy Admin plan/group screens still contain LINE-era/ONE_TIME terminology in places. Do not extend those obsolete concepts; clean them as accepted target screens replace them.

## Exact next run order

1. If an executable checkout becomes available, pause feature expansion and run/fix in this order:
   - API typecheck;
   - `push-notifications.test.ts` + push cases in `notification-routes.test.ts`;
   - Web typecheck;
   - `account-notification-api.test.ts` + `browser-push.test.ts`;
   - Web build;
   - Admin typecheck + announcement focused tests/build;
   - PostgreSQL push subscription ownership/preferences smoke.
2. If executable checkout is still unavailable, complete the outbound Push delivery foundation as the next bounded shared-service batch:
   - private VAPID/server delivery configuration;
   - bounded pending recipient + active subscription lookup;
   - category preference filtering;
   - idempotent `PENDING -> SENT/FAILED/SKIPPED` delivery transitions;
   - `last_success_at` on success;
   - permanent-invalid endpoint revocation without touching IN_APP history;
   - safe transient failure/retry behavior;
   - tests authored, never claimed passed without execution.
3. Then implement native Tasks/reminders and one global Worker `scheduled()` handler at approximately five-minute cadence:
   - bounded due reminder scan;
   - bounded scheduled ANNOUNCEMENT scan;
   - deterministic/idempotent notification creation and dispatch;
   - never one Cron per task;
   - Cloudflare Queue only if actual fan-out/volume justifies it.
4. Wire deterministic SYSTEM callers for payment/subscription/trial/AI-limit events.
5. Implement FREE one-time AI trial Admin configuration/issuance/reservation/settlement/accounting.
6. Complete Google + LINE auth priority path and Apple callback next, preserving provider-neutral identity and no silent email merge.
7. Return to Chrome extension auth/API persistence once shared auth/Record/entitlement APIs are stable enough.
8. Regenerate canonical `drizzle/0000`, rebuild disposable Dev/Prod as appropriate, run runtime E2E, then continue AI Pro search/enrichment/related-record/summary/rewrite and final legacy LINE cleanup.

## Next run checklist

- [ ] Read all durable docs in Development Policy order.
- [ ] Check whether an executable checkout is finally available.
- [ ] Never touch GitHub Actions.
- [ ] Never touch `apps/api/verify-admin-schema.mjs` without separate approval.
- [ ] Prefer executable validation first if available.
- [ ] Otherwise implement outbound Push delivery before calling PUSH complete.
- [ ] Keep notification category separate from channel.
- [ ] Never auto-prompt notification permission on initial PWA load.
- [ ] Keep IN_APP durable if PUSH is unavailable/denied/fails.
- [ ] Use one shared Worker scheduler for scheduled announcements + due tasks; never one Cron per task.

## Estimated remaining development time

Current estimate: **about 36–70 focused development hours**.

Approximate remaining buckets:

- executable validation + canonical baseline/rebuild + current free/PWA/native-GROUP/account/notification/Admin E2E: 7–13h;
- outbound Web Push sender/delivery lifecycle + browser/iOS smoke: 3–6h;
- Tasks/reminders + shared scheduled handler: 4–7h;
- FREE one-time AI trial issuance/accounting/Admin control: 3–6h;
- Google/LINE/Apple login completion + account UI/Admin cleanup: 4–8h;
- AI Pro per-user entitlement/capture/search/hard caps: 9–16h;
- Related Records/range summary/rewrite: 3–6h;
- Chrome extension auth/API integration, browser smoke, packaging and final readiness/legacy cleanup: 3–8h.

Tighten the estimate after the first executable API/Web/Admin typecheck/test pass, regenerated canonical baseline and real Dev runtime E2E.
