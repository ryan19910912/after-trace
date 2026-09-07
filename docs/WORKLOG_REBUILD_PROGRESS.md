# AFTERTRACE Worklog Rebuild Progress

Durable hourly-development handoff for branch `revive/line-worklog`.

Before substantive work, read the documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are the only product/development specification.

Never use GitHub Actions unless the user explicitly asks. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 provider-neutral account provisioning + public 帳號 ID runtime authored; current profile API + Admin exact lookup authored; executable/schema runtime verification still pending

AFTERTRACE remains Web + PWA-first work memory with optional Chrome extension. LINE is no longer a Record/group/AI product surface. LINE remains only as:

- one supported login provider;
- official LINE OA external customer-support contact channel.

Current prelaunch Dev and Prod data are disposable. Clean canonical baseline/database/application rebuilds are allowed while there is no real customer data. Once real customer/durable Prod data exists, destructive Prod permission expires and requires a new explicit decision.

## Product foundation retained

The accepted target foundation remains:

- login providers are Google, LINE and Apple through provider-neutral identity bindings;
- Google + LINE are first implementation priorities, Apple follows if sequencing is needed;
- provider email/id/display-name data is not the AFTERTRACE account identity;
- accounts are never silently merged from matching email;
- each account has immutable opaque `public_account_id`, displayed as `帳號 ID` and used for support lookup;
- Web/PWA account UI will show notification bell/unread count, display name, 帳號 ID and copy action;
- Admin exact lookup by public account id is required;
- native AFTERTRACE GROUP membership/invites, free manual Record CRUD and capture-first PWA/browser speech foundation already exist from earlier batches;
- notification schema foundation already exists for ANNOUNCEMENT / SYSTEM / TASK and IN_APP / PUSH;
- paid AI is per user; FREE has no provider-backed AI in the target product;
- LINE OA remains support-only and must not reintroduce legacy Record/group/AI bot behavior.

## Provider-neutral public account-id runtime — authored this run

New `apps/api/src/auth/public-account-id.ts` defines the customer-facing id generator.

Current generated shape is:

- prefix `AT-`;
- 12 random characters from a human-friendly uppercase alphabet that excludes ambiguous `0/1/I/L/O` characters;
- generated with `crypto.getRandomValues`;
- opaque/non-sequential and independent from internal DB ids/provider subjects.

The schema unique index remains the authoritative collision boundary. The exact display length is still prelaunch-adjustable under `WORKLOG_ACCOUNT_IDENTITY_POLICY.md`.

## Provider-neutral identity service/persistence — authored this run

New files:

- `apps/api/src/auth/account-identity.ts`;
- `apps/api/src/auth/drizzle-account-identity.ts`.

Behavior:

- supports `GOOGLE | LINE | APPLE` provider identities;
- provisions the durable AFTERTRACE user, provider binding and public account id atomically in one PostgreSQL statement;
- `provider + subject` is the concurrency/uniqueness authority;
- simultaneous first-login callbacks resolve to one winning provider identity user; a losing tentative user is deleted in the same SQL statement before commit;
- an existing public account id is preserved and never rotated during repeat login;
- rare `public_account_id` unique collisions roll the SQL statement back and retry with a fresh generated id, bounded to eight attempts;
- unrelated DB failures are not retried as id collisions;
- email/display-name values remain snapshots only and are never used as account-merge keys;
- LINE may attach to an existing exact `worklog_users.line_user_id` only as an explicit migration bridge for the old prelaunch schema; this rule is not generalized to email/name matching.

## LINE Login moved onto provider-neutral provisioning — authored this run

`apps/api/src/auth/routes.ts` LINE OAuth callback now uses `AccountIdentityService` + `DrizzleAccountIdentityRepository` instead of directly treating `line_user_id` as the account model.

After provider-neutral provisioning it:

1. ensures the transitional workspace/private Source required by current storage;
2. issues the durable `WEB_SESSION` with numeric `userId` plus migration-only LINE id compatibility;
3. returns to Web as before.

Important target correction: the LINE Login callback no longer creates a legacy `FREE_INITIAL` provider-AI Grant. New target FREE accounts therefore are not silently provisioned provider AI merely because the login provider is LINE.

