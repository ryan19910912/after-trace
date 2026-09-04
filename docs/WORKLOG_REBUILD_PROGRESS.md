# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run, in this order:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- this file

The latest product/development documents above are the only product specification. Do not revive old Customer/Project/Finance/Owner/aggregate-quota assumptions from older code.

## Current execution checkpoint — 2026-09-04 10:30 batch

This run first re-read all required documents and the previous checkpoint, then inspected the actual branch before changing anything.

A branch/checkpoint drift was found: the previous progress document still said Reply-targeted LINE AI edit stopped at deterministic target resolution, while the branch already contained an uncheckpointed durable edit foundation (`schema-worklog-line-edit.ts`, `line-record-edit.ts`, `drizzle-line-record-edit.ts`, `gemini-line-record-editor.ts`, and bot-reply target mapping). This run did **not** reimplement those files. It audited that foundation and connected/fixed the missing runtime and confirmation pieces.

The main completed batch is now: **GROUP and PRIVATE Reply-targeted LINE AI edit are wired to the existing grant-backed provider pipeline, and ambiguous title edits can be resolved later without another provider call or another AI-point charge.**

## Scanned this run

- all required durable product/development/deployment docs;
- current branch head/history to reconcile checkpoint drift;
- `records.ts` / `drizzle-records.ts` Reply target identity and bot-message mapping;
- `schema-worklog-line-reply.ts` and `schema-worklog-line-edit.ts`;
- `line-record-edit.ts`, `drizzle-line-record-edit.ts`, and `gemini-line-record-editor.ts`;
- GROUP `line-runtime.ts` and `group-webhook.ts`;
- PRIVATE `oa-runtime.ts` and `oa-webhook.ts`;
- production construction in `index.ts`;
- confirmation service/repository/routes;
- Record core revision/confirmation schema;
- current PWA confirmation client/panel and transitional PRIVATE `/usage/me` call;
- Workers route wiring and existing grant-backed collaboration adapter.

## Completed this run

### 1. Production webhook runtime now actually executes durable Reply-targeted AI edits

The durable edit service/repository/provider already existed on the branch but production runtimes still returned `EDIT_NOT_READY` and `index.ts` never constructed the service.

This run wired:

- `DrizzleWorklogLineRecordEditRepository`;
- `WorklogLineRecordEditService`;
- `GeminiWorklogLineRecordEditor`;
- the existing `WorklogAiPointLedgerService`;
- GROUP `WorklogLineRuntime`;
- PRIVATE `WorklogOaRuntime`.

The existing provider pipeline is intentionally reused rather than duplicated. It already provides:

- strict structured output limited to complete `raw_text`, optional `occurred_at`, optional one title, and a title-confirmation flag;
- no Customer/Project/Transaction/category/summary fields;
- durable provider-success state before settlement/mutation;
- positive grant-backed AI-point reservation immediately before provider execution;
- actual provider-cost -> output-price-equivalent AI-point settlement;
- idempotent reservation settlement/replay handling;
- optimistic Record version checking;
- immutable `LINE_AI_EDIT` Revision on successful mutation;
- durable Pending Confirmation instead of guessing ambiguous title/entity changes.

### 2. GROUP edit funding is resolved only after safe target selection

GROUP EDIT now follows this order:

1. require a Reply target;
2. require ordinary active GROUP membership (free/manual access rule);
3. resolve the Reply only inside the exact current Source;
4. only after a unique active Record is found, resolve the current GROUP AI 額度負責人 through the grant-backed responsibility adapter;
5. call the edit service, whose point ledger performs the positive scoped Grant reservation before Gemini.

Missing/ambiguous/deleted targets therefore do not touch AI funding or Gemini.

The charged user for GROUP edit is the current grant-backed AI responsible user, not legacy `owner_user_id` / `subscription_owner_user_id`.

### 3. PRIVATE edit uses the user's personal Source and the user's own Grants

PRIVATE EDIT resolves the Reply only inside the bootstrapped personal Source. A unique target is passed to the same durable edit service with actor = charged user = the current user.

If there is no positive eligible scoped Grant balance, the point ledger refuses before the provider call.

### 4. Runtime responses now distinguish edit lifecycle states safely

GROUP and PRIVATE runtimes now distinguish:

