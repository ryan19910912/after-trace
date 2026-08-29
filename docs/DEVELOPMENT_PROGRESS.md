# AFTERTRACE Development Progress

## Current status

Round 10 is complete on `main`. Terminal memory work now has an explicit attempt-fenced operator recovery path, and the memory AI pipeline has a pre-invocation funding eligibility check that avoids obviously unfunded Gemini calls before private conversation context is loaded. A schema contract mismatch discovered during this round was also corrected: extraction batches can now represent the `FAILED` state already used by the Round 9 terminal-failure SQL.

Real Gemini invocation remains intentionally disconnected from the LINE webhook/runtime composition. Dependency-aware verification is still unavailable because GitHub Actions fails before a runner executes any step, and production activation also still requires explicit Gemini credentials/pricing, USD/TWD FX and the global free-AI ceiling.

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
- The snapshot reads current WELCOME, AD and PAID available balances plus cumulative global free-AI spend.
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

### Tests / static validation

Added focused tests for:

- free allowance remaining under the global cap;
- global free budget exhausted;
- PAID fallback after free-budget exhaustion;
- true no-credit state;
- preflight defer before context loading/Gemini invocation;
- durable classifier result bypassing the advisory preflight;
- recovery normalization, expected-attempt fencing and rejected missing operator attribution.

The changed production modules and tests pass the available local TypeScript 5.8.3 strict lightweight check using declarations for unavailable external dependencies. The recovery SQL and funding snapshot SQL were statically reviewed, but were not executed against Neon.

Full dependency-aware `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` still cannot be claimed. GitHub Actions run `33230607212` for Round 10 commit `1c02681` failed in roughly two seconds; job `99042649989` reports `steps=[]`, `runner_id=0` and an empty runner name, so Checkout and every repository command were never executed. This is the same external runner/environment failure seen in previous rounds, not a program test failure.

No Neon/LINE/Cloudflare/Gemini production credential, provider price, FX rate or free-budget amount was guessed or used.

## Round 11 — highest priority

1. Re-check the newest `main` CI. If GitHub actually assigns a runner, fix every real install/typecheck/lint/test/build/Drizzle issue before adding behavior.
2. Once dependency-aware verification is available, compose `MemoryAiOrchestrator` plus the funding eligibility adapter into the event-driven LINE path. Real provider invocation must remain disabled unless `GEMINI_API_KEY`, pricing, FX and global free-AI ceiling are explicitly configured.
3. Define an authenticated operator/admin boundary before exposing `MemoryRecoveryService`; do not create an unauthenticated recovery endpoint merely for convenience.
4. Implement Paid-only Reminder lifecycle: create + PAID reserve, cancel + release, successful delivery + consume, with idempotent audit/settlement semantics and low-paid-balance handling consistent with PRODUCT_V1.
5. Implement inactive Group retention cleanup: 30 days for never-paid, 1 year for paid, while preserving financial/audit records required for reconciliation.
6. Consolidate the baseline Drizzle schema and generate the initial migration only after dependency-aware verification is available and the schema is stable enough to stop rewriting the pre-migration files.

## Process note

Never bypass durable result reuse, billing idempotency, source grounding, global free-AI limits, candidate idempotency, request fencing, explicit recovery fencing or exact post-call settlement merely to make Gemini appear connected sooner. Always update this file before the next handoff.
