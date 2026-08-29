# AFTERTRACE Development Progress

## Current status

Round 12 is complete on `main` once the implementation commit lands. Paid-only Reminder now has a runtime delivery boundary in addition to the Round 11 financial lifecycle: due work is claimed with PostgreSQL row locking, lease/fence state and one stable LINE retry key; dispatch is authorized immediately before the external Push; LINE acceptance is then settled atomically into Reminder `DELIVERED` plus PAID reservation consumption/audit.

The Worker module entry now exposes both HTTP fetch and Cloudflare scheduled execution. The repository deliberately does not hard-code a Cron Trigger cadence because the V1 product requirements do not define reminder scheduling resolution. Production delivery still requires an explicit Cloudflare Cron Trigger plus valid LINE/Neon settings.

Real Gemini invocation remains intentionally disconnected from the LINE webhook/runtime composition. Dependency-aware verification is still blocked because GitHub Actions continues to fail before executing repository steps. Production AI activation also still requires explicit Gemini credentials/pricing, USD/TWD FX and the global free-AI ceiling.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo; Hono on Cloudflare Workers; React/Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle; Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE Group is the isolation boundary for context, memories, reminders, usage and credits.
- Conversation extraction is event-driven; explicit and automatic memory work share one pipeline.
- Memory decisions are NEW / DUPLICATE / UPDATE / CONTRADICT with source attribution and audit history.
- Credit order is Welcome -> Ad -> Paid; paid value does not expire; Reminder is paid-only.
- Global free-AI budget is a hard safety boundary; operator amount/reset policy must not be guessed.
- Never-paid inactive Groups retain recoverable product data 30 days; paid Groups 1 year.

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

## Round 11 summary

- Reminder creation atomically reserves explicit caller-supplied PAID value and creates `SCHEDULED` state.
- Cancellation atomically releases the reservation and writes actor-attributed audit.
- Successful-delivery settlement atomically consumes the reservation, updates PAID reserved balance and writes audit.
- WELCOME/AD are never Reminder funding.
- Stable Group-scoped request keys and delivery references protect exact retries and reject reference conflicts.
- No Reminder price or low-balance threshold was invented.

## Round 12 — completed

### Due Reminder ownership

- Added `ReminderDeliveryService` and `DrizzleReminderDeliveryRepository`.
- Due claims select only active-Group `SCHEDULED` reminders whose PAID reservation is still `RESERVED`.
- PostgreSQL `FOR UPDATE SKIP LOCKED` prevents two scheduled Workers from owning the same due row concurrently.
- Each claim increments `delivery_attempt_count`, sets a short lease and preserves one stable `delivery_retry_key` across retries.
- First claim records a retry-key expiry 23 hours later. This stays inside LINE's documented 24-hour retry-key management window and prevents the application from intentionally reusing the same key after LINE may treat it as a fresh request.

### Cancellation / dispatch fence

- Claiming alone does not block cancellation.
- Immediately before LINE Push, `authorizeDispatch` re-locks the Reminder and requires exact reminder/group/attempt/retry-key/lease state plus active Group status.
- Successful authorization atomically changes `SCHEDULED -> DISPATCHING`.
- If cancellation wins before authorization, authorization returns `CANCELLED`/stale and no Push occurs.
- Once `DISPATCHING` is committed, ordinary cancellation no longer mutates that Reminder; the runtime has crossed the external-delivery boundary.

### LINE duplicate-send protection

- Added `LineMessagingPushClient` using Messaging API `POST /v2/bot/message/push` with `X-Line-Retry-Key` on the first request and every retry.
- HTTP 2xx is accepted delivery.
- HTTP 409 for the same retry key is also treated as accepted because LINE documents that this means the retry key was already accepted and the repeated request was blocked.
- Network errors, HTTP 429 and 5xx are retryable only while the stored retry key remains inside its safety window.
- Retryable failures return the exact fenced Reminder to `SCHEDULED` without changing the retry key.
- Permanent or retry-window-expired failures deliberately do not guess refund/consume semantics. The Reminder stays unresolved with its PAID reservation intact for later explicit operator/product policy.

### Accepted-delivery settlement

- Runtime settlement requires current `DISPATCHING` state plus exact attempt count and retry key.
- `DELIVERED`, `RESERVED -> CONSUMED`, PAID reserved-balance decrement, logical CONSUME operation/transaction and `REMINDER_DELIVERED` audit are committed in one PostgreSQL statement.
- The runtime never consumes Reminder PAID before LINE acceptance.

### Cloudflare scheduled boundary

- Added `apps/api/src/worker.ts` as the Cloudflare module entry and changed `wrangler.toml` from `src/index.ts` to `src/worker.ts`.
- `worker.ts` delegates HTTP requests to the existing Hono app and exposes a `scheduled` handler that creates Neon/LINE adapters and runs due Reminder delivery.
- No Cron cadence was added to `wrangler.toml`; product requirements do not define scheduling resolution, so deployment must choose/configure the Cron Trigger explicitly rather than code guessing it.

### Focused tests / review

- Added tests proving accepted LINE delivery is settled only after Push acceptance.
- Added cancellation/stale-fence coverage proving no Push occurs when dispatch authorization loses.
- Added LINE adapter coverage proving HTTP 409 with the same retry key is interpreted as already accepted.
- Schema now includes `DISPATCHING`, delivery attempt count, retry key, retry expiry and lease expiry.
- Reminder delivery behavior is documented in `docs/REMINDER_DELIVERY.md`.

## Verification status

The newest pre-Round-12 `main` run is GitHub Actions run `33233008630` for `b022b0b2`. It completed as failure before useful repository verification, consistent with prior runner/environment failures. No successful dependency-aware `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` result is available yet.

Round 12 changed modules were statically reviewed for TypeScript shape, PostgreSQL fencing, PAID settlement ordering and LINE retry-key semantics. Full CI/build verification must be retried after the implementation commit. No Neon/LINE/Cloudflare/Gemini credentials were guessed or used.

## Round 13 — highest priority

1. Re-check CI on the Round 12 commit. If a runner actually executes repository steps, fix every real install/typecheck/lint/test/build/Drizzle issue before adding more product behavior.
2. Implement inactive Group retention cleanup: never-paid 30 days, paid 1 year. Preserve financial/audit reconciliation records. Unresolved PAID Reminder reservations / `DISPATCHING` reminders must block destructive cleanup until their disposition is explicitly resolved; do not silently release, consume or delete them.
3. Add an explicit operator recovery boundary for unresolved Reminder delivery before exposing any mutation route. Authentication/authorization must be defined first.
4. Once dependency-aware verification is available, compose `MemoryAiOrchestrator` plus funding eligibility into the event-driven LINE path. Real Gemini stays disabled unless API key, provider pricing, FX and global free-AI ceiling are configured.
5. Define an authenticated operator/admin boundary before exposing `MemoryRecoveryService`.
6. Consolidate the Drizzle baseline and generate the initial migration only after dependency-aware verification is available and the schema is stable.

## Process note

Never bypass durable-result reuse, credit/usage idempotency, source grounding, global free-AI limits, request fencing, Reminder PAID reservation atomicity, dispatch fencing or LINE retry-key reuse merely to make runtime connectivity appear complete sooner. Always update this file before the next handoff.
