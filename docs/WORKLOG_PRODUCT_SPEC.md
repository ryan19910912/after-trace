# AFTERTRACE Worklog Product Spec

## Product direction

AFTERTRACE is a **Web + PWA-first work memory product** with a compact Chrome extension for fast desktop capture.

Core promise:

> **快速留下工作發生過的事，需要時找得到。**

The product centers on Records, search, simple tasks/reminders, groups, optional AI assistance and subscription. It is not a CRM, ERP or general knowledge-management system.

LINE is not a Record/group/AI product surface. LINE Login remains an authentication provider and the official LINE OA remains a customer-support channel only.

## Customer surfaces

### Web / PWA

The Web/PWA home route `/` opens the **紀錄** page. Do not force a separate microphone-first landing page. Voice-to-text remains a convenient capture method, but it does not need to dominate the interface.

The authenticated product contains:

- 紀錄：quick capture + latest 10 Records;
- 待辦；
- 搜尋：general deterministic search + AI search;
- 方案；
- 群組；
- notifications, help, feedback and account menu.

Search remains its own page. The home page shows the latest 10 Records rather than becoming a second search interface.

### Chrome extension

The extension is a compact capture surface. It may:

- create text Records;
- use browser speech-to-text;
- capture explicitly selected page text;
- optionally attach the current page title + URL as bounded context;
- explicitly capture the visible tab screenshot and send it to image AI **only for an active AI Pro subscription**.

It must not silently capture browsing history, tabs, clipboard, full-page content, screen or microphone.

## Account and identity

Customer login providers:

- Google Login;
- LINE Login;
- Apple Login when operationally enabled.

Provider identities attach to one AFTERTRACE user. Do not silently merge accounts by email.

Every user has an immutable, unique, opaque/non-sequential `public_account_id`, displayed to the customer as **帳號 ID**. It is the preferred support lookup identifier and must not be the database primary key or a provider-specific identity.

Authenticated Web/PWA headers expose notification bell/unread count, display name, 帳號 ID and copy action.

## Records

### Manual Record fields

A manually created Record has:

- `title` — optional user-entered title, maximum 255 characters;
- `content` / persisted `raw_text` — required;
- `occurred_at` — optional business/event date-time;
- `created_at` — system creation timestamp;
- `updated_at` — system last-modified timestamp.

Manual Records do **not** require AI-generated title, keywords or entities.

If title is empty, customer UI may show a short content preview as the display heading; the stored title remains null.

### Record CRUD

FREE users can:

- create Records;
- edit title, content and occurred time;
- delete to recycle bin;
- restore from recycle bin;
- view latest Records;
- search title/content by keyword and date.

Every mutation uses optimistic versioning and preserves revision history. User-facing copy should say “修改紀錄” or equivalent; do not expose implementation terms such as optimistic locking/revision API.

### Home page

The `/` Record page contains:

1. quick capture form: destination, optional title, optional occurred time, required content, optional browser speech-to-text;
2. latest 10 Records for the selected destination;
3. clear Edit/Delete actions on active Records;
4. link to the independent Search page for full history/filtering.

Record list/search cards show title first and content second. When title is null, use a bounded content preview as the heading.

## Sources / groups

AFTERTRACE supports:

- PRIVATE/personal Source;
- GROUP Source created inside AFTERTRACE.

MVP group roles: `OWNER`, `MEMBER`. Backend authorization is checked for every group operation.

Customer UI should say “紀錄範圍”, “我的紀錄”, or the group name. Avoid exposing the internal word `Source`.

## Free product and AI search trial

FREE is a complete manual Record product.

FREE users manually create/edit text Records. Provider-free browser/device speech-to-text may turn speech into text where supported; this remains a manual text path and does not consume AI points.

FREE includes one idempotent, Admin-configured, one-time **AI search trial**. It does not refresh monthly.

The Free AI trial points may be consumed **only by natural-language AI Search**. When those points are exhausted, deterministic keyword/date search and all normal FREE manual functions remain available.

The Free AI trial does **not** unlock:

- AI text capture/automatic organization;
- image AI;
- audio AI;
- file/PDF AI;
- related-record AI tools;
- time-range summaries;
- AI rewrite;
- AI task proposals.

Those provider-backed capabilities require an active AI Pro subscription.

## Subscription plans

Current launch offering:

- FREE — NT$0;
- AI Pro — NT$99/month, billed through NewebPay periodic card billing.

The schema and Admin configuration support adding additional subscription plan definitions later. Admin plan creation does not by itself make a new plan purchasable; payment checkout/renewal support must explicitly support that plan before it is exposed to customers for purchase.

No one-time top-up is part of the current product.

AI entitlement is per user, not per group.

## AI Pro features

AI Pro unlocks the complete accepted AI feature set:

- AI text capture/organization;
- natural-language AI search;
- image AI;
- audio AI;
- supported PDF/text/document AI;
- related Records;
- time-range summaries;
- rewrite suggestions;
- task suggestions/proposals.

Current recommended media defaults:

- images per request: **1** while the current client/API is single-image; when multi-image input ships, recommended default is **4 images/request**;
- image size: **5 MB per image**;
- audio duration: **300 seconds (5 minutes) per request**;
- audio size: **10 MB per request**;
- file size: **10 MB per file/request**.

“Images per request” means the maximum number of images in one AI operation. It is **not** a lifetime or monthly image-count quota.

Transport/runtime absolute ceilings may be higher (currently 20 MB image, 30 MB audio/file) so Admin-configured per-plan limits remain authoritative below those safety ceilings.

These limits belong to application-level plan capabilities/configuration. Database CHECK constraints must not encode them.

## AI enrichment

AI-created/enriched Records may add nullable metadata:

- title;
- search terms/keywords;
- resolved event time when expressed by the user;
- bounded extracted facts useful for retrieval.

Do not automatically AI-backfill historical manual Records when a user subscribes.

AI must not invent an event time that the user did not express.

## Search

### General search

FREE deterministic search covers stored title/content, date range and authorized Record scope. Search is an independent page.

### AI search

The one-time FREE AI search trial or AI Pro may interpret natural-language requests and search authorized Records. PostgreSQL remains authoritative retrieval. AI must not fabricate stored facts.

FREE trial points are consumed only here.

## AI tools

Customer-facing AI tools include:

- related Records;
- time-range summary;
- rewrite suggestion;
- task suggestion.

These tools require AI Pro. AI rewrite and task creation are **proposal first**. The user explicitly confirms before durable content/task creation.

Customer copy must be plain Traditional Chinese. Do not show engineering terms such as `Source`, `Record ID`, `provider`, `bounded dataset`, `proposal`, `Grant`, `runtime`, `ledger`, `metadata`, `optimistic version`, or `revision API` unless the context is explicitly an internal Admin/developer screen where the term is necessary.

## Tasks / reminders

Tasks support title, optional body, optional due/remind times, status and optional source/record relation.

Reminder scheduling is deterministic stored data. AI may interpret a task/time only as a suggestion before confirmation, and that AI suggestion requires AI Pro.

## Notifications

Notification categories:

- 公告通知;
- 系統通知;
- 待辦通知.

Channels:

- in-app notification;
- optional Web Push.

Notification permission is requested only after an explicit user action. Push failure must not remove the in-app notification.

## AI usage / customer experience

Customer UI must not expose internal provider cost or margin.

AI Pro should show a friendly usage state:

- 使用狀況正常;
- 接近本期上限;
- 已達本期上限;
- next reset/period date when known.

When AI is blocked by a monthly limit, manual/free features remain available.

## Admin

Admin supports:

- exact user lookup by customer-facing 帳號 ID;
- free one-time AI search trial point configuration;
- subscription plan list supplied by backend;
- adding and editing future subscription plan definitions;
- monthly AI point cap;
- monthly AI supplier-cost cap;
- optional per-request AI point cap;
- AI feature switches;
- media limits: images/request, image bytes, audio seconds, audio bytes, file bytes;
- AI cost calculator/reporting;
- announcements;
- feedback management.

Admin customer/operations copy should still prefer plain Chinese. Technical accounting terms are allowed only where they are necessary for internal cost diagnosis.

## Database/schema policy

The canonical schema is application-owned and optimized for a prelaunch clean rebuild.

Rules:

- canonical prelaunch migration is a single `drizzle/0000_worklog_baseline.sql`;
- every persistent product table must have a PostgreSQL `COMMENT ON TABLE` description;
- every persistent product column must have a PostgreSQL `COMMENT ON COLUMN` description;
- comments are schema metadata and must be included in the canonical baseline;
- do not use PostgreSQL ENUM for application-domain values; use ordinary varchar/text and validate legal values in TypeScript/application services;
- do not encode business/domain rules in database `CHECK` constraints;
- handwritten SQL should not add explicit named `CONSTRAINT` clauses for business logic;
- structural integrity remains in the database: PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL, INDEX and appropriate DEFAULT/type constraints;
- status transitions, category allowlists, pricing rules, point limits and cross-field business rules belong to application services.

## Product priorities

### Current high priority

- stable Google + LINE login;
- Record title/content/time CRUD;
- latest 10 Record preview + independent Search page;
- groups + invites;
- tasks/reminders + notifications;
- FREE one-time AI search trial;
- AI Pro full text/image/audio/file/tool features;
- Chrome extension screenshot-to-AI-Pro path;
- NewebPay AI Pro payment lifecycle;
- friendly AI usage state;
- backend-driven Admin subscription plan management;
- plain-language customer/Admin UI;
- feedback + LINE OA support.

### Later / conditional

- Apple launch enablement;
- safe provider account linking/merge UX;
- multi-image AI input (recommended 4/request when introduced);
- additional purchasable paid tiers after payment lifecycle supports them;
- Calendar integration;
- vector/embedding retrieval;
- richer screenshot region selection.

### Not current priority

- LINE bot/webhook as Record/AI surface;
- group AI funding owner;
- automatic historical AI backfill;
- broad CRM/ERP schema;
- general-purpose AI customer-support bot;
- automatic browsing-history or full-page capture.
