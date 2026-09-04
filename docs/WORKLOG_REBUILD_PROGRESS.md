# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run, in this order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

The latest documents above are the only product/development specification. Do not revive Customer/Project/Finance/Owner/aggregate-quota assumptions from legacy code, migrations, README history or old tests.

## Current execution checkpoint — 2026-09-04 remaining-work / fresh bug audit

This run re-read all eight durable documents and audited the latest `revive/line-worklog` branch for work that is still incomplete or could still produce launch-facing bugs. It did not redo completed Source/Entity/Record/PWA CRUD/LINE Reply EDIT/Grant accounting/Admin profitability/composite-FK work.

### Scanned this run

- current customer PWA state/race/session behavior;
- current Admin plan/pricing/profitability behavior;
- API readiness vs actual Gemini runtime constraints;
- current customer Help page and repository README for stale product claims;
- attachment supported formats/text limits;
- product/pricing policy gaps that are still genuinely unimplemented;
- deployment/migration checkpoint.

### Files changed this run

- `apps/api/src/admin/routes.ts`
- `apps/api/src/admin/routes.test.ts`
- `apps/api/src/index.ts`
- `apps/web/src/HelpRoot.tsx`
- `README.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Fixed / completed this run

### 1. Admin/runtime model mismatch no longer false-positives readiness

Shipped Gemini Worklog providers currently enforce exactly:

- provider `GOOGLE`;
- model `gemini-3.5-flash`.

Previously Admin could persist any non-empty provider/model and `/health/ready` would accept any non-empty value, while TEXT normalization, LINE AI EDIT and attachment runtime would later reject unsupported values with `GEMINI_CONFIG_INVALID` / provider errors.

Now:

- Admin AI-runtime input rejects unsupported provider/model before persistence;
- `/health/ready` requires the same shipped provider/model plus positive output reference price;
- route test source covers unsupported provider/model;
- the existing output-price test fixture now uses the actually supported model so it still tests the intended invariant.

This is intentionally a launch contract, not a decision that AFTERTRACE can never support another model. Expanding model/provider support later must update provider implementations, Admin validation and readiness together.

### 2. Customer `/help` stale product copy removed

`apps/web/src/HelpRoot.tsx` still described the retired product:

- Customer/Project/finance management;
- Group Owner;
- Owner subscription funding group AI;
- Owner disabling another member's recording permission;
- generic 5-day Reply-to-TEXT behavior that incorrectly implied PRIVATE ordinary text is cached.

Help now documents the accepted MVP:

- Source + 紀錄標題 + Record;
- free manual PWA CRUD/search/title move/batch move/recycle/history;
- GROUP-only temporary TEXT cache;
- PRIVATE ordinary text is not cached;
- attachment binaries are discarded after durable textual extraction;
- AI 額度負責人 + explicitly scoped user-owned Grant points;
- zero AI points disables AI compute only, never free manual PWA.

### 3. Repository README no longer revives the old world

README still claimed:

- FREE personal-only;
- paid/capability-driven group collaboration;
- stable group Owner;
- customers/projects/typed finance;
- aggregate quota;
- old `0000` baseline should remain.

README now points to the eight durable documents, describes the current Source/Entity/Record/Grant model and clearly marks the checked-in baseline as stale and unsafe to apply until regenerated.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- DB-level Source identity and cross-Source protection declarations;
- free PWA manual CRUD/search/filter/title move/batch move/delete/recycle/restore/revision history;
- GROUP manual authorization = active membership only;
- PWA optimistic version checks + stale Source/filter response generation guard;
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
- stale AI plan capability gates removed;
- bounded LINE attachment streaming/no permanent binaries;
- payment-disabled checkout fail-closed;
- Export capability fail-closed until implemented;
- safe baseline regeneration/guard scripts;
- release preflight + liveness/readiness split + first-fresh-DB bootstrap mode;
- explicit production migration database URL;
- Web/Admin Static Assets SPA fallback/deep-link deployment checks.

## Remaining work / known gaps

### P0 — blocks any real launch

1. **Regenerate Drizzle baseline/snapshot/journal.**
   - Current checked-in `drizzle/0000_worklog_baseline.sql` is still from the retired pre-rebuild world and MUST NOT be applied.
   - Run the pinned local toolchain: `pnpm db:baseline:regenerate --confirm-prelaunch-reset`, inspect generated artifacts, then `pnpm db:baseline:guard`.

2. **Fresh PostgreSQL migration/integrity validation.**
   - Validate generated composite FK/check/index declarations.
   - Probe malformed PRIVATE/GROUP Source writes, cross-Source Entity/Alias/Record/Confirmation/LINE-edit/attachment writes, PRIVATE Web-entry mismatch and Grant/scope/reservation funding mismatches.
   - Exercise Grant reserve/commit/release/expire/subsidy concurrency.

3. **Entity/Alias case-insensitive collision behavior remains unresolved.**
   - Runtime lookup uses case-insensitive matching while current declared uniqueness is case-sensitive.
   - Reproduce on real PostgreSQL before choosing an expression index/normalization/collation fix.

4. **Run the actual release gate and runtime smoke.**
   - `pnpm release:preflight`;
   - API/Web/Admin typecheck, ESLint, Vitest, builds/Worker dry-run through that gate;
   - customer browser CRUD/version/group-membership/Source-switch/session smoke;
   - Admin plan/pricing/Overview/Profitability/session smoke;
   - LINE Login/one-time entry;
   - PRIVATE/GROUP CREATE/HISTORY/Reply EDIT/confirmations;
   - LINE TEXT cache + image/audio/file expiry/202/size flows;
   - real Gemini pricing/usage/point settlement;
   - Worker `/health` + `/health/ready`.

### P1 — source/UX gaps that should be fixed before a polished free/AI launch

1. **PWA version-conflict UX is still too raw.**
   - Backend correctly returns `RECORD_VERSION_CONFLICT`.
   - PWA currently mainly surfaces the error string; accepted policy says stale saves should guide/reload the user to the latest Record instead of leaving an old editor as-is.

2. **Raw-first LINE TEXT CREATE can reply too optimistically.**
   - Raw Record persistence is safe.
   - If positive preflight later loses the final reservation race or normalization is deferred, Record can remain `entity_id = NULL` and PWA shows `待確認`.
   - LINE reply should eventually distinguish `原文已保存，標題尚待處理` from a fully normalized success. Do not redesign reservation ownership without runtime evidence.

3. **Customer AI usage percentage/progress UI is not complete.**
   - Policy asks for remaining/used/total plus usage/remaining percentage/progress indicator.
   - Current PWA shows point numbers and Grant rows, but not a complete percentage/progress presentation. Scope/cap/expired-Grant semantics must be handled correctly rather than dividing unrelated lifetime totals.

4. **Admin main navigation still lacks a direct `/profitability` shortcut.**
   - Report exists and is routed; this is navigation polish, not accounting debt.

### P2 — full paid MVP work, not required for a deliberately free/manual + AI-recording beta

1. **Payment provider is not implemented.**
   - Provider selection is intentionally not frozen.
   - Missing: real checkout, successful-payment facts, recurring renewal success/failure, idempotent payment webhooks, refund lifecycle and realized revenue ledger.

2. **TOP_UP purchase lifecycle is not implemented.**
   - Grant type/accounting foundation exists, but there is no complete purchase/provider/refund flow.

3. **Paid Export is not implemented.**
   - Product spec still calls Export MVP/initially paid.
   - Current capability is deliberately `shipped:false`; there is no customer export endpoint/UI yet.

4. **Proration / mid-period paid-plan change policy remains intentionally undefined.**
   - Current code safely rejects ambiguous active-period changes instead of inventing behavior.

5. **Admin pricing calculator is still missing.**
   - `WORKLOG_AI_POINT_POLICY.md` requires a calculator using price TWD + target gross margin + FX + model pricing to recommend included AI points, with explicit Admin confirmation before persistence.
   - Current Admin lets operators enter final plan points manually but does not calculate the recommendation.

6. **Advanced profitability metrics are incomplete.**
   - Base TODAY/7D/30D/BILLING_MONTH report, cost, points, subsidy, plan/grant/model/operation/source breakdown and Grant inventory exist.
   - Still missing or intentionally unavailable: monthly subscriber average/median distribution, FREE->paid conversion, average real FREE subsidy/user, and realized revenue/margin until a successful-payment ledger exists.

### Attachment format limitation

- Image, audio, PDF and text-like files have an active Gemini path with bounded input/output handling.
- DOCX/XLSX/legacy Office MIME types are currently explicitly `ATTACHMENT_UNSUPPORTED`; supporting them would need a validated parser/provider-native document path. This is an attachment coverage gap, not a data-integrity blocker for the formats already shipped.

## Next implementation target

If a real latest local checkout/toolchain is available, stop broad static refactoring and immediately:

1. regenerate baseline;
2. fix actual Drizzle/type errors;
3. pass baseline guard;
4. apply to fresh PostgreSQL;
5. execute integrity/concurrency probes;
6. initialize AI runtime config + FREE plan;
7. run `pnpm release:preflight`;
8. run browser/LINE/Gemini/Worker smoke.

If local execution remains unavailable, the best next source batch is P1 UX only: PWA version-conflict recovery + deferred LINE CREATE messaging. Do not start payment/export/proration implementation without the missing commercial/product decisions.

## Validation status

This run performed source/document audit and GitHub source edits only.

No usable checked-out local project/toolchain was available, so none of the authored/updated tests were executed.

**Not executed:**

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

No test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY yet.**

For the free/manual + AI-recording launch path, the remaining decisive blockers are now migration generation, PostgreSQL validation and real preflight/runtime smoke rather than another broad product refactor.

Full paid MVP additionally requires Payment + TOP_UP lifecycle + Export + pricing/revenue follow-up.

## Rough remaining work

- regenerated migration + actual schema/type fixes: **1 substantial batch**;
- fresh PostgreSQL/integrity/concurrency validation: **1 batch**;
- release preflight + customer/Admin/LINE/Gemini/Workers smoke: **1 validation batch**;
- P1 customer UX cleanup: **1 smaller batch**;
- Payment/TOP_UP/Export/full paid economics: **separate product/payment batches**.
