# AFTERTRACE Architecture

## V1 stack

- Language: TypeScript
- Monorepo: pnpm workspaces
- API/runtime: Hono on Cloudflare Workers
- LIFF: React + Vite + TypeScript on Cloudflare Pages
- Database: PostgreSQL on Neon
- Data/migrations: Drizzle ORM / Drizzle Kit
- AI: Gemini 2.5 Flash-Lite Standard
- V1 intentionally has no Redis and no object storage.

## Ownership boundaries

AFTERTRACE deliberately separates Group product context from User financial ownership.

### Group-owned

- Conversation buffer
- Extraction batches
- Memories and memory sources
- Group membership snapshot
- Reminder/Proactive Push destination
- Group audit context

### User-owned

- Energy wallet and lots
- FREE / SUBSCRIPTION / AD / PAID value
- Subscription billing cycles
- One-time PAID purchases
- Rewarded Ad claims
- Reminder ownership/payment
- Per-user AI allocation/charge history

The same LINE user uses one Energy wallet across every AFTERTRACE Group. Leaving a Group never transfers the user's Energy to anyone else.

## Runtime overview

```text
LINE Group
   |
   v
Cloudflare Worker / Hono
   |-- LINE signature verification
   |-- ordered/idempotent conversation ingestion
   |-- line_users + group_members observation
   |-- lifetime FREE ensure-once
   |-- deterministic @AI commands
   |-- caller-only @AI Energy preflight
   |-- extraction batch claim
   |-- background eligible-participant preflight
   |-- automatic memory request + eligible snapshot
   |
   +--> Neon PostgreSQL
   +--> LINE Messaging API

Memory AI execution boundary
   |-- request claim / lease / retry fence
   |-- eligible-subject-aware classifier input
   |-- Gemini structured output
   |-- durable classifier result
   |-- User Energy settlement / platform subsidy
   |-- candidate validation + persistence hard gate
   +--> Neon PostgreSQL

LIFF
   |-- Group memory/reminder management
   |-- private User Energy overview
   |-- rewarded-ad nonce/claim API
   +--> Worker API --> Neon

Cron
   |-- User-owned Reminder delivery
   |-- Group retention cleanup
   +--> LINE Push / Neon
```

Billable Gemini execution remains activation-gated until request-aware pre-provider funding/budget safety is composed. Missing external configuration must disable the provider path without blocking surrounding product development.

## LINE ingestion

`POST /webhooks/line` verifies `x-line-signature` against the raw body before JSON parsing.

Only LINE Group context enters the V1 shared-memory pipeline. Supported messages are normalized and persisted in a bounded conversation buffer. Image/video/audio/file/sticker content is not copied; only supported metadata/reference information is retained.

`conversation_messages.line_message_id` is unique, so LINE redelivery cannot increment extraction counters twice. Group lifecycle events activate/inactivate the Group. Messages received while inactive are ignored until a later join/reactivation.

Every observed sender is ensured in `line_users`; `group_members` records the Group membership snapshot used for management permissions, Energy availability display and Reminder delivery safety.

## User Energy model

`user_energy_lots` is the source of spendable User value.

Buckets:

1. `FREE`: one lifetime grant per User, no expiry.
2. `SUBSCRIPTION`: one billing-cycle grant per provider cycle, expires at provider `period_end`, no rollover.
3. `AD`: Rewarded Ad grant, expires seven days after accepted claim.
4. `PAID`: one-time pack grant, no expiry.

A lot stores original, available and reserved units plus stable source identity and expiry.

Consumption ordering is deterministic:

1. expiring lots by `expires_at ASC`;
2. FREE;
3. PAID.

No mutation may create a negative balance.

### Reconciliation

- `user_energy_operations`: logical idempotent mutation key.
- `user_energy_transactions`: exact per-lot mutation history.
- `user_energy_reservations`: reservation lifecycle.
- `user_energy_reservation_allocations`: exact originating lots for release/settlement.
- `user_subscription_cycles`: provider billing-cycle identity.
- `user_paid_purchases`: provider purchase identity.

