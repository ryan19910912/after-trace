# AFTERTRACE Development Progress

## Current status

Round 16 has moved beyond persistence foundation into real User-owned Energy runtime composition. The legacy Group-scoped WELCOME/AD/PAID ledger remains readable for historical compatibility, but webhook FREE grants, explicit @AI preflight, background no-eligible preflight and the new private LIFF Energy API now use the User Energy model.

V1 is not Feature Complete.

## Confirmed V1 ownership and Energy model

- Conversation, memories, sources and destinations remain Group-scoped.
- Energy, subscription, rewarded-ad rewards and one-time purchases are User-scoped and follow the LINE user across groups.
- FREE: one lifetime user grant, non-expiring.
- SUBSCRIPTION: one plan, billing-cycle Energy expires at provider `period_end`, no rollover.
- AD: Google Ad Manager Web Rewarded, Energy expires after 7 days.
- PAID: three one-time packs, non-expiring.
- Consumption: earliest-expiring Energy first, then FREE, then PAID.
- @AI: caller pays only; no fallback to another member.
- Background extraction: only speaking participants with positive Energy are eligible memory subjects. Full Group text may remain context. If no eligible speaker exists, stop before Gemini.
- Background actual cost is allocated among eligible speakers by normalized text-character contribution. A participant's final shortfall consumes their remaining Energy to zero and the one-time remainder is platform subsidy; never shift it to another member.
- `@AI 額度` is deterministic: no Gemini and no Energy charge. Group replies show only each member's usable/exhausted status and the configured LIFF URL; detailed numeric balances are private to the authenticated user in LIFF.
- FREE/AD support normal AI and background memory. SUBSCRIPTION/usable PAID additionally unlock proactive Push and Reminder.

## Round 15 — completed foundation

- Replaced `docs/PRODUCT_V1.md` with the confirmed User-wallet/background-allocation specification.
- Added `energy/model.ts` with expiring-first/FREE/PAID allocation, 7-day AD expiry and proactive-capability rules.
- Added `energy/background.ts` with no-eligible preflight, eligible-only character normalization, proportional allocation and final-shortfall subsidy calculation.
- Added focused tests for Energy ordering, expiry, proactive eligibility, no-speaker/no-Energy skip, eligible-only allocation and shortfall subsidy.
- Extended LINE command parsing with deterministic `@AI 額度`, help and plans recognition plus generic @AI mention detection.
- Added deterministic Group Energy reply formatting that exposes only usable/exhausted state and requires `LIFF_APP_URL`.
- Updated `.env.example` with placeholders/comments for LIFF URL, FREE/SUBSCRIPTION/three PAID packs, Google Ad Manager and Rewarded Energy.

## Round 16 — User Energy persistence foundation

Initial persistence landed in `e87b5b0f32daf53ce3347d69b67a9ce3f4d3a07b`.

- Added `schema-round16.ts` and wired it into Drizzle Kit.
- Added `user_energy_lots` owned by `line_users.id`, supporting independent FREE/SUBSCRIPTION/AD/PAID lots, per-lot expiry, available/reserved units and stable source idempotency.
- Added immutable `user_energy_operations` and `user_energy_transactions` reconciliation tables.
- Added `user_energy_reservations` plus per-lot reservation allocations.
- Added `user_subscription_cycles` and `user_paid_purchases` persistence. V1 paid pack codes are SMALL/MEDIUM/LARGE.
- Added product-neutral grant primitives for lifetime FREE, subscription cycle, 7-day Rewarded AD and permanent PAID packs.
- No production Energy amount, price, payment provider, Google Ad Manager id, API key or URL was guessed.

## Round 16 — runtime migration completed in this batch

### Atomic Energy mutations

- Added `UserEnergyLedgerService` and mutation repository contracts.
- Added atomic PostgreSQL User Energy `CONSUME` over usable lots with row locking and deterministic ordering.
- Added atomic `RESERVE` over SUBSCRIPTION/PAID lots only. Subscription lots qualify only when their expiry safely exceeds the requested `validThrough` delivery boundary; PAID is fallback.
- Added `RELEASE` and `RESERVED_CONSUME` settlement using the exact original reservation allocations.
- Added operation-level idempotency/reference-conflict handling and no-negative-balance guards.
- Added focused service tests for positive amounts, reference normalization and reservation constraints.

### Runtime product configuration

- Added optional `FREE_INITIAL_ENERGY`, `SUBSCRIPTION_MONTHLY_ENERGY`, `REWARDED_AD_ENERGY` and three PAID pack Energy settings to `ProductConfig`.
- Blank Energy product settings resolve to `null`; code does not invent an amount.
- Legacy Group-credit config remains compatibility-only while old settlement/reminder code is migrated.

### Lifetime FREE and explicit @AI preflight