- successful edit;
- title confirmation pending;
- already-processing/idempotent replay;
- AI points exhausted;
- Record changed/deleted while the provider was in flight;
- LINE command idempotency conflict;
- provider/edit failure.

A stale Record is never overwritten. A redelivered command that is already processing does not intentionally call Gemini a second time.

The edit service remains optional at the runtime constructor boundary so existing isolated callers/tests without production wiring continue to fail closed with `EDIT_NOT_READY` rather than accidentally invoking a partial implementation.

### 5. Reply to the bot's successful edit acknowledgement can target the same Record again

LINE reply handling already extracts successful `sentMessages[].id` without coercing LINE's large message IDs through JavaScript `Number`.

This run extended the existing bounded bot-message-id -> Record persistence from `RECORDED` acknowledgements to successful `EDITED` acknowledgements for both GROUP and PRIVATE flows.

Therefore users can Reply to either the original durable Record message identity or a later bot success acknowledgement, while resolution remains Source-scoped and deterministic. No content/author/latest-record guessing was added.

### 6. Fixed a critical Pending Confirmation bug for LINE AI edits

The existing safe confirmation resolver still assumed every pending confirmation belonged to an AI-created Record whose `entity_id` was `NULL`.

That assumption is invalid for Reply AI edit: an existing Record normally already has a title. As a result, a paid/settled LINE edit that produced an ambiguous title could become `PENDING_CONFIRMATION` but could never be resolved and could be expired as if the Record were invalid.

The confirmation repository now distinguishes two durable operations:

- `CREATE_TITLE`: original unresolved AI-create title behavior;
- `LINE_AI_EDIT`: already-paid Reply edit proposal.

For `LINE_AI_EDIT`, eligibility requires:

- same Source and Record;
- Record still ACTIVE;
- exact captured Record version;
- current entity still equals the pre-provider `previousEntityId` snapshot;
- linked `worklog_line_ai_edits` row is still `PENDING_CONFIRMATION` and points to this confirmation.

### 7. Resolving a LINE AI edit confirmation applies the complete already-paid edit atomically

When the user chooses an allowed existing title or confirms/creates a new title, the backend now applies the already-durable provider proposal without AI:

- complete proposed Record text;
- proposed `occurred_at`;
- selected/new single Entity/title;
- next Record version when fields actually change;
- immutable `worklog_record_revisions` row with channel `LINE_AI_EDIT`;
- optional confirmed Alias when applicable;
- confirmation -> `CONFIRMED`;
- linked line edit -> `SUCCEEDED` with applied version/entity.

The Record, confirmation and line-edit rows are guarded together with PostgreSQL row locks/CTEs. If the Record changed before confirmation, the mutation is refused instead of overwriting newer manual/PWA work.

A logically no-op confirmed edit does not manufacture a fake Record revision; it only terminalizes the already-paid edit state.

### 8. Reject/expiry now terminalizes linked LINE edit state

Rejecting a `LINE_AI_EDIT` confirmation leaves the Record unchanged and marks the linked edit terminal (`FAILED` with a confirmation-rejected reason). It does not refund/re-run the already-completed provider work and does not consume another AI point.

When a LINE edit confirmation expires or becomes stale because the underlying Record changed, the confirmation is expired and the linked edit is also terminalized. This prevents an edit from remaining permanently `PENDING_CONFIRMATION` after its confirmation can no longer be applied.

### 9. Confirmation API now exposes enough operation context for PWA follow-up

Pending confirmation serialization now includes:

- `operation` (`CREATE_TITLE` or `LINE_AI_EDIT`);
- `proposedRawText` for a LINE edit proposal.

The current PWA client safely ignores these extra fields, so backend behavior is complete, but the UI has not yet been enhanced to show an explicit current-vs-proposed content preview. That is a small remaining UX task, not a backend blocker.

### Files changed this run

