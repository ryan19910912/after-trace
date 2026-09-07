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
11. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
12. `docs/WORKLOG_DEPLOYMENT.md`
13. `docs/WORKLOG_REBUILD_PROGRESS.md`

The latest documents above are the only product/development specification.

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

Every development commit on this branch must include `[skip ci]`.

## Current architecture direction

AFTERTRACE is **Web + PWA-first** with a committed Chrome extension fast-capture surface.

- LINE is retired from the core product surface;
- the official LINE OA remains only as an external customer-support contact channel under `WORKLOG_SUPPORT_POLICY.md`;
- PWA is capture-first with microphone as the primary action;
- Web is the full timeline/search/edit/group/subscription surface;
- Chrome extension reuses the same account/API/domain model and remains a compact capture surface;
- groups are created in AFTERTRACE and joined through invite links;
- free users get manual CRUD/search/date filtering and non-provider browser speech-to-text where available;
- paid AI entitlement is per user;
- no GROUP AI responsible-user concept in the target product;
- no automatic AI backfill when a free user subscribes later.

## Account / authentication boundary

Follow `WORKLOG_ACCOUNT_IDENTITY_POLICY.md`.

- Google Login and LINE Login are first-class login options;
- Apple Login is a supported login option and may be implemented after Google/LINE if sequencing is needed;
- core AFTERTRACE users remain provider-neutral;
- provider identities are bindings, not the account primary identity;
- never silently merge provider identities merely because email matches;
- every account has an immutable opaque public account id for support lookup;
- Admin user search must support exact public account id lookup;
- authenticated Web/PWA account UI exposes notification bell/unread count, display name, public `帳號 ID`, and copy action.

## Support / feedback boundary

Customer support is intentionally separated from the work-memory domain.

- Web/PWA `意見回饋` uses an in-product form and durable Admin-manageable feedback records;
- Web/PWA `聯絡客服` opens the official LINE OA;
- customer-facing UI should say `聯絡客服`, not `客訴管道`;
- do not add `人工回覆非即時` wording to the customer-facing support entry;
- LINE OA does not create/search/edit Records, manage groups, mutate AI entitlement, or synchronize support chats into Admin for MVP;
- no RAG support knowledge base and no general-purpose AI support bot for the initial product;
- a simple LINE OA automatic acknowledgement is acceptable if it does not promise a response-time SLA;
- future support automation must remain a support-layer feature and must not silently reintroduce LINE as a product surface.

## Notification boundary

Follow `WORKLOG_NOTIFICATION_POLICY.md`.

Current product notification categories are:

- `ANNOUNCEMENT` — Admin-authored announcements;
- `SYSTEM` — deterministic business/account events;
- `TASK` — user task/reminder notifications.

Category is independent from channel. Current channels are durable `IN_APP` and optional `PUSH`.

Admin must support announcement creation, audience selection, immediate/scheduled send, channel selection, preview, cancel-before-dispatch and delivery/status inspection. System notifications must use deterministic event idempotency. Task reminders use one global Cloudflare scheduled handler/Cron, approximately every five minutes, with bounded due scans and idempotent delivery. Do not create one Cron per task. Queue is optional only when volume/fan-out requires it.

Web/PWA must expose a durable notification center and unread count. PWA Push is an enhancement over durable IN_APP state.

For supported iOS/iPadOS PWA push, the product flow assumes the Web App is added to the Home Screen and notification permission is requested only after an explicit user action such as `開啟通知`. Denied/unsupported push must degrade to IN_APP notifications rather than breaking the feature.

## Chrome extension boundary

Follow `WORKLOG_EXTENSION_POLICY.md`.

The extension is a committed V1 fast-capture client. It must reuse the same AFTERTRACE account, Source/group authorization, Record APIs, AI entitlement and provider-cost accounting as Web/PWA.

Accepted capture scope:

- quick text;
- quick voice;
- selected webpage text from explicit user action;
- optional active-page title + URL context;
- explicit visible-page/bounded screenshot/image capture;
- normal Source/group selection before persistence.

Free/provider-free extension functions remain manual capture. Provider-backed voice/image/enrichment requires AI Pro or eligible Free AI trial points.

Do not add automatic full-page archiving, browsing-history capture, clipboard monitoring, continuous microphone/screen capture, meeting-length recording, automatic tab monitoring, RAG over visited pages, or a large extension-only sidebar/agent.

Current implementation order:

1. popup/auth handoff;
2. Source/group picker;
3. quick text persistence;
4. page title/URL context;
5. selected-text context-menu flow;
6. quick voice;
7. screenshot/image + AI entitlement path;
8. permission/privacy/browser smoke and Chrome Web Store packaging.

The `apps/extension` scaffold may hold transient UI/draft state, but durable Records must be persisted through AFTERTRACE backend APIs rather than extension-only local storage.

## Product behavior boundary

Free/manual Record:

- content;
- nullable user-entered event date/time;
- created timestamp;
- updated timestamp;
- no required AI title/keywords/entities.

Paid AI may add title, keywords/search terms, date interpretation and bounded retrieval metadata for new AI operations only.

Do not silently call AI during manual CRUD.

## AI features currently accepted

High-priority paid AI capabilities:

- natural-language text capture;
- AI voice capture;
- image/file/PDF input;
- automatic title/keywords/date;
- bounded extraction metadata for retrieval;
- natural-language search;
- related Records;
- time-range summary;
- explicit AI rewrite;
- task extraction/proposal;
- later grounded Q&A when retrieval quality is sufficient.