The legacy Group Credit tables remain readable for old history only. New V1 AI/Reminder/monetization code must not create new Group-owned value.

## Explicit @AI

An explicit AI request belongs financially to the invoking LINE user.

Before a request is allowed into the AI path, the backend queries that caller's User wallet. Another Group member is never considered as fallback funding.

If the caller is exhausted:

- Gemini is not invoked;
- LINE receives a deterministic Energy-exhausted response;
- Group members are shown only as `可使用 / 已用完`;
- numeric balances/purchase information remain private in LIFF.

`@AI 額度`, help and plan commands are deterministic and never consume Energy.

The final AI settlement adapter resolves the caller by LINE identity and consumes only that User's wallet using an idempotent request reference.

## Background memory eligibility

A due extraction batch is evaluated before an automatic memory request is created.

A User is eligible only when:

- they contributed valid textual content to the current extraction batch; and
- they had positive usable Energy at preflight.

If no eligible participant exists, the extraction batch is terminally closed with a no-eligible reason before automatic request creation or Gemini invocation. Later recharge does not resurrect that old batch.

For an eligible batch, `automatic_memory_eligible_subjects` snapshots:

- stable User id;
- LINE user id;
- normalized character contribution;
- preflight available Energy.

The snapshot is created atomically with the AUTOMATIC memory request.

Gemini may receive complete Group context, including ineligible speakers, because their text may be needed to understand an eligible speaker's statement. They remain context-only subjects.

## Memory subject hard boundary

Automatic subject authorization is enforced independently at multiple layers:

1. eligible subject snapshot at request creation;
2. model prompt exposes only eligible ephemeral speaker aliases as durable-memory subjects;
3. classifier output validation requires the source current message to belong to an eligible User;
4. memory persistence repeats the same check against `automatic_memory_eligible_subjects`.

A prompt injection or accidental direct repository call therefore cannot legitimately persist an automatic memory sourced from an ineligible speaker.

Previous successful extraction may be supplied as context but can never be used as a newly emitted `sourceConversationMessageId`.

## AI result durability and retry fencing

Memory work ownership uses request claim leases and monotonic attempt counters. The attempt count is a fencing token: stale Workers cannot persist the first model result, mutate memories or close a newer claim.

A validated model response is stored before memory mutation. Retry reuses that durable result with its original provider/model/token/pricing/FX snapshot rather than calling Gemini again under new pricing.

Retryable provider failures use bounded exponential retry; configuration/auth/model errors are terminal for the current request.

## User Energy AI settlement

Provider cost remains recorded in USD/TWD while the customer wallet is denominated in Energy. The product conversion is explicitly configured by `ENERGY_UNITS_PER_TWD`.

The conversion is intentionally not guessed. Missing conversion disables User-Energy AI billing activation.

`ai_energy_usage_events` stores one provider usage record per logical memory request. Background calls fan out through `ai_user_energy_allocations` rather than pretending one Group credit operation funded the call.

### Background allocation

Actual Energy cost is allocated among the snapshotted eligible Users in proportion to their normalized text-character contribution.

At final settlement current wallet balances are locked and re-read. For each eligible User:

- charge at most that User's own remaining Energy;
- if their final share exceeds the remaining balance, consume to exactly zero;
- the remainder becomes that User's platform shortfall subsidy;
- never shift the shortfall to another member.

`platform_ai_subsidy_operations` records each subsidized User/share.

### Global free-AI hard gate

Background settlement uses the existing `global_free_ai_budget_state` row with budget key `V1_FREE_AI`.

The settlement transaction locks both global budget state and relevant User Energy lots before mutations. If required platform subsidy would exceed the configured ceiling, that settlement does not deduct User Energy.

A call that is fully User-funded has zero platform subsidy and is not blocked merely because the platform subsidy budget is already exhausted.

A request-aware pre-provider budget/funding guard is still required before automatic Gemini invocation is enabled in production. Final settlement safety is implemented; provider activation must not be claimed complete until the pre-call boundary is also composed.

## Memory persistence

The classifier emits only `NEW`, `DUPLICATE`, `UPDATE`, or `CONTRADICT`.

