# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, plus the latest subscription/account/support/notification policies when called out by the run prompt. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 authenticated Web/PWA account chrome + durable notification-center UI authored; executable/browser/schema verification still pending

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
- Admin exact `public_account_id` user lookup is already authored;
- native AFTERTRACE GROUP membership/invites exist without LINE group authorization;
- free manual Record CRUD/search supports nullable event date and no required AI title/entities;
- capture-first PWA/browser speech foundation exists and does not consume AFTERTRACE provider AI;
- notification schema/service defines exactly `ANNOUNCEMENT | SYSTEM | TASK` and independent `IN_APP | PUSH` delivery concepts;
- durable notification recipient rows preserve `read_at` and push state independently;
- Admin ANNOUNCEMENT backend supports ALL/FREE/AI/SPECIFIC audience, draft/send-now/scheduled lifecycle, preview, cancellation and delivery summary;
- SYSTEM notification creation has a user-scoped deterministic idempotency key;
- LINE OA remains support-only and must not reintroduce legacy Record/group/AI bot behavior.

## Authenticated Web/PWA app chrome — authored this run

New `apps/web/src/AuthenticatedAppChrome.tsx` is mounted once around the current Web route content from `apps/web/src/main.tsx`.

For an authenticated session it now provides the required shared top-right account surface across the Web/PWA routes without modifying each large route root independently:

- notification bell;
- visible unread badge when unread count is non-zero;
- user display name;
- visible `帳號 ID` label and immutable `publicAccountId`;
- one-tap account-id copy;
- visible `已複製` confirmation after successful copy;
- copy fallback for browsers where Clipboard API is unavailable;
- narrow mobile/PWA layout keeps `帳號 ID` and copy affordance visible rather than hiding them.

The account chrome reads the same signed Web session token already used by the current Web roots. It can obtain the token from the login callback hash before the child route persists it, then follows local session state through storage/hash/pageshow/focus/click synchronization.

Invalid/expired signed sessions from account or notification calls clear the shared local session instead of leaving a permanently stale authenticated chrome visible.

Provider identity fields are not exposed by this UI. It consumes only `/api/v1/account/profile`, whose customer-facing payload is `displayName + publicAccountId`.

Provider display-name snapshots are allowed to be absent. The Web parser therefore treats `displayName` as nullable and falls back to `AFTERTRACE 使用者`; `publicAccountId` remains mandatory.

## Web/PWA notification center — authored this run

The shared app chrome now consumes the durable notification backend through new `apps/web/src/account-notification-api.ts`.

Current customer behavior:

- initial authenticated load fetches `/api/v1/notifications`;
- unread count is shown on the bell;
- opening the bell shows the durable notification-center list;
- each item displays category, title, body, Taipei display time and read/unread state;
- category labels remain exactly the three product categories: `公告通知`, `系統通知`, `待辦通知`;
- one notification can be marked read through `PATCH /api/v1/notifications/:id/read`;
- all current notifications can be marked read through `POST /api/v1/notifications/read-all`;
- UI state updates only after the durable backend mutation succeeds;
- notification deep links are accepted only when they are same-product relative paths; absolute/protocol-relative/javascript links are not rendered as open actions;
- opening a valid deep link first persists read state, then navigates.

This UI does not confuse notification category with delivery channel. It is currently the IN_APP center; PUSH remains an independent delivery channel to be implemented later.

No browser push permission is requested anywhere in this run.

## Responsive notification/account styling — authored this run

New `apps/web/src/account-notification.css` adds:

- sticky shared account chrome;
- compact bell/unread badge;
- account display name and support account id presentation;
- one-tap copy feedback;
- desktop notification popover;
- fixed-width-safe mobile notification panel;
- unread visual state;
- mobile layout that preserves the required account-id label and copy control.

The existing Capture/Worklog/Subscription/Feedback/Help route implementations were not broadly rewritten; the chrome is shared from `main.tsx` to keep this batch bounded.

## Web contract tests authored this run

New `apps/web/src/account-notification-api.test.ts` covers source-level contracts for:

- provider-neutral `publicAccountId` parsing;
- nullable provider display-name snapshot handling;
- durable notification-center mapping;
- exactly three customer notification category labels;
- safe relative notification deep-link acceptance;
- rejection of external, protocol-relative and `javascript:` notification links.

