# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 Chrome extension capture scope committed and first popup/context-capture scaffold authored; executable/browser/schema verification still pending

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

## Chrome extension capture contract — accepted this run

`docs/WORKLOG_EXTENSION_POLICY.md` is now the durable extension contract.

Committed V1 capture scope:

- quick text;
- quick voice;
- Source/group selection;
- explicit selected webpage text capture;
- optional current-page title + URL context;
- explicit visible-page/bounded screenshot/image capture for AI Pro or eligible FREE trial;
- persistence into the same AFTERTRACE Record timeline/domain model.

Privacy/product boundaries:

- no automatic full-page archive;
- no browsing-history or clipboard monitoring;
- no continuous microphone/screen capture;
- no meeting-length background recording;
- no automatic tab monitoring;
- no RAG over every visited page;
- no separate extension-only account/subscription/domain;
- no large persistent sidebar/agent for V1.

## Chrome extension scaffold — authored this run

New `apps/extension` package has been started as a Manifest V3 extension foundation.

Current files:

- `apps/extension/package.json` — workspace package placeholder;
- `apps/extension/manifest.json` — Manifest V3, compact action popup, minimum current permissions (`activeTab`, `contextMenus`, `storage`);
- `apps/extension/background.js` — explicit `儲存到 AFTERTRACE` selected-text context-menu flow; selected text + page title/URL are staged only as transient extension draft data;
- `apps/extension/popup.html` — compact quick-capture shell with text, Source placeholder, voice action, page-context toggle and screenshot preview;
- `apps/extension/popup.js` — active-page title/URL lookup, selected-text draft restore, browser speech input attempt/fallback, explicit visible-tab screenshot capture and preview.

Important current limitation:

- durable auth/session handoff is **not wired yet**;
- Source/group list is **not wired yet**;
- save/persistence is intentionally disabled until it can use the normal AFTERTRACE authenticated Record APIs;
- screenshot/voice are currently local capture UI only and must not be claimed as end-to-end Record creation;
- no browser/runtime validation has been executed.

This is deliberate: the extension must not invent an extension-only durable storage/login path merely to appear complete.

## Authenticated Web/PWA app chrome retained

`apps/web/src/AuthenticatedAppChrome.tsx` remains mounted once around the current Web route content from `apps/web/src/main.tsx`.

For an authenticated session it provides:

- notification bell;
- visible unread badge when unread count is non-zero;
- user display name;
- visible `帳號 ID` label and immutable `publicAccountId`;
- one-tap account-id copy;
- visible `已複製` confirmation after successful copy;
- copy fallback for browsers where Clipboard API is unavailable;
- narrow mobile/PWA layout keeps `帳號 ID` and copy affordance visible rather than hiding them.

The account chrome consumes only provider-neutral account/profile facts.

## Web/PWA notification center retained

The shared app chrome consumes the durable notification backend through `apps/web/src/account-notification-api.ts`.

Current customer behavior includes:

- initial authenticated load fetches `/api/v1/notifications`;
- unread count on bell;
- durable notification-center list;
- exactly `公告通知`, `系統通知`, `待辦通知` category labels;
- mark-one-read and mark-all-read actions;
- safe same-product relative deep links only;
- invalid/expired signed sessions clear shared local session state.

PUSH remains independent and still incomplete.

## Notification backend retained

Current backend boundary remains:

- `apps/api/src/worklog/notifications.ts`;
- `apps/api/src/worklog/drizzle-notifications.ts`;
- `apps/api/src/worklog/notification-routes.ts`;
- `apps/api/src/admin/notification-routes.ts`.

Audience rules remain:

- `ALL_USERS`;
- `FREE_USERS`;
- `AI_SUBSCRIBERS`;
- `SPECIFIC_USERS`.

Scheduled announcement persistence exists, but the shared Worker scheduled handler/Cron is not connected yet.

## Commits in this run

All commits contain `[skip ci]`:

- `21a3eac1` — define Chrome extension capture scope;
- `8d50fde6` — scaffold extension workspace package;
- `5498b8b8` — add Manifest V3 extension manifest;
- `bc4b5884` — add explicit selected-text context-menu capture;
- `2a6c828f` — add compact quick-capture popup shell;
- `df86a3d8` — wire page context, speech-input attempt and explicit visible screenshot preview;
- `8569803c` — promote extension scope into product spec;
- `bb29aac5` — add extension rules to development policy;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Chrome extension work from this run

- `apps/extension/package.json` — **AUTHORED / NOT RUN**;
- `apps/extension/manifest.json` — **AUTHORED / NOT RUN**;
- `apps/extension/background.js` — **AUTHORED / NOT RUN**;
- `apps/extension/popup.html` — **AUTHORED / NOT RUN**;
- `apps/extension/popup.js` — **AUTHORED / NOT RUN**;
- load-unpacked Chrome smoke — **NOT RUN**;
- context-menu selected-text smoke — **NOT RUN**;
- active page title/URL smoke — **NOT RUN**;
- browser speech permission/input smoke — **NOT RUN**;
- screenshot permission/capture smoke — **NOT RUN**;
- extension auth/API persistence smoke — **NOT IMPLEMENTED / NOT RUN**.

