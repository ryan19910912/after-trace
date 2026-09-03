# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- this file

## Current execution checkpoint — 2026-09-04 04:xx batch

This run continued from the completed single-title Record/manual-PWA foundation, title/time Gemini create interpreter, bounded LINE HISTORY routing, and GROUP Source/bootstrap separation. It did **not** redo those finished batches.

Primary goals this run were:

1. make durable AI title ambiguity actually resolvable without a second provider call;
2. begin the user-owned grant/AI-point domain that will replace subscription/Owner aggregate quota;
3. freeze executable point conversion/subsidy semantics and provision the one-time FREE grant idempotently.

### Scanned this run

- all required product/entity/edit/AI-point/development/LINE-content/deployment/progress docs;
- current Record/Entity/Alias/confirmation schema;
- text-normalization persistence/confirmation creation;
- PWA manual authorization/routes and Web bootstrap;
- Worker route mounting;
- current provider-usage and legacy quota schemas;
- OA/private bootstrap and current LINE runtime wiring.

## Completed this run

### 1. Durable pending-confirmation resolution backend is implemented

Added a deterministic confirmation domain/service plus authenticated PWA endpoints.

Supported stored decisions:

- choose one allowed existing Entity/title;
- create/use the proposed or explicitly entered title;
- reject the pending decision.

Important invariants:

- resolving a stored confirmation never calls Gemini/AI again and consumes no new AI points;
- PRIVATE access is private-Source owner scoped;
- GROUP access is active-member scoped and never depends on subscription/legacy Owner/AI balance;
- only PENDING, unexpired confirmations for the authenticated user/Source can mutate data;
- the underlying Record must still be ACTIVE, unresolved (`entity_id IS NULL`) and at the expected version;
- selected existing Entities must belong to the same Source and be allowed by the stored candidate decision;
- Alias creation is Source-scoped and refuses conflicting canonical names/aliases;
- stale/concurrent Record changes cannot leave behind an Alias because existing-title Record mutation is the prerequisite CTE for Alias insertion;
- a newly-created title that loses a concurrent Record race is cleaned up when still unused;
- repeat resolve/reject calls are terminal/idempotent where the durable state allows it.

Mounted endpoints under `/api/v1/worklog/confirmations` before the generic Worklog route:

- `GET /personal`
- `GET /group/:sourceId`
- `POST /personal/:confirmationId/resolve`
- `POST /group/:sourceId/:confirmationId/resolve`

The initial draft resolver was deleted after hardening so the branch does not retain two competing implementations. The active repository is `drizzle-confirmations-safe.ts`.

PWA UI for these endpoints is still pending; backend resolution is now available and bounded.

### 2. User-owned AI grant schema foundation is added

Added explicit grant/accounting structures:

- `worklog_ai_grants`
  - `FREE_INITIAL`
  - `SUBSCRIPTION_PERIOD`
  - `TOP_UP`
  - `ADMIN`
  - independent original/remaining points, effective/expiry time and idempotent origin key;
- `worklog_ai_grant_scopes`
  - explicit Source permission;
  - optional per-Source cap;
  - no implicit fallback to unrelated Sources;
- `worklog_source_ai_responsibility`
  - current GROUP **AI 額度負責人** independent from GROUP data existence;
- `worklog_source_ai_responsibility_history`
  - transfer/recovery audit trail;
- `worklog_ai_point_reservations`
  - new grant-ledger provider preflight/settlement state;
- `worklog_ai_point_reservation_funding`
  - reservation funding attribution across grants/scopes;
- `worklog_ai_usage_funding`
  - immutable successful usage -> grant/scope charge attribution.

The old aggregate quota schema remains temporarily exported/executable because the text/attachment provider pipeline has not yet switched to the new ledger. Do not delete it until the provider paths use the grant ledger.

### 3. Provider usage schema now separates customer charge and platform subsidy

`worklog_ai_usage_events` now has forward fields for:

- AI operation;
- `customer_points_charged`;
- `platform_subsidized_points`;
- `platform_subsidized_cost_usd`;
- `platform_subsidized_cost_twd`.

Immutable provider usage/pricing/cost facts remain separate. Transitional `ai_units_consumed` remains only until old callers are removed.

### 4. Frozen AI-point conversion is executable

Added `ai-points.ts` with the frozen customer unit:

`1 AI point = 1 output-price-equivalent token`.

