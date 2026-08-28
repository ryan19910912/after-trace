# AFTERTRACE Development Progress

## Current status

Round 6 is complete on `main`. The backend now has database-owned memory-request work leases and an idempotent transaction boundary for `NEW / DUPLICATE / UPDATE / CONTRADICT`. Automatic extraction claims now create/reuse the same persistent request envelope used by explicit `@AI 記住` flows. Gemini remains intentionally disabled until the classifier adapter and AI billing orchestration are connected to this safe persistence layer.

GitHub Actions remains an external environment blocker: Round 6 runs for `9fd626a` and `f9b6e47` both completed before any workflow step was available; the latest `verify` job again returned no steps/log URL. Full dependency-aware workspace verification is therefore still unproven.

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

## Round 6 — completed

### Shared automatic/explicit request envelope

- Extraction claims now create or reuse one `AUTOMATIC` `memory_candidate_requests` row instead of stopping at a log line.
- `automatic_memory_request_keys` makes extraction batch identity the durable automatic-request idempotency boundary.
- Automatic request creation locks the extraction batch before checking/inserting the key, closing the concurrent double-create race.
- Explicit requests continue to use the same `memory_candidate_requests` table and will enter the same classifier/persistence path.

### Retry-safe memory work ownership

- Added `memory_request_work_states` with `attempt_count`, claim timestamp, lease expiry, completion timestamp and last error code.
- `MemoryWorkCoordinator` calculates a configurable request lease (`MEMORY_REQUEST_LEASE_SECONDS`, default 120 seconds).
- `DrizzleMemoryWorkRepository` claims oldest due work with `FOR UPDATE SKIP LOCKED` and increments the attempt count on reclaim.
- `attempt_count` is a fencing token: candidate persistence, success and failure settlement require the current claim attempt so a stale Worker cannot win after another Worker reclaimed the request.
- Failure returns the request to PENDING but keeps a retry-not-before timestamp in the work state.
- Successful AUTOMATIC request completion atomically marks both the memory request and its extraction batch SUCCEEDED and releases the extraction active-claim key.

### Candidate classification/persistence transaction

- Added the domain boundary for `NEW / DUPLICATE / UPDATE / CONTRADICT` plus validation that NEW has no target and every other decision targets an existing memory.
- Added `memory_candidate_results` with unique `(request_id, candidate_index)` as candidate-level idempotency.
- Exact retries return the previous result; conflicting retries with changed decision/target/source/category/subject/content are rejected.
- Persistence checks the request claim fence, validates the source conversation row belongs to the Group, and locks any target ACTIVE memory.
- NEW creates a new ACTIVE memory.
- DUPLICATE creates no extra memory and records the existing memory as the persisted result.
- UPDATE/CONTRADICT create a replacement ACTIVE memory and mark the previous row SUPERSEDED with `superseded_by_id`.
- New memory rows copy LINE source message id, quote token, sender, timestamp and safe metadata from the bounded conversation row.
- Candidate outcomes write distinct audit actions: `MEMORY_CREATED`, `MEMORY_DUPLICATE_SKIPPED`, `MEMORY_UPDATED`, `MEMORY_CONTRADICTED`.
- Active-memory lookup for the future classifier is implemented and Group-scoped.

### Tests/config/schema

- Added unit coverage for automatic request identity, request lease ownership/fencing behavior and candidate decision validation/normalization.
- Added `schema-round6.ts` and included it in Drizzle Kit configuration.
- Added `MEMORY_REQUEST_LEASE_SECONDS=120` to `.env.example` and product configuration.
- Tightened the new test callback types so strict local TypeScript checks do not depend on Vitest contextual typing.

## Round 6 validation

### Completed validation

- Re-checked GitHub Actions after both Round 6 code commits. Run `33219580100` (`9fd626a`) and run `33219673297` (`f9b6e47`) both ended in failure before usable workflow steps; the latest `verify` job had `steps=null` and no log URL. This remains a runner/environment failure rather than evidence of a repository test/build failure.
- Runtime has Node 22.16.0 and TypeScript 5.8.3, but no pnpm; outbound npm registry access timed out, so dependency installation could not be performed locally.
- Using lightweight declarations for Drizzle/Vitest, strict TypeScript compilation succeeded for the new production memory work/pipeline modules and SQL adapters. After explicitly typing two test callback parameters, the new pipeline test also passes the lightweight strict TypeScript check.
- Reviewed the SQL ownership model for stale-worker fencing, Group/source validation, target locking, idempotent candidate retries and atomic automatic-request/extraction completion.

### Still unproven

- Real `pnpm install`, workspace `typecheck`, ESLint, Vitest execution, Wrangler dry-run, Vite build and Drizzle Kit generation cannot be claimed green until GitHub Actions actually obtains a runner or another dependency-capable runtime is available.
- No Neon/LINE/Cloudflare/Gemini production credential was guessed or committed.
- No database migration has been generated or executed yet.

## Round 7 — highest priority

1. Re-check the latest `main` CI run. If steps finally execute, fix every real install/typecheck/lint/test/build issue before adding more product behavior.
2. Build one unified classification-input service for a claimed request:
   - EXPLICIT: instruction + resolved source conversation message.
   - AUTOMATIC: extraction batch current messages + previous successful context.
   - both: Group-scoped active memories and source ids available to structured output.
3. Add a strict Zod schema/port for classifier output and validate every candidate before persistence. Do not call a network model until this contract is testable.
4. Add runtime Gemini pricing + USD/TWD inputs and wire Gemini 2.5 Flash-Lite Standard through the existing AI cost/billing primitives. Every billable response must have one retry-safe credit operation + one AI usage event.
5. Add the orchestrator: claim request -> load input -> call structured classifier -> persist candidates -> mark request/batch succeeded; retryable failure -> defer without duplicate mutation or charge.
6. Then implement Paid-only Reminder create/reserve, cancel/release, delivered/consume and retention cleanup.
7. Generate the initial Drizzle migration only after real dependency-aware CI/build is available and the V1 schema above is stable.

## Process note

Keep Gemini disabled until the request claim, structured response validation, candidate persistence, credit charging and AI usage metering form one retry-safe path. Always update this file before handing work to the next round.
