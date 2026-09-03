# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

Read before every scheduled or interactive development run:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

## Durable product-decision policy

Agreed product decisions must not live only in chat.

In the same work batch:

- update `WORKLOG_PRODUCT_SPEC.md` for product/monetization/access/AI/LINE/data rules;
- update `WORKLOG_ENTITY_MODEL.md` when Entity/Record/alias/search identity rules change;
- update `WORKLOG_RECORD_EDIT_POLICY.md` when edit/revision/delete/LINE-edit rules change;
- update `WORKLOG_REBUILD_PROGRESS.md` when implementation debt/priorities/estimates change;
- surface code/doc mismatches instead of redefining product behavior to match legacy code.

## Current product architecture rules

Treat these as authoritative until the user changes them:

- Product/domain is general-purpose work recording; do not hard-code construction/finance/customer/project as the universal schema.
- PRIVATE and GROUP Sources are independent data spaces.
- A GROUP can exist and be used manually without a paid subscription, AI allowance, or AI allowance responsible user.
- Manual PWA read/create/edit/delete/restore is baseline free functionality and consumes no AI units unless an explicit AI operation is invoked.
- Group active members may read/create/edit group records; private records remain private-owner scoped.
- No plan limits number of groups.
- Customer-facing term is **AI 額度負責人**, not group/data Owner.
- AI allowance is user-owned; every FREE/subscription/top-up grant remains independently identifiable and independently allocatable to PRIVATE and selected GROUP scopes with optional caps.
- Multiple top-up purchases must not be merged when independent allocation settings would be lost.
- Subscription expiry does not disable AI when another eligible grant remains; a grant not authorized for the requested scope must never be used as implicit fallback.

## Plan defaults

Current launch defaults:

- FREE: NT$0, `ONE_TIME`, 500 AI units once, no calendar expiry/no refresh.
- PRO: NT$99/month, `MONTHLY`, 500 included AI units per confirmed successful renewal.
- TEAM: NT$299/month, `MONTHLY`, 2500 included AI units per confirmed successful renewal.
- Paid included monthly allowance does not roll over.
- Top-up units survive monthly renewal and are separate grants.
- Export remains an intended paid capability until changed.

## AI execution / zero-balance rule

Any operation requiring AI compute requires a positive eligible AI balance at request start.

Examples requiring AI allowance when implemented:

- LINE AI-assisted Record creation/entity parsing;
- LINE natural-language Record editing;
- attachment understanding/transcription/extraction when provider AI is required;
- any later explicit AI report/summary feature.

If eligible balance is exactly zero at request start, do not start the AI/provider call. Direct the user to free PWA manual functionality or top-up/subscription paths as appropriate.

If balance is positive at request start but actual provider usage exceeds the user's remaining eligible units, customer balance floors at zero and AFTERTRACE absorbs the remainder for that already-started request. Durable Admin/accounting must retain at least:

- provider actual units/cost;
- customer-charged units;
- platform-subsidized units/cost;
- user id;
- PRIVATE/GROUP source id;
- AI allowance responsible user when GROUP;
- related Record/request where available;
- model/pricing snapshot and timestamp.

Do not create negative customer balances.

## AI unit economics / cost calibration

AI-assisted Record creation consumes allowance normally. Do not hard-code permanent customer-unit values from guesses.

Before finalizing unit packs/plan economics, measure representative real provider usage/cost for shipped AI paths. Provider-dollar cost and customer-facing allowance units must remain separate so conversion/pricing can be adjusted while historical provider cost remains truthful.

Admin/accounting must make it possible to compare:

- provider cost by request/model/input type;
- customer units charged;
- platform subsidy;
- plan/top-up revenue assumptions.

## Entity / Record implementation rules

Core universal model is Source + Entity + Alias + Record + RecordEntity + Revision + pending AI confirmation.

- An Entity is a reusable lookup subject such as a person, project/context, place, equipment/item, etc.
- Entity metadata stays lightweight; do not add universal address/phone/payment/construction columns merely because one use case has them.
- PRIMARY/RELATED are roles of an Entity inside one Record, not permanent Entity types.
- A Record has at most one PRIMARY and zero/many RELATED Entities.
- A single Record must be discoverable through all of its Entity relations.
- Only concrete future lookup targets become Entities; do not entity-extract every noun.
- Alias is a confirmed alternate name for one Entity; contextual phrases expressing relationships must not be silently converted into aliases.
- Entity/Alias matching is Source-scoped and must never cross unrelated PRIVATE/GROUP data spaces.

## AI-assisted Record parsing

When a new Record uses AI, current target parsing responsibilities are:

- determine PRIMARY Entity candidate;
- determine meaningful RELATED Entity candidates;
- resolve existing Entity/Alias candidates inside the same Source;
- detect possible Alias matches requiring confirmation;
- resolve `occurred_at` when time language is present.

Do not require AI to extract universal fixed finance/address/material/task fields. Those are not core schema until a separately approved feature requires deterministic typed state.

## Pending AI confirmation

Ambiguous AI identity decisions must be durable, not Worker-memory-only.

Implement a durable pending-confirmation domain/table for cases such as:

- `ALIAS_MATCH`;
- `PRIMARY_ENTITY` ambiguity;
- `ENTITY_MATCH` ambiguity.

Never silently create an uncertain alias or choose among multiple plausible existing Entities. Ask the user and persist pending/resolved state.

## PWA manual Record creation

PWA manual creation is free and must not invoke AI implicitly.

User-facing fields are:

- `紀錄標題`;
- `紀錄內容`;
- `發生時間` selected with a date/time picker.

Internal mapping:

- `紀錄標題` is the user-facing name of the PRIMARY Entity/context;
- title autocomplete searches current Source Entity names/aliases;
- selecting an existing title attaches that Entity as PRIMARY;
- entering a new title creates a new Entity in the current Source and attaches it as PRIMARY;
- manual create does not infer RELATED Entities automatically because that would require AI.

Do not expose internal Entity jargon unnecessarily in ordinary create UI.

## Record time model

Records distinguish:

- `created_at`: stored in AFTERTRACE;
- `occurred_at`: real-world event time; defaults to message/create time when unspecified;
- `updated_at`: current row last changed.

AI-assisted ingestion may interpret relative time expressions. PWA manual create uses a date/time picker. Search/filter code uses `occurred_at` for business-history date ranges.

## PWA history/search contract

PWA is the authoritative history retrieval surface for MVP.

Implement three composable retrieval controls:

1. Entity / 紀錄標題 selection;
2. fuzzy search across Entity names/aliases plus Record content;
3. `occurred_at` date range.

Deleted Records are excluded from normal search and available only through recycle-bin/history views.

Do not build a growing set of arbitrary backend query functions merely to support every possible natural-language historical question.

## LINE history/navigation contract

LINE history requests navigate to PWA rather than becoming an open-ended historical AI agent.

When a LINE message is judged to be lookup/history intent:

- if a specific Entity can be confidently resolved, build a PWA history URL with that Entity id/filter;
- if no specific Entity can be confidently resolved, return the normal Source PWA history URL;
- backend/PWA performs actual retrieval;
- keep function surface very small and deterministic, conceptually one history-link builder with optional Entity id.

Recognized date-range URL filters may be added later as a small UX optimization, but are not required to implement the accepted bounded navigation model.

Broad AI historical analysis/query is not an MVP requirement unless separately approved later.

## Record editing / revision rule

PWA manual edits are free and do not invoke AI automatically.

- every content-changing edit writes immutable revision history;
- Record current row holds latest state;
- preserve previous/new text, actor, channel, time and relevant Entity snapshots where needed;
- show `已編輯` and revision history in PWA;
- restoring an old revision creates a new revision; do not erase newer history;
- use integer `version` optimistic concurrency; stale saves fail rather than overwrite;
- do not use in-memory locks or Redis for ordinary Record edit concurrency.

PWA manual text editing does **not** automatically re-parse/reassign Entity associations. If the user manually changes `晴空案` text to `信義案`, the system does not spend AI to infer intent. The user should explicitly move/create the correct Record as needed.

## LINE natural-language Record edit

LINE AI edit is allowed only with reliable target identification and positive AI allowance.

Preferred rule:

- require Reply to the specific prior Record/AFTERTRACE success context so backend can deterministically recover `record_id`;
- if not Replying and target cannot be deterministically identified, do not guess; reply that the user must Reply to the Record or edit in PWA;
- AI interprets the requested mutation after target Record is fixed;
- AI may change raw text and, when the instruction clearly changes the subject, propose/update PRIMARY/RELATED Entity associations;
- if new subject is not existing, use normal Entity/Alias/pending-confirmation flow;
- commit through deterministic backend functions, authorization, expected-version check and atomic revision write; AI never receives arbitrary SQL mutation authority.

## Soft delete / recycle bin

Record deletion is status-based, not physical.

- require a safety confirmation;
- store delete actor/time;
- hide deleted Records from normal views/search;
- show them in a dedicated PWA deleted-record/recycle-bin view;
- allow restore;
- keep RecordEntity associations and revision history durable while deleted.

## Entity merge / undo

Merge is reversible and Source-scoped.

- show safety confirmation;
- retain source Entity as MERGED rather than physically deleting it;
- record which Record associations originally belonged to source;
- undo restores those associations to source even if Record text was edited after merge;
- content edits remain intact.

PWA Entity management should support rename, aliases, merge, merged-history visibility and undo merge.

## Summary / broad AI query policy

Do not maintain a persistent per-record AI summary as a second source of truth.

Broad autonomous AI history retrieval/query is not required for MVP. PWA search/filter is the primary retrieval path. If a later explicit AI summary/report feature is approved, it consumes AI allowance and remains ephemeral.

## Generic Record-to-Record relation policy

Do not add a universal RecordRelation table for MVP merely because two Records appear chronologically related. Entity + time history is sufficient for MVP browsing.

Add deterministic typed Record relations later only when a separately approved feature genuinely needs them.

## Attachment policy

- PWA manual create/edit is text-only; no permanent PWA file/photo library for MVP.
- LINE image/audio/file can be fetched and converted into durable textual information; original binary is not permanently retained.
- Follow `WORKLOG_LINE_CONTENT_POLICY.md` for reply cache/content retrieval/Office/PDF handling.

## AI provider accounting invariant

Provider cost and customer allowance are separate ledgers/facts.

- reservation is preflight only;
- provider-success usage is never erased because settlement is late/over-estimate/persistence later fails;
- avoid double settlement/double provider calls on resume;
- thinking/modality usage is counted exactly once;
- grant consumption and platform subsidy must remain auditable.

## Prelaunch database policy

Both dev/prod are prelaunch/disposable while schema is being finalized. Current repository migration/schema is authoritative and may be destructively rebuilt after confirming no real user/business data requires preservation.

Once real production data exists, immediately switch to forward-only migration discipline.

## Validation and handoff

- never claim unexecuted tests passed;
- use local/runtime validation, not GitHub Actions;
- every meaningful development run updates `WORKLOG_REBUILD_PROGRESS.md` with completed work, remaining debt, validation state, next batch, estimates, and explicit confirmation that GitHub Actions were not run/triggered.
