# AFTERTRACE Development Progress

## Current status

Round 1 bootstrap in progress.

## Confirmed V1 baseline

- TypeScript monorepo with pnpm.
- API: Hono on Cloudflare Workers.
- LIFF Web: React + Vite + TypeScript on Cloudflare Pages.
- Database: PostgreSQL on Neon, accessed through Drizzle ORM.
- AI: Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis and no object storage.
- LINE messages are buffered short-term; memories are group-scoped long-term data.
- Memory extraction is event-driven based on message/character thresholds, not periodic DB polling.
- Automatic and explicit @AI memories share dedup/update/contradiction handling.
- All memory edits/deletes are auditable and source messages are traceable when LINE metadata permits.
- Credit model is prepaid, not subscription-based. Free/ad credit is consumed before paid credit; paid credit does not expire.
- Reminder is paid-only and should reserve credit when created.

## Round 1

### Goal

Create the repository foundation, durable product/architecture documentation, monorepo skeleton, API/Web bootstraps, database schema baseline, and CI-ready scripts so later scheduled rounds can continue without rediscovering decisions.

### Next

1. Complete workspace and app skeletons.
2. Add initial Drizzle schema and configuration.
3. Add LINE webhook vertical slice: signature verification -> group message buffer -> pending counters.
4. Add tests before Gemini memory extraction.
