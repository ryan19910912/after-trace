# AFTERTRACE

AFTERTRACE is being rebuilt as a public sports venue availability search + radar product.

The previous LINE-first AI memory assistant product is retired. Old LINE group, AI memory, Energy/commerce, reminder and proactive-push code is being removed rather than retained as compatibility debt.

## V1 product

- Search supported public sports venues for available booking slots.
- Start with Taipei and slot-based sports where booking pain is high, led by badminton.
- Normalize different official booking sources behind source adapters.
- Let users create watches by sport, venue/area, date/day-of-week and time window.
- Poll watched targets in the background and notify users when a matching slot becomes available.
- Send users back to the official booking channel; V1 does not book or pay on their behalf.
- No AI is required for V1.
- Web/PWA first.

## Target stack

- TypeScript + pnpm monorepo
- Hono on Cloudflare Workers
- React + Vite on Cloudflare Pages
- PostgreSQL on Neon + Drizzle ORM
- Cloudflare Cron Triggers for polling
- Web Push for the primary radar notification channel

Redis is not required for V1 unless later scale/locking requirements justify it.

## Rebuild status

The repository is currently undergoing a deliberate cleanup/rebuild from the old product. Do not use stale old-product modules as architectural precedent.

Read these two files before making rebuild changes:

- `docs/REBUILD_PLAN.md` — complete keep/remove/rebuild plan and target architecture.
- `docs/REBUILD_PROGRESS.md` — durable progress handoff, completed work and next batch.

Scheduled development rounds must read the latest `main` plus both files before choosing work, then update `REBUILD_PROGRESS.md` before finishing.