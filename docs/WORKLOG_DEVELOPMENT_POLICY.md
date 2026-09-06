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

Pure presentation-only UI tweaks that do not alter behavior, data, entitlement, pricing, security, runtime, or deployment do not require rereading the full document set.

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

Every development commit on this branch must include `[skip ci]`.

## Durable product decisions

Agreed product decisions must not live only in chat. Update relevant durable docs in the same batch. Surface code/doc mismatches rather than redefining desired behavior to preserve obsolete code.

## Core product architecture

- general-purpose work recording;
- PRIVATE and GROUP Sources are independent data spaces;
- GROUP manual use does not require paid subscription, AI allowance, or AI 額度負責人;
- PWA manual read/create/edit/delete/restore/title move/batch move is free and non-AI;
- Web/PWA account creation via LINE Login does not require current OA friendship;
- OA friendship enables LINE-native features but is not the ownership boundary for PRIVATE Web data;
- GROUP manual authorization = active membership;
- PRIVATE authorization = private owner/user scope;
- no plan limits group count;
- AI allowance is user-owned and Grants are independently identifiable/scoped;
- customer-facing group funding role is **AI 額度負責人**;
- subscription expiry does not disable another eligible Grant and unauthorized Grants never become fallback.

## Account/bootstrap rules

Successful LINE Login may idempotently provision the user/workspace/PRIVATE Source/FREE_INITIAL path. It must not fabricate OA friendship.

`is_oa_friend` is changed only by real LINE OA lifecycle evidence. Follow/unfollow changes LINE-native capability state without deleting the user's Web account, PRIVATE data or Grants.

Initial FREE provisioning is idempotent. LINE Login followed later by OA follow must never create a duplicate `FREE_INITIAL` Grant.

## Private OA Rich Menu input state

Private OA create/query UX is explicit-mode-driven. Do not make every private chat line an implicit database operation and do not require the user to type `@AFTERTRACE` before normal OA use.

Rich Menu action texts:

- `快速記錄` -> set `RECORD` pending action and prompt for the next text;
- `查詢紀錄` -> set `QUERY` pending action and prompt for the next text.

Implementation rules:

- persist one pending private action per user in PostgreSQL; never use Worker process memory;
- initial TTL = 10 minutes;
- selecting a mode overwrites the user's previous mode;
- only a non-empty text message consumes the mode;
- non-text messages such as sticker/image/audio/file do not consume it;
- consume/delete the pending mode before processing the next text so later messages cannot reuse it;
- expired modes fail clearly and do not guess RECORD vs QUERY from the user's text;
- `RECORD` goes through existing PRIVATE AI entitlement + Record normalization/persistence; positive eligible AI points are required before provider work;
- `QUERY` goes through deterministic provider-free history retrieval and does not require AI points;
- ordinary private text with no active mode remains support/non-product traffic and is not automatically persisted or queried;
- GROUP behavior is unchanged and keeps the explicit `@AFTERTRACE` boundary;
- legacy private `@AFTERTRACE` parsing may remain as compatibility fallback while Rich Menu is the customer-facing contract.

The canonical durable table is `worklog_private_pending_actions` (or an equivalent table preserving the same semantics). Readiness must probe it because OA record/query operation depends on it.

## Commercial plan model

Admin plan/product templates use exactly three types:

- `FREE`: exactly one `code=FREE`, zero price, cannot be deleted or duplicated, Admin-editable; `grant_points` = one-time initial FREE points.
- `SUBSCRIPTION`: add/edit/disable/delete when unused; `grant_points` = points frozen into each successful subscription-period Grant.
- `ONE_TIME`: add/edit/disable/delete when unused; `grant_points` = points frozen into one successful one-time/TOP_UP Grant.

`grant_points` is a template, never the live user balance. Existing Grants are immutable when templates change.

FREE initial points must be read from durable DB/Admin configuration at first grant provisioning. Do **not** hard-code 400,000 (or any other promotional amount) in application code or `.env`. The operator may currently configure 400,000 as a value, but future changes affect only users without an existing `FREE_INITIAL` Grant.

