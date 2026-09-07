# AFTERTRACE Worklog Product Spec

## Product direction

AFTERTRACE is a **Web + PWA-first work memory product**. LINE is no longer a Record/group/AI product surface. The official LINE OA remains an external customer-support channel, and LINE Login remains one supported authentication provider. A Chrome extension is an optional fast-capture surface for desktop use.

Core promise:

> **快速留下工作發生過的事，需要時找得到。**

The product centers on a chronological Record timeline plus optional AI assistance. It is not a full CRM/ERP/knowledge-management workspace.

## Customer surfaces

### PWA

PWA is capture-first. The landing experience makes the microphone the primary action. Search/history, groups and account controls are secondary. Opening the PWA must not automatically start the microphone; the user explicitly starts/stops input.

### Web

Web is the full management surface: timeline/history, search/date filtering, manual CRUD, groups, subscription, notifications and AI features.

### Chrome extension

Initial scope: quick microphone/voice input, quick text input, destination Source/group selection, and submit through the same API/domain model as Web/PWA. Current-page title/URL capture is optional later work.

## Account and identity

Target architecture uses provider-neutral Web/PWA authentication with these customer login options:

- Google Login;
- LINE Login;
- Apple Login.

Google and LINE are first implementation priorities. Apple is supported and may follow after them if sequencing is needed.

Rules:

- provider identities attach to one AFTERTRACE user;
- do not make the core account depend on Google email, LINE id, Apple relay email or another provider-specific field;
- do not silently merge accounts merely because two providers expose the same email;
- LINE Login being available does **not** make LINE OA/GROUP/webhook part of the core Record/AI product surface;
- LINE OA remains a separate support channel under `WORKLOG_SUPPORT_POLICY.md`;
- provider identity data is never the customer-facing account identifier.

Every account has an immutable, unique, opaque/non-sequential `public_account_id`, shown as **帳號 ID**. It must not be the raw database primary key. Example presentation: `AT-7K4M2P`.

### Web / PWA account header

Authenticated Web/PWA surfaces expose the current user in the top-right area together with notifications.

Show at minimum:

- notification bell / unread count;
- user display name;
- customer-facing 帳號 ID;
- one-tap copy action for 帳號 ID.

The copied id is the preferred support lookup identifier. The user should not need to provide Google email, LINE id, Apple id or any other third-party identity merely to let support locate the AFTERTRACE account.

Follow `WORKLOG_ACCOUNT_IDENTITY_POLICY.md` for durable identity/linking rules.

## Support / feedback

Web/PWA exposes:

- `意見回饋` — in-product feedback form stored in AFTERTRACE and manageable from Admin;
- `聯絡客服` — opens the official AFTERTRACE LINE OA.

LINE OA is a support contact channel only. It does not create/search/edit Records, manage groups or mutate AI entitlement. No RAG/general-purpose AI support bot is required for the initial product. Follow `WORKLOG_SUPPORT_POLICY.md`.

## Sources / groups

AFTERTRACE supports personal and shared record spaces:

- PRIVATE / personal Source;
- GROUP Source created inside AFTERTRACE.

GROUP flow:

1. user creates a group in Web/PWA;
2. backend creates an invite link/token;
3. invited user authenticates and explicitly joins;
4. backend stores membership;
5. authorization is checked server-side on every group operation.

MVP roles may stay minimal (`OWNER`, `MEMBER`). Group membership is an AFTERTRACE fact.

## Free product

The free product is a complete manual work-record tool and includes **no provider-backed AI**.

Free users may manually create/edit/delete/restore Records, view timeline/history, search stored Record content, filter by time/date, use permitted group features, and use browser/device speech-to-text where supported when it does not call AFTERTRACE provider AI.

Free voice is **voice input / speech-to-text**, not AI voice interpretation.

### Free Record fields

A free/manual Record requires only:

- `content`;
- `occurred_at` — user-entered business/event date/time, nullable;
- `created_at` — system creation timestamp;
- `updated_at` — system last-modified timestamp.

Free Records do not require AI title, AI keywords or AI entities.

## AI subscription

AI is a paid subscription capability. AI entitlement is **per user**, not per group. There is no GROUP AI responsible-user concept in the target product.

