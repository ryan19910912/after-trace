# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run, in this exact order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

The latest documents above are the only product/development specification. Do not revive Customer/Project/Finance/Owner/aggregate-quota assumptions from legacy code, migrations, README history or old tests.

## Current execution checkpoint — 2026-09-04 Admin pricing calculator + remaining launch UX

This run continued from the remaining-work/fresh-bug audit. It did not redo completed Source/Entity/Record/PWA CRUD/LINE Reply EDIT/Grant accounting/Admin profitability/composite-FK work.

The focus was the next explicit product gap that could be implemented safely without a local checkout: the Admin AI pricing recommendation calculator. A local Git clone was retried after reading all eight required documents and still failed with `Could not resolve host: github.com`, so large 40KB runtime/PWA files were deliberately not rewritten through whole-file GitHub API writes merely to perform small UX patches.

## Scanned this run

- all eight required durable documents in exact required order;
- latest `revive/line-worklog` checkpoint;
- Admin runtime pricing contract and existing `AdminApi.aiRuntime()` surface;
- existing `/profitability` standalone Admin route pattern;
- pricing policy formula and 40% subscription / 50% one-time planning defaults;
- Admin Worker SPA/deployment helper deep-link checks;
- PWA version-conflict policy and LINE raw-first normalization result contract for next-batch planning.

## Files changed this run

Admin pricing calculator:

- `apps/admin/src/PricingCalculatorPage.tsx` — new standalone Admin page;
- `apps/admin/src/pricing-calculator.ts` — new pure planning formula;
- `apps/admin/src/pricing-calculator.test.ts` — new source tests;
- `apps/admin/src/main.tsx` — routes `/pricing-calculator`;
- `admin-worker-deploy.ps1` — verifies `/pricing-calculator` SPA deep link when an expected Admin URL is supplied.

Durable handoff:

- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Completed / fixed this run

### 1. Admin pricing recommendation calculator is now implemented

The pricing policy already required a planning calculator but the Admin previously only allowed operators to type the final plan point count manually.

New route:

`/pricing-calculator`

The page:

- requires the existing Admin bearer session;
- reads the current DB-backed AI runtime pricing snapshot through the existing Admin API;
- uses current `output_usd_per_million` and `usd_twd_rate`;
- accepts customer price in TWD;
- accepts editable target gross margin;
- defaults monthly subscription planning to 40% target gross margin;
- defaults one-time/top-up planning to 50%;
- calculates the maximum planned AI direct-cost budget;
- converts that budget to USD;
- converts USD budget into the frozen output-price-equivalent AI point basis;
- floors the recommendation so the suggested point balance does not exceed the entered AI cost budget.

The calculator is **planning only**. It never updates a plan and never resizes any historical Grant. Admin must still explicitly enter/confirm the final `subscription_period_points` in plan management.

### 2. Pricing formula is isolated and testable

`pricing-calculator.ts` owns the pure calculation contract instead of duplicating arithmetic in JSX.

It fails closed for:

- negative product price;
- target margin below 0 or >= 100%;
- missing/non-positive USD/TWD rate;
- missing/non-positive output reference price;
- non-finite results.

Test source covers the subscription planning example, floor behavior, and invalid inputs. Tests were authored but not executed in this environment.

### 3. Admin deployment smoke includes the new deep link

`admin-worker-deploy.ps1` now verifies:

- `/`;
- `/profitability`;
- `/pricing-calculator`.

This catches a broken Workers Static Assets SPA fallback for the new standalone page.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- DB-level Source identity and declared cross-Source protection;
- free PWA manual CRUD/search/filter/title move/batch move/delete/recycle/restore/revision history;
- GROUP manual authorization = active membership only;
- optimistic Record version checks and stale Source/filter response generation guard;
- deterministic LINE HISTORY -> filtered PWA deep links;
- deterministic Reply-targeted PRIVATE/GROUP LINE AI EDIT;
- FREE 400,000 one-time user Grant;
- user-owned Grant scopes/caps + separate GROUP AI 額度負責人;
- positive-balance preflight + final atomic reservation;
- provider actual cost -> output-price-equivalent points + platform subsidy;
- immutable/idempotent subscription-period Grants;
- retired aggregate quota / `ai_units_consumed` / `actualUnits` removed from active accounting;
- Admin factual profitability base report;
- Admin separate audio/image pricing, FREE shell invariants, missing-TWD coverage, strong session/password handling;
- Admin/runtime/readiness agree on currently shipped `GOOGLE + gemini-3.5-flash` contract;
- stale AI plan capability gates removed;
- customer Help and README no longer describe Customer/Project/Finance/Owner/paid-group legacy behavior;
- bounded LINE attachment streaming/no permanent binaries;
- payment-disabled checkout fail-closed;
- Export capability fail-closed until implemented;
- safe baseline regeneration/guard scripts;
- release preflight + liveness/readiness split + first-fresh-DB bootstrap mode;
- explicit production migration database URL;
- Web/Admin Static Assets SPA fallback/deep-link deployment checks;
- Admin pricing recommendation calculator.

## P0 — blocks any real launch

### 1. Regenerate Drizzle baseline/snapshot/journal

The checked-in `drizzle/0000_worklog_baseline.sql` is still from the retired pre-rebuild world and MUST NOT be applied.

From a real current checkout:

1. `pnpm install --frozen-lockfile`
2. verify pinned `pnpm --version`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. fix actual TypeScript/Drizzle errors exposed by current composite FK/check declarations
6. `pnpm db:baseline:guard` until green

Do not hand-fabricate Drizzle metadata.

### 2. Fresh PostgreSQL migration/integrity validation

Validate at minimum:

- generated FK/check/index/type names;
- PRIVATE/GROUP Source shape;
- cross-Source Entity/Alias/Record/Confirmation/LINE-edit/attachment rejection;
- PRIVATE Web-entry Source mismatch rejection;
- Grant/grant-scope attribution mismatch rejection;
- reservation/usage funding mismatch rejection;
- normal CRUD/revision/confirmation paths under constraints;
- Grant reserve/commit/release/expire/subsidy/concurrency state;
- customer/Admin final-held-point reserved reporting.

### 3. Entity/Alias case-insensitive collision behavior

Runtime matching uses case-insensitive matching while current declared uniqueness is case-sensitive. Reproduce on real PostgreSQL before choosing expression-index/normalization/collation behavior.

### 4. Run actual release validation

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- TypeScript typecheck, ESLint, Vitest, API/Web/Admin builds and Worker dry-run through that gate;
- PWA CRUD/version/group membership/Source-switch/session browser smoke;
- Admin plans/pricing calculator/AI pricing/Overview/Profitability/session browser smoke;
- LINE Login/one-time entry;
- PRIVATE/GROUP CREATE/HISTORY/Reply EDIT/confirmations;
- LINE TEXT cache + image/audio/file expiry/202/size flows;
- real Gemini pricing/usage/point settlement;
- Worker `/health` + `/health/ready`.

## P1 — source/UX cleanup before a polished free/AI launch

### 1. PWA version-conflict recovery

Backend correctly returns `RECORD_VERSION_CONFLICT` and prevents stale overwrite. PWA should still improve recovery so a stale edit/move/delete/restore/batch action:

- explains that another update won;
- reloads the latest Record/list state;
- closes or refreshes the stale editor instead of leaving the user with a raw error code.

This is the next PWA source patch once a safe local patch workflow is available.

### 2. LINE raw-first CREATE deferred-normalization messaging

`WorklogTextNormalizationService.normalizeText()` already distinguishes `NORMALIZED`, `PENDING_CONFIRMATION`, `DEFERRED`, `IN_PROGRESS`, `FAILED`, etc.

GROUP and PRIVATE runtimes still treat normalization as best-effort `void` and can reply as though the Record were fully organized even when the raw Record was saved but `entity_id` remains unresolved.

Next patch should preserve the raw-first/ledger state machine and only improve reply text, for example:

`原文已保存，AI 標題目前尚未完成，請稍後到 AFTERTRACE 查看或手動整理。`

Do not redesign reservation ownership for this UX fix.

### 3. Customer AI usage percentage/progress UI

Policy asks for used/remaining/total plus usage/remaining percentage/progress indicator. Current PWA shows point numbers and Grant rows but not a fully correct progress representation. Scope caps, expired Grants and lifetime usage must not be mixed into a misleading denominator.

### 4. Admin main navigation shortcuts

Standalone `/profitability` and `/pricing-calculator` routes exist. Main Admin navigation still needs convenient direct shortcuts; this is UX polish, not accounting or authorization debt.

## P2 — full paid MVP, separate from free/manual + AI-recording beta

1. Payment provider is intentionally not implemented yet.
2. Successful-payment durable facts / recurring renewal success/failure / idempotent payment webhooks remain unimplemented.
3. TOP_UP purchase/refund lifecycle remains unimplemented.
4. Paid Export remains `shipped:false`; no customer export endpoint/UI exists yet.
5. Proration / mid-period paid-plan change remains intentionally undefined and fail-closed.
6. Advanced profitability still lacks subscriber monthly average/median distribution, FREE->paid conversion and average real FREE subsidy/user; realized revenue/margin remains unavailable until a successful-payment ledger exists.

## Attachment coverage limitation

Active provider path supports image, audio, PDF and text-like files with bounded input/output handling. DOCX/XLSX/legacy Office MIME types remain explicitly `ATTACHMENT_UNSUPPORTED`; adding them requires a validated parser or provider-native document path.

## Next implementation target

If a real latest local checkout/toolchain becomes available, stop broad static refactoring and immediately:

1. regenerate baseline;
2. fix actual Drizzle/type errors;
3. pass baseline guard;
4. apply to fresh PostgreSQL;
5. execute integrity/concurrency probes;
6. initialize AI runtime config + FREE plan;
7. run `pnpm release:preflight`;
8. run customer/Admin/LINE/Gemini/Worker smoke.

If local execution remains unavailable, next safe source batch is the remaining P1 UX work, preferably through a patch-capable checkout rather than whole-file rewrites of large runtime/PWA files.

## Validation status

This run performed document/source audit plus direct GitHub source edits.

A local clone was retried after the required document read and failed with:

`Could not resolve host: github.com`

Therefore there was no usable checked-out project/toolchain.

Not executed:

- `pnpm install`;
- baseline regeneration/guard;
- `pnpm release:preflight`;
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

New pricing tests are source contracts only until actually executed. No test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, triggered or used as validation.

## Deployment status

**NOT READY yet.**

For the free/manual + AI-recording launch path, the remaining decisive blockers are migration generation, fresh PostgreSQL, real preflight and runtime smoke. The remaining P1 items are UX polish on top of already fail-closed data/accounting behavior.

## Rough remaining work

Assuming a current checkout/toolchain and disposable PostgreSQL become available:

- baseline regeneration + generated-schema/type fixes: **1 substantial batch**;
- fresh PostgreSQL/integrity/concurrency validation: **1 batch**;
- release preflight + browser/LINE/Gemini/Workers smoke: **1 validation batch**;
- remaining P1 UX cleanup: **1 smaller batch**;
- Payment/TOP_UP/Export/full paid lifecycle: **separate product/payment batches**.
