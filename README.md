# AFTERTRACE

LINE-first shared life memory assistant.

AFTERTRACE observes supported messages in a LINE group, keeps only a bounded recent conversation buffer, extracts useful long-term group memories with AI, and provides a LIFF interface for search and management.

## V1 stack

- TypeScript + pnpm monorepo
- Hono on Cloudflare Workers
- React + Vite LIFF on Cloudflare Pages
- PostgreSQL on Neon + Drizzle ORM
- Gemini 2.5 Flash-Lite Standard
- LINE Messaging API / LIFF

V1 intentionally does not use Redis or object storage.

## Workspace

```text
apps/
  api/      Hono Cloudflare Worker
  web/      React/Vite LIFF
packages/
  shared/   shared domain types/schemas
docs/
  PRODUCT_V1.md
  ARCHITECTURE.md
  AI_SAFETY.md
  DEVELOPMENT_PROGRESS.md
drizzle/    generated migrations
```

## Local setup

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
pnpm build
```

Cloudflare Worker secrets must be configured separately for deployment; never commit production credentials. Billable AI additionally requires explicit provider pricing/FX and a global free-AI budget ceiling; see `docs/AI_SAFETY.md`.

## Development status

See `docs/DEVELOPMENT_PROGRESS.md`. Scheduled development rounds must read that file and the current repository state before choosing the next work item.
