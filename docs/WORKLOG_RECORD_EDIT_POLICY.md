# AFTERTRACE Record Edit / Revision Policy

## Core rule

Records may be created and edited manually in Web/PWA. Editing never destroys prior content. The current Record row is the latest visible state; every mutation preserves revision/history facts.

A manual Record uses:

- optional user-entered `title`;
- required content / `raw_text`;
- optional `occurred_at`;
- system `created_at` / `updated_at`.

The title is not required to be AI-generated. If title is null, UI may use a short content preview as the display heading without persisting that preview as title.

## Editable fields

FREE/manual editing can change:

- title;
- content;
- occurred time.

Manual editing does not call provider AI and does not automatically regenerate keywords or AI metadata.

## Record times

- `occurred_at`: user/business event time, nullable;
- `created_at`: storage time;
- `updated_at`: last modification time.

Do not invent a time the user never supplied.

## Revision history

Every mutation preserves at least:

- revision id;
- record id/version;
- editor user id;
- edit channel;
- previous/new title;
- previous/new content;
- previous/new occurred time;
- previous/new status;
- edit timestamp.

Prefer complete bounded snapshots over fragile diff reconstruction.

## Concurrency

Use optimistic versioning internally:

- Record has integer `version`;
- save includes expected version;
- update only succeeds when the version matches;
- success increments version;
- stale updates are rejected rather than overwriting newer work.

Customer-facing copy should simply explain that a newer version exists and the page will reload. Do not expose “optimistic locking/version API” terminology.

## Delete / restore

Deletion is soft/status-based. Normal search excludes deleted Records. The Search page exposes a recycle bin and restore action. Delete and restore also create revision/history facts while preserving title/content.

## AI rewrite

AI rewrite is suggestion-first:

1. authorize the user and record range;
2. load the exact Record/version;
3. call AI for the requested rewrite;
4. show original + suggested content;
5. user explicitly confirms or cancels;
6. confirm commits through the normal revision path;
7. cancel leaves the durable Record unchanged.

AI never directly overwrites a Record without confirmation.

## AI metadata

AI title/search terms/extracted facts are optional enrichment. Normal manual edits do not automatically rerun AI.

Historical free Records are not automatically enriched after subscription.

## Authorization

Authorization is checked on every operation:

- PRIVATE: owner/user only;
- GROUP: current AFTERTRACE group membership/role;
- AI entitlement is checked only when provider-backed AI is requested.

## Tasks

Editing/deleting a Record does not silently rewrite/delete a related Task. Task state remains its own durable fact unless the user explicitly changes it.

## Validation

Do not use GitHub Actions unless explicitly requested. Distinguish AUTHORED from actually executed PASS.
