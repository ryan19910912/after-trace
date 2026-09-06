# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a general-purpose LINE-first work-record assistant for individuals and groups.

Core surfaces:

- LINE OA/private chat: Rich-Menu-driven AI-assisted Record capture, deterministic in-chat history lookup, edit support, and deeper PWA navigation.
- LINE group bot: shared AI-assisted Record capture/edit and deterministic in-chat history lookup with deeper PWA navigation.
- Web/PWA: free manual browse/search/filter/create/edit/delete/restore, title moves/batch moves, explicit AI-assisted Record creation, AI allowance usage/settings, and later paid export.
- Internal Admin: users/groups/plans/Grants/usage/subsidy/anomalies/audit and AI/provider pricing analytics.

The universal domain stays general-purpose. Do not hard-code construction, finance, Customer, Project, payment, materials, etc. as universal schema.

## Account onboarding and LINE OA friendship

LINE Login identifies the customer account but LINE OA friendship is not required to own/use an AFTERTRACE Web/PWA account.

Rules:

- Successful LINE Login may idempotently create the `worklog_users` row, workspace, PRIVATE Source and first eligible `FREE_INITIAL` Grant.
- LINE Login must **not** set `is_oa_friend=true`; only real LINE OA follow/unfollow lifecycle events own that state.
- Web/PWA manual PRIVATE use remains available whether or not the user is currently an OA friend.
- OA friendship is an optional convenience path for faster LINE-native capture/edit/navigation and other LINE-specific capabilities; it is not an account, Web/PWA, or data-access requirement.
- A non-friend Web user may see a dismissible, non-blocking prompt such as「想記得更快，也可以直接在 LINE 用 AFTERTRACE」with configurable official add-friend link/QR code where available. The copy must clearly state that the user can already keep using Web/PWA normally and must not imply that adding the OA is required.
- Removing/blocking the OA must not delete the AFTERTRACE account, PRIVATE Source, Records or historical Grants.
- `FREE_INITIAL` remains idempotent; a later OA follow event must not issue a duplicate acquisition Grant.

## LINE OA private Rich Menu input modes

Private OA chat uses **explicit Rich Menu modes** instead of asking the user to mention `@AFTERTRACE` before every action and instead of guessing the intent of every private message.

Initial Rich Menu actions:

- **快速記錄** — the Rich Menu sends the text `快速記錄`; AFTERTRACE stores a short-lived `RECORD` pending action and replies `請輸入你要記錄的事情`.
- **查詢紀錄** — the Rich Menu sends the text `查詢紀錄`; AFTERTRACE stores a short-lived `QUERY` pending action and replies `請輸入你想查詢的內容`.
- Additional menu buttons such as `我的紀錄` and `方案 / AI 點數` may navigate directly to the authorized Web/PWA surfaces and do not need to enter a text mode.

Input-mode rules:

1. The pending action is durable PostgreSQL state, never Cloudflare Worker process memory.
2. Initial mode TTL is **10 minutes**.
3. Selecting a new mode replaces the previous pending mode for that user.
4. Only the next **non-empty TEXT** message consumes the mode.
5. Sticker/image/audio/file messages do not consume a pending text mode.
6. The mode is consumed once before the text is processed so retries/later messages do not accidentally reuse it.
7. If the mode expired, reply clearly and ask the user to select `快速記錄` or `查詢紀錄` again; do not infer intent from the expired text.
8. `RECORD` text goes through the normal PRIVATE AI-assisted Record pipeline and therefore requires positive eligible AI points before provider execution.
9. `QUERY` text goes through the deterministic provider-free history retrieval path and does not require AI points.
10. Ordinary private text sent without a pending mode remains non-product/support traffic and must **not** be automatically stored as a Record or automatically queried merely because it was sent to the OA.

`@AFTERTRACE` may remain as a compatibility fallback for previously shipped private flows, but it is not the customer-facing OA interaction contract. GROUP chat intentionally keeps the `@AFTERTRACE` boundary because ordinary group conversation must not be treated as a product command.

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
- It does not create or modify a recurring subscription allowance and never refreshes monthly.
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

## Shared AI-assisted Record pipeline

LINE and Web/PWA must not maintain separate AI interpretation logic.

The reusable core pipeline should conceptually separate:

1. **interpret** user input into a normalized Record draft;
2. resolve same-Source Entity/title/Alias and ambiguity;
3. derive bounded semantic `search_terms` used only for retrieval;
4. reserve/charge AI points and record provider-cost facts through the shared AI ledger;
5. **commit** an authorized Record/revision using deterministic backend rules.

Input channel is metadata/audit context, not a separate domain model. At minimum distinguish `LINE_AI_CREATE` and `PWA_AI_CREATE` (or equivalent durable operation/channel facts) without duplicating title resolution, point accounting, provider usage or persistence logic.

Future Web/PWA voice/image/PDF input may reuse this pipeline, but text is the first Web AI input type.

## AI-assisted Record creation

AI-assisted creation stays narrow:

