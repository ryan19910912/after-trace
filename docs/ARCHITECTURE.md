# AFTERTRACE Architecture

## V1 stack

- TypeScript / pnpm workspaces
- Hono on Cloudflare Workers
- React + Vite LIFF on Cloudflare Pages
- PostgreSQL on Neon
- Drizzle ORM / Drizzle Kit
- Gemini 2.5 Flash-Lite Standard
- Google Ad Manager Web Rewarded
- V1 intentionally has no Redis and no object storage.

## Ownership

### Group-owned

- Conversation buffer and extraction context
- Memories and source metadata
- Group membership snapshot
- Reminder / Proactive destination
- Group audit context

### User-owned

- FREE / SUBSCRIPTION / AD / PAID Energy lots
- Subscription and one-time purchases
- Rewarded Ad rewards
- AI charges/holds
- Reminder ownership/payment
- Proactive capability

One LINE user has one wallet across all Groups. User value is never transferred to other members when membership changes.

## Runtime overview

```text
LINE Group
   |
   v
Cloudflare Worker / Hono
   |-- verify LINE signature
   |-- parse message + join/leave + memberJoined/memberLeft
   |-- idempotent conversation ingestion
   |-- update line_users / group_members
   |-- ensure lifetime FREE
   |
   |-- deterministic @AI command ----------------------> LINE Reply
   |-- generic @AI -> caller Energy hold -> Gemini ----> LINE Reply
   |-- @AI 記住 -> memory request
   |-- extraction due -> eligible snapshot -> memory request
   |
   +--> Memory AI waitUntil runtime
          |-- claim/lease/fence
          |-- provider pre-funding/budget gate
          |-- Gemini structured classifier
          |-- durable result
          |-- User Energy settlement
          |-- memory hard-gated persistence

LIFF
   |-- Group Memory / Reminder management
   |-- private User Energy + subscription state
   |-- Energy product catalog
   |-- Google Publisher Tag Rewarded
   +--> Worker APIs --> Neon

Internal provider boundaries
   |-- verified commerce events -> subscription/PAID grants
   |-- approved proactive triggers -> proactive queue

Cron
   |-- User-owned Reminder delivery
   |-- Proactive Push delivery
   |-- Group retention
   +--> LINE Push / Neon
```

Missing external keys/prices/provider configuration disables only the affected external path. It does not change product ownership or block surrounding development.

## LINE ingestion and membership

`POST /webhooks/line` verifies `x-line-signature` against the raw request body before parsing.

Only Group conversations enter the V1 shared-memory pipeline. Supported text/location data is buffered; attachment binaries are not copied.

`conversation_messages.line_message_id` is unique, so redelivery cannot double-increment extraction counters.

Lifecycle handling covers:

- bot `join` -> Group ACTIVE;
- bot `leave` -> Group INACTIVE;
- `memberJoined` -> touched/active `group_members` rows;
- `memberLeft` -> `group_members.is_active=false`.

The membership snapshot is used by LIFF authorization, Reminder owner-left safety and Proactive Push delivery safety.

## User Energy

`user_energy_lots` is the spendable source of truth.

Buckets:

1. FREE — lifetime once, no expiry.
2. SUBSCRIPTION — billing-cycle grant, expires at provider `period_end`, no rollover.
3. AD — accepted Rewarded claim, seven-day expiry.
4. PAID — one-time pack, no expiry.

Consumption order:

1. expiring lots by earliest `expires_at`;
2. FREE;
3. PAID.

User Energy mutations are idempotent and never allow negative value.

Reconciliation uses:

- `user_energy_operations`;
- `user_energy_transactions`;
- `user_energy_reservations`;
- exact reservation lot allocations;
- subscription cycles;
- paid purchases.

Legacy Group Credit tables are history-only compatibility data. New V1 paths do not mint new Group-owned value.

## Generic `@AI`

A non-deterministic/non-memory-command `@AI` request is grounded in recent Group messages and ACTIVE Group memories.

Before Gemini:

- caller identity resolves to one User wallet;
- recent speakers are replaced with ephemeral aliases;
- a conservative maximum provider cost is converted with configured `ENERGY_UNITS_PER_TWD`;
- that maximum Energy is held from the caller's own lots.

After Gemini:

- actual token usage produces actual TWD cost;
- actual cost converts to Energy;
- only actual Energy is consumed;
- unused held Energy is returned to its originating lots.

Provider failure releases the whole hold.

`explicit_ai_chat_requests` uses LINE message identity for retry/redelivery idempotency. Completed answers can be reused without a second provider charge.

Another member's Energy is never used.

## Deterministic commands

`@AI 額度`, help and plan commands do not call Gemini and do not consume Energy.

Group Energy replies expose only `可使用 / 已用完`. Numeric balances and purchase/subscription details are private to LIFF.

## Automatic Memory

A due extraction batch first computes actual textual contributors and current User Energy.

Eligible means:

- positive normalized textual contribution in the current batch; and
- positive usable Energy at preflight.

No eligible User -> extraction closes before automatic request creation/Gemini.

