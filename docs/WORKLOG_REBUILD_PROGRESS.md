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

## Current execution checkpoint — 2026-09-04 customer PWA + Admin launch-audit batch

This run re-read all eight durable documents and continued from the PRIVATE-AI/first-deploy checkpoint. It did **not** redo completed Source/Entity/Record/LINE Reply EDIT/Grant accounting/composite-FK/baseline-guard work.

The focus was an explicit front-end + back-end/Admin audit for launch-facing bugs: stale sessions, cross-Source UI state, asynchronous stale responses, Grant hold visibility, Admin plan/pricing safety, cost-report completeness and stale plan-as-AI-entitlement presentation.

## Scanned this run

Customer Web/PWA:

- `apps/web/src/WorklogRoot.tsx`
- `apps/web/src/worklog-api.ts`
- `apps/web/src/SubscriptionRoot.tsx`
- `apps/web/src/FeedbackRoot.tsx`
- current Source switch/filter/delete/recycle/create/edit/move/history/confirmation/funding flows;
- LINE-entry/session persistence and expiry behavior;
- FREE one-time point presentation;
- Group/Private funding display and in-flight reservation behavior.

Admin/API:

- `apps/admin/src/App.tsx`
- `apps/admin/src/api.ts`
- `apps/admin/src/ProfitabilityPage.tsx`
- `apps/api/src/admin/routes.ts`
- `apps/api/src/admin/repository.ts`
- `apps/api/src/admin/grant-repository.ts`
- Admin plan editor, manual plan assignment, AI runtime pricing editor, overview/profitability, anomaly/audit/detail views;
- FREE plan invariants and subscription-period behavior;
- group/user Grant available/reserved accounting;
- current plan-capability definitions.

Also re-checked the execution environment. A GitHub network command was retried and still failed DNS resolution (`Could not resolve host: github.com`), so there was still no usable checked-out project/toolchain for pnpm/Drizzle/PostgreSQL/runtime execution.

## Files changed this run

Customer Web/PWA:

- `apps/web/src/WorklogRoot.tsx`
- `apps/web/src/worklog-api.ts`
- `apps/web/src/SubscriptionRoot.tsx`
- `apps/web/src/FeedbackRoot.tsx`

Funding/accounting presentation:

- `apps/api/src/worklog/funding-routes.ts`

Admin API/repository:

- `apps/api/src/admin/repository.ts`
- `apps/api/src/admin/grant-repository.ts`
- `apps/api/src/admin/routes.ts`
- `apps/api/src/admin/routes.test.ts`

Admin Web:

- `apps/admin/src/App.tsx`
- `apps/admin/src/ProfitabilityPage.tsx`
- `apps/admin/src/api.ts`

Durable handoff:

- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. Customer Web sessions now recover consistently after expiry

Previously only the initial Worklog bootstrap reliably cleared an expired Web session. A user who left the PWA open until the session expired could receive `INVALID_WEB_SESSION` during CRUD/funding/confirmation calls while the UI still looked logged in.

`apps/web/src/worklog-api.ts` now centralizes the exact session failure contract:

- only HTTP 401 with `INVALID_WEB_SESSION` or `WEB_SESSION_REQUIRED` clears the Web session;
- active stored Source scope is cleared too;
- the current page reloads to the normal LINE-login state;
- 403 authorization failures, 409 version conflicts and 5xx failures do **not** cause automatic logout.

`SubscriptionRoot` and the standalone `FeedbackRoot` also provide friendly expired-login messages rather than leaving the user in a broken authenticated-looking state.

### 2. PWA Source switching no longer leaves Record-bound editors from the previous Source

A serious UX/data-safety issue existed when a user belonged to multiple groups:

- open edit/move/history/create state in Source A;
- switch UI to Source B;
- the old A-bound editor could remain visible.

Because the user may legitimately be authorized to both Sources, the backend cannot infer that the user intended B rather than A.

The PWA now resets all Source-bound transient state when Source/filter/recycle context changes:

- selected rows and batch target;
- manual create editor/draft;
- edit editor/draft;
- move editor/target;
- revision-history panel;
- funding and pending-confirmation state before reload.

