# AFTERTRACE

AFTERTRACE is a Web/PWA-first sports venue availability search and radar product.

The product is being rebuilt from its retired LINE/AI memory-assistant prototype. The new V1 does not use AI and does not book or pay on a user's behalf. It normalizes public venue availability, lets users search across supported venues, and will notify users when a watched slot becomes available before sending them to the official booking channel.

## V1 stack

- TypeScript + pnpm monorepo
- Hono on Cloudflare Workers
- React + Vite on Cloudflare Pages
- PostgreSQL on Neon + Drizzle ORM
- Public source adapters for venue/slot availability
- Web Push for Radar notifications (next implementation phase)

## Workspace

```text
apps/
  api/       public availability API + future scheduler/source sync
  web/       mobile-first search/PWA
packages/
  shared/    shared availability domain types
docs/
  REBUILD_PLAN.md
  REBUILD_PROGRESS.md
drizzle/     clean sports-availability schema baseline
```

## Local setup

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:schema:check
```

`DATABASE_URL` must point at the new sports-availability database. The clean rebuild baseline intentionally refuses to run against a detected legacy LINE/AI schema; create a fresh Neon database/branch instead of carrying retired product tables forward.

## Current API surface

- `GET /health`
- `GET /api/v1/sports`
- `GET /api/v1/venues? sport=...`
- `GET /api/v1/availability?sport=...&venueId=...&district=...&date=...&start=...&end=...`

See `docs/REBUILD_PROGRESS.md` for the exact implementation status and next work batch.
