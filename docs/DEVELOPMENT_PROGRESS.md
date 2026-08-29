# AFTERTRACE Development Progress

## Current status

Round 11 is complete on `main`. The paid-only Reminder financial/state lifecycle now has an explicit domain service, Drizzle/PostgreSQL repository, schema and focused tests. Reminder creation atomically reserves PAID value; cancellation atomically releases the reservation; successful-delivery settlement atomically consumes it. The same statements also mutate reminder state and append audit records, so Worker crashes cannot leave a normal service-level half-settlement. No Reminder price or proactive low-balance threshold was invented.

Reminder is not yet end-to-end delivered: due-reminder claim/lease, duplicate-send prevention, Cloudflare scheduled execution and LINE Push composition are still pending. The reservation settlement method is intentionally called only after an external delivery succeeds.

Real Gemini invocation also remains intentionally disconnected from the LINE webhook/runtime composition. Dependency-aware verification is still unavailable because GitHub Actions continues to fail before a runner executes any step, and production AI activation still requires explicit Gemini credentials/pricing, USD/TWD FX and the global free-AI ceiling.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo; Hono on Cloudflare Workers; React/Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle; Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE Group is the isolation boundary for context, memories, reminders, usage and credits.
- Conversation extraction is event-driven; explicit and automatic memory work share one pipeline.
- Memory decisions are NEW / DUPLICATE / UPDATE / CONTRADICT with source attribution and audit history.
- Credit order is Welcome -> Ad -> Paid; paid value does not expire; Reminder is paid-only.
- Global free-AI budget is a hard safety boundary; the operator amount/reset policy must not be guessed by application code.
- Never-paid inactive Groups retain recoverable product data 30 days; paid Groups 1 year.

## Completed rounds

1. Repository/product/architecture bootstrap, Worker/LIFF skeletons, Neon/Drizzle foundation and CI.
2. LINE signature/events, conversation buffer/idempotency, group lifecycle, source metadata and extraction thresholds.
3. Extraction batch leases, members, fixed-point credits, AI cost snapshots and explicit memory command detection.
4. Webhook extraction claims, logical credit operation idempotency, reservations and AI usage/credit coupling.
5. Welcome credit, Rewarded Ad primitives, explicit memory requests and extraction context loading.
6. Shared memory request leases/fencing plus idempotent NEW/DUPLICATE/UPDATE/CONTRADICT persistence/audit.
7. Unified grounded classifier input, strict Zod output contract, pseudonymized prompt and runtime pricing/FX boundary.
8. Durable validated Gemini result reuse, REST classifier adapter and retry-safe billing/candidate/request orchestration.
9. Global free-AI budget hard gate, bounded provider retry policy and crash-boundary coverage.
10. Attempt-fenced terminal recovery, pre-invocation funding eligibility and extraction FAILED-schema correction.
11. Paid-only Reminder create/reserve, cancel/release and successful-delivery/consume lifecycle with atomic audit/settlement fencing.

## Round 10 — completed

### Terminal memory recovery

- Added `MemoryRecoveryService` and a PostgreSQL/Drizzle recovery repository.
- Recovery is explicit rather than another automatic retry. It requires `requestId`, exact `expectedAttemptCount`, an operator reference and a reason.
- The database transaction only requeues a request that is currently `FAILED` and still matches the supplied attempt fence. A stale operator action therefore cannot reopen newer work.
- Recovery clears terminal work timestamps/error state, resets `transient_failure_count` to zero, and returns the request to `PENDING` without changing the ownership fence until a later normal claim.
- Recovery writes `MEMORY_REQUEST_REQUEUED` audit context containing the prior attempt/error state plus the normalized operator reference and reason.
- AUTOMATIC recovery reopens the associated failed extraction batch in the same transaction. The batch returns to `CLAIMED` with `active_claim_key = NULL`: the original assigned messages remain attached, while the recovered old batch does not conflict with a newer Group extraction batch using the `OPEN` uniqueness key.
- Durable classifier results are deliberately preserved. If the failed request already has a validated Gemini result, recovery resumes settlement from that durable result and must not pay for another provider call.
- No public recovery route was added because an operator/admin authentication strategy has not yet been defined; exposing this mutation unauthenticated would be unsafe.

### Pre-invocation AI funding eligibility

- Added `AiFundingEligibilityService` and `DrizzleAiFundingSnapshotRepository`.
- The snapshot reads current unexpired WELCOME, AD and PAID available balances plus cumulative global free-AI spend.
- The advisory gate runs only when a request does not yet have a durable classifier result.
- No usable Group credit returns `NO_CREDIT`; the orchestrator defers with `AI_INSUFFICIENT_CREDIT` before loading private classification context or calling Gemini.
- Free/ad balance with zero remaining global subsidy and no PAID balance returns `FREE_BUDGET_EXHAUSTED`; the orchestrator defers with `AI_FREE_BUDGET_EXHAUSTED` before the provider call.
- PAID balance keeps a request eligible even when free subsidy is exhausted.
- Existing durable results bypass the advisory preflight because the provider cost is already sunk and exact idempotent settlement is the correct next action.
- This gate is intentionally advisory and non-locking. Exact actual-cost billing after the provider result remains the authoritative atomic credit/global-budget boundary.

### Schema consistency fix

- Round 9 terminal SQL writes `conversation_extraction_batches.status = 'FAILED'`, but the original Drizzle enum still listed only `CLAIMED` and `SUCCEEDED`.
- Updated `extraction_batch_status` in `schema.ts` to include `FAILED`, matching the implemented terminal/recovery lifecycle.
- No migration was generated or applied while dependency-aware Drizzle verification is unavailable.

