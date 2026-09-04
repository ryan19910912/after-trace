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

## Current execution checkpoint — 2026-09-04 11:30 batch

This run re-read all required documents, reconciled the previous checkpoint, and continued from the existing Reply-targeted LINE AI edit / Grant-backed funding foundation. It did not reimplement completed provider/edit logic.

The completed batch is: **PWA can now safely present already-paid LINE AI edit confirmations as current-vs-proposed edits, and PRIVATE customer AI balance has moved off the legacy aggregate quota reader onto the same Source-scoped Grant ledger already used by GROUP.**

## Scanned this run

- all required durable product/development/deployment docs;
- latest `WORKLOG_REBUILD_PROGRESS.md` checkpoint;
- PWA API client and `WorklogRoot` confirmation/funding UI;
- confirmation service, route serialization, and safe PostgreSQL resolver;
- GROUP funding routes and grant-scope visibility rules;
- main manual PWA `worklog/routes.ts` transitional `/usage/me` reader;
- subscription service/repositories/routes and Admin subscription assignment path;
- Grant service/repository and current AI-point policy;
- production webhook `index.ts` to verify AI execution is already Grant-ledger backed.

## Files changed this run

- `apps/api/src/worklog/confirmations.ts`
- `apps/api/src/worklog/confirmation-routes.ts`
- `apps/api/src/worklog/drizzle-confirmations-safe.ts`
- `apps/api/src/worklog/funding-routes.ts`
- `apps/api/src/worklog/routes.ts`
- `apps/web/src/worklog-api.ts`
- `apps/web/src/WorklogRoot.tsx`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed this run

### 1. LINE_AI_EDIT Pending Confirmation now exposes both current and proposed durable state

`WorklogPendingConfirmation` now includes `recordOccurredAt` in addition to the already-durable proposed `occurredAt` and `proposedRawText`.

The safe repository reads the current Record `occurred_at` from PostgreSQL and the confirmation route serializes it. This is presentation-only data; the existing version/entity/edit-state guards remain authoritative when a confirmation is actually applied.

### 2. PWA Pending Confirmation UI is operation-aware

The web client now types/parses:

- `operation`: `CREATE_TITLE` or `LINE_AI_EDIT`;
- `proposedRawText`;
- `recordOccurredAt`;
- existing proposed `occurredAt` and expected Record version.

For `LINE_AI_EDIT`, PWA now shows:

- current Record text and current occurrence time;
- AI-proposed replacement text and proposed occurrence time;
- existing-title candidates or a new/correct title input;
- explicit wording that the provider result is already durable/accounted and confirmation does **not** call AI or consume points again;
- edit-specific apply/reject copy.

Rejecting an edit is presented as keeping the original Record unchanged. Confirming is presented as applying the already-paid proposal while preserving revision history. Backend version guards still reject stale proposals.

The original CREATE-title confirmation UX is preserved.

### 3. PRIVATE AI balance is now Source-scoped and Grant-ledger backed

Added authenticated `GET /api/v1/worklog/funding/personal`.

It resolves only the signed-in user's ACTIVE PRIVATE Source, then reports customer-facing facts from:

- user-owned `worklog_ai_grants`;
- enabled scope for that PRIVATE Source in `worklog_ai_grant_scopes`;
- per-scope used/reserved points;
- `worklog_ai_usage_events.customer_points_charged`;
- `worklog_ai_usage_events.platform_subsidized_points`.

It does not read `worklog_ai_quota_balances`, subscription aggregate usage, another user's grants, or provider USD pricing.

The personal Grant inventory returned by this endpoint is restricted to the authenticated owner and shows only how each owned Grant applies to the current PRIVATE Source. GROUP scope allocation remains explicit and separate.

### 4. PRIVATE PWA no longer depends on `/usage/me`

`WorklogRoot` now loads `personalFunding()` for PRIVATE and `groupFunding()` for GROUP. The old `myUsage()`/aggregate `UserUsage` client contract has been removed.

The PRIVATE top panel now shows Grant-backed:

- available points;
- active reservations;
- historical customer-charged points;
- platform-subsidized points;
- the user's own Grant rows as scoped to the personal Source.

The UI explicitly states that manual create/edit/search remains free and does not consume AI points.

### 5. Transitional `/api/v1/worklog/usage/me` aggregate reader was removed

