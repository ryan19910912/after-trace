# AFTERTRACE Development Progress

## Current status

Round 15 starts the confirmed monetization/ownership redesign. Round 14 LIFF management remains landed, but the old Group-scoped WELCOME/AD/PAID ledger is now explicitly legacy and must not be extended for new V1 work.

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

- Replaced `docs/PRODUCT_V1.md` with the confirmed User-wallet/background-allocation specification from the product discussion.
- Added `energy/model.ts` with expiring-first/FREE/PAID allocation, 7-day AD expiry and proactive-capability rules.
- Added `energy/background.ts` with no-eligible preflight, eligible-only character normalization, proportional allocation and final-shortfall subsidy calculation.
- Added focused tests for Energy ordering, expiry, proactive eligibility, no-speaker/no-Energy skip, eligible-only allocation and shortfall subsidy.
- Extended LINE command parsing with deterministic `@AI 額度`, help and plans recognition plus generic @AI mention detection.
- Added a deterministic Group Energy reply formatter that exposes only usable/exhausted state and requires `LIFF_APP_URL`.
- Updated `.env.example` with placeholders/comments for LIFF URL, FREE/SUBSCRIPTION/three PAID packs, Google Ad Manager and Rewarded Energy. No production value was guessed.

## Important migration boundary

The current database schema and existing credit/reminder repositories are still Group-scoped (`credit_accounts.group_id`, WELCOME/AD/PAID enum). They are not yet safe to use as the final V1 User Energy implementation. Round 15 deliberately introduced the new domain model first rather than partially rewriting financial SQL without dependency-aware verification.

The next implementation must migrate financial ownership atomically to a stable user owner (prefer `line_users.id` with LINE id retained for external identity), add lot-level expiry so multiple subscription/ad grants can coexist safely, and then migrate AI usage/allocation and Reminder reservations to the user owner. Existing reconciliation/audit history must remain readable.

## Verification status

GitHub Actions remains an external blocker if its `verify` job receives no runner/steps. The available environment previously had Node 22 + TypeScript 5.8.3 but no pnpm. New Round 15 domain modules are dependency-light; focused Vitest tests are committed for the first dependency-aware run.

Do not claim the legacy Group credit SQL implements the new product model until the user-wallet migration lands and dependency-aware checks run.

## Round 16 — highest priority

1. Re-check CI first. If repository steps execute, fix all real typecheck/lint/test/build issues immediately.
2. Implement User Energy persistence: user-owned Energy lots with FREE/SUBSCRIPTION/AD/PAID, expiry, reservation, immutable operations/transactions and idempotent references.
3. Replace first-group/later-group Welcome grants with one lifetime FREE grant per LINE user.
4. Implement user-level subscription entitlement/cycle grant primitives and three configurable PAID pack purchase primitives behind payment-provider-neutral interfaces; external provider values remain env placeholders.
5. Migrate explicit @AI funding preflight/settlement so caller-only Energy is used. Add deterministic exhausted reply + Group Energy status path without Gemini.
6. Implement background participant query from extraction messages + user wallets; skip before Gemini when no eligible speaking user; pass eligible subjects into classifier and persist only those subjects; settle proportional actual cost + platform shortfall subsidy atomically.
7. Migrate Reminder ownership/reservation from Group PAID-only to user SUBSCRIPTION/PAID eligibility and prevent delivery after owner leaves destination Group.
8. Implement Google Ad Manager provider abstraction/nonce claim boundary and 7-day AD Energy grant. Keep actual ad account/unit config blank until supplied.
9. Update LIFF from Group credit overview to authenticated user's private Energy details, subscription/pack placeholders and rewarded-ad entry.
10. Revisit retention SQL after user-wallet migration so Group cleanup cannot delete user-owned value.

## Process note

External account/key/ad/payment settings are configuration tasks, not feature-development blockers. Leave documented env placeholders and continue all code paths that can be implemented safely without credentials. Never invent pricing, Energy amounts, provider secrets or production URLs.