ONE_TIME products are not subscription states and must not be assignable through the subscription-period lifecycle.

Deleting a non-FREE plan/product must fail closed while durable references exist; disabling is the safe fallback.

## AI execution / zero balance

Any AI operation requires positive eligible points at request start. Examples: LINE AI-assisted Record creation/title parsing, Web/PWA `AI 幫我記`, LINE natural-language edit, provider-based attachment understanding, and future explicit AI reports.

If eligible points are zero, do not start provider AI. If balance was positive at start but actual usage exceeds it, floor customer balance at zero and record the remainder as platform subsidy.

Provider actual usage/cost, customer charge, subsidy, user, Source, model/pricing snapshot, operation, and timestamp remain auditable.

## Shared AI Record pipeline

Do not implement separate title/entity/date/point/persistence business logic for LINE and Web.

The reusable core must separate AI interpretation from durable commit sufficiently that:

- LINE can continue its accepted direct/confirmation interaction;
- Web/PWA can use preview-first `AI 幫我記`;
- both reuse the same normalization, same-Source Entity/Alias resolution, ambiguity handling, semantic search metadata, AI point ledger/provider-cost accounting and Record persistence rules;
- an unchanged accepted Web preview can be committed without a second provider call;
- operation/channel facts distinguish surfaces such as `LINE_AI_CREATE` and `PWA_AI_CREATE` for audit/analytics without creating separate domain models.

The first Web AI input is text. Future voice/image/PDF can attach to the same shared pipeline rather than spawning new product-specific cores.

## Web AI preview/commit rule

Web/PWA `AI 幫我記` is explicit opt-in AI, not implicit automation during manual CRUD.

Required behavior:

1. authorize exact PRIVATE/GROUP Source;
2. require positive eligible AI points before provider work;
3. run shared interpretation once;
4. return a normalized preview or durable ambiguity/confirmation state;
5. require explicit user confirmation before creating the Record;
6. commit using deterministic backend authorization/persistence rules;
7. do not refund already-incurred provider usage merely because the user cancels after preview;
8. do not call provider AI again just to persist an unchanged accepted preview.

Preview state must be tamper-resistant/durable enough that commit cannot trust arbitrary client-supplied title/content/date as if it were the original AI result.

## AI provider/model runtime configuration

The shipped provider adapter may restrict provider values to implementations that exist (currently `GOOGLE`). Provider-specific model identifiers must not be hard-coded or allowlisted.

- Admin stores a non-empty model id, e.g. `gemini-3.5-flash-lite`.
- readiness validates presence and usable pricing, not equality to a model constant.
- provider request paths use configured `model` directly.
- provider runtime determines model existence/permission/feature compatibility.
- changing the active model never rewrites historical pricing/usage snapshots.

## AI points / economics

Follow `WORKLOG_AI_POINT_POLICY.md`:

- 1 AI point = 1 output-price-equivalent token;
- actual input/output/thinking/media cost is included in conversion;
- positive fractional point use rounds up;
- subscription planning starts around 40% target gross margin;
- one-time planning starts around 50%;
- Admin calculator may recommend points, but persisted plan/product `grant_points` is explicitly confirmed;
- do not hard-code provider prices into entitlement logic.

## Record/title/search rules

Core universal model is Source + Entity(title) + Alias + Record + immutable Revision + durable pending AI confirmation.

- each Record belongs to one Entity/title;
- do not create Related Entities merely because names/objects appear in content;
- Entity/Alias matching is Source-scoped;
- no generic PRIMARY/RELATED many-to-many core model;
- AI-assisted Record interpretation may persist a bounded `search_terms` array for retrieval only;
- `search_terms` must be grounded in the Record and may include common synonyms/concepts needed to retrieve the same fact, e.g. `收3千清潔費` -> `收款`, `款項`, `清潔費`, `3000`;
- do not turn `search_terms` into a domain-specific finance/project schema;
- deterministic search may match title, alias, raw text and `search_terms`.

Manual PWA CRUD must never invoke AI merely to populate search terms. Records created manually may therefore have no semantic terms until a later explicit feature processes them.