`apps/api/src/worklog/routes.ts` no longer imports or constructs `DrizzleWorklogUsageRepository` / `WorklogUsageService`, and the compatibility `/usage/me` endpoint has been deleted.

The ordinary PWA route module is again data-only: manual Record access depends only on PRIVATE ownership or active GROUP membership, not subscription/quota state.

### 6. Subscription collapse was audited but not guessed

The remaining legacy aggregate quota is now isolated primarily in subscription lifecycle code:

- `subscription.ts` still defines old subscription entitlement and quota reservation contracts;
- `drizzle-subscription.ts` still creates/reads `worklog_ai_quota_balances` and `worklog_ai_quota_reservations`;
- `drizzle-subscription-safe.ts` still contains legacy settlement guards;
- Admin manual plan assignment still constructs `WorklogSubscriptionService(new DrizzleWorklogSubscriptionRepository(...))`;
- subscription plan/API field name `ai_allowance_units` remains transitional.

Provider execution itself is already Grant-only; these old paths are no longer the authority for text Gemini, attachment Gemini, GROUP funding, PRIVATE funding, or Reply AI edit.

This run did **not** guess upgrade/downgrade/proration semantics while converting Admin plan assignment into `SUBSCRIPTION_PERIOD` Grants. Before collapsing that lifecycle, the implementation must preserve the accepted rule that each successful paid period creates an immutable/idempotent user-owned Grant, PRIVATE scope may be automatic, GROUP scopes stay explicit, and historical Grant amounts are never silently resized when plan pricing/config changes.

## Stable completed foundation from earlier batches

Do not redo unless an actual regression is found:

- Source + single Entity/title + Alias + Record + immutable Revision core;
- Customer/Project/Finance/Transaction/category/normalized-summary removed from customer Record core/UI/API;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization = active membership, independent from subscription/AI points;
- GROUP Source independent from AI funding responsibility;
- old pending-group runtime/schema removed;
- single-title/`occurred_at` Gemini CREATE interpretation;
- durable CREATE Pending Confirmation and safe PWA resolution;
- deterministic HISTORY -> Source-correct filtered PWA links;
- deterministic same-Source Reply target resolution;
- durable GROUP/PRIVATE Reply-targeted LINE AI EDIT provider pipeline;
- LINE_AI_EDIT durable proposal, optimistic Record version guard and immutable Revision;
- LINE_AI_EDIT Pending Confirmation choose-existing/create-title/reject/expiry/stale handling without second AI charge;
- bot success-message -> Record Reply mapping;
- FREE initial Grant = exactly 400,000 AI points once, idempotent, no refresh/expiry;
- text and attachment provider execution use user-owned Grants/scopes/caps;
- full provider cost -> frozen output-price-equivalent AI points;
- customer balance floors at zero; provider overrun becomes platform subsidy;
- GROUP charged-user resolution via `worklog_source_ai_responsibility`;
- grant-backed GROUP funding/allocation PWA;
- grant-backed PRIVATE funding PWA;
- Admin customer/group usage reporting based on grants/responsibility/provider-cost facts;
- normalization reservation FK points to grant-backed point reservations.

## Remaining / blocking work

### 1. Collapse subscription aggregate quota into Grant lifecycle

Highest-priority next implementation batch.

Target behavior already defined by product policy:

- subscription is billing/lifecycle metadata, not an AI-balance table;
- a successful paid subscription period creates one immutable/idempotent `SUBSCRIPTION_PERIOD` Grant with the Admin-confirmed included point count;
- historical Grant point amounts are not resized if plan price/FX/model/margin configuration later changes;
- PRIVATE scope may be provisioned automatically for the Grant owner;
- GROUP scope is never implicitly granted and remains explicit through funding allocation;
- provider eligibility/reservation/settlement remains entirely on `worklog_ai_point_reservations` + Grant scopes.

Once all callers are migrated, remove:

- `worklog_ai_quota_balances`;
- `worklog_ai_quota_reservations`;
- old subscription reserve/commit/release methods/types;
- old aggregate usage service/repository if no non-legacy caller remains;
- old Owner/quota compatibility enum names that can reintroduce the obsolete model.

Do not invent upgrade/downgrade/proration/refund behavior that is not defined in product docs. Keep that separate from the straightforward "successful billing period -> immutable Grant" event.

