# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every manual or scheduled round must read both this file and `docs/REBUILD_PLAN.md` before changing code, then update this file before finishing.

## Current product target

Public sports venue availability search + radar.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI requirement.
- Do not book/pay for users; direct them to official booking channels.
- Prioritize slot-based sports with real availability pain: badminton first, then tennis/table tennis/squash and other sports only where source data and booking behavior fit.
- Public-source polling + normalized availability + conditional notifications are the product core.

## Round 0 — 2026-08-31

### Inspected on current `main`

- Root workspace scripts and pnpm monorepo structure.
- `apps/api/package.json`: backend dependencies are already lean and suitable for the rebuild (`Hono`, `Drizzle`, Neon, Zod); no AI SDK dependency is required at package level.
- `apps/web/package.json`: React/Vite stack is reusable.
- `apps/admin/package.json`: React/Vite shell exists; usefulness for the new product is not yet proven.
- `apps/api/src/index.ts`: current runtime is deeply coupled to LINE webhook ingestion, AI chat/intent routing, conversation extraction, memory, Energy, commerce and group-management flows. This file should be replaced rather than incrementally patched.
- `apps/api/src/db/schema.ts`: core schema is entirely old LINE-group/memory/conversation domain and should not survive in the rebuilt application schema.
- `apps/api/src/db/schema-all.ts`: exports many historical round-based schema files (`schema-round5` ... `schema-round20`), indicating substantial old-product database debt that must be deliberately removed, not left exported.
- The old README and old product/architecture/AI/progress documents all described the retired LINE-first AI memory assistant.

### Decisions made

**Keep/reuse:**

- pnpm monorepo.
- Cloudflare Worker/Hono API platform.
- React/Vite web platform.
- Neon PostgreSQL + Drizzle.
- Generic lint/typecheck/test/build tooling.

**Remove/rebuild:**

- LINE group runtime and LIFF-specific product flows.
- conversation/extraction/memory/AI runtime.
- Energy/commerce/rewarded-ad accounting.
- reminder/proactive old-product features.
- old product database schema and compatibility tables.
- stale old-product docs.

**Needs inspection before final decision:**

- current auth implementation.
- admin app.
- shared package contents.
- CI/deployment configs.
- exact full list of old API modules/schema files/migrations.

### Changes completed this round

- Added `docs/REBUILD_PLAN.md` with full target architecture, new domain model, cleanup phases and definition of done.
- Added this `docs/REBUILD_PROGRESS.md` handoff document.
- Replaced `README.md` so the repository now describes the sports availability/radar rebuild instead of the retired AI memory product.
- Deleted obsolete `docs/PRODUCT_V1.md`.
- Deleted obsolete `docs/AI_SAFETY.md`.
- Deleted obsolete `docs/ARCHITECTURE.md`.
- Deleted obsolete `docs/DEVELOPMENT_PROGRESS.md` and replaced its handoff role with this file.
- Created an hourly scheduled rebuild task. Every run must read latest `main`, `REBUILD_PLAN.md` and this file, implement a coherent batch directly on `main`, and update this progress file before finishing.

### Verification performed

- Confirmed current repository default branch is `main` and the connected GitHub account has push/admin access.
- Confirmed the retained API/web package-level dependencies remain suitable for the target architecture.
- No runtime code was removed in Round 0 because the API entry point is highly cross-coupled; Phase 1 should remove it as one coherent dependency-aware batch rather than leave a half-broken intermediate runtime.

## Next round — planned

1. Re-read latest `main`, `REBUILD_PLAN.md` and this progress file.
2. Inspect/discover the complete API module set, web source, shared package, admin source, wrangler/config files, schema-round files and Drizzle migrations.
3. Begin Phase 1 with a large coherent runtime cut: replace `apps/api/src/index.ts` with a minimal new-product API shell and delete old LINE/AI/memory/Energy/commerce/reminder/proactive modules that are no longer referenced.
4. Clean obsolete environment bindings/configuration in the same batch.
5. If feasible without leaving the repo in an incoherent state, begin the new venue/sport/availability schema immediately after removing old runtime exports.
6. Update this file with exact files changed/deleted, verification results and the next batch.

## Remaining phases

- [x] Phase 0 — pivot docs + initial inventory/README cleanup.
- [ ] Phase 1 — remove old runtime surface.
- [ ] Phase 2 — clean database rebuild.
- [ ] Phase 3 — Taipei source adapter + search.
- [ ] Phase 4 — radar/watch + Web Push.
- [ ] Phase 5 — web/PWA rebuild.
- [ ] Phase 6 — final dependency/docs/config cleanup and verification.

## Scheduled-round rules

Each scheduled round must:

1. Read latest `main` and these two rebuild docs first.
2. Never assume the previous round completed successfully merely because it was planned.
3. Prefer one large coherent batch over tiny cosmetic changes.
4. Delete obsolete code rather than leave compatibility wrappers when the old behavior is no longer part of the product.
5. Do not preserve old database tables solely for hypothetical backward compatibility; use an explicit migration/rebuild decision.
6. Do not introduce AI, payments, LINE group features or booking automation unless the product requirements are explicitly changed.
7. Keep the repository buildable whenever practical; if a round temporarily cannot finish a cross-cutting removal, record the exact blocker here.
8. Update this file before the round ends with: inspected state, completed changes, verification performed, and next planned work.