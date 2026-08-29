# AFTERTRACE Development Progress

## Current status

Round 13 is complete on `main`. Inactive Group retention now enforces the confirmed 30-day never-paid / one-calendar-year paid policy, preserves financial/audit reconciliation state, blocks destructive cleanup around unresolved PAID Reminders, and retains the minimum Group identity required while non-expiring PAID value still exists.

Reminder delivery also has an internal attempt-fenced recovery primitive for unresolved `DISPATCHING` work while the original LINE retry key remains valid. It never invents a replacement retry key and is not exposed through an unauthenticated route.

Real Gemini invocation remains intentionally disconnected from the LINE webhook/runtime composition. Dependency-aware verification is still blocked because GitHub Actions fails before repository steps execute. Production activation also still requires explicit Neon/LINE/Cloudflare/Gemini settings, AI pricing/FX/global free-AI ceiling and a Cloudflare Cron Trigger cadence.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo; Hono on Cloudflare Workers; React/Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle; Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE Group is the isolation boundary for conversation context, memories, reminders, usage and credits.
- Conversation extraction is event-driven; explicit and automatic memory work share one pipeline.
- Memory decisions are NEW / DUPLICATE / UPDATE / CONTRADICT with source attribution and audit history.
- Credit order is Welcome -> Ad -> Paid; paid value does not expire; Reminder is paid-only.
- Global free-AI budget is a hard safety boundary; operator amount/reset policy must not be guessed.
- Never-paid inactive Groups retain recoverable product data 30 days; paid Groups one year.

## Completed rounds

1. Repository/product/architecture bootstrap, Worker/LIFF skeletons, Neon/Drizzle foundation and CI.
2. LINE signature/events, conversation buffer/idempotency, group lifecycle, source metadata and extraction thresholds.
3. Extraction batch leases, members, fixed-point credits, AI cost snapshots and explicit memory command detection.
4. Webhook extraction claims, logical credit operation idempotency, reservations and AI usage/credit coupling.
5. Welcome credit, Rewarded Ad primitives, explicit memory requests and extraction context loading.
6. Shared memory request leases/fencing plus idempotent NEW/DUPLICATE/UPDATE/CONTRADICT persistence/audit.
7. Unified grounded classifier input, strict Zod output contract, pseudonymized prompt and runtime pricing/FX boundary.
8. Durable validated Gemini result reuse, REST classifier adapter and retry-safe billing/candidate/request orchestration.
9. Global free-AI budget hard gate, bounded provider retry policy and crash-boundary coverage.
10. Attempt-fenced terminal recovery, pre-invocation funding eligibility and extraction FAILED-schema correction.
11. Paid-only Reminder create/reserve, cancel/release and successful-delivery/consume lifecycle with atomic audit/settlement fencing.
12. Due Reminder claim/lease, LINE retry-key duplicate-send protection, dispatch fencing, Cloudflare scheduled boundary and accepted-delivery settlement.
13. Inactive Group retention cleanup, non-expiring PAID anchor protection and safe same-retry-key Reminder recovery boundary.

## Round 13 — completed

### Inactive Group retention

- Added `GroupRetentionService`, `DrizzleRetentionRepository` and focused tests.
- Never-paid cutoff is 30 days before the scheduled timestamp; paid cutoff is one calendar year.
- PostgreSQL candidate selection uses `FOR UPDATE SKIP LOCKED`, so overlapping scheduled Workers do not purge the same Group concurrently.
- Destructive purge is blocked if a Reminder is `SCHEDULED` / `DISPATCHING` or its Reminder credit reservation is still `RESERVED`.
- The scheduled run reports how many retention-due Groups are blocked by unresolved Reminder state.

### Product data purge / reconciliation preservation

A successful purge removes recoverable/private Group-scoped state atomically: conversation rows/extraction batches, memories, memory requests/work/classifier/candidate results, automatic request keys, member snapshots, Rewarded-Ad policy counters and terminal Reminder product rows.

