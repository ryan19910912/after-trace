# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a general-purpose **PWA-first, LINE-integrated AI work-record product** for individuals and groups.

The core customer promise is:

> **10 秒留下事情，幾個月後還找得到。**

PWA/Web is the primary product surface. LINE is an integrated capture/collaboration surface, not the product boundary.

Core surfaces:

- **PWA Quick Capture**: fastest personal and cross-group capture entry; voice/text input, Source selection, AI preview, Draft, confirmation.
- **Web/PWA records**: timeline, search/filter, free manual create/edit/delete/restore/title move, Draft continuation, AI-point status.
- **LINE group bot**: natural-language capture/query/edit inside existing group conversation and Reply context.
- **LINE OA/private chat**: lightweight `小跡` natural-language entry for PRIVATE Source plus links/help; not a Rich-Menu pending-mode workflow.
- **Internal Admin**: users/groups/plans/Grants/usage/subsidy/anomalies/audit and AI/provider pricing analytics.

The universal domain stays general-purpose. Do not hard-code construction, finance, Customer, Project, payment, materials, etc. as universal schema.

## Account onboarding and LINE identity

LINE Login identifies the AFTERTRACE account.

Rules:

- Successful LINE Login may idempotently create the `worklog_users` row, workspace, PRIVATE Source and first eligible `FREE_INITIAL` Grant.
- LINE Login must **not** set `is_oa_friend=true`; only real LINE OA follow/unfollow lifecycle events own that state.
- PWA/Web use, including Quick Capture, does not require current OA friendship.
- OA friendship only enables LINE OA-native convenience features.
- Removing/blocking the OA must not delete the AFTERTRACE account, PRIVATE Source, Records, Drafts or historical Grants.
- `FREE_INITIAL` remains idempotent; LINE Login followed later by OA follow must never issue a duplicate acquisition Grant.
- The installed PWA should keep a sufficiently durable authenticated session so normal Quick Capture does not repeatedly force LINE Login. Expired/invalid security state may require re-authentication.

## PWA Quick Capture — primary capture UX

Quick Capture is the primary fast-entry surface.

When a user opens the installed PWA shortcut/icon, the intended landing surface is the capture experience rather than forcing the full records-management page first. A normal browser/Web entry may still open the broader records/timeline surface. Both are the same PWA, account, API and data model.

### Source selection

Quick Capture supports:

- `PRIVATE` — 我的私人紀錄;
- any currently authorized active `GROUP` Source.

The default Source is the user's **most recently selected valid capture Source**. If that Source is no longer authorized/active, fall back safely to PRIVATE.

The selected destination must remain visually obvious before recording and on Preview.

Examples:

- `🔒 目前會記錄到「我的私人紀錄」`
- `👥 目前會記錄到「晴空案-水電群」，該群組成員皆可查看`

Never hide the destination behind an icon-only state. Prevent accidental PRIVATE/GROUP disclosure by making the current Source explicit.

### Voice and text

Quick Capture supports:

- voice recording through an explicit microphone tap;
- text entry as an alternative.

Opening the capture page must not silently start microphone recording. The user explicitly starts/stops recording.

Voice is expected to be short work-log capture. MVP does **not** require persistent offline audio recovery or long-lived client audio storage.

If upload/provider processing fails, show a clear failure state and retry/re-record actions. If the current page still holds the audio Blob, an immediate retry may reuse it; no cross-session audio persistence is required for MVP.

### Shared AI interpretation

Voice/text Quick Capture must reuse the shared AI Record pipeline rather than create a separate PWA-voice business core.

AI-assisted interpretation may determine:

- durable textual content / transcript;
- one Record title / Entity;
- event date;
- bounded grounded `search_terms`;
- same-Source title/Alias ambiguity.

Do not require universal finance/address/material/task extraction.

## Preview-first AI create

PWA AI capture is **preview-first**.

Flow:

1. authorize the exact selected PRIVATE/GROUP Source;
2. require positive eligible AI balance before provider work;
3. capture voice/text;
4. run shared AI interpretation once;
5. persist/return a tamper-resistant Draft/preview;
6. show Source, title, content and event date;
7. user may edit the preview;
8. user explicitly confirms before a Record is created;
9. confirming an unchanged or manually adjusted Draft does not call provider AI again merely to persist it;
10. canceling/closing the view does not create a Record.

AI provider usage already incurred for the preview remains chargeable even if the Record is never confirmed.

Preview should offer at least:

- `確認記錄`
- direct field editing
- `重新錄音` for voice capture
- `取消`

Optional original transcript may be shown as a collapsible trust/debug aid where useful.

## Draft policy

A PWA AI preview that has completed provider interpretation but has not been committed becomes a durable **Draft**.

