# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 Admin ANNOUNCEMENT frontend authored; executable/browser/schema verification still pending

AFTERTRACE remains Web + PWA-first work memory with a committed Chrome extension fast-capture surface. LINE is no longer a Record/group/AI product surface. LINE remains only as:

- one supported login provider;
- official LINE OA external customer-support contact channel.

Current prelaunch Dev and Prod data are disposable. Clean canonical baseline/database/application rebuilds are allowed while there is no real customer data. Once real customer/durable Prod data exists, destructive Prod permission expires and requires a new explicit decision.

## Current commercial/product contract retained

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

Current accepted implementation foundation includes:

- provider-neutral Google / LINE / Apple identity binding model;
- Google + LINE first implementation priority; Apple follows if sequencing is needed;
- provider email/id/display-name facts are not core account identity;
- no silent account merge from matching email;
- immutable opaque `public_account_id` / `帳號 ID` and Admin exact lookup foundation;
- current LINE Login callback provisions through the provider-neutral account service;
- native AFTERTRACE GROUP membership/invites independent from LINE group authorization;
- free manual Record CRUD/search with nullable event date and no required AI title/entities;
- capture-first PWA/browser speech foundation without AFTERTRACE provider AI;
- durable notification domain with exactly `ANNOUNCEMENT | SYSTEM | TASK` and independent `IN_APP | PUSH` channel concepts;
- notification recipient rows preserve durable `read_at` independently from push delivery state;
- Admin ANNOUNCEMENT backend supports ALL/FREE/AI/SPECIFIC audience, draft/send-now/scheduled lifecycle, preview, cancellation and delivery summary;
- SYSTEM notification creation uses user-scoped deterministic idempotency keys;
- authenticated Web/PWA shared chrome/account/notification-center foundation is source-authored;
- Chrome extension capture contract/scaffold exists but auth/API persistence is not wired yet;
- LINE OA remains support-only and must not reintroduce legacy Record/group/AI bot behavior.

## Admin ANNOUNCEMENT frontend — authored this run

A dedicated Admin announcement management surface now exists at:

- `apps/admin/src/AdminAnnouncementsPage.tsx`;
- Admin URL path: `/announcements`.

The page reuses the same Admin session stored under `aftertrace.admin.session`; it does not create a second admin identity/auth system.

Implemented frontend behavior:

- authenticated announcement list;
- announcement detail/status inspection;
- create form for title/body;
- audience selection: `ALL_USERS`, `FREE_USERS`, `AI_SUBSCRIBERS`, `SPECIFIC_USERS`;
- channel selection independent from category: `IN_APP` and/or `PUSH`;
- lifecycle selection: `DRAFT`, `SEND_NOW`, `SCHEDULED`;
- scheduled local datetime converted to ISO for backend validation/persistence;
- optional bounded deep-link input;
- preview must be created before the UI enables create/send confirmation;
- `SEND_NOW` additionally requires an explicit browser confirmation showing title/audience/channels;
- existing DRAFT/SCHEDULED announcements can be manually sent only after explicit confirmation;
- existing DRAFT/SCHEDULED announcements can be cancelled with explicit confirmation;
- recipient/unread/push-success/push-failure counts are visible from backend summary facts;
- no arbitrary Admin-authored message is labelled SYSTEM; this surface creates ANNOUNCEMENT only.

### SPECIFIC_USERS safety

The Admin UI intentionally fails closed:

- `SPECIFIC_USERS` with zero selected users is rejected before preview;
- broad audiences strip stale specific-user ids rather than accidentally carrying hidden recipients;
- duplicate selected ids are deduplicated;
- user lookup reuses the existing Admin user search, so `public_account_id` can be used as the operator-facing lookup key where backend search supports it;
- selected users are shown with customer-facing 帳號 ID/display name when available;
- the browser never converts an empty specific list into ALL_USERS.

### Announcement API client

New `apps/admin/src/announcement-api.ts` provides a bounded typed client for:

- list announcements;
- fetch detail;
- preview;
- create;
- send;
- cancel;
- specific-user lookup adapter through the existing provider-neutral Admin user search.

It uses the same Bearer Admin session and existing timestamp normalization policy as the rest of Admin.

### Form/lifecycle helpers

New `apps/admin/src/announcement-form.ts` centralizes client-side safety and labels:

- required title/body bounds;
- at-least-one-channel requirement;
- SPECIFIC_USERS exact-id safety;
- scheduled local timestamp normalization;
- send/cancel lifecycle eligibility;
- audience/status/mode labels.

### Admin entry routing

