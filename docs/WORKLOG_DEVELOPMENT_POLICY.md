# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

Before substantive product/domain/schema/runtime work, read in this order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. this file
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. `docs/WORKLOG_REBUILD_PROGRESS.md`

The latest documents above are the only product/development specification. Pure presentation-only UI tweaks that do not alter behavior, data, entitlement, pricing, security, runtime, or deployment do not require rereading the full set.

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

Every development commit on this branch must include `[skip ci]`.

## Durable product decisions

Agreed product decisions must not live only in chat. Update durable docs in the same batch. Surface code/doc mismatches rather than preserving obsolete behavior.

## Core architecture

AFTERTRACE is **PWA-first, LINE-integrated**.

- PWA Quick Capture is the primary fast capture UX.
- PWA/Web is the authoritative full records/search/edit/Draft surface.
- LINE GROUP and OA are convenience/integration surfaces using the same `小跡` language.
- PRIVATE and GROUP Sources are independent data spaces.
- Manual PWA read/create/edit/delete/restore/title move is free and non-AI.
- AI allowance is checked only for operations requiring provider compute.
- GROUP authorization is active-membership based, not Owner/subscription based.
- GROUP AI funding is separate from GROUP data authorization and uses AI 額度負責人 + eligible scoped user Grant.

## Account / LINE identity

- LINE Login may idempotently provision user/workspace/PRIVATE Source/FREE_INITIAL.
- LINE Login must not fabricate OA friendship.
- OA follow/unfollow alone owns `is_oa_friend`.
- PWA/Quick Capture does not require OA friendship.
- A later OA follow must never duplicate FREE_INITIAL.
- Auth/session design should support fast installed-PWA reopening without unnecessary repeated login while still expiring invalid/security-sensitive sessions correctly.

## PWA Quick Capture implementation contract

Quick Capture supports Voice + Text and one explicit selected Source.

### Source rules

- eligible targets = PRIVATE + authorized ACTIVE GROUP Sources;
- default = user's most recently selected valid Source;
- if last Source becomes unauthorized/inactive, fall back to PRIVATE;
- UI must clearly display destination before capture and on Preview;
- server must re-authorize Source at preview and commit; never trust stale client selection.

GROUP Source picker must not expose a group merely because a Source row exists. Require active Source + active membership + current group/Bot eligibility according to durable LINE state.

### Voice rules

- microphone starts only after explicit user gesture;
- short capture is the MVP use case;
- do not add persistent offline audio storage merely for speculative resilience;
- upload/provider failure must produce clear retry/re-record UI;
- if current page still owns the in-memory Blob, immediate retry may reuse it;
- original voice binary is not a durable AFTERTRACE record unless a later explicit storage feature is accepted.

### AI preview/Draft rules

PWA AI create is preview-first:

1. authorize selected Source;
2. require positive eligible AI points;
3. run shared interpretation once;
4. create durable/tamper-resistant Draft result;
5. show Source/title/content/event date;
6. allow explicit user edits;
7. commit only after explicit confirmation;
8. do not call provider again merely to persist unchanged/manually corrected Draft;
9. provider usage incurred for Draft creation remains chargeable even if never committed.

Drafts do **not** auto-expire. They remain until confirmed or explicitly deleted.

A GROUP Draft must be re-authorized on every read/edit/commit. If membership is lost, access is immediately denied.

## GROUP authorization hard rule

When a LINE user leaves/is removed from a group, that user loses **all** GROUP Source rights immediately:

- read;
- search;
- Quick Capture selection;
- create;
- edit;
- delete/restore;
- title move;
- Draft read/edit/commit;
- deep links.

Data remains in the GROUP Source.

`MEMBER_LEFT`/membership-state updates must be treated as authorization-critical. UI hiding is not security; every API operation rechecks active membership.

## LINE group profile metadata

PWA GROUP display uses current LINE group name/picture, not an AFTERTRACE custom alias.

Persist/cache metadata equivalent to:

