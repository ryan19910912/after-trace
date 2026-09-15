# AFTERTRACE Subscription / Free AI Trial Policy

Durable product/development contract for the current prelaunch AFTERTRACE Web/PWA product.

## Commercial model

AFTERTRACE uses a backend-driven plan catalog:

- `FREE` — NT$0;
- one or more enabled `SUBSCRIPTION` plans created and maintained in Admin.

Admin subscription definitions are customer-visible automatically when they are enabled, AI-enabled and commercially valid. Customer Web/PWA must not hard-code a specific paid plan code, display name or price.

Do not add one-time AI top-up products for launch.

## FREE plan

FREE remains a complete manual work-record product. It includes manual Record CRUD/search/date filters, native groups, tasks/reminders, notification center/PWA Push where supported, and provider-free browser/device speech-to-text where available.

Browser/device speech-to-text is free because it only turns speech into text locally/browser-side and does not use AFTERTRACE provider AI.

FREE does not receive recurring monthly provider-backed AI allowance.

## One-time Free AI Experience

A newly eligible FREE account receives a **one-time shared AI experience allowance** so the user can try the actual AI product before subscribing.

Hard rules:

- Admin configures the initial trial point amount;
- the amount must not be hard-coded in source code;
- customer UI does not describe the trial as a cash balance;
- the trial is issued once per eligible AFTERTRACE account;
- it does not refresh monthly;
- changing the Admin template affects only accounts that have not yet received the trial;
- trial points are shared by supported provider-backed AI functions, including AI text organization, natural-language search, image/audio/file/PDF AI, time-range summary, rewrite, task proposals and Chrome screenshot AI;
- normal keyword/date search and browser speech-to-text consume no AI points;
- when trial points reach zero, provider-backed AI stops while FREE manual/product features continue normally;
- trial provider-backed AI uses the same usage/cost audit and reservation/settlement path as paid AI.

FREE media trial uses conservative safety limits: one image/request, 5 MB/image, 300 seconds/audio, 10 MB/audio and 10 MB/file.

## Admin configuration

Admin provides two commercial surfaces:

- FREE plan: one-time AI experience points plus internal trial-cost calculator;
- Subscription plans: create, list, inspect, edit, enable/disable and configure price, AI point/cost caps, feature switches and media limits.

An enabled subscription plan becomes part of the customer plan catalog without a code release. The plan code is a durable internal identifier and does not change when the operator later edits its display name or price.

## Paid subscription plans

Each paid plan stores its own:

- plan code;
- customer display name;
- monthly TWD price;
- enabled / AI-enabled state;
- monthly AI point cap;
- monthly provider-cost cap;
- optional per-request point cap;
- AI feature switches;
- image/audio/file limits.

The customer plan page renders these values from the backend. It must not assume `AI_PRO`, `NT$99`, or any other fixed paid plan code/price.

A user may have only one active paid subscription at a time. While an active paid period exists, another paid checkout is blocked. After cancellation and paid-period expiry, the user may start a new checkout normally.

## Payment provider — NewebPay / 藍新

Current paid subscription provider is **NewebPay / 藍新信用卡定期定額**.

Product/runtime rules:

- checkout receives the selected backend plan code;
- the API resolves the selected plan from PostgreSQL and uses its current display name and price when constructing the NewebPay periodic checkout;
- the checkout intent durably stores the selected plan code;
- callbacks recover the selected plan through the checkout intent and validate the provider authorization amount against the plan price associated with that checkout;
- successful first periodic authorization maps to normalized `ACTIVATE` lifecycle processing for the selected plan code;
- successful later periodic charges map to `RENEW` for that plan;
- cancellation/termination maps to `CANCEL` and stops future renewal while preserving already-paid access through the current period end;
- subscription lifecycle, history and monthly AI Grant creation preserve the actual paid plan code;
- provider callback retries remain idempotent through provider event keys plus the shared subscription lifecycle boundary;
- AFTERTRACE never receives/stores raw card numbers or CVV;
- merchant id/hash key/hash IV and callback URLs are API Worker secrets/config, never frontend variables.

NewebPay Period currently uses an integer TWD monthly amount. Therefore a paid plan may be displayed in Admin with finer precision, but customer checkout is enabled only for a positive integer-TWD subscription price. Operators should use integer monthly prices for purchasable launch plans.

Missing NewebPay configuration disables paid checkout only; it must not break FREE/manual product behavior.

## Subscription lifecycle and AI allowance

The lifecycle is plan-driven rather than tied to a special code:

1. customer selects an enabled paid plan;
2. checkout stores the selected `plan_code`;
3. successful provider authorization activates that exact plan;
4. the active subscription row stores that plan code;
5. the monthly `SUBSCRIPTION_PERIOD` AI Grant uses that plan's configured point cap and period;
6. AI entitlement/provider-cost admission reads limits from the user's active paid plan;
7. renewal starts the next paid period for the same plan;
8. cancellation stops renewal but preserves the current paid period until its end.

Internal compatibility names such as `AI_PRO` may still appear in generic entitlement reason/source enums. They represent “active paid AI subscription” semantics and must not be used to filter the commercial plan catalog by code or price.

## Customer-facing wording

Prefer backend plan display names and prices. Generic customer wording may use:

- FREE: `免費使用`;
- trial: `免費 AI 體驗` / `尚有免費 AI 體驗額度`;
- paid CTA: `訂閱 <方案名稱>`;
- paid usage: `AI 功能受公平使用原則與每月方案資源上限限制。`

Do not expose provider cost, raw provider token prices, or internal margin calculations to customers.

## Upgrade flow

1. account starts on FREE;
2. one-time configured FREE AI experience points are issued idempotently;
3. user may spend them across supported AI features until exhausted;
4. normal Record CRUD, deterministic search, groups, tasks and notifications stay free throughout;
5. customer plan page lists currently enabled paid plans from the backend;
6. user selects one paid plan and completes NewebPay periodic authorization;
7. successful activation starts that plan's paid period, monthly AI allowance and cost caps;
8. cancellation stops the next renewal while preserving the current paid period;
9. after expiry, the user may choose any currently available paid plan through a new checkout.

## No one-time top-up at launch

Do not ship one-time AI point purchases at launch. If real users repeatedly hit paid-plan limits and show willingness to pay more, evaluate a higher subscription tier or top-up product later using actual usage data.

GitHub Actions must not be used as validation unless explicitly requested by the user.
