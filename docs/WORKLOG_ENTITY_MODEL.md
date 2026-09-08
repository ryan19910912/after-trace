# AFTERTRACE Worklog Entity Model

Read with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_RECORD_EDIT_POLICY.md` before schema/runtime work.

## Core model

AFTERTRACE is a general-purpose Web/PWA work-memory product. Durable truth is a Record inside one authorized Source.

Target core structures:

- `worklog_users` plus provider-neutral auth/public-account identity tables;
- `worklog_sources`;
- `worklog_source_members`;
- native Source invite tables;
- `worklog_records`;
- `worklog_record_revisions`;
- subscription/AI usage and Grant/accounting tables;
- task/reminder tables;
- notification/PUSH tables;
- feedback/support-management tables;
- payment-provider adapter state where required.

Retired LINE Messaging, LINE GROUP bot, Entity/Alias, confirmation, GROUP AI responsibility/funding-owner and ONE_TIME/TOP_UP schemas are **not target-domain concepts and must not be reintroduced into the canonical schema**. LINE remains only a provider-neutral login provider plus the external official OA support channel.

## Record model

A Record is valid without AI enrichment.

Required/base facts:

- `id`;
- `source_id`;
- author/creator identity;
- `content` / durable raw text;
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

Paid AI or an eligible FREE one-time AI trial may produce title, grounded search terms, event date interpretation and bounded extraction metadata as part of an explicitly provider-backed operation.

AI metadata remains subordinate to durable Record content. Provider output never becomes authority to mutate unrelated Records or create unrelated domain rows without deterministic backend rules.

## Extracted entities are metadata, not master data

Optional AI extraction may identify values useful for retrieval, initially such as:

- `PERSON`;
- `CUSTOMER`;
- `PROJECT`;
- `ORGANIZATION`;
- `AMOUNT`;
- `LOCATION`.

These values are **search/retrieval metadata only**. There is no generic Entity/Alias master-data workflow in the target product.

Example input:

`今天晴空案向王先生收了 3000 元清潔費`

May yield retrieval metadata equivalent to:

- title: `晴空案`;
- search terms: `晴空案`, `王先生`, `清潔費`, `收款`;
- PROJECT = `晴空案`;
- PERSON/CUSTOMER = `王先生`;
- AMOUNT = `3000 TWD`.

Do not automatically create Customer/Project/Entity/Alias rows merely because a phrase appears.

## Historical free Records after subscription

No automatic AI backfill.

When a user subscribes later:

- old Records remain unchanged;
- old Records may have no title/search terms/entities metadata;
- raw `content` and time remain searchable;
- new provider-backed Records may receive AI metadata;
- retrieval must support both kinds of Records.

## Source model

PRIVATE and GROUP Sources are independent authorization spaces.

- PRIVATE Source belongs to its AFTERTRACE user.
- GROUP Source is created inside AFTERTRACE and has a non-empty product name.
- GROUP membership is stored in `worklog_source_members`.
- GROUP join uses AFTERTRACE invite links/tokens.
- No LINE group id, LINE bot membership or LINE webhook state participates in Source authorization.

Initial roles:

- `OWNER`;
- `MEMBER`.

Server-side authorization is mandatory on every read/write/search/task/AI operation.

## Group invite model

Invite links/tokens are durable, bounded and revocable/expirable according to accepted UX rules. At minimum they identify the target group but grant no data access until the invited user authenticates and the backend records membership.

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

Paid or eligible trial natural-language retrieval may additionally use, where present:

- title;
- search terms;
- extracted metadata;
- AI-derived bounded filters.

PostgreSQL remains the authoritative retrieval layer.

## Related Records

Related-record suggestions are a retrieval/ranking feature, not a durable generic relation domain for MVP.

Initial scoring can use title/keyword/entity-metadata/content overlap and time/Source context. Do not add generic RecordRelation tables until a concrete durable relationship feature needs them.

## Tasks

Tasks are separate actionable objects, not a special kind of Record.

Target facts include:

- `id`;
- `user_id` and optional authorized Source;
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

## Canonical schema rule

`apps/api/src/db/schema-all.ts` is the authoritative Drizzle export. During prelaunch the canonical `drizzle/0000_worklog_baseline.sql` and metadata may be regenerated from that target schema and applied to a fresh disposable database. Do not preserve retired product tables merely for old test-data compatibility.