Do not prioritize project/group AI summaries as a standalone feature.

## Subscription fair-use / hard-cap rule

Launch commercial shape is exactly FREE + AI_PRO NT$99/month for V1. Do not build one-time AI top-up products or additional paid tiers before real usage justifies them.

FREE receives one idempotent one-time AI trial grant using Admin-configured initial AI trial points. The point quantity is not hard-coded, does not refresh monthly and is not presented as a customer TWD balance. After trial exhaustion, provider-backed AI stops while Free manual features continue.

Paid AI must not be marketed as mathematically unlimited compute. Frontend must disclose fair-use/monthly resource limits.

Admin/runtime must support hard caps including:

- monthly internal AI resource/point cap;
- monthly actual provider-cost cap in TWD;
- optional per-request/modality limits;
- feature capability toggles.

New provider work fails closed once a hard cap is reached. Actual provider cost is the operational safety boundary.

## Tasks / reminders

Native AFTERTRACE task list + PWA push is accepted before Calendar integration.

Target reminder architecture:

- durable task/reminder timestamp;
- Cloudflare Worker Cron at a bounded interval such as 5 minutes;
- bounded due-row scan;
- idempotent delivery state;
- Cloudflare Queue only when volume/fan-out justifies it.

AI may interpret a reminder phrase but persisted schedule/action is deterministic and user-confirmed.

## Migration away from LINE

Do not continue adding LINE product features.

Because the product is still prelaunch/test-stage, legacy LINE-era code and schema do not need to be preserved merely for compatibility. Prefer deleting or rewriting obsolete code when a clean replacement is safer and easier to maintain.

Retaining LINE Login as an authentication provider and LINE OA for support does **not** justify retaining legacy `小跡`, GROUP bot, Reply cache, AI responsibility, LINE product-command, or LINE membership domain logic.

Priority is to replace product dependencies in this order:

1. provider-neutral authentication/account/public account id;
2. native AFTERTRACE group membership/invites;
3. PWA/Web capture and manual Record model;
4. notification center/schema foundation;
5. Free one-time AI trial + per-user paid AI entitlement/caps;
6. natural-language search and AI enrichment;
7. tasks/reminders/push;
8. Chrome extension;
9. delete/isolate retired LINE runtime/schema after dependency review while keeping only LINE Login and the minimal OA support linkage required by the accepted product policies.

## SQL / PostgreSQL safety rules

Raw SQL and Drizzle templates must avoid PostgreSQL reserved/command keywords as unquoted aliases/CTE names/identifiers.

Hard rule:

- never use `grant` as a SQL alias;
- for `worklog_ai_grants`, use `g`, `ai_grant`, or `grant_row`;
- apply the same discipline to `user`, `group`, `order`, `limit`, `offset`, `constraint`, `table`, `column`, etc.;
- when PostgreSQL returns `42601`, inspect alias/identifier collisions before speculative schema/date changes;
- retain repository regression coverage for the known `grant` alias issue.

## Database / code rebuild policy

AFTERTRACE is still in prelaunch testing. **Existing Dev and Prod data are currently disposable unless the user explicitly changes this rule later.**

For local, Dev, and current prelaunch Prod work:

- databases may be dropped, recreated, or rebuilt from a clean canonical baseline;
- existing test users, Records, LINE state, Grants, AI runtime config, plan data, audit rows and other prelaunch data do not need preservation;
- forward-compatibility migrations are optional, not mandatory, when a clean reset produces a simpler and more correct target schema;
- the canonical `drizzle/0000` baseline may be regenerated after accepted schema changes;
- old compatibility code may be deleted instead of carried forward indefinitely;
- application modules may be rewritten or rebuilt when the new Web/PWA architecture is cleaner than adapting LINE-era code;
- prefer the simplest correct target architecture over compatibility with disposable test data;
- after a reset, recreate only the explicit seed/runtime configuration actually required by the current product;
- do not create migration complexity solely to preserve disposable prelaunch data.

Safety boundary:

- this permission applies only while AFTERTRACE has no real customer/production data;
- once real users or durable production data exist, destructive Prod rebuilds require a new explicit user decision and this document must be updated before continuing;
- do not infer permanent permission to destroy future production data from the current prelaunch rule.

The unrelated local untracked `apps/api/verify-admin-schema.mjs` must not be staged/committed unless separately reviewed/approved.

## Validation policy

Prefer focused local validation after each coherent batch, then broader package/release validation at milestones.

Do not claim a test passed unless the user actually ran it or an available execution environment ran it and returned PASS. Never infer passing tests from compilation or code inspection.

## Hourly development handoff format

Every scheduled development run must first read the latest product docs and the latest `WORKLOG_REBUILD_PROGRESS.md`, then continue from the recorded checkpoint rather than restarting analysis.

Each run must update `WORKLOG_REBUILD_PROGRESS.md` with:

- what was completed in this run;
- commits/files changed;
- tests actually completed and their real status;
- tests still required;
- known blockers/risks;
- the exact next work batch;
- estimated remaining development time/range based on current scope;
- a short `next run` checklist.

The report must distinguish `AUTHORED`, `NOT RUN`, `PASS`, `FAIL`, `RUNTIME VERIFIED` and must never label an unexecuted test as passed.

## Commit discipline

Prefer small coherent commits. Every development commit includes `[skip ci]`. Do not touch GitHub Actions.