If paid user A and free user B are in the same GROUP, A may use AI against authorized GROUP data; B may manually use permitted GROUP Record features but cannot invoke provider-backed AI.

### AI input capabilities

Paid AI may support:

- natural-language text input;
- AI voice interpretation;
- image input;
- supported file/PDF/document input.

Provider-backed inputs should converge on one shared bounded interpretation pipeline.

### AI enrichment for new Records

AI-created/enriched Records may add nullable metadata:

- `title`;
- `search_terms` / keywords;
- AI-resolved event date/time when expressed by the user;
- optional bounded extracted entities useful for retrieval such as PERSON, CUSTOMER, PROJECT, ORGANIZATION, AMOUNT or LOCATION.

Extracted entities are retrieval metadata, not a requirement to build CRM/ERP tables.

### No historical backfill

When a free user later subscribes to AI, **do not automatically reprocess historical free Records**.

- historical Records remain unchanged;
- enrichment begins only for new provider-backed operations after entitlement starts;
- old Records remain searchable from raw `content` and time filters;
- new AI Records may search better because they also have title/keywords/entities;
- natural-language retrieval searches both old raw content and new metadata where available.

## AI date interpretation

AI may resolve expressions such as `今天`, `昨天`, `下週三` against an explicit reference timestamp and product timezone. It must not invent a date/time that the user did not express.

Record time semantics remain distinct:

1. `occurred_at` = user/business event date/time, nullable;
2. `created_at` = storage time;
3. `updated_at` = modification time.

## Search and retrieval

### Free deterministic search

Provider-free search uses raw Record content, date/time filters and Source/group scope.

### AI natural-language search

Paid AI may interpret a natural-language request into bounded search terms/filters. PostgreSQL remains authoritative retrieval.

Search combines, where available:

- raw `content` for all Records;
- `title`;
- `search_terms`;
- bounded extracted entity metadata;
- date/time filters.

AI must not fabricate stored facts.

## Related Records

AI subscribers may receive related Record suggestions when viewing a Record. Initial ranking may remain deterministic and combine title overlap, keyword overlap, entity overlap, content full-text similarity, Source scope and recency. Vector/embedding search is optional later work.

## AI time-range summary

Paid AI may summarize an explicitly selected time range or bounded filtered Record set. Backend selects authorized Records deterministically first; AI summarizes only that bounded result set. Usage is audited as paid AI compute.

## AI rewrite / cleanup

Paid users may explicitly ask AI to rewrite/clean a selected Record. AI returns a proposal; user previews/accepts; backend commits through normal revision/version rules. AI never silently overwrites durable content.

## AI Q&A

AI Q&A may be added when retrieval grounding is reliable:

1. authorize user/Source;
2. interpret bounded query;
3. retrieve deterministic matching Records;
4. answer only from those Records;
5. preserve references/deep links to source Records;
6. state when evidence is insufficient.

Deterministic calculations are preferred for totals/aggregations where feasible.

## Tasks / reminders

AFTERTRACE includes a simple task/reminder direction. Paid AI may detect a task from natural-language input and propose it. It must not silently create a task without confirmation unless a later explicit rule changes this.

Suggested task facts:

- title/content;
- `due_at` nullable;
- `remind_at` nullable;
- status;
- related Source/Record nullable;
- `created_at` / `updated_at`.

Reminder scheduling is deterministic stored data. AI may interpret time language only as a proposal before user confirmation.

## Notifications

Current notification categories are:

- `ANNOUNCEMENT` / 公告通知;
- `SYSTEM` / 系統通知;
- `TASK` / 待辦通知.

Category and channel are separate. Current channels are durable `IN_APP` and optional `PUSH`.

### Announcement notifications

Admin can manually create an announcement such as `今晚 23:00～23:15 進行系統更新` and choose:

- audience: ALL_USERS / FREE_USERS / AI_SUBSCRIBERS / SPECIFIC_USERS;
- immediate or scheduled send;
- IN_APP and/or PUSH;
- preview before send;
- cancel while still pending;
- inspect delivery/status summary.

