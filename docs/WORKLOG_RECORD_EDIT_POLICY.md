# AFTERTRACE Record Edit / Revision Policy

This document is part of the durable product/development contract for branch `revive/line-worklog`.

## Core rule

A work record may be created and edited manually in PWA. Editing never destroys prior content. The current record row represents the latest visible state; every content-changing edit also creates an immutable revision/history row.

## Record times

A record needs distinct time concepts:

- `created_at`: when the record was created in AFTERTRACE.
- `occurred_at`: when the recorded real-world event occurred. If the user gives no event time, default to the message/create time. AI may resolve expressions such as `昨天`, `上週五`, or `今天下午` when AI-assisted ingestion is used.
- `updated_at`: when the current record state was last modified.

## Record revision history

Every content edit must preserve the previous state and actor.

Recommended durable revision fields include:

- revision id;
- record id;
- revision/version number;
- editor user id;
- edit channel/source such as `PWA_MANUAL` or `LINE_AI_EDIT`;
- previous raw text;
- new raw text or enough snapshot/diff data to reconstruct the revision;
- previous/new `occurred_at` when changed;
- previous/new Entity associations when changed;
- edit timestamp.

Prefer complete snapshots for MVP if simpler and safer than reconstructing long diff chains.

## PWA presentation

When a record has been edited:

- show an `已編輯` indicator beside the record;
- allow authorized users to open `編輯紀錄` / history;
- history shows who edited it, when, and the prior/current content;
- history is read-only audit data and is not silently rewritten by later edits.

Restoring an old content revision can be implemented as a new edit that copies the chosen historical snapshot into the current record; do not delete newer history.

## Concurrency

Use database-backed optimistic concurrency, not process memory and not Redis locking for normal record edits.

- record keeps a durable integer `version`;
- edit request sends the version the editor originally loaded;
- update succeeds only when current DB version still matches;
- successful update increments version;
- stale update is rejected and PWA asks the user to reload the newest record instead of silently overwriting another member's edit.

## Soft deletion

Deletion remains status change, not physical deletion.

- current record becomes `DELETED` (or equivalent);
- original Entity associations and revisions remain durable;
- normal record/entity queries ignore deleted records;
- recycle-bin view includes deleted records and their history;
- restore changes the record back to active state and retains all prior delete/restore/edit audit history.

## LINE natural-language edit — product direction under discussion

A future LINE flow may allow commands such as:

`@AFTERTRACE 幫我上面那筆改成 2800`

when the previous record was:

`王大明冷氣清潔費 3000`

This requires reliable target resolution before mutation. The system must not modify a record merely because one previous message looks plausible.

Potential safe target resolution order:

1. explicit Reply to an AFTERTRACE success message / record where a durable record id can be recovered;
2. explicit record deep link/id context;
3. a bounded, unambiguous recent-record reference such as `上面那筆` only when the conversation/source context yields exactly one safe candidate;
4. otherwise ask the user which record they want to edit or direct them to PWA.

If AI is used to interpret the requested change, the backend should expose deterministic edit operations/tools rather than allowing the model to write arbitrary SQL or mutate records directly.

Example conceptual function/tool:

- `find_record_candidate(...)`
- `update_record(record_id, expected_version, new_raw_text, actor_user_id, source)`

Before commit:

- verify PRIVATE owner or active GROUP membership authorization;
- verify record is active/editable;
- verify target source matches the current private/group scope;
- apply optimistic version check;
- create revision history atomically with the update.

If target resolution is ambiguous, do not edit anything and tell the user the system cannot safely determine which record they mean.

## AI-derived summaries

Current product direction is moving away from permanently stored per-record AI summaries. If on-demand AI summary/query becomes the accepted model, record edit history remains based on raw durable records and Entity associations; no persistent summary revision needs to be maintained.

## Open decisions

Still to discuss before implementing LINE editing:

- whether LINE natural-language edit is MVP or post-MVP;
- whether `上面那筆` may rely on short-lived conversation context or must require Reply/deep-link targeting;
- whether an edit instruction itself consumes AI allowance when AI interpretation is required;
- what happens when AI allowance is zero but the user wants to edit via LINE (PWA manual edit remains free regardless).

GitHub Actions must not be used as validation unless explicitly requested by the user.