Status: **AUTHORED / NOT RUN**.

The existing backend notification/account tests from prior runs also remain **AUTHORED / NOT RUN** because no executable checkout is available.

## Notification backend retained from previous checkpoint

The prior notification backend remains the current service boundary:

- `apps/api/src/worklog/notifications.ts` — shared domain contract;
- `apps/api/src/worklog/drizzle-notifications.ts` — durable repository, SYSTEM idempotency, ANNOUNCEMENT fan-out;
- `apps/api/src/worklog/notification-routes.ts` — customer IN_APP center/read routes;
- `apps/api/src/admin/notification-routes.ts` — Admin announcement API;
- `/api/v1/notifications/*` and `/api/v1/admin/notifications/*` are mounted before migration-era Gemini/LINE runtime initialization.

Audience rules retained:

- `ALL_USERS` — all AFTERTRACE accounts;
- `FREE_USERS` — accounts without a current active AI-enabled subscription, including FREE users who still have one-time trial points;
- `AI_SUBSCRIBERS` — current active AI-enabled subscription users;
- `SPECIFIC_USERS` — only explicit selected account ids; empty selection fails closed.

Scheduled announcement persistence exists, but the single shared Worker scheduled handler/Cron is not connected yet.

## Commits in this run

All commits contain `[skip ci]`:

- `ead58258` — add authenticated account + notification Web/PWA chrome, client, styling and contract tests;
- `01cd02f6` — align Web account profile parsing with nullable provider display-name snapshots;
- `a5b344d4` — keep `帳號 ID` and copy controls visible in narrow PWA/mobile layout;
- `af4e394f` — clear invalid/expired signed sessions from the shared account chrome;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Web/PWA work from this run

- `apps/web/src/account-notification-api.ts` — **AUTHORED / NOT RUN**;
- `apps/web/src/AuthenticatedAppChrome.tsx` — **AUTHORED / NOT RUN**;
- `apps/web/src/account-notification.css` — **AUTHORED / NOT RUN**;
- `apps/web/src/main.tsx` shared chrome mount — **AUTHORED / NOT RUN**;
- `apps/web/src/account-notification-api.test.ts` — **AUTHORED / NOT RUN**;
- account profile HTTP/browser smoke — **NOT RUN**;
- notification list/unread/read-one/read-all browser smoke — **NOT RUN**;
- account-id Clipboard API + fallback browser smoke — **NOT RUN**;
- narrow PWA responsive smoke — **NOT RUN**;
- Web TypeScript typecheck — **NOT RUN**;
- Web focused Vitest — **NOT RUN**;
- Web full Vitest — **NOT RUN**;
- Web production build — **NOT RUN**.

### Backend/schema/runtime work still awaiting executable verification

- API TypeScript typecheck — **NOT RUN**;
- API focused notification/auth/account/native-GROUP/manual-Record/schema tests — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- PostgreSQL SYSTEM idempotency smoke — **NOT RUN**;
- PostgreSQL announcement audience/fan-out smoke — **NOT RUN**;
- PostgreSQL concurrent provider-provisioning smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration — **NOT RUN**;
- baseline guard — **NOT RUN**;
- clean Dev/Prod rebuild — **NOT RUN**;
- native GROUP/manual Record Dev HTTP E2E — **NOT RUN**;
- PWA browser/install/speech smoke — **NOT RUN**.

No test in this run is labelled PASS or RUNTIME VERIFIED.

Execution environment check remains unchanged: there is no mounted AFTERTRACE checkout, and direct repository checkout/`git ls-remote` from the execution container cannot resolve `github.com`. GitHub repository source read/write is available through the connected GitHub service, but that is not executable validation.

## Known blockers / risks