`apps/admin/src/main.tsx` now mounts `/announcements` to `AdminAnnouncementsPage` while preserving existing `/`, `/profitability`, and `/pricing-calculator` behavior.

The page currently links back to the Admin home. A dedicated tab/link inside the large legacy `App.tsx` root navigation is not yet added; the route is usable directly but root-navigation discoverability is a small remaining Admin UX polish item.

## Chrome extension state retained

`docs/WORKLOG_EXTENSION_POLICY.md` remains authoritative. Current `apps/extension` scaffold contains Manifest V3 popup/context-capture foundations for:

- quick text shell;
- selected webpage text staging from explicit context-menu action;
- active page title/URL context;
- browser speech input attempt/fallback;
- explicit visible-tab screenshot preview.

Important extension limits still apply:

- durable auth/session handoff not wired;
- Source/group list not wired;
- save/persistence intentionally not wired until normal AFTERTRACE APIs are reused;
- screenshot/voice are local UI capture only, not end-to-end Record creation;
- no automatic full-page/history/clipboard/tab/microphone capture;
- no browser/runtime verification executed.

## Notification backend/customer center state retained

Backend foundation remains in:

- `apps/api/src/worklog/notifications.ts`;
- `apps/api/src/worklog/drizzle-notifications.ts`;
- `apps/api/src/worklog/notification-routes.ts`;
- `apps/api/src/admin/notification-routes.ts`.

Customer Web/PWA notification center/account chrome source remains authored. Push remains independent and incomplete.

Scheduled announcement persistence exists, but the shared Worker scheduled handler/Cron is not connected yet.

## Commits in this run

All commits contain `[skip ci]`:

- `a1e9852a` — add dedicated Admin ANNOUNCEMENT API client;
- `eb0624d7` — add announcement form/lifecycle safety helpers;
- `788c095d` — add Admin announcement management page;
- `d947c545` — route `/announcements` from Admin entrypoint;
- `c76fae67` — author announcement form/lifecycle safety tests;
- `52ade9e0` — author Admin announcement API tests;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Tests authored this run

- `apps/admin/src/announcement-form.test.ts` — **AUTHORED / NOT RUN**;
  - empty SPECIFIC_USERS rejection;
  - exact/deduplicated user id behavior;
  - broad-audience stale-id stripping;
  - channel-required rule;
  - scheduled datetime normalization;
  - DRAFT/SCHEDULED send/cancel action eligibility.
- `apps/admin/src/announcement-api.test.ts` — **AUTHORED / NOT RUN**;
  - Admin Bearer token on preview;
  - bounded preview payload;
  - dedicated send endpoint;
  - dedicated cancel endpoint.

### Admin executable verification still required

- Admin TypeScript typecheck — **NOT RUN**;
- Admin focused Vitest (`announcement-form`, `announcement-api`) — **NOT RUN**;
- Admin full Vitest — **NOT RUN**;
- Admin production build — **NOT RUN**;
- browser login/session smoke for `/announcements` — **NOT RUN**;
- ALL/FREE/AI/SPECIFIC preview/create browser smoke — **NOT RUN**;
- SEND_NOW explicit confirmation/browser smoke — **NOT RUN**;
- scheduled creation/cancellation/browser smoke — **NOT RUN**;
- recipient/delivery summary browser smoke — **NOT RUN**.

### Existing Web/PWA work awaiting executable verification

- Web TypeScript typecheck — **NOT RUN**;
- Web focused/full Vitest — **NOT RUN**;
- Web production build — **NOT RUN**;
- account profile / notification browser smoke — **NOT RUN**;
- account-id clipboard/fallback smoke — **NOT RUN**;
- PWA responsive/install/speech smoke — **NOT RUN**.

### Existing backend/schema/runtime work awaiting executable verification

- API TypeScript typecheck — **NOT RUN**;
- focused notification/auth/account/native-GROUP/manual-Record/schema tests — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- PostgreSQL SYSTEM idempotency smoke — **NOT RUN**;
- PostgreSQL announcement audience/fan-out smoke — **NOT RUN**;
- provider-provisioning concurrency smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- clean Dev/Prod rebuild — **NOT RUN**;
- native GROUP/manual Record Dev HTTP E2E — **NOT RUN**.

### Execution environment result this run

- executable AFTERTRACE checkout discovery — **FAIL**;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL** with `Could not resolve host: github.com`;
- therefore no package TypeScript/Vitest/build/browser/runtime command was claimed PASS.

GitHub source read/write through the repository connector remains available, but it is not equivalent to executable validation.

