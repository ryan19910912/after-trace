# AFTERTRACE Worklog Entity Model

This document is a durable product/domain contract for branch `revive/line-worklog` and should be read together with `WORKLOG_PRODUCT_SPEC.md` during the upcoming data-model refactor.

## Core idea

AFTERTRACE is not limited to construction, finance, or any single industry. A durable work record is raw historical truth attached to a PRIVATE or GROUP source. AI helps decide what the record is mainly about and how it relates to existing subjects/entities.

The core searchable unit is an **Entity / 主體**, not a fixed `Customer` or `Project` schema.

Examples of entities:

- person: `王大明`, `陳師傅`;
- project/context: `晴空案`;
- equipment/item: `3 號冷氣`;
- another domain-specific subject when useful.

Entity type may remain lightweight/optional; type must not force every industry into a rigid schema.

## Record-to-entity relations

A record can reference multiple entities.

Each relation is either:

- `PRIMARY`: the main subject/context this record should primarily be filed under;
- `RELATED`: another person/project/item/context that appears in and is meaningfully related to the same record.

Example raw record:

`王大明跟陳師傅今天去三重晴空案換冷氣，材料費 5000，人工 5000`

Expected conceptual result:

- PRIMARY: `晴空案`;
- RELATED: `王大明`;
- RELATED: `陳師傅`;
- other related entity such as the air-conditioner may be attached when useful, but the product must not require exhaustive extraction of every noun.

The same record must therefore be discoverable when a user later searches/asks about `晴空案`, `王大明`, or `陳師傅`.

PRIMARY controls the main filing/context; RELATED keeps alternate lookup paths. Search/query must consider all record-entity relations rather than only PRIMARY.

## AI subject decision

For AI-assisted text recording, every new record should use AI to determine the main subject and meaningful related entities. The system should not rely only on string rules because users may refer to the same real subject in many ways.

AI should consider:

- the current PRIVATE/GROUP source only;
- existing entities and aliases in that same source;
- relevant historical usage/context;
- the semantics of the new message.

The same phrase can imply different PRIMARY subjects depending on sentence intent. For example, `王大明的晴空案` is not automatically an alias. In a work-progress message, PRIMARY may be `晴空案` and `王大明` is RELATED. In a message mainly asking about Wang's overall status, `王大明` may be PRIMARY and `晴空案` RELATED.

## Alias versus relation

Alias and relation are different concepts.

An alias is another genuine name for the same entity, for example:

- `晴空案`;
- `三重晴空案`;
- another confirmed shorthand/name for the same project.

A contextual phrase such as `王大明的晴空案` usually expresses a relationship between `王大明` and `晴空案`; it must not automatically become an alias merely because the phrase contains the project name.

### Alias confirmation

When AI sees a new apparent subject/name that may be an existing entity under another name, it must not silently create a duplicate or silently attach an uncertain alias.

Example:

1. existing entity: `晴空案`;
2. new record says `三重晴空案`;
3. AI believes this may be the same entity;
4. ask the user to confirm whether `三重晴空案` is the existing `晴空案`;
5. on confirmation, add `三重晴空案` as an alias to the existing entity;
6. future occurrences of that confirmed alias resolve directly without repeatedly asking.

If several existing candidates are plausible, present/ask among the plausible existing entities plus an option to create a new entity. Do not bias the user toward one candidate by pretending certainty.

Aliases must be removable/correctable in PWA if a previous confirmation was wrong.

## Duplicate merge versus alias

Alias prevents duplicates before they are created.

Merge is the recovery path when duplicate entities already exist.

Merge rules already accepted:

- user chooses source entity and canonical destination;
- show a safety confirmation;
- source entity is retained with a merged/inactive state rather than physically deleted;
- records that originally belonged to the source entity are repointed to the canonical entity;
- merge history retains which records/relations were moved;
- undo merge moves every record that belonged to the original source entity back to it, even if that record's text was edited after the merge;
- content edits are preserved; only entity association is restored;
- merge/undo is source-scoped and must not cross unrelated PRIVATE/GROUP data spaces.

## Raw records and AI summaries

Raw record text/durable textual extraction is the durable truth.

Current accepted direction for summaries:

- do not maintain a permanently stored per-record AI summary that needs to be kept synchronized after every edit/merge/undo/new record;
- users edit the raw record, not a stored AI summary;
- when a user explicitly asks for an AI summary/query, generate it from the currently relevant records/entities at request time;
- the generated summary is ephemeral/on-demand and does not become a second source of truth;
- merge/undo therefore does not require regenerating stored summaries.

The exact AI-query/summary charging and text-record ingestion flow remain separate discussion items.

## Concurrent edit rule

PWA record editing uses database optimistic concurrency with a durable record `version`/revision.

A save is accepted only when the submitted expected version matches the current row. A stale save is rejected with guidance to reload; do not use process-memory locks or require Redis merely for record edit concurrency.

## Source isolation

Entities, aliases and record relations are scoped to their PRIVATE/GROUP source.

The same real-world name can exist independently in different sources. AI/entity matching must not cross source boundaries without a future explicit cross-source product feature.
