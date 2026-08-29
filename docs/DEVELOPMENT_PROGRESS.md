# AFTERTRACE Development Progress

## Current status

Round 16 has started the confirmed User-owned Energy migration. Round 14 LIFF management remains landed. The legacy Group-scoped WELCOME/AD/PAID ledger remains readable for historical compatibility, but new V1 monetization work must use the User Energy model.

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

## Round 16 — landed in `e87b5b0f32daf53ce3347d69b67a9ce3f4d3a07b`

- Added `schema-round16.ts` and wired it into Drizzle Kit.
- Added `user_energy_lots` owned by `line_users.id`, supporting independent FREE/SUBSCRIPTION/AD/PAID lots, per-lot expiry, available/reserved units and stable source idempotency.
- Added immutable `user_energy_operations` and `user_energy_transactions` reconciliation tables.
- Added `user_energy_reservations` plus per-lot reservation allocations so Reminder reservations can later consume/release the exact originating SUBSCRIPTION/PAID lots.
- Added `user_subscription_cycles` persistence keyed by provider cycle and `user_paid_purchases` keyed by provider purchase id. V1 paid pack codes are SMALL/MEDIUM/LARGE.
- Added `DrizzleUserEnergyRepository` with usable-lot/private-balance query and idempotent grant persistence. Grant retries detect mismatched amount/bucket/expiry as reference conflicts rather than silently reminting Energy.
- Added product-neutral grant primitives:
  - lifetime FREE uses one stable `FREE_LIFETIME / V1` source per User;
  - subscription cycle Energy expires exactly at provider `period_end`;
  - Rewarded AD Energy expires seven days after grant;
  - PAID SMALL/MEDIUM/LARGE grants never expire.
- Added focused unit tests for all four grant paths and invalid grant/cycle inputs.
- No production Energy amount, price, payment provider, Google Ad Manager id, API key or URL was guessed.

## Migration boundary after first Round 16 batch

The database now has the final User-owned persistence shape, but the legacy runtime paths are not all switched yet. In particular, existing AI settlement and Reminder repositories still use the Group credit ledger until their Round 16 migration is landed. Do not delete legacy tables yet because historical reconciliation must remain readable.

The new reservation tables intentionally exist before Reminder migration so an upcoming atomic reservation implementation can preserve lot expiry provenance. Subscription Energy may only be reserved when its expiry safely covers the reminder settlement/delivery boundary; otherwise PAID must be used or creation rejected.

## Verification status

GitHub Actions was re-checked at Round 16 start for `a3ef564b5bd05544ed616c0861cbed9f99a299d4`: there were no commit statuses and no workflow runs, so CI remains an environment/trigger blocker rather than a repository failure signal.

The current environment still cannot perform a dependency-aware pnpm/Vitest/Drizzle generation run through GitHub Actions. New Round 16 code is dependency-light and has focused tests committed; do not claim those tests executed until a runner actually performs repository steps.

## Round 16 — next highest priority

1. Implement atomic User Energy CONSUME/RESERVE/RELEASE/RESERVED_CONSUME operations over the new lot tables, including exact idempotent references and no-negative-balance guarantees.
2. Switch explicit @AI funding preflight/settlement to caller-only User Energy. If exhausted, skip Gemini and return deterministic Group availability + LIFF URL.
3. Implement background participant query from extraction messages + User wallets, eligible-subject filtering, proportional settlement and auditable platform shortfall subsidy under the global free-AI hard gate.
4. Migrate Reminder ownership to User + Group destination, reserve only eligible SUBSCRIPTION/PAID lots, and block delivery if owner has left the Group.
5. Implement Google Ad Manager provider abstraction + server nonce/claim/idempotency/cooldown/daily-limit boundary using the 7-day AD grant primitive.
6. Migrate LIFF from Group credit overview to the authenticated User's private Energy details and monetization entry points.
7. Revisit retention SQL so Group cleanup cannot delete or orphan User Energy/subscription/payment/reservation/AI allocation history.
8. Re-check CI whenever a real runner starts executing repository steps; fix actual typecheck/lint/test/build failures before adding new scope.

## Process note

External account/key/ad/payment settings are configuration tasks, not feature-development blockers. Leave documented env placeholders and continue all code paths that can be implemented safely without credentials. Never invent pricing, Energy amounts, provider secrets or production URLs.
