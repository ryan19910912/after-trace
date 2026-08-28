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
   |-- LINE signature verification
   |-- conversation ingestion
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

## Event-driven ingestion

Do not poll PostgreSQL every few minutes for conversation thresholds. Incoming LINE events already wake the Worker, so the ingestion transaction updates pending counters and determines whether extraction is due.

Scheduled infrastructure is reserved for genuinely time-based behavior such as paid reminders and low-frequency retention cleanup.

## Portability

Business rules must live in services/domain modules rather than Cloudflare-specific route handlers. Cloudflare bindings/adapters stay at infrastructure boundaries so heavy workloads can later move to Cloud Run without rewriting the domain.

## Scale path

V1: LINE -> Workers -> Neon.

When ingestion grows, introduce a queue between the webhook and processing rather than replacing the edge entry point. Heavy/native/CPU-bound workloads may be delegated to Cloud Run later.

## Observability

Use structured logs with request/event ids, event type, safe group identifiers, latency, AI model/token/cost metadata, and error codes. Never log secrets or full private conversation text by default.
