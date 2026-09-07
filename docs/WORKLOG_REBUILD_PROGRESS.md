# AFTERTRACE Worklog Rebuild Progress

Durable hourly-development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 identity + notification product contracts locked; notification/account schema foundation authored; runtime/API/UI still pending

AFTERTRACE is Web + PWA-first work memory with optional Chrome extension. LINE is no longer a Record/group/AI product surface. LINE remains only as:

- one supported login provider;
- official LINE OA external customer-support contact channel.

Current prelaunch Dev and Prod data are disposable. Clean baseline/database/application rebuilds are allowed while there is no real customer data. Once real customer/durable Prod data exists, destructive Prod permission expires and requires a new explicit decision.

## Product decisions added in the latest batch

### Authentication / account identity

Accepted login options:

- Google Login;
- LINE Login;
- Apple Login.

Google + LINE are first implementation priorities. Apple is supported next if sequencing is needed.

Core account remains provider-neutral. Do not silently merge accounts by matching email.

Every account has an immutable, unique, opaque/non-sequential public account id, customer-facing as `帳號 ID`, e.g. `AT-7K4M2P` presentation style.

Authenticated Web/PWA top-right account area must show:

- notification bell + unread count;
- display name;
- 帳號 ID;
- copy action.

Admin must support exact lookup by public account id so support does not require Google email, LINE id, Apple id or other third-party identity.

### Customer support

- `意見回饋` stays inside Web/PWA and is Admin-manageable;
- `聯絡客服` opens official LINE OA;
- do not label it `客訴管道`;
- do not add `人工回覆非即時` wording;
- no RAG/general AI support bot for initial product;
- LINE OA support must not reintroduce legacy 小跡/group/AI product behavior.

### Notifications

Exactly three current categories:

- `ANNOUNCEMENT` / 公告通知;
- `SYSTEM` / 系統通知;
- `TASK` / 待辦通知.

Current channels are separate from category:

- durable `IN_APP` notification center;
- optional `PUSH`.

Admin announcement capability must support:

- ALL_USERS / FREE_USERS / AI_SUBSCRIBERS / SPECIFIC_USERS;
- immediate or scheduled send;
- IN_APP/PUSH selection;
- preview;
- cancel before dispatch;
- status/delivery inspection.

SYSTEM notifications come from deterministic backend events such as payment success, subscription activation/renewal/cancellation and AI limit state; event creation must be idempotent.

TASK notifications come from user-confirmed durable reminders.

Target scheduler:

- one global Cloudflare Worker scheduled handler/Cron around every 5 minutes;
- bounded due reminder/scheduled-announcement scans;
- idempotent delivery;
- no one-Cron-per-task design;
- Queue only if later volume/fan-out justifies it.

For supported iOS/iPadOS PWA push:

- user adds AFTERTRACE to Home Screen;
- permission is requested only after explicit action such as `開啟通知`;
- never auto-prompt on first load;
- denied/unsupported push falls back to durable IN_APP notification center.

## Durable docs updated / added

All commits below contain `[skip ci]`:

- `cf7363a` — add `WORKLOG_NOTIFICATION_POLICY.md`;
- `4fa273b` — add `WORKLOG_ACCOUNT_IDENTITY_POLICY.md`;
- `40ba586` — update development policy/read order for identity + notifications;
- `9afe1d5` — align main product spec with Apple login, public account id and full notification model.

## Code authored in latest batch

### Notification schema foundation

New `apps/api/src/db/schema-worklog-notification.ts` defines:

- notification type enum: ANNOUNCEMENT / SYSTEM / TASK;
- notification status: DRAFT / SCHEDULED / SENDING / SENT / CANCELLED / FAILED;
- announcement audience enum;
- notification rows with IN_APP/PUSH channel flags, schedule, deterministic system event key, reference/deep-link metadata and audit actor;
- per-user recipient/read state;
- idempotent push-delivery state;
- Web Push subscriptions with endpoint/p256dh/auth and revocation state;
- per-user announcement/system/task push preferences.

`apps/api/src/db/schema-all.ts` exports the notification schema.

Commits:

- `72dddab` — notification schema;
- `2114061` — schema-all export.

### Provider-neutral identity schema foundation

`apps/api/src/db/schema-worklog-product.ts` now includes:

- provider enum `GOOGLE | LINE | APPLE`;
- auth identity display-name snapshot;
- one-to-one `worklog_user_public_accounts` with unique `public_account_id` separate from numeric DB id/provider ids.

