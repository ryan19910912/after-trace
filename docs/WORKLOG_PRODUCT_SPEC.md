# AFTERTRACE Worklog Product Spec

## Product direction

AFTERTRACE is a **Web + PWA-first work memory product** with a compact Chrome extension for fast desktop capture.

Core promise:

> **快速留下工作發生過的事，需要時找得到。**

The product centers on Records, search, simple tasks/reminders, groups, optional AI assistance and subscription. It is not a CRM, ERP or general knowledge-management system.

LINE is not a Record/group/AI product surface. LINE Login remains an authentication provider and the official LINE OA remains a customer-support channel only.

## Customer surfaces

### Web / PWA

The Web/PWA home route `/` opens the **紀錄** page. Voice-to-text remains a convenient capture method, but it does not dominate the interface.

The authenticated product contains:

- 紀錄：quick capture + latest 10 Records;
- 待辦；
- 搜尋：general deterministic search + AI search;
- 方案；
- 群組；
- notifications, help, feedback and account menu.

Search remains its own page. The home page shows the latest 10 Records rather than becoming a second search interface.

### Chrome extension

The extension is a compact capture surface. It may create text Records, use browser speech-to-text, capture explicitly selected page text, attach bounded page context, and explicitly capture the visible tab screenshot for image AI while the user has remaining FREE AI experience points or an active paid AI subscription.

It must not silently capture browsing history, tabs, clipboard, full-page content, screen or microphone.

## Account and identity

Customer login providers:

- Google Login;
- LINE Login;
- Apple Login when operationally enabled.

Provider identities attach to one AFTERTRACE user. Do not silently merge accounts by email.

Every user has an immutable, unique, opaque/non-sequential `public_account_id`, displayed to the customer as **帳號 ID**. It is the preferred support lookup identifier and must not be the database primary key or a provider-specific identity.

## Records

A manually created Record has optional `title` (max 255), required `raw_text`, optional `occurred_at`, plus system timestamps.

FREE users can create/edit/delete/restore Records, view recent Records and search title/content by keyword/date. Every mutation uses optimistic versioning and preserves revision history.

The `/` page contains quick capture, latest 10 Records, edit/delete actions and a link to the independent Search page.

## Sources / groups

AFTERTRACE supports PRIVATE/personal and GROUP Sources created inside AFTERTRACE. MVP group roles are `OWNER` and `MEMBER`; backend authorization is checked for every group operation.

Customer UI should say “紀錄範圍”, “我的紀錄”, or the group name. Avoid exposing the internal word `Source`.

## Free product and one-time AI experience

FREE is a complete manual Record product.

Provider-free browser/device speech-to-text remains free and consumes no AI points.

FREE includes one idempotent, Admin-configured, one-time **shared AI experience allowance**. It does not refresh monthly.

While points remain, the FREE user may use the accepted AI feature set from the same balance:

- AI text capture/organization;
- natural-language AI search;
- image AI;
- audio AI;
- file/PDF AI;
- Chrome screenshot AI;
- related Records;
- time-range summaries;
- AI rewrite;
- AI task proposals.

Provider-backed operations reserve and settle against the shared FREE trial point balance. When those points are exhausted, provider-backed AI stops, while deterministic keyword/date search and all normal FREE manual functions remain available.

FREE trial media uses conservative limits: one image/request, 5 MB/image, 300 seconds/audio request, 10 MB/audio request and 10 MB/file request.

## Subscription plans

Paid plans are **backend-driven**.

- FREE remains the single zero-price base plan.
- Admin may create one or more paid `SUBSCRIPTION` plans.
- An enabled, AI-enabled, commercially valid subscription plan is automatically returned by the customer `/subscription/plans` API and rendered on the Web/PWA plan page.
- Customer Web/PWA must not hard-code a paid plan code, display name or price.
- The plan code is the durable identifier used by checkout, lifecycle, subscription history and monthly AI Grants.
- Editing a plan display name or price does not rename its existing plan code.
- A customer may have only one active paid plan at a time.

Current payment transport is NewebPay periodic card billing. The selected plan code is sent to the API; the API loads the selected plan from PostgreSQL and uses its current display name and price to build checkout.

NewebPay periodic checkout currently requires a positive integer TWD monthly price. Non-integer paid plan prices must not be offered as online-purchasable plans until the provider contract/adapter supports them.

No one-time top-up is part of the current product.

AI entitlement is per user, not per group.

## Paid AI features

