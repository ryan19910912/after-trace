# AFTERTRACE AI Subscription / Usage Policy

## Goal

AFTERTRACE keeps the FREE product permanently useful without provider AI, while giving each newly eligible FREE account a **one-time Admin-configured free AI experience allowance** so users can try the real AI product before subscribing.

The one-time FREE allowance is shared across supported AI capabilities. AI Pro remains the recurring paid plan with monthly AI resources.

Read together with `WORKLOG_SUBSCRIPTION_POLICY.md`.

## Customer-facing model

Current launch commercial model:

- FREE — NT$0;
- AI Pro — NT$99/month;
- no one-time AI top-up product at launch.

FREE receives one one-time AI experience allowance. It does not refresh monthly.

Preferred paid wording:

> **AI 功能受公平使用原則與每月方案資源上限限制。達到上限後，AI 功能將於下一個週期恢復。**

Customer UI may show normal / approaching limit / limit reached and reset date. Do not expose provider USD/TWD cost, target margin, raw token pricing, or internal point conversion details.

## Per-user entitlement

AI entitlement belongs to the requesting user.

- AI Pro user in an authorized PRIVATE/GROUP scope may use enabled AI features;
- FREE user with remaining one-time trial points may use supported AI features from the same shared trial balance;
- FREE user with exhausted/no trial points still has manual Record CRUD, deterministic search, groups, tasks/reminders and other normal FREE features;
- no GROUP AI responsible-user binding exists in the target product.

`FREE_TRIAL` and `AI_PRO` are both valid AI entitlement sources. Provider-backed services must still reserve/settle AI points and obey request/resource limits before provider work begins.

## FREE one-time AI experience

FREE does **not** receive recurring monthly provider-backed AI allowance.

A newly eligible FREE account receives one idempotent trial grant configured by Admin.

Rules:

- Admin configures the initial point quantity;
- do not configure the trial as a TWD selling price;
- do not hard-code the point amount in source;
- trial is issued once per AFTERTRACE account;
- trial does not refresh monthly;
- later Admin template changes affect only users who have not yet received it;
- already-issued trial balances are never resized retroactively;
- browser/device speech-to-text remains provider-free and does not consume trial points;
- provider-backed AI Search, text organization, image/audio/file AI, summaries, rewrite and AI task proposals share the same trial balance and use the normal reservation/settlement path;
- Chrome screenshot AI also consumes the same trial balance;
- related-record lookup is entitlement-gated; while its current ranking is deterministic/PostgreSQL-based and does not call the provider, it does not invent fake provider usage or point charges;
- when trial points reach zero, provider-backed AI stops and the UI may offer AI Pro; normal FREE functions continue.

Customer/Admin wording should prefer `免費 AI 體驗` / `免費 AI 體驗額度`, not `AI Pro 試用` or `免費 AI 搜尋體驗`.

## AI Pro configuration

AI Pro launch price is NT$99/month.

Admin/runtime supports:

- `price_twd`;
- `ai_enabled`;
- monthly AI resource/point cap;
- monthly provider-cost cap in TWD;
- optional per-request cap;
- media limits;
- feature capability toggles.

Recommended AI Pro media defaults:

- 1 image/request while single-image input is current; 4/request after multi-image ships;
- 5 MB/image;
- 300 seconds/audio request;
- 10 MB/audio request;
- 10 MB/file request.

FREE trial media uses conservative defaults of 1 image/request, 5 MB/image, 300 seconds/audio, 10 MB/audio and 10 MB/file. Absolute transport ceilings remain higher (20 MB image and 30 MB audio/file) and are not customer entitlements.

## Hard cap rule

Each provider-backed request must pass entitlement/resource checks before provider execution.

For AI Pro, runtime fails closed when either the internal resource/point cap or actual provider-cost cap is reached. Whichever is reached first blocks new provider work until the next entitled period or operator adjustment.

For FREE trial, positive trial points are required before provider-backed AI work begins. A request that exceeds remaining points or the request cap is blocked before provider execution. Trial usage never becomes a recurring monthly FREE pool.

## Reservation / settlement

Rules:

- reserve bounded capacity before provider execution;
- do not start provider work when the request cannot be safely admitted;
- settle against actual provider usage/cost after completion;
- release unused reservation on failure/cancel where applicable;
- all provider-backed FREE-trial AI and AI Pro operations use the same point ledger architecture;
- customer-facing balance presentation must not become a raw provider-token/prepaid-cash UX.

## Actual provider cost

For every provider call retain enough immutable facts to calculate actual cost:

- provider/model;
- input/output/media usage;
- pricing snapshot;
- FX snapshot where relevant;
- actual provider cost USD/TWD;
- operation;
- requesting user;
- authorized source/group;
- entitlement source (`FREE_TRIAL` or `AI_PRO`);
- reservation/settlement references where used.

## AI operations

Supported AI experience / AI Pro capabilities include:

- natural-language Record create/organization;
- natural-language search interpretation;
- image/audio/file/PDF interpretation;
- Chrome visible-tab screenshot AI;
- related-record features;
- time-range summary;
- AI rewrite;
- task extraction/proposal;
- future AI Q&A when shipped.

Manual CRUD, deterministic search/date filtering and non-provider browser speech-to-text consume no AI allowance.

## Historical data

Subscribing to AI does not trigger automatic historical FREE Record enrichment. Old Records remain unchanged and searchable from raw content; new provider-backed operations may carry richer metadata.

## Usage warnings

Warn before hard stop where practical. Recommended AI Pro states: normal, approaching limit, limit reached. FREE AI experience may show remaining points without describing them as a TWD cash balance.

## Admin analytics

Admin should expose at minimum:

- FREE one-time AI experience point configuration;
- trial recipients/exhaustion/conversion;
- subscription plan price/configuration;
- current-period AI requests;
- internal point/resource use;
- actual provider cost USD/TWD;
- provider-cost cap and utilization;
- average provider cost per request/user;
- model/operation/modality breakdown;
- blocked users/requests;
- durable revenue facts where successful-payment records exist.

## No one-time top-up at launch

Do not ship one-time AI point purchases at launch. Revisit only after real launch data shows repeated limit exhaustion plus willingness to pay more.

GitHub Actions must not be used as validation unless explicitly requested by the user.