- `line_group_name`;
- `line_group_picture_url`;
- `line_group_profile_synced_at`.

Refresh lazily:

- threshold = 24 hours;
- refresh only when group is actually used (LINE 小跡 command, PWA Source list/open group surface, or equivalent real request);
- no scheduled/cron refresh for idle groups;
- within 24h use cached values;
- lifecycle events remain primary status/membership evidence; summary refresh failures may support diagnostics/inactivation but must not substitute weaker authorization logic.

## Unified LINE language — 小跡

Both OA and GROUP use a sentence-start prefix `小跡`.

Parser/dispatcher rules:

- accept `小跡 `, `小跡，`, `小跡：` and similar bounded separators;
- no LINE `@` mention is required;
- ordinary text not starting with `小跡` is not a command;
- GROUP and OA share natural-language semantics; Source is determined by surface;
- customer UX must not require memorizing Record/Query/Edit command verbs.

Exactly four customer-facing fixed/system commands are part of the current contract:

- `小跡 幫助`;
- `小跡 狀態`;
- GROUP `小跡 啟用 AI`;
- GROUP `小跡 取消 AI`.

`小跡 狀態` is deterministic and provider-free. It must work even when AI balance is zero. GROUP status requires active membership and shows current AI 額度負責人, remaining/current-total scoped AI points, current allowance utilization percentage, and AI usability. If no responsible user exists, report AI paused and point to `小跡 啟用 AI`. OA/private status shows the current user's PRIVATE allowance and `AI 負責人：你`.

The status `total` is the current effective Grant pool scoped to the Source, not a lifetime immutable denominator. New TOP_UP/SUBSCRIPTION/ADMIN Grants can increase that pool later; therefore current utilization percentage may decrease after new allowance is added. Status reads DB accounting facts only and never calls Gemini.

`小跡 啟用 AI` is deterministic and provider-free. The member who sends it becomes the GROUP AI 額度負責人 only when no different responsible user is already bound. It must never silently overwrite another responsible user.

`小跡 取消 AI` is deterministic and provider-free. Only the currently bound AI 額度負責人 themself may execute it. Success removes only the AI responsibility binding: the user remains a normal active group member, the GROUP Source/history remain intact, and normal membership-based access remains unchanged. After release the GROUP has no AI 額度負責人 until a member runs `小跡 啟用 AI` again. Another member cannot cancel the current responsible user.

All other addressed text is a natural-language request, for example:

- `小跡 紀錄一下今天晴空案收了三千清潔費`;
- `小跡 幫我記一下今天晴空案收了三千`;
- `小跡 我要查詢一下今天晴空案的內容`;
- `小跡 幫我查晴空案收款`;
- Reply an exact Record and say `小跡 我想把金額改成 2800`;
- Reply an exact Record and say `小跡 把這筆刪掉` / `小跡 幫我還原這筆` / `小跡 把這筆移到晴空案`.

The intended runtime is a **bounded one-call interpreter**, not an agent loop:

1. deterministic fixed-command check;
2. authorize the exact Source/actor and establish AI funding eligibility when provider work is required;
3. run at most one shared AI interpretation call for the addressed natural-language request whenever practical;
4. return a strict structured plan such as `RECORD`, `QUERY`, `EDIT`, `DELETE`, `RESTORE`, `MOVE`, `UNKNOWN` plus action-specific normalized fields;
5. execute the selected backend action deterministically;
6. do not hand control back to an open-ended AI tool loop.

`SYSTEM_QUERY` is not an AI intent in the current contract. System status is handled before provider authorization by fixed `小跡 狀態`.

Mutating actions must never let AI invent the target. `EDIT`, `DELETE`, `RESTORE`, and `MOVE` require an exact deterministic target such as a validated Reply target or explicit PWA record selection. If an exact target is absent, ask the user to Reply/select it rather than guessing.

`QUERY` interpretation may use AI to derive intent/query/date filters, but historical Record retrieval and the returned historical facts remain deterministic PostgreSQL behavior. Do not ask AI to summarize history or invent business conclusions.

