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

## Event-driven ingestion

Do not poll PostgreSQL every few minutes for conversation thresholds. Incoming LINE events already wake the Worker, so the ingestion flow stores the message, updates pending counters, and determines whether extraction is due.

The threshold decision itself must not directly create duplicate Gemini jobs. Before Gemini extraction is enabled, the next implementation stage must add a database-backed batch claim/state transition so only one extraction owns a pending batch.

Scheduled infrastructure is reserved for genuinely time-based behavior such as paid reminders and low-frequency retention cleanup.

## Portability

Business rules live in services/domain modules rather than Cloudflare-specific route handlers. Cloudflare bindings/adapters stay at infrastructure boundaries so heavy workloads can later move to Cloud Run without rewriting the domain.

The conversation ingestion service depends on a repository interface; the current adapter is Drizzle/Neon.

## Scale path

V1: LINE -> Workers -> Neon.

When ingestion grows, introduce a queue between the webhook and processing rather than replacing the edge entry point. Heavy/native/CPU-bound workloads may be delegated to Cloud Run later.

## Observability

Use structured logs with request/event ids, event type, non-sensitive correlation identifiers, latency, AI model/token/cost metadata, and error codes. Never log secrets, raw LINE group/user identifiers, or full private conversation text by default.
