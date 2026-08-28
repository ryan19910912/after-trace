# AFTERTRACE V1 Product Requirements

## Product

AFTERTRACE is a LINE-first shared life memory assistant. LINE remains the primary conversation surface; LIFF is the management/search surface. AFTERTRACE is not a LINE backup service and does not promise permanent storage of LINE attachments.

## Group boundary

A LINE group is the isolation boundary for conversation context, memories, reminders, usage, and credits. The same LINE user in different groups does not share group memory.

Every group member may manage group memories. Changes and deletions must record the actor in an audit log.

## Conversation buffer

All supported LINE group messages received by the bot are ingested into a short-lived conversation buffer. Full conversation history is not retained indefinitely.

Processing is event-driven. On each incoming message the system stores the message, updates pending message/character counters, and evaluates thresholds. V1 defaults are configurable:

- extraction checkpoint: 30 new messages
- character trigger: 5,000 characters
- large-message marker: 2,000 characters

The previous processed batch is retained as context for the next extraction. After the next extraction succeeds, the older context can be removed.

## Memory

Gemini may automatically retain any information it judges likely to be useful later and classifies it into an appropriate category.

Users may explicitly request memory creation with @AI / reply interactions. Explicit memory enters the same memory pipeline immediately rather than waiting for the background threshold.

Every candidate must be compared with existing active group memories and classified as one of:

- NEW
- DUPLICATE
- UPDATE
- CONTRADICT

Duplicate information is not inserted again. Updates enrich/replace the current fact. Contradictions supersede obsolete active information while retaining sufficient audit history.

Memories expose their source when LINE metadata permits (message id, quote token, source user/time). Users can edit or delete memories in LIFF. Deleted facts are not permanently blacklisted; future conversation may establish them again.

## Attachments

V1 does not persist LINE image/video/file binaries. When a memory refers to supported LINE content, AFTERTRACE stores reference metadata only. Availability of the original content remains LINE's responsibility.

## AI

Default model: Gemini 2.5 Flash-Lite Standard.

Prefer structured output. Record provider/model, prompt/input tokens, output tokens, usage type, latency, and calculated actual cost for every billable AI call.

## Credits

AFTERTRACE uses prepaid credits rather than subscriptions.

Credit buckets:

1. Welcome/free credit
2. Rewarded-ad credit
3. Paid credit

Consumption uses free/ad value before paid value. Paid credit does not expire.

Welcome defaults are configurable:

- first group activated by a LINE user: NT$1 internal AI-cost allowance
- later newly activated groups by the same user: NT$0.5

Rewarded-ad defaults are configurable:

- reward allowance: NT$0.01 internal AI-cost allowance
- maximum: 5 rewards per group/day
- cooldown: 15 minutes

User-facing UI uses product Energy/Credit units rather than exposing raw Gemini cost.

A global free-AI budget provides a final hard safety boundary.

## Reminder

Reminder is paid-only. Creating a reminder reserves sufficient paid value; successful delivery consumes the reservation and cancellation releases it. Existing reminders should not silently fail because unrelated free credit was exhausted.

General low-credit warnings should normally be included in the next @AI reply rather than consuming a LINE Push. Proactive Push is reserved for cases where low paid balance may affect already-created paid reminder service.

## Group retention

When the bot leaves a group, mark it inactive and stop processing.

- group that never paid: retain recoverable product data for 30 days
- group that has paid: retain recoverable product data for 1 year

Financial/audit records required for reconciliation may follow a separate retention policy.