This prevents a visible B context from retaining an actionable A Record editor.

### 3. PWA drops stale asynchronous responses after rapid Source/filter changes

A second cross-Source race existed independently of the editor state:

- request A starts for Group A;
- user quickly switches to Group B and request B starts;
- request B returns first;
- slower request A could return later and overwrite B's records/entities/funding/confirmations.

`WorklogRoot` now uses a request generation counter. Every Source/filter/recycle context transition invalidates prior generations. Old-generation responses and errors are ignored instead of writing React state. Logout invalidates all pending generation-bound work as well.

This protects records, Entity options, funding and pending confirmations from stale cross-Source UI overwrite.

### 4. PWA navigation and feedback behavior are less brittle

The Worklog topbar now exposes direct customer navigation to:

- `/subscription`;
- `/help`;
- logout.

The embedded feedback form now catches submission failure and keeps the text instead of producing an unhandled rejected Promise or clearing the user's draft on failure.

The standalone feedback page likewise recovers expired sessions cleanly.

### 5. In-flight final-point holds are visible in PRIVATE/GROUP funding views

The point ledger may temporarily mark a Grant `EXHAUSTED` when an in-flight reservation holds its final available point. That state does **not** mean `reserved_points` vanished.

Customer funding aggregation previously selected only `grant.status = 'ACTIVE'`, causing a last-balance hold to appear as:

- available = 0;
- reserved = 0;

while the request was actually holding points.

PRIVATE and GROUP funding views now include currently effective, non-expired `ACTIVE` **and** `EXHAUSTED` Grants in availability/reservation aggregation. `remaining_points = 0` naturally keeps available at zero while `reserved_points` remains visible.

### 6. Admin group/user funding views follow the same Grant-hold semantics

`DrizzleGrantAdminRepository` now uses the same current Grant state boundary for user/group available and reserved reporting.

GROUP list/detail no longer hides reservation amounts merely because a final-point hold temporarily changed the Grant status to `EXHAUSTED`.

The group list also no longer joins/displays the AI 額度負責人的 current subscription plan as if that were a group AI entitlement fact. Group AI eligibility remains:

- current AI 額度負責人;
- active requesting member;
- explicitly scoped eligible user-owned Grant points.

Plan state is not a substitute for Grant eligibility.

### 7. Admin Overview no longer presents partial TWD cost as complete cost

Admin Overview now includes:

- `missingAiCostTwdRequestsToday`;
- `missingSubsidyCostTwdRequestsToday`.

If selected usage lacks a TWD conversion snapshot, the Admin homepage labels the TWD number as partial and shows a warning. This brings Overview in line with the already stricter Profitability report instead of silently treating NULL conversion facts as complete zero-cost coverage.

### 8. Admin AI modality pricing can now be configured correctly

A concrete provider-cost bug existed in the Admin Web UI:

- API/domain supported separate `audio_usd_per_million` and `image_usd_per_million`;
- the editor did not expose those fields;
- saving the form overwrote both with the general input price.

The editor now has independent optional audio and image pricing fields.

Rules:

- explicit value persists that modality's price;
- blank persists `NULL`, allowing provider-cost code to fall back to ordinary input pricing where appropriate;
- output reference price must be positive because the frozen AI-point conversion requires it;
- input/modality/FX values must be non-negative when supplied.

Backend `aiRuntimeInput()` now independently rejects zero output reference price with `AI_OUTPUT_PRICE_MUST_BE_POSITIVE`, so this invariant is not UI-only.

### 9. FREE plan invariants are enforced before persistence

The frozen launch contract is now enforced directly in Admin plan input validation:

- `FREE.price_twd` must be `0`;
- `FREE.subscription_period_points` must be `0`.

This prevents an operator from saving an invalid FREE shell and only discovering the mistake later via `/health/ready`.

Focused test source covers nonzero FREE price/period points and zero AI output reference price. The tests were authored but **not executed**.

### 10. Admin PlanEditor is fail-closed for unfinished/invalid configuration

Plan editor hardening includes:

