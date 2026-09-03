# AFTERTRACE Record Edit / Revision Policy

This document is part of the durable product/development contract for branch `revive/line-worklog`.

## Core rule

A work record may be created and edited manually in PWA. Editing never destroys prior content. The current record row represents the latest visible state; every content-changing edit also creates an immutable revision/history row.

Each Record belongs to exactly one Source-scoped Entity / user-facing **紀錄標題**. The accepted MVP does not use PRIMARY/RELATED many-to-many Entity associations.

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
- previous/new `entity_id` when an edit explicitly moves the Record to another title;
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
- original title/entity reference and revisions remain durable;
- normal record/entity queries ignore deleted records;
- recycle-bin view includes deleted records and their history;
- restore changes the record back to active state and retains all prior delete/restore/edit audit history.

## PWA manual editing

PWA manual editing is free and deliberately non-AI.

- The user edits the current raw record text directly.
- Saving the manual edit does not invoke AI and consumes zero AI allowance.
- PWA manual text editing does **not** automatically re-evaluate or change the Record's title/entity.
- If a user changes `王大明去晴空案換冷氣` into `王大明去信義案換冷氣` manually, the product treats that as an intentional text edit and does not silently move the Record from `晴空案` to `信義案`.
- If the user intends to change filing context as well, they explicitly change/move the Record title in PWA. Single-record and batch title transfer are deterministic manual operations and consume no AI.

This boundary keeps free PWA CRUD deterministic and avoids unexpected AI cost or silent reclassification.

## Manual PWA authorization

Manual PWA access is data authorization, not billing entitlement.

- PRIVATE: the current user must own/authorize the PRIVATE Source.
- GROUP: the current user must be an active member of the active GROUP Source.
- GROUP manual read/create/edit/delete/restore/title-move must not depend on a legacy Owner, subscription, plan capability, AI 額度負責人 or positive AI balance.

AI entitlement is checked only when an operation actually requires AI compute.

## LINE natural-language edit

LINE may support natural-language editing such as:

`@AFTERTRACE 幫我改成 2800`

when replying to a previous recorded message such as:

`王大明冷氣清潔費 3000`

### Target resolution

The normal LINE edit path should require a **Reply** to the earlier message/record context so the target can be identified safely.

Rules:

1. First inspect whether the command is a LINE Reply and whether the replied-to message can be mapped deterministically to one AFTERTRACE record.
2. If yes, use that record as the edit target.
3. If the command is not a Reply, do not let AI guess among recent records merely from phrases such as `上面那筆`.
4. Reply clearly, for example: `目前無法確定你要修改哪一筆紀錄，請直接回覆要修改的紀錄，或前往 AFTERTRACE 編輯。`
5. A durable record deep link/id may also be used when the product explicitly supplies that exact context.

If LINE/API limitations make a replied-to Bot success message insufficient to recover the target record id directly, the implementation must persist/use whatever bounded mapping is needed to resolve that Reply safely. Do not fall back to display-text guessing.

### AI allowance rule

LINE natural-language editing is an AI-assisted action.

- It requires an eligible AI allowance grant for the relevant PRIVATE/GROUP scope.
- If eligible AI balance is **zero before the request starts**, do not invoke AI; tell the user to edit manually in PWA or obtain AI allowance.
- If eligible balance is greater than zero, the AI request may start under the product's general overage/subsidy policy.
- Any shortfall after the request starts may floor the customer's balance at zero and be recorded as platform-subsidized usage according to the general AI accounting policy.

General product rule: **whenever a requested operation requires AI compute, zero eligible balance means that AI operation is unavailable. Manual PWA CRUD remains free.**

### AI edit interpretation and title changes

For a valid replied-to target, AI may interpret both the text change and whether the requested edit explicitly changes the Record title.

Example current record:

`王大明去晴空案換冷氣`

Current title:

- `晴空案`

Reply command:

`@AFTERTRACE 幫我改成去信義案換冷氣`

AI-assisted edit may determine that:

- raw text should become `王大明去信義案換冷氣` (or equivalent faithful updated text);
- title should change from `晴空案` to `信義案`.

If `信義案` already exists in the same Source, re-associate the Record to that Entity. If it does not exist, the AI-assisted title-resolution flow may create it, subject to the same duplicate/Alias confirmation rules used for normal AI ingestion.

If AI is not confident whether the title should change, it must not silently reclassify the Record; ask the user for confirmation.

Names such as `王大明` remain ordinary searchable Record content unless they are themselves the chosen title. Do not create RELATED Entity associations merely because the name appears in text.

### Backend mutation boundary

AI does not write arbitrary SQL or mutate records directly. The model produces an interpreted edit plan/function-call payload and deterministic backend code validates and commits it.

Conceptual operations may include:

- resolve replied-to record target;
- interpret requested text change;
- resolve/create title Entity candidates;
- update record with `expected_version`;
- update the Record's single `entity_id` when explicitly determined;
- append immutable revision history.

Before commit:

- verify PRIVATE owner or active GROUP membership authorization;
- verify record is active/editable;
- verify target Source matches the current private/group scope;
- verify any Entity/title belongs to the same Source;
- apply optimistic version check;
- create revision history atomically with the Record update.

If any material target/title decision is ambiguous, do not partially mutate the record. Ask the user to confirm instead.

## AI-derived summaries

Persistent per-record AI summaries are not part of the accepted MVP. Record edit history is based on raw durable Record text, `occurred_at`, title/entity and revision state. Future explicit on-demand summaries/reports may consume AI allowance and remain ephemeral.

GitHub Actions must not be used as validation unless explicitly requested by the user.