Commit:

- `b2aaf5e` — provider-neutral public account identity schema.

### Tests authored

- `apps/api/src/worklog/product-foundation-schema.test.ts` now checks Google/LINE/Apple provider enum and public account-id schema;
- `apps/api/src/worklog/notification-schema.test.ts` covers notification categories, audience/status, recipient/read/push state, subscriptions and preferences.

Commits:

- `66d94c4` — account identity schema tests;
- `6781bb7` — notification schema tests.

## Validation status

Latest identity/notification changes:

- account identity schema — **AUTHORED / NOT RUN**;
- notification schema — **AUTHORED / NOT RUN**;
- product-foundation schema tests — **AUTHORED / NOT RUN**;
- notification schema tests — **AUTHORED / NOT RUN**;
- API TypeScript typecheck — **NOT RUN**;
- API Vitest — **NOT RUN**;
- Drizzle baseline regeneration — **NOT RUN**;
- baseline guard — **NOT RUN**;
- Dev/Prod DB rebuild — **NOT RUN**;
- runtime HTTP/browser tests — **NOT RUN**.

Reason: current GitHub connector can read/write repository state but this conversation has no executable checkout available. Do not infer PASS from source authoring.

Existing PWA capture/speech files from the prior checkpoint also remain **AUTHORED / NOT RUN** until executable validation becomes available.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Known risks / blockers

1. `drizzle/0000` does not yet represent the latest target schema. Do not deploy the new schema until baseline regeneration/validation occurs.
2. Provider-neutral login callbacks for Google/LINE/Apple are not implemented yet; current runtime still contains migration-era LINE assumptions.
3. Public account-id generation/service and Admin lookup API are not implemented yet.
4. Notification repository/service/API/Admin UI/Web notification center/PWA push sending are not implemented yet.
5. A real Web Push VAPID/runtime integration and iOS Home Screen browser smoke are still required.
6. Existing free/native GROUP/PWA work still requires executable typecheck/tests/browser/PostgreSQL verification.
7. Paid per-user AI entitlement/hard-cap runtime remains incomplete.

## Exact next run order

1. If an executable checkout becomes available, first run/fix API + Web typecheck and focused tests before adding speculative layers.
2. Otherwise continue the current bounded **identity runtime** batch:
   - add collision-safe public account-id generator;
   - create public id atomically when provisioning a new AFTERTRACE user;
   - expose current-user profile endpoint with display name/public account id;
   - add exact Admin public-account-id user lookup;
   - author tests and mark them NOT RUN until execution exists.
3. Then implement **notification service foundation**:
   - repository/service for IN_APP notification creation/list/read/unread count;
   - deterministic SYSTEM event-key idempotency;
   - Admin ANNOUNCEMENT create/schedule/cancel/list API;
   - recipient fan-out suitable for current prelaunch scale;
   - tests.
4. Add Web/PWA top-right account header + notification bell/center + copy account id.
5. Add Web Push subscription/unsubscription APIs and explicit `開啟通知` UX; update service worker push/notificationclick handlers.
6. Add task/reminder schema/runtime and scheduled handler/Cron; route due TASK and scheduled ANNOUNCEMENT through Notification Service.
7. Add Admin announcement UI/manual send and delivery status.
8. Complete Google + LINE login, then Apple Login; preserve provider-neutral user/session semantics.
9. Regenerate clean canonical `drizzle/0000`, run guard/tests, rebuild disposable Dev/Prod as appropriate, and run runtime/browser E2E.
10. Continue paid AI/search/related records/summary/rewrite/Chrome extension and remove obsolete LINE product runtime.

## Estimated remaining development time

Current estimate: **about 48–88 focused development hours**.

Approximate remaining buckets:

- executable validation + clean baseline/rebuild + free/PWA/native-GROUP E2E: 7–13h;
- provider-neutral Google/LINE/Apple login + public account id/profile/Admin lookup: 6–11h;
- notification center/service/Admin announcements/system events: 7–12h;
- tasks/reminders + PWA Push/Cron + iOS/browser smoke: 7–12h;
- paid per-user AI entitlement/capture/search: 12–22h;
- Related Records/range summary/rewrite: 5–9h;
- Chrome extension/final readiness/legacy cleanup: 4–9h.

Tighten the estimate after the first executable validation and clean baseline rebuild.