### 2. TOP_UP Grant lifecycle remains unwired

The Grant model supports `TOP_UP`, but real payment/provider lifecycle is not yet enabled. When payment is wired, each successful purchase needs an idempotent external-origin key and immutable purchased-point Grant. Do not simulate a payment provider merely to complete schema work.

### 3. Plan billing representation remains transitional

Accepted commercial model:

- FREE = one-time launch grant;
- PRO/TEAM = monthly subscription;
- included paid points are explicitly persisted/confirmed by Admin.

Schema/API still uses legacy `ai_allowance_units` naming and lacks a clean explicit billing-type representation. Clean this during subscription collapse without silently changing configured point values.

### 4. Admin pricing/profitability analytics remain incomplete

Still needed:

- surface current overview charged/subsidized facts in Admin UI;
- selectable today / 7d / 30d / current-billing-month periods;
- average/median request/user/subscriber usage and provider cost;
- allowance utilization/exhaustion;
- FREE subsidy/conversion;
- realized AI cost ratio/gross margin;
- pricing recommendation calculator with explicit Admin-confirmed persisted included points;
- breakdowns by plan, Grant source, model, operation/input type and PRIVATE/GROUP.

### 5. Attachment operation classification remains generic

Attachment settlement is Grant-correct, but stable operation tags still need cleanup before operation-level profitability reporting is trustworthy.

### 6. Drizzle baseline/snapshot are stale — deployment remains blocked

`drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and journal still describe obsolete pre-refactor structures and do not reliably represent the current Record/Grant/Reply-edit schema.

Do **not** hand-fabricate the large Drizzle snapshot. Regenerate from the actual TypeScript schema with a checked-out project toolchain, then apply against a fresh disposable PostgreSQL database.

### 7. New PostgreSQL/Workers paths still need real runtime validation

Before deployment, execute locally/runtime (not GitHub Actions):

- TypeScript typecheck/build;
- Vitest suites;
- fresh disposable PostgreSQL migration;
- Grant reservation/settlement/subsidy and concurrency tests;
- manual CRUD/version/revision/delete/restore tests;
- CREATE/HISTORY/Reply EDIT and both confirmation operation tests;
- PRIVATE/GROUP funding authorization tests;
- browser/PWA smoke;
- LINE/Gemini runtime smoke as available;
- then Workers deployment readiness checks from `WORKLOG_DEPLOYMENT.md`.

## Next implementation target

Continue from this exact checkpoint and **do not redo PWA funding or LINE edit confirmation UX**.

1. Trace every remaining `WorklogSubscriptionService` / `DrizzleWorklogSubscriptionRepository` / old quota-table caller on this branch.
2. Split subscription lifecycle from AI balance accounting.
3. Implement only the deterministic successful-period -> immutable `SUBSCRIPTION_PERIOD` Grant path with a stable origin key and PRIVATE scope; keep GROUP scope explicit.
4. Migrate Admin/manual plan-period assignment onto that lifecycle only where semantics are unambiguous.
5. Remove old quota reserve/commit/release/schema once no runtime caller remains.
6. Move neutral provider-usage accounting types out of `subscription.ts` if still referenced by LINE edit or other Grant-backed services.
7. Then wire TOP_UP lifecycle if/when a real payment success boundary exists, finish Admin analytics, regenerate Drizzle baseline/snapshot and perform concentrated runtime validation.

## Validation status

This run performed only static branch/document cross-file audit and GitHub source edits.

**Not executed this run:** TypeScript typecheck, build, Vitest, PostgreSQL, Drizzle migration generation/apply, browser/PWA runtime, Cloudflare Worker runtime, LINE runtime, Gemini runtime, or deployment.

Therefore no test/build/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.** The main blockers are stale Drizzle baseline/snapshot and unvalidated PostgreSQL/Grant/edit SQL. Subscription aggregate-quota cleanup is also still incomplete.

## Rough remaining work

Planning-only estimate from current branch state:

- core domain/manual PWA/LINE CREATE-HISTORY-EDIT/Grant funding behavior: largely implemented;
- major non-payment implementation before concentrated validation: roughly **1–2 substantial batches**, dominated by subscription aggregate-quota collapse/terminology cleanup;
- Admin profitability and real payment/TOP_UP remain additional batches;
- migration regeneration plus real local/runtime validation is mandatory before deployment.
