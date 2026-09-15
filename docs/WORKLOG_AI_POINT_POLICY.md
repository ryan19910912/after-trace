# AFTERTRACE AI Subscription / Usage Policy

## Goal

AFTERTRACE keeps the FREE product permanently useful without provider AI, while giving each newly eligible FREE account a **one-time Admin-configured free AI experience allowance** so users can try the real AI product before subscribing.

The one-time FREE allowance is shared across supported AI capabilities. Paid subscriptions provide recurring monthly AI resources according to each backend plan definition.

Read together with `WORKLOG_SUBSCRIPTION_POLICY.md`.

## Customer-facing model

- FREE — NT$0;
- one or more enabled paid subscription plans supplied by the backend;
- no one-time AI top-up product at launch.

FREE receives one one-time AI experience allowance. It does not refresh monthly.

Preferred paid wording:

> **AI 功能受公平使用原則與每月方案資源上限限制。達到上限後，AI 功能將於下一個週期恢復。**

Customer UI may show normal / approaching limit / limit reached and reset date. Do not expose provider USD/TWD cost, target margin, raw token pricing, or internal point conversion details.

## Per-user entitlement

AI entitlement belongs to the requesting user.

- a user with an active paid AI subscription may use enabled AI features within that plan's configured limits;
- FREE user with remaining one-time trial points may use supported AI features from the shared trial balance;
- FREE user with exhausted/no trial points still has manual Record CRUD, deterministic search, groups, tasks/reminders and normal FREE features;
- no GROUP AI responsible-user binding exists.

Internal entitlement source `AI_PRO` is retained as compatibility terminology meaning “active paid AI subscription”; it must not imply or require a commercial plan whose actual code is exactly `AI_PRO`.

## FREE one-time AI experience

FREE does **not** receive recurring monthly provider-backed AI allowance.

Rules:

- Admin configures the initial point quantity;
- do not configure the trial as a TWD selling price;
- do not hard-code the point amount;
- trial is issued once per AFTERTRACE account;
- trial does not refresh monthly;
- later Admin template changes affect only users who have not yet received it;
- already-issued trial balances are never resized retroactively;
- browser/device speech-to-text remains provider-free;
- provider-backed AI Search, text organization, image/audio/file AI, summaries, rewrite, task proposals and Chrome screenshot AI share the same trial balance;
- related-record lookup remains entitlement-gated and must not fabricate fake provider usage;
- when trial points reach zero, provider-backed AI stops while normal FREE functions continue.

## Paid plan configuration

Each enabled paid `SUBSCRIPTION` plan may configure:

- stable `plan_code`;
- display name;
- monthly TWD price;
- AI enabled state;
- monthly AI point cap;
- monthly provider-cost cap in TWD;
- optional per-request cap;
- media limits;
- feature capability toggles.

The active subscription plan, not a hard-coded `AI_PRO` row, is authoritative for paid point/cost admission.

Recommended media defaults are 1 image/request, 5 MB/image, 300 seconds/audio, 10 MB/audio and 10 MB/file. FREE trial uses the same conservative defaults unless explicitly changed in product policy. Transport ceilings remain higher and are not customer entitlements.

## Hard cap rule

Each provider-backed request must pass entitlement/resource checks before provider execution.

For paid subscriptions, runtime fails closed when either the plan point cap or actual provider-cost cap is reached. Whichever is reached first blocks new provider work until the next entitled period or operator adjustment.

For FREE trial, positive trial points are required before provider work begins. A request exceeding remaining points/request cap is blocked before execution.

## Reservation / settlement

- reserve bounded capacity before provider execution;
- do not start provider work when the request cannot be safely admitted;
- settle against actual provider usage/cost after completion;
- release unused reservation on failure/cancel where applicable;
- FREE-trial and paid operations use the same point ledger architecture;
- paid provider-cost guard resolves the user's actual active plan and matching `SUBSCRIPTION_PERIOD` Grant;
- customer-facing balance must not become a raw provider-token/prepaid-cash UX.

## Paid period Grant

On successful subscription activation/renewal:

- lifecycle preserves the selected plan code;
- a `SUBSCRIPTION_PERIOD` Grant is created for that billing period;
- its point quantity comes from that selected plan's monthly AI point cap;
- its effective/expiry dates match the paid period;
- provider-cost admission reads the selected plan's monthly provider-cost cap;
- cancellation may shorten/terminate future Grant eligibility only according to the paid-period lifecycle rules.

## Actual provider cost

For every provider call retain enough immutable facts to calculate actual cost: provider/model, input/output/media usage, pricing/FX snapshots, actual provider cost, operation, user/source, entitlement source and reservation/settlement references.

## AI operations

Supported FREE experience / paid AI capabilities include natural-language Record organization, AI Search, image/audio/file/PDF interpretation, Chrome screenshot AI, related-record features, time-range summary, rewrite and task proposal.

Manual CRUD, deterministic search/date filtering and non-provider browser speech-to-text consume no AI allowance.

## Historical data

Subscribing does not trigger automatic historical Record enrichment. Old Records remain unchanged and searchable from raw content.

## Usage warnings

Warn before hard stop where practical. Paid states: normal, approaching limit, limit reached. FREE AI experience may show remaining points without describing them as a cash balance.

## Admin analytics

Admin should expose FREE trial configuration/usage, paid plan price/configuration, current-period AI use, actual provider cost, cap utilization, operation/model breakdown, blocked requests and durable revenue facts where successful payment records exist.

## No one-time top-up at launch

Do not ship one-time AI point purchases at launch. Revisit only after real data shows repeated limit exhaustion plus willingness to pay more.

GitHub Actions must not be used as validation unless explicitly requested by the user.
