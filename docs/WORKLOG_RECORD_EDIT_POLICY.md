# AFTERTRACE Record Edit / Revision Policy

## Core rule

Records may be created and edited manually in Web/PWA. Editing never destroys prior content. The current Record row represents the latest visible state; every content-changing mutation preserves immutable revision/history facts.

A Record does not require an AI title. Free/manual Records may contain only content plus event/system timestamps.

## Record times

A Record distinguishes:

- `occurred_at`: user/business event date/time, nullable;
- `created_at`: when AFTERTRACE stored the Record;
- `updated_at`: last current-row modification time.

Do not invent a time the user never supplied. AI date interpretation is allowed only on provider-backed operations and must use an explicit reference timestamp/timezone.

## Revision history

Every content-changing edit preserves previous state and actor. Recommended revision facts include:

- revision id;
- record id/version;
- editor user id;
- edit channel such as `WEB_MANUAL`, `PWA_MANUAL`, `CHROME_MANUAL`, `AI_REWRITE`;
- previous/new content;
- previous/new `occurred_at` when changed;
- previous/new AI metadata when the accepted operation explicitly changes it;
- edit timestamp.

Prefer complete snapshots when simpler/safer than reconstructing diff chains.

## Concurrency

Use database-backed optimistic concurrency:

- current Record has integer `version`;
- save includes expected version;
- update succeeds only when version matches;
- successful save increments version;
- stale save fails and asks user to reload rather than overwriting newer work.

## Soft deletion

Deletion is status-based, not physical deletion. Normal search excludes deleted Records. Restore preserves history.

## Free/manual editing

Manual Web/PWA editing is free and non-AI.

- edit `content` directly;
- edit `occurred_at` directly when allowed;
- consume zero provider AI;
- do not silently generate/re-generate title, keywords or extracted metadata;
- old free Records remain valid without AI enrichment.

## AI rewrite / cleanup

Paid AI may propose a rewrite of one exact selected Record.

Flow:

1. authorize user and Source;
2. resolve exact Record id/version;
3. call AI once for the bounded rewrite request;
4. show proposed content;
5. user explicitly accepts/cancels;
6. accept commits through normal optimistic version/revision rules;
7. cancel leaves durable Record unchanged while provider usage remains auditable.

AI never receives authority to write arbitrary SQL or silently overwrite the Record.

## AI metadata on edit

AI title/keywords/entities are optional enrichment. A normal manual edit does not automatically re-run AI. A later explicit `重新整理 AI` feature may exist only as a paid, separately accounted action.

Historical free Records that gain a subscription later are not automatically enriched or rewritten.

## Authorization

Authorization is checked on every operation.

- PRIVATE: authorized owner/user only;
- GROUP: current AFTERTRACE group membership and role permissions;
- GROUP authorization no longer depends on LINE membership, LINE bot state, subscription, or an AI responsible user;
- AI entitlement is checked only when provider compute is requested by the current user.

## Tasks

Changing a Record does not silently rewrite or delete Tasks derived from it. If a Task is explicitly linked to a Record, task state remains its own durable fact unless the user accepts a specific task update.

## AI summaries / Q&A

Summaries and Q&A are separate paid retrieval features. They do not replace durable Record content or revision history.

GitHub Actions must not be used as validation unless explicitly requested by the user.