### Web/PWA current work awaiting executable verification

- Web TypeScript typecheck — **NOT RUN**;
- Web focused/full Vitest — **NOT RUN**;
- Web production build — **NOT RUN**;
- account profile / notification browser smoke — **NOT RUN**;
- account-id clipboard/fallback smoke — **NOT RUN**;
- PWA responsive/install/speech smoke — **NOT RUN**.

### Backend/schema/runtime work awaiting executable verification

- API TypeScript typecheck — **NOT RUN**;
- focused notification/auth/account/native-GROUP/manual-Record/schema tests — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- PostgreSQL SYSTEM idempotency smoke — **NOT RUN**;
- PostgreSQL announcement audience/fan-out smoke — **NOT RUN**;
- provider-provisioning concurrency smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- clean Dev/Prod rebuild — **NOT RUN**;
- native GROUP/manual Record Dev HTTP E2E — **NOT RUN**.

No test in this run is labelled PASS or RUNTIME VERIFIED.

Execution environment limitation remains: GitHub source read/write is available, but no executable AFTERTRACE checkout is mounted for local/browser/runtime validation.

## Known blockers / risks

1. **Executable validation remains the immediate release blocker.** New Web/API/extension code is source-authored but not compiled/executed.
2. **Canonical `drizzle/0000` remains behind the current target schema.** Regenerate before database rebuild/deploy.
3. **Extension auth/session handoff is the main extension blocker.** Do not store third-party credentials or invent a separate identity model in extension storage.
4. **Extension Source/group selection and Record persistence are not wired.** The popup save button remains disabled intentionally.
5. **Extension microphone and screenshot behavior are browser-permission dependent and have not been runtime-smoked.**
6. **Admin announcement frontend is still incomplete.**
7. **Scheduled ANNOUNCEMENT/TASK dispatch is not connected to Worker `scheduled()` yet.**
8. **Push subscription CRUD/preferences/VAPID delivery/service-worker push handling/iOS installed-PWA smoke remain incomplete.**
9. **SYSTEM notification primitive still needs domain callers such as payment/subscription/trial/AI-limit events.**
10. **Google Login and Apple Login callbacks remain incomplete.**
11. **FREE one-time AI trial issuance/runtime is still not implemented to the latest contract.**
12. **Paid AI entitlement/hard-cap runtime and native task/reminder execution remain incomplete.**

## Exact next run order

1. If an executable checkout becomes available, stop adding speculative layers long enough to run/fix Web/API and load-unpacked extension smoke. Never mark anything PASS without execution.
2. If executable checkout is still unavailable, continue the current highest-priority app flow before deep extension work:
   - Admin ANNOUNCEMENT frontend;
   - customer notification history/pagination polish if needed;
   - Push subscription/preferences APIs + explicit `開啟通知` UX;
   - Tasks/reminders + shared scheduled Worker handler;
   - deterministic SYSTEM event callers;
   - FREE one-time AI trial Admin/issuance/accounting;
   - Google/LINE/Apple login completion.
3. After shared auth/account/Record APIs are stable, return to `apps/extension` and wire:
   - safe authenticated session/token handoff;
   - Source/group list;
   - quick text persistence;
   - page title/URL metadata persistence;
   - selected-text persistence;
   - quick voice into provider-free or paid-AI path;
   - screenshot/image upload through AI Pro/FREE-trial entitlement;
   - explicit error/retry states;
   - Chrome permission/privacy smoke and packaging.
4. Regenerate clean canonical `drizzle/0000`, run guard/tests, rebuild disposable Dev/Prod as appropriate, then run auth/account/notification/PWA/extension runtime E2E.
5. Continue AI Pro capture/search/related records/summary/rewrite and final legacy LINE product cleanup.

## Estimated remaining development time

Current estimate: **about 42–79 focused development hours**.

Approximate remaining buckets:

- executable validation + canonical baseline/rebuild + current free/PWA/native-GROUP/account/notification E2E: 7–13h;
- Admin announcement UI + notification history polish: 2–5h;
- Push subscriptions/preferences/delivery + Tasks/reminders/shared Cron + iOS/browser smoke: 7–12h;
- FREE one-time AI trial issuance/accounting/Admin control: 3–6h;
- Google/LINE/Apple login completion + account UI/Admin cleanup: 4–8h;
- AI Pro per-user entitlement/capture/search/hard caps: 10–18h;
- Related Records/range summary/rewrite: 4–7h;
- Chrome extension auth/API integration, browser smoke, packaging and final readiness/legacy cleanup: 5–10h.

Tighten the estimate after the first executable typecheck/test pass, regenerated canonical baseline and real Dev runtime E2E.
