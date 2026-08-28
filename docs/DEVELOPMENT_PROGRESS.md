# AFTERTRACE Development Progress

## Current status

Round 4 connects event-driven webhook ingestion to database extraction claims and replaces the provisional per-bucket credit-idempotency idea with a logical-operation ledger that is safe for multi-bucket consumption. It also adds PAID reservation settlement and retry-safe AI usage billing/persistence. Gemini memory extraction is still intentionally disabled.

GitHub Actions remains an environment blocker: the Round 3 run for `9555d0f` completed with a failed `verify` job before any workflow step executed (`steps` absent / no logs). Full workspace install/typecheck/lint/test/build is therefore still not proven by Actions.

## Confirmed V1 baseline

- TypeScript monorepo with pnpm.
- API: Hono on Cloudflare Workers.
- LIFF Web: React + Vite + TypeScript on Cloudflare Pages.
- Database: PostgreSQL on Neon, accessed through Drizzle ORM.
- AI: Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis and no object storage.
- LINE messages are buffered short-term; memories are group-scoped long-term data.
- Memory extraction is event-driven, but Gemini may only run after a database claim owns a concrete batch.
- Automatic and explicit @AI memories share dedup/update/contradiction handling.
- All group members may manage memories; no Owner/Admin role is introduced.
- Memory source metadata is retained when LINE provides it.
- Credit model is prepaid, not subscription-based. Welcome/ad value is consumed before paid value; paid credit does not expire.
- First activated group per LINE user defaults to NT$1 internal welcome allowance; later groups default to NT$0.5.
- Reward defaults: NT$0.01 internal allowance, max 5/group/day, 15-minute cooldown.
- Reminder is paid-only and reserves paid value when created.
- Inactive never-paid groups retain recoverable product data for 30 days; paid groups for 1 year.

## Round 1 — completed

Repository/product/architecture bootstrap, Hono Worker, LIFF shell, Neon/Drizzle foundation, initial schema, CI, env template and README.

## Round 2 — completed

LINE signature verification and ordered event parsing, supported group-message normalization, attachment metadata-only handling, idempotent conversation ingestion, group lifecycle protection, pending counters, configurable thresholds, source traceability, unit tests, ESLint configuration, and CI wiring.

## Round 3 — completed

Database-owned extraction batches/leases, group-member persistence, exact bigint credit allocation primitives, AI pricing/FX snapshot calculator, explicit `@AI 記住` / reply command detection, and the first credit/reference schema foundation.

## Round 4 — completed

### Extraction wiring

- Conversation ingestion results now include the internal numeric group id for downstream domain work without exposing raw LINE group ids.
- The webhook creates one shared Neon/Drizzle database handle and wires both conversation ingestion and extraction claiming to it.
- After every active stored or duplicate message, the webhook calls `claimDueBatch`.
- The extraction repository still decides atomically whether a new batch is due, so calling on every message does not bypass thresholds.
- Calling on duplicate/later messages allows an expired claim lease to be reclaimed after a worker failure; this fixes the failure mode where counters had already been decremented and a redelivery would otherwise never retry the stranded batch.
- Webhook metrics now distinguish threshold observations (`extractionCandidates`) from actual database-owned claims (`extractionClaims`).
- Gemini is still not called by the webhook.

### Logical credit operations

- Added `credit_operations` as the logical idempotency boundary.
- One logical operation has a unique `(group_id, type, reference_type, reference_id)` key and stores the requested amount plus optional bucket scope.
- `credit_transactions` now belong to an operation and are unique by `(operation_id, bucket)`, allowing one CONSUME to debit WELCOME, then AD, then PAID while the whole logical request remains idempotent.
- Reusing a reference with a different amount or bucket scope returns `REFERENCE_CONFLICT` instead of silently applying a different mutation.
- Added `CreditLedgerService` validation for positive amounts/group ids and normalized reconciliation references.
- Added the Neon/Drizzle raw-SQL ledger adapter using single-statement data-modifying CTEs for GRANT and general CONSUME.
- General consumption locks current non-expired balances and allocates in the required order `WELCOME -> AD -> PAID`; insufficient balance creates no logical operation and performs no debit.
- Successful PAID grants mark `line_groups.has_paid = true` for later one-year retention behavior.

### Paid reminder reservation safety

