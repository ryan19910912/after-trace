# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a general-purpose LINE-first work-record assistant for individuals and groups.

Core surfaces:

- LINE OA/private chat: personal AI-assisted work-record capture/edit entry, subscription/top-up/help, and navigation to PWA records.
- LINE group bot: shared AI-assisted work-record capture/edit entry and navigation to group PWA records.
- Web/PWA: free manual browse/search/filter/create/edit/delete/restore; Entity views; AI allowance settings/history; paid export where enabled.
- Internal Admin: users/groups/plans/grants/usage/subsidy/anomalies/audit.

The product/domain is intentionally general-purpose. Do not hard-code construction, finance, Customer, Project, payment, materials, etc. as universal schema. Future vertical features may add structured domain-specific state later.

## Monetization principle

AFTERTRACE charges for AI compute/convenience and selected paid capabilities, not for access to the user's own data or manual CRUD.

Free baseline:

- add Bot to LINE groups;
- read/search/filter authorized records;
- manually create/edit/delete/restore PWA records;
- group manual collaboration for active members;
- no maximum group count.

Any operation that requires AI compute requires a positive eligible AI balance at request start.

If eligible AI balance is exactly zero, do not start AI. Manual PWA functions remain available.

If balance is positive when AI starts but actual provider usage exceeds the remaining eligible units, user balance floors at zero and AFTERTRACE absorbs the shortfall for that already-started request. Admin must show how much was subsidized, for which user/group/private source/request, and the actual provider cost.

### AI-assisted Record cost

AI-assisted Record creation consumes AI allowance normally. The allowance-unit economics must be derived from measured real provider cost rather than guessed permanently in product copy.

Before finalizing pack sizes/plan economics, measure representative Gemini usage for at least:

- short/long text Record parsing;
- image/audio/file Record ingestion;
- LINE natural-language edit;
- any future AI report/summary operation that is actually shipped.

Provider-dollar cost and customer-facing AI units remain separate accounting concepts so unit conversion/pricing can be adjusted without losing historical provider cost.

## Plans

Current launch defaults:

### FREE

- NT$0
- billing type: `ONE_TIME`
- initial AI allowance: 500 units once
- no calendar expiry/no refresh
- unlimited groups
- manual PWA PRIVATE/GROUP use is free

### PRO

- NT$99/month
- billing type: `MONTHLY`
- 500 included AI units per confirmed successful renewal
- unused monthly included allowance does not roll over
- unlimited groups
- export intended as paid capability

### TEAM

- NT$299/month
- billing type: `MONTHLY`
- 2500 included AI units per confirmed successful renewal
- unused monthly included allowance does not roll over
- unlimited groups
- export intended as paid capability

## AI allowance grants and allocation

AI allowance is always owned by a user, never by a group.

Every allowance source is an identifiable grant:

- FREE initial grant;
- current subscription-period grant;
- each individual one-time top-up purchase.

Do not merge separate top-up purchases if doing so would lose independent configuration.

Each grant independently configures:

- PRIVATE allowed/not allowed;
- selected GROUP sources allowed/not allowed;
- optional PRIVATE usage cap;
- optional per-GROUP usage cap.

No cap means that allowed scope may continue using the grant until the grant itself is exhausted. Aggregate usage across scopes can never exceed the grant's true remaining units.

Recommended spend order: current included grant first, then oldest top-up grants.

Subscription expiry does not disable AI if another eligible grant remains. Authorization never silently falls through to a grant that was not permitted for that scope.

## AI allowance responsible user

Customer-facing terminology is **AI 額度負責人**.

A group's data ownership/existence is separate from who funds AI.

- A group may exist with no AI 額度負責人 and still use all manual PWA functions.
- Group AI use requires a current responsible user and at least one of that user's grants permitted for the group.
- Group AI usage is charged to that responsible user's eligible grants, while retaining the actor user id separately.
- If responsible user leaves, group AI pauses; manual PWA continues.
- An active member may take over while previous responsible user is absent according to the accepted activation/recovery flow.

### AI 額度負責人 transfer

Current responsible user may initiate transfer to another active group member.

Preferred flow:

1. initiate in LINE/PWA, e.g. `@AFTERTRACE 擁有者轉移 @Ryan Hsu`;
2. target identity uses reliable LINE mention user id when available; never guess by display name;
3. target authenticates in PWA and explicitly accepts;
4. request is single-use and expires after a bounded period;
5. existing responsible user remains active until acceptance;
6. balances do not transfer; new responsible user uses/configures their own grants;
7. transfer history is auditable.

## Group AI visibility/history

Active group members can see:

- current AI 額度負責人;
- current group-permitted AI amount / used / remaining;
- historical group AI usage across prior responsible users, subscription periods and individual top-up grants;
- usage time, actor, charged responsible user, grant source/type, units used and related record where useful.

