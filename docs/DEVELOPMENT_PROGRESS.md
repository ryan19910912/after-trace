# AFTERTRACE Development Progress

## Current status

Round 17 has moved the V1 monetization/runtime migration substantially beyond the Round 16 wallet foundation. New V1 financial work is User-owned. The legacy Group WELCOME/AD/PAID ledger remains only for historical compatibility and old reconciliation paths; new Reminder creation/delivery and new AI settlement primitives no longer depend on it.

AFTERTRACE V1 is still not Feature Complete.

## Confirmed V1 ownership

- Group: conversation, extraction context, memories, memory sources and Push/Reminder destination.
- User: Energy wallet, FREE/SUBSCRIPTION/AD/PAID lots, purchases, subscription cycles, Rewarded Ad rewards and Reminder ownership/payment.
- Same LINE user uses one wallet across every Group.
- No AI or Reminder operation may borrow another member's Energy.

## Round 16 foundation already landed

- User Energy lots with expiry/reservation and immutable operations/transactions.
- Lifetime FREE, subscription-cycle, Rewarded AD and three PAID pack grant primitives.
- Atomic CONSUME / RESERVE / RELEASE / RESERVED_CONSUME.
- Webhook lifetime FREE grant and caller-only @AI preflight.
- Deterministic `@AI 額度 / 幫助 / 方案` paths.
- Background no-eligible skip before automatic request/Gemini.
- LIFF private `GET /api/v1/energy/me` API and frontend API client support.

## Round 17 — completed in this batch

### Automatic memory eligible-subject hard boundary

- Added `automatic_memory_eligible_subjects` snapshot persistence.
- Eligible users are stored atomically with a newly-created AUTOMATIC memory request.
- Snapshot records User id, LINE user id, normalized current-batch character contribution and preflight Energy.
- `MemoryClassificationInput` now carries only the snapshotted eligible subject identities for durable-memory authorization.
- Gemini prompt receives ephemeral eligible speaker aliases, never raw LINE ids.
- Classifier output validation rejects AUTOMATIC candidates whose source current-batch message was authored by an ineligible user.
- `DrizzleMemoryCandidateRepository` repeats the rule at persistence time. Prompt/parser bypass therefore cannot persist an ineligible subject's automatic memory.

### User Energy AI billing/reconciliation

- Added `ENERGY_UNITS_PER_TWD` as an explicit product/runtime conversion. It is intentionally blank by default; no TWD-to-Energy ratio is guessed.
- Added `ai_energy_usage_events` for one provider usage record per memory request.
- Added `ai_user_energy_allocations` for per-user allocated/charged/subsidized Energy.
- Added `platform_ai_subsidy_operations` for auditable background shortfall subsidy.
- Added User-Energy billing adapter for explicit caller-only settlement and automatic eligible-user settlement.
- Background actual Energy is allocated only among eligible speakers by normalized character contribution.
- Final settlement rechecks current User lots. A preflight-eligible user who became insufficient is charged down to zero; only that user's remainder becomes Platform Subsidy.
- Shortfall is never moved to another Group member.
- Background settlement locks the existing global `V1_FREE_AI` budget state and User Energy lots in one SQL transaction.
- If required subsidy would exceed `GLOBAL_FREE_AI_BUDGET_COST_TWD`, no User Energy mutation for that settlement is committed.
- Fully user-funded background settlement is allowed even when the platform subsidy ceiling is already exhausted.
- `MemoryAiOrchestrator` now depends on a billing contract instead of the concrete legacy Group Credit billing service, so the User-Energy adapter can replace it without rewriting orchestration.

### User-owned Reminder migration

- Added `user_reminder_ownership`: User is owner/payer; Group is destination.
- New Reminder creation no longer creates Group PAID reservations.
- Creation verifies the owner exists, destination Group is active and the owner is a current Group member.
- Reservation uses eligible SUBSCRIPTION lots first only when `expires_at > scheduledFor`, then PAID.
- FREE/AD can never fund Reminder.
- Exact originating lots are retained in reservation allocations.
- LIFF Reminder create/cancel routes now use User Energy ownership.
- Cancellation is owner-only and atomically releases the exact reserved lots.
- Scheduled delivery now uses the User-owned delivery repository.
- Before LINE Push, dispatch rechecks that the owner is still an active member of the destination Group.
- If the owner left, the Reminder is cancelled, its reservation is released and no LINE Push occurs.
- Accepted LINE delivery consumes the exact reserved User Energy only after LINE accepts the Push.
- Legacy Reminder cost/operation columns remain nullable/defaulted only so historical rows remain readable.
- Product-facing Reminder amount is now `REMINDER_RESERVATION_ENERGY`; the old TWD reservation config is no longer the new creation path.