## Event-date / source-timestamp rules

The Record business event field is day-precision for MVP. The current physical `occurred_at` timestamp column may remain temporarily for compatibility, but application semantics are a canonical Asia/Taipei calendar day, not a meaningful clock time.

Required reference-time rules:

- direct LINE command: reference = original LINE message timestamp;
- GROUP Reply/Replay cached text: reference = cached quoted message `lineTimestamp`;
- any future Reply/Replay path that can recover the original message timestamp must use that timestamp;
- later command/reply timestamp is **not** the event-date reference for quoted content;
- Worker current time is never an acceptable silent substitute;
- if the required original timestamp is unavailable, fail clearly/request resend rather than silently assigning the current date.

Regression example that must remain covered:

- 9/3 original: `晴空案今天收3000清潔費`
- 9/5 Reply: `@AFTERTRACE 幫我記`
- resulting event date = 9/3, while `created_at` may be 9/5.

Relative date phrases are interpreted in `Asia/Taipei`. `created_at` / `updated_at` remain real system timestamps and are not event dates.

## AI-assisted Record parsing

Keep AI responsibility bounded to intent, one title, same-Source Entity/Alias resolution, ambiguity confirmation, event date, bounded semantic `search_terms`, and durable textual content. Do not require universal finance/address/material/task extraction.

## Deterministic LINE history retrieval

Current LINE history answers must be provider-free after intent/filter parsing and must not call AI for summarization.

Implement **Query → Retrieve → Answer → Deep Link**:

1. authorize Source first;
2. resolve an explicitly mentioned existing Entity/Alias within that same Source when possible;
3. derive the remaining fuzzy/semantic query;
4. query PostgreSQL using title/alias/raw text/`search_terms` and date filters;
5. return at most the newest 5 matching Records in LINE;
6. include total match count when available;
7. append the secure filtered PWA link for more results.

Never infer a business conclusion such as percentage complete, paid/unpaid state, or project status merely because several Records were returned. The answer is a deterministic presentation of stored facts, not an AI summary.

## PWA / LINE rules

PWA manual create/edit/search is deterministic and free. User-facing manual date input is day-precision for MVP; do not require or invent a time-of-day.

LINE natural-language edit requires reliable Reply target; never guess. AI does not write arbitrary SQL.

## Revision / concurrency / delete

Every content-changing edit writes immutable revision history. Use integer optimistic concurrency. Delete is soft/status-based, recyclable, and preserves history/title references.

## Attachments

Follow `WORKLOG_LINE_CONTENT_POLICY.md`. PWA manual create/edit stays text-only. LINE binaries are not permanently stored; only durable extracted/transcribed text is retained where supported.

For delayed Reply attachment ingestion, do not silently assign the Reply command timestamp as the original attachment event date. Until original attachment timestamp metadata is durably recoverable, the path must either preserve/recover source timestamp metadata or fail clearly instead of fabricating a current date.

## Prelaunch database policy

Dev/prod are currently prelaunch/disposable. Schema may be destructively rebuilt after confirming no real user/business data must be preserved. Once real production data exists, switch to forward-only migrations immediately.

The checked-in Drizzle baseline must be regenerated using the approved baseline command; never hand-fabricate snapshot metadata.

When preserving an already-used prelaunch environment is explicitly chosen, use reviewed idempotent forward-compatibility migrations rather than assuming a regenerated `0000` will replay. Do not rebuild an environment merely because the canonical fresh-database baseline changed when a safe forward migration exists.

## Runtime observability

Worker observability/log persistence should be defined in checked-in Wrangler config rather than only Dashboard state. A stale Dashboard Cron Trigger must not be mistaken for logging; cron requires an intentional `scheduled()` handler and accepted scheduled product work.

## Validation and handoff

- never claim unexecuted tests passed;
- use local/runtime validation, not GitHub Actions;
- meaningful runs update `WORKLOG_REBUILD_PROGRESS.md` with work, debt, validation state, next action, and confirmation that Actions were not used.
