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

The latest product/development documents above are the only product specification. Do not revive old Customer/Project/Finance/Owner/aggregate-quota assumptions from older code, migrations, or tests.

## Current execution checkpoint — 2026-09-04 PRIVATE AI parity + plan semantics + first-deploy bootstrap

This run continued from the fail-closed production audit and preceding Source/Grant database-integrity work. It did **not** redo the completed Source/Entity/Record/PWA/LINE Reply EDIT/Grant accounting/Admin profitability/composite-FK/baseline-guard work.

The focus was concrete launch correctness around PRIVATE AI eligibility, customer plan semantics and the first fresh-database Worker deployment path.

## Scanned this run

- all eight required durable documents;
- latest `revive/line-worklog` checkpoint/source before each write;
- PRIVATE OA runtime CREATE/QUERY/Reply EDIT/attachment handling;
- production OA runtime wiring in `index.ts`;
- GROUP AI authorization for parity comparison;
- AI Grant service positive-balance contract;
- text-normalization reservation timing and raw-first persistence behavior;
- customer PWA handling of unresolved `entity_id = NULL` Records;
- Admin plan capability definitions and customer plan capability payload;
- subscription page FREE/paid point presentation;
- payment-disabled checkout boundary;
- API first-deploy readiness and production deployment helper;
- attachment runtime production configuration in `worker.ts`;
- existing OA/runtime/subscription/readiness test sources.

## Files changed this run

PRIVATE AI contract/tests:

- `apps/api/src/worklog/oa-runtime.test.ts`

Plan/capability semantics:

- `apps/api/src/admin/capabilities.ts`
- `apps/api/src/admin/capabilities.test.ts` — new
- `apps/api/src/worklog/subscription-routes.ts`
- `apps/web/src/SubscriptionRoot.tsx`

Production first-deploy flow:

- `worker-deploy.ps1`

Durable docs:

- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. PRIVATE LINE AI zero-balance behavior now has production + test contract parity

Latest production source already had the correct wiring and was re-verified:

- `WorklogOaRuntime` accepts a `WorklogOaAiGrantPort`;
- `index.ts` injects the actual `WorklogAiGrantService`;
- QUERY/history navigation returns before any AI point check and remains free;
- direct PRIVATE CREATE and quoted attachment paths require positive eligible PRIVATE Grant points before Record/AI work begins;
- Reply EDIT first resolves the deterministic same-Source target, then checks positive PRIVATE Grant points before entering the AI editor;
- failure/missing Grant service fails closed;
- the point ledger still performs the final atomic reservation immediately before provider execution.

The old OA runtime tests did not inject a Grant port and therefore no longer represented production behavior. They were updated to cover:

- positive-point CREATE;
- zero-point CREATE with **no Record write**;
- QUERY with zero points and no Grant lookup;
- deterministic Reply target resolution before zero-point edit rejection and no AI editor call;
- positive/zero-point quoted attachment preflight;
- existing idempotency behavior after preflight.

These are test-source changes only; Vitest was not executed here.

### 2. Retired AI subscription capability gates were removed

Accepted product policy is Grant-backed AI eligibility. Subscription feature flags must not form a second AI entitlement system.

Removed from current Admin capability definitions:

- `privateOaRecording`;
- `aiTextRecording`;
- `aiMediaIngestion`.

`export` remains the only current non-AI plan capability definition, but it is `shipped: false` and cannot be enabled yet.

Customer `/subscription/plans` also strips stale historical AI capability keys from prelaunch JSON rows and forces `export=false` until the actual export feature ships.

Customer Subscription UI no longer displays AI modes as plan-specific capabilities.

A focused Admin capability source test now locks:

- only `export` remains;
- retired AI keys do not revive entitlement behavior;
- unshipped Export remains fail-closed.

### 3. FREE plan display now matches the actual 400,000-point product contract

FREE correctly has `subscription_period_points = 0`; it is not a monthly allowance.

Previously the customer plan card displayed that raw field as `訂閱週期 AI 點數：0`, which misleadingly implied FREE receives no AI allowance.

The customer plans API now returns:

- `one_time_initial_points = 400000` for FREE;
- `0` for other plan shells.

The FREE card now says the points are:

- 400,000 once;
- not calendar-refreshed;
- not calendar-expiring.