- Added `credit_reservations` with states `RESERVED`, `CONSUMED`, and `RELEASED`.
- PAID reservation creates a logical RESERVE operation, moves value from PAID available to reserved, and is idempotent by reminder/reference key.
- Cancellation settles `RESERVED -> RELEASED` and returns the exact reserved amount to PAID available.
- Successful reminder delivery can settle `RESERVED -> CONSUMED`, reducing only PAID reserved value.
- Settlement locks the reservation row so release and consume cannot both win.
- Added service tests for reference normalization, positive-amount enforcement, and reserve/release reference reuse.

### AI usage billing coupling

- Added `ai_usage_events.charge_operation_id` as a unique link to the credit operation that paid for a billable AI response.
- Added `AiUsageRepository`/`AiUsageService` and a Drizzle persistence adapter with idempotent insert on `charge_operation_id`.
- Added `AiBillingService`: it performs reference-idempotent credit consumption first, requires a resolved operation id, then persists usage against that operation id.
- If a worker fails after the debit but before the usage insert, retrying the same AI reference returns the same credit operation and cannot double-charge; usage insertion is also idempotent.
- Insufficient credit prevents usage persistence and is surfaced explicitly.
- Gemini pricing, FX rate, API key, and any real model call are still not guessed or enabled.

### Schema stabilization

- Replaced the provisional per-bucket transaction-reference uniqueness with operation-level idempotency, because per-bucket uniqueness could double-charge on retry if the first attempt exhausted WELCOME and a later retry reallocated into AD/PAID.
- Added operation/reservation schema before generating migrations, which is why migration generation remains intentionally deferred.
- No production credential or external account configuration was added.

## Round 4 validation

### Available validation completed

- Re-checked the latest Round 3 GitHub Actions run: job `verify` still completed with `steps = null` and no logs, confirming the runner/environment blocker persists rather than exposing a repository compile failure.
- Used the automation runtime's TypeScript compiler to typecheck the new dependency-free credit ledger service, AI usage service, and AI billing service.
- Typechecked the new Drizzle ledger/usage adapters and schema against lightweight local declarations to catch TypeScript/syntax/interface errors without pretending those stubs are a substitute for the real dependencies.
- Typechecked the webhook/conversation/extraction wiring against lightweight local interface stubs.
- Reviewed all SQL mutations for single-statement operation ownership, ledger-driven account mutation, reservation locking, and retry behavior.

### Full workspace blocker remains

- GitHub Actions still fails before a runner executes any workflow step, so real `pnpm install`, dependency-aware TypeScript, ESLint, Vitest, Wrangler dry-run, Vite build, and Drizzle runtime typing remain unproven.
- No database migration has been generated or run; the current schema is still pre-migration V1 design state.
- Treat any real CI/Drizzle issue as the first priority as soon as a runner begins executing steps.

## Round 5 — highest priority

1. Re-check GitHub Actions for the Round 4 commit. If workflow steps finally execute, fix every real install/typecheck/lint/test/build issue before adding more product behavior.
2. Add Welcome-credit attribution using the first observed group member as the attribution actor, without creating an Owner role. Enforce one welcome grant per group and determine first-vs-later group for that LINE user idempotently.
3. Add Rewarded Ad grant policy state and atomic grant behavior: group/day limit, cooldown, deterministic reward reference, actor auditability, and no grant if policy fails.
4. Route detected explicit-memory commands into a persistent pending candidate request that resolves the quoted/source conversation row and shares the future automatic-memory pipeline.
5. Add extraction-batch message loading plus the previous-successful-batch context accessor. Do not delete old context until the next batch has succeeded.
6. Add Gemini structured extraction only after runtime pricing/FX inputs are explicitly configured and the memory candidate persistence/dedup transaction exists.
7. Implement memory candidate classification/persistence for `NEW / DUPLICATE / UPDATE / CONTRADICT`, including source metadata and audit history.
8. Add Reminder schema/service on top of the now-available PAID reservation API; creation must reserve, cancellation must release, successful delivery must consume reserved value.
9. Generate the initial Drizzle migration only after a real dependency-aware build is available and ingestion + extraction + credit + candidate schema has stabilized.

## Process note

Prefer one logical batched commit per round when possible. Keep Gemini disabled until claim ownership, credit charging, usage metering, candidate persistence, and dedup/update/contradiction behavior are all testable as one safe path.
