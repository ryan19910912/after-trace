# AFTERTRACE Development Progress

## Current status

Round 5 is complete and has been fast-forwarded into `main`. The V1 backend now has retry-safe Welcome Credit attribution, Rewarded Ad policy/grant primitives, persistent explicit-memory requests, and an extraction input/context accessor. Gemini memory extraction remains intentionally disabled until candidate classification/persistence is safe and testable.

GitHub Actions remains an environment blocker. Both Round 5 `main` runs checked in this round (`55ec31a` and `5312e40`) failed in about two seconds before any workflow step executed: `verify.steps=[]`, `runner_id=0`, and no runner name. This confirms the failure is still before checkout rather than a repository typecheck/test/build failure. Full dependency-aware workspace verification remains unproven until a runner actually executes steps.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo.
- Hono on Cloudflare Workers.
- React + Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle.
- Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE messages are a bounded conversation buffer; memories are group-scoped long-term data.
- Every group member can manage memories; no Owner/Admin role exists.
- Memory mutations/deletions are auditable and source metadata is retained when LINE provides it.
- Credit order is Welcome -> Ad -> Paid. Paid credit does not expire.
- First observed group attributed to a LINE user gets the configurable first-group Welcome amount; later groups get the configurable later-group amount.
- Rewarded Ad defaults remain NT$0.01 internal allowance, max 5/group/day, 15-minute cooldown.
- Reminder remains paid-only and must reserve PAID value before delivery.
- Never-paid inactive groups retain recoverable product data for 30 days; paid groups for 1 year.

## Round 1 — completed

Repository/product/architecture bootstrap, Worker/LIFF skeletons, Neon/Drizzle foundation, CI, env template, initial schema and docs.

## Round 2 — completed

LINE signature verification, ordered webhook parsing, conversation ingestion/idempotency, lifecycle protection, source metadata, configurable extraction thresholds and tests.

## Round 3 — completed

Database-owned extraction batches/leases, group-member persistence, fixed-point credit primitives, AI cost snapshot calculator, explicit `@AI 記住` detection and initial credit schema.

## Round 4 — completed

Webhook-to-extraction claim wiring, logical-operation credit idempotency, WELCOME -> AD -> PAID consumption, PAID reservation settlement, AI usage/credit coupling and retry-safe billing persistence.

## Round 5 — completed

### Welcome Credit attribution

- Added a dedicated `welcome_credit_user_state` counter so first-vs-later group attribution is decided atomically per LINE user without creating an Owner role.
- Added `welcome_credit_attributions` with one attribution per Group, attributed LINE user, first/later flag, configured amount, grant operation id, and grant timestamp.
- `WelcomeCreditService` converts configured TWD amounts into exact 8-decimal fixed-point units and grants through the existing logical credit ledger.
- Welcome grant reference is deterministic: `WELCOME_GROUP / <internal-group-id>`.
- A crash after ledger grant but before attribution completion is safe: retry reuses the same credit operation and completes the attribution without double-granting.
- Successful completion writes `WELCOME_CREDIT_GRANTED` to `audit_logs`.
- Webhook ingestion now ensures Welcome Credit for the first observed member after an active group message is persisted. Duplicate LINE delivery remains idempotent.

### Rewarded Ad policy and grant safety

