# AFTERTRACE Architecture

## V1 stack

- Language: TypeScript
- Monorepo: pnpm workspaces
- API framework/runtime: Hono on Cloudflare Workers
- LIFF: React + Vite + TypeScript on Cloudflare Pages
- Database: PostgreSQL on Neon
- Data access/migrations: Drizzle ORM / Drizzle Kit
- AI: Gemini 2.5 Flash-Lite Standard
- V1 intentionally has no Redis and no object storage.

## Runtime flow

```text
LINE group
   |
   v
Cloudflare Worker / Hono
   |-- LINE signature verification on raw body
   |-- ordered group event parsing
   |-- idempotent conversation ingestion
   |-- extraction batch claim / lease
   |-- explicit @AI memory requests
   |-- automatic memory requests
   |-- memory request claim / lease
   |-- grounded classifier input + structured validation
   |-- memory candidate classification + persistence
   |
   +--> Neon PostgreSQL
   +--> Gemini API (kept disabled until billing/orchestration is complete)
   +--> LINE Messaging API

LIFF React Web
   |
   v
Cloudflare Pages --> Worker API --> Neon
```

## LINE webhook ingestion

`POST /webhooks/line` verifies `x-line-signature` before JSON parsing. Only LINE group context is a V1 memory boundary; direct-user context is ignored by the group ingestion pipeline.

Supported message metadata is normalized before persistence. Text/location text is stored in the bounded conversation buffer. Image/video/audio/file/sticker events retain reference metadata only; AFTERTRACE does not copy binaries in V1.

`conversation_messages.line_message_id` is unique, so redelivery cannot increment pending counters twice. New messages update pending message/character counters with database-side arithmetic. Events are processed in payload order. `join` activates/upserts a group; `leave` marks it inactive. Messages received while inactive are ignored until a later `join` reactivates the group.

The conversation buffer keeps quoted message id, quote token, source user, LINE timestamp and safe metadata needed for reply-based flows and later source attribution. Long-term memories copy their own source metadata because conversation-buffer rows are temporary.

Every observed sender is persisted as a group-member snapshot for LIFF membership checks, audit actors and Welcome Credit attribution. This does not create Owner/Admin roles; every group member remains a memory manager.

## Event-driven extraction ownership

Do not poll PostgreSQL for extraction thresholds. Incoming LINE events already wake the Worker, so ingestion updates counters and asks the database whether work is due.

A threshold decision never calls Gemini directly. PostgreSQL atomically claims an immutable set of currently-unassigned conversation rows into `conversation_extraction_batches`. Only one open extraction claim per Group is allowed. Claiming the rows and decrementing pending counters happen in one database statement so concurrent webhook writes are not lost.

The webhook attempts a claim after every active message, including duplicate/redelivered events. This lets a later event reclaim an expired lease after a Worker failure even when that event itself did not cross a threshold.

The previous successful extraction batch remains available as context for the next batch. Conversation cleanup therefore happens only after the later extraction and memory persistence succeed.

## Memory request ownership

Explicit `@AI 記住...` / reply commands and automatic extraction work share `memory_candidate_requests`. Explicit commands are persisted immediately. A reply whose source has already left the conversation buffer becomes `BLOCKED_SOURCE_MISSING` rather than inventing content.

Every extraction batch maps to exactly one AUTOMATIC memory request. `automatic_memory_request_keys` uses extraction batch identity as the idempotency boundary; creation is serialized by locking the extraction batch row so concurrent retries cannot create two requests.

Processing ownership is separate from request identity. `memory_request_work_states` stores a monotonic attempt count and a bounded lease. Claiming uses `FOR UPDATE SKIP LOCKED`; an expired claim can be reclaimed, but every downstream memory mutation must present the current attempt count as a fencing token. A stale Worker therefore cannot mutate memories or mark a newer attempt complete.

When an AUTOMATIC request is successfully completed, its request state and the owning `conversation_extraction_batches` row are completed in the same PostgreSQL statement. This prevents a crash gap where memory persistence succeeds but the extraction batch remains claimable.

## Memory classifier grounding

Both request origins now build the same `MemoryClassificationInput` envelope before a model can be called.