Legacy `/auth/entry/exchange` remains only for migration-era LINE entry compatibility and was not extended.

## Current account profile API — authored this run

New `apps/api/src/auth/account-routes.ts` provides authenticated:

- `GET /api/v1/account/profile`.

`apps/api/src/worker.ts` mounts `/api/v1/account/*` before the legacy Gemini/LINE runtime boundary, so profile lookup does not eagerly construct retired product integrations.

The response intentionally exposes only customer account facts needed by Web/PWA:

- `displayName`;
- `publicAccountId`.

It does not require or expose Google email, LINE user id, Apple id or other provider identifiers.

Old prelaunch accounts without a `worklog_user_public_accounts` row currently fail closed with `ACCOUNT_PROFILE_NOT_READY`; clean baseline/rebuild or an explicit backfill/lazy-assignment step must resolve them before release.

## Admin exact public-account lookup — authored this run

`apps/api/src/admin/group-name-repository.ts` now overrides the Admin user-list query so:

- `worklog_user_public_accounts.public_account_id` is returned with each user row when present;
- `GET /api/v1/admin/users?q=<帳號ID>` can match `public_account_id` exactly (case-normalized with `UPPER`);
- the Admin user list no longer requires `is_oa_friend = TRUE`, allowing Google/Apple/non-OA accounts to be found;
- legacy internal id / LINE id / display-name search remains temporarily available during migration.

This satisfies the backend support-lookup boundary without making a third-party identity mandatory. Existing Admin detail/presentation still contains legacy Grant/LINE-era fields and will be cleaned separately; they do not drive the new public-account lookup.

## Tests authored this run

New:

- `apps/api/src/auth/account-identity.test.ts`;
- `apps/api/src/auth/account-routes.test.ts`.

Coverage authored:

- public account-id format/validation;
- provider-neutral provisioning does not use email as identity;
- public-id unique collision retry;
- unrelated persistence failure is not retried;
- durable `userId` Web session -> current account profile;
- profile response excludes provider email/LINE id;
- missing prelaunch public-account row fails closed.

Status: **AUTHORED / NOT RUN**.

## Commits in this run

All commits contain `[skip ci]`:

- `9b646c52` — add opaque public account id generator;
- `9b056201` — add provider-neutral account identity service;
- `803fd7f4` — add atomic account identity persistence;
- `db4184d7` — cover public account identity provisioning;
- `1ec80ce9` — provision LINE Login through neutral account identity and stop legacy FREE AI Grant creation on login;
- `cc082dd6` — add provider-neutral current account profile API;
- `a48cd161` — route account profile before legacy runtime;
- `851d240c` — cover current account profile route;
- `bd30d5d2` — add provider-neutral Admin account lookup;
- `d0b30f05` — fix Admin individual-user filter join found during source review;
- `91cd3d2c` — make provider identity provisioning race-safe under simultaneous first login;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Validation status

### Identity/account changes

- `public-account-id.ts` — **AUTHORED / NOT RUN**;
- `account-identity.ts` — **AUTHORED / NOT RUN**;
- `drizzle-account-identity.ts` — **AUTHORED / NOT RUN**;
- `account-routes.ts` — **AUTHORED / NOT RUN**;
- LINE provider-neutral callback update — **AUTHORED / NOT RUN**;
- Admin exact public-account lookup — **AUTHORED / NOT RUN**;
- `account-identity.test.ts` — **AUTHORED / NOT RUN**;
- `account-routes.test.ts` — **AUTHORED / NOT RUN**.

### Existing target work still awaiting executable verification

- API TypeScript typecheck — **NOT RUN**;
- API focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- Web TypeScript typecheck / Vitest / production build — **NOT RUN**;
- Drizzle canonical baseline regeneration — **NOT RUN**;
- baseline guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- PostgreSQL concurrent provider-provisioning smoke — **NOT RUN**;
- native GROUP/manual Record Dev HTTP E2E — **NOT RUN**;
- PWA browser/install/speech smoke — **NOT RUN**.

Reason: this run can read/write the GitHub repository through the connected GitHub service, but no executable AFTERTRACE checkout/dependencies are available in the runtime. Source review is not treated as compile/test/runtime success.