- unshipped capabilities such as Export are visible as unavailable but disabled;
- invalid price/rank/point numeric input disables save;
- disabled plans are not offered as new manual assignments;
- a currently assigned disabled plan may remain visible for diagnosis, but cannot be newly applied;
- AI plan flags removed in prior work remain absent; AI availability is Grant-backed.

### 11. Admin session expiry is handled during normal operations, not only initial page load

The Admin main app now clears the Admin session when ordinary API actions return `ADMIN_SESSION_REQUIRED` or `ADMIN_SESSION_INVALID`.

The standalone `/profitability` page likewise removes its expired session and asks the operator to log in again instead of keeping a stale authenticated-looking report page.

### 12. Admin client TypeScript contracts now include the new facts

`apps/admin/src/api.ts` now explicitly types:

- Overview missing-TWD coverage counts;
- capability `shipped?: boolean`.

This avoids depending on page-local casts for newly enforced Admin contracts.

## Confirmed / not changed this run

### FREE manual assignment lifecycle

The Admin manual subscription path was traced through `WorklogSubscriptionPeriodService`.

Assigning the FREE plan does **not** create a zero-point recurring `SUBSCRIPTION_PERIOD` Grant. The one-time 400,000 FREE points remain exclusively the initial bootstrap Grant. An active paid period still cannot be silently switched mid-period to FREE because proration/change policy is intentionally undefined.

No product behavior was invented here.

### Payment and Export

Payment remains fail-closed and Export remains `shipped:false`. This run did not invent payment provider/refund/proration/export rules.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- DB-enforced Source identity and Source-scoped Entity/Record/Confirmation/LINE-edit/attachment relations;
- DB-enforced PRIVATE Web-entry Source ownership and Grant/grant-scope funding consistency;
- no Customer/Project/Transaction/Finance/category/normalized-summary customer core;
- free PWA manual CRUD/search/title move/batch move/delete/recycle/restore/revision history;
- GROUP manual authorization = active membership only;
- optimistic concurrency at route + DB layers;
- deterministic HISTORY filtered PWA links;
- deterministic Reply-targeted PRIVATE/GROUP LINE AI EDIT + bot reply mapping;
- durable ambiguity confirmation without second AI charge;
- PRIVATE/GROUP positive Grant preflight with final atomic ledger reservation;
- FREE 400,000 one-time Grant;
- user-owned Grants/scopes/caps + GROUP AI 額度負責人 separation;
- provider actual cost -> output-price-equivalent points + platform subsidy;
- immutable/idempotent subscription-period Grants;
- aggregate quota/`ai_units_consumed`/`actualUnits` removed from active accounting;
- factual Admin profitability;
- stale AI plan capability gates removed;
- bounded LINE attachment streaming/no permanent binaries;
- safe baseline regeneration/guard;
- release preflight;
- explicit production migration DB URL;
- liveness/readiness split + fresh-DB bootstrap mode;
- payment-disabled checkout fail-closed;
- Web/Admin SPA deep-link deployment checks.

## Current hard blocker — checked-in Drizzle baseline is still stale

The checked-in `drizzle/0000_worklog_baseline.sql` remains from the pre-rebuild world and MUST NOT be applied.

The authoritative TypeScript schema includes the newer composite Source/Grant integrity constraints, so hand-editing the old SQL/snapshot remains unsafe.

This is still the decisive launch blocker and requires the actual pinned project toolchain.

## Remaining / blocking work

### 1. Regenerate baseline/snapshot/journal — primary launch blocker

From a real latest checkout:

1. `pnpm install --frozen-lockfile`
2. verify pinned `pnpm --version`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. fix actual TypeScript/Drizzle errors exposed by the current composite FK/check schema
6. `pnpm db:baseline:guard` until green

Do not fabricate Drizzle metadata.

### 2. Apply to fresh PostgreSQL and validate invariants

Validate at minimum:

- generated FK/check/index/type names;
- PRIVATE/GROUP Source shape;
- cross-Source Entity/Record/Alias/Confirmation/LINE-edit/attachment rejection;
- PRIVATE Web-entry user/Source mismatch rejection;
- reservation Source mismatch rejection;
- Grant/grant-scope attribution mismatch rejection;
- normal CRUD/revision/confirmation SQL under constraints;
- Grant reserve/commit/release/expire/subsidy/concurrency state;
- customer/Admin final-held-point reserved reporting;
- Entity/Alias case-insensitive collision behavior.

Then initialize AI runtime config + FREE plan and require `/health/ready=ready`.

### 3. Real local/runtime validation remains mandatory

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- TypeScript typecheck, ESLint, Vitest and production builds through that gate;
- customer PWA Source-switch race/session-expiry/CRUD/version/group-membership browser smoke;
- Admin plan/AI pricing/session/Overview/Profitability browser smoke;
- LINE Login/one-time entry;
- PRIVATE/GROUP CREATE/HISTORY/Reply EDIT/confirmation;
- attachment text/image/audio/file size/expiry/202;
- real Gemini pricing/usage/point settlement;
- Workers `/health` + `/health/ready` and deployment helpers.

### 4. Remaining non-blocking source/UX follow-up

The raw-first LINE TEXT CREATE pipeline can still preserve a Record with `entity_id = NULL` when a positive preflight loses a later reservation race or AI normalization is deferred. Data/accounting remain safe and PWA shows `待確認`; a future UX batch may make the LINE success message explicitly distinguish “raw saved, title pending”. Do not redesign reservation ownership without runtime evidence.

Admin main navigation can also add an explicit shortcut to `/profitability`; the report itself is already routed and deploy-smoked. This is useful UX, not a launch-safety blocker.

### 5. Full paid MVP remains separate

Payment provider, recurring payment lifecycle, TOP_UP purchase/refund/proration and paid Export remain unfinished by explicit product decision.

Therefore:

- free/manual + AI-recording launch can be evaluated once migration/runtime gates are green;
- full paid MVP still requires payment + Export implementation/validation.

## Next implementation target

Continue from this exact checkpoint. Do not redo the PWA session/Source generation fixes, Grant hold visibility, Admin modality pricing/FREE invariants, removed AI plan gates or previous DB integrity work.

Highest priority next run:

1. obtain/use a real latest checkout with pinned pnpm/Drizzle;
2. regenerate baseline immediately;
3. fix actual TypeScript/Drizzle errors from the current schema;
4. pass baseline guard;
5. apply to fresh PostgreSQL and execute integrity/concurrency probes;
6. initialize AI runtime config + FREE plan;
7. run `pnpm release:preflight`;
8. run customer/Admin browser + LINE/Gemini/Worker smoke.

If local execution remains unavailable, continue static audit only for concrete launch blockers; do not broaden into speculative redesign.

## Validation status

This run performed document/source audit and direct GitHub source edits only.

A network attempt for a local GitHub checkout/access was retried and failed DNS resolution for `github.com`. No current local project/toolchain was available.

**Not executed:**

- `pnpm install`;
- baseline regeneration/guard;
- `pnpm release:preflight`;
- TypeScript typecheck;
- ESLint;
- Vitest;
- API/Web/Admin production builds;
- Drizzle generation/export/migration;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker dry-run/deploy/runtime;
- LINE runtime;
- Gemini runtime.

The new/updated tests are source contract only until executed by the real local/runtime toolchain. No test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY yet.**

Static/source-level customer and Admin launch safety is substantially tighter after this batch. The remaining free/manual + AI-recording launch blockers are now overwhelmingly operational validation blockers: regenerate the migration artifacts, run fresh PostgreSQL, pass the real preflight, then run browser/LINE/Gemini/Workers smoke.

## Rough remaining work

Assuming a current checkout/toolchain and disposable PostgreSQL become available:

- baseline regeneration + fix generated-schema/type errors: **1 focused substantial batch**;
- fresh PostgreSQL/integrity/concurrency validation: **1 focused batch**;
- release preflight + customer/Admin/LINE/Gemini/Workers smoke: **1 focused validation batch**;
- payment + paid Export: separate full-paid-MVP work.
