# AFTERTRACE Worklog Entity Model

Durable product/domain contract for branch `revive/line-worklog`. Read together with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_RECORD_EDIT_POLICY.md` before schema/runtime work.

## Core model

AFTERTRACE is a general-purpose LINE/PWA work-record product, not a construction-, finance-, customer-, or project-specific database.

The durable truth is a Record inside one PRIVATE or GROUP Source. Each Record belongs to one searchable **Entity / 紀錄標題**.

Core domain tables planned:

- `worklog_sources`
- `worklog_entities`
- `worklog_entity_aliases`
- `worklog_records`
- `worklog_record_revisions`
- `worklog_ai_confirmations`

A generic `worklog_record_entities` many-to-many table is no longer required by the accepted MVP model unless a later feature introduces multi-Entity relationships.

Legacy fixed `Customer` / `Project` concepts should not remain the universal core model.

## Entity = 紀錄標題

`Entity` is the internal/domain name. Ordinary users see **紀錄標題**.

Examples:

- `晴空案`
- `信義門市`
- `王大明`
- `3 號冷氣主機`

Which kind of thing becomes a title depends on the Source/group's actual use. A construction-site group may naturally use project/site names such as `晴空案` as titles rather than creating a title for every worker mentioned in Record text.

Recommended `worklog_entities` fields:

- `id`
- `source_id`
- `name`
- optional lightweight `entity_type`
- `status`
- timestamps

Entity metadata stays intentionally small. Do not add universal address, phone, finance or construction-specific columns.

## One Record has one title

Accepted MVP rule: a Record belongs to one Entity/title.

Example:

`王大明跟陳師傅今天去晴空案換冷氣，材料費 5000，人工 5000`

Expected result:

- 紀錄標題 / Entity: `晴空案`
- Record content retains `王大明`, `陳師傅`, work details and amounts as text

Do **not** automatically create extra Entities such as `王大明` or `陳師傅` merely because AI noticed those names in the Record.

If a user later searches `王大明`, PWA fuzzy search searches Record content and can still find all matching Records and show which titles they belong to.

Consequences:

- no `PRIMARY` / `RELATED` role distinction is needed for the accepted MVP;
- `worklog_records` may hold `entity_id` directly;
- a Record title is its filing/search context;
- other names/details remain searchable raw content unless explicitly used as titles in other Records.

## Alias / 其他稱呼

Alias means a genuine alternate name for the same title/Entity.

Example:

- canonical title: `晴空案`
- confirmed alias: `三重晴空案`

A contextual phrase such as `王大明的晴空案` is not automatically an alias. AI should distinguish a genuine alternate title from ordinary sentence context.

Recommended `worklog_entity_aliases` fields:

- `id`
- `entity_id`
- `alias`
- `created_by_user_id`
- `created_via`
- timestamps

Confirmed aliases resolve directly in future.

## AI title parsing on new AI-assisted Record

For an AI-assisted new Record, AI should keep structured work small and predictable:

1. determine the single best Record title / Entity;
2. resolve whether that title matches an existing Entity or confirmed alias in the same Source;
3. detect a possible alias match that needs user confirmation;
4. resolve `occurred_at` when the message expresses an event time;
5. preserve the user's Record text/durable textual extraction as stored content.

AI does not need to create relationships for every person/object mentioned in the Record and does not need universal extraction of amount/address/payment/material/task fields.

AI-assisted creation consumes AI allowance normally.

## Pending AI confirmation

Ambiguity must be durable instead of stored only in Worker memory.

Use a `worklog_ai_confirmations`-style table for questions that need user confirmation before an identity/title decision is committed.

Recommended fields:

- `id`
- `source_id`
- `record_id` when already known
- `requested_user_id`
- `confirmation_type`
- `candidate_entity_id` when applicable
- `proposed_name` / candidate payload
- `status`
- `created_at`
- `expires_at` where appropriate
- `resolved_at`

Initial confirmation types may include `ALIAS_MATCH`, `RECORD_TITLE`, and `ENTITY_MATCH`.

If multiple candidates are plausible, ask the user to choose among them or create a new title. Do not silently guess.

## PWA manual create terminology

PWA manual creation is free and does not invoke AI.

User-facing fields:

- **紀錄標題**
- **紀錄內容**
- **發生時間** using a date/time picker

Behavior:

- title autocomplete searches existing Entity names and aliases in the current Source;
- choosing an existing title attaches that Entity;
- entering a new title creates a new Entity in that Source;
- no AI relationship inference occurs;
- names mentioned only in Record content remain searchable through fuzzy search.

## PWA title operations — simplified MVP

Do not create a dedicated title-management area for MVP.

Title and Record operations should stay close to the normal Record list/detail UX. Authorized users can, where appropriate:

- rename/change a Record's title;
- edit Record content;
- delete/restore Records;
- inspect edit history.

A separate complex Entity administration surface is not required merely to manage titles.

### Duplicate titles / merge

Generic title merge/undo is **deferred and not required for MVP**.

If a Record was filed under the wrong title, the user can manually change that Record's title. If duplicate titles exist, users may manually correct affected Records as needed.

Do not build merge batches, merged states, moved-record history, or undo-merge machinery unless real user feedback later proves duplicate-title cleanup is a meaningful pain point.

This deliberately prefers a simple, obvious manual correction flow over a complex feature that may not be used.

## Record time

A Record distinguishes:

- `created_at`: when AFTERTRACE stored it;
- `occurred_at`: when the real-world event occurred;
- `updated_at`: last current-row modification time.

If no event time is supplied, `occurred_at` defaults to message/create time. AI-assisted ingestion may parse relative language into `occurred_at`. PWA manual creation uses a date/time picker.

## PWA lookup/search model

PWA is the authoritative retrieval surface for MVP.

Search/filter is intentionally limited to three composable mechanisms:

1. 紀錄標題 / Entity;
2. fuzzy search across title names, aliases, and Record content;
3. date range over `occurred_at`.

Example: if `王大明` is not a title but appears inside Records under `晴空案`, fuzzy search `王大明` still returns those Records.

## LINE history navigation

LINE does not become an open-ended historical database agent.

AI first classifies the user's intent. If the message is a history/search request, AI converts the natural-language request into PWA filters and returns a pre-filtered PWA URL.

Examples:

- `王大明這週做了什麼`: use title filter if `王大明` is a title; otherwise fuzzy keyword `王大明`; include the recognized date range.
- `這個群組今天發生什麼`: no title filter required; include today's date range.

The accepted boundary is **natural language -> deterministic PWA filters**, not AI reading arbitrary history and generating a historical answer.

Keep the backend function surface small, conceptually one operation such as:

`build_history_link(source_id, entity_id?, keyword?, from?, to?)`

PWA/API performs the real deterministic query.

## Delete / restore behavior

Record deletion is soft deletion only.

Deleting a Record changes its status to `DELETED`; title/entity reference and revisions remain durable. Normal search excludes deleted Records, recycle-bin/history can still show them, and restore makes the same Record visible again.

Do not delete an Entity/Alias merely because one Record was deleted.

## Persistent Record-to-Record relations

A generic `RecordRelation` table is not required for MVP merely because two Records concern the same event progression.

Both `晴空案冷氣壞掉` and later `晴空案冷氣已修好` can simply use title `晴空案`; chronological PWA history is sufficient for MVP.

Only introduce durable typed Record-to-Record relations later when a concrete approved feature needs deterministic state.

## Raw Records and AI summaries

Raw Record text/durable textual extraction is the stored truth.

Accepted direction:

- do not maintain a persistent per-record AI summary;
- users edit the Record, not an AI summary;
- broad AI historical analysis/query is not required for MVP;
- LINE history requests navigate to filtered PWA views;
- future explicit AI report/summary may be added separately, consume AI allowance, and remain ephemeral.

## Concurrency

Record editing uses database optimistic concurrency with a durable integer `version`.

A save succeeds only when submitted expected version equals current version; successful save increments it. Stale writes are rejected. Do not use process-memory locks or Redis merely for normal Record editing.
