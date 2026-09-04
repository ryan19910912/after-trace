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

## Current execution checkpoint — 2026-09-04 Source/Grant DB integrity + attachment quota cleanup

This batch continued directly from the release-readiness checkpoint. It did **not** redo completed PWA optimistic concurrency, LINE CREATE/HISTORY/Reply EDIT, Grant settlement/accounting, Admin profitability, release preflight, readiness or SPA deep-link work.

The run attempted to move into the primary remaining blocker (regenerate baseline -> fresh PostgreSQL -> local preflight), but the execution environment still could not clone the private repository because DNS resolution for `github.com` failed. No local pnpm/Drizzle/PostgreSQL/runtime validation was therefore possible.

Instead of stopping at the environment limitation, this batch performed a deeper static audit of the authoritative Drizzle export surface and launch gates. It found one concrete stale aggregate-quota schema import that would have broken TypeScript/Drizzle generation, plus several Source/Grant attribution relationships that were checked in application SQL but not enforced by PostgreSQL.

## Scanned this run

- all eight required durable product/development/deployment/progress documents;
- latest `revive/line-worklog` branch before each write;
- `scripts/release-preflight.mjs`, baseline guard/regeneration and deployment readiness contracts;
- `apps/api/src/index.ts` launch config/origin readiness behavior;
- full `apps/api/src/db/schema-all.ts` export surface and current DB schema modules;
- Source/workspace/bootstrap ownership behavior;
- Record/Entity/Alias/Revision/Pending Confirmation schema relationships;
- LINE AI edit durable schema;
- AI Grant/scope/reservation/funding schema and reservation/settlement SQL;
- attachment ingestion schema, service and Drizzle repository;
- Web auth nonce schema/repository and PRIVATE access revalidation;
- checkout/subscription schema for legacy Owner/group-paid-gate drift;
- current checked-in `drizzle/0000_worklog_baseline.sql` beginning.

## Files changed this run

Release/readiness:

- `scripts/release-preflight.mjs`
- `apps/api/src/index.ts`
- `apps/api/src/index-readiness.test.ts`

Database integrity / stale quota cleanup:

- `apps/api/src/db/schema-worklog.ts`
- `apps/api/src/db/schema-worklog-record-core.ts`
- `apps/api/src/db/schema-worklog-web-auth.ts`
- `apps/api/src/db/schema-worklog-grants.ts`
- `apps/api/src/db/schema-worklog-line-edit.ts`
- `apps/api/src/db/schema-worklog-attachment.ts`
- `scripts/check-worklog-baseline.mjs`

Durable docs:

- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

## Completed / fixed this run

### 1. Release preflight now enforces the pinned pnpm version

`pnpm release:preflight` previously assumed the developer was using the pinned package manager but did not verify it.

It now:

- reads root `package.json` `packageManager`;
- requires a `pnpm@<version>` pin;
- executes `pnpm --version`;
- fails before release validation if the executable version differs.

This prevents a different pnpm from silently interpreting the lockfile/release workspace.

### 2. Launch readiness now rejects malformed/mismatched production origins

`GET /health/ready` now requires production-facing origins to be exact HTTPS origins:

- no username/password;
- no non-root path;
- no query;
- no hash.

`WEB_APP_URL` and `WEB_APP_ORIGIN` must resolve to the same origin. A mismatch marks launch config incomplete before database access.

Focused test source was added for mismatched Web origins and path/query/credential rejection. It was **not executed** in this environment.

### 3. Source identity shape is now a PostgreSQL invariant

`worklog_sources` previously allowed structurally invalid rows such as a PRIVATE Source with a LINE group id or a GROUP Source without one.

The schema now requires exactly one accepted identity shape:

- PRIVATE -> `private_user_id IS NOT NULL` and `line_group_id IS NULL`;
- GROUP -> `private_user_id IS NULL` and `line_group_id IS NOT NULL`.

The transitional `workspace_id`/workspace owner remains storage-only. GROUP manual authorization still comes from active membership and GROUP AI funding still comes from AI responsibility + user-owned Grants.

### 4. Record/title/confirmation Source isolation is enforced by composite foreign keys

Application code already scoped these operations, but the DB could previously persist cross-Source references if a future caller missed a check.

The schema now makes these invalid at PostgreSQL level:

- Alias -> Entity from another Source;
- Record -> title Entity from another Source;
- Pending Confirmation -> Record from another Source;
- Pending Confirmation -> candidate Entity from another Source;
- LINE AI edit -> target Record from another Source;
- LINE AI edit -> Pending Confirmation from another Source;
- LINE AI edit -> applied Entity from another Source;
- attachment ingestion -> created Record from another Source.

Composite unique keys needed by these FKs are explicitly declared on Source-scoped parent identities.

### 5. PRIVATE Web-entry nonce cannot bind a user to somebody else's PRIVATE Source

The Web auth repository already revalidated OA friendship, PRIVATE Source ownership and active status on register/consume.