- `apps/api/src/worklog/line-runtime.ts`
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/index.ts`
- `apps/api/src/worklog/confirmations.ts`
- `apps/api/src/worklog/drizzle-confirmations-safe.ts`
- `apps/api/src/worklog/confirmation-routes.ts`
- `apps/api/src/worklog/group-webhook.ts`
- `apps/api/src/worklog/oa-webhook.ts`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Stable completed foundation from earlier batches

Do not redo these unless an actual regression is found:

- Source + single Entity/title + Alias + Record + immutable Revision foundation;
- old Customer/Project/Finance/Transaction/category/normalized-summary removed from customer Record core/UI/API;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization = active membership, not subscription or AI points;
- GROUP Source exists independently from AI funding responsibility;
- old pending-group runtime/schema removed;
- single-title/`occurred_at` Gemini create interpretation;
- durable create Pending Confirmation and PWA resolution;
- deterministic HISTORY -> Source-correct filtered PWA links;
- obvious EDIT commands intercepted before Record creation;
- deterministic same-Source Reply target resolver for Record LINE IDs and bounded bot-reply mappings;
- FREE initial Grant = exactly 400,000 AI points once, idempotent, no refresh/expiry;
- text and attachment provider execution use user-owned Grants/scopes/caps;
- provider cost converts to customer points through the frozen output-price-equivalent rule;
- customer balance never goes negative; overage becomes platform subsidy;
- GROUP charged-user resolution uses `worklog_source_ai_responsibility`;
- grant-backed GROUP funding/allocation PWA;
- Admin customer/group usage reporting moved to grants/responsibility/provider-cost facts;
- normalization reservation FK points to the grant-backed point reservation table;
- Reply AI edit durable provider/settlement/mutation foundation and production runtime wiring.

## Important transitional / blocking state

### 1. PWA LINE-edit confirmation preview is not yet differentiated

The API now returns `operation` and `proposedRawText`, but `apps/web/src/worklog-api.ts` / `WorklogRoot.tsx` still present every pending confirmation as a generic "AI needs a title" card showing only the current Record text.

Next UI pass should show, for `LINE_AI_EDIT`:

- current Record text;
- proposed replacement text;
- proposed occurred time;
- proposed/new title choice;
- clear wording that the provider call is already paid/durable and the confirmation will not call AI or charge again.

Reject should be phrased as rejecting this AI edit proposal, not merely "skipping a title suggestion".

### 2. PRIVATE `/usage/me` remains an aggregate-quota compatibility reader

`WorklogRoot.bootstrap()` still fetches `/api/v1/worklog/usage/me`, and `routes.ts` still imports `DrizzleWorklogUsageRepository` / `WorklogUsageService` for the transitional PRIVATE top summary.

GROUP uses the new Source-scoped `GroupFunding` path and does not rely on this aggregate balance.

Replace PRIVATE usage with a Grant-ledger customer summary/history before deleting the remaining aggregate usage reader.

### 3. Legacy subscription aggregate quota implementation still exists

Provider execution, Reply edit, GROUP funding PWA and Admin live customer usage no longer need it, but subscription/Admin plan lifecycle still contains old quota structures and methods.

Remaining old structures include:

- `schema-worklog-quota.ts`;
- `worklog_ai_quota_balances`;
- `worklog_ai_quota_reservations`;
- old subscription reserve/commit/release interfaces;
- compatibility usage fields/readers.

Subscription must become billing/lifecycle metadata only. A successful paid period should create an immutable idempotent `SUBSCRIPTION_PERIOD` Grant; provider eligibility must remain Grant-only.

### 4. SUBSCRIPTION_PERIOD and TOP_UP provisioning are not fully wired

The Grant model supports them, but payment/subscription lifecycle still needs idempotent origin keys and actual provisioning. FREE is the only fully wired lifecycle Grant creator.

PRIVATE scope may be provisioned automatically for the Grant owner. GROUP scopes must stay explicit and must never silently receive every user Grant.

### 5. Plan billing type is still transitional

Product contract:

- FREE = `ONE_TIME`;
- PRO/TEAM = `MONTHLY`.

The subscription plan schema still needs an explicit billing-type representation while aggregate quota is collapsed.

### 6. Some compatibility names remain in runtime contracts

The grant-backed collaboration adapter still maps new responsibility/grant failures into old enum names such as `OWNER_UNBOUND`, `OWNER_ABSENT`, and `AI_QUOTA_EXHAUSTED`, and exposes compatibility capability fields.

These are no longer authoritative funding sources, but should be renamed/removed after subscription/quota collapse so old terminology cannot re-enter product logic.

`line-record-edit.ts` also imports `WorklogAiUsageCommit` as a type from `subscription.ts`; move that neutral accounting type out of the subscription module during the same cleanup.

### 7. Admin pricing/profitability analytics remain incomplete

Provider cost, customer points and platform subsidy facts exist. Still needed:

- display existing overview charged/subsidized metrics in Admin UI;
- selectable-period average/median usage/cost;
- utilization/exhaustion;
- FREE subsidy/conversion;
- realized gross margin;
- pricing recommendation calculator with explicit Admin-confirmed persisted points.

### 8. Attachment operation classification remains generic

Attachment settlement is Grant-correct, but stable per-operation tags still need cleanup before relying on operation-level profitability analytics.

### 9. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and journal still describe obsolete pre-refactor structures and do not reliably represent the current Record/Grant/Reply-edit schema.

Do **not** hand-fabricate the large Drizzle snapshot. Regenerate it from the actual TypeScript schema with a checked-out project toolchain, then run it against a fresh disposable PostgreSQL database.

### 10. New PostgreSQL edit/confirmation SQL has not been runtime validated

The new paths use PostgreSQL CTEs, row locks, optimistic version guards, grant reservations and exactly-once settlement. Static review is not runtime proof.

Before any Workers deployment, explicitly validate:

- line edit begin/replay/idempotency;
- provider-success durable state;
- reservation commit/release/subsidy;
- direct edit atomic Revision;
- pending LINE edit confirmation choose-existing/create-title/reject/expiry/stale-record behavior;
- bot-success Reply mapping;
- concurrency around Record version and Grant scopes.

## Next implementation batch — highest priority

Continue from this exact checkpoint; do not reimplement the Reply edit provider pipeline.

1. **Finish the small PWA confirmation UX gap.**
   - type/parse `operation` and `proposedRawText`;
   - show current vs proposed content/time for `LINE_AI_EDIT`;
   - use edit-specific confirm/reject wording.

2. **Replace PRIVATE `/usage/me` aggregate summary with Grant-ledger usage.**
   - customer-visible PRIVATE available/reserved/used points from eligible owned Grants/scopes;
   - preserve provider cost/usage history only where it is useful to the customer;
   - stop bootstrap from depending on old quota balances.

3. **Collapse subscription quota into Grant lifecycle.**
   - add explicit billing type;
   - paid period -> idempotent immutable `SUBSCRIPTION_PERIOD` Grant;
   - remove aggregate reserve/commit/release paths and old quota schema/readers after callers are migrated;
   - move neutral AI usage accounting types out of `subscription.ts`;
   - rename remaining Owner/quota compatibility contract names after no caller needs them.

4. **Wire TOP_UP Grant creation when the payment lifecycle is ready.**

5. **Finish Admin pricing/profitability analytics.**

6. **Regenerate migration baseline/snapshot and perform concentrated local/runtime validation.**
   - typecheck/build/Vitest;
   - disposable PostgreSQL migration and SQL/concurrency tests;
   - browser/PWA flows;
   - LINE Reply/create/edit/history smoke;
   - Gemini runtime smoke;
   - only then deploy to `workers.dev` according to deployment policy.

## Rough remaining work

Planning-only estimate from the current branch state:

- core product/domain contract: essentially defined;
- Reply-targeted provider edit: major implementation is now wired, with a small PWA confirmation-preview UX gap and unexecuted tests remaining;
- major non-payment implementation before concentrated validation: roughly **2 substantial batches** (PRIVATE usage/grant cleanup, then subscription aggregate-quota collapse/terminology cleanup);
- Admin analytics and payment/top-up are additional product/payment batches;
- migration regeneration + real validation remains mandatory before deployment.

## Validation status

This run performed GitHub repository reads/writes and static cross-file review only.

No checked-out AFTERTRACE project/toolchain was available in the execution runtime. A direct local repository checkout was not available, so this run did **not** execute:

- TypeScript typecheck;
- build;
- Vitest;
- Drizzle generation/migration;
- PostgreSQL SQL/concurrency validation;
- browser/PWA runtime;
- Cloudflare Worker runtime;
- LINE webhook runtime;
- Gemini runtime.

Therefore none of the new tests/code paths are claimed as passing yet.

No GitHub Actions were run, dispatched, rerun, enabled, modified, or otherwise triggered.

The branch is an active refactor checkpoint and is **not deployment-ready** until the migration baseline/snapshot are regenerated and the current Grant/Reply-edit/confirmation SQL has been executed against disposable PostgreSQL with concentrated local/runtime validation.
