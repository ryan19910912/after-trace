# AFTERTRACE AI Subscription / Usage Policy

## Goal

AI is primarily a **paid per-user subscription capability**, with one acquisition exception: a newly eligible FREE account receives a **one-time Admin-configured AI Search trial point allowance**.

FREE manual Web/PWA use remains fully available without provider AI. GROUP data authorization and each user's AI entitlement remain separate concerns.

Read together with `WORKLOG_SUBSCRIPTION_POLICY.md`.

## Customer-facing model

Current launch commercial model:

- FREE — NT$0;
- AI Pro — NT$99/month;
- no one-time AI top-up product at launch.

Do not advertise mathematically unlimited provider compute.

Preferred paid wording:

> **AI 功能受公平使用原則與每月方案資源上限限制。達到上限後，AI 功能將於下一個週期恢復。**

Customer UI may show normal / approaching limit / limit reached and reset date. Do not expose provider USD/TWD cost, target margin, raw token pricing, or internal point conversion details.

## Per-user entitlement

AI entitlement belongs to the requesting user.

- AI Pro user in an authorized PRIVATE/GROUP scope may use enabled AI Pro features;
- FREE user with remaining one-time trial points may use **natural-language AI Search only**;
- FREE user with exhausted/no trial points still has manual Record CRUD, deterministic search, groups, tasks/reminders and other normal FREE features;
- no GROUP AI responsible-user binding exists in the target product.

A generic `FREE_TRIAL` decision is not authority for arbitrary provider-backed operations. Every service must enforce its product capability boundary. At launch, only AI Search accepts `FREE_TRIAL`; all other provider AI requires `AI_PRO`.

## FREE one-time AI Search trial

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
- natural-language AI Search uses the same reservation/settlement and provider-cost audit path as paid AI;
- AI text capture/organization, image/audio/file AI, related Records, summaries, rewrite and AI task proposals must reject FREE_TRIAL;
- when trial points reach zero, AI Search stops and the UI may offer AI Pro upgrade; normal FREE functions continue.

Admin customer-facing wording should prefer `免費 AI 搜尋體驗點數` rather than a generic `AI Pro 試用額度`.

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

Recommended media defaults:

- 1 image/request while single-image input is current; 4/request after multi-image ships;
- 5 MB/image;
- 300 seconds/audio request;
- 10 MB/audio request;
- 10 MB/file request.

The application may keep higher absolute transport ceilings (currently 20 MB image and 30 MB audio/file) so the plan-level settings remain the effective configurable limits.

## Hard cap rule

Each provider-backed request must pass entitlement/resource checks before provider execution.

For AI Pro, runtime fails closed when either the internal resource/point cap or actual provider-cost cap is reached. Whichever is reached first blocks new provider work until the next entitled period or operator adjustment.

For FREE AI Search trial, positive trial points are required before natural-language search provider work begins. Trial usage never becomes a recurring monthly FREE pool.

## Reservation / settlement

Rules:

- reserve bounded capacity before provider execution;
- do not start provider work when the request cannot be safely admitted;
- settle against actual provider usage/cost after completion;
- release unused reservation on failure/cancel where applicable;
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
- entitlement source (`FREE_TRIAL` only for AI Search, otherwise subscription period);
- reservation/settlement references where used.

## AI operations

AI Pro provider-backed operations include:

- natural-language Record create/organization;
- AI voice interpretation;
- image/file/PDF interpretation;
- title/keyword/date enrichment for AI-created operations;
- natural-language search interpretation;
- related-record features;
- time-range summary;
- AI rewrite;
- AI Q&A when shipped;
- task extraction/proposal.

FREE trial supports only natural-language search interpretation.

Manual CRUD, deterministic search/date filtering and non-provider browser speech-to-text consume no AI allowance.

## Historical data

Subscribing to AI does not trigger automatic historical FREE Record enrichment. Old Records remain unchanged and searchable from raw content; new provider-backed operations may carry richer metadata.

## Usage warnings

Warn before hard stop where practical. Recommended AI Pro states: normal, approaching limit, limit reached. FREE AI Search trial may show remaining trial points without describing them as a TWD balance.

## Admin analytics

Admin should expose at minimum:

- FREE AI Search trial point configuration;
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
