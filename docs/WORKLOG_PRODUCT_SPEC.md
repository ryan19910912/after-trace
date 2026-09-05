# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a general-purpose LINE-first work-record assistant for individuals and groups.

Core surfaces:

- LINE OA/private chat: AI-assisted Record capture/edit and navigation to filtered PWA history.
- LINE group bot: shared AI-assisted Record capture/edit and navigation to group PWA history.
- Web/PWA: free manual browse/search/filter/create/edit/delete/restore, title moves/batch moves, AI allowance usage/settings, and later paid export.
- Internal Admin: users/groups/plans/Grants/usage/subsidy/anomalies/audit and AI/provider pricing analytics.

The universal domain stays general-purpose. Do not hard-code construction, finance, Customer, Project, payment, materials, etc. as universal schema.

## Monetization principle

AFTERTRACE charges for AI compute/convenience and selected paid capabilities, not access to the user's own data or manual CRUD.

Free baseline includes LINE group participation, authorized history access, manual PWA CRUD, title moves/batch moves, active-member group collaboration, and no group-count limit.

Any operation requiring AI compute requires positive eligible AI balance at request start. If eligible balance is zero, do not invoke the provider; free manual PWA remains available. If a request begins with positive balance but actual provider usage exceeds it, customer balance floors at zero and AFTERTRACE records/absorbs the shortfall as platform subsidy for that already-started request.

## Commercial plan model

Admin plans have exactly three commercial types:

### FREE / 免費制

- Exactly one plan uses `code = FREE` and `plan_type = FREE`.
- FREE cannot be added as a second plan and cannot be deleted; Admin may edit the existing FREE plan.
- Price is always NT$0.
- `grant_points` means **首次贈送 AI 點數**.
- A new eligible user receives the configured FREE amount once as a `FREE_INITIAL` Grant.
- FREE does not refresh on a calendar or subscription period and does not expire by calendar unless policy is explicitly changed later.
- The FREE point amount is durable Admin/DB configuration, **not a source-code or environment constant**.
- Changing FREE `grant_points` affects only users who have not yet received their `FREE_INITIAL` Grant. Existing Grants are never resized retroactively.

The current operator may choose 400,000 points as the launch value, but 400,000 is not frozen in application code or required by the product contract.

### SUBSCRIPTION / 訂閱制

- Admin may add, edit, disable, and delete unused subscription plan templates.
- Price is recurring according to the later payment product configuration.
- `grant_points` means **訂閱週期 AI 點數**.
- Each successful paid renewal/period creates a separate immutable `SUBSCRIPTION_PERIOD` Grant using the point amount frozen from the plan template at that successful period.
- Unused included points do not roll into a later period unless a later explicit product decision changes that behavior.
- Editing the plan template never changes an already-created period Grant.

Initial commercial direction may include PRO around NT$99/month and TEAM around NT$299/month, but final point amounts remain explicit Admin configuration.

### ONE_TIME / 買斷制

- Admin may add, edit, disable, and delete unused one-time product templates.
- `grant_points` means **購買可得 AI 點數**.
- One successful purchase creates one separate immutable `TOP_UP`/one-time Grant.
- It does not create or modify a recurring subscription period and never refreshes monthly.
- Editing the product template never changes a previously purchased Grant.

Deleting any non-FREE plan/product must fail closed while current subscriptions, immutable history, checkout/payment facts, or other durable references still depend on it; disabling it is the safe fallback.

## AI points

Customer-facing allowance is **AI 點數**.

- **1 AI point = 1 output-price-equivalent token**.
- This is an accounting unit, not a claim that provider billing is output-only.
- Actual input/output/thinking/media usage is converted from real provider cost to points using the immutable pricing snapshot for that request.
- Historical provider/model/FX/pricing snapshots remain auditable.

Commercial planning defaults:

- subscriptions initially target about 40% gross margin;
- one-time purchases/top-ups initially target about 50% gross margin;
- Admin calculator may suggest points, but the persisted point amount is explicitly entered/confirmed by Admin;
- existing Grants are never retroactively recalculated when pricing, FX, margin assumptions, model, or plan templates change.

## AI provider/model configuration

The currently implemented provider adapter may restrict provider values to actual implementations (currently `GOOGLE`). The model identifier is runtime configuration and must not be hard-coded or allowlisted in application code.

