# AFTERTRACE Development Progress

## Current status

Round 14 is complete on `main`. The V1 LIFF management surface now has a real authenticated Group boundary plus memory search/edit/delete, safe credit/usage status, and paid Reminder management. The frontend is no longer a landing-page placeholder.

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
14. Authenticated LIFF Group management API/UI for memories, safe credit/usage status and paid Reminder management.

## Round 14 — completed

### LIFF authentication and Group authorization

- Added `management/session.ts`.
- Browser sends the LIFF access token plus `liff.getContext().groupId`; browser never sends a trusted user id.
- Server verifies the token through LINE `/oauth2/v2.1/verify`, requires returned `client_id === LIFF_CHANNEL_ID`, checks positive remaining expiry, then resolves the user through `/v2/profile`.
- Server verifies current membership through Messaging API `/v2/bot/group/{groupId}/member/{userId}` before returning Group product data.
- A true member 404 is distinguished from LINE 429/5xx; provider instability returns `LINE_VERIFICATION_UNAVAILABLE` instead of falsely claiming the user left the Group.
- Inactive/unknown Groups are rejected.
- Management CORS uses exact `LIFF_WEB_ORIGIN`; wildcard origin is not allowed.

### Memory management

- Added `ManagementService` and `DrizzleManagementRepository`.
- `GET /api/v1/management/memories?q=` lists only ACTIVE memories and returns stored source metadata.
- `PATCH /memories/:id` edits category/subject/content inside the authenticated Group boundary and writes actor-attributed `MEMORY_EDITED` before/after audit.
- `DELETE /memories/:id` takes a before snapshot into `MEMORY_DELETED` audit and removes the product memory row. This intentionally does not blacklist the fact; later conversation may create it again.
- No new unverified Drizzle enum/migration was introduced merely to represent deletion.

### Safe Energy / credit / usage management

- `GET /overview` exposes WELCOME/AD/PAID availability/reservation state and AI usage call count.
- Raw internal TWD/Gemini costs are intentionally not returned as user-facing Energy because V1 has not confirmed an Energy conversion rule.
- Rewarded Ad status includes today's accepted grant count and configured policy limit/cooldown.
- `rewardedAdClaimEnabled` remains false until a Web ad provider with a trustworthy server-verifiable completion boundary is selected.
- Existing `RewardedAdService.grantVerifiedReward()` is deliberately not exposed directly to LIFF, because a browser-supplied reward event id would permit fraudulent AD-credit minting.

### Paid Reminder management

- `GET /reminders` provides Group Reminder state.
- `DELETE /reminders/:id` reuses the existing atomic cancellation/release lifecycle and actor attribution.
- `POST /reminders` never accepts a reservation amount from the browser. The server uses `REMINDER_RESERVATION_COST_TWD` only when the operator explicitly configures it.
- Missing Reminder price returns `REMINDER_PRICING_NOT_CONFIGURED`; the UI keeps creation disabled while existing Reminder management remains available.
- `DISPATCHING` Reminder is not presented as normally cancellable because delivery has crossed the external-send boundary.

### React/Vite LIFF UI

- `apps/web` now initializes `@line/liff`, requires a Group context and uses `liff.getAccessToken()` for server authentication.
- Added memory search, source display, edit modal and delete flow.
- Added Energy/Credit state cards without exposing raw internal costs.
- Added Rewarded Ad policy/status entry with a disabled reward button until provider verification exists.
- Added Reminder create/list/cancel UI with server capability gating.
- Added explicit startup failures when `VITE_LIFF_ID`, `VITE_API_BASE_URL`, login or Group context is unavailable.

### Tests / documentation

- Added `management/service.test.ts` for search/edit validation/normalization.
- Added `management/session.test.ts` for channel verification, server-resolved user identity, current membership and provider-rate-limit classification.
- Added `docs/LIFF_MANAGEMENT.md` and documented the new external settings in `.env.example`.
- LINE's current official LIFF guidance was checked before implementing server-side access-token verification; it recommends sending the LIFF token to the server, validating the access token/channel and resolving profile data from LINE rather than trusting profile data sent by the browser.

## Verification status

Round 14 implementation commit: `3aefbee6311324589ecbabc97c9c83f1892bb617`.

The pre-Round-14 CI was still blocked before repository execution: run `33233657314` for `763d326c` had an empty `verify` step list. The Round 14 commit must be re-checked after push; only a run that actually starts Checkout/repository commands can count as dependency-aware verification.

The available local environment provides Node `v22.16.0` and TypeScript `5.8.3`, but no `pnpm`. Pure-domain/static checks can be run there; full `pnpm install -> typecheck -> lint -> test -> Wrangler build -> Vite build -> Drizzle generate` cannot be claimed until dependencies are available or GitHub Actions actually assigns a runner.

No Neon/LINE/Cloudflare/Gemini secret, production LIFF/channel id, production origin, Reminder price, ad provider event, provider price, FX rate or global free-budget amount was guessed.

## Round 15 — highest priority

1. Re-check CI on the Round 14 commit. If repository steps finally execute, fix every real install/typecheck/lint/test/build/Drizzle issue before further product work.
2. Choose/confirm a Web-capable Rewarded Ad provider and implement server-verifiable completion before enabling LIFF AD-credit minting. Do not accept a browser-generated reward id as proof of ad completion.
3. Define the product Energy/Credit conversion/display rule; only then expose user-facing numeric Energy balances.
4. Define authenticated operator/admin authorization, then expose the existing fenced Memory/Reminder recovery primitives through that boundary.
5. Once dependency-aware verification is available, compose `MemoryAiOrchestrator` + funding eligibility into the event-driven LINE path. Real Gemini stays disabled unless API key, provider pricing, FX and global free-AI ceiling are configured.
6. Consolidate the pre-migration Drizzle schema and generate the initial migration only after dependency-aware verification is available and schema/runtime composition is stable.
7. Complete deployment/runbook documentation for Neon, LINE webhook + LIFF, Cloudflare Worker/Pages/Cron and Gemini activation inputs without embedding secrets.

## Process note

Never bypass durable-result reuse, credit/usage idempotency, source grounding, global free-AI limits, request fencing, Reminder PAID reservation atomicity, dispatch fencing, LINE retry-key reuse, retention reconciliation preservation, LIFF token/channel/member verification or verified Rewarded Ad completion merely to make connectivity appear complete sooner.
