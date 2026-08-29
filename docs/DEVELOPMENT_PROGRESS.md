# AFTERTRACE Development Progress

## Current status

Round 14 implementation is prepared but the final main-branch feature commit is still being landed. The V1 LIFF management surface adds an authenticated Group boundary plus memory search/edit/delete, safe credit/usage status, and paid Reminder management. The frontend is no longer a landing-page placeholder.

The LIFF API does not trust browser-supplied user identity. It verifies the LIFF access token and channel with LINE, resolves the user from LINE, then verifies current Group membership with the Messaging API before exposing Group-scoped data. Cross-origin access is restricted to an explicit `LIFF_WEB_ORIGIN`.

Rewarded Ad grant minting is intentionally still disabled from LIFF because no Web rewarded-ad provider / server-verifiable completion contract has been confirmed. The UI exposes policy/status only. Real Gemini invocation also remains intentionally disconnected from the LINE webhook/runtime composition while dependency-aware CI cannot execute repository steps and production AI inputs remain unset.

## Confirmed V1 baseline

- TypeScript + pnpm monorepo; Hono on Cloudflare Workers; React/Vite LIFF on Cloudflare Pages.
- PostgreSQL on Neon + Drizzle; Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis/Object Storage.
- LINE Group is the isolation boundary for conversation context, memories, reminders, usage and credits.
- Conversation extraction is event-driven; explicit and automatic memory work share one pipeline.
- Memory decisions are NEW / DUPLICATE / UPDATE / CONTRADICT with source attribution and audit history.
- Credit order is Welcome -> Ad -> Paid; paid value does not expire; Reminder is paid-only.
- User-facing UI must not expose raw Gemini/internal TWD cost as if it were product Energy.
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

## Round 14 — implementation prepared

- Authenticated LIFF Group management boundary.
- Memory list/search/edit/delete with source metadata and audit.
- Safe Energy/Credit state without raw internal-cost exposure.
- Rewarded Ad policy/status UI only; minting remains disabled pending provider verification.
- Paid Reminder list/create/cancel with server-controlled pricing gate.
- React/Vite LIFF management interface and startup validation.
- Focused management/session tests and `docs/LIFF_MANAGEMENT.md`.

## Verification status

The pre-Round-14 CI was still blocked before repository execution: run `33233657314` for `763d326c` had an empty `verify` step list.

The available local environment provides Node `v22.16.0` and TypeScript `5.8.3`, but no `pnpm`. Full `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` cannot be claimed until dependencies are available or GitHub Actions actually assigns a runner.

No Neon/LINE/Cloudflare/Gemini secret, production LIFF/channel id, production origin, Reminder price, ad provider event, provider price, FX rate or global free-budget amount was guessed.

## Next

Land the prepared Round 14 feature tree on `main`, re-check CI, then continue Rewarded Ad provider verification / Energy display policy / operator auth / Gemini composition according to the confirmed V1 requirements.