- Added `rewarded_ad_policy_state` keyed by Group + policy day and `rewarded_ad_grants` keyed by Group + provider reward-event id.
- V1 policy day is resolved in `Asia/Taipei` so the confirmed daily limit follows Taiwan calendar days.
- Policy acceptance uses PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... WHERE` to atomically enforce both daily count and cooldown under concurrent reward proofs.
- Rejected proofs are persisted as `REJECTED_POLICY`; accepted proofs remain `PENDING` until the credit ledger grant completes.
- Credit grant reference is deterministic: `REWARDED_AD / <reward-event-id>`.
- Crash/retry between policy acceptance, ledger grant, and grant completion cannot double-credit the Group.
- Successful completion writes `REWARDED_AD_GRANTED` to `audit_logs` with the actor and reward event id.
- No public HTTP reward endpoint was added yet. This is intentional: V1 must not expose a credit-grant route until a real ad provider/server-verifiable reward proof is chosen.

### Persistent explicit-memory requests

- Added `memory_candidate_requests` as the shared request envelope for future explicit and automatic memory candidate processing.
- Explicit `@AI 記住...` and reply-based `記住` commands are persisted immediately after conversation ingestion rather than waiting for the extraction threshold.
- Reply commands resolve the quoted LINE message inside the same Group and keep the conversation-row link for future source metadata copying.
- If a reply-only request points to a source that is no longer in the buffer, it is persisted as `BLOCKED_SOURCE_MISSING` instead of inventing content.
- Duplicate webhook delivery is idempotent by `(group_id, request_line_message_id)`.
- The webhook now reports pending vs blocked explicit-memory request counts; Gemini is still not called.

### Extraction input/context accessor

- Added `ExtractionBatchInputService` and a Neon/Drizzle adapter that loads the currently claimed batch messages plus the most recent previous successful batch for the same Group.
- Current and previous messages preserve LINE message id, sender, type, text, quote metadata, timestamp and attachment/location metadata.
- Previous context is read-only and is not deleted in Round 5. This preserves the product rule: previous processed context remains available until the next extraction succeeds.

### Schema organization

- Added `apps/api/src/db/schema-round5.ts` for Welcome Credit state, Rewarded Ad policy/grants and memory candidate requests.
- Drizzle Kit now loads both the existing schema and the Round 5 schema file.
- Initial migration generation is still intentionally deferred until a real dependency-aware build is available and candidate/memory schema stabilizes.

## Round 5 validation

### Completed validation

- Re-checked two Round 5 GitHub Actions runs on `main`: both `verify` jobs completed with `steps=[]`, `runner_id=0`, no runner name, and no checkout/logged workflow step. The runner/environment blocker therefore persists.
- Used the automation runtime TypeScript 5.8 compiler with lightweight module declarations to typecheck the new dependency-free Welcome Credit, Rewarded Ad, explicit-memory and extraction-input services.
- Typechecked the new raw-SQL Welcome/Rewarded Ad/Memory adapters against lightweight database/Drizzle declarations to catch syntax/interface errors.
- Added Vitest unit coverage for Welcome Credit idempotency, Taiwan Rewarded Ad policy day, policy rejection before ledger access, explicit-memory source selection and extraction input service validation.
- Reviewed the Rewarded Ad SQL to avoid relying on sibling data-modifying CTE visibility: the new-claim response is derived from CTE `RETURNING` values and the atomic policy-state result.

### Full workspace blocker remains

- Real `pnpm install`, dependency-aware `tsc`, ESLint, Vitest, Wrangler dry-run, Vite build and Drizzle Kit generation still cannot be claimed green because GitHub Actions has not yet acquired a runner for any completed run.
- No Neon/LINE/Cloudflare/Gemini production credential was guessed or committed.
- No database migration has been generated or executed.

## Round 6 — highest priority

1. Re-check the latest `main` CI run. If steps execute, fix every real install/typecheck/lint/test/build issue before adding product behavior.
2. Implement memory candidate classification/persistence transaction for `NEW / DUPLICATE / UPDATE / CONTRADICT`, including active-memory lookup, source copying, supersession and audit history.
3. Let successful automatic extraction batches create `AUTOMATIC` memory candidate requests and let explicit requests enter the exact same candidate pipeline.
4. Add a claim/lease for pending memory candidate requests so retries cannot run Gemini twice for the same request.
5. Add runtime AI pricing/FX configuration and a Gemini structured-output adapter only after steps 2–4 are testable; couple every billable response to `AiBillingService`.
6. Add Reminder schema/service on top of PAID reservations: create -> reserve, cancel -> release, delivered -> consume reserved value.
7. Add inactive-group retention cleanup planning and audit-safe financial-record exclusions.
8. Generate the initial Drizzle migration only after real dependency-aware CI/build is available and the V1 schema above is stable.

## Process note

Keep Gemini disabled until extraction ownership, candidate ownership, memory mutation semantics, credit charging and AI usage metering form one retry-safe path. Prefer a small number of logical commits and always update this file before handing work to the next round.