- Webhook no longer issues first-group/later-group Welcome Credit as the new V1 onboarding path.
- Every observed LINE user can receive one lifetime FREE grant through the stable `FREE_LIFETIME / V1` idempotency source when `FREE_INITIAL_ENERGY` is configured.
- Added LINE `replyToken` preservation and a deterministic LINE Reply client.
- Added caller-only Energy access queries and preflight. A caller with zero Energy is blocked before explicit memory/AI work; another member's usable Energy never becomes fallback funding.
- `@AI 額度`, `@AI 幫助` and `@AI 方案` are handled deterministically without Gemini/Energy charge when LIFF reply configuration is available.
- Group Energy status intentionally exposes only usable/exhausted state. Non-caller members are currently shown as anonymous `成員 N` labels rather than leaking raw LINE user ids.

### Background no-eligible hard skip

- Added extraction-batch participant query from real textual messages.
- Normalized textual contribution is calculated only from valid text rows in the current extraction batch.
- Joined each speaking LINE user to their User Energy wallet at preflight time.
- When no speaking participant has positive usable Energy, the extraction batch is terminally closed with `NO_ELIGIBLE_ENERGY_PARTICIPANT` before an automatic memory request/Gemini path is created.
- This prevents later Energy acquisition from retroactively resurrecting an old zero-Energy batch.
- Eligible subject persistence filtering and proportional final settlement still remain to be wired into the classifier/orchestrator.

### Private LIFF Energy API

- Added a reusable LIFF user-only verifier that authenticates the LINE access token/channel without requiring a Group context for User-owned data.
- Added `GET /api/v1/energy/me`.
- The endpoint returns only the authenticated user's Energy: total usable/reserved units, FREE/SUBSCRIPTION/AD/PAID bucket totals, live lots/expiry, and proactive capability state.
- BigInt Energy values are serialized as strings for JSON safety.
- Added frontend API types/client support for `/api/v1/energy/me`.
- `apps/web/src/App.tsx` has not yet been switched to render the new private wallet because the large connector write was blocked; do not claim the visible LIFF Energy tab migration is complete yet.

## Remaining migration boundary

The new User Energy persistence/runtime is now used for onboarding/preflight, but several old Group-credit paths still exist and must not be mistaken for final V1 behavior:

- Memory AI billing/settlement still uses the legacy Group credit billing service after classifier execution.
- Automatic classifier subject filtering does not yet persist the eligible User set, so the model/persistence layer still needs the hard subject boundary.
- Background proportional settlement + platform shortfall subsidy + global free-AI gate are not yet connected to actual classifier cost.
- Reminder repository/route still uses legacy Group PAID reservation runtime and must be migrated to User owner/payer + Group destination.
- Rewarded Ad still needs Google Ad Manager provider abstraction, server nonce/claim and User AD grant wiring.
- Existing Group retention SQL still needs ownership-aware cleanup changes.

Do not delete the legacy credit tables yet because historical reconciliation must remain readable until all dependent records have migrated.

## Verification status

GitHub Actions was re-checked during this batch through the latest webhook migration commit and still exposed no commit status from a real runner. CI therefore remains an environment/trigger blocker rather than a repository failure signal.

Focused tests were added/updated for new Energy service/config/access/extraction behavior, but a dependency-aware pnpm/Vitest/Drizzle generation run has not executed in the available runner. Do not claim these tests passed until GitHub Actions or another dependency-complete environment actually runs them.

## Round 16 — next highest priority

1. Persist the eligible User/subject set for every AUTOMATIC memory request and enforce it in classifier output validation + candidate persistence.
2. Replace legacy Memory AI Group-credit billing with User Energy settlement:
   - EXPLICIT: caller-only User Energy;
   - AUTOMATIC: proportional eligible-user allocation;
   - final shortfall -> auditable Platform Subsidy only;
   - enforce Global Free-AI Budget hard gate.
3. Migrate Reminder schema/runtime to User owner/payer + Group destination using the new SUBSCRIPTION/PAID reservation operations; block delivery if owner leaves the Group.
4. Complete `apps/web/src/App.tsx` migration from legacy Group credit overview to `/api/v1/energy/me`.
5. Implement Google Ad Manager Web Rewarded provider abstraction + server nonce/claim/idempotency/cooldown/daily limit and mint 7-day AD Energy only after accepted claim.
6. Add subscription-cycle and PAID-purchase application services that persist `user_subscription_cycles` / `user_paid_purchases` together with Energy grants.
7. Revisit retention SQL so Group cleanup cannot delete/orphan User Energy, subscription/payment, reservation, AI allocation or subsidy audit history.
8. Re-check CI whenever a real runner starts executing repository steps; immediately fix actual typecheck/lint/test/build failures before adding more scope.

## Process note

External account/key/ad/payment settings are configuration tasks, not feature-development blockers. Leave documented env placeholders and continue all code paths that can be implemented safely without credentials. Never invent pricing, Energy amounts, provider secrets or production URLs.
