# AFTERTRACE Development Progress

## Current status

Round 8 is complete on `main`. The memory AI path now has a durable validated-classifier-result boundary, a Gemini 2.5 Flash-Lite REST adapter, and a retry-safe orchestration service that reuses durable model results, bills with a deterministic request reference, persists candidates idempotently, and settles the request only under the current claim fence. Gemini is still intentionally not wired from the webhook/runtime composition until dependency-aware verification and the remaining safety gates are complete.

GitHub Actions remains an external environment blocker. The latest pre-Round-8 run (`33222523981`, commit `ef5f62c`) completed in about three seconds with failure before useful repository verification; previously inspected jobs had `steps=[]` and `runner_id=0`.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo; Hono on Cloudflare Workers; React/Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle; Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE Group is the isolation boundary for context, memories, reminders, usage and credits.
- Conversation extraction is event-driven; explicit and automatic memory work share one pipeline.
- Memory decisions are NEW / DUPLICATE / UPDATE / CONTRADICT with source attribution and audit history.
- Credit order is Welcome -> Ad -> Paid; paid value does not expire; Reminder is paid-only.
- Never-paid inactive Groups retain recoverable product data 30 days; paid Groups 1 year.

## Completed rounds

1. Repository/product/architecture bootstrap, Worker/LIFF skeletons, Neon/Drizzle foundation and CI.
2. LINE signature/events, conversation buffer/idempotency, group lifecycle, source metadata and extraction thresholds.
3. Extraction batch leases, members, fixed-point credits, AI cost snapshots and explicit memory command detection.
4. Webhook extraction claims, logical credit operation idempotency, reservations and AI usage/credit coupling.
5. Welcome credit, Rewarded Ad primitives, explicit memory requests and extraction context loading.
6. Shared memory request leases/fencing plus idempotent NEW/DUPLICATE/UPDATE/CONTRADICT persistence/audit.
7. Unified grounded classifier input, strict Zod output contract, pseudonymized prompt and runtime pricing/FX boundary.

## Round 8 — completed

### Durable validated classifier result

- Added `memory_classifier_results`, one row per memory request, containing attempt fence, provider/model, optional provider response id, validated structured output, token counts, latency, pricing/FX snapshot and calculated USD/TWD cost.
- Added `MemoryClassifierResultService` and repository contract. Results are grounded again before storage and the response model must match the pricing snapshot model.
- `DrizzleMemoryClassifierResultRepository.storeIfCurrent` inserts the first result only while the request is CLAIMED by the current `attempt_count` fence. A stale Worker cannot create the durable result.
- Later attempts reuse the first stored row. A Worker crash after model completion therefore does not require another intentional Gemini call.
- Added Round 8 schema to Drizzle Kit configuration. No migration was generated or applied while dependency-aware CI remains unavailable.

### Gemini adapter

- Added `GeminiMemoryClassifier` using Cloudflare-compatible `fetch`, with no new SDK dependency.
- Uses Gemini `generateContent` with `responseMimeType=application/json` and `responseJsonSchema` matching the classifier candidate contract.
- Uses the pseudonymized Round 7 prompt; raw LINE user ids are not added by the adapter.
- Parses provider JSON, validates Zod + source/active-memory grounding, and requires prompt/output token counts before returning a billable response.
- Provider response id is retained when available for debugging/idempotency traceability.

### Retry-safe memory AI orchestration

- Added `MemoryAiOrchestrator`: claim -> load grounded input -> reuse durable result or call classifier -> durable store -> idempotent billing/usage -> candidate persistence -> fenced success.
- Billing reference is deterministically `{ type: AI_MEMORY_CLASSIFIER, id: requestId }`, so retries reuse the same logical credit operation.
- Billing is constructed only from the durable classifier-result snapshot; a retry never recomputes cost using newer pricing/FX.
- `AiBillingService.chargeAndRecord` now accepts a separate settlement timestamp. Model-call time remains on the usage record while credit expiry/allocation is evaluated at the actual retry/settlement time.
- Insufficient credit keeps the validated result durable and defers the request. A later top-up can settle the same result without another Gemini call.
- Candidate persistence remains candidate-level idempotent and attempt-fenced; final request/extraction success still requires the current work fence.
- Gemini remains disconnected from the webhook so no network AI call is activated accidentally.

### Tests / validation

- Added tests for durable pricing snapshots, hallucinated-source rejection, structured Gemini request shape, prompt pseudonymization and token usage parsing.
- Added orchestrator tests proving an existing durable result skips the classifier and insufficient credit defers without candidate mutation or another model call.
- Fixed token-usage narrowing in the REST adapter so missing/invalid Gemini usage metadata is rejected explicitly.
- Re-read PRODUCT_V1, architecture/progress handoff, recent commits, memory work/pipeline, credit billing and AI usage code before implementation.
- Full `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` remains unproven because the available GitHub Actions runner path has continued to fail before useful repository steps. No production Neon/LINE/Cloudflare/Gemini credential or provider price/FX value was guessed.

## Round 9 — highest priority

1. Re-check the latest main CI created by this documentation commit. If a runner actually executes, fix every real install/typecheck/lint/test/build/Drizzle error before adding behavior.
2. Add explicit tests for the remaining crash boundaries: stale classifier-result store must never bill; an already-billed retry must reuse the credit operation and usage row; partial candidate persistence must resume idempotently; stale fence must not mark success.
3. Add the global free-AI budget hard safety gate required by PRODUCT_V1 before enabling automatic Gemini extraction.
4. Decide and implement a bounded retry policy for permanent provider/configuration errors versus transient errors; do not retry invalid credentials indefinitely.
5. After the above gates are verified, wire `MemoryAiOrchestrator` into the event-driven memory request trigger without polling. Keep real Gemini disabled unless all runtime secrets + pricing/FX are explicitly configured.
6. Implement Paid-only Reminder create/reserve, cancel/release, delivered/consume.
7. Implement inactive Group retention cleanup: 30 days never-paid, 1 year paid, while preserving required financial/audit records.
8. Generate the initial Drizzle migration only after dependency-aware verification is available and the V1 schema is stable.

## Process note

Never bypass durable result reuse, billing idempotency, source grounding, candidate idempotency or request fencing merely to make Gemini appear connected sooner. Always update this file before the next handoff.
