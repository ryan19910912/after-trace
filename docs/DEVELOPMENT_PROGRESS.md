# AFTERTRACE Development Progress

## Current status

Round 7 is complete on `main`. The backend now has a unified grounded classification-input boundary for EXPLICIT and AUTOMATIC memory requests, a strict Zod classifier-output contract, a model-facing prompt boundary that pseudonymizes LINE users, and explicit runtime Gemini pricing/FX configuration. Gemini network calls remain intentionally disabled: the next safety gap is durable reuse of a validated model response across Worker crashes/retries before billing and candidate mutation are orchestrated.

GitHub Actions remains an external environment blocker. The latest checked Round 7 run (`33222459090`, commit `c0cbedd`) again finished before Checkout with `verify.steps=[]`, `runner_id=0`, and no runner name. Full dependency-aware workspace verification is therefore still unproven.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo; Hono on Cloudflare Workers; React/Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle; Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE Group is the isolation boundary for context, memories, reminders, usage and credits.
- Every Group member can manage memories; mutations/deletions require audit history and source metadata where available.
- Conversation extraction is event-driven and retry-safe; previous successful batch remains available as context.
- Explicit and automatic memory work share one candidate pipeline.
- Credit order is Welcome -> Ad -> Paid; paid value does not expire.
- Reminder is paid-only and must reserve PAID value before delivery.
- Never-paid inactive Groups retain recoverable product data for 30 days; paid Groups for 1 year.

## Completed rounds

### Round 1

Repository/product/architecture bootstrap, pnpm workspace, Worker/LIFF skeletons, Neon/Drizzle foundation, CI, env template and initial schema.

### Round 2

LINE signature verification, ordered event parsing, conversation ingestion/idempotency, group lifecycle protection, source metadata, extraction thresholds and tests.

### Round 3

Database-owned extraction batches/leases, group-member persistence, fixed-point credit primitives, AI cost snapshot calculator and explicit memory-command detection.

### Round 4

Webhook-to-extraction claim wiring, logical credit-operation idempotency, WELCOME -> AD -> PAID consumption, PAID reservation settlement and AI usage/credit coupling.

### Round 5

Welcome Credit attribution, Rewarded Ad policy/grant primitives, persistent explicit-memory requests, source resolution and extraction current/previous-context accessor.

### Round 6

Automatic/explicit shared request envelope, request lease/fencing ownership, active-memory lookup and idempotent `NEW / DUPLICATE / UPDATE / CONTRADICT` persistence/audit transaction.

## Round 7 — completed

### Unified classifier input

- Added `MemoryClassificationInputService` as the only input-building boundary for claimed memory requests.
- EXPLICIT requests load exactly the persisted source conversation row plus the user's instruction and Group-scoped active memories.
- AUTOMATIC requests load the claimed extraction batch, the previous successful batch as context, and Group-scoped active memories.
- Added `DrizzleMemorySourceMessageRepository` with Group + conversation-row validation for explicit sources.
- Automatic extraction input is rejected if the batch belongs to another Group.

### Structured classifier contract and grounding

- Added strict Zod schemas for classifier responses; unknown/unexpected shapes are rejected before persistence.
- Candidate decisions are limited to `NEW / DUPLICATE / UPDATE / CONTRADICT`.
- NEW requires `targetMemoryId=null`; all other decisions require a positive target id.
- `candidateIndex` must equal the array index. This keeps `(request_id, candidate_index)` stable across retries.
- A candidate may cite only a `sourceConversationMessageId` from the current request messages. Previous extraction context is context-only and cannot become a fresh long-term source attribution.
- A non-null `targetMemoryId` must exist in the request's Group-scoped ACTIVE memory set, blocking hallucinated cross-memory ids before SQL mutation.
- Added `MemoryClassifierPort` / `MemoryClassifierResponse` so the future Gemini adapter is behind a provider-neutral boundary.

### Classifier prompt/privacy boundary