For `RECORD`, the interpreter should return the same normalized information needed by the shared Record core—durable content, title/Entity proposal, event date, bounded grounded `search_terms`—so the runtime does not perform a separate intent-classification provider call and then another provider call merely to normalize the same input.

For `EDIT`, when an exact target exists, the design should converge on one provider interpretation of the instruction + deterministic target context rather than classifier-call + editor-call duplication.

For `DELETE`, `RESTORE`, and `MOVE`, provider interpretation chooses only the bounded action/destination title. Backend authorization, Reply target resolution, status/version checks, soft-delete/restore/title mutation and immutable revisions remain deterministic.

Temporary parser compatibility branches for old `查/查詢`, `今天/最近`, `記/紀錄`, or edit keywords may exist only during migration. They are not the customer-facing command contract and must not become a second permanent language beside the natural-language interpreter.

Retired prelaunch UX that must not reappear as the customer contract:

- bare `小跡 啟用`;
- fixed Record/Query/Edit command memorization as a requirement;
- AI `SYSTEM_QUERY` routing for status that should be provider-free;
- `@AFTERTRACE ...`;
- `@紀錄` / `@查詢`;
- `/紀錄` slash-command design;
- OA Rich Menu record/query Postback pending modes;
- `worklog_private_pending_actions` schema/runtime state.

## LINE OA role

OA is a lightweight convenience surface. It may offer menu links such as:

- 指令教學;
- 開啟 AFTERTRACE;
- AI 點數 / 方案.

`小跡 啟用 AI` and `小跡 取消 AI` are GROUP-only controls; OA/private must reject them with guidance to use the corresponding LINE group. `小跡 狀態` is shared and shows PRIVATE allowance in OA.

Do not rebuild a Postback -> pending mode -> next-message state machine unless a later explicit product decision reverses this policy.

## Shared AI Record pipeline

Do not implement separate title/entity/date/point/persistence business logic for LINE text, PWA text, or PWA voice.

Reusable core responsibilities:

- durable extracted/raw text;
- one title/Entity;
- same-Source Entity/Alias resolution;
- ambiguity confirmation;
- event date;
- bounded grounded `search_terms`;
- AI point reservation/settlement;
- provider cost/pricing snapshot audit;
- deterministic authorized commit.

Channel/input type is audit metadata, not a forked domain model.

## AI execution / zero balance

Any provider-backed operation requires positive eligible points at request start.

This includes the natural-language interpreter whenever it actually calls the provider. Do not treat routing/provider work as free merely because its output is only an intent. Provider work must still use the existing reservation/settlement/cost audit rules unless the product policy is explicitly changed later.

The optimization goal is therefore to **avoid duplicate provider calls**, not to hide an extra classifier call from point accounting.

If balance is zero, do not call provider. Manual PWA CRUD remains free. Fixed commands `小跡 幫助`, `小跡 狀態`, `小跡 啟用 AI`, and `小跡 取消 AI` remain provider-free.

If balance starts positive and actual usage exceeds remaining points, floor customer balance at zero and record the shortfall as platform subsidy for that started request.

Provider actual usage/cost, customer charge, subsidy, user, Source, model/pricing snapshot, operation and timestamp remain auditable.

## AI provider/model runtime

- implemented provider adapter currently supports `GOOGLE`;
- model identifier is runtime configuration, not a hard-coded allowlist;
- current intended configured model is `gemini-3.5-flash-lite`;
- readiness validates provider/model/pricing shape, not equality to a source constant;
- changing model does not rewrite historical usage snapshots.

## AI points / commercial templates

Follow `WORKLOG_AI_POINT_POLICY.md`.

- 1 point = 1 output-price-equivalent token;
- actual input/output/thinking/media cost is included;
- positive fractional point use rounds up;
- FREE `grant_points` = one-time first grant;
- SUBSCRIPTION `grant_points` = points per successful period;
- ONE_TIME `grant_points` = points per successful purchase;
- template changes never resize historical Grants;
- FREE amount is Admin/DB config, never hard-coded.

