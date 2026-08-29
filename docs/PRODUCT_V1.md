# AFTERTRACE V1 Product Requirements

## Product

AFTERTRACE is a LINE-first shared life memory assistant. LINE remains the primary conversation surface; LIFF is the management/search/payment surface. AFTERTRACE is not a LINE backup service and does not promise permanent storage of LINE attachments.

## Ownership boundary

A LINE group is the isolation boundary for conversation context, memories, memory sources and the destination of reminders/proactive messages. Energy, subscriptions, rewarded-ad rewards and one-time purchases belong to the LINE user, not to a group.

The same LINE user uses one Energy wallet across every AFTERTRACE group they participate in. Leaving a group never transfers that user's Energy to the remaining members.

Every current group member may manage group memories. Changes and deletions must record the actor in an audit log.

## Conversation buffer

Supported LINE group messages received by the bot are ingested into a short-lived conversation buffer. Full conversation history is not retained indefinitely.

Processing is event-driven. V1 defaults remain configurable:

- extraction checkpoint: 30 new messages
- character trigger: 5,000 characters
- large-message marker: 2,000 characters

The previous processed batch may be retained as context for the next extraction. After the next extraction succeeds, older context can be removed according to retention rules.

## User Energy

Energy buckets are user-scoped:

1. FREE — one lifetime onboarding grant per LINE user; does not expire.
2. SUBSCRIPTION — one V1 subscription plan; a successful billing cycle grants Energy that expires at that cycle's `period_end`; unused Energy does not roll over.
3. AD — Google Ad Manager Web Rewarded; granted Energy expires 7 days after the verified/accepted reward claim.
4. PAID — one-time Energy packs; V1 supports three pack definitions; purchased Energy does not expire.

Consumption rule:

- expiring Energy is consumed first by earliest `expires_at`;
- then FREE;
- then PAID.

No AI operation may create a negative user balance.

FREE and AD provide normal @AI and background-memory capability. SUBSCRIPTION and PAID additionally unlock proactive Push and Reminder capability. PAID proactive capability requires usable PAID Energy; a historical purchase with zero usable PAID balance does not permanently unlock proactive service.

Actual pack prices, subscription price/Energy, initial FREE amount and rewarded-ad Energy amount are deployment/product configuration and must not be guessed in code.

## Background memory charging

Background memory is group-contextual but user-funded.

Before calling Gemini for a due extraction batch, the backend deterministically computes participants from real textual messages and checks their user Energy. A user is eligible for background memory only when:

- the user has positive usable Energy at preflight; and
- the user contributed valid textual content in the current extraction batch.

If there are no eligible participants, the batch must stop before Gemini invocation. Conversation buffering continues, but no AI cost is incurred for that extraction attempt.

When at least one participant is eligible:

- Gemini may read the complete group batch/context, including messages from ineligible members when needed to understand the eligible user's statements;
- Gemini may only create/update/contradict durable memories whose subject is an eligible participant;
- ineligible users' messages are context only and must not create durable memories about those users in that batch.

Background AI user cost is allocated only among eligible participants, proportional to their normalized textual character contribution in the current batch. Contributions from ineligible users do not enter the denominator.

If an eligible participant had positive Energy at preflight but the final allocated actual charge exceeds their remaining balance, consume their remaining Energy down to exactly zero and record the one-time shortfall as an AFTERTRACE platform subsidy for that extraction. Do not shift that shortfall to another group member. The subsidy must be observable/reconcilable and remain subject to the global free-AI safety ceiling. On the next batch that exhausted user is no longer eligible until they obtain Energy again.

Background extraction is not retroactively triggered merely because a previously empty user later obtains Energy; new eligible conversation drives new extraction work.

## Explicit @AI charging and deterministic commands

An explicit @AI AI request is always charged only to the LINE user who invoked it. Another member's Energy is never used as fallback.

