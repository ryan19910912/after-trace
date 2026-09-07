# AFTERTRACE AI Subscription / Usage Policy

## Goal

AI is primarily a **paid per-user subscription capability**, with one accepted acquisition exception: a newly eligible FREE account receives a **one-time Admin-configured AI trial point allowance**.

FREE manual Web/PWA use remains fully available without provider AI. GROUP data authorization and each user's AI entitlement remain separate concerns.

Read together with `WORKLOG_SUBSCRIPTION_POLICY.md`.

## Customer-facing model

Current launch commercial model:

- FREE — NT$0;
- AI Pro — NT$99/month;
- no one-time AI top-up product in V1.

Do not advertise mathematically unlimited provider compute.

Preferred paid wording:

> **日常使用不限次數；AI 功能仍受公平使用原則與每月方案資源上限限制。達到上限後，AI 功能將於下一個週期恢復。**

Customer UI may show normal / approaching limit / limit reached and reset date. Do not expose provider USD/TWD cost, target margin, raw token pricing, or internal point conversion details.

## Per-user entitlement

AI entitlement belongs to the requesting user.

- paid user in PRIVATE Source: may use entitled AI features;
- paid user in authorized GROUP Source: may use entitled AI features against authorized GROUP data;
- FREE user with remaining one-time trial points: may temporarily use currently enabled AI Pro features under the trial allowance;
- FREE user with exhausted/no trial points: manual features remain available, provider-backed AI is blocked;
- no GROUP AI responsible-user binding exists in the target product.

## FREE one-time AI trial

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
- provider-backed trial requests use the same reservation/settlement and cost audit as paid AI;
- when trial points reach zero, provider-backed AI stops and the UI may offer AI Pro upgrade.

Admin setting should be equivalent to `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.

## AI Pro configuration

AI Pro launch price is NT$99/month.

Admin/runtime must support:

- `price_twd`;
- `ai_enabled`;
- monthly AI resource/point cap;
- monthly provider-cost cap in TWD;
- optional per-request cap;
- optional modality limits;
- feature capability toggles.

Current planning may start around a NT$30/month provider-cost hard ceiling per AI Pro user, but this is configurable operator policy, not a customer cash balance or permanent code constant.

## Hard cap rule

Each provider-backed request must pass entitlement/resource checks before provider execution.

For AI Pro, runtime fails closed when either the internal resource/point cap or actual provider-cost cap is reached. Whichever is reached first blocks new provider work until the next entitled period or operator adjustment.

For FREE trial, positive eligible trial points are required before provider work begins. Trial usage never becomes a recurring monthly FREE pool.

## Reservation / settlement

The existing reservation/settlement accounting model may be reused where it remains clean.

Rules:

- reserve bounded capacity before provider execution;
- do not start provider work when the request cannot be safely admitted;
- settle against actual provider usage/cost after completion;
- release unused reservation on failure/cancel where applicable;
- customer-facing balance presentation must not become a raw provider-token/prepaid-cash UX.

## Actual provider cost

For every provider call retain enough immutable facts to calculate actual cost:

- provider/model;
- input/output/thinking/media usage;
- pricing snapshot;
- FX snapshot where relevant;
- actual provider cost USD/TWD;
- operation;
- requesting user;
- Source/group;
- entitlement source (`FREE_TRIAL` or subscription period);
- reservation/settlement references where used.

## AI operations

Provider-backed operations may include:

- natural-language Record create;
- AI voice interpretation;
- image/file/PDF interpretation;
- title/keyword/date/entity enrichment for new AI operations;
- natural-language search interpretation;
- related-record AI work when applicable;
- time-range summary;
- AI rewrite;
- AI Q&A when shipped;
- task extraction/proposal when provider-backed.

Manual CRUD/search/date filtering and non-provider browser speech-to-text consume no AI allowance.

## Historical data

Subscribing to AI does not trigger automatic historical FREE Record enrichment. Old Records remain unchanged and searchable from raw content; new provider-backed operations may carry richer metadata.

## Usage warnings

Warn before hard stop where practical. Recommended states: normal, approaching limit, limit reached. FREE trial can similarly show remaining trial state without describing it as a TWD balance.

## Admin analytics

Admin should expose at minimum:

- FREE initial trial point configuration;
- trial recipients/exhaustion/conversion;
- AI Pro price;
- current-period AI requests;
- internal point/resource use;
- actual provider cost USD/TWD;
- provider-cost cap and utilization;
- average provider cost per request/user;
- model/operation/modality breakdown;
- blocked users/requests;
- durable revenue facts where successful-payment records exist.

## No one-time top-up in V1

Do not ship one-time AI point purchases in V1. Revisit only after real launch data shows repeated limit exhaustion plus willingness to pay more.

GitHub Actions must not be used as validation unless explicitly requested by the user.
