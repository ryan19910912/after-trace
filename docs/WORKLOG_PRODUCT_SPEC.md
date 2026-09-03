# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a general-purpose LINE-first work-record assistant for individuals and groups.

Core surfaces:

- LINE OA/private chat: AI-assisted Record capture/edit and navigation to filtered PWA history.
- LINE group bot: shared AI-assisted Record capture/edit and navigation to group PWA history.
- Web/PWA: free manual browse/search/filter/create/edit/delete/restore; direct title changes and record transfer; AI allowance settings/history; paid export where enabled.
- Internal Admin: users/groups/plans/grants/usage/subsidy/anomalies/audit and AI-point pricing analytics.

The universal domain must stay general-purpose. Do not hard-code construction, finance, Customer, Project, payment, materials, etc. as universal schema.

## Monetization principle

AFTERTRACE charges for AI compute/convenience and selected paid capabilities, not for access to the user's own data or manual CRUD.

Free baseline:

- add Bot to LINE groups;
- read/search/filter authorized records;
- manually create/edit/delete/restore PWA records;
- move one or many records to another title;
- group manual collaboration for active members;
- no maximum group count.

Any operation requiring AI compute requires positive eligible AI balance at request start. If eligible balance is exactly zero, do not start AI; free PWA manual functions remain available.

If balance is positive when AI starts but actual provider usage exceeds remaining eligible units, customer balance floors at zero and AFTERTRACE absorbs the shortfall for that already-started request. Admin records customer-charged usage, platform subsidy and actual provider cost.

## Plans and AI points

Launch structure:

- FREE: NT$0, `ONE_TIME`, one initial AI-point grant, no calendar expiry/no refresh, unlimited groups.
- PRO: NT$99/month, `MONTHLY`, included AI points per successful renewal, unused monthly included allowance does not roll over, unlimited groups, export intended paid.
- TEAM: NT$299/month, `MONTHLY`, larger included AI points per successful renewal, unused monthly included allowance does not roll over, unlimited groups, export intended paid.

Customer-facing allowance is **AI 點數**. Accepted point unit is:

- **1 AI point = 1 output-price-equivalent token**.

This is a customer/accounting unit, not a claim that provider billing is output-only. Actual provider input/output/thinking/modality usage is converted to real provider cost and then to the accepted output-price-equivalent point basis. Historical provider pricing snapshots remain auditable.

Commercial planning defaults:

- monthly subscription included allowance targets about **40% gross margin** to give recurring users more AI value and encourage retention;
- one-time AI top-up products target about **50% gross margin**;
- Admin pricing UI may calculate a recommended point amount from price, target margin, FX and model pricing, but the final included point amount is explicitly entered/confirmed by Admin and persisted;
- existing grants are never retroactively resized when assumptions change.

Admin must expose average AI usage, average provider cost, actual usage %, allowance exhaustion %, platform subsidy and realized gross margin so pricing can be adjusted from production data. Exact FREE/PRO/TEAM/top-up point amounts are configured separately.

## AI allowance grants and responsible user

AI allowance is user-owned, never group-owned.

Each FREE initial grant, subscription-period grant, and top-up purchase is independently identifiable. Grants independently authorize PRIVATE and selected GROUP scopes with optional caps. Separate top-ups remain separate when configuration would otherwise be lost.

Customer-facing terminology is **AI 額度負責人**.

Group data ownership/existence is separate from who funds AI. A group may exist with no AI 額度負責人 and still use manual PWA. Group AI requires a responsible user and an eligible grant permitted for that group. If responsible user leaves, group AI pauses while manual PWA continues. Accepted takeover/transfer rules remain auditable and balances do not move with the role.

Active group members may see current group-specific AI availability and historical group AI usage without seeing unrelated private/other-group balances.

## Source isolation

PRIVATE and GROUP Sources are separate data spaces. Titles/Entities, aliases and Records are Source-scoped. Matching never crosses unrelated Sources.

## Entity / 紀錄標題 model

`Entity` is the internal domain name. Ordinary users see **紀錄標題**.

Each Record belongs to exactly one title/Entity.

Example:

`王大明跟陳師傅今天去晴空案換冷氣，材料費 5000，人工 5000`

Accepted result:

- 紀錄標題: `晴空案`
- Record content keeps `王大明`, `陳師傅`, work details and amounts as text.

Do not automatically create `王大明` and `陳師傅` as extra related Entities merely because AI recognized them. If a user searches `王大明`, fuzzy search over Record content still finds matching Records and shows the title they belong to.

The MVP does not need a generic PRIMARY/RELATED many-to-many relationship model. `worklog_records.entity_id` (or equivalent single-title relation) is sufficient.

Entity metadata stays lightweight. Alias remains a genuine alternate name for one title. If AI thinks a new title may be an existing title under another name, ask for confirmation rather than silently duplicating or aliasing it.

## Pending AI confirmation

Ambiguous title/identity decisions must be stored durably, not only in Worker memory.

A pending-confirmation domain/table supports at least:

- `ALIAS_MATCH`;
- `RECORD_TITLE` ambiguity;
- `ENTITY_MATCH` ambiguity.

Status includes `PENDING` and resolved states such as `CONFIRMED`, `REJECTED`, `EXPIRED`.

## AI responsibilities when creating an AI-assisted Record

AI-assisted Record creation stays narrow:

- classify create/edit/history-navigation intent;
- determine one Record title/Entity;
- resolve existing title/Alias in the same Source;
- detect possible Alias match needing confirmation;
- resolve `occurred_at` from relative date/time language when present;
- preserve the Record text/durable textual extraction.

Do not create extra Related Entities and do not require universal extraction of amount/address/payment/material/task fields.

## Record model and time

A durable Record stores source, title/entity, author, raw/durable textual content, input trace/type, status/version and time data.

Important fields:

- `entity_id`: one Record title/Entity;
- `raw_text`;
- `occurred_at`: real-world event time;
- `created_at`: when AFTERTRACE stored it;
- `updated_at`: last modification;
- `status`, `version`, delete/edit trace fields as defined by edit policy.

If AI-assisted input gives no event time, `occurred_at` defaults to message/create time.

## PWA manual Record creation

Manual PWA creation is free and never invokes AI implicitly.

User-facing fields:

- **紀錄標題**
- **紀錄內容**
- **發生時間** with a date/time picker, not natural-language text input

Title field autocompletes existing titles and aliases. Selecting an existing title uses it; entering a new title creates a new Entity/title.

## PWA browse/search/filter and direct operations

PWA is the authoritative history retrieval surface for MVP.

MVP filters are intentionally limited to three composable mechanisms:

1. **紀錄標題** / Entity;
2. **模糊搜尋** across title names, aliases and Record content;
3. **日期範圍** based on `occurred_at`.

Record/title operations should live directly in the list/detail workflow rather than requiring a separate title-management application.

From a Record/list context, authorized users may:

- edit Record content;
- change/move that Record to another existing or newly created title;
- delete/restore Record according to soft-delete policy;
- inspect edit history;
- select multiple Records and **batch move** them to another title.

A title move is intentionally simple: update the current Record's `entity_id` (with ordinary authorization/version handling where applicable). MVP does **not** require preserving a historical "previous title" audit trail merely for a title move.

Records remain sorted by `occurred_at`; moving a Record to another title does not change its event time.

## No Merge in MVP

Duplicate-title Merge/Undo is intentionally **not an MVP feature**.

If a Record is filed under the wrong title, the user can move that Record or batch-move selected Records to the correct title. Do not build merge-state, merge-history, automatic bulk reconciliation or undo-merge complexity unless real user feedback demonstrates the need later.

## LINE history/navigation policy

LINE AI does not independently retrieve arbitrary history and compose answers in MVP. AI understands the request and translates a history request into deterministic PWA filters.

Examples:

`王大明這週做了什麼`

- classify as history/search intent;
- if `王大明` is an existing title, use title filter; otherwise use fuzzy keyword `王大明`;
- recognize the date phrase and include this week's date range;
- return the filtered PWA URL.

`這個群組今天發生什麼`

- no title required;
- include today's date range;
- return group PWA history URL.

Keep the backend function surface small, conceptually:

`build_history_link(source_id, entity_id?, keyword?, from?, to?)`

PWA/API performs actual SQL/search.

## Record editing and revision history

PWA manual editing is free and does not invoke AI automatically.

Every content edit creates immutable revision history with actor/time/channel and previous/new content. PWA shows `已編輯` and allows authorized users to inspect history.

Use DB optimistic concurrency with integer `version`; stale saves are rejected. Restoring an old revision creates a new revision and does not erase newer history.

Manual text editing does not automatically re-run AI or change the Record title. Title movement is an explicit manual action.

### LINE natural-language edit

LINE AI edit requires positive eligible AI balance and a reliable Reply target.

- Reply to the exact prior Record/AFTERTRACE success context is the preferred deterministic target mechanism;
- if there is no reliable Reply target, do not guess which Record to edit; direct the user to Reply or PWA;
- after record id is fixed, AI interprets the requested change;
- if the instruction clearly changes the title, AI may change `entity_id` and run normal title/Alias/pending-confirmation logic;
- backend performs authorization/version/revision transaction; AI never writes arbitrary SQL.

## Soft delete / recycle bin

Delete is reversible state change, not physical deletion. Keep title reference, revisions, delete actor/time and restore history. Normal search hides deleted Records; recycle bin exposes them to authorized users.

## AI summaries / broad historical analysis

Do not maintain persistent AI summaries. Broad autonomous AI historical analysis/query is not MVP. PWA search/filter is the primary retrieval path. Any future explicit AI report/summary feature consumes AI allowance and remains ephemeral.

## Generic Record-to-Record relation

MVP does not need a universal RecordRelation table merely because multiple Records share the same title over time. Add deterministic typed relations later only when a separately approved feature genuinely needs them.

## LINE attachment/input policy

PWA manual create/edit is text-only for MVP; no permanent PWA attachment library.

LINE image/audio/file/PDF/DOCX/XLSX may be fetched/understood/extracted into durable text and original binary discarded according to `WORKLOG_LINE_CONTENT_POLICY.md`.

## Export

Export remains MVP and initially paid. Exact format can be refined separately.

## Future discussion backlog

Do not implement implicitly until separately approved:

- invoice integration;
- automatic reminders/follow-up;
- project/engineering scheduling;
- broad AI historical reporting beyond the accepted navigation flow;
- duplicate-title merge/undo unless requested by users;
- final product/brand name and go-to-market positioning.

## Platform / deployment

Stack: TypeScript/Node, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Admin, PostgreSQL + Drizzle. Deploy as three Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`.

## Prelaunch DB policy

Dev/prod are prelaunch and may be destructively rebuilt while schema is finalized. Once real production data exists, switch immediately to forward-only migrations.
