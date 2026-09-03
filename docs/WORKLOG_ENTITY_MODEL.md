# AFTERTRACE Worklog Entity Model

Durable product/domain contract for branch `revive/line-worklog`. Read together with `WORKLOG_PRODUCT_SPEC.md` and `WORKLOG_RECORD_EDIT_POLICY.md` before schema/runtime work.

## Core model

AFTERTRACE is a general-purpose LINE/PWA work-record product, not a construction-, finance-, customer-, or project-specific database.

The durable truth is a Record inside one PRIVATE or GROUP Source. AI helps attach that Record to searchable **Entity / 主體** objects.

Core domain tables planned:

- `worklog_sources`
- `worklog_entities`
- `worklog_entity_aliases`
- `worklog_records`
- `worklog_record_entities`
- `worklog_record_revisions`
- `worklog_ai_confirmations`

Legacy fixed `Customer` / `Project` concepts should not remain the universal core model. Future vertical features may add structured domain data without changing the general Record/Entity foundation.

## Entity / 主體

An Entity is something users may reasonably want to look up later.

Examples:

- person: `王大明`, `陳師傅`;
- project/context: `晴空案`;
- place/store/site: `信義門市`;
- equipment/item: `3 號冷氣主機`;
- another concrete subject useful for later retrieval.

Do not create entities for every noun. Generic words such as `冷氣`, `材料`, `人工`, `5000` are not automatically entities. Create/attach an entity only when it is a concrete reusable lookup target.

Recommended `worklog_entities` fields:

- `id`
- `source_id`
- `name`
- optional lightweight `entity_type` such as `PERSON`, `PROJECT`, `PLACE`, `ITEM`, `OTHER`; type must not impose a rigid industry schema
- `status` such as `ACTIVE`, `MERGED`
- `merged_into_entity_id` when merged
- timestamps

Entity metadata should stay intentionally small. Address, phone, finance columns, construction-specific fields, etc. are not universal entity requirements.

## PRIMARY and RELATED are per-Record roles

`PRIMARY` / `RELATED` are not permanent Entity types. They describe one Entity's role in one Record.

Example Record:

`王大明跟陳師傅今天去三重晴空案換冷氣，材料費 5000，人工 5000`

Expected conceptual result:

- PRIMARY: `晴空案`
- RELATED: `王大明`
- RELATED: `陳師傅`

The database still has Entity rows for all three subjects. The Record itself exists only once.

Recommended `worklog_record_entities` fields:

- `id`
- `record_id`
- `entity_id`
- `role`: `PRIMARY` or `RELATED`
- timestamps

Rules:

- one Record has at most one PRIMARY Entity;
- one Record may have zero or many RELATED Entities;
- `(record_id, entity_id)` is unique;
- search/query must consider both PRIMARY and RELATED relations;
- PRIMARY is the main filing/context and receives higher relevance weight;
- RELATED provides alternate lookup paths.

Therefore the same Record is found when asking about `晴空案`, `王大明`, or `陳師傅`. PWA does not need to expose the technical PRIMARY/RELATED terminology prominently; it may simply show all relevant records for an Entity.

## Alias / 其他稱呼

Alias means a genuine alternate name for the same Entity.

Example:

- canonical Entity: `晴空案`
- confirmed alias: `三重晴空案`

Do not treat contextual relationship phrases as aliases automatically. `王大明的晴空案` normally expresses `王大明` related to `晴空案`; it is not automatically another name for the project.

Recommended `worklog_entity_aliases` fields:

- `id`
- `entity_id`
- `alias`
- `created_by_user_id`
- `created_via`, e.g. `AI_CONFIRM`, `PWA_MANUAL`
- timestamps

Confirmed aliases should resolve directly on future records and should not repeatedly ask the same question. Aliases are removable/correctable in PWA.

## AI Entity parsing on new AI-assisted Record

For an AI-assisted new Record, AI should at minimum determine:

1. PRIMARY Entity candidate;
2. meaningful RELATED Entity candidates;
3. whether a newly mentioned name is an existing Entity or confirmed alias;
4. possible new-alias candidates;
5. `occurred_at` when the message expresses an event time such as `昨天`, `上週五`, `今天下午`.

