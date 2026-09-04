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

## Current execution checkpoint — 2026-09-04 attachment title/time normalization source completion

This run re-read all eight required documents in exact order and continued from the launch-UX/attachment-blocker checkpoint. It did not redo completed Source/Entity/Record/PWA CRUD/Grant accounting/Admin profitability work.

## Scanned this run

- latest `revive/line-worklog` branch/checkpoint;
- active attachment extraction/persistence/runtime wiring;
- durable text normalization state machine and replay behavior;
- GROUP/PRIVATE charged-user derivation;
- point-ledger reserve/commit/release contract;
- attachment duplicate/idempotent recovery;
- usage-operation attribution for Admin profitability;
- Worker runtime construction.

## Files changed this run

- `apps/api/src/worklog/drizzle-record-normalization-adapter.ts` — new;
- `apps/api/src/worklog/record-normalization-ai-points.ts` — new;
- `apps/api/src/worklog/attachment-title-normalization.ts` — new;
- `apps/api/src/worklog/attachment-title-normalization.test.ts` — new source tests;
- `apps/api/src/worklog/attachment-runtime.ts`;
- `apps/api/src/worker.ts`;
- this file.

## Completed / fixed this run

### 1. Attachment Records now enter the existing title/time normalization pipeline

The previous production path stopped after:

`LINE binary -> Gemini durable text -> Record(entity_id = NULL)`

AUDIO / IMAGE / FILE Records therefore remained permanently `待確認` unless manually moved.

Production Worker wiring now wraps `WorklogAttachmentIngestionService` with `WorklogAttachmentTitleNormalizationService`.

After durable attachment ingestion returns a Record, the wrapper re-enters the existing `WorklogTextNormalizationService` so attachment Records receive the same:

- single title selection;
- Source-scoped Entity/Alias matching;
- fuzzy ambiguity detection;
- durable Pending Confirmation;
- `occurred_at` resolution;
- version/entity safety checks;
- Grant-backed provider accounting.

No second Entity resolver was introduced.

### 2. Attachment eligibility is added without rewriting the large established repository

`DrizzleWorklogRecordNormalizationRepository` is an adapter around the existing `DrizzleWorklogTextNormalizationRepository`.

- TEXT continues through the original repository unchanged.
- AUDIO / IMAGE / FILE get the same normalization claim/state behavior with attachment-specific context loading.
- Entity/Alias resolution, confirmation creation, apply-result logic and persisted provider-result parsing remain delegated to the established repository.

GROUP attachment normalization resolves the current AI 額度負責人 and requires that responsible user to remain an active member. PRIVATE attachment normalization charges the PRIVATE user. Final provider execution still requires a real Grant-ledger reservation.

### 3. Durable replay remains fail-closed and idempotent

Attachment normalization retries do not blindly issue another provider call.

The adapter handles only attachment first-claim / `PENDING` eligibility itself. Existing `PROCESSING`, `PROVIDER_SUCCEEDED`, `USAGE_COMMITTED`, `SUCCEEDED` and `FAILED` states are handed back to the established repository's durable replay parser/state machine.

`WorklogAttachmentTitleNormalizationService` also re-enters normalization when attachment ingestion returns an idempotent duplicate. This is intentional: if a Worker died after durable attachment extraction but before title normalization started, a retry can resume the title stage. An already-completed normalization returns `ALREADY_NORMALIZED` and does not re-run provider AI.

### 4. Attachment title-normalization cost is no longer misclassified as TEXT Record creation

The existing normalization service internally labels its usage `TEXT_RECORD_CREATE`.

For attachment Records, both:

- durable provider-result usage persisted by the adapter; and
- immediate Grant-ledger commit through `RecordNormalizationAiPointPort`

rewrite the operation to:

`RECORD_TITLE_NORMALIZATION`

This keeps the first provider call (`AUDIO_RECORD_CREATE`, `IMAGE_RECORD_CREATE`, `FILE_RECORD_CREATE`) separate from the second title/time call in Admin accounting.

### 5. The attachment path intentionally remains two auditable provider calls for now

Current initial implementation is:

1. binary -> durable textual Record;
2. durable text -> title / event time.

Each call keeps its own provider usage/cost and customer-point settlement. This is more expensive than a future combined structured-output attachment call, but it preserves existing title/Alias/Pending Confirmation and accounting invariants. Do not combine the calls without explicit equivalent usage/idempotency/accounting tests.

If title normalization fails after durable attachment text was already stored, the wrapper does not delete the Record or refetch the binary. The Record remains available in PWA for manual organization.

### 6. Focused attachment chaining tests were authored

Source tests cover:

- new attachment -> title normalization;
- duplicate attachment retry -> idempotent normalization re-entry;
- no normalization before attachment persistence reaches `RECORDED`;
- durable attachment success survives a title-normalization exception.

These tests were not executed in this environment.

## Stable completed foundation — do not redo without a concrete regression

