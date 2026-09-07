# AFTERTRACE Worklog Product Spec

## Product direction

AFTERTRACE is a **Web + PWA-first work memory product**. LINE is no longer part of the target product architecture. A Chrome extension is an optional fast-capture surface for desktop use.

Core promise:

> **快速留下工作發生過的事，需要時找得到。**

The product centers on a chronological Record timeline plus optional AI assistance. It is not a full CRM/ERP/knowledge-management workspace.

## Customer surfaces

### PWA

PWA is capture-first. The landing experience makes the microphone the primary action. Search/history, groups and account controls are secondary. Opening the PWA must not automatically start the microphone; the user explicitly starts/stops input.

### Web

Web is the full management surface: timeline/history, search/date filtering, manual CRUD, groups, subscription and AI features.

### Chrome extension

Initial scope: quick microphone/voice input, quick text input, destination Source/group selection, and submit through the same API/domain model as Web/PWA. Current-page title/URL capture is optional later work.

## Account and identity

Target architecture uses normal Web/PWA authentication with **both Google Login and LINE Login** available as first-class sign-in options.

Rules:

- Google and LINE identities are provider-neutral authentication identities attached to one AFTERTRACE user;
- do not make the core `users` table depend on either provider-specific id;
- a user may later link both providers to the same AFTERTRACE account when safe account-linking is implemented;
- LINE Login being available does **not** make LINE OA/GROUP/webhook part of the core product surface;
- LINE OA remains a separate support channel under `WORKLOG_SUPPORT_POLICY.md`;
- provider identity data is never the customer-facing account identifier.

Recommended identity model:

- `worklog_users` = durable AFTERTRACE account;
- `worklog_auth_identities` = provider identity rows such as `GOOGLE` or `LINE`;
- `public_account_id` = immutable, unique, non-secret customer-facing support/account identifier.

`public_account_id` must not be the raw database primary key. Prefer an opaque, non-sequential value such as `AT-7K4M2P` so users can safely provide it to support without exposing internal row ids or third-party identity values.

### Web / PWA account header

Authenticated Web/PWA surfaces should expose the current user in the top-right area together with the notification entry.

Show at minimum:

- notification bell / unread count;
- user display name;
- customer-facing **帳號 ID** (`public_account_id`);
- one-tap copy action for 帳號 ID.

The copied value should be suitable for support lookup. The user should not need to provide Google email, LINE id, LINE display name or any other third-party identity merely to let support locate the AFTERTRACE account.

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

AFTERTRACE may include a simple task list. Paid AI may detect a task from natural-language input and propose it. It must not silently create a task without confirmation unless a later explicit rule changes this.

Suggested task facts:

- title/content;
- `due_at` nullable;
- `remind_at` nullable;
- status;
- related Source/Record nullable;
- `created_at` / `updated_at`.

### Push notifications

PWA push is an accepted reminder direction. Reminder scheduling is deterministic data; AI may interpret the phrase, but persisted timestamps must be concrete.

Initial backend scheduler:

- Cloudflare Worker Cron Trigger, e.g. every 5 minutes;
- bounded query for due notifications;
- idempotent delivery state such as `notified_at` or delivery rows;
- Cloudflare Queue may be added when fan-out volume requires it;
- one global scheduler, not one Cron per task.

Google Calendar integration is later/optional. Native tasks + PWA push come first.

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

- Google Login + LINE Login through provider-neutral identities;
- immutable copyable public account id shown in Web/PWA account header;
- Web/PWA manual Record CRUD;
- capture-first PWA microphone UX;
- free browser/device speech-to-text where practical;
- AFTERTRACE groups + invite links;
- paid AI text/voice/image/file interpretation;
- AI title/keywords/date for new AI operations only;
- deterministic content/date search;
- paid natural-language search;
- related Records;
- AI time-range summary;
- AI rewrite;
- tasks + PWA push reminders;
- subscription fair-use/resource caps and Admin controls.

### Later / conditional

- safe account-linking between already-existing Google/LINE identities;
- AI Q&A after grounding quality is proven;
- Calendar integration;
- vector/embedding search;
- Chrome current-page URL/title capture.

### Not current priority

- LINE OA/GROUP bot product surface;
- GROUP AI responsible user/funding owner;
- LINE Reply cache/mentions/webhook lifecycle;
- automatic historical AI backfill;
- project/group AI summary as a standalone feature;
- broad CRM/ERP schema.

## Brand

Keep the product name **AFTERTRACE** for now. Naming may be revisited later without blocking product development.