## Known blockers / risks

1. **Executable validation remains the immediate release blocker.** New Admin/Web/API/extension code is source-authored but not compiled/executed in this environment.
2. **Canonical `drizzle/0000` remains behind the current target schema.** Regenerate before clean database rebuild/deploy.
3. **Admin announcement root-navigation discoverability is incomplete.** `/announcements` works as the authored route, but the existing large `App.tsx` tab row does not yet link to it.
4. **PUSH runtime is not complete.** Admin can configure the intended PUSH channel, but subscription CRUD/preferences/VAPID delivery/service-worker push handling still need implementation/runtime verification. Durable IN_APP remains the source of truth.
5. **Scheduled ANNOUNCEMENT/TASK dispatch is not connected to Worker `scheduled()` yet.**
6. **SYSTEM notification primitive still needs deterministic domain callers such as payment/subscription/trial/AI-limit events.**
7. **Google Login and Apple Login callbacks remain incomplete.** LINE Login is only one provider and must not regain core product authority.
8. **FREE one-time AI trial issuance/runtime is still not implemented to the latest contract.**
9. **Paid AI entitlement/hard-cap runtime and native task/reminder execution remain incomplete.**
10. **Extension auth/session handoff, Source picker and durable Record persistence remain incomplete.**
11. Existing legacy Admin plan/group screens still contain LINE-era/ONE_TIME terminology in places. Do not extend those obsolete concepts; clean them as the accepted target screens replace them.

## Exact next run order

1. If an executable checkout becomes available, pause feature expansion and run/fix:
   - Admin typecheck;
   - `announcement-form.test.ts` + `announcement-api.test.ts`;
   - Admin production build;
   - Web/API focused typecheck/tests;
   - load-unpacked extension smoke when feasible.
2. If executable checkout is still unavailable, continue the next bounded notification batch:
   - Push subscription persistence/API;
   - per-user PUSH preferences for ANNOUNCEMENT/SYSTEM/TASK where allowed;
   - explicit customer `開啟通知` UX only after user action;
   - service-worker push event/click handling without auto permission prompt;
   - invalid/revoked subscription lifecycle.
3. Then implement native Tasks/reminders and one shared Worker `scheduled()` handler at approximately 5-minute cadence:
   - bounded due reminder scan;
   - bounded scheduled ANNOUNCEMENT scan;
   - idempotent dispatch;
   - never one Cron per task;
   - Queue only if fan-out/volume justifies it.
4. Wire deterministic SYSTEM callers for payment/subscription/trial/AI-limit events.
5. Implement FREE one-time AI trial Admin configuration/issuance/accounting, then Google/LINE/Apple auth completion.
6. Return to Chrome extension after shared auth/Record/entitlement APIs are stable enough for real persistence.
7. Regenerate canonical `drizzle/0000`, rebuild disposable Dev/Prod as appropriate, run runtime E2E, then continue AI Pro search/enrichment/related-record/summary/rewrite and final legacy LINE cleanup.

## Next run checklist

- [ ] Read all durable docs in Development Policy order.
- [ ] Check whether an executable checkout is finally available.
- [ ] Never touch GitHub Actions.
- [ ] Never touch `apps/api/verify-admin-schema.mjs` without separate approval.
- [ ] Prefer executable validation first if available.
- [ ] Otherwise continue Push subscription/preferences as the next bounded shared-service batch.
- [ ] Keep notification category separate from channel.
- [ ] Never auto-prompt notification permission on initial PWA load.
- [ ] Keep IN_APP durable even if PUSH fails/denied.

## Estimated remaining development time

Current estimate: **about 39–75 focused development hours**.

Approximate remaining buckets:

- executable validation + canonical baseline/rebuild + current free/PWA/native-GROUP/account/notification/Admin E2E: 7–13h;
- Admin announcement root-navigation/final UX polish + notification history polish: 1–3h;
- Push subscriptions/preferences/delivery + Tasks/reminders/shared Cron + iOS/browser smoke: 7–12h;
- FREE one-time AI trial issuance/accounting/Admin control: 3–6h;
- Google/LINE/Apple login completion + account UI/Admin cleanup: 4–8h;
- AI Pro per-user entitlement/capture/search/hard caps: 10–18h;
- Related Records/range summary/rewrite: 4–7h;
- Chrome extension auth/API integration, browser smoke, packaging and final readiness/legacy cleanup: 3–8h.

Tighten the estimate after the first executable Admin/Web/API typecheck/test pass, regenerated canonical baseline and real Dev runtime E2E.