## Record/title/search rules

Core domain remains Source + Entity(title) + Alias + Record + immutable Revision + durable pending AI confirmation/Draft structures as accepted.

- each Record has one Entity/title;
- no generic RELATED Entity creation merely because names appear in text;
- Entity/Alias matching is Source-scoped;
- AI-assisted Records may persist bounded `search_terms`;
- manual PWA CRUD does not silently call AI merely to populate search terms;
- deterministic search may match title, alias, raw text and `search_terms`.

## Event-date / Reply source timestamp

Record business event is day-precision for MVP.

- direct LINE input reference = original LINE message timestamp;
- GROUP Reply-to-TEXT = cached quoted message timestamp;
- delayed Reply never uses the later command timestamp as source-date reference;
- Worker current time is never a silent substitute;
- if required original timestamp is unavailable, fail/request resend;
- relative language resolves in Asia/Taipei;
- `created_at` / `updated_at` remain actual system timestamps.

Regression:

- 9/3 original: `晴空案今天收3000清潔費`;
- 9/5 Reply asks 小跡 to record the quoted content;
- event date must be 9/3.

Delayed attachment Reply still needs reliable original-timestamp handling before all attachment replay paths can be called compliant.

## Deterministic LINE history

History = **Interpret -> Query -> Retrieve -> Answer -> Deep Link** when a natural-language interpretation call is needed.

- authorize Source first;
- AI may derive bounded query/date filters from the current addressed request;
- resolve same-Source title/Alias where possible;
- PostgreSQL title/alias/raw/search_terms lookup;
- return newest up to 5;
- include total count when available;
- append secure filtered PWA link;
- no provider call for history summarization after retrieval;
- never invent business conclusions/progress/payment state.

## PWA timeline/search/manual CRUD

PWA should provide:

- Quick Capture;
- unfinished Draft list;
- recent timeline (`今天 / 最近 7 天 / 全部`);
- Source/title/date/keyword search;
- free manual create/edit/delete/restore/title move;
- revision history;
- customer-friendly AI-point status.

Manual create/edit is non-AI unless the user explicitly chooses an AI action.

## Revision / concurrency / delete

Every content-changing edit writes immutable revision history. Use integer optimistic concurrency. Stale updates fail instead of overwriting newer state.

Delete is soft/status-based and reversible.

## Attachments

Follow `WORKLOG_LINE_CONTENT_POLICY.md`.

PWA Quick Capture voice is a capture modality; do not permanently retain audio binary by default. LINE binaries are not permanently stored under the current content policy.

For delayed Reply attachment ingestion, do not fabricate source time from the Reply command.

## Deferred scope

Do not expand current MVP with these unless explicitly reaccepted:

- native home-screen Widget;
- public/share Record links;
- Export as launch requirement;
- persistent offline voice Blob recovery;
- automatic AI history/business summaries;
- custom AFTERTRACE GROUP display names;
- OA Rich Menu pending-mode workflow.

## Prelaunch database policy

Dev/prod are currently prelaunch. Canonical baseline may be regenerated after accepted schema changes, but that baseline is for fresh DB creation.

When existing Dev preservation has been chosen, use reviewed idempotent forward compatibility and do not rebuild merely because `0000` changed.

Once real production data exists, use forward-only migrations.

## Deployment / observability

Cloudflare Workers remain the deployment platform. Do not reintroduce Pages.

A stale Dashboard Cron Trigger is unrelated to logging. Do not create a `scheduled()` handler merely to silence a stale trigger. Group-profile refresh is request-driven/lazy and must not introduce a cron.

## Validation and handoff

- never claim unexecuted tests passed;
- use local/runtime validation, not GitHub Actions;
- meaningful runs update `WORKLOG_REBUILD_PROGRESS.md` with current work/debt/validation/next action;
- every commit contains `[skip ci]`;
- never run/trigger/modify GitHub Actions unless explicitly requested.
