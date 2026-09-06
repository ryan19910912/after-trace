# AFTERTRACE Worklog Entity Model

Durable product/domain contract for branch `revive/line-worklog`. Read with PRODUCT_SPEC and RECORD_EDIT_POLICY before schema/runtime work.

## Core model

AFTERTRACE is a general-purpose PWA/LINE work-record product, not a construction-, finance-, customer-, or project-specific database.

Durable truth is a Record inside one PRIVATE or GROUP Source. Each Record belongs to one searchable **Entity / 紀錄標題**.

Core domain structures include:

- `worklog_sources`
- `worklog_source_members`
- `worklog_entities`
- `worklog_entity_aliases`
- `worklog_records`
- `worklog_record_revisions`
- `worklog_ai_confirmations`
- durable PWA AI Draft/preview structures when implemented.

A generic Record-to-many-Entity model is not required for MVP.

## Entity = 紀錄標題

Entity is internal terminology; users see **紀錄標題**.

Examples:

- `晴空案`
- `信義門市`
- `王大明`
- `3 號冷氣主機`

Entity metadata stays intentionally small. Do not add universal address, phone, finance, construction or payment columns.

## One Record has one title

Example:

`王大明跟陳師傅今天去晴空案換冷氣，材料費 5000，人工 5000`

Expected:

- title = `晴空案`;
- names/details/amounts remain searchable Record text.

Do not automatically create `王大明` / `陳師傅` Related Entities merely because they appear in content.

Consequences:

- no PRIMARY/RELATED role system for MVP;
- `worklog_records.entity_id` is the filing/search context;
- other names remain searchable raw content unless explicitly used as titles elsewhere.

## Alias

Alias means a genuine confirmed alternate name for the same Entity.

Example:

- canonical: `晴空案`
- alias: `三重晴空案`

Contextual wording such as `王大明的晴空案` is not automatically an alias.

Entity/Alias resolution is always Source-scoped.

## AI-assisted Record interpretation

For LINE or PWA AI-assisted input, structured AI work stays narrow:

1. determine one title/Entity;
2. resolve same-Source existing Entity/Alias;
3. detect ambiguity that needs confirmation;
4. resolve event date under day-precision/source-time rules;
5. derive bounded grounded `search_terms`;
6. preserve durable textual content.

Do not require universal extraction of amount/address/payment/material/task fields.

## Draft vs Record

PWA Quick Capture AI interpretation may create a durable **Draft** before a Record exists.

Draft rules:

- Source-scoped;
- not a committed Record;
- does not auto-expire;
- remains until confirmed or explicitly deleted;
- may hold proposed title/content/event date/search metadata and provider/audit references needed to commit safely;
- must be re-authorized on every read/edit/commit;
- GROUP Draft becomes inaccessible if active membership is lost;
- confirmation creates the actual Record through deterministic authorization/persistence rules.

Do not treat an unfinished Draft as a Record in timelines/history queries.

## Pending AI identity/title confirmation

Ambiguous title/identity decisions must be durable, not Worker-memory-only.

Initial confirmation types may include `ALIAS_MATCH`, `RECORD_TITLE`, `ENTITY_MATCH`. If multiple candidates are plausible, ask user to choose/create rather than guessing.

## Source model and strict GROUP membership

PRIVATE and GROUP Sources are independent data spaces.

GROUP authorization requires current active membership. Leaving/being removed from the LINE group immediately removes all GROUP Source access, including read/search/edit/Draft/deep-link/Quick-Capture rights. Data remains in the GROUP Source.

GROUP customer-facing name/picture come from current LINE group metadata, not a separate AFTERTRACE custom display name.

## PWA Quick Capture Source selection

Eligible capture destinations:

- user's PRIVATE Source;
- authorized active GROUP Sources.

Default is the last selected **still-valid** Source; otherwise fallback PRIVATE.

The Source selection is separate from Entity/title. Example:

- Source: `晴空案-水電群` (LINE group)
- Record title: `3 號冷氣主機`

Do not confuse group name with Record title.

## PWA manual create/edit terminology

Manual PWA creation is free/non-AI.

Fields:

- 紀錄標題
- 紀錄內容
- 發生日期

Title autocomplete searches same-Source Entity names/Aliases. Choosing existing attaches it; entering new creates a new same-Source Entity. No AI relationship inference occurs.

## Event date

A Record distinguishes:

- `created_at` = actual AFTERTRACE storage time;
- event date = business day, currently carried by compatibility field `occurred_at`;
- `updated_at` = last current-row modification.

MVP event semantics are day-precision Asia/Taipei. Do not invent time-of-day.

LINE relative dates use original source message timestamp; delayed Reply uses quoted/original timestamp, never later command time. PWA explicit create/Draft uses capture/create reference date unless content specifies another date.

## PWA retrieval model

PWA is the full retrieval/management surface.

Composable filters:

1. Source;
2. Entity/title;
3. date range;
4. fuzzy/semantic keyword.

Keyword matching may use:

- title;
- Alias;
- raw Record text;
- `search_terms`.

Example: `王大明` can find Records where he appears in content even if title is `晴空案`.

## LINE history — deterministic facts + deep link

LINE history is not an open-ended AI historical agent.

The accepted path is:

**Query -> Retrieve -> Answer -> Deep Link**

- user explicitly invokes query through `小跡 查 ...`, `小跡 今天`, or `小跡 最近`;
- authorize current Source;
- resolve same-Source Entity/Alias where possible;
- query PostgreSQL deterministically;
- return newest up to 5 matching stored facts directly in LINE;
- include total count when available;
- append filtered secure PWA link for deeper history;
- no AI history summary/business conclusion in MVP.

## Delete / restore

Delete is soft/status-based. Entity reference and revisions remain durable. Normal search excludes deleted Records; authorized recycle-bin/history may show them; restore preserves history.

Do not delete Entity/Alias merely because one Record was deleted.

## Record-to-Record relations

Generic RecordRelation is not required for MVP. Multiple chronological Records under one title are sufficient for progress/history until a concrete feature proves durable typed relations necessary.

## Raw Records and AI summaries

Durable Record text is source of truth.

- no persistent per-record AI summary;
- no automatic AI historical conclusion;
- users edit Record/Draft content, not an AI summary;
- future explicit reports may consume AI points and remain a separate feature.

## Concurrency

Record editing uses durable integer optimistic `version`; stale writes fail. Do not use process-memory/Redis locks for normal Record editing.