- classify create/edit/history-navigation intent where relevant to the calling surface;
- determine one Record title/Entity;
- resolve existing title/Alias within the same Source;
- detect possible Alias/title ambiguity requiring confirmation;
- resolve the event **date** from date/time language when present;
- derive a small set of grounded semantic search terms/synonyms that make the Record findable by common wording;
- preserve durable raw/textual Record content.

`search_terms` is retrieval metadata, not user-visible generated content and not a domain-specific finance/project schema. Example: `晴空案今天收3千清潔費` may keep grounded terms such as `收款`, `款項`, `清潔費`, `3000`, allowing a later query for `收款` to find the Record even when the literal raw text only says `收`.

Do not require universal amount/address/payment/material/task extraction and do not create extra Related Entities.

### Web/PWA `AI 幫我記`

Web/PWA provides an explicit **AI 幫我記** action in addition to free manual create.

Initial Web AI flow is **preview-first**:

1. user enters natural-language text;
2. backend checks positive eligible AI balance before provider execution;
3. shared AI pipeline interprets title/content/event date/search terms and same-Source title ambiguity;
4. Web shows the proposed result/required confirmation;
5. user explicitly confirms before a new Record is committed;
6. canceling the preview must not silently create a Record.

AI provider work that already ran for the preview is billable/point-consuming according to the normal AI point rules even if the user later cancels the Record commit. The system must not call the provider again merely to commit an unchanged accepted preview.

LINE may keep its accepted direct/confirmation flow; the difference is interaction UX, not duplicated AI business logic.

## Record model and event-date semantics

A durable Record stores Source, one `entity_id`, author, `raw_text`, event-date value, `search_terms`, `created_at`, `updated_at`, status/version, input type, LINE trace ids, and revision/delete facts.

For MVP, the business meaning of the event field is **day precision**, not a guessed clock time. The current physical `occurred_at` column may remain during the compatibility transition, but application semantics must treat it as a canonical Asia/Taipei calendar-day marker; UI and AI must not invent a time-of-day the user never supplied.

Rules:

- Direct LINE record: date interpretation reference = that LINE message's original timestamp.
- Reply/Replay of an older LINE message: date interpretation reference = the **quoted/original message timestamp**, never the later command/reply timestamp and never Worker current time.
- Example: original message sent on 9/3 says `晴空案今天收3000清潔費`; user Replies `@AFTERTRACE 幫我記` on 9/5; the event date is 9/3.
- Relative phrases such as `今天`, `昨天`, `上週五` are resolved in `Asia/Taipei` against the source/original timestamp.
- If no event date is stated, use the source/original message date for LINE, or the create/reference date for explicit Web AI/manual create.
- `created_at` remains the actual database creation timestamp and must not be confused with the event date.
- If the original timestamp required for a Reply/Replay cannot be recovered, do not silently substitute the current time; fail clearly or request the content again.

## Deterministic LINE history answer

LINE history lookup follows **Query → Retrieve → Answer → Deep Link**.

Initial MVP behavior does **not** use AI to summarize retrieved history.

1. Resolve the authorized Source.
2. Resolve an explicitly mentioned existing title/Entity or Alias within that Source when possible.
3. Resolve the remaining natural-language search text into deterministic filters.
4. Query PostgreSQL first.
5. Return up to the most recent **5 matching Records** directly in LINE, ordered by event date descending with stable tie-breaking.
6. Include the total match count when available.
7. Always include the secure PWA/RWA-style filtered link for deeper history when the entry service is available.

Example user request:

`晴空案目前收款進度如何`

Expected deterministic interpretation may be:

- title = `晴空案`
- fuzzy/semantic query = `收款`

The reply may show the latest matching Records plus `查看更多紀錄` link. It must not invent a percentage, payment state, conclusion, or summary that is not directly present in stored Records.

Search matching may use title, aliases, raw Record text and AI-derived `search_terms`. AI is allowed during Record interpretation to create retrieval metadata; the history-answer path itself remains deterministic and provider-free for this MVP.

## PWA manual create/edit/search

Manual PWA work is free and never invokes AI implicitly.

Create fields:

- 紀錄標題
- 紀錄內容
- 發生日期

MVP search/filter mechanisms:

1. 紀錄標題 / Entity;
2. fuzzy search across title names, aliases, Record content and available semantic `search_terms`;
3. date range based on the Record event date.

Authorized users may edit content, move one or multiple Records to another title, soft-delete/restore, and inspect edit history. A title move updates the Record's `entity_id`; generic Merge/Undo is not MVP.

## LINE history/navigation and edit

LINE history requests first return deterministic database matches in LINE and then provide a filtered PWA link for additional records. LINE is not an open-ended historical database agent and does not produce an AI summary in the current MVP.

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

Dev/prod are prelaunch and may be destructively rebuilt while schema is finalized. Existing Dev data should still use safe forward compatibility when preservation has already been explicitly chosen. Once real production data exists, switch immediately to forward-only migrations.