Accepted rules:

- Drafts **do not auto-expire**.
- A Draft remains until the user confirms it into a Record or explicitly deletes/discards it.
- Closing the browser/app must not silently destroy an already-created Draft.
- Drafts are Source-scoped and authorization checks apply every time they are reopened.
- If a user later loses access to a GROUP Source, the Draft must no longer be readable/editable/committable by that user while authorization is absent.
- Provider cost already incurred to create the Draft is not refunded merely because the Draft remains unfinished or is deleted.

PWA should surface unfinished Drafts clearly, for example `尚未完成 / 草稿 N 筆` with `繼續` and `刪除草稿` actions.

## AI points in capture UX

Quick Capture should expose customer-friendly remaining AI points/percentage without dominating the primary UI.

When balance approaches zero, clearly state that AI-assisted voice/text capture may become unavailable while free manual PWA CRUD remains available.

Any operation that requires AI compute requires positive eligible balance at request start. If balance starts positive but real usage exceeds it, balance floors at zero and AFTERTRACE records the remaining provider cost as platform subsidy according to the AI-point policy.

## Timeline / recent records

PWA should provide a recent activity timeline instead of forcing users to think in database tables.

Useful initial views:

- 今天
- 最近 7 天
- 全部

Each entry should clearly show Source, event date/time presentation appropriate to the day-precision model, title/context and content snippet.

## Search

PWA search/filter combines deterministic mechanisms:

1. Source;
2. Record title / Entity;
3. date range;
4. fuzzy keyword/semantic matching.

Search may match:

- Entity/title names;
- confirmed aliases;
- raw Record text;
- AI-derived `search_terms`.

Do not silently call AI for normal PWA search. Current PWA history search remains deterministic/provider-free.

## GROUP Source authorization — strict membership rule

GROUP data access is active-membership based.

If a user leaves or is removed from the LINE group, the user **immediately loses all access to that GROUP Source**.

This includes:

- read/view;
- search;
- Quick Capture selection;
- create;
- edit;
- delete/restore;
- title move;
- Draft access/commit;
- deep-link access.

The GROUP data itself remains with the GROUP Source and is not deleted because one member left.

PWA may list a GROUP Source only when all required conditions hold, including:

- Source is ACTIVE;
- Bot is still associated with the active LINE group;
- current user is an active member.

Authorization must be checked server-side; hiding a Source in UI is not sufficient security.

## LINE group identity / metadata

Customer-facing GROUP Source name and picture use the **original current LINE group name and picture**. AFTERTRACE does not introduce a separate custom group display name for MVP.

This preserves distinctions such as:

- `晴空案-水電群`
- `晴空案-行銷群`

and avoids naming disputes between LINE and AFTERTRACE.

Group profile metadata may be cached in PostgreSQL with fields equivalent to:

- LINE group name;
- LINE group picture URL;
- last profile sync timestamp.

Refresh policy is **lazy, not scheduled**:

- if group profile metadata is older than 24 hours, refresh only when the group is actually used;
- eligible use includes a LINE `小跡` group request, PWA Source-list access that needs the group, or opening that GROUP Source;
- if no user uses the group, do not run cron merely to refresh its name/picture;
- within 24 hours use cached metadata;
- LINE leave/member lifecycle remains primary authorization evidence. A failed/404 group-summary refresh may support inactivation handling but must not weaken deterministic lifecycle/access checks.

## Unified LINE natural-language assistant — 小跡

LINE OA and LINE GROUP use one customer-facing Chinese prefix: **`小跡`**.

The prefix must appear at the start of the message. Accept natural spacing/punctuation after it, for example:

- `小跡 幫我記一下今天晴空案收了三千`
- `小跡，我要查詢一下今天晴空案的內容`
- `小跡：我想把這筆金額改成 2800`

No `@` prefix is required. This avoids LINE's member-mention UI conflict and is faster for Chinese input.

### Fixed system commands

Only these are customer-facing fixed commands in the current product contract:

`小跡 幫助`

- show concise guidance and natural-language examples;
- provider-free.

GROUP `小跡 啟用 AI`

- the member who sends the command becomes this GROUP's AI 額度負責人 when the group currently has no different responsible user;
- if another responsible user already exists, do not overwrite them;
- provider-free;
- success reply should clearly identify the responsible member, preferably using a real LINE mention.

GROUP `小跡 取消 AI`

- only the **current AI 額度負責人 themself** may execute it;
- success removes the AI responsibility binding only;
- the user remains in the LINE group and remains a normal GROUP member;
- GROUP Source, Records, history and normal membership-based access are not deleted/revoked by this action;
- after success the GROUP has no AI 額度負責人 until another member uses `小跡 啟用 AI`;
- another group member may not cancel someone else's AI responsibility;
- provider-free.