Current intended model is `gemini-3.5-flash-lite`, but a later compatible Gemini model must be selectable without an AFTERTRACE release. Real provider calls determine model existence, API-key permission, and feature compatibility.

## AI allowance ownership and group responsibility

AI allowance is user-owned, never group-owned.

FREE initial Grants, subscription-period Grants, one-time purchase/top-up Grants, and Admin Grants remain independently identifiable. Grants explicitly authorize PRIVATE and selected GROUP Sources with optional caps.

Customer-facing terminology is **AI 額度負責人**.

GROUP data existence/authorization is separate from who funds AI. A group may exist with no AI 額度負責人 and continue free manual PWA usage. GROUP AI requires an active requesting member, a current AI 額度負責人, and an eligible user-owned Grant explicitly scoped to that GROUP.

## Source isolation

PRIVATE and GROUP Sources are separate data spaces. Titles/Entities, aliases and Records are Source-scoped. Matching never crosses unrelated Sources.

## Entity / 紀錄標題 model

`Entity` is the internal domain name. Ordinary users see **紀錄標題**.

Each Record belongs to exactly one Source-scoped Entity/title. Names/details mentioned inside the Record remain searchable raw text and are not automatically turned into Related Entities. Alias means a confirmed genuine alternate name for the same title.

The accepted MVP does not use a generic PRIMARY/RELATED many-to-many Entity model.

## Pending AI confirmation

Ambiguous title/identity decisions must be durable, not Worker-memory-only. Pending confirmations support at least `ALIAS_MATCH`, `RECORD_TITLE`, and `ENTITY_MATCH` with `PENDING` and resolved states such as `CONFIRMED`, `REJECTED`, `EXPIRED`.

## AI-assisted Record creation

AI-assisted creation stays narrow:

- classify create/edit/history-navigation intent;
- determine one Record title/Entity;
- resolve existing title/Alias within the same Source;
- detect possible Alias/title ambiguity requiring confirmation;
- resolve `occurred_at` from date/time language when present;
- preserve durable raw/textual Record content.

Do not require universal amount/address/payment/material/task extraction and do not create extra Related Entities.

## Record model and time

A durable Record stores Source, one `entity_id`, author, `raw_text`, `occurred_at`, `created_at`, `updated_at`, status/version, input type, LINE trace ids, and revision/delete facts.

If AI-assisted input gives no event time, `occurred_at` defaults to message/create time.

## PWA manual create/edit/search

Manual PWA work is free and never invokes AI implicitly.

Create fields:

- 紀錄標題
- 紀錄內容
- 發生時間 via date/time picker

MVP search/filter mechanisms:

1. 紀錄標題 / Entity;
2. fuzzy search across title names, aliases and Record content;
3. date range based on `occurred_at`.

Authorized users may edit content, move one or multiple Records to another title, soft-delete/restore, and inspect edit history. A title move updates the Record's `entity_id`; generic Merge/Undo is not MVP.

## LINE history/navigation and edit

LINE history requests become deterministic PWA filters/links. LINE is not an open-ended historical database agent in MVP.

LINE natural-language edit requires a reliable Reply target and positive eligible AI balance. Never guess the target. AI interprets the requested change only after the Record id is deterministic; backend authorization/version/revision logic performs the mutation.

## Revision / concurrency / delete

Every content-changing edit writes immutable revision history. Use integer optimistic `version`; stale writes fail rather than silently overwrite. Restore creates a new revision. Delete is soft/status-based and reversible.

## LINE attachment policy

PWA manual create/edit is text-only for MVP. LINE image/audio/file/PDF/text-like inputs may be fetched and converted into durable text according to `WORKLOG_LINE_CONTENT_POLICY.md`; original binaries are not permanently retained.

## Export and payment

Export remains intended paid MVP functionality but is currently unshipped/fail-closed. Payment provider is currently unselected/unimplemented; checkout stays disabled until successful-payment facts, idempotent recurring/one-time handling, refunds, and no-raw-card-storage requirements are implemented.

## Brand

Product/project/LINE OA name: **AFTERTRACE**.

Slogan direction: **隨筆落墨，AI 循跡。**

## Platform / deployment

Stack: TypeScript/Node, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Admin, PostgreSQL + Drizzle. Dev/prod use explicit API/Web/Admin Workers; do not reintroduce Pages.

## Prelaunch DB policy

Dev/prod are prelaunch and may be destructively rebuilt while schema is finalized. Once real production data exists, switch immediately to forward-only migrations.
