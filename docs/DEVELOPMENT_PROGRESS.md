# AFTERTRACE Development Progress

## Current status

Round 9 is complete on `main`. The memory AI safety boundary now includes the required global free-AI budget gate, bounded permanent/transient failure handling, a retry counter separate from ownership fencing, and explicit crash-boundary tests. Real Gemini invocation remains intentionally disconnected from the LINE webhook/runtime composition until dependency-aware verification and all required runtime inputs are available.

GitHub Actions is still an external verification blocker as of the Round 8 HEAD run (`33225602374`, commit `8d6a591`). Its `verify` job failed in roughly three seconds with no executable steps/log URL; previously inspected jobs reported `steps=[]` and `runner_id=0`. The workflow file itself still contains the expected checkout -> pnpm -> Node -> install -> typecheck -> lint -> test -> build sequence.

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
9. Global free-AI budget hard gate, bounded provider retry policy and remaining crash-boundary tests.

## Round 9 — completed

### Global free-AI hard gate

- Added required `GLOBAL_FREE_AI_BUDGET_COST_TWD` runtime configuration. No default amount and no reset cadence were invented because PRODUCT_V1 specifies the safety boundary but not those operating values.
- Added exact `allocateAiConsumption`: WELCOME then AD may be subsidized only up to remaining global budget; PAID then covers any remainder when available.
- Added `FREE_BUDGET_EXHAUSTED` as a distinct ledger/billing outcome. A request with insufficient paid fallback waits without persisting AI usage or creating a new logical charge.
- Added `global_free_ai_budget_state` and `global_free_ai_budget_operations`. The latter is keyed by credit operation id, making free-budget accounting retry-safe.
- Guarded Drizzle AI consume serializes the global free-budget snapshot/mutation with a transaction-scoped advisory lock while retaining per-Group credit-account row locks. The same logical charge cannot increment global subsidy twice.
- Paid-only Reminder reservation paths remain outside the global free-AI budget.

### Retry and terminal-failure safety

- Kept `attempt_count` strictly as an ownership fencing token. Added `transient_failure_count` because credit waits/Worker recovery can increase attempt count and therefore cannot safely represent provider retry count.
- Added separate uncounted defer (credit/free-budget waits), counted transient defer, and terminal `markFailed`, all protected by the current attempt fence.
- A terminal AUTOMATIC request also terminally closes its extraction batch and releases the active claim key while retaining the error code.
- Added typed `MemoryAiExecutionError` and bounded retry policy. Default code policy is three transient failures, 60-second initial delay, exponential backoff capped at 15 minutes.
- Gemini classification maps authentication/authorization, invalid request and missing model/endpoint to permanent failures. Network/timeouts/rate-limit/upstream failures are transient. Malformed provider responses are transient only within the bound.
- Credit reference conflicts are terminal consistency failures rather than infinite retries.

### Crash-boundary coverage

- Added orchestrator tests proving a stale first classifier-result store cannot bill or persist candidates.
- Added an already-billed/durable retry path that reuses the logical credit operation/usage record and skips another provider call.
- Added partial candidate-resume coverage: an already-idempotent candidate plus a later candidate can both be replayed before fenced success.
- Added a stale final fence case that cannot mark a newer attempt successful.
- Added permanent-provider, transient-provider, max-transient-attempt and global-budget-wait coverage.
- Added pure allocation, billing, runtime config, Gemini error classification, retry-policy and work-coordinator tests for the new safety rules.

### Documentation / configuration

- Added `docs/AI_SAFETY.md` as the durable source for provider activation, global budget and retry/fencing invariants.
- Added Round 9 Drizzle schema to `drizzle.config.ts`; no migration was generated/applied while dependency-aware verification is unavailable.
- Updated `.env.example` with the global budget variable left blank intentionally. No provider prices, FX, API keys or operator budget amount were guessed.

### Validation

- Re-read PRODUCT_V1, ARCHITECTURE, DEVELOPMENT_PROGRESS, recent commits and the existing memory/credit/AI code before implementation.
- Used the available TypeScript 5.8.3 compiler with lightweight external-module declarations to strict-check the changed production modules; the changed test sources were also type-checked against lightweight Vitest declarations.
- Ran lightweight compiled Node checks for exact global-budget allocation, retry classification/backoff and orchestrator permanent/transient/budget-wait paths.
- Full dependency-aware `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` still cannot be claimed while GitHub Actions fails before runner steps and this runtime lacks the repository's installed dependencies.
- PostgreSQL/Drizzle SQL was reviewed statically but not executed against Neon. No migration or production credential was used.

## Round 10 — highest priority

1. Re-check the new main CI. If a GitHub runner actually executes, fix every real install/typecheck/lint/test/build/Drizzle error before adding behavior.
2. Add an explicit, attempt-fenced operator recovery/requeue path for terminal memory requests/extraction batches so invalid credentials can be repaired and work intentionally resumed without inventing automatic infinite retry.
3. After dependency-aware verification, compose `MemoryAiOrchestrator` into the event-driven request path. Keep real Gemini disabled unless API key, pricing, FX and global free-AI ceiling are all explicitly configured.
4. Add pre-invocation eligibility checks where safely knowable so obviously unfundable/exhausted requests can avoid making a provider call before a durable result exists; do not compromise exact post-call billing.
5. Implement Paid-only Reminder lifecycle: create/reserve, cancel/release, delivered/consume, with idempotent audit/usage semantics.
6. Implement inactive Group retention cleanup: 30 days never-paid, 1 year paid, while preserving required financial/audit records.
7. Generate the initial Drizzle migration only after dependency-aware verification is available and the V1 schema is stable enough to stop rewriting the baseline schema files.

## Process note

Never bypass durable result reuse, billing idempotency, source grounding, global free-AI limits, candidate idempotency or request fencing merely to make Gemini appear connected sooner. Always update this file before the next handoff.