PRO/TEAM continue to display per-subscription-period points from their explicit Admin-configured templates.

The durable FREE Grant itself remains provisioned by the existing idempotent bootstrap flow; the UI field does not create or resize Grants.

### 4. First fresh-database API deployment no longer has an impossible readiness loop

The documented fresh-DB sequence requires the API to exist before Admin can initialize:

- DB-backed AI runtime pricing;
- the FREE plan shell.

But `worker-deploy.ps1` previously required `/health/ready=ready` immediately after API deploy, making a first fresh DB helper run inevitably fail before Admin configuration could occur.

The helper now has an explicit:

`-AllowInitialBootstrapNotReady`

switch.

Default behavior remains strict. The bootstrap exception may tolerate **only**:

- `AI_RUNTIME_CONFIG_NOT_INITIALIZED`;
- `FREE_PLAN_NOT_INITIALIZED`.

It still fails on:

- missing/invalid Worker secrets or origins;
- DB connectivity problems;
- old/unapplied schema;
- any other readiness error.

The helper clearly reports that an API deployed in initial-bootstrap mode is **NOT ready for public launch**. After Admin initialization, `/health/ready=ready` remains mandatory.

Readiness HTTP error parsing was also hardened for PowerShell StrictMode when an exception does not expose `ErrorDetails`.

### 5. Attachment runtime production wiring was re-audited and is real

`apps/api/src/worker.ts` calls `configureWorklogAttachmentRuntime(...)` on each Worker fetch with current environment bindings and wires:

- current production DB;
- Grant-backed AI point ledger;
- LINE access token content resolver;
- Gemini attachment normalizer.

Therefore GROUP/OA quoted attachment behavior is not test-only or accidentally unconfigured at runtime.

### 6. Raw-first CREATE reservation race remains a known bounded behavior, not a silent accounting bug

LINE direct TEXT CREATE intentionally persists raw durable text before AI title/time interpretation where practical.

A positive preflight is not a balance lock. A concurrent request can consume the last points before normalization reaches its final atomic reservation. In that case:

- no provider call starts without a successful reservation;
- no customer balance becomes negative;
- raw Record data remains durable;
- the Record may remain `entity_id = NULL` while normalization is deferred;
- PWA already renders that state as `待確認` and allows an authorized user to manually move it to a title.

Do not invent a cross-layer reservation handoff merely to eliminate this race without a dedicated design/runtime batch. A future UX follow-up may make LINE replies more explicit when title normalization is deferred, but data/accounting safety is already fail-closed.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- DB-enforced Source identity and Source-scoped Entity/Record/Confirmation/LINE-edit/attachment relations;
- DB-enforced PRIVATE Web-entry Source ownership and Grant/grant-scope funding consistency;
- Customer/Project/Transaction/Finance/category/normalized-summary removed from customer core;
- free PWA manual CRUD/search/title move/batch move/delete/recycle/restore/revision history;
- GROUP manual authorization = active membership only;
- early route-level + final DB optimistic version checks;
- deterministic HISTORY filtered PWA links;
- deterministic Reply-targeted PRIVATE/GROUP LINE AI EDIT and bot-success Reply mapping;
- title ambiguity confirmation without second AI charge;
- FREE 400,000 one-time user Grant;
- user-owned Grants/scopes/caps + separate GROUP AI 額度負責人;
- provider full-cost -> output-price-equivalent AI points;
- platform subsidy for post-start overage;
- immutable/idempotent subscription-period Grants;
- aggregate quota/`ai_units_consumed`/`actualUnits` removed from active accounting contract;
- factual Admin profitability;
- provider `reservationPoints` vocabulary;
- stale Owner/group paid-gate/recording-preference assumptions removed;
- bounded LINE attachment streaming + no permanent binaries;
- safe baseline regeneration/guard;
- release preflight;
- explicit production migration DB URL;
- API liveness/readiness split;
- payment-disabled checkout fail-closed;
- Web/Admin SPA deep-link deployment checks;
- hard-coded workers.dev account hostname removed.

## Current hard blocker — checked-in Drizzle baseline is still stale

The checked-in `drizzle/0000_worklog_baseline.sql` remains from the pre-rebuild world and MUST NOT be applied.

The authoritative TypeScript schema now also includes newer Source/Grant composite constraints, so manually editing the old SQL/snapshot is unsafe.