It intentionally preserves audit logs, credit accounts/operations/reservations/transactions, AI usage/global free-AI reconciliation and Welcome/Rewarded-Ad grant attribution/history. A `GROUP_PRODUCT_DATA_PURGED` audit event records the inactivity timestamp, policy and whether a paid anchor remains.

### Non-expiring PAID protection

- PAID does not expire, so retention cannot delete the final stable LINE Group mapping while PAID available/reserved value remains non-zero.
- Such a Group keeps a minimal inactive `line_groups` anchor; pending counters are reset while private product rows are removed.
- If no non-zero PAID remains, the expired Group row itself may be removed while numeric historical group ids remain in preserved reconciliation rows.
- No extra schema marker was added. A purge audit created at/after the current `inactive_at` marks that inactivity period complete. If a retained paid anchor rejoins and later leaves again, its newer `inactive_at` naturally becomes independently eligible later.

### Reminder recovery

- Added `ReminderRecoveryService`, `DrizzleReminderRecoveryRepository` and focused tests.
- Recovery requires exact group/reminder/attempt/retry-key fencing plus explicit `operatorRef` and `reason`.
- It only requeues current `DISPATCHING` work after its prior dispatch lease is no longer active and while the original retry key is still valid.
- Requeue returns to `SCHEDULED` with the exact same retry key; expired key, active lease, stale fence, terminal state or missing Reminder are explicit non-success outcomes.
- `REMINDER_DELIVERY_REQUEUED` audit records recovery context.
- No public route was added because authenticated operator/admin authorization remains undefined.

### Scheduled runtime

The existing Cloudflare scheduled boundary now starts both Reminder delivery and Group retention. Reminder delivery only targets ACTIVE Groups; retention only targets INACTIVE Groups, so the eligibility domains are disjoint. Cron cadence remains an external deployment setting because V1 does not define scheduler resolution.

## Verification status

Round 13 implementation commit: `af0899c994513b4385e8bd9d6f6fcf4bdd691c2d`.

GitHub Actions run `33233618400` for that exact commit completed as failure, but job `99050633567` again has `steps=[]`, `runner_id=0` and an empty runner name. Checkout and every repository command were skipped. This is the same runner/environment blocker, not evidence of a repository compile/test failure.

Available local TypeScript is 5.8.3. The new pure domain modules `retention/service.ts` and `reminders/recovery.ts` were reproduced exactly enough for a strict `tsc --noEmit --strict --target ES2022 --module ESNext` check and passed with no compiler output. The new PostgreSQL repositories and Worker composition were statically reviewed for deletion ordering, reconciliation preservation, paid-anchor safety, retry-key reuse and stale-worker/operator fencing.

Full dependency-aware `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` still cannot be claimed until a GitHub runner actually executes repository steps. No Neon/LINE/Cloudflare/Gemini credential, Cron cadence, Reminder price, low-balance threshold, provider price, FX rate or global free-budget amount was guessed.

## Round 14 — highest priority

1. Re-check CI on the latest `main`; if repository steps execute, fix every real install/typecheck/lint/test/build/Drizzle issue before adding features.
2. Complete V1 LIFF management/search surfaces: Group memories with source visibility/edit/delete, credit/usage status, Rewarded Ad entry and paid Reminder management, without inventing absent pricing/UI policies.
3. Define an authenticated operator/admin boundary, then expose only the already-fenced Memory/Reminder recovery mutations through it.
4. Once dependency-aware verification is available, compose `MemoryAiOrchestrator` + funding eligibility into the event-driven LINE path. Real Gemini stays disabled unless API key, provider pricing, FX and global free-AI ceiling are configured.
5. Consolidate the pre-migration Drizzle schema and generate the initial migration only after dependency-aware verification is available and the schema is stable.
6. Add deployment/runbook documentation for Neon, LINE webhook, Cloudflare Worker/Pages/Cron and Gemini activation inputs without embedding secrets.

## Process note

Never bypass durable-result reuse, credit/usage idempotency, source grounding, global free-AI limits, request fencing, Reminder PAID reservation atomicity, dispatch fencing, LINE retry-key reuse, retention reconciliation preservation or explicit recovery fencing merely to make connectivity appear complete sooner. Always update this file before the next handoff.
