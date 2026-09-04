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

## Current execution checkpoint — 2026-09-04 final stale-contract + migration fail-closed batch

This batch continued from the completed Admin profitability checkpoint. It did not redo the Source/Record/PWA/LINE CREATE-HISTORY-EDIT/Grant/subscription-period/profitability implementations.

The main result is that the remaining known provider naming and concrete prelaunch stale-contract debt was removed from the execution paths that were traced, and migration/deployment is now explicitly fail-closed while the checked-in Drizzle baseline is stale.

Key changes:

- TEXT, attachment and Reply-targeted LINE AI EDIT provider contracts now call the conservative customer hold estimate `reservationPoints(...)`, not `reservationUnits(...)`;
- factual provider modality measurements `audioInputUnits` / `imageInputUnits` remain unchanged because they are provider usage facts, not customer AI points;
- the remaining LINE EDIT repository `WorklogAiUsageCommit` import now comes directly from `ai-provider-usage.ts`; `subscription.ts` no longer re-exports provider usage accounting;
- a stale webhook branch that still checked the retired `OWNER_BOUND` status was fixed to `AI_RESPONSIBILITY_BOUND`, and its counter is now `worklogAiResponsibilityClaims`;
- `worklog_source_members.recording_enabled` / recording updater timestamps/index were removed after tracing current manual GROUP authorization, LINE command handling, AI responsibility authorization, Grant authorization and Admin reporting and finding no accepted product behavior that reads them;
- `drizzle.config.ts` now uses `apps/api/src/db/schema-all.ts` as the single authoritative schema export instead of listing deleted/partial legacy schema modules;
- the checked-in `0000_worklog_baseline.sql` was confirmed to be concretely obsolete: it still contains Customer/Project/category/Transaction/pre-Grant reservation/`ai_units_consumed` structures;
- a new `pnpm db:baseline:guard` checks the baseline SQL, Drizzle snapshot and journal together and blocks known legacy markers or missing accepted core tables/accounting facts;
- `worker-deploy.ps1` runs the baseline guard before schema checks/migration, so the currently stale migration set cannot be silently applied through the production helper;
- API/Web/Admin deployment helpers no longer hard-code one `workers.dev` account subdomain; they require `AFTERTRACE_API_URL` or an explicit URL argument;
- deployment documentation now states that the current checked-in baseline/snapshot are known stale and MUST NOT be applied until regenerated from `schema-all.ts` with the real toolchain.

## Scanned this run

- all eight required durable product/development/deployment/progress documents;
- current `revive/line-worklog` branch state;
- TEXT normalization provider interface/service, Gemini implementation and related tests;
- attachment provider interface/service, Gemini implementation and ingestion tests;
- Reply-targeted LINE AI EDIT provider/service/repository imports and durable replay path;
- AI point ledger and Drizzle ledger imports;
- transitional `subscription.ts` compatibility barrel and usage domain;
- GROUP collaboration/manual membership authorization;
- bootstrap Source/member lifecycle;
- GROUP AI responsibility service + Drizzle authorization;
- LINE runtime and group webhook result/counter handling;
- customer Worklog routes for recording-state use;
- Admin base/grant repositories for recording-state use;
- Source/member and Record-core Drizzle schemas;
- `schema-all.ts` authoritative export surface and `drizzle.config.ts`;
- current `0000_worklog_baseline.sql`, `0000_snapshot.json` and journal metadata;
- API/Web/Admin deployment helpers and root package scripts/config example.

The targeted recording-state audit confirmed current behavior is driven by explicit Worklog command/Reply intent plus Source membership, AI responsibility and eligible Grants. The removed recording preference was not part of free manual PWA authorization and was not read by the traced AI responsibility/runtime/Admin paths.

## Files changed this run

Provider/accounting naming and direct-import cleanup:

- `apps/api/src/worklog/text-normalization.ts`
- `apps/api/src/worklog/gemini-text-normalizer.ts`
- `apps/api/src/worklog/attachment-ingestion.ts`
- `apps/api/src/worklog/gemini-attachment-normalizer.ts`
- `apps/api/src/worklog/line-record-edit.ts`
- `apps/api/src/worklog/gemini-line-record-editor.ts`
- `apps/api/src/worklog/drizzle-line-record-edit.ts`
- `apps/api/src/worklog/text-normalization.test.ts`
- `apps/api/src/worklog/text-normalization-persistence.test.ts`
- `apps/api/src/worklog/attachment-ingestion.test.ts`
- `apps/api/src/worklog/subscription.ts`

