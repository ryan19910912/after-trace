# AFTERTRACE

AFTERTRACE is a Web/PWA-first sports venue availability search and radar product.

The product is being rebuilt from its retired LINE/AI memory-assistant prototype. The new V1 does not use AI and does not book or pay on a user's behalf. It normalizes public venue availability, lets users search across supported venues, lets a browser create private Radar watch rules, and prepares idempotent notification work when a watched slot becomes available before sending the user to the official booking channel.

## V1 stack

- TypeScript + pnpm monorepo
- Hono on Cloudflare Workers
- React + Vite on Cloudflare Pages
- PostgreSQL on Neon + Drizzle ORM
- Public source adapters for venue/slot availability
- Cloudflare Cron polling with bounded target claiming
- Server-issued anonymous browser identity for Radar ownership
- Web Push delivery (next implementation phase)

## Workspace

```text
apps/
  api/       public availability API + Radar API + source sync + polling scheduler
  web/       mobile-first search/PWA
packages/
  shared/    shared availability domain types
docs/
  REBUILD_PLAN.md
  REBUILD_PROGRESS.md
drizzle/     clean sports-availability schema + incremental rebuild migrations
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

Public search:

- `GET /health`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?sport=...&venueId=...&district=...&date=...&start=...&end=...`

Radar ownership and watches:

- `POST /api/v1/session/anonymous` — issues a high-entropy browser token; the database stores only its SHA-256 identity subject.
- `GET /api/v1/watch-rules`
- `POST /api/v1/watch-rules` — requires `Authorization: Bearer <token>` and an `Idempotency-Key` header.
- `PATCH /api/v1/watch-rules/:watchRuleId`
- `DELETE /api/v1/watch-rules/:watchRuleId`

Watch conditions support sport, venue IDs, city/district, date range, day-of-week (`0` Sunday through `6` Saturday) and time window. Watch ownership is isolated by the anonymous browser identity; no LINE identity is used.

The Worker cron runs every minute, but poll targets are individually scheduled and claimed in bounded batches. Unwatched targets default to five-minute polling; targets covered by an enabled watch are raised to higher scheduler priority and a three-minute interval, still clamped by each source's minimum interval. One-minute per-target polling remains disabled until live source behavior is measured.

New `AVAILABLE` events are matched once against watches. Matching creates idempotent `PENDING` Web Push delivery intents; actual subscription registration and Push sending are the next implementation phase.

Launch synchronization is badminton-first; additional sports stay behind the generic source/domain model until live per-venue coverage is verified.

See `docs/REBUILD_PROGRESS.md` for the exact implementation status and next work batch.