Before Gemini invocation, check the caller's usable Energy. If the caller has no Energy, do not invoke Gemini. Reply deterministically that their Energy is exhausted, show the group's member Energy availability status, and include the configured AFTERTRACE LIFF URL.

Group status output intentionally exposes only availability, not another member's numeric balance or purchase details, for example:

```text
AFTERTRACE｜群組 Energy

🟢 Ryan　可使用
🔴 Amber　額度已用完
🟢 Len　可使用

想查看自己的詳細 Energy、訂閱、購買 Energy 或觀看廣告，可開啟 AFTERTRACE：
{LIFF_APP_URL}
```

`@AI 額度` is a deterministic command. It performs database queries and LINE reply formatting only: no Gemini call and no Energy charge. Similar deterministic help/plan commands may follow the same rule.

LIFF may show the authenticated user's detailed bucket balances and expirations; it must not expose other users' private numeric balances.

## Memory

Gemini may automatically retain information likely to be useful later subject to the background eligibility rules above. Users may explicitly request memory creation with @AI / reply interactions; explicit work is charged to the caller.

Every candidate must be compared with existing active group memories and classified as NEW, DUPLICATE, UPDATE or CONTRADICT. Duplicate information is not inserted again. Updates enrich/replace the current fact. Contradictions supersede obsolete active information while retaining sufficient audit history.

Memories expose their source when LINE metadata permits. Users can edit or delete memories in LIFF. Deleted facts are not permanently blacklisted; future eligible conversation may establish them again.

## Rewarded Ad

V1 rewarded ads use Google Ad Manager Web Rewarded behind a provider abstraction. Web rewarded completion is not treated as equivalent to mobile-app SSV. The implementation must use a server-issued one-time claim/nonce, idempotency, cooldown, daily limits, audit and abuse controls before minting AD Energy.

Google network/ad-unit values remain environment configuration and may be blank until the operator creates the account/configuration.

## Subscription and one-time purchase

V1 has one subscription plan and three one-time Energy pack definitions. Payment-provider integration is adapter-based; product logic must not depend on a specific provider until selected/configured.

Subscription Energy expires at the billing provider's actual period end and does not roll over. Cancellation does not remove already-paid current-period Energy before `period_end`.

PAID Energy is permanent until consumed and follows the user across groups.

## Proactive Push and Reminder

Proactive Push and Reminder are available only when the initiating/owning user has SUBSCRIPTION or usable PAID capability. FREE and AD do not unlock proactive Push/Reminder.

A Reminder belongs to a user and targets a group. It must never consume another member's Energy. Reservation must use eligible SUBSCRIPTION/PAID Energy. Expiring subscription value may only fund a reminder when its validity safely covers the reminder settlement/delivery boundary; otherwise use eligible PAID value or reject creation.

Successful delivery consumes the owner's reservation; cancellation releases it. If the owner is no longer a current member of the destination group before dispatch, the reminder must not be sent and its reservation must be safely resolved according to the reminder lifecycle.

## AI and cost safety

Default model: Gemini 2.5 Flash-Lite Standard. Prefer structured output. Record provider/model, token usage, usage type, latency, actual provider cost, user charge allocation and any platform shortfall subsidy for every billable AI call.

The global free-AI budget remains a final hard safety boundary for platform-funded cost, including background shortfall subsidy. Missing external keys/prices/URLs disable the external invocation path safely but do not block implementation of the surrounding product logic.

## Attachments

V1 does not persist LINE image/video/file binaries. When a memory refers to supported LINE content, AFTERTRACE stores reference metadata only. Availability of the original content remains LINE's responsibility.

## Retention

Conversation/memory remains group-scoped while financial ownership becomes user-scoped. Retention cleanup must never delete or orphan user Energy, subscription/payment, AI allocation, reminder reservation or audit records required for reconciliation. Existing 30-day never-paid / one-year paid group product-data retention must be re-evaluated during the user-wallet migration so group cleanup cannot destroy user-owned value.