AI should use only the current Source's entities/aliases/history. Never cross PRIVATE/GROUP Source boundaries when matching identities.

The AI structured result is an internal function/tool result; the product does not need to persist a per-record AI JSON summary.

## Pending AI confirmation

Ambiguity must be durable instead of stored only in Worker memory.

Use a `worklog_ai_confirmations`-style table for questions that need user confirmation before an identity decision is committed.

Recommended fields:

- `id`
- `source_id`
- `record_id` when already known
- `requested_user_id`
- `confirmation_type`
- `candidate_entity_id` when applicable
- `proposed_name` / candidate payload
- `status`: `PENDING`, `CONFIRMED`, `REJECTED`, `EXPIRED`, or an equivalent resolved state
- `created_at`
- `expires_at` where appropriate
- `resolved_at`

Initial confirmation types may include:

- `ALIAS_MATCH`: e.g. `三重晴空案` may be existing `晴空案`;
- `PRIMARY_ENTITY`: AI cannot tell which Entity should be the main subject;
- `ENTITY_MATCH`: a name such as `老王` may match more than one existing Entity.

If multiple existing candidates are plausible, ask the user to choose among them or create a new Entity. Do not silently choose one.

On confirmed alias match, add the alias and attach the Record to the canonical Entity. On rejection, create/choose the correct distinct Entity as appropriate.

## Merge and undo

Alias prevents duplicates before creation. Merge repairs duplicates after they already exist.

Accepted merge rules:

- user selects source duplicate and canonical target;
- show a safety confirmation;
- source Entity remains durable with `MERGED` state and target reference;
- related Record associations are moved to canonical target;
- merge history retains exactly which Record/entity associations originally belonged to the source;
- undo moves those originally owned associations back to the source even if Record text was edited after the merge;
- Record content edits are preserved; undo changes association, not current text;
- merge/undo is Source-scoped and never crosses unrelated PRIVATE/GROUP spaces.

No stored AI summary needs regeneration because persistent summaries are not the durable model.

## Record time

A Record distinguishes:

- `created_at`: when AFTERTRACE stored it;
- `occurred_at`: when the real-world event occurred;
- `updated_at`: last current-row modification time.

If no event time is supplied, `occurred_at` defaults to message/create time. AI-assisted ingestion may parse relative language into `occurred_at`.

This supports queries such as `晴空案昨天做了什麼`, `王大明這週做了什麼`, or records within a selected date range.

## Delete / restore behavior

Record deletion is soft deletion only.

If Record #100 has relations to `晴空案`, `王大明`, `陳師傅`, deleting it changes the Record status to `DELETED`; its Entity associations remain durable.

Normal Entity/query views exclude deleted Records. The recycle-bin/history view can still show the deleted Record and all original Entity associations. Restoring the Record makes those existing associations visible again.

Do not delete Entity or Alias rows merely because one Record was deleted.

## Persistent Record-to-Record relations

A generic `RecordRelation` table is not required for MVP merely because two Records concern the same event progression.

Example:

- 9/1 `晴空案冷氣壞掉`
- 9/3 `晴空案冷氣已修好`

Both attach to PRIMARY `晴空案`. An on-demand AI query can read the relevant chronological Records and infer that the later Record updates the situation.

Only introduce a durable typed Record-to-Record relation later when a concrete feature requires deterministic state, e.g. a future payment settlement, task completion, reminder lifecycle, or another explicitly approved feature.

## Raw Records and on-demand AI summaries

Raw Record text/durable textual extraction is the stored truth.

Accepted direction:

- do not maintain a permanently stored per-record AI summary;
- users edit the Record, not an AI summary;
- AI summary/query is generated only when explicitly requested;
- generated summary is ephemeral and not a second source of truth;
- merge, undo, edit and new records therefore do not require persistent-summary synchronization.

## Concurrency

Record editing uses database optimistic concurrency with a durable integer `version`.

A save succeeds only when submitted expected version equals current version; successful save increments it. Stale writes are rejected. Do not use process-memory locks or Redis merely for normal Record editing.
