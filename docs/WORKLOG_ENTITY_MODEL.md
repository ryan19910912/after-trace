# AFTERTRACE Worklog Entity Model

Read with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_RECORD_EDIT_POLICY.md` before schema/runtime work.

## Core model

AFTERTRACE is a general-purpose Web/PWA work-memory product. Durable truth is a Record inside one authorized Source.

Target core structures:

- `worklog_sources`;
- `worklog_source_members`;
- `worklog_records`;
- `worklog_record_revisions`;
- subscription/AI usage tables;
- optional task/reminder tables;
- optional invite-link tables.

Existing LINE-specific tables and older Entity/Alias structures may remain during migration but are not mandatory target-domain concepts.

## Record model

A Record is valid without AI enrichment.

Required/base facts:

- `id`;
- `source_id`;
- author/creator identity;
- `content`;
- `occurred_at` nullable;
- `created_at`;
- `updated_at`;
- status/version needed for revisions and optimistic concurrency.

AI-enriched Records may additionally contain nullable metadata such as:

- `title`;
- `search_terms` / keywords;
- bounded extracted entities/attributes;
- `ai_enriched_at` or equivalent enrichment status/audit markers.

Do not infer AI enrichment merely from `title IS NOT NULL`; keep an explicit enrichment/audit state when practical.

## Free/manual Records

Free/manual Records do not require title, keywords or AI metadata.

A manual Record may therefore be only:

- content;
- user-entered event time/date if supplied;
- system create/update timestamps.

Manual CRUD must not silently call provider AI to fill metadata.

## AI-enriched Records

Paid AI may produce title, grounded search terms, event date interpretation and bounded extraction metadata as part of a provider-backed operation.

AI metadata remains subordinate to durable Record content. Provider output never becomes authority to mutate unrelated Records or create unrelated domain rows without deterministic backend rules.

## Extracted entities

Optional AI extraction may identify values useful for retrieval, initially such as:

- `PERSON`;
- `CUSTOMER`;
- `PROJECT`;
- `ORGANIZATION`;
- `AMOUNT`;
- `LOCATION`.

These are **search/retrieval metadata**, not automatic CRM/ERP objects.

Example input:

`今天晴空案向王先生收了 3000 元清潔費`

May yield retrieval metadata equivalent to:

- title: `晴空案`;
- search terms: `晴空案`, `王先生`, `清潔費`, `收款`;
- PROJECT = `晴空案`;
- PERSON/CUSTOMER = `王先生`;
- AMOUNT = `3000 TWD`.

Do not automatically create a Customer/Project master row merely because the phrase appears.

## Historical free Records after subscription

No automatic AI backfill.

When a user subscribes later:

- old Records remain unchanged;
- old Records may have no title/search terms/entities;
- raw `content` and time remain searchable;
- new provider-backed Records may receive AI metadata;
- retrieval must support both kinds of Records.

## Source model

PRIVATE and GROUP Sources are independent authorization spaces.

GROUP Sources are created inside AFTERTRACE and joined using AFTERTRACE invite links/tokens. Target authorization no longer depends on LINE group membership or bot lifecycle.

Initial roles may remain simple:

- `OWNER`;
- `MEMBER`.

Server-side authorization is mandatory on every read/write/search/task/AI operation.

## Group invite model

Invite links/tokens should be durable and revocable/expirable according to later concrete UX requirements. At minimum they must identify the target group and must not grant data access before the invited user authenticates and the backend records membership.

## Record time model

A Record distinguishes:

- `occurred_at` = user/business event date/time; nullable;
- `created_at` = actual AFTERTRACE storage time;
- `updated_at` = last current-row modification time.

AI may resolve relative date language against an explicit reference timestamp and timezone. It must not invent a date/time that the user did not express.

## Search model

Free deterministic search may use:

- Source;
- raw Record content;
- event/system date range.

Paid natural-language retrieval may additionally use, where present:

- title;
- search terms;
- extracted metadata;
- AI-derived bounded filters.

PostgreSQL remains the authoritative retrieval layer.

## Related Records

Related-record suggestions are a retrieval/ranking feature, not a durable many-to-many domain requirement for MVP.

Initial scoring can use title/keyword/entity/content overlap and time/Source context. Do not add generic RecordRelation tables until a concrete durable relationship feature needs them.

## Tasks

Tasks are separate actionable objects, not a special kind of Record.

Suggested target facts:

- `id`;
- `user_id` and/or authorized Source;
- optional `record_id`;
- title/content;
- `due_at` nullable;
- `remind_at` nullable;
- status;
- `created_at` / `updated_at`;
- notification delivery state when required.

AI may propose a Task from a Record/input, but task creation is deterministic after user confirmation.

## Revision/concurrency

Record editing uses durable optimistic `version`. Successful mutations preserve immutable revision/history facts. See `WORKLOG_RECORD_EDIT_POLICY.md`.
