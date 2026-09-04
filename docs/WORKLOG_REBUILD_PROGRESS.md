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

## Current execution checkpoint — 2026-09-04 launch UX fixes + attachment title blocker audit

This run continued from the Admin pricing-calculator checkpoint and focused only on launch-facing gaps that could be proven from current source. It did not redo completed Source/Entity/Record/PWA CRUD/Grant accounting/Admin profitability/composite-FK work.

## Scanned this run

- all eight required durable documents in exact required order;
- latest `revive/line-worklog` branch/checkpoint;
- PWA shared API response/error handling and optimistic version-conflict behavior;
- GROUP and PRIVATE LINE raw-first TEXT CREATE normalization result handling;
- text-normalization result/state contract;
- GROUP and PRIVATE attachment success path;
- attachment provider output, durable Record persistence and Worker runtime wiring;
- `DrizzleWorklogTextNormalizationRepository` eligibility/context loading;
- current readiness provider/model contract;
- GROUP/PRIVATE runtime test sources.

## Files changed this run

Customer Web:

- `apps/web/src/worklog-api.ts`

LINE runtime:

- `apps/api/src/worklog/line-runtime.ts`
- `apps/api/src/worklog/oa-runtime.ts`
- `apps/api/src/worklog/line-runtime.test.ts`
- `apps/api/src/worklog/oa-runtime.test.ts`

Durable handoff:

- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. PWA stale Record mutations now recover instead of leaving a stale editor

The backend already correctly rejects stale edit/move/delete/restore/batch mutations with `RECORD_VERSION_CONFLICT`, but the PWA previously surfaced the raw error while leaving stale UI state in place.

The shared customer API response parser now handles only the exact HTTP 409 `RECORD_VERSION_CONFLICT` case by:

- telling the user another update already won;
- reloading the current page so the latest Record/list/version is fetched;
- preserving the backend's fail-closed optimistic-concurrency rule.

This applies consistently to edit, move, delete, restore and batch move without duplicating recovery logic across the large PWA component.

401 Web-session recovery remains separate; 403 authorization errors and unrelated 409/5xx responses do not trigger this reload behavior.

### 2. PRIVATE LINE TEXT CREATE no longer claims full organization when title normalization is incomplete

PRIVATE raw-first CREATE still persists the user's original text before AI title/time interpretation.

The runtime now consumes the actual `WorklogTextNormalizationResult` instead of discarding it:

- `NORMALIZED` / `ALREADY_NORMALIZED` -> ordinary success reply;
- `PENDING_CONFIRMATION` -> says raw text is saved and asks the user to finish title confirmation in AFTERTRACE;
- `IN_PROGRESS` -> says raw text is saved and title processing is still running;
- `DEFERRED`, `FAILED`, `NOT_ELIGIBLE`, skipped/exception/no normalizer -> says raw text is saved but the AI title is not finished and manual PWA organization remains available.

No provider, reservation, settlement or Record persistence state machine was changed.

### 3. GROUP LINE TEXT CREATE and cached Reply-to-TEXT use the same truthful normalization reply contract

GROUP direct CREATE and GROUP cached Reply-to-TEXT now use the same result-aware reply behavior as PRIVATE.

A Record that is durable but still has unresolved title interpretation is no longer presented to the LINE user as though title organization definitely completed.

Focused source tests now cover deferred-normalization user messaging for both PRIVATE and GROUP. These tests were authored/updated but were not executed in this environment.

## New P0 source blocker discovered — attachment Records never enter title/time normalization

This run traced the complete active attachment path and found a real functional gap:

1. `GeminiWorklogAttachmentNormalizer` returns durable extracted/transcribed `raw_text` plus input-type metadata only.
2. `DrizzleWorklogAttachmentRepository.persistRecordCreated()` creates the attachment Record with `entity_id = NULL` and the command/source timestamp.
3. `WorklogAttachmentIngestionService` settles the attachment provider call and returns `RECORDED`.
4. GROUP/OA attachment branches return that result directly.
5. No post-attachment title/time normalization is invoked.

Therefore a newly created AUDIO / IMAGE / PDF / text-file Record currently remains permanently `待確認` unless the user manually moves it to a title.

The accepted product contract says AI-assisted attachment ingestion may determine the same single Record title and `occurred_at` under the normal title parsing rules, so this is a launch-facing functional blocker rather than optional polish.

