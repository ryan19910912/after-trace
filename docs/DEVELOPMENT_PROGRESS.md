# AFTERTRACE Development Progress

## Current status

Round 18 is now focused on feature completion rather than incremental test work. User instruction is to finish the V1 functional mainline first, then run typecheck/lint/test/build/CI as one concentrated verification/fix phase.

AFTERTRACE V1 is still not declared Feature Complete, but the major User Energy runtime paths are now implemented: generic @AI, automatic memory AI, Reminder, Rewarded Ad, provider-neutral commerce ingestion, private LIFF Energy UI and Proactive Push infrastructure.

## Ownership remains fixed

- Group owns conversation/extraction context, memories/sources and Push/Reminder destination.
- User owns Energy, subscription, rewarded-ad rewards, purchases and Reminder/Proactive capability.
- Same LINE user uses one wallet across all Groups.
- AI/Reminder never borrows another member's Energy.

## Round 16–17 foundations already landed

- User Energy lots, expiry, immutable operations/transactions and reservations.
- FREE / SUBSCRIPTION / AD / three PAID pack grant primitives.
- Atomic consume/reserve/release/reserved-consume.
- Caller-only @AI preflight and deterministic commands.
- Automatic-memory eligible-speaker snapshot, no-eligible pre-Gemini skip and subject hard gates.
- Per-user background allocation + Platform Subsidy + global free-AI budget reconciliation.
- User-owned Reminder create/cancel/delivery.
- User private Energy API.
- Rewarded Ad nonce/claim backend.
- User-owned retention safeguards.

## Round 18 — completed functional work

### Memory AI runtime is now composed

- Added `UserEnergyMemoryAiRuntime` using real Drizzle work/input/result/candidate repositories, Gemini classifier and User Energy billing.
- LINE webhook collects Groups with newly queued explicit/automatic memory requests and schedules processing through Worker `waitUntil`.
- Runtime drains a bounded number of requests per Group rather than blocking webhook ingestion indefinitely.
- Missing Gemini pricing/FX/Energy conversion/budget config safely disables provider execution without disabling LINE ingestion.
- Background provider calls reserve Platform Subsidy risk before Gemini invocation.
- `platform_ai_budget_reservations` tracks RESERVED/SETTLED/RELEASED provider-risk reservations.
- Platform budget reserve and settlement now acquire the global advisory lock inside one SQL transaction statement; no cross-request transaction assumption is used with Neon HTTP.
- Final background settlement uses the pre-provider reservation, charges current User lots, records per-user allocations/subsidy and settles the reserved global budget atomically.

### Generic `@AI` Q&A is now implemented

- Non-deterministic, non-`記住` `@AI` messages now use a real grounded answer path.
- Context consists of recent Group text plus ACTIVE durable Group memories.
- Raw LINE user ids are replaced with ephemeral speaker aliases before provider invocation.
- Added `explicit_ai_chat_requests` for message-id idempotency and persisted provider/usage/cost result.
- LINE redelivery of an already-completed chat request reuses the answer rather than charging again.
- Added explicit caller Energy holds across the normal Energy order (expiring lots -> FREE -> PAID).
- A request reserves a conservative maximum Energy amount before Gemini.
- Actual provider usage is converted with configured `ENERGY_UNITS_PER_TWD`; only actual Energy is consumed and the unused hold is released.
- Provider failure releases the entire hold.
- Generic @AI therefore remains caller-only and cannot create a negative balance or transfer cost to another member.
- `GEMINI_CHAT_MAX_OUTPUT_TOKENS` bounds generic answer output and the pre-hold risk calculation.

### LINE member lifecycle is now complete for owner-left rules

- Webhook parser now handles `memberJoined` and `memberLeft`, in addition to bot `join/leave`.
- Joined users are touched/activated in `group_members`.
- Left users are marked `is_active=false` immediately.
- Reminder and Proactive owner-left delivery gates now have real webhook-fed membership state rather than depending only on future observed messages.

### Proactive Push capability is implemented without inventing trigger rules

- Added User-owned `proactive_pushes` queue.
- Product still does not define which business/memory events should generate proactive messages, so code does not invent triggers.
- A trusted internal enqueue boundary accepts an already-approved trigger result with owner, Group destination, source identity, message and schedule.
- Enqueue requires active Group membership and usable SUBSCRIPTION/PAID capability.
- Scheduled delivery rechecks Group activity, membership and usable SUBSCRIPTION/PAID before LINE Push.
- Ineligible scheduled work is cancelled instead of sent.
- Delivery uses LINE retry keys and bounded dispatch leases.
- Worker cron now runs Reminder, Proactive and Retention jobs in parallel.
- `PROACTIVE_INTERNAL_SECRET` protects the internal enqueue boundary.

