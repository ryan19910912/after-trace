# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

Read before every scheduled or interactive development run:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

## Durable product-decision policy

Agreed product decisions must not live only in chat. Update product/entity/edit/progress/pricing docs in the same batch when those contracts change, and surface code/doc mismatches rather than redefining desired behavior to match legacy code.

## Current product architecture rules

Treat these as authoritative until the user changes them:

- product/domain is general-purpose work recording;
- PRIVATE and GROUP Sources are independent data spaces;
- GROUP can exist and be used manually without paid subscription, AI allowance, or AI allowance responsible user;
- manual PWA read/create/edit/delete/restore is baseline free functionality and consumes no AI unless explicit AI work is invoked;
- active group members may manually collaborate; private scope remains private-owner scoped;
- no plan limits group count;
- customer-facing term is **AI 額度負責人**;
- AI allowance is user-owned; FREE/subscription/top-up grants remain independently identifiable/allocatable;
- subscription expiry does not disable another eligible grant and unauthorized grants never become fallback.

## AI execution / zero-balance rule

Any operation requiring AI compute requires positive eligible balance at request start.

Examples:

- LINE AI-assisted Record creation/title parsing;
- LINE natural-language Record editing;
- attachment understanding/transcription/extraction when provider AI is required;
- future explicit AI report/summary features.

If eligible balance is zero, do not start provider AI. Direct user to free PWA/manual or top-up/subscription paths.

If balance is positive at start but actual provider usage exceeds remaining customer allowance, customer balance floors at zero and AFTERTRACE absorbs the remainder for that already-started request.

Admin/accounting must retain provider actual usage/cost, customer charge, platform subsidy, user, Source, AI 額度負責人 where relevant, model/pricing snapshot and timestamp.

## AI provider / model runtime configuration

The shipped provider adapter may restrict **provider** values to implementations that actually exist (currently `GOOGLE`), but the provider-specific **model identifier must not be hard-coded or allowlisted in application code**.

Rules:

- Admin/runtime config stores a non-empty provider model identifier such as `gemini-3.5-flash-lite`;
- readiness validates that the configured model identifier is present and that the pricing snapshot is usable, not that the identifier equals one code-defined model string;
- Gemini request paths use the configured model identifier directly;
- whether a configured model exists, is enabled for the API key, and supports the requested Gemini features is determined by the real provider request/runtime smoke, not by a stale application allowlist;
- a newly released provider model must be selectable without an AFTERTRACE code deployment, provided the existing provider adapter/protocol is compatible;
- pricing facts must always correspond to the configured model/pricing snapshot, and changing the active model never rewrites historical usage snapshots.

The current intended AFTERTRACE Gemini model is `gemini-3.5-flash-lite`, but that is an operator/product choice, not a permanent code allowlist.

## AI points / economic model

Customer-facing allowance is **AI 點數**.

Accepted pricing rules are defined in `WORKLOG_AI_POINT_POLICY.md`, including:

- 1 AI point = 1 output-price-equivalent token;
- actual billable input/output/thinking/modality cost is included when converting real provider usage to points;
- subscription allowance planning starts around 40% target gross margin;
- one-time/top-up allowance planning starts around 50% target gross margin;
- Admin calculator suggests points, but final persisted allowance is explicitly entered/confirmed by Admin;
- Admin exposes average usage/cost and realized profitability so commercial targets can be adjusted from real data.

Do not hard-code provider prices into business logic. Store/configure model pricing snapshots.

## Record/title implementation rules

Core universal model is Source + Entity(title) + Alias + Record + Revision + pending AI confirmation.

Accepted MVP is **single-title**:

- internal `Entity` is user-facing **紀錄標題**;
- each Record belongs to one title/Entity (`entity_id` or equivalent);
- do not automatically create Related Entities for people/objects mentioned in content;
- fuzzy search over title/alias/raw Record content finds names such as `王大明` even when they are not titles;
- generic PRIMARY/RELATED many-to-many indexing is not required;
- Entity metadata stays lightweight;
- Alias is a confirmed alternate title/name and matching is Source-scoped.

## AI-assisted Record parsing

When a new Record uses AI, keep responsibilities bounded:

- classify create/edit/history-navigation intent;
- determine one Record title/Entity;
- resolve existing Entity/Alias inside the same Source;
- detect possible Alias match requiring confirmation;
- resolve `occurred_at` when relative time language is present;
- preserve durable Record text/extraction.