- EXPLICIT requests contain the resolved source conversation row, the user's instruction, and current Group-scoped active memories.
- AUTOMATIC requests contain the claimed extraction batch, the previous successful batch as context, and the same Group-scoped active memories.
- Previous-batch rows are context only. They are never valid `sourceConversationMessageId` values for newly emitted candidates.
- Classifier output may target only ids from the Group's current ACTIVE memories.
- Candidate indexes must be stable (`candidateIndex === array index`) because `(request_id, candidate_index)` is the persistence idempotency key.

The model-facing prompt does not expose raw LINE user ids. Per-request ephemeral aliases (`speaker-1`, `speaker-2`, ...) preserve speaker continuity across current and previous context while avoiding unnecessary stable platform identifiers in the provider payload.

The classifier contract is strict Zod structured output. Unknown fields, invalid decisions, invalid target shapes, hallucinated source ids, hallucinated active-memory ids, and unstable candidate indexes are rejected before memory mutation.

## Memory candidate persistence

The classifier is allowed to emit only `NEW`, `DUPLICATE`, `UPDATE`, or `CONTRADICT`.

- `NEW`: must not target an existing memory; creates a new ACTIVE memory.
- `DUPLICATE`: must target an ACTIVE memory; creates no second memory row.
- `UPDATE`: must target an ACTIVE memory; creates a replacement ACTIVE memory and marks the prior row SUPERSEDED.
- `CONTRADICT`: same persistence shape as UPDATE, but is audited distinctly so product/debug tooling can distinguish enrichment from contradiction.

`memory_candidate_results` is uniquely keyed by `(request_id, candidate_index)`. An exact retry returns the existing result; a retry that changes decision, target, source or content is rejected as a conflict rather than silently mutating a second time.

Candidate persistence validates that both the source conversation row and any target memory belong to the request's Group. UPDATE/CONTRADICT lock the active target before superseding it. New long-term memory rows copy LINE source message id, quote token, source user, source timestamp and safe metadata from the source conversation row.

Every candidate outcome writes an audit event: `MEMORY_CREATED`, `MEMORY_DUPLICATE_SKIPPED`, `MEMORY_UPDATED`, or `MEMORY_CONTRADICTED`.

Gemini remains downstream of this ownership/persistence boundary. It must not be enabled until the structured classifier adapter, durable validated model-result reuse, runtime pricing/FX inputs, credit charge and AI usage persistence are wired into one retry-safe orchestration path.

## Credit and AI-cost safety

Credit accounting uses exact TWD internal-cost units with 8 decimal places. Consumption order is `WELCOME -> AD -> PAID`; paid reminder reservations use `PAID` only. Business services must never silently overdraw a bucket.

Logical credit idempotency lives at the operation level. `credit_operations` owns one reconciliation key for `(group, operation type, reference type, reference id)`. One CONSUME operation may fan out into WELCOME/AD/PAID ledger rows without allowing a retry to consume a different bucket again.

Grant, consume, reserve, release and reserved-consume are atomic PostgreSQL mutations. Reusing a reference with different amount/scope is a reference conflict.

Reminder reservations use `RESERVED -> CONSUMED` on successful delivery or `RESERVED -> RELEASED` on cancellation. Reserving moves PAID available value to PAID reserved; release returns it; successful delivery removes reserved value without touching free credit.

A successful PAID grant marks the Group `hasPaid=true`, which later drives retention policy.

Every billable AI usage event records provider/model, token counts, input/output USD-per-million-token pricing snapshot, USD/TWD conversion snapshot, USD cost, TWD cost and actual charged TWD. AI billing is retry-safe by tying usage persistence to the logical credit operation id.

Provider token prices and USD/TWD FX are runtime configuration, not memory-domain constants. Billable AI remains disabled when these snapshots are missing, preventing silent use of stale hard-coded pricing.

## Portability and scale

Business rules live in services/domain modules rather than Cloudflare route handlers. Cloudflare bindings and Neon/Drizzle implementations stay at adapter boundaries, so heavy workloads can later move to Cloud Run without rewriting domain behavior.

V1 is LINE -> Workers -> Neon. If ingestion grows, introduce a queue between webhook acceptance and processing rather than replacing the edge entry point.

## Observability

Use structured logs with request/event ids, non-sensitive correlation identifiers, event type, latency and AI model/token/cost metadata. Never log secrets, raw LINE group/user identifiers, or full private conversation text by default.