Stale Owner/recording cleanup:

- `apps/api/src/worklog/group-webhook.ts`
- `apps/api/src/worklog/group-webhook-ai-responsibility.test.ts` — new focused source test
- `apps/api/src/worklog/drizzle-bootstrap.ts`
- `apps/api/src/db/schema-worklog.ts`

Migration/deployment readiness guard:

- `drizzle.config.ts`
- `scripts/check-worklog-baseline.mjs` — new
- `package.json`
- `worker-deploy.ps1`
- `web-worker-deploy.ps1`
- `admin-worker-deploy.ps1`
- `.env.example`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / confirmed this run

### 1. Provider preflight naming now matches the customer accounting domain

The traced TEXT, attachment and LINE EDIT provider contracts/implementations now expose `reservationPoints(...)`.

This value is only a conservative preflight hold estimate. Actual successful customer consumption remains derived from the immutable provider-cost/pricing snapshot and settled into `customer_points_charged`; provider overrun remains platform subsidy.

Do not rename `audioInputUnits` or `imageInputUnits` to points. Those fields are provider modality usage subsets and are deliberately separate from customer accounting.

The old text reservation token-upper-bound helper remains named in token/upper-bound vocabulary because it describes provider/request estimation internals, not customer balance.

### 2. Provider usage no longer belongs to the subscription compatibility barrel

`subscription.ts` now exposes subscription-period lifecycle only. `WorklogAiUsageCommit` is imported directly from `ai-provider-usage.ts` in the traced execution/replay repositories, including LINE EDIT.

Do not add quota, provider usage, group collaboration or point reservation semantics back into `subscription.ts`.

### 3. Stale `OWNER_BOUND` webhook behavior was fixed

`line-runtime.ts` already returned `AI_RESPONSIBILITY_BOUND`, but `group-webhook.ts` still checked the retired `OWNER_BOUND` result and counted `worklogOwnerClaims`.

The webhook now handles `AI_RESPONSIBILITY_BOUND` and increments `worklogAiResponsibilityClaims`. A focused test source was added for this contract.

This was a concrete stale runtime contract, not merely terminology cleanup.

### 4. Retired GROUP recording preference was removed after tracing runtime use

The following member fields/index were removed from the current TypeScript schema:

- `recording_enabled`;
- `recording_updated_by_user_id`;
- `recording_updated_at`;
- the recording-oriented member index.

Bootstrap no longer writes a default `recording_enabled = TRUE` value.

Current accepted boundaries remain:

- manual GROUP data access = active Source membership;
- LINE AI work = explicit Worklog command/Reply flow;
- GROUP AI funding = current AI 額度負責人 + active membership + eligible user-owned Grant/scope;
- no legacy Owner/recording toggle is a data-access or AI-funding authority.

### 5. Drizzle generation source was corrected before baseline regeneration

The old `drizzle.config.ts` listed stale/deleted `schema-worklog-quota.ts` / `schema-worklog-bootstrap.ts` paths and omitted current split Record/Grant/LINE schema modules.

It now points only to:

`apps/api/src/db/schema-all.ts`

This must remain the authoritative Drizzle export surface so future schema splits cannot silently disappear from generated migrations.

### 6. The current baseline is explicitly known stale, not merely suspected stale

The checked-in `drizzle/0000_worklog_baseline.sql` still contains concrete retired structures including:

- `worklog_customers`;
- `worklog_projects` / project enum;
- `worklog_record_category`;
- Transaction enum/table assumptions;
- old `worklog_ai_reservation_status`;
- `worklog_ai_usage_events.ai_units_consumed`;
- legacy Record Customer/Project/workspace-shaped columns.

It therefore MUST NOT be applied to a database for the rebuilt product.

Do not hand-edit the SQL/snapshot to fake convergence. Regenerate all baseline metadata together from the final TypeScript schema with the real Drizzle toolchain.

### 7. Migration/deployment is fail-closed while artifacts are stale

New root command:

`pnpm db:baseline:guard`

checks both:

- `drizzle/0000_worklog_baseline.sql`;
- `drizzle/meta/0000_snapshot.json`;