Actual points are calculated from the full provider cost using the request's output-token reference price. The deterministic whole-point rule is now frozen as **round positive fractions upward (`ceil`)** so successful provider usage is never under-accounted by truncation.

Also added customer settlement logic:

- customer charge = min(actual points, eligible customer balance held for the request);
- customer balance never becomes negative;
- excess = platform-subsidized points.

`WORKLOG_AI_POINT_POLICY.md` was updated to make the `ceil` rule durable rather than leaving rounding unspecified.

### 5. FREE 400,000-point provisioning is implemented and wired into private bootstrap

Added `WorklogAiGrantService` and Drizzle repository.

Current FREE launch behavior:

- origin key is idempotent per user, so repeated follow/private bootstrap does not create duplicate grants;
- exact initial value is **400,000 AI points**;
- no expiry;
- existing grant is never resized by a later configuration/model/FX change;
- initial FREE grant is explicitly allocated to the user's PRIVATE Source;
- GROUP allocation is deliberately **not** implicit, preventing a user-owned grant from leaking to unrelated group Sources;
- eligible balance respects grant remaining points, Source allocation, optional cap, enabled state, effective time and expiry.

`WorklogBootstrapService` now accepts an optional initial-grant port and provisions the FREE grant after the private Source exists. Production LINE webhook wiring passes the real `WorklogAiGrantService`; existing unit fakes can still omit it.

### 6. Tests were authored for the new contracts

Added tests for:

- deterministic confirmation service decisions;
- frozen 400,000 FREE point constant;
- provider-cost -> output-price-equivalent conversion;
- upward whole-point rounding;
- customer balance floor/platform subsidy;
- FREE grant provisioning and PRIVATE scope;
- positive scoped balance requirement before AI start.

These tests were authored but **not executed** in this environment.

### Files changed this run

- `apps/api/src/worklog/confirmations.ts` (new)
- `apps/api/src/worklog/drizzle-confirmations-safe.ts` (new, active resolver)
- `apps/api/src/worklog/confirmation-routes.ts` (new)
- `apps/api/src/worklog/confirmations.test.ts` (new)
- `apps/api/src/worklog/drizzle-confirmations.ts` (superseded draft deleted)
- `apps/api/src/worker.ts`
- `apps/api/src/db/schema-worklog-grants.ts` (new)
- `apps/api/src/db/schema-worklog-ai-usage.ts`
- `apps/api/src/db/schema-all.ts`
- `apps/api/src/worklog/ai-points.ts` (new)
- `apps/api/src/worklog/ai-points.test.ts` (new)
- `apps/api/src/worklog/ai-grants.ts` (new)
- `apps/api/src/worklog/drizzle-ai-grants.ts` (new)
- `apps/api/src/worklog/ai-grants.test.ts` (new)
- `apps/api/src/worklog/bootstrap.ts`
- `apps/api/src/index.ts`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Stable completed foundation from earlier batches

Do not redo these unless a regression is found:

- Customer/Project/Finance/category/normalized-summary removed from TypeScript/customer core;
- Source + single Entity/title + Alias + Record + immutable Revision schema/runtime foundation;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization uses active membership, not billing;
- GROUP Source exists independently from AI funding user; obsolete pending-group TypeScript runtime/schema removed;
- old Gemini summary/category/customer/project normalization replaced by single-title/`occurred_at` interpretation and durable ambiguity creation;
- obvious LINE HISTORY requests no longer become Records and route to deterministic Source-correct filtered PWA links;
- obvious LINE EDIT requests are fail-safe and cannot accidentally create a Record while Reply AI edit is unfinished;
- LINE attachment provider/idempotency foundation remains retained.

## Important transitional / blocking state

### 1. New grant schema exists, but provider execution still uses legacy aggregate subscription quota

Current text normalization and attachment execution still instantiate `WorklogSubscriptionService` / legacy quota reservation. Therefore the new grant balance is **not yet authoritative for provider calls**.

Next batch must implement grant-ledger reservation/funding/settlement and then switch both text and attachment provider ports. Until that happens, do not claim the zero-balance/grant/subsidy production invariant is fully enforced.

### 2. GROUP AI responsibility table exists, but `@AFTERTRACE 啟用` still writes legacy Owner columns

The new role table/history is schema-ready, but runtime claim/transfer/recovery is not wired. Legacy `owner_user_id` / `subscription_owner_user_id` remain transitional inputs to current AI authorization.

Do not remove them until group AI uses `worklog_source_ai_responsibility` + eligible grants.

