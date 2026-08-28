# AFTERTRACE Architecture

## V1 stack

- Language: TypeScript
- Monorepo: pnpm workspaces
- API framework: Hono
- API runtime: Cloudflare Workers
- LIFF: React + Vite + TypeScript
- Web hosting: Cloudflare Pages
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
   |-- LINE signature verification on the raw request body
   |-- group event parsing
   |-- idempotent conversation ingestion
   |-- threshold evaluation
   |-- extraction batch claim / lease
   |-- @AI commands
   |
   +--> Neon PostgreSQL
   +--> Gemini API
   +--> LINE Messaging API

LIFF React Web
   |
   v
Cloudflare Pages --> Worker API --> Neon
```

## LINE webhook ingestion

`POST /webhooks/line` verifies `x-line-signature` before parsing JSON. V1 only treats LINE group context as an AFTERTRACE memory boundary; direct-user context is ignored by the group ingestion pipeline.

Supported message metadata is normalized before persistence. Text and location text are stored in the short-lived conversation buffer. Image/video/audio/file/sticker events retain reference metadata only; AFTERTRACE does not copy their binary content in V1.

`conversation_messages.line_message_id` is unique. A redelivered LINE message therefore does not increment the group's pending counters twice. New messages increment pending message/character counters with database-side arithmetic so concurrent webhook deliveries do not overwrite one another.

LINE webhook events are processed in their original payload order. LINE `join` activates/upserts the group. LINE `leave` marks it inactive. While a group is inactive, later or redelivered message events are ignored; only a new `join` reactivates ingestion. Retention cleanup is a separate low-frequency process governed by paid/unpaid retention policy.

The conversation buffer keeps `quotedMessageId`, `quoteToken`, source user, LINE timestamp, and safe message metadata needed for reply-based `@AI` flows and later memory source attribution. Long-term memories persist their own source timestamp because conversation-buffer rows are not permanent.

Every active sender observed in a group is persisted as a group-member snapshot. This supports later LIFF membership checks, audit actors, and welcome-credit attribution without introducing Owner/Admin roles; all group members remain managers.

## Event-driven extraction claim

Do not poll PostgreSQL every few minutes for conversation thresholds. Incoming LINE events already wake the Worker, so the ingestion flow stores the message, updates pending counters, and determines whether extraction may be due.

A threshold decision must never call Gemini directly. The database claim layer owns a concrete immutable set of currently-unassigned conversation rows by assigning them to a `conversation_extraction_batches` record. Only one open claim per group is permitted through a nullable unique claim key. Claiming and decrementing pending counters happen in one PostgreSQL CTE statement so concurrent webhook writes are not lost.

Claims use a bounded lease. If a worker dies or Gemini fails, the batch remains the same batch; after the lease/retry time expires another worker can reclaim it with `FOR UPDATE SKIP LOCKED` and increment the attempt counter. Success releases the open claim key and marks the batch `SUCCEEDED`. This avoids duplicate Gemini jobs while also avoiding permanently stranded messages.

The previous successful extraction batch should remain available as context for the next extraction. Conversation cleanup must therefore happen only after the next extraction has succeeded and memory persistence is complete.

## Credit and AI-cost safety

Credit accounting is stored in TWD internal-cost units with 8 decimal places. Consumption order is strictly `WELCOME -> AD -> PAID`; paid reminder reservations use `PAID` only. Business services must never silently overdraw a bucket.

Every billable AI usage event records the exact token counts together with the pricing snapshot used for that request: input/output USD-per-million-token rates, USD/TWD conversion rate, USD cost, TWD cost, and the TWD amount actually charged. Pricing and FX are runtime inputs/snapshots rather than hidden constants in the memory domain.

Credit ledger writes must be reference-idempotent so retries cannot consume or grant the same logical operation twice. The current schema has the reference uniqueness foundation; atomic Drizzle/SQL ledger mutation is the next implementation step before Gemini is enabled.

## Explicit memory command boundary

Reply-based or tagged commands such as `@AI 記住 ...` are detected separately from ordinary group chat. A bare phrase in normal group conversation must not become an explicit command accidentally. Reply commands preserve the quoted LINE message id as the intended source. Explicit commands still enter the same future memory candidate/dedup/update/contradiction pipeline as automatic extraction.

## Portability

Business rules live in services/domain modules rather than Cloudflare-specific route handlers. Cloudflare bindings/adapters stay at infrastructure boundaries so heavy workloads can later move to Cloud Run without rewriting the domain.

The conversation ingestion service and extraction coordinator depend on repository interfaces; current persistence adapters target Drizzle/Neon.

## Scale path

V1: LINE -> Workers -> Neon.

When ingestion grows, introduce a queue between the webhook and processing rather than replacing the edge entry point. Heavy/native/CPU-bound workloads may be delegated to Cloud Run later.

## Observability

Use structured logs with request/event ids, event type, non-sensitive correlation identifiers, latency, AI model/token/cost metadata, and error codes. Never log secrets, raw LINE group/user identifiers, or full private conversation text by default.