Do not require universal finance/address/material/task extraction and do not create extra Related Entities.

## Pending AI confirmation

Ambiguous identity/title decisions must be durable, not Worker-memory-only. Support cases such as `ALIAS_MATCH`, `RECORD_TITLE`, and `ENTITY_MATCH`. Never silently choose among multiple plausible existing titles or create uncertain aliases.

## PWA manual Record creation

PWA manual creation is free and must not invoke AI.

User-facing fields:

- `紀錄標題`;
- `紀錄內容`;
- `發生時間` selected through a date/time picker.

Title autocomplete searches current Source title names/aliases. Selecting existing title uses it; entering a new title creates it. Do not expose `Entity` jargon unnecessarily.

## PWA title/Record operations

Do **not** build a dedicated title-management section for MVP solely to edit titles.

Keep common operations in the normal Record list/detail flow where practical:

- change/rename the Record title;
- edit Record content;
- delete/restore Record;
- inspect revision history.

Generic duplicate-title Merge/Undo is deferred. Do not implement merge-state, merge-batch, moved-record-history or undo-merge machinery unless later real user feedback shows a meaningful need. Wrongly filed Records can be manually moved to the correct title.

## Record time model

Records distinguish `created_at`, `occurred_at`, and `updated_at`. PWA date filter uses `occurred_at`.

## PWA search contract

PWA is authoritative history retrieval for MVP. Implement three composable filters:

1. 紀錄標題 / Entity;
2. fuzzy keyword search across title names/aliases and Record content;
3. `occurred_at` date range.

Deleted Records are excluded from normal search.

## LINE history/navigation contract

LINE does not become an open-ended history-query agent. AI classifies the request and converts it to deterministic PWA filters.

Examples:

- `王大明這週做了什麼`: if `王大明` is an existing title use entity filter; otherwise fuzzy keyword `王大明`; encode this week's date range.
- `這個群組今天發生什麼`: encode today's date range.

Keep function surface small, conceptually:

`build_history_link(source_id, entity_id?, keyword?, from?, to?)`

Backend/PWA performs actual deterministic search.

## Record editing / revision rule

PWA manual edits are free and do not invoke AI automatically.

- every content-changing edit writes immutable revision history;
- Record row holds latest state;
- show `已編輯` and history;
- restoring old version creates a new revision;
- use integer `version` optimistic concurrency;
- do not use memory/Redis lock for normal editing.

Manual text editing does not automatically re-run AI or change the Record title unless the user explicitly changes the title in PWA.

## LINE natural-language Record edit

LINE AI edit requires positive eligible balance and reliable target identification.

- require Reply to the specific prior Record/AFTERTRACE success context when possible;
- if target is not deterministic, do not guess; ask user to Reply or edit in PWA;
- after Record id is fixed, AI interprets mutation;
- if instruction clearly changes the title, AI may change `entity_id` and use normal title/Alias/pending-confirmation logic;
- commit through deterministic backend authorization/version/revision transaction; AI never gets arbitrary SQL mutation authority.

## Soft delete / recycle bin

Deletion is status-based, not physical. Require confirmation, retain actor/time/title/revisions, hide from normal search, show in recycle bin and allow restore.

## Summary / broad AI query policy

Do not maintain persistent per-record AI summaries. Broad autonomous AI historical retrieval is not MVP. PWA search/filter is primary. Future explicit AI summaries/reports consume AI allowance and remain ephemeral.

## Attachment policy

- PWA manual create/edit is text-only; no permanent attachment library for MVP.
- LINE image/audio/file can be fetched and converted into durable text; original binary is not permanently retained.
- follow `WORKLOG_LINE_CONTENT_POLICY.md` for exact handling.

## AI provider accounting invariant

Provider cost and customer points are separate facts. Successful provider usage must remain auditable, must not be erased because settlement is late/over estimate, and must avoid double settlement/provider calls.

## Prelaunch database policy

Dev/prod are prelaunch/disposable while schema is finalized. Current repo migration/schema may be destructively rebuilt after confirming no real user/business data must be preserved. Once real production data exists, switch to forward-only migrations.

## Validation and handoff

- never claim unexecuted tests passed;
- use local/runtime validation, not GitHub Actions;
- meaningful development runs update `WORKLOG_REBUILD_PROGRESS.md` with completed work, debt, validation state, next batch, estimates and explicit confirmation Actions were not run/triggered.