### 3. PWA confirmation backend exists, UI still pending

The customer can be resolved safely through the authenticated API, but the normal PWA Records UI does not yet render a pending-confirmation card/choice flow.

### 4. Actual LINE Reply AI edit is still not implemented

Safety guard remains correct: Reply-targeted edits are recognized but refused rather than guessing. Remaining work requires deterministic replied Record mapping, grant preflight, provider edit interpretation, title ambiguity confirmation, version/revision mutation and one-time settlement.

### 5. Prelaunch migration baseline/snapshot remain stale — deployment is blocked

`drizzle/0000_worklog_baseline.sql` and `drizzle/meta/0000_snapshot.json` still describe obsolete pre-refactor structures and do not include this run's grant/confirmation schema. `_journal.json` still points at the stale baseline.

Do **not** hand-fabricate a large Drizzle snapshot just to appear synchronized. Regenerate from the actual current TypeScript schema and exercise a fresh disposable PostgreSQL database once a checked-out pnpm/project toolchain is available.

The branch is not migration/deployment-ready until this is done.

## Next implementation batch — highest priority

Continue from this exact checkpoint:

1. **Implement grant-ledger reservation/funding/settlement.**
   - positive eligible scoped balance is sufficient to start AI;
   - reserve customer points safely across eligible grants/scopes without negative balances or cap overrun;
   - commit actual points from full provider cost using frozen `ceil` conversion;
   - release unused reservation;
   - actual > customer-held amount becomes platform subsidy;
   - successful provider usage/funding remains exactly-once and resumable.

2. **Switch text + attachment provider execution from legacy subscription quota to the grant ledger.**
   - PRIVATE charges the user-owned eligible PRIVATE grants;
   - GROUP resolves current AI 額度負責人 then only that user's grants explicitly allowed for the GROUP Source;
   - zero eligible points means no provider call.

3. **Wire GROUP AI 額度負責人 claim/transfer/recovery to the new responsibility table/history.**
   - keep GROUP data/manual access completely independent;
   - define deterministic active-member authorization for assignment/takeover;
   - balances never transfer with the role.

4. **Remove remaining legacy funding runtime/schema after new grant path is authoritative.**
   - `owner_user_id` / `subscription_owner_user_id` funding semantics;
   - legacy `recording_enabled` gate if no longer needed;
   - aggregate quota balances/reservations and subscription-as-AI-entitlement assumptions;
   - transitional `ai_units_consumed`.

5. **Add PWA pending-confirmation UI.**
   - show unresolved Record text/proposed title/candidates;
   - choose candidate, create/enter title or reject;
   - refresh Record/title list after resolution;
   - no AI call on resolution.

6. **Finish Reply-targeted LINE AI edit on top of the new grant/idempotent layer.**

7. **Regenerate consolidated prelaunch migration baseline/snapshot and run concentrated validation when a real local project toolchain is available.**

## Remaining later work

- Admin plan/grant/point allocation UI;
- Admin pricing calculator, utilization/exhaustion/platform-subsidy/profitability analytics;
- FREE/PRO/TEAM billing type + successful monthly renewal grant creation + independent top-up products;
- paid export after core runtime validation;
- provider-native DOCX/XLSX ingestion validation/hardening;
- payment-provider lifecycle after merchant eligibility/fees are confirmed;
- Cloudflare workers.dev deployment/runtime validation.

## Validation status

This run performed static repository edits only. No build, TypeScript typecheck, Vitest execution, migration, browser, Worker, LINE, Gemini or database runtime validation was executed here. New tests encode intended behavior but are **not claimed passing**.

The current branch is an active refactor checkpoint, **not deployment-ready** because the migration baseline/snapshot are stale and the provider paths still use legacy quota settlement.

**GitHub Actions were not run, dispatched, rerun, enabled, modified, or otherwise triggered.**

## Planning estimate

Planning-only estimate after this batch:

- product/domain contract: ~99% defined for core MVP;
- Record/manual PWA/HISTORY foundation: materially implemented;
- deterministic pending-title resolution backend: materially implemented, pending executable validation/UI;
- user-owned grant schema + FREE provisioning + point conversion policy: foundation implemented;
- grant provider settlement/runtime replacement: major remaining core batch;
- Reply edit/Admin analytics/migration/deploy remain after that;
- rough expectation: **2–4 substantial implementation batches before concentrated migration/runtime validation**, then deployment-fix iterations as required.