### Safe reuse path identified

The existing title/time normalization repository already has the correct:

- Source-scoped title/Alias matching;
- fuzzy ambiguity confirmation;
- durable confirmation flow;
- GROUP AI responsible-user lookup;
- PRIVATE charged-user lookup;
- provider usage/point settlement;
- version/entity safety checks.

The only explicit eligibility blocker found is currently:

`record.input_type = 'TEXT'`

in `DrizzleWorklogTextNormalizationRepository.loadContext()`.

A follow-up source patch should generalize that eligibility to the durable Record input types (`TEXT`, `AUDIO`, `IMAGE`, `FILE`) and invoke the existing title/time normalization after successful **new** attachment persistence. The normalization usage operation should also be renamed from the misleading hard-coded `TEXT_RECORD_CREATE` to a neutral title-normalization operation so attachment follow-up cost is not misclassified.

Do not create a second title/Alias resolver or bypass Pending Confirmation merely for attachments.

The likely initial implementation uses two provider calls for an attachment:

- provider call 1: binary -> durable textual Record;
- provider call 2: durable text -> single title / event time.

Each call must retain its own actual provider usage and Grant-ledger settlement. This is more expensive than a future combined provider call but preserves the current auditable accounting and title-resolution invariants. A later optimization may combine the calls only with explicit equivalent usage/accounting tests.

This repository change was **not** attempted through a risky whole-file GitHub contents rewrite in this environment because the DB repository is large and no local typecheck/runtime checkout is available.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- DB-level Source identity and declared cross-Source protection;
- free PWA manual CRUD/search/filter/title move/batch move/delete/recycle/restore/revision history;
- GROUP manual authorization = active membership only;
- optimistic Record version checks plus PWA stale-conflict recovery and stale Source/filter generation guard;
- deterministic LINE HISTORY -> filtered PWA deep links;
- deterministic Reply-targeted PRIVATE/GROUP LINE AI EDIT;
- truthful raw-first TEXT normalization status replies;
- FREE 400,000 one-time user Grant;
- user-owned Grant scopes/caps + separate GROUP AI 額度負責人;
- positive-balance preflight + final atomic reservation;
- provider actual cost -> output-price-equivalent points + platform subsidy;
- immutable/idempotent subscription-period Grants;
- retired aggregate quota / `ai_units_consumed` / `actualUnits` removed from active accounting;
- Admin factual profitability base report;
- Admin separate audio/image pricing, FREE shell invariants, missing-TWD coverage, strong session/password handling;
- Admin/runtime/readiness agree on currently shipped `GOOGLE + gemini-3.5-flash` contract;
- Admin pricing recommendation calculator;
- stale AI plan capability gates removed;
- customer Help and README use the current Source/Grant/AI-responsibility model;
- bounded LINE attachment streaming/no permanent binaries;
- payment-disabled checkout fail-closed;
- Export capability fail-closed until implemented;
- safe baseline regeneration/guard scripts;
- release preflight + liveness/readiness split + first-fresh-DB bootstrap mode;
- explicit production migration database URL;
- Web/Admin Static Assets SPA fallback/deep-link deployment checks.

## P0 — blocks free/manual + AI-recording production launch

### 1. Complete attachment Record title/time normalization — newly confirmed source blocker

Generalize the existing normalization pipeline to AUDIO/IMAGE/FILE durable text and invoke it after successful new attachment ingestion. Preserve the two-call cost/accounting facts until a separately validated one-call optimization exists.

### 2. Regenerate Drizzle baseline/snapshot/journal

The checked-in `drizzle/0000_worklog_baseline.sql` is still from the retired pre-rebuild world and MUST NOT be applied.

From a real current checkout:

1. `pnpm install --frozen-lockfile`
2. verify pinned `pnpm --version`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. fix actual TypeScript/Drizzle errors exposed by current composite FK/check declarations
6. `pnpm db:baseline:guard` until green

Do not hand-fabricate Drizzle metadata.

### 3. Fresh PostgreSQL migration/integrity validation

Validate at minimum:

- generated FK/check/index/type names;
- PRIVATE/GROUP Source shape;
- cross-Source Entity/Alias/Record/Confirmation/LINE-edit/attachment rejection;
- PRIVATE Web-entry Source mismatch rejection;
- Grant/grant-scope attribution mismatch rejection;
- reservation/usage funding mismatch rejection;
- normal CRUD/revision/confirmation paths under constraints;
- Grant reserve/commit/release/expire/subsidy/concurrency state;
- attachment extract -> title-normalization sequence and accounting;
- customer/Admin final-held-point reserved reporting.

### 4. Entity/Alias case-insensitive collision behavior

Runtime matching uses case-insensitive matching while current declared uniqueness is case-sensitive. Reproduce on real PostgreSQL before choosing expression-index/normalization/collation behavior.

### 5. Run actual release validation

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- TypeScript typecheck, ESLint, Vitest, API/Web/Admin builds and Worker dry-run through that gate;
- PWA CRUD/version/group membership/Source-switch/session browser smoke;
- Admin plans/pricing calculator/AI pricing/Overview/Profitability/session browser smoke;
- LINE Login/one-time entry;
- PRIVATE/GROUP TEXT CREATE/HISTORY/Reply EDIT/confirmations;
- attachment image/audio/PDF/text-file extraction + title/time resolution + expiry/202/size flows;
- real Gemini pricing/usage/point settlement;
- Worker `/health` + `/health/ready`.

## P1 — useful polish after P0

### 1. Customer AI usage percentage/progress UI

Policy asks for used/remaining/total plus usage/remaining percentage/progress indicator. Current PWA shows point numbers and Grant rows but not a fully correct progress representation. Scope caps, expired Grants and lifetime usage must not be mixed into a misleading denominator.

### 2. Admin main navigation shortcuts

Standalone `/profitability` and `/pricing-calculator` routes exist. Main Admin navigation can still add convenient direct shortcuts; this is UX polish, not accounting or authorization debt.

## P2 — full paid MVP, separate from free/manual + AI-recording beta

1. Payment provider is intentionally not implemented yet.
2. Successful-payment durable facts / recurring renewal success/failure / idempotent payment webhooks remain unimplemented.
3. TOP_UP purchase/refund lifecycle remains unimplemented.
4. Paid Export remains `shipped:false`; no customer export endpoint/UI exists yet.
5. Proration / mid-period paid-plan change remains intentionally undefined and fail-closed.
6. Advanced profitability still lacks subscriber monthly average/median distribution, FREE->paid conversion and average real FREE subsidy/user; realized revenue/margin remains unavailable until a successful-payment ledger exists.

## Attachment coverage limitation

Active provider path supports image, audio, PDF and text-like files with bounded input/output handling. DOCX/XLSX/legacy Office MIME types remain explicitly `ATTACHMENT_UNSUPPORTED`; this is a clear fail-closed limitation, not silent data corruption.

## Next implementation target

Highest priority next run:

1. finish attachment title/time normalization reuse;
2. obtain/use a real latest checkout with pinned pnpm/Drizzle;
3. regenerate baseline immediately;
4. fix actual TypeScript/Drizzle errors from the current schema;
5. pass baseline guard;
6. apply to fresh PostgreSQL and execute integrity/concurrency probes;
7. initialize AI runtime config + FREE plan;
8. run `pnpm release:preflight`;
9. run customer/Admin/LINE/Gemini/Worker smoke.

Do not broaden into speculative redesign before these launch blockers are closed.

## Validation status

This run performed document/source audit plus direct GitHub source edits only.

No usable current local checkout/toolchain became available in this environment.

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

Updated runtime tests are source contracts only until actually executed. No test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, triggered or used as validation.

## Deployment status

**NOT READY yet.**

The source-level launch blocker list is now small and explicit: attachment title/time normalization, regenerated migration artifacts, fresh PostgreSQL validation, Entity/Alias collision decision, then real release/runtime smoke.

## Rough remaining work

Assuming a current checkout/toolchain and disposable PostgreSQL become available:

- attachment title/time normalization reuse + focused tests: **1 smaller source batch**;
- baseline regeneration + generated-schema/type fixes: **1 substantial batch**;
- fresh PostgreSQL/integrity/concurrency validation: **1 batch**;
- release preflight + customer/Admin/LINE/Gemini/Workers smoke: **1 validation batch**;
- Payment/TOP_UP/Export/full paid lifecycle: **separate product/payment batches**.