The schema now additionally enforces `(user_id, source_id)` against `(worklog_sources.private_user_id, worklog_sources.id)`. Invalid token state cannot be inserted even by a future code path that skips the repository's runtime join.

### 6. Grant funding attribution cannot pair a Grant with another Grant's scope

Reservation funding and usage funding both persist `grant_id` and `grant_scope_id`. Normal point-ledger SQL derives both from the same joined Grant/Scope, but the old schema did not enforce that relationship.

The schema now provides a composite `(grant_id, id)` key for Grant scopes and composite FKs for:

- `worklog_ai_point_reservation_funding`;
- `worklog_ai_usage_funding`.

A funding row can no longer attribute Grant A usage to a scope owned by Grant B.

### 7. LINE edit and attachment AI reservations are Source-bound

`worklog_ai_point_reservations` now exposes a unique `(source_id, token)` key.

LINE AI edit and attachment ingestion now reference reservations through composite `(source_id, reservation_token)` foreign keys. A reservation created for Source A cannot be attached to Source B orchestration state.

### 8. Critical stale aggregate-quota attachment schema import was removed

A concrete blocker was found in `apps/api/src/db/schema-worklog-attachment.ts`:

- `schema-all.ts` exports the attachment schema;
- the attachment schema still imported `./schema-worklog-quota` and `worklogAiQuotaReservations`;
- `schema-worklog-quota.ts` no longer exists on this branch;
- attachment runtime/repository code already uses the new Grant-backed point ledger and `worklog_ai_point_reservations`.

The attachment schema now references `worklogAiPointReservations` from `schema-worklog-grants` and no longer depends on the deleted aggregate-quota module.

This was a real stale-domain/typecheck/Drizzle-generation blocker that previous cleanup had missed.

### 9. Baseline guard now requires the launch integrity constraints

`scripts/check-worklog-baseline.mjs` now rejects regenerated SQL/snapshot unless they contain the accepted Source/Grant constraints, including:

- Source identity shape;
- PRIVATE Web-entry user/Source binding;
- Source-scoped Entity/Record/Confirmation/LINE-edit/attachment relationships;
- Source-scoped reservation attribution for LINE edit/attachment;
- Grant/scope funding integrity.

It also explicitly forbids `worklog_ai_quota` markers in addition to the existing Customer/Project/Transaction/category/old reservation/aggregate usage markers.

The goal is that a future successful regeneration cannot silently produce a structurally weaker baseline than the TypeScript product model.

## Stable completed foundation

Do not redo unless a concrete regression appears:

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- Customer/Project/Transaction/Finance/category/normalized-summary removed from customer Record core;
- free PWA manual create/edit/search/title move/batch move/delete/recycle/restore/revision history;
- PRIVATE manual authorization by private Source and GROUP manual authorization by active membership only;
- PWA route-level early optimistic-version checks before no-op/title side effects plus DB version predicates;
- deterministic HISTORY -> filtered authenticated PWA deep links;
- deterministic same-Source Reply target + PRIVATE/GROUP LINE AI EDIT pipeline;
- title/Alias ambiguity confirmation without second AI charge;
- FREE 400,000-point one-time Grant;
- user-owned Grants/scopes/caps + GROUP AI 額度負責人 separation;
- provider full cost -> frozen output-price-equivalent AI points;
- customer point floor + platform subsidy;
- immutable/idempotent subscription-period Grants;
- factual Admin profitability and committed-used/reserved/remaining inventory separation;
- old `ai_units_consumed`/aggregate quota live-balance/provider `actualUnits` paths removed from active runtime contract;
- old `OWNER_BOUND`, Source Owner funding, `groupCollaboration`, `maxGroupCount`, GROUP recording preference removed from current execution contract;
- safe fail-closed baseline regeneration/guard;
- local `release:preflight` gate;
- API liveness/readiness split;
- Web/Admin Workers SPA deep-link post-deploy checks;
- no hard-coded workers.dev account hostname.

## Current hard blocker — checked-in baseline is still stale

The checked-in `drizzle/0000_worklog_baseline.sql` was re-read again this run and still begins with retired structures such as:

- `worklog_project_status`;
- `worklog_record_category`;
- `worklog_transaction_type`;
- old `worklog_ai_reservation_status`.

Earlier portions also contain stale aggregate usage structures. Therefore these checked-in migration artifacts **MUST NOT be applied**.

The new TypeScript schema has also changed further in this batch, so the final baseline must be regenerated from the latest `schema-all.ts`; do not hand-edit the old SQL/snapshot to add the new constraints.

## Remaining / blocking work

### 1. Regenerate the baseline/snapshot/journal with the real project toolchain — primary blocker

From a real latest checkout:

1. `pnpm install --frozen-lockfile`
2. confirm `pnpm --version` matches root `packageManager`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. if guard fails, inspect the intentionally kept generated artifacts, fix the real schema mismatch and regenerate
6. run `pnpm db:baseline:guard` until green