1. **Executable validation remains the immediate release blocker.** This run's React/TypeScript/browser behavior has been source-reviewed but not compiled or executed.
2. **Canonical `drizzle/0000` remains behind the current target schema.** Auth/public-account/product/notification schema must be regenerated into a clean canonical baseline before database rebuild/deploy.
3. **The Web account/notification chrome has not had real browser/PWA layout smoke.** In particular Clipboard fallback, sticky header behavior, mobile panel sizing and same-tab logout/session synchronization need browser verification.
4. **Announcement audience SQL is source-reviewed only.** Real PostgreSQL must verify ALL/FREE/AI/SPECIFIC fan-out, JSONB specific-user selection and retry idempotency.
5. **Scheduled ANNOUNCEMENT dispatch is not connected to Worker `scheduled()` yet.** The repository can dispatch a scheduled row, but the single shared ~5 minute handler still has to claim due announcements/tasks.
6. **Push is schema/state only.** Subscription CRUD, preferences API, VAPID/Web Push delivery, invalid-endpoint revocation, service-worker push handlers and iOS installed-PWA smoke remain incomplete.
7. **Admin announcement backend exists but Admin UI does not.** Audience/channel/schedule preview, explicit send confirmation, cancellation and delivery summary still need the admin frontend.
8. **SYSTEM primitive has no domain callers yet.** Payment/subscription/trial/AI-limit events still need deterministic calls with stable event keys.
9. **Customer notification history currently exposes only the bounded latest list.** Persistence is durable, but pagination/load-more is not yet implemented if older history must be browsed beyond the current limit.
10. **Google Login and Apple Login callbacks remain incomplete.** Provider-neutral persistence is ready; LINE is currently the first migrated provider.
11. **FREE one-time AI trial issuance/runtime remains not implemented to the latest contract.** Existing Grant/reservation/settlement infrastructure should be reused cleanly, but new account provisioning must issue configured trial points idempotently rather than the retired hard-coded legacy FREE_INITIAL behavior.
12. **Paid AI entitlement/hard-cap runtime and native task/reminder execution remain incomplete.**

## Exact next run order

1. If an executable checkout becomes available, stop adding speculative layers long enough to run/fix:
   - Web TypeScript typecheck;
   - `account-notification-api.test.ts`, `worklog-api.test.ts`, `speech-input.test.ts`;
   - Web production build;
   - API TypeScript typecheck;
   - focused notification/auth/account/native-GROUP/manual-Record/schema tests;
   - PostgreSQL notification idempotency/fan-out smoke if a test database is available.
   Never mark them PASS without actual execution.
2. If executable checkout is still unavailable, implement the **Admin ANNOUNCEMENT frontend** against the existing backend:
   - list/detail and delivery summary;
   - title/body;
   - audience `ALL_USERS / FREE_USERS / AI_SUBSCRIBERS / SPECIFIC_USERS`;
   - `IN_APP / PUSH` selection;
   - `DRAFT / SEND_NOW / SCHEDULED`;
   - preview before persistence/send;
   - explicit send confirmation;
   - cancellation while still pending;
   - scheduled time validation and status inspection.
3. Add customer notification pagination/load-more if needed while wiring Admin announcement end-to-end, so durable history is not artificially capped at the newest page.
4. Add Web Push subscription/preferences APIs and explicit `開啟通知` UX. Never auto-prompt permission. Update service worker `push`/`notificationclick` handlers and degrade to durable IN_APP when unsupported/denied.
5. Add native Tasks/reminders and one shared scheduled Worker handler/Cron (~5 minutes) that claims due TASK reminders + scheduled ANNOUNCEMENT dispatch idempotently. Do not create one Cron per task. Queue remains conditional on volume.
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

Current estimate: **about 39–73 focused development hours**.

Approximate remaining buckets:

- executable validation + canonical baseline/rebuild + current free/PWA/native-GROUP/account/notification E2E: 7–13h;
- Admin announcement UI + notification history polish: 2–5h;
- Push subscriptions/preferences/delivery + Tasks/reminders/shared Cron + iOS/browser smoke: 7–12h;
- FREE one-time AI trial issuance/accounting/Admin control: 3–6h;
- Google/LINE/Apple login completion + account UI/Admin cleanup: 4–8h;
- AI Pro per-user entitlement/capture/search/hard caps: 10–18h;
- Related Records/range summary/rewrite: 4–7h;
- Chrome extension/final readiness/legacy cleanup: 2–4h.

Tighten the estimate after the first executable typecheck/test pass, regenerated canonical baseline and real Dev runtime E2E.