Do not expose unrelated private usage, total personal wallet, other groups' allocation/usage or unnecessary payment details.

History is append-only/auditable and survives responsible-user transfer, grant changes, plan renewal/expiry, AI pause and group inactivation.

## Source isolation

PRIVATE and GROUP Sources are separate data spaces.

Entities, aliases, records and relationships are Source-scoped. The same real-world name may exist independently in different Sources. AI identity matching must not cross Sources unless a future explicit cross-source feature is approved.

## Entity / 主體 model

The core searchable object is **Entity / 主體**.

Examples:

- `王大明`
- `陳師傅`
- `晴空案`
- `信義門市`
- `3 號冷氣主機`

Entity metadata stays lightweight: name, optional loose type, status/merge state and aliases. Do not require universal address/phone/payment/construction fields.

### PRIMARY / RELATED

PRIMARY and RELATED are per-Record roles, not permanent Entity types.

Example Record:

`王大明跟陳師傅今天去三重晴空案換冷氣，材料費 5000，人工 5000`

Conceptual result:

- PRIMARY: `晴空案`
- RELATED: `王大明`
- RELATED: `陳師傅`

All three have Entity rows. The Record exists only once and is discoverable from all three Entity views/searches.

One Record has at most one PRIMARY and zero/many RELATED Entities. Only concrete future lookup targets become Entities; do not extract every noun.

## Alias / 其他稱呼

Alias is another genuine name for the same Entity.

Example:

- Entity: `晴空案`
- Alias after confirmation: `三重晴空案`

A contextual phrase such as `王大明的晴空案` is not automatically an alias; it usually represents a relationship between Entity subjects.

If AI believes a new name may be an existing Entity, ask for confirmation instead of silently creating a duplicate or alias. Confirmed aliases resolve directly in future.

## Pending AI confirmation

Ambiguous identity decisions must be stored durably, not only in Worker memory.

A pending-confirmation domain/table supports at least:

- `ALIAS_MATCH`
- `PRIMARY_ENTITY`
- `ENTITY_MATCH`

Status includes `PENDING` and resolved states such as `CONFIRMED`, `REJECTED`, `EXPIRED`.

If multiple candidate Entities are plausible, ask the user to choose one or create a new Entity. Do not silently guess.

## AI responsibilities when creating an AI-assisted Record

AI-assisted Record creation consumes AI allowance and should at minimum determine:

- PRIMARY Entity candidate;
- meaningful RELATED Entity candidates;
- existing Entity/Alias match candidates in the same Source;
- possible alias candidates needing confirmation;
- `occurred_at` from relative date/time language when present.

Do not require universal extraction of amount/address/payment/material/task fields. Those remain raw Record content until a separately approved feature needs deterministic typed state.

## Record model

A durable Record stores the user's original text or durable textual extraction from LINE image/audio/file input plus source/author/time/status/version/trace data.

Important time fields:

- `created_at`: when AFTERTRACE stored the Record;
- `occurred_at`: when the event actually happened; defaults to create/message time when unspecified;
- `updated_at`: last modification.

## PWA manual Record creation

Manual PWA creation does not call AI and therefore costs zero AI units.

User-facing create form is intentionally simple:

- **紀錄標題**
- **紀錄內容**
- **發生時間** using a date/time picker, not free-form natural-language time input

`紀錄標題` is the user-facing name for the Record's PRIMARY Entity/context. The UI should not force ordinary users to understand the internal term `Entity / 主體`.

Recommended behavior:

- title field searches/autocompletes existing Entity names and aliases in the current Source;
- selecting an existing title attaches that Entity as PRIMARY;
- entering a new title creates a new Entity in that Source and attaches it as PRIMARY;
- PWA manual create does not automatically infer RELATED Entities because doing so would require AI;
- users can still find text-only references later through PWA fuzzy search over title/entity names and Record content.

## PWA browse/search/filter

PWA is the authoritative place for searching and reviewing history. MVP search/filter scope is intentionally bounded:

1. **紀錄標題 / Entity** lookup;
2. **模糊搜尋** across Entity/title names/aliases plus Record content;
3. **日期範圍** based on `occurred_at`.

These three mechanisms should compose together.

Examples:

- choose `王大明` + this week;
- fuzzy search `冷氣` + August;
- choose `晴空案` with no date filter.

## LINE lookup/navigation policy

Do not build an open-ended AI agent that independently retrieves arbitrary historical Records and answers unlimited natural-language queries in MVP.

When a LINE message is clearly asking to look up history rather than create/edit a Record:

- if AI can confidently identify a specific Entity from the request, resolve that Entity id and return a PWA link pre-filtered to that Entity;
- if no specific Entity can be confidently identified, return the normal PRIVATE/GROUP PWA history link;
- do not attempt a growing set of arbitrary backend function calls for every possible user question;
- PWA remains responsible for actual Record retrieval/search/filtering.

The backend should keep this to a very small deterministic navigation function surface, conceptually one operation such as `build_history_link(source_id, entity_id?)` after AI intent/entity parsing.

Whether the LINE navigation link should additionally encode recognized date-range filters is a small UX optimization still available for discussion; it must not turn into a general autonomous AI retrieval system.

## AI summaries

Do not maintain a persistent per-record AI summary.

Current MVP direction does not require a broad AI historical-query/summary agent. If an explicit on-demand AI summary/report feature is added later, it consumes AI allowance and remains ephemeral rather than becoming a second source of truth.

## Record editing and revision history

PWA manual editing is free and does not call AI automatically.

Every content edit creates immutable revision history with actor/time/channel and previous/new content; Entity snapshots may be retained when AI edit changes Entity associations.

PWA shows `已編輯` and lets authorized users inspect history.

Restoring an older revision creates a new revision and does not delete newer history.

Use DB optimistic locking with integer `version`; stale saves are rejected. Do not use memory locks or Redis for normal edit concurrency.

### PWA manual edit and Entity associations

Manual text editing does not automatically re-run AI or reassign Entities.

If a user manually changes `王大明去晴空案換冷氣` to `王大明去信義案換冷氣`, AFTERTRACE does not silently spend AI to move the Record. The user owns that manual edit; if they need a different filing context they should explicitly move/create the correct Record as provided by PWA UX.

### LINE natural-language edit

LINE AI edit requires positive eligible AI balance and reliable target resolution.

Preferred MVP behavior:

- user Replies to the exact prior Record/AFTERTRACE success message and sends an edit command;
- if there is no reliable Reply target, do not guess which Record; tell the user to Reply to the Record or edit in PWA;
- after deterministic `record_id` resolution, AI interprets what should change;
- AI may modify raw text and, when instruction changes the subject, change PRIMARY/RELATED Entity associations;
- if a new subject is unknown, use normal Entity/Alias/pending-confirmation flow;
- backend performs authorization/version/revision transaction; AI never writes arbitrary SQL.

## Soft delete / recycle bin

Delete is reversible state change, not physical deletion.

- show confirmation before delete;
- mark Record `DELETED`, keep delete actor/time;
- normal views/search ignore deleted Records;
- PWA has a dedicated deleted-record/recycle-bin list;
- restore returns Record to active state;
- RecordEntity relationships and revision history remain stored while deleted.

## Entity merge / undo

PWA supports reversible duplicate Entity merge.

- user chooses duplicate source and canonical target;
- show confirmation;
- source Entity is retained with MERGED state/reference;
- Record associations are moved to canonical target;
- merge history retains exactly which associations originally belonged to source;
- undo moves those original associations back even if the Record text was later edited;
- current Record content remains unchanged.

PWA Entity management should at minimum support:

- rename canonical Entity;
- view/add/remove aliases;
- merge duplicate Entities;
- view merged status/history;
- undo merge.

## Generic Record-to-Record relation

MVP does not require a universal RecordRelation table just because two Records concern the same subject over time.

Example:

- 9/1 `晴空案冷氣壞掉`
- 9/3 `晴空案冷氣已修好`

Both attach to PRIMARY `晴空案`. PWA chronological history is sufficient for MVP. Add deterministic typed relations later only when an approved feature truly requires them.

## LINE attachment/input policy

PWA manual create/edit is text-only for MVP; it is not a permanent attachment library.

LINE image/audio/file/PDF/DOCX/XLSX inputs may be fetched, understood/extracted into durable text and then discarded. Original binary is not permanently retained. Follow `WORKLOG_LINE_CONTENT_POLICY.md` for exact content-retrieval/caching behavior.

## Export

Export remains MVP and initially paid. Exact report UX can be discussed separately. Any future AI-generated report requires AI allowance and must not overwrite raw source/audit truth.

## Future discussion backlog

Do not implement implicitly until separately approved:

- invoice integration;
- automatic reminders/follow-up such as unpaid-item reminders;
- project/engineering scheduling;
- broad AI natural-language historical analysis/reporting beyond the accepted PWA navigation flow;
- final product/brand name and go-to-market positioning.

## Platform / deployment

Stack: TypeScript/Node, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Admin, PostgreSQL + Drizzle.

Deploy as three Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`.

## Prelaunch DB policy

Dev/prod are prelaunch and may be destructively rebuilt while schema is finalized. Current repository schema/migration history is authoritative. Once real production data exists, switch immediately to forward-only migrations.