OA/private must not execute GROUP AI responsibility controls; it should tell the user to perform them inside the corresponding LINE group.

### Natural-language requests

Everything else after `小跡` is treated as a natural-language request rather than requiring memorized Record/Query/Edit command verbs.

Examples:

- `小跡 紀錄一下今天晴空案收了三千清潔費`
- `小跡 幫我記一下今天晴空案收了三千`
- `小跡 我要查詢一下今天晴空案的內容`
- `小跡 幫我查晴空案收款`
- Reply an exact Record and say `小跡 我想把金額改成 2800`.

The AI interpreter should produce a strict bounded action plan. Initial intents:

- `RECORD`
- `QUERY`
- `EDIT`
- `UNKNOWN`

Future room may include:

- `DELETE`
- `RESTORE`
- `MOVE`
- `SYSTEM_QUERY`

but destructive or mutating actions must never let AI guess the target. `EDIT`, `DELETE`, `RESTORE`, and `MOVE` require an exact deterministic target such as a validated Reply target or explicit PWA selection. Without one, ask the user to Reply/select the Record instead of guessing.

The intended interaction is **one bounded AI interpretation call whenever practical, then one deterministic backend action**. Do not build an open-ended agent/tool loop.

For a `RECORD`, the same interpretation call should ideally return the normalized Record information needed by the shared pipeline—content, one title/Entity proposal, event date and bounded grounded `search_terms`—instead of first calling AI only to classify intent and then calling AI again to normalize the same text.

For a `QUERY`, AI may derive bounded query/date filters from the current message, then PostgreSQL performs deterministic retrieval. AI does not receive the returned history for a second summarization pass.

For an `EDIT`, AI may interpret the requested change, but the target remains deterministic. The architecture should converge on one interpretation of instruction + exact target context rather than classifier-call + editor-call duplication.

Natural-language interpreter provider usage remains normal audited AI usage under the AI-point policy. The optimization goal is to avoid duplicate provider calls, not to make hidden classifier calls free.

### Source semantics

The same natural-language request has the same intent semantics; only Source differs:

- LINE OA/private -> user's PRIVATE Source;
- LINE group -> current GROUP Source.

Ordinary messages not starting with `小跡` are not product requests.

Temporary compatibility for old `查/查詢`, `今天/最近`, `記/紀錄`, or edit keywords may exist during migration, but these are not separate fixed commands the customer must memorize.

The retired customer-facing syntaxes `小跡 啟用` without `AI`, `@AFTERTRACE ...`, `@紀錄`, `/紀錄`, and Rich Menu record/query pending-mode Postbacks are not the accepted product contract.

## LINE OA role

LINE OA is a lightweight convenience surface, not the primary capture UX.

Its lower menu may focus on simple entry/help such as:

- 指令教學;
- 開啟 AFTERTRACE;
- AI 點數 / 方案.

It does not need the previously proposed Rich Menu Postback -> pending mode -> next message workflow.

## LINE GROUP role

LINE GROUP remains valuable because users can capture/query/edit without leaving an existing collaboration conversation.

Examples:

- `小跡 幫我記一下今天晴空案收了三千`
- `小跡 我要查詢一下晴空案收款`
- Reply an exact Record -> `小跡 我想把金額改成 2800`.

GROUP ordinary text may still be temporarily cached under `WORKLOG_LINE_CONTENT_POLICY.md` solely to support later deterministic Reply-to-text/attachment handling. Ordinary chat is not automatically a Record.

## Shared AI-assisted Record pipeline

LINE and PWA must not maintain separate title/entity/date/point/persistence business logic.

The reusable core conceptually separates:

1. input capture/extraction;
2. AI interpretation into normalized draft/action plan;
3. same-Source Entity/title/Alias resolution;
4. semantic `search_terms`;
5. AI point reservation/settlement and provider-cost audit;
6. deterministic authorized commit/action.

Input/channel metadata should distinguish operations such as LINE AI create and PWA AI create without duplicating domain rules.

## Entity / Record model

Each Record belongs to exactly one Source-scoped Entity/title.

Names/details inside the Record remain searchable text and are not automatically converted into Related Entities. Alias means a confirmed genuine alternate name for the same title.

`search_terms` is bounded retrieval metadata, not user-visible generated content and not a finance/project-specific schema.

Example:

`晴空案今天收3千清潔費`

may carry grounded terms such as `收款`, `款項`, `清潔費`, `3000` so later deterministic search for `收款` can retrieve the same fact.

## Event-date semantics

Business event time is day-precision for MVP.

The current physical `occurred_at` timestamp may remain for compatibility, but application behavior treats it as an Asia/Taipei calendar-day marker rather than a meaningful invented clock time.

