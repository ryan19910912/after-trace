# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

Before substantive product/domain/schema/runtime work, read in this order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ACCOUNT_IDENTITY_POLICY.md`
3. `docs/WORKLOG_SUPPORT_POLICY.md`
4. `docs/WORKLOG_NOTIFICATION_POLICY.md`
5. `docs/WORKLOG_EXTENSION_POLICY.md`
6. `docs/WORKLOG_ENTITY_MODEL.md`
7. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
8. `docs/WORKLOG_AI_POINT_POLICY.md`
9. `docs/WORKLOG_SUBSCRIPTION_POLICY.md`
10. this file
11. `docs/WORKLOG_DEPLOYMENT.md`
12. `docs/WORKLOG_REBUILD_PROGRESS.md`

Latest docs are authoritative. When an older document conflicts with a later explicit user decision, update the documents and follow the latest user decision.

## GitHub Actions / CI

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Every normal development commit on this branch includes `[skip ci]`.

Do not claim tests or runtime validation passed unless they were actually executed.

## Current product architecture

- Web + PWA first;
- `/` remains the Record home page on desktop and installed PWA;
- microphone/voice-to-text is available but does not need to be the dominant PWA action;
- Search stays a separate page;
- Chrome extension is a compact capture surface;
- LINE is only LINE Login + external LINE OA support contact;
- no LINE Messaging bot/webhook product runtime;
- groups are native AFTERTRACE groups joined by invite link;
- paid AI entitlement is per user;
- no automatic historical AI backfill.

## Record contract

Manual Record fields:

- optional user-entered `title`;
- required `raw_text`/content;
- optional `occurred_at`;
- system `created_at` / `updated_at`.

Manual CRUD must support create, edit title/content/time, delete-to-recycle-bin and restore. Mutations preserve revision history.

The Record home page shows the latest 10 Records. Full browsing/filtering remains on the Search page.

Customer UI displays title first. If stored title is null, use a bounded content preview without silently persisting a generated title.

## FREE / AI boundary

FREE is manual-first:

- user-entered text Record CRUD;
- deterministic keyword/date search;
- native groups, tasks/reminders and notifications;
- browser/device speech-to-text where supported, because it only produces text and does not call provider AI.

FREE receives one Admin-configured one-time AI allowance, but those points may be consumed **only by natural-language AI Search**.

All other provider-backed AI capabilities require an active AI Pro subscription, including:

- AI text capture/organization;
- related Records;
- time-range summaries;
- rewrite suggestions;
- task proposals;
- image AI;
- audio AI;
- file/PDF AI;
- Chrome screenshot AI.

Do not let a generic `FREE_TRIAL` entitlement accidentally unlock non-search AI services. Enforce this on the backend as well as in UI availability.

## AI media boundary

Recommended current AI Pro media defaults:

- 1 image/request while the API is single-image; 4/request is the preferred future multi-image default;
- 5 MB/image;
- 300 seconds/audio request;
- 10 MB/audio request;
- 10 MB/file request.

Media plan limits live in application plan capabilities, not database CHECK constraints.

Runtime transport ceilings may be higher (currently 20 MB image and 30 MB audio/file) so plan limits remain the effective configurable limits below those ceilings.

Audio duration sent by the Web client must be passed through the API route and validated by the AI media service before provider work begins.

The extension screenshot path is explicit user action only and must use the same AI Pro entitlement as Web media AI.

## Customer copy policy

Customer-facing text must use clear Traditional Chinese and avoid implementation vocabulary.

Do not expose terms such as:

- Source;
- Record ID (say 紀錄編號 only when an identifier is genuinely required);
- provider;
- bounded dataset;
- proposal;
- Grant;
- runtime;
- ledger;
- metadata;
- optimistic locking/version/revision API.

Admin is an internal surface, but still prefer plain Chinese. Technical accounting labels may remain only where they are necessary to understand cost/usage facts.

## Account/authentication

Follow `WORKLOG_ACCOUNT_IDENTITY_POLICY.md`.

- provider-neutral AFTERTRACE account;
- Google + LINE current launch priority;
- Apple supported when operationally enabled;
- no silent account merge by email;
- customer-facing immutable opaque 帳號 ID;
- Web/PWA account UI exposes notification bell, display name, 帳號 ID and copy action;
- expired/missing database user sessions must clear local session state;
- OAuth callback `#session` must be consumed/removed so logout cannot rehydrate the old session.

## Subscription architecture

Current purchasable launch plan remains AI Pro NT$99/month via NewebPay.

The Admin/backend plan catalog is allowed to contain additional future subscription definitions. Creating a plan in Admin does not make it purchasable until checkout, renewal, entitlement and customer plan exposure explicitly support that plan.

Do not implement one-time AI top-ups unless the user changes the product direction.

Customer AI usage UI should show plain states such as normal, approaching limit, reached limit and reset date. Never expose internal supplier cost or margin to customers.

## Database/schema policy

AFTERTRACE remains prelaunch; Dev data is disposable and a clean rebuild is allowed until this document is explicitly changed after real production data exists.

Canonical target:

- one prelaunch migration: `drizzle/0000_worklog_baseline.sql`;
- Drizzle schema + baseline + metadata stay aligned.

Required rules:

- every persistent table has `COMMENT ON TABLE`;
- every persistent column has `COMMENT ON COLUMN`;
- comments live in the canonical baseline and should be meaningful Traditional Chinese descriptions;
- no PostgreSQL ENUM for application-domain/status values;
- no business/domain `CHECK` constraints;
- legal statuses/categories/price rules/cross-field rules are validated in TypeScript/application services;
- handwritten SQL should not add explicit named business `CONSTRAINT` clauses;
- keep structural integrity in PostgreSQL: PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL, INDEX, DEFAULT and appropriate data types.

If a future migration changes table/column structure, update comments at the same time.

## SQL safety

Avoid PostgreSQL reserved/command words as unquoted aliases/CTE names/identifiers. In particular never use `grant` as a SQL alias. Apply the same care to `user`, `group`, `order`, `limit`, `offset`, `constraint`, `table`, `column`, etc.

## Notifications/tasks/support

- notification categories remain ANNOUNCEMENT / SYSTEM / TASK internally;
- customer labels are 公告通知 / 系統通知 / 待辦通知;
- in-app notification remains durable even when push fails;
- one shared scheduled worker handles reminders/announcements; no Cron per task;
- AI task extraction produces a suggestion first and requires AI Pro; user confirms durable task creation;
- feedback is stored in AFTERTRACE and manageable from Admin;
- LINE OA is support contact only.

## Retired code

Do not restore retired LINE webhook/bot runtime, LINE group command flow, bot-entry auth, GROUP AI funding/responsible-user concepts, legacy Entity confirmation workflow, ONE_TIME/TOP_UP, or obsolete compatibility tests merely to preserve old behavior.

## Validation

Use explicit status words:

- AUTHORED;
- NOT RUN;
- PASS;
- FAIL;
- RUNTIME VERIFIED.

No validation claim without execution evidence.

## Development handoff

Every substantial run updates `WORKLOG_REBUILD_PROGRESS.md` with:

- current product decisions;
- code/docs changed;
- commit references;
- validation status;
- remaining runtime checks/blockers.

## Commit discipline

Prefer coherent commits and include `[skip ci]` in every normal development commit. Do not touch GitHub Actions unless the user explicitly asks.
