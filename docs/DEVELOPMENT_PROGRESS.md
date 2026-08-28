# AFTERTRACE Development Progress

## Current status

Round 1 bootstrap completed. The repository now has durable product/architecture requirements and a buildable-intent monorepo foundation. Round 2 should start the first real vertical feature: LINE webhook ingestion.

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
- All group members may manage memories; mutations/deletions must be auditable.
- Memory source metadata is retained when LINE provides it.
- Credit model is prepaid, not subscription-based. Welcome/ad value is consumed before paid value; paid credit does not expire.
- First activated group per LINE user defaults to NT$1 internal welcome allowance; later groups default to NT$0.5.
- Reward defaults: NT$0.01 internal allowance, max 5/group/day, 15-minute cooldown; values are configuration, not business-code constants.
- Reminder is paid-only and reserves paid value when created.
- Inactive never-paid groups retain recoverable product data for 30 days; paid groups for 1 year.

## Round 1 — completed

### Completed

- Added `docs/PRODUCT_V1.md` as the durable product requirements baseline.
- Added `docs/ARCHITECTURE.md` for runtime, portability, event-driven ingestion, scale path, and observability rules.
- Initialized pnpm workspace with `apps/api`, `apps/web`, and `packages/shared`.
- Bootstrapped Hono Cloudflare Worker with `/health` and Wrangler observability enabled.
- Bootstrapped React/Vite LIFF web shell.
- Added shared domain constants/types for memory decisions, credit buckets, and AI usage types.
- Added Neon/Drizzle database client.
- Added initial Drizzle schema for LINE users/groups, conversation buffer, memories, audit log, AI usage, credit accounts, and credit ledger.
- Added environment template and `.gitignore`.
- Added GitHub Actions CI intent: install, typecheck, test, build.
- Expanded README with architecture and local-development entry points.

### Validation status

Repository structure and source consistency were reviewed through GitHub. Full `pnpm install/typecheck/test/build` has not yet been executed in a checked-out runtime during this round, so Round 2 must treat CI/package compatibility as the first verification task and fix any dependency/configuration mismatch before feature work.

### External setup not yet required

No production credentials were guessed or committed. Real Neon, LINE, Cloudflare, LIFF, and Gemini credentials remain intentionally unset.

## Round 2 — highest priority

1. Verify dependency installation, TypeScript, Worker dry-run build, Web build, and tests; fix bootstrap issues first.
2. Add configuration module for conversation thresholds and credit defaults instead of scattering constants.
3. Implement LINE webhook signature verification and event parsing with tests.
4. Implement group upsert + conversation message insert + pending message/character counter update.
5. Make ingestion idempotent by LINE message id.
6. Return a threshold decision from the ingestion service, but do not call Gemini until the ingestion vertical slice is tested.
7. Update this file with exact test/CI status and the next highest-priority item.