Rules:

- direct LINE Record reference = original LINE message timestamp;
- delayed Reply/Replay reference = quoted/original message timestamp;
- later Reply command time is never substituted for the quoted content's date reference;
- Worker current time is never a silent substitute when original time is required;
- if original timestamp cannot be recovered, fail/request resend rather than inventing a date;
- PWA explicit create/AI Draft uses the capture/create reference date unless the user content provides another date;
- `created_at` remains actual storage time.

Example:

- 9/3 original says `晴空案今天收3000清潔費`;
- 9/5 Reply asks 小跡 to record it;
- event date = 9/3; `created_at` may be 9/5.

## Deterministic LINE history answer

LINE history lookup is **Interpret -> Query -> Retrieve -> Answer -> Deep Link** when natural-language interpretation is needed, and does not call AI for historical summarization.

After Source authorization:

1. interpret the current addressed request into bounded query/date filters when needed;
2. resolve explicit same-Source Entity/Alias where possible;
3. query PostgreSQL deterministically;
4. return up to newest 5 matching Records;
5. include total match count when available;
6. append secure filtered PWA link when available.

Never invent progress percentage, paid/unpaid state, conclusions or summaries not present in stored Records.

## PWA manual CRUD

Manual PWA CRUD is free and non-AI.

Users may:

- create/edit text Records manually;
- select/change title;
- set event date;
- search/filter;
- soft-delete/restore;
- inspect revision history;
- move one or multiple Records to another title where authorized.

Manual edits do not silently re-run AI or rewrite title/search metadata unless the user invokes an explicit AI feature.

## Revision / concurrency / delete

Every content-changing edit writes immutable revision history. Use integer optimistic concurrency; stale writes fail rather than silently overwrite.

Delete is soft/status-based and reversible. Restore creates a new current revision/state without deleting history.

## AI points and commercial model

Customer-facing allowance is **AI 點數**.

- 1 AI point = 1 output-price-equivalent token.
- Actual provider input/output/thinking/media cost is converted using immutable request pricing snapshots.
- Positive fractional point usage rounds up.
- Provider/model/cost/customer-charge/subsidy facts remain auditable.
- Natural-language interpretation that actually calls the provider is audited/charged under the same rules; fixed help/AI responsibility commands are provider-free.

Admin commercial templates have exactly three plan types:

### FREE

- exactly one `code=FREE`, `plan_type=FREE`;
- price = 0;
- `grant_points` = first one-time `FREE_INITIAL` acquisition grant;
- no recurring refresh;
- amount is Admin/DB configuration, not hard-coded;
- existing Grants never resize when template changes.

### SUBSCRIPTION

- `grant_points` = points frozen into each successful `SUBSCRIPTION_PERIOD` Grant;
- unused points do not roll over unless later explicitly changed;
- editing template never changes existing period Grants.

### ONE_TIME

- `grant_points` = points frozen into each successful one-time/TOP_UP purchase;
- no recurring refresh;
- editing template never changes prior purchases.

AI allowance is user-owned. GROUP AI uses the current AI 額度負責人 plus an eligible user-owned Grant scoped to that GROUP. Manual GROUP access remains membership-based and independent of AI funding.

Current provider adapter is `GOOGLE`; model id is runtime configuration and must not be hard-coded/allowlisted. Current intended configured model is `gemini-3.5-flash-lite`.

## Deferred / not MVP now

Do **not** expand MVP with these merely because they were discussed previously:

- native home-screen Widget;
- shareable public Record links;
- Export/PDF/CSV as a launch requirement;
- persistent offline voice-audio recovery;
- automatic AI history summaries/business conclusions;
- separate AFTERTRACE custom GROUP display names;
- OA Rich Menu pending-action workflow.

Payment provider remains unselected/unimplemented; checkout stays disabled until successful-payment facts, idempotency, refunds and no-raw-card-storage requirements are implemented.

## Brand

Product/project/LINE OA name: **AFTERTRACE**.

LINE assistant invocation name: **小跡**.

Slogan direction: **隨筆落墨，AI 循跡。**

## Platform / deployment

Stack: TypeScript/Node, Hono on Cloudflare Workers API, React/Vite PWA/Web, React/Vite Admin, PostgreSQL + Drizzle.

Dev/prod use explicit API/Web/Admin Workers; do not reintroduce Pages.

## Prelaunch database policy

Dev/prod are prelaunch. Existing Dev data should use safe reviewed forward compatibility when preservation has already been explicitly chosen. A regenerated canonical `0000` is for fresh databases and does not by itself justify rebuilding an existing environment.

Once real production data exists, use forward-only migrations immediately.