Manual Admin messages are ANNOUNCEMENT by default; do not fabricate a SYSTEM business event merely because Admin typed a message.

### System notifications

SYSTEM notifications are deterministic backend events such as:

- payment success;
- subscription activation/renewal/cancellation;
- AI monthly resource limit reached.

Event-driven notification creation must be idempotent so retries/webhook redelivery cannot duplicate the same customer event.

### Task notifications

TASK notifications are generated from the user's confirmed task/reminder data.

Initial scheduler:

- one global Cloudflare Worker scheduled handler/Cron, approximately every 5 minutes;
- bounded query for due reminders and scheduled announcements;
- idempotent notification creation/delivery;
- no one-Cron-per-task design;
- Cloudflare Queue only later if volume/fan-out requires it.

### Notification center

Web/PWA includes a notification center opened from the top-right bell. It shows unread count and durable read/unread state. Push delivery failure must not remove an IN_APP notification that should remain visible.

### iOS/iPadOS PWA Push

AFTERTRACE supports the installed Home Screen PWA push path on supported iOS/iPadOS versions.

- user adds AFTERTRACE to the Home Screen;
- notification permission is requested only after an explicit user action such as `開啟通知`;
- never auto-prompt for notification permission on initial load;
- if push is denied/unsupported, IN_APP notifications still work;
- do not claim a normal Safari tab has identical push behavior to the installed Home Screen PWA.

Android/desktop PWA use the same Web Push domain model where supported.

Google Calendar integration remains later/optional. Native tasks + notification center + PWA push come first.

Follow `WORKLOG_NOTIFICATION_POLICY.md` for durable notification behavior.

## AI subscription usage limits / fair use

Customer-facing subscription must **not** claim mathematically unlimited provider compute.

Suggested disclosure:

> **日常使用不限次數；AI 功能仍受公平使用原則與每月方案資源上限限制。達到上限後，AI 功能將於下一個週期恢復。**

User UI should show a friendly state such as normal / approaching limit / limit reached and next reset date. Do not expose provider cost or margin.

Admin plan configuration should support at minimum:

- `price_twd`;
- `ai_enabled`;
- monthly AI point/resource cap;
- monthly provider-cost cap in TWD;
- optional per-request safety cap;
- optional modality limits such as file size/image count/audio duration;
- feature toggles such as natural-language search, summary, image/file AI.

Runtime fails closed when a hard limit is reached. The provider-cost cap protects unit economics even if token mix/model pricing changes.

## AI usage/accounting

Internal AI points/resource units may remain an implementation/accounting detail and do not need to dominate customer UX.

Admin retains auditable provider-call facts: user, Source/group, operation, provider/model, usage units/tokens, pricing snapshot, actual provider cost USD/TWD, plan/period, and whether a request was blocked by plan/resource caps.

## Product priorities

### High priority

- provider-neutral Google + LINE login, with Apple supported next if sequencing is needed;
- immutable copyable public account id shown in Web/PWA account header + Admin exact lookup;
- Web/PWA manual Record CRUD;
- capture-first PWA microphone UX;
- free browser/device speech-to-text where practical;
- AFTERTRACE groups + invite links;
- notification center + Admin announcements + SYSTEM notification foundation;
- paid AI text/voice/image/file interpretation;
- AI title/keywords/date for new AI operations only;
- deterministic content/date search;
- paid natural-language search;
- related Records;
- AI time-range summary;
- AI rewrite;
- tasks + PWA push reminders;
- subscription fair-use/resource caps and Admin controls;
- in-product feedback + LINE OA support entry.

### Later / conditional

- safe account-linking/merge UX across providers;
- AI Q&A after grounding quality is proven;
- Calendar integration;
- vector/embedding search;
- Chrome current-page URL/title capture.

### Not current priority

- LINE OA/GROUP bot as a Record/AI product surface;
- GROUP AI responsible user/funding owner;
- LINE Reply cache/mentions/product-command lifecycle;
- automatic historical AI backfill;
- project/group AI summary as a standalone feature;
- broad CRM/ERP schema;
- RAG/general AI customer-support bot.

## Brand

Keep the product name **AFTERTRACE** for now. Naming may be revisited later without blocking product development.
