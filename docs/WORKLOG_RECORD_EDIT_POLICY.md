# AFTERTRACE Record Edit / Revision Policy

This document is part of the durable product/development contract for branch `revive/line-worklog`.

## Core rule

A work record may be created and edited manually in PWA. Editing never destroys prior content. The current Record row represents the latest visible state; every content-changing edit also creates immutable revision/history facts.

Each Record belongs to exactly one Source-scoped Entity / user-facing **紀錄標題**. The accepted MVP does not use PRIMARY/RELATED many-to-many Entity associations.

## Record times

A Record distinguishes:

- `created_at`: when AFTERTRACE stored it;
- business event date: day-precision Asia/Taipei semantics, currently represented by compatibility field `occurred_at`;
- `updated_at`: last current-row modification time.

Do not invent a clock time the user never supplied. Relative date interpretation follows the original-source timestamp rules in PRODUCT_SPEC / LINE_CONTENT_POLICY.

## Record revision history

Every content-changing edit must preserve previous state and actor.

Recommended revision facts include:

- revision id;
- record id;
- revision/version number;
- editor user id;
- edit channel such as `PWA_MANUAL` or `LINE_AI_EDIT`;
- previous/new raw text;
- previous/new event date when changed;
- previous/new `entity_id` when title is explicitly moved;
- edit timestamp.

Prefer complete snapshots for MVP when simpler/safer than reconstructing long diff chains.

## PWA presentation

When a Record has been edited:

- show `已編輯`;
- allow authorized users to inspect edit history;
- history shows who/when/prior-current content;
- history is read-only audit data and later edits do not rewrite older revisions.

Restoring old content is a new edit/revision, never deletion of newer history.

## Concurrency

Use database-backed optimistic concurrency, not process memory or Redis locking.

- current Record has integer `version`;
- save includes expected version;
- update succeeds only when DB version still matches;
- successful save increments version;
- stale save fails and asks user to reload instead of overwriting newer data.

## Soft deletion

Deletion is status-based, not physical deletion.

- current Record becomes `DELETED`;
- Entity/title and revisions remain durable;
- normal search excludes deleted Records;
- recycle-bin/history may show them;
- restore preserves all prior edit/delete/restore audit facts.

## PWA manual editing

PWA manual editing is free and non-AI.

- user edits raw Record content directly;
- saving manual edit consumes zero AI points;
- manual text editing does not silently re-evaluate title/entity/search metadata;
- title changes/moves are explicit deterministic actions;
- single/batch title transfer consumes no AI.

This avoids unexpected AI cost and silent reclassification.

## PWA authorization

Authorization is checked on every operation.

- PRIVATE: current user must own/authorize PRIVATE Source.
- GROUP: current user must be an active member of the active GROUP Source.
- GROUP read/create/edit/delete/restore/title move must not depend on legacy Owner, subscription or positive AI balance.
- **When a user leaves/is removed from the LINE group, all GROUP Source rights are lost immediately**, including manual edits, Draft access and deep links.

AI entitlement is checked only when provider compute is actually requested.

## PWA AI Draft editing before commit

Quick Capture / `AI 幫我記` uses preview-first Draft semantics.

A Draft may be manually corrected before commit without invoking provider AI again merely to persist the correction. The backend must re-authorize Source and validate the Draft on commit rather than trusting arbitrary client data as an original provider result.

Drafts do not auto-expire. They remain until confirmed or explicitly deleted. Losing GROUP membership makes the GROUP Draft inaccessible/uncommittable while authorization is absent.

## LINE natural-language edit — 小跡

OA and GROUP share the customer-facing assistant prefix `小跡`.

A normal LINE edit requires a deterministic Reply target. Example:

Record context:

`王大明冷氣清潔費 3000`

Reply command:

`小跡 幫我改成 2800`

### Target resolution

1. Verify the command is a LINE Reply and map the replied-to context deterministically to one AFTERTRACE Record.
2. Use that exact Record target when found.
3. Without deterministic target, never let AI guess from phrases such as `上面那筆`.
4. Reply clearly that the user should Reply the correct Record or use PWA editing.
5. A product-issued durable Record deep link/id may also establish exact target context.

If LINE limitations require a bounded Bot-reply-to-Record mapping, persist/use that mapping. Never fall back to display-text guessing.

### AI allowance

LINE natural-language edit is AI-assisted.

- PRIVATE requires eligible user points for PRIVATE Source.
- GROUP requires active member authorization plus current AI 額度負責人 / eligible scoped Grant according to the AI policy.
- zero eligible balance before request start => do not call provider;
- if request starts positive and real usage later exceeds balance, floor at zero and record platform subsidy per policy.

Manual PWA editing remains free.

### AI edit interpretation / title change

For a valid target, AI may interpret requested content change and whether the user explicitly intends a title change.

Example:

Current:

- content: `王大明去晴空案換冷氣`
- title: `晴空案`

Reply:

`小跡 幫我改成去信義案換冷氣`

AI may propose:

- updated content concerning `信義案`;
- title move from `晴空案` to `信義案`.

Same-Source title/Alias rules still apply. If title intent is ambiguous, do not silently reclassify; require confirmation.

Names appearing in content do not automatically become Related Entities.

### Backend mutation boundary

AI never writes arbitrary SQL. It produces a bounded interpreted edit plan; deterministic backend code authorizes and commits.

Before commit:

- verify PRIVATE owner or active GROUP membership;
- verify Record is active/editable;
- verify target Source matches current surface;
- verify Entity/title belongs to same Source;
- enforce optimistic `version`;
- write immutable revision atomically with Record update.

If material target/title decision is ambiguous, do not partially mutate.

## AI summaries

Persistent per-record AI summaries are not MVP. Durable truth is Record text, event date, Entity/title and revision history. Future explicit reports/summaries may consume AI points and remain separate.

GitHub Actions must not be used as validation unless explicitly requested by the user.