For eligible work, `automatic_memory_eligible_subjects` is created with the automatic request and snapshots User id, LINE identity, normalized contribution and preflight Energy.

Gemini may read complete Group context, including ineligible speakers, but durable memory creation is restricted at multiple layers:

1. request eligible snapshot;
2. prompt eligible aliases;
3. classifier source validation;
4. DB persistence validation.

Previous extraction context can inform classification but cannot become a newly emitted source.

## Memory AI execution and budget safety

Memory requests use lease/fencing ownership. Durable classifier results preserve the original provider/model/token/pricing/FX snapshot and are reused on retry.

Before a Background Gemini call, AFTERTRACE creates `platform_ai_budget_reservations` against the global `V1_FREE_AI` ceiling. Reservation decisions use a PostgreSQL transaction-scoped advisory lock in the same SQL statement that reads spent/reserved budget and creates the reservation.

Provider failure releases the reservation.

Final settlement:

- allocates actual Energy among eligible Users by normalized text contribution;
- locks current User lots;
- charges each User at most their own remaining balance;
- converts only that User's shortfall into Platform Subsidy;
- never transfers shortfall to another member;
- records `ai_user_energy_allocations` and `platform_ai_subsidy_operations`;
- settles the pre-provider global budget reservation.

`ai_energy_usage_events` stores provider usage per memory request.

## Reminder

Reminder owner/payer is User; Group is destination.

Creation requires owner still active in destination Group and enough proactive-capable Energy.

Reservation order:

1. SUBSCRIPTION whose expiry safely exceeds delivery time;
2. PAID.

FREE/AD never fund Reminder.

Cancellation is owner-only and releases exact originating lots. Successful LINE delivery consumes the exact reservation only after LINE accepts Push.

Before dispatch, membership is rechecked from webhook-fed Group membership state. Owner-left means cancel + release + no Push.

## Proactive Push

Proactive capability belongs to a User with usable SUBSCRIPTION or PAID Energy.

V1 product rules do not yet define which real-world/memory conditions should generate a proactive message, so infrastructure does not invent trigger logic.

A trusted internal boundary accepts an already-approved trigger result containing owner, Group destination, source id, message and schedule.

Enqueue checks current Group membership + proactive capability. Delivery rechecks both again. If capability or membership disappears before delivery, the push is cancelled rather than sent.

Proactive delivery uses LINE retry keys and dispatch leases. Delivery itself does not invent an additional Energy price; any AI work used to generate proactive content must be funded separately by the AI path that generated it.

## Rewarded Ad

Google Ad Manager Web Rewarded uses:

- authenticated LIFF User;
- server-issued random nonce;
- SHA-256 nonce storage;
- nonce expiry and one-time consumption;
- provider-event idempotency;
- User-level cooldown/daily limit;
- 7-day AD Energy grant.

LIFF loads Google Publisher Tag and requests a nonce before showing the rewarded slot. The backend claim is submitted only after the rewarded-granted browser event.

Web Rewarded is not described as mobile SSV/cryptographic provider verification.

## Subscription / PAID commerce

Product logic is payment-provider-neutral.

The authenticated Energy catalog exposes configured Subscription and SMALL/MEDIUM/LARGE PAID products. Checkout buttons stay disabled until a concrete provider adapter exists.

A trusted verified-provider event boundary accepts normalized events:

- `SUBSCRIPTION_CYCLE_PAID`;
- `SUBSCRIPTION_CANCELLED`;
- `PAID_PACK_PURCHASED`.

Provider event ids are persisted for idempotency.

Subscription-cycle grants expire at actual `period_end`; cancellation never removes already-paid current-period Energy. PAID purchases create permanent lots.

No payment provider, product price or checkout URL is invented by core code.

## LIFF privacy

Group Memory/Reminder management requires verified Group context and current membership.

Private wallet endpoints require only authenticated LIFF User identity because Energy belongs to the User, not a Group.

`GET /api/v1/energy/me` exposes only that User's:

- usable/reserved totals;
- FREE/SUBSCRIPTION/AD/PAID buckets;
- lots + expiry;
- proactive capability;
- subscription provider/status/period end.

`GET /api/v1/energy/catalog` exposes product configuration without exposing another User's financial state.

## Retention

Group retention never deletes User wallet/subscription/purchase/Energy transaction value.

Active Reminder/Proactive work blocks purge.

Financial Memory AI requests and billed generic `@AI` requests keep minimal reconciliation identity while private prompt/content is redacted. Terminal Proactive data can be removed; User-owned Reminder financial identity remains retained/redacted as required.

A minimal Group anchor remains whenever User-owned financial history still references the Group.

Legacy 30/365-day Group timing remains compatibility policy until a new retention rule is explicitly chosen.

## Portability and scale

Business rules live outside route handlers. Hono, Cloudflare execution context, Neon SQL, Gemini, LINE, GAM and future payment providers remain adapters.

If load grows, a queue can be inserted behind webhook acceptance without changing ownership/business semantics.

## Observability

Use structured logs with non-sensitive correlation ids, request ids, event type, latency, provider/model/token/cost and reconciliation ids.

Never log secrets, raw private conversations or raw LINE user/group identifiers by default.