for forbidden legacy markers and required accepted schema markers, and checks the prelaunch journal shape/tag as well.

The API deployment helper runs this guard before the migration command. The current stale baseline is expected to be rejected until proper regeneration occurs.

The guard itself was authored/reviewed statically in this environment; it has not been executed here.

### 8. Deployment URLs no longer embed an old Cloudflare account

`worker-deploy.ps1`, `web-worker-deploy.ps1` and `admin-worker-deploy.ps1` now require the actual API Worker origin through `AFTERTRACE_API_URL` or explicit script arguments rather than defaulting to one historical `workers.dev` account hostname.

`.env.example` and `WORKLOG_DEPLOYMENT.md` document this deployment-time input.

## Stable completed foundation from earlier batches

Do not redo unless an actual regression is found:

- Source + single Entity/title + Alias + Record + immutable Revision core;
- Customer/Project/Finance/Transaction/category/normalized-summary removed from customer Record core/UI/API;
- free manual PWA create/edit/search/title move/batch move/soft delete/recycle/restore/revision history;
- GROUP manual authorization = active membership, independent from subscription/AI points;
- GROUP Source existence independent from AI funding responsibility;
- old pending-group runtime/schema removed;
- bounded single-title/`occurred_at` Gemini CREATE interpretation;
- durable CREATE Pending Confirmation and safe PWA resolution;
- deterministic HISTORY -> Source-correct filtered PWA links;
- deterministic same-Source Reply target resolution;
- durable GROUP/PRIVATE Reply-targeted LINE AI EDIT provider pipeline;
- LINE_AI_EDIT durable proposal, optimistic Record version guard and immutable Revision;
- LINE_AI_EDIT Pending Confirmation current-vs-proposed PWA UX and no second AI charge;
- bot success-message -> Record Reply mapping;
- FREE initial Grant = exactly 400,000 AI points once, idempotent, no refresh/expiry;
- text and attachment provider execution use user-owned Grants/scopes/caps;
- full provider cost -> frozen output-price-equivalent AI points;
- customer balance floors at zero; provider overrun becomes platform subsidy;
- GROUP charged-user resolution via `worklog_source_ai_responsibility`;
- Grant-backed GROUP funding/allocation PWA;
- Grant-backed PRIVATE funding PWA;
- successful paid subscription period -> immutable/idempotent `SUBSCRIPTION_PERIOD` Grant with PRIVATE scope;
- plan template uses `subscription_period_points` / `subscriptionPeriodPoints`, not live aggregate allowance naming;
- persisted `worklog_ai_usage_events.ai_units_consumed` removed from current source and executable settlement SQL;
- provider durable usage JSON no longer contains/requires `actualUnits`;
- Admin user/group reporting based on Grants/responsibility/provider-cost facts;
- factual Admin profitability API/client/page for TODAY/7D/30D/BILLING_MONTH without synthetic revenue;
- attachment operations use deterministic `AUDIO_RECORD_CREATE` / `IMAGE_RECORD_CREATE` / `FILE_RECORD_CREATE`;
- retired `groupCollaboration`, `maxGroupCount`, aggregate entitlement/quota helper contracts removed from current entitlement/collaboration paths.

## Remaining / blocking work

### 1. Regenerate the final prelaunch Drizzle baseline/snapshot/journal — primary blocker

Use a real checked-out copy of the latest branch and the project-pinned pnpm/Drizzle toolchain.

Required outcome:

- destructively replace the stale prelaunch baseline/snapshot/journal with artifacts generated from `apps/api/src/db/schema-all.ts`;
- keep one coherent prelaunch baseline entry;
- `pnpm db:baseline:guard` passes;
- no Customer/Project/Transaction/category/aggregate-quota/recording compatibility is reintroduced merely to preserve empty databases.

Do not manufacture the large snapshot by hand.

### 2. Apply to a fresh disposable PostgreSQL database and fix real SQL/schema mismatches

After regeneration:

- apply the migration from an empty database;
- compare generated/exported schema to the TypeScript schema;
- fix actual FK/type/index/check/name mismatches;
- exercise Grant reservation/settlement/concurrency SQL and Record revision/confirmation SQL against PostgreSQL.

Only database execution can validate these SQL paths.

### 3. Real TypeScript/test/build/runtime validation remains mandatory

Run locally/runtime, not GitHub Actions:

- API/Web/Admin TypeScript typecheck;
- lint/build;
- Vitest, including point ledger, text normalization/replay uncertainty, attachment ingestion, LINE EDIT, group webhook AI-responsibility counter, subscription-period Grants and Admin profitability;
- customer PWA CRUD/version/revision/delete/restore and GROUP membership authorization;
- PRIVATE/GROUP Grant funding flows;
- Admin `/profitability` browser smoke;
- LINE CREATE/HISTORY/Reply EDIT + confirmation flows;
- Gemini/provider usage/pricing snapshots;
- Cloudflare Worker dry-run/runtime readiness.

### 4. Peripheral stale-contract audit becomes validation-driven

The major known provider/Owner/recording/migration-config remnants found by static tracing are now cleaned.

Do not spend another broad speculative pass deleting fields by name. Let TypeScript, generated schema, PostgreSQL and targeted runtime tests expose concrete remaining references. If a real stale contract appears, remove it then.

`worklog_workspaces.owner_user_id` intentionally remains a technical storage/bootstrap parent while `workspace_id` still exists in audit/provider/bootstrap structures. It is not GROUP authorization, payment responsibility or AI 額度負責人 authority. Removing it requires a coordinated later storage-schema migration and is not a launch blocker for current Source/member/Grant semantics.

### 5. Payment/TOP_UP lifecycle remains separate and undefined where product policy is not approved

The Grant model supports `TOP_UP`, but there is still no successful payment-provider accounting boundary.

Do not synthesize realized revenue, payment fees, refunds, proration, upgrade/downgrade rules or top-up margin from plan list price/current subscription state. These remain separate payment/product work unless launch scope explicitly requires them.

## Next implementation target

Continue from this exact checkpoint. Do not redo provider naming, recording-state deletion, Owner webhook status cleanup, Admin profitability, point accounting, PWA funding or completed Record/LINE behavior.

1. Obtain/use a real checked-out latest branch with the pinned project toolchain.
2. Regenerate `drizzle/0000_worklog_baseline.sql`, `drizzle/meta/0000_snapshot.json`, and `_journal.json` together from `schema-all.ts`.
3. Run `pnpm db:baseline:guard` and fix regeneration/config issues until it passes.
4. Apply the baseline to a fresh disposable PostgreSQL database; fix every real schema/SQL mismatch.
5. Run API/Web/Admin typecheck, lint/build and targeted/full Vitest locally/runtime.
6. Run browser/Worker/LINE/Gemini smoke as available. Only after these checks should workers.dev deployment readiness be reconsidered.

## Validation status

This batch performed static branch/document cross-file audit and direct GitHub source edits only.

Test source was added/updated, but **no test was executed in this environment**.

A direct local Git checkout/clone attempt could not resolve `github.com`, so a real checked-out project/toolchain was unavailable for this run. That prevented honest execution of pnpm, TypeScript, Vitest, Drizzle generation, PostgreSQL migration and Worker/browser runtime checks.

**Not executed:**

- `pnpm db:baseline:guard`;
- TypeScript typecheck;
- lint/build;
- Vitest;
- Drizzle generation/export/migrate;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker runtime/deploy;
- LINE runtime;
- Gemini runtime.

Therefore no test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.**

Core non-payment product implementation and the first factual Admin profitability surface are largely implemented, and the previously known small provider/stale-contract cleanup is now substantially closed.

The primary blockers are now explicit and operational:

1. regenerate the known-stale Drizzle baseline/snapshot/journal from the authoritative schema;
2. apply/validate on fresh PostgreSQL;
3. run real typecheck/test/build/browser/Worker/LINE/Gemini validation.

The production API helper now intentionally fails closed on a stale/inconsistent baseline instead of applying it.

## Rough remaining work

Planning-only estimate from current branch state:

- core non-payment product/source cleanup: **largely implemented; major known stale-contract cleanup completed**;
- Drizzle regeneration + disposable PostgreSQL mismatch fixes: **1 mandatory schema/database batch**;
- API/Web/Admin typecheck/Vitest/browser/Worker/LINE/Gemini validation and fixes found there: **1 mandatory validation batch, possibly more if runtime exposes defects**;
- real payment/TOP_UP plus undefined proration/refund/payment accounting policy: **separate product/payment work** unless launch scope explicitly requires it.