- Added a deterministic prompt builder that separates current messages, previous context, active memories and allowed current source ids.
- Raw LINE user ids are not sent in the model prompt. Per-request ephemeral aliases (`speaker-1`, `speaker-2`, ...) preserve speaker continuity across current + previous context without exposing stable platform identifiers unnecessarily.
- Prompt instructions explicitly prohibit using previous context as a new source and prohibit unsupported sensitive inference.

### Runtime AI pricing/FX

- Added `resolveAiRuntimeConfig` for Gemini model + input/output USD-per-million-token pricing + USD/TWD snapshot.
- Model baseline defaults to `gemini-2.5-flash-lite`, matching the confirmed V1 model choice.
- Pricing and FX have no hidden defaults. Billable AI configuration throws until explicit runtime snapshots are supplied, preventing stale hard-coded provider pricing.
- `.env.example` now documents `GEMINI_MODEL`, `GEMINI_INPUT_USD_PER_MILLION_TOKENS`, `GEMINI_OUTPUT_USD_PER_MILLION_TOKENS`, and `USD_TWD_RATE` without guessing real production values.

### Tests added

- Unified explicit input + automatic current/previous-context + cross-Group rejection tests.
- Classifier grounding tests for current-source-only attribution, active-target-only references and stable candidate indexes.
- Prompt test for previous-context semantics and LINE user-id pseudonymization.
- Runtime AI configuration tests for required pricing/FX and model resolution.

## Round 7 validation

### Completed validation

- Re-read product, architecture, Round 6 handoff, recent commits and the existing extraction/memory/AI cost code before modifying the repository.
- Re-checked GitHub Actions. Run `33222459090` for `c0cbedd` failed with `steps=[]`, `runner_id=0`, empty runner name and no executed Checkout/build/test step. This remains infrastructure-level evidence, not a repository test failure.
- Local runtime still has Node 22.16.0 and TypeScript 5.8.3 but no pnpm. A no-resolution TypeScript pass over the new files found only expected missing external/local-module declarations and no syntax errors.
- Reviewed grounding invariants manually: Group match, explicit-source existence, previous-context source prohibition, active-target allow-list, stable candidate indexes and prompt user-id pseudonymization.

### Still unproven / intentionally disabled

- Real `pnpm install`, workspace `typecheck`, ESLint, Vitest execution, Wrangler dry-run, Vite build and Drizzle Kit generation cannot be claimed green until GitHub Actions obtains a runner or another dependency-capable runtime is available.
- Gemini network invocation is still disabled; no production API key, Neon, LINE or Cloudflare credential was guessed or committed.
- No provider token pricing or FX value was guessed. Production values must be configured explicitly.
- No database migration has been generated or executed yet.

## Round 8 — highest priority

1. Re-check the latest `main` CI run; if a runner finally executes steps, fix all real install/typecheck/lint/test/build errors before adding behavior.
2. Add a durable validated-classifier-result record keyed by memory request. Persist it only while the request attempt fence is current, so a Worker crash after a successful Gemini response can reuse the first validated response instead of calling Gemini again.
3. Store provider/model, structured output, token counts, latency and the pricing/FX snapshot used for that call so billing/debug data is reproducible.
4. Implement the Gemini 2.5 Flash-Lite structured-output adapter behind `MemoryClassifierPort`; validate through the Round 7 Zod/grounding contract before any memory mutation.
5. Build the retry-safe orchestrator: claim request -> load grounded input -> reuse/call classifier -> persist validated model result -> charge via idempotent AI credit reference -> record AI usage -> persist candidates -> mark request/batch succeeded. Retryable failure must defer without duplicate credit consumption or candidate mutation.
6. Do not enable the Gemini path from the webhook until the durable result + billing + usage + candidate + success path above is complete and testable.
7. After the memory AI path is safe, implement Paid-only Reminder create/reserve, cancel/release, delivered/consume; then retention cleanup.
8. Generate the initial Drizzle migration only after real dependency-aware CI/build is available and the V1 schema is stable.

## Process note

Keep Gemini disabled until request ownership, grounded structured output, durable model-result reuse, credit charging, AI usage metering, candidate persistence and request settlement form one retry-safe path. Always update this file before handing work to the next round.