- Source + single Entity/title + Alias + Record + immutable Revision + durable Pending Confirmation;
- free PWA manual CRUD/search/filter/title move/batch move/delete/recycle/restore/history;
- GROUP manual authorization = active membership only;
- optimistic Record version checks + PWA stale-conflict recovery;
- stale Source/filter async response protection;
- deterministic LINE HISTORY -> filtered PWA;
- Reply-targeted PRIVATE/GROUP LINE AI EDIT;
- truthful raw-first TEXT normalization replies;
- attachment extract -> durable text -> title/time normalization source wiring;
- FREE 400,000 one-time Grant;
- user-owned Grant scopes/caps + separate GROUP AI 額度負責人;
- positive-balance preflight + final atomic reservation;
- provider actual cost -> output-price-equivalent points + platform subsidy;
- immutable/idempotent subscription-period Grants;
- retired aggregate quota / `ai_units_consumed` / `actualUnits` removed;
- factual Admin profitability + pricing calculator;
- Admin modality pricing/FREE invariants/missing-TWD coverage/session hardening;
- Admin/runtime/readiness agree on `GOOGLE + gemini-3.5-flash`;
- payment-disabled checkout and unshipped Export fail closed;
- bounded attachment streaming / no permanent binaries;
- safe baseline regeneration/guard + release preflight;
- explicit production migration DB URL;
- liveness/readiness + first-fresh-DB bootstrap mode;
- Web/Admin Workers SPA fallback/deep-link checks.

## P0 — blocks free/manual + AI-recording production launch

### 1. Regenerate Drizzle baseline/snapshot/journal — now the first decisive blocker

The checked-in `drizzle/0000_worklog_baseline.sql` is still from the retired pre-rebuild world and MUST NOT be applied.

From a real current checkout:

1. `pnpm install --frozen-lockfile`
2. verify pinned `pnpm --version`
3. `pnpm db:baseline:regenerate --confirm-prelaunch-reset`
4. inspect generated SQL/snapshot/journal
5. fix actual TypeScript/Drizzle errors exposed by current declarations
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
- normal CRUD/revision/confirmation paths;
- Grant reserve/commit/release/expire/subsidy/concurrency;
- attachment extract -> title-normalization sequence;
- attachment second-stage `RECORD_TITLE_NORMALIZATION` persisted + committed usage;
- duplicate attachment retry does not produce uncontrolled repeat provider calls;
- customer/Admin final-held-point reporting.

### 3. Entity/Alias case-insensitive collision behavior

Runtime matching is case-insensitive while current database uniqueness is case-sensitive. Reproduce on real PostgreSQL before choosing expression-index/normalization/collation behavior.

### 4. Run actual release validation

After fresh PostgreSQL is green:

- `pnpm release:preflight`;
- TypeScript typecheck;
- ESLint;
- Vitest;
- API/Web/Admin production builds and Worker dry-run;
- PWA CRUD/version/group-membership/Source-switch/session browser smoke;
- Admin plans/pricing/Overview/Profitability/session browser smoke;
- LINE Login + one-time entry;
- PRIVATE/GROUP TEXT CREATE/HISTORY/Reply EDIT/confirmations;
- image/audio/PDF/text-file extraction + automatic title/time resolution;
- attachment expiry/202/size/duplicate flows;
- real Gemini pricing/usage/point settlement;
- `/health` + `/health/ready`.

## P1 — useful polish after P0

- Customer AI usage percentage/progress UI still needs a denominator that does not mix expired/capped/lifetime facts.
- Admin main navigation can add shortcuts to `/profitability` and `/pricing-calculator`.
- Attachment LINE success text can later expose title-normalization pending/confirmation state more explicitly; durable data and automatic title processing are now wired.

## P2 — full paid MVP remains separate

- payment provider;
- successful-payment durable ledger;
- recurring renewal success/failure + idempotent webhooks;
- TOP_UP purchase/refund lifecycle;
- paid Export endpoint/UI;
- proration/mid-period paid-plan change policy;
- advanced subscriber profitability/conversion analytics requiring payment facts.

## Attachment coverage limitation

Image, audio, PDF and text-like files are active. DOCX/XLSX/legacy Office MIME types remain explicitly `ATTACHMENT_UNSUPPORTED`; this is a clear fail-closed limitation, not silent corruption.

## Next implementation target

If a real latest checkout/toolchain is available, stop broad static work and immediately:

1. regenerate baseline;
2. fix actual TypeScript/Drizzle errors, including any adapter/wrapper type errors;
3. pass baseline guard;
4. apply to fresh PostgreSQL;
5. run attachment two-stage integrity/accounting probes;
6. initialize AI runtime config + FREE plan;
7. run `pnpm release:preflight`;
8. run browser/LINE/Gemini/Worker smoke.

If local execution remains unavailable, only fix concrete source-level launch regressions; do not broaden into speculative redesign.

## Validation status

This run performed source/document audit and direct GitHub source edits only.

No usable checked-out local project/toolchain was available.

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

New/updated tests are source contracts only until executed. No test/build/migration/runtime result is claimed as passing.

No GitHub Actions workflow was executed, dispatched, rerun, enabled, modified, triggered or used as validation.

## Deployment status

**NOT READY yet.**

The previously confirmed attachment source blocker is now implemented. The decisive remaining free/manual + AI-recording blockers are migration regeneration, fresh PostgreSQL, Entity/Alias collision decision, real preflight and runtime smoke.