Every active paid AI subscription can expose the complete accepted AI feature set subject to its plan switches and resource limits:

- AI text capture/organization;
- natural-language AI search;
- image AI;
- audio AI;
- supported PDF/text/document AI;
- related Records;
- time-range summaries;
- rewrite suggestions;
- task suggestions/proposals;
- Chrome screenshot AI.

Recommended initial media defaults are 1 image/request, 5 MB/image, 300 seconds audio/request, 10 MB audio/request and 10 MB file/request. Transport/runtime ceilings may be higher so Admin-configured plan limits remain authoritative below hard runtime ceilings.

## Paid subscription lifecycle

The lifecycle preserves the selected plan code end-to-end:

1. customer selects a backend plan;
2. checkout intent stores that `plan_code`;
3. NewebPay checkout amount/product name come from the selected DB plan;
4. callback recovers the selected plan through the checkout intent;
5. callback amount is validated against that plan price;
6. successful first payment activates that exact plan;
7. the subscription row and history keep that plan code;
8. monthly `SUBSCRIPTION_PERIOD` AI Grant uses that plan's configured point cap;
9. entitlement/provider-cost admission reads the active plan limits;
10. cancellation stops future renewal while preserving the already-paid period;
11. after expiry, the customer may start a new checkout for any currently available plan.

## AI enrichment / search / tools

AI-created/enriched Records may add nullable title, search terms, resolved event time when expressed by the user and bounded extracted facts useful for retrieval. AI must not invent an event time the user did not express.

General deterministic search is permanently FREE. AI Search and other AI tools use remaining FREE trial points or active paid-plan entitlement.

AI rewrite and task creation are proposal-first: the user explicitly confirms before durable content/task creation.

Customer copy must be plain Traditional Chinese. Do not expose engineering terms unless an internal Admin/developer screen genuinely needs them.

## Tasks / reminders

Tasks support title, optional body, optional due/remind times, status and optional source/record relation. Reminder scheduling is deterministic stored data; AI interpretation remains a suggestion before confirmation.

## Notifications

Notification categories are 公告通知, 系統通知 and 待辦通知. Channels are in-app and optional Web Push. Notification permission is requested only after explicit user action. Push failure must not remove the in-app notification.

## AI usage / customer experience

Customer UI must not expose internal provider cost or margin.

FREE AI experience may show remaining one-time points. Paid users should see a friendly usage state such as 使用狀況正常 / 接近本期上限 / 已達本期上限 and period end/reset time when known.

When AI is blocked by exhausted FREE points or paid plan limits, manual/free features remain available.

Internal entitlement source/reason names may retain `AI_PRO` as compatibility terminology for “active paid AI subscription”; they must not be used to filter the commercial plan catalog by exact plan code or price.

## Admin

Admin supports:

- exact user lookup by customer-facing 帳號 ID;
- one-time FREE AI experience point configuration and cost-to-point calculator;
- subscription plan create/list/detail/edit/enable/disable;
- editable monthly plan price;
- integrated plan price/margin → AI point/cost calculator;
- monthly AI point/provider-cost caps and optional per-request cap;
- AI feature switches;
- media limits;
- AI model/price/FX settings;
- profitability/reporting;
- announcements;
- feedback management.

Admin-created paid plans are not merely placeholders: enabled plans are customer-visible and may be purchased through the generalized NewebPay/lifecycle path when their price is provider-compatible.

## Database/schema policy

The canonical schema is application-owned and optimized for a prelaunch clean rebuild.

Rules:

- one canonical `drizzle/0000_worklog_baseline.sql`;
- every persistent product table/column has PostgreSQL COMMENT metadata;
- no PostgreSQL ENUM for application-domain values;
- no business/domain CHECK constraints;
- structural PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT remain in PostgreSQL;
- status transitions, pricing, plan capability rules and point/media limits belong to TypeScript/application services.

## Product priorities

### Current high priority

- stable Google + LINE login;
- Record CRUD + latest 10 + search;
- groups + invites;
- tasks/reminders + notifications;
- one-time shared FREE AI experience;
- backend-driven paid subscription catalog and NewebPay lifecycle;
- paid AI text/image/audio/file/tool features with monthly plan-specific allowance;
- Chrome extension screenshot through the same FREE_TRIAL/paid entitlement path;
- friendly AI usage state;
- plain-language customer/Admin UI;
- feedback + LINE OA support.

### Later / conditional

- Apple launch enablement;
- account-linking UX;
- multi-image AI input;
- additional payment providers or non-integer billing models;
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