### Retention migration

- Group cleanup now treats active User-Energy Reminder reservations as purge blockers.
- User wallet/subscription/purchase/Energy transaction tables are never deleted by Group retention.
- Financial AI requests are redacted rather than deleted when their request ids are still needed by User Energy usage/allocation reconciliation.
- Eligible-subject snapshots used by settled financial AI requests are retained for allocation audit; non-financial snapshots may be deleted.
- User-owned terminal Reminder message content is redacted while Reminder/ownership/reservation identity is preserved.
- A minimal Group anchor is retained when User-owned Reminder or AI financial reconciliation still references that Group.
- Legacy 30-day / one-year Group timing is still used as a compatibility policy; it no longer determines ownership or deletion of User value.

### Google Ad Manager Web Rewarded boundary

- Added User-owned rewarded-ad nonce/claim persistence.
- Added `GoogleAdManagerWebRewardedProvider` abstraction.
- The implementation explicitly does not pretend Web Rewarded browser events are mobile SSV or cryptographically provider-verified.
- Security boundary uses authenticated LIFF User + server-issued nonce + nonce SHA-256 storage + 10-minute expiry + one-time consumption + provider-event idempotency + User-level cooldown + User-level daily limit.
- Accepted claims mint the existing 7-day AD Energy grant primitive.
- Added authenticated endpoints:
  - `POST /api/v1/energy/rewarded-ad/nonce`
  - `POST /api/v1/energy/rewarded-ad/claim`
- Formal Google network/ad-unit values remain environment configuration. Missing `REWARDED_AD_ENERGY` or GAM config keeps the feature safely disabled.
- LIFF API client now has nonce/claim methods; full GPT browser-ad rendering UI is still pending.

### Focused tests added/updated

- Automatic candidate rejection for ineligible speakers.
- Prompt eligible-speaker aliasing and raw LINE-id non-disclosure.
- Classification input eligible snapshot loading.
- Gemini/orchestrator fixture compatibility with eligible subject contract.
- TWD provider-cost to Energy conversion configuration/rounding.
- Background proportional settlement contract.
- User-owned Reminder validation and owner-left delivery behavior.
- Rewarded Ad nonce issuance, accepted 7-day AD grant and policy rejection.

## Important safety boundary still remaining

The new User-Energy AI billing adapter and reconciliation path are implemented, but the production Gemini execution loop is still intentionally not automatically activated from the LINE webhook.

Before enabling automatic provider invocation, the runtime still needs a request-aware pre-provider funding/budget gate that remains correct for retries and background shortfall risk. The final settlement hard gate is implemented; do not claim that this alone prevents every possible provider cost before invocation.

External configuration remains non-blocking for surrounding development. Missing Gemini pricing/FX, global budget, Energy conversion or provider keys must keep billable invocation safely disabled.

## Verification status

GitHub Actions previously exposed no commit statuses/workflow runs for the repository HEAD. Therefore focused tests/type changes are committed but must not be described as executed until a real runner performs repository steps.

When CI starts executing, fix real typecheck/lint/test/build/Drizzle errors before adding more scope.

## Next highest priority

1. Build request-aware Memory AI runtime composition and a true pre-provider User Energy / platform-budget gate, then activate Gemini via Worker `waitUntil` or a queue-safe execution boundary.
2. Complete LIFF Energy UI migration: render private FREE/SUBSCRIPTION/AD/PAID lots/expiry and wire Google Publisher Tag Web Rewarded events to the nonce/claim API.
3. Add subscription payment-provider-neutral webhook/cycle synchronization and one-time PAID pack purchase endpoints around the already-landed grant primitives.
4. Finish Reminder listing so LIFF clearly shows owner-only controls and User Energy reservation state instead of legacy paid-credit wording.
5. Remove old Group Credit runtime imports once no active path depends on them; retain only migration/history readers.
6. Revisit the legacy Group 30-day/365-day retention tier after payment ownership is fully migrated; User-owned value must remain independent of Group retention.
7. Re-check CI and resolve actual dependency-aware failures.

## Process note

Never invent Energy amounts, subscription/pack prices, provider secrets, production URLs, Google network/ad-unit ids or AI conversion economics. `.env.example` placeholders are the intended development boundary until those product/operator values are supplied.