- `NEW`: creates an ACTIVE memory.
- `DUPLICATE`: creates no duplicate memory.
- `UPDATE`: creates a replacement ACTIVE memory and supersedes the old row.
- `CONTRADICT`: same replacement shape, distinct audit action.

Candidate persistence is idempotent by `(request_id, candidate_index)` and rejects retries that reinterpret decision/source/target/content.

Long-term memories copy source metadata needed after conversation-buffer cleanup.

## User-owned Reminder

A Reminder has two independent dimensions:

- owner/payer: User;
- destination: Group.

New Reminder creation uses `user_reminder_ownership` plus User Energy reservations. Legacy Group-credit reservation columns on `reminders` exist only to keep historical rows readable.

Creation requires:

- authenticated owner User;
- active destination Group;
- owner currently active in that Group;
- enough eligible proactive Energy.

Reservation ordering:

1. SUBSCRIPTION lots whose `expires_at` is later than the scheduled delivery boundary;
2. PAID lots.

FREE/AD never fund Reminder.

Cancellation is owner-only and releases the exact reserved lots.

### Delivery

Cron claims due User-owned reminders with a delivery lease/retry key.

Immediately before Push, authorization rechecks current destination Group and owner membership.

If the owner has left:

- no LINE Push occurs;
- Reminder becomes CANCELLED;
- exact Energy reservation is released;
- an audit event records owner-left cancellation.

If LINE accepts the Push, the exact reservation becomes `CONSUMED` and the Reminder becomes DELIVERED atomically. Retryable delivery failures preserve the LINE retry key. Ambiguous/permanent failures do not guess whether the reservation should be consumed or refunded.

`REMINDER_RESERVATION_ENERGY` is product configuration and remains blank until pricing is finalized.

## Rewarded Ad

V1 uses Google Ad Manager Web Rewarded behind a provider abstraction.

Web rewarded completion is not mobile-app SSV. The backend therefore explicitly avoids describing the browser event as cryptographically provider-verified.

The V1 anti-replay/abuse boundary is:

1. authenticated LIFF User;
2. server-issued random nonce;
3. only SHA-256 nonce hash stored server-side;
4. ten-minute nonce expiry;
5. one-time nonce consumption;
6. provider-event idempotency;
7. User-level cooldown;
8. User-level daily limit;
9. accepted claim mapped to a stable 7-day AD Energy grant.

Endpoints:

- `POST /api/v1/energy/rewarded-ad/nonce`
- `POST /api/v1/energy/rewarded-ad/claim`

Missing `REWARDED_AD_ENERGY`, Google network code or ad-unit path keeps this path disabled.

## LIFF privacy boundary

Group memory/reminder management still requires verified Group context and current membership.

Private Energy does not require a Group because the wallet belongs to the User. `GET /api/v1/energy/me` verifies LIFF identity and returns only the authenticated User's:

- bucket balances;
- reserved amounts;
- lot expirations;
- proactive capability.

Other Group members' numeric balances are never returned through the Group Energy status path.

## Retention

Group retention deletes recoverable/private Group product data only after the configured inactive window and only when no active Reminder/reservation blocks cleanup.

It never deletes User wallet/subscription/purchase/Energy transaction tables.

When User-owned financial reconciliation still references a Group, the cleanup retains a minimal Group anchor instead of orphaning those records.

Financial memory requests may be redacted rather than deleted so AI usage/allocation records keep a stable request identity. User-owned terminal Reminder text is redacted while Reminder ownership/reservation identity remains available for reconciliation.

The legacy 30-day never-paid / 365-day paid Group timing remains a compatibility policy and must not be interpreted as ownership of User value.

## Portability and scale

Business rules remain in domain/services. Hono routes, Cloudflare execution context, Neon SQL and provider clients are adapters.

V1 stays LINE -> Workers -> Neon. If ingestion/AI workloads grow, introduce a queue behind webhook acceptance rather than replacing the LINE edge entry point.

## Observability

Use structured logs with request/event ids, non-sensitive correlation ids, event type, latency, provider/model/token/cost information and reconciliation ids.

Never log secrets, raw private conversation text or raw LINE user/group identifiers by default.