### LIFF Energy UI is now User-wallet based

- Legacy WELCOME/Group-credit Energy presentation was removed from the main LIFF Energy tab.
- UI loads authenticated `/api/v1/energy/me` private wallet data.
- Displays total usable/reserved Energy and FREE/SUBSCRIPTION/AD/PAID buckets.
- Displays per-lot expiration and reservation state.
- Displays proactive capability.
- Private overview now includes User subscription provider/status/period_end/cancel-at-period-end state.
- Reminder UI copy and capability now use SUBSCRIPTION/PAID User Energy semantics.

### Google Ad Manager Web Rewarded browser flow is wired

- Added GPT browser client loading `securepubads.g.doubleclick.net/tag/js/gpt.js`.
- User button requests a server nonce first.
- Uses Google Publisher Tag rewarded out-of-page slot.
- Reward is claimed only after GPT emits the rewarded-granted event.
- Closing before reward completion does not mint Energy.
- Successful server claim refreshes private Energy overview.
- Backend remains explicit that browser Rewarded is not mobile SSV; nonce/idempotency/cooldown/daily-limit remain the trust boundary available for Web V1.

### Provider-neutral subscription / PAID commerce boundary

- Added private product catalog from configured V1 Energy/price placeholders.
- Added persisted `commerce_provider_events` idempotency ledger.
- Added `user_subscription_state`.
- Added provider-neutral verified event contract for:
  - `SUBSCRIPTION_CYCLE_PAID`
  - `SUBSCRIPTION_CANCELLED`
  - `PAID_PACK_PURCHASED`
- Successful subscription-cycle events mint Energy expiring at actual provider period_end.
- Cancellation never removes already-paid current-cycle Energy before expiry.
- PAID pack events mint SMALL/MEDIUM/LARGE permanent Energy using existing grant primitives.
- Internal commerce event endpoint is protected by `COMMERCE_WEBHOOK_SECRET`.
- No concrete payment provider adapter is invented. Merely setting `COMMERCE_PROVIDER` does not enable checkout UI; checkout remains disabled until a real adapter exists.

### Retention extended for Round 18

- Active Proactive work blocks Group purge.
- Terminal Proactive rows may be removed with Group product data.
- Billed generic @AI requests are retained as financial identity but prompt/answer are redacted.
- Unbilled failed/pending chat rows may be deleted.
- Group anchor is retained when explicit AI financial history still needs the Group identity.
- User wallet/payment/subscription/AI transaction value remains outside Group cleanup.

## External configuration still intentionally non-blocking

These values remain deployment/product decisions and may be blank while development continues:

- Gemini key/current token prices/FX.
- `ENERGY_UNITS_PER_TWD`.
- global/background AI budget limits.
- FREE/SUBSCRIPTION/AD/PAID Energy amounts and prices.
- Google Ad Manager network/ad-unit values.
- payment provider + provider credentials/checkout adapter.
- internal Proactive trigger producer/secret.
- production LINE/LIFF URLs and secrets.

No production value is guessed in code.

## Remaining functional work before V1 Feature Complete

1. Implement a concrete payment checkout adapter only after the provider is selected/configured. The product catalog and verified post-payment event boundary are already provider-neutral.
2. Decide/implement actual Proactive trigger producers. Queue, eligibility and delivery are complete; product trigger rules are intentionally not invented.
3. Review management/listing surfaces for any remaining legacy Group Credit wording/read models that are no longer used by the main LIFF flow.
4. Remove or quarantine remaining legacy Group Credit runtime modules after confirming no active V1 path imports them.
5. Revisit legacy Group retention timing (30/365 days) only when a new product rule is explicitly chosen; User-owned value is already protected.
6. Perform final configuration checklist/documentation for LINE, LIFF, Neon, Gemini, GAM and selected payment provider.

## Verification policy for the remaining development

Per current user instruction, do not spend development rounds repeatedly running or extending tests/CI while functional work is still incomplete.

After V1 functional scope is completed:

1. run dependency-aware typecheck;
2. run lint;
3. run all Vitest suites;
4. run Vite/API builds;
5. run Drizzle generation/schema validation;
6. run GitHub Actions CI;
7. fix all real failures until green.

Existing focused tests remain in the repository, but no new claim of passing test/CI status should be made until that final verification phase.

## Process note

Never invent Energy amounts, subscription/pack prices, provider secrets, production URLs, Google network/ad-unit ids, payment provider choice or AI conversion economics. External configuration is a deployment boundary, not a reason to stop implementing provider-neutral product logic.