This is still the primary launch blocker and requires the actual pinned project toolchain.

## Remaining / blocking work

### 1. Regenerate baseline/snapshot/journal — primary launch blocker

From a real latest checkout:

1. `pnpm install --frozen-lockfile`
2. verify pinned `pnpm --version`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. fix actual Drizzle/type errors exposed by the latest composite FKs/checks
6. `pnpm db:baseline:guard` until green

Do not hand-fabricate Drizzle metadata.

### 2. Apply to fresh PostgreSQL and validate invariants

Validate at minimum:

- generated FK/check/index/type names;
- PRIVATE/GROUP Source shape;
- cross-Source Entity/Record/Alias/Confirmation/LINE-edit/attachment rejection;
- PRIVATE Web-entry user/Source mismatch rejection;
- reservation Source mismatch rejection;
- Grant/grant-scope attribution mismatch rejection;
- normal CRUD/revision/confirmation paths under constraints;
- Grant reserve/commit/release/expire/subsidy/concurrency state.

Then initialize AI runtime config + FREE plan and confirm `/health/ready` becomes green.

### 3. Entity/Alias case-collision behavior

Runtime matching uses case-insensitive `lower(...)` while database uniqueness remains case-sensitive. Reproduce on real PostgreSQL before choosing normalization/expression-index/collation behavior. Do not guess from static source.

### 4. Run real release validation

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- updated PRIVATE zero-point/OA tests;
- Admin capability tests;
- authenticated PWA CRUD/version/group-membership smoke;
- Admin login + `/profitability`;
- LINE Login/one-time entry;
- PRIVATE/GROUP CREATE/HISTORY/Reply EDIT/confirmation;
- attachment text/image/audio/file limits/expiry/202;
- real Gemini pricing/usage/point settlement;
- API `/health` + `/health/ready`;
- Web/Admin deep links;
- Workers dry-run/runtime deploy checks.

### 5. Full paid MVP still has separate gaps

Payment provider, recurring payment success/failure, TOP_UP purchase lifecycle/refunds/proration remain unfinished by explicit product decision.

Export is still specified as an initially paid MVP capability but has no customer endpoint/UI. It is deliberately fail-closed and cannot be advertised/enabled yet.

Therefore:

- free/manual + AI-recording launch can be evaluated after migration/runtime gates turn green;
- full paid-MVP launch still requires payment + paid Export work.

## Next implementation target

Continue from this exact checkpoint. Do not redo PRIVATE Grant preflight, removal of AI plan flags, FREE one-time point presentation, first-deploy bootstrap mode, DB integrity constraints or prior release gates.

Highest priority next run:

1. obtain/use a real latest checkout with pinned pnpm/Drizzle;
2. regenerate the baseline immediately;
3. fix actual TypeScript/Drizzle errors from the current schema;
4. pass the baseline guard;
5. apply to fresh PostgreSQL and execute integrity probes;
6. initialize AI runtime config + FREE plan;
7. run `pnpm release:preflight`;
8. run browser/LINE/Gemini/Worker smoke.

If local execution remains unavailable, continue static audit only for concrete launch blockers; do not broaden into speculative redesign.

## Validation status

This run performed source/document audit and direct GitHub source edits only.

No checked-out local project/toolchain became available in this environment. Source tests were updated/added, but **none were executed**.

**Not executed:**

- `pnpm install`;
- baseline regeneration/guard;
- release preflight;
- TypeScript typecheck;
- ESLint;
- Vitest;
- production builds/Worker dry-run;
- Drizzle generation/export/migration;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker deploy/runtime;
- LINE runtime;
- Gemini runtime.

Therefore no test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY yet.**

The remaining free/manual + AI-recording launch blockers are now operational validation blockers rather than broad product refactors: regenerated migration artifacts, fresh PostgreSQL, real preflight and runtime smoke.

## Rough remaining work

Assuming a current checkout/toolchain and disposable PostgreSQL are available:

- baseline regeneration + fix actual generated-schema/type errors: **1 focused batch**;
- fresh PostgreSQL/integrity/concurrency validation: **1 focused batch**;
- release preflight + browser/LINE/Gemini/Workers smoke: **1 focused validation batch**;
- payment + paid Export: separate full-paid-MVP work.
