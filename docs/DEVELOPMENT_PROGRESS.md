# AFTERTRACE Development Progress

## Current status

Round 8 is complete on `main`. The memory classifier now has a durable validated-result boundary keyed by memory request and a Gemini 2.5 Flash-Lite REST adapter behind `MemoryClassifierPort`. Gemini remains intentionally disabled from the webhook: billing, candidate persistence and request settlement still need to be assembled into one retry-safe orchestrator before production invocation is safe.

GitHub Actions remains an external environment blocker. The latest pre-Round-8 main run (`33222523981`, commit `ef5f62c`) completed in about three seconds with failure before useful repository verification; prior inspected jobs had `steps=[]` and `runner_id=0`.

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
- `DrizzleMemoryClassifierResultRepository.storeIfCurrent` inserts only while the request is CLAIMED by the current `attempt_count` fence. A stale Worker cannot create the first durable result.
- If a result already exists, later attempts reuse the first stored row. This closes the crash window after successful model response persistence and prevents a retry from intentionally issuing another provider call.
- Added Round 8 schema to Drizzle Kit configuration. No migration was generated or applied while dependency-aware CI remains unavailable.

### Gemini adapter

- Added `GeminiMemoryClassifier` using Cloudflare-compatible `fetch`, no new SDK dependency.
- Uses Gemini `generateContent` with `responseMimeType=application/json` and JSON schema constrained to the Round 7 candidate shape.
- Uses the pseudonymized Round 7 prompt; raw LINE user ids are not added by the adapter.
- Parses provider JSON, validates Zod + Group/source/active-memory grounding before returning a classifier response, and requires provider token usage for reproducible billing.
- Adapter is not wired into webhook/runtime composition yet and no API key, pricing or FX value was guessed.

### Tests / validation

- Added tests for durable pricing snapshots, hallucinated-source rejection, structured Gemini request shape, pseudonymization and token usage parsing.
- Re-read PRODUCT_V1, architecture/progress handoff, recent commits, memory work/pipeline, credit billing and AI usage code before implementation.
- Full `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` remains unproven because GitHub Actions still fails before useful runner execution and this automation runtime has no dependency-capable checkout.
- No production Neon/LINE/Cloudflare/Gemini credentials were guessed or committed.

## Round 9 — highest priority

1. Re-check main CI; if a runner actually executes, fix all real install/typecheck/lint/test/build errors first.
2. Build a retry-safe memory AI orchestrator: claim request -> load grounded input -> load durable result or call classifier -> store validated result -> idempotent charge/AI usage -> persist every candidate -> mark request/batch succeeded.
3. Use a deterministic credit reference based on memory request id so retries cannot double-charge; construct usage only from the durable result snapshot, never from a fresh recomputation.
4. Define insufficient-credit behavior without another Gemini call: keep the validated result durable and defer settlement until credit is available.
5. Add tests for crash/retry boundaries: existing result skips classifier, stale result store cannot bill, already-billed retry does not double charge, candidate retries are idempotent, and only current fence can mark success.
6. Only after the full orchestrator is testable, wire it from the event-driven webhook path. Keep Gemini disabled until then.
7. Then implement Paid-only Reminder create/reserve, cancel/release, delivered/consume, followed by retention cleanup.
8. Generate initial Drizzle migration only after dependency-aware verification is available and the V1 schema is stable.

## Process note

Never bypass the durable-result, billing or request-fence boundaries to make Gemini appear connected sooner. Always update this file before the next handoff.