Do not fabricate Drizzle metadata or bypass missing integrity constraints.

### 2. Fresh PostgreSQL migration/invariant validation

Apply the guard-passing baseline to a fresh disposable PostgreSQL database and validate:

- all FK/index/check/type names generated as expected;
- Source identity shape rejects malformed PRIVATE/GROUP rows;
- cross-Source Record/Entity/Alias/Confirmation/LINE-edit/attachment writes are rejected;
- PRIVATE Web entry user/source mismatch is rejected;
- Source/reservation mismatch is rejected for LINE edit/attachment;
- Grant/grant-scope funding mismatch is rejected;
- Record revision/confirmation/move SQL still works under the stronger constraints;
- Grant reservation/commit/release/expiry/subsidy/concurrency invariants still hold.

### 3. Entity/Alias case-insensitive collision behavior

Manual resolution compares titles/Aliases using `lower(...)`, while DB name/alias uniqueness remains case-sensitive. Reproduce this on real PostgreSQL before choosing a collation/expression-index/normalization fix. Do not guess this policy from static source alone.

### 4. Optional post-baseline hardening: normalization reservation Source binding

Text-normalization orchestration is keyed by `record_id`; runtime loads the Record's Source and obtains a Source-scoped point reservation, but the normalization table itself does not currently store `source_id`, so PostgreSQL cannot express a composite Record/Source + reservation/Source FK like LINE edit/attachment now do.

This is not currently a known runtime bug. After fresh PostgreSQL/typecheck validation, consider adding a durable `source_id` only if the extra invariant is worth the schema/runtime change. Do not block the first regeneration solely on this optional hardening item.

### 5. Real local/runtime validation remains mandatory

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- API/Web/Admin typecheck, lint, Vitest, production builds/Worker dry-run through that command;
- customer PWA CRUD/search/move/delete/restore/version browser/API smoke;
- Admin auth + `/profitability` smoke;
- LINE CREATE/HISTORY/Reply EDIT/confirmation/attachment flows;
- real Gemini usage/pricing/point settlement;
- API `/health` + `/health/ready` and Web/Admin deep links;
- final workers.dev deployment helpers.

### 6. Payment/TOP_UP remains separate payment/product work

Payment provider is still undecided. Do not invent revenue/refund/proration/upgrade/downgrade behavior merely to make this branch appear launch-complete. Whether paid checkout is required for first public launch remains a separate product scope decision.

## Next implementation target

Continue from this exact checkpoint. Do not redo the DB integrity constraints, attachment quota cleanup, readiness, preflight or PWA stale-version ordering.

Highest priority next run:

1. retry obtaining/using a latest local checkout;
2. immediately run safe baseline regeneration with the pinned toolchain;
3. fix any **actual Drizzle/typecheck errors caused by the new composite FKs/check constraints**;
4. pass the baseline guard;
5. apply to fresh PostgreSQL and execute invalid-write integrity probes plus normal Record/Grant SQL paths;
6. run `pnpm release:preflight`;
7. only then continue browser/LINE/Gemini/Workers runtime smoke.

If local execution remains unavailable, continue static auditing only for clear launch blockers; do not broaden into speculative product redesign.

## Validation status

This run performed direct GitHub source/document audit and edits plus an external documentation sanity check of Drizzle's current multi-column `foreignKey({ columns, foreignColumns, name })` API shape.

A local clone was attempted again in this run and failed with DNS resolution for `github.com`. Therefore no checked-out project/toolchain was available.

**Not executed:**

- `pnpm install`;
- `pnpm db:baseline:regenerate`;
- `pnpm db:baseline:guard`;
- `pnpm release:preflight`;
- TypeScript typecheck;
- ESLint;
- Vitest;
- API/Web/Admin builds;
- Drizzle generate/export/migrate;
- PostgreSQL;
- browser/PWA/Admin runtime;
- Cloudflare Worker dry-run/runtime/deploy;
- LINE runtime;
- Gemini runtime.

The new tests and schema declarations are source-level changes only until a real toolchain executes them.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, or used as validation.

## Deployment status

**NOT READY.**

Implementation is closer to a trustworthy release gate because this batch removed a real stale aggregate-quota schema dependency and moved important Source/Grant relationships into DB-enforced invariants. The checked-in migration artifacts are still known stale, however, and none of the new schema has yet been generated/applied/typechecked against the real toolchain.

## Rough remaining work

Planning-only estimate, assuming the next environment has the repo/toolchain and a disposable PostgreSQL database:

- baseline regeneration + fix any Drizzle composite-FK/schema-generation issues: **1 focused batch**;
- fresh PostgreSQL migration + integrity/concurrency validation: **1 focused batch**;
- local release preflight + browser/LINE/Gemini/Worker smoke: **1 focused validation batch**;
- payment provider/TOP_UP/refund/proration lifecycle: separate work unless explicitly included in first-launch scope.