## Round 11 — completed

### Paid-only Reminder domain and schema

- Added `apps/api/src/reminders/service.ts` with validated create, cancel and successful-delivery-settlement commands.
- Reminder creation requires a caller-supplied positive `reservedCostUnits`; no Reminder price is hard-coded or inferred.
- A stable Group-scoped `requestKey` is the creation idempotency key. The same key with different message, schedule, reservation amount or actor is a reference conflict rather than a second Reminder.
- Added `schema-round11.ts` with `reminder_status = SCHEDULED / CANCELLED / DELIVERED` and the `reminders` table. Stored fields include the reservation operation, creator/canceller attribution, delivery reference and terminal timestamps.
- Added the Round 11 schema file to `drizzle.config.ts`. No migration was generated or applied because dependency-aware Drizzle verification is still blocked.

### Atomic PAID reservation lifecycle

- `DrizzleReminderRepository.create` keeps Reminder creation and PAID reservation in one PostgreSQL statement: active Group check -> PAID account lock -> RESERVE operation -> credit reservation/transaction -> available-to-reserved account move -> `SCHEDULED` Reminder -> `REMINDER_CREATED` audit.
- WELCOME and AD are never read as eligible Reminder funding. If current PAID value cannot cover the explicit reservation amount, creation returns `INSUFFICIENT_PAID` without creating Reminder state.
- `cancel` locks the Reminder and reservation, transitions `RESERVED -> RELEASED`, returns the amount to PAID available balance, marks the Reminder `CANCELLED`, stores the cancelling actor and writes `REMINDER_CANCELLED` audit in the same statement.
- `settleSuccessfulDelivery` requires a stable delivery reference, transitions `RESERVED -> CONSUMED`, removes PAID reserved value, marks the Reminder `DELIVERED` and writes `REMINDER_DELIVERED` audit in the same statement. It is deliberately a post-delivery settlement boundary; it does not claim that LINE Push itself has happened.
- Exact terminal retries are idempotent. A different delivery reference after delivery, or inconsistent pre-existing settlement operation while Reminder state is still scheduled, returns `REFERENCE_CONFLICT` instead of pretending success.
- An already-created Reminder remains funded by its reservation even if unrelated WELCOME/AD value or the global free-AI subsidy is later exhausted.
- No proactive low-PAID warning threshold was introduced because PRODUCT_V1 does not define one. Low PAID at creation is represented by `INSUFFICIENT_PAID`; proactive warnings for existing Reminder service remain runtime/UI work once an explicit policy exists.

### Tests / static validation

Added focused Reminder service coverage for:

- creation identity/message normalization while preserving exact schedule and fixed-point reservation amount;
- rejection of zero reservation amount so the domain cannot silently invent pricing;
- cancellation actor attribution;
- rejection of successful-delivery settlement without a delivery reference.

The changed Reminder service/repository/schema modules pass the available local TypeScript 5.8.3 strict lightweight check using declarations for unavailable external dependencies. A direct Node runtime check of the service validation/normalization paths also passed. The Reminder SQL was statically reviewed, including a follow-up fencing pass that tightened concurrent create and inconsistent settlement handling.

Full dependency-aware `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` still cannot be claimed. GitHub Actions run `33232934974` for commit `f1095047` completed as failure, but job `99048796121` again exposes no executed steps (`steps=null`); Checkout and repository commands never ran. This remains the same external runner/environment blocker rather than evidence of a repository compile/test failure.

No Reminder migration was generated, and the SQL has not been executed against Neon. No Neon/LINE/Cloudflare/Gemini production credential, provider price, FX rate, global free-budget amount, Reminder price or low-balance threshold was guessed or used.

Round 11 implementation commits:

- `a81c96cf312c59dc1302dbb9cf70292f6830cda4` — paid-only Reminder lifecycle foundation.
- `f1095047b99f5ee1bcc5ce762d83a9a42d12cdbb` — tightened settlement/reference fencing after manual review.

## Round 12 — highest priority

1. Re-check the newest `main` CI. If GitHub actually assigns a runner, stop feature work long enough to fix every real install/typecheck/lint/test/build/Drizzle issue revealed by dependency-aware verification.
2. Complete Reminder runtime delivery as one crash-safe batch: due-reminder claim/lease with fencing and duplicate-send protection, Cloudflare scheduled execution boundary, LINE Push adapter, then call `settleSuccessfulDelivery` only after confirmed delivery. Cancellation must remain able to win safely against work that has not yet been delivered.
3. Implement inactive Group retention cleanup: 30 days for never-paid and 1 year for paid Groups. Preserve financial/audit records needed for reconciliation, and do not guess how unresolved PAID Reminder reservations should be disposed of; resolve that boundary explicitly in code/tests before deleting recoverable product rows.
4. Once dependency-aware verification is available, compose `MemoryAiOrchestrator` plus funding eligibility into the event-driven LINE path. Real provider invocation must remain disabled unless `GEMINI_API_KEY`, pricing, FX and global free-AI ceiling are explicitly configured.
5. Define an authenticated operator/admin boundary before exposing `MemoryRecoveryService`; do not create an unauthenticated recovery endpoint merely for convenience.
6. Consolidate the baseline Drizzle schema and generate the initial migration only after dependency-aware verification is available and the schema is stable enough to stop rewriting the pre-migration files.

## Process note

Never bypass durable result reuse, billing idempotency, source grounding, global free-AI limits, candidate idempotency, request fencing, explicit recovery fencing, Reminder reservation atomicity or exact post-call/post-delivery settlement merely to make Gemini or Reminder delivery appear connected sooner. Always update this file before the next handoff.
