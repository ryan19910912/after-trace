# AFTERTRACE Development Progress

## Current status

Round 13 is complete once the implementation commit lands. The largest remaining V1 data-safety gap is now closed: inactive Group retention applies the confirmed 30-day never-paid / one-calendar-year paid policy, preserves reconciliation data, blocks destructive cleanup around unresolved PAID Reminders, and retains the minimum Group identity required when non-expiring PAID value still exists.

Reminder delivery also gains an internal, attempt-fenced operator recovery primitive for unresolved `DISPATCHING` work while the original LINE retry key is still valid. It never invents a new retry key or exposes an unauthenticated mutation route.

Real Gemini invocation remains intentionally disconnected from the LINE webhook/runtime composition. Dependency-aware verification is still blocked because GitHub Actions is failing before repository steps execute. Production activation still requires explicit Neon/LINE/Cloudflare/Gemini configuration, AI pricing/FX/global free-AI ceiling and a Cloudflare Cron Trigger cadence.

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

## Round 12 summary

- Due Reminder work uses PostgreSQL `FOR UPDATE SKIP LOCKED`, attempt fencing and leases.
- Dispatch authorization immediately before LINE Push moves `SCHEDULED -> DISPATCHING`; cancellation can still win before that boundary.
- LINE Push uses one persisted `X-Line-Retry-Key`; 2xx and same-key 409 count as accepted.
- Retryable network/429/5xx failures reuse the same key only inside the stored safety window.
- LINE acceptance is followed by atomic `DELIVERED` + `RESERVED -> CONSUMED` + PAID/audit settlement.
- Permanent/unconfirmed delivery does not guess refund/consume semantics.
- Worker entry supports HTTP fetch plus Cloudflare scheduled execution; Cron cadence remains external configuration.

## Round 13 — completed

### Inactive Group retention service

- Added `GroupRetentionService`, `DrizzleRetentionRepository` and focused tests.
- Never-paid cutoff is exactly 30 days before the scheduled timestamp.
- Paid cutoff uses one calendar year rather than treating the product requirement as an arbitrary shorter duration.
- Due Groups must be `INACTIVE` with `inactive_at` beyond the appropriate cutoff.
- PostgreSQL candidate selection uses `FOR UPDATE SKIP LOCKED`, so overlapping scheduled Workers do not purge the same Group concurrently.

### Destructive-cleanup safety

- A due Group is excluded from purge if any Reminder is still `SCHEDULED` / `DISPATCHING` or any Reminder credit reservation remains `RESERVED`.
- The job reports the number of retention-due Groups blocked by unresolved Reminder state.
- Retention never silently releases or consumes a Reminder reservation.

### Product data removed

A successful purge removes recoverable/private Group-scoped state atomically, including:

- conversation messages and extraction batches;
- memories;
- memory candidate requests, work state, classifier results and candidate results;
- automatic memory request keys;
- Group member snapshots;
- Rewarded-Ad policy counters;
- terminal Reminder product rows.

### Reconciliation state preserved

Retention intentionally preserves:

- audit logs;
- credit accounts, operations, reservations and transactions;
- AI usage events and global free-AI budget reconciliation;
- Welcome/Rewarded-Ad grant attribution/history.

A `GROUP_PRODUCT_DATA_PURGED` audit event records inactivity timestamp, paid-history flag, retention policy and whether a minimal paid anchor was retained.

### Non-expiring PAID protection

- `PRODUCT_V1` says PAID does not expire. Therefore retention cannot delete the last stable LINE Group mapping while PAID available/reserved value is still non-zero.
- If non-zero PAID exists after product data expiry, the Group row is retained as a minimal inactive anchor and pending counters are reset.
- If no non-zero PAID remains, the expired Group row itself may be removed; historical numeric group ids remain available in preserved audit/financial rows.
- Repeated purge does not need a new schema column: an audit purge marker created at/after the current `inactive_at` excludes that inactivity period. If the retained paid anchor rejoins and later leaves again, its newer `inactive_at` naturally makes it eligible for a future retention cycle.

### Reminder recovery boundary

- Added `ReminderRecoveryService` and `DrizzleReminderRecoveryRepository` with focused tests.
- Recovery is explicit and operator-attributed (`operatorRef`, `reason`).
- It only requeues current `DISPATCHING` work when reminder/group/attempt/retry-key all match, the old dispatch lease is no longer active and the original retry key has not expired.
- Requeue returns the Reminder to `SCHEDULED` while preserving the exact retry key; no new key is invented.
- Expired key, active lease, stale attempt/key, terminal state and missing reminder are explicit non-success outcomes.
- `REMINDER_DELIVERY_REQUEUED` audit records the recovery context.
- No public recovery route was added because authenticated operator/admin authorization is still undefined.

### Scheduled runtime

- The existing Worker `scheduled` boundary now starts both Reminder delivery and Group retention.
- Reminder delivery requires ACTIVE Groups while retention requires INACTIVE Groups, so their eligibility domains are disjoint.
- No Cron frequency is hard-coded; deployment must configure the trigger explicitly.

## Verification status

Before Round 13, latest `main` GitHub Actions run `33233355916` for `b96da92e` failed in job `99049920287` with `steps=[]`, `runner_id=0` and an empty runner name. Checkout and every repository command were skipped. This is the same external runner/environment blocker, not evidence of a compile/test failure.

Round 13 adds focused unit tests for retention cutoff/count aggregation and Reminder recovery validation/fence propagation. The repository SQL and domain modules were statically reviewed for deletion ordering, reconciliation preservation, paid-anchor safety, retry-key reuse and stale-worker/operator fencing. Full dependency-aware `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` must still be rerun when GitHub assigns a runner.

No Neon/LINE/Cloudflare/Gemini credential, Cron cadence, Reminder price, low-balance threshold, provider price, FX rate or global free-budget amount was guessed.

## Round 14 — highest priority

1. Re-check CI on the Round 13 commit. If repository steps execute, fix every real install/typecheck/lint/test/build/Drizzle problem before new features.
2. Finish V1 runtime composition without weakening safety: wire `MemoryAiOrchestrator` + funding eligibility into event-driven memory work only after dependency-aware verification is available; real Gemini must remain disabled unless API key, pricing, FX and free-budget ceiling are explicitly configured.
3. Define an authenticated operator/admin boundary, then expose only the already-fenced Memory/Reminder recovery operations through that boundary.
4. Build LIFF V1 management/search surfaces required by product scope: Group memories with source visibility/edit/delete, credit/usage status, Rewarded Ad entry and paid Reminder management. Do not invent product pricing/UI policies that are absent from requirements.
5. Consolidate the pre-migration Drizzle schema and generate the initial migration only after dependency-aware verification is available and schema is stable.
6. Add deployment/runbook documentation for Neon, LINE webhook, Cloudflare Worker/Pages/Cron and Gemini activation inputs without embedding secrets.

## Process note

Never bypass durable-result reuse, credit/usage idempotency, source grounding, global free-AI limits, request fencing, Reminder PAID reservation atomicity, dispatch fencing, LINE retry-key reuse, retention reconciliation preservation or explicit recovery fencing merely to make connectivity appear complete sooner. Always update this file before the next handoff.