## Known blockers / risks

1. **Executable validation is still the immediate release blocker.** The new SQL/TypeScript/tests have not been compiled or executed.
2. **Canonical `drizzle/0000` is behind the current target TypeScript schema.** The new auth/public-account/notification tables are not safe to deploy until the canonical baseline is regenerated and validated.
3. **Real Google Login and Apple Login callbacks are not implemented yet.** The repository/service is provider-neutral and ready for them; LINE is the first provider moved onto it.
4. **Old prelaunch users may lack public account ids.** Because prelaunch data is disposable, a clean rebuild is acceptable; alternatively a bounded backfill/lazy assignment can be added before launch if keeping a test DB is useful.
5. **Admin detail/UI remains partly legacy.** Exact public-account backend search now works conceptually, but the Admin screen/detail model still exposes old Grant/LINE concepts that need later product cleanup.
6. **Notification runtime/API/UI is still schema-only.** Notification center, unread count, Admin announcements, SYSTEM event idempotency and Push delivery remain unimplemented.
7. **Readiness/runtime configuration still contains migration-era LINE/Gemini requirements.** Target routes are increasingly isolated above that boundary, but final readiness must become target-product based.
8. **Paid AI hard-cap runtime, task/reminder scheduler and Push execution remain incomplete.**

## Exact next run order

1. If an executable checkout becomes available, stop adding speculative layers long enough to run/fix:
   - API TypeScript typecheck;
   - focused auth/account/native-GROUP/manual-Record/schema tests;
   - Web TypeScript typecheck + focused tests + production build.
   Never mark them PASS without actual execution.
2. If executable checkout is still unavailable, continue the bounded **notification service foundation** batch:
   - create repository/service for durable IN_APP notification list/read/unread count;
   - implement deterministic `SYSTEM` event-key idempotent creation;
   - implement Admin `ANNOUNCEMENT` create/draft/schedule/cancel/list/detail API;
   - implement audience fan-out for ALL_USERS / FREE_USERS / AI_SUBSCRIBERS / SPECIFIC_USERS suitable for prelaunch scale;
   - keep category independent from IN_APP/PUSH channels;
   - keep Admin manual messages ANNOUNCEMENT, never fake SYSTEM events;
   - author focused tests as **AUTHORED / NOT RUN** until executable validation exists.
3. Add Web/PWA account header wired to `/api/v1/account/profile`, then notification bell/unread/center and 帳號 ID copy confirmation.
4. Add Web Push subscription/preferences APIs and explicit `開啟通知` UX; never auto-prompt permission; update service worker push/notificationclick handlers.
5. Add native Tasks/reminders and one shared scheduled handler/Cron (~5 minutes) for due TASK + scheduled ANNOUNCEMENT dispatch; keep delivery idempotent and add Queue only if volume needs it.
6. Add Admin announcement UI with audience/channel/schedule preview, send confirmation, cancellation and delivery summary.
7. Complete Google Login, then finish LINE provider UI polish, then Apple Login; account linking remains a separate explicit authenticated feature and must not auto-merge by email.
8. Regenerate clean canonical `drizzle/0000`, run baseline guard/tests, rebuild disposable Dev/Prod as appropriate, then run auth/account/notification/PWA runtime E2E.
9. Continue paid per-user AI entitlement/caps, AI capture/search/related records/summary/rewrite, Chrome extension and final legacy LINE product cleanup.

## Estimated remaining development time

Current estimate: **about 44–82 focused development hours**.

Approximate remaining buckets:

- executable validation + clean baseline/rebuild + free/PWA/native-GROUP/account E2E: 7–13h;
- Google/LINE/Apple login completion + Web account header/Admin UI cleanup: 4–8h;
- notification service/center/Admin announcements/SYSTEM events: 7–12h;
- tasks/reminders + PWA Push/Cron + iOS/browser smoke: 7–12h;
- paid per-user AI entitlement/capture/search: 12–22h;
- Related Records/range summary/rewrite: 5–9h;
- Chrome extension/final readiness/legacy cleanup: 4–8h.

Tighten the estimate after the first executable typecheck/test pass, regenerated canonical baseline and real Dev runtime E2E.
