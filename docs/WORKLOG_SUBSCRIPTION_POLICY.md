# AFTERTRACE Subscription / Free AI Trial Policy

Durable product/development contract for the current prelaunch AFTERTRACE Web/PWA product.

## Commercial model

Current launch model is intentionally simple:

- `FREE` — NT$0;
- `AI_PRO` — NT$99 / month.

Do not add one-time AI top-up products or extra paid tiers for V1. Revisit only after real launch usage/retention data exists.

## FREE plan

FREE remains a complete manual work-record product. It includes manual Record CRUD/search/date filters, native groups, tasks/reminders, notification center/PWA Push where supported, and provider-free browser/device speech-to-text where available.

FREE does not receive recurring monthly provider-backed AI allowance.

## One-time Free AI Trial

A newly eligible FREE account receives a **one-time AI trial allowance** so the user can experience AI Pro capabilities before subscribing.

The trial is controlled by **AI points**, not by a customer-facing TWD price/value.

Hard rules:

- Admin configures the initial trial point amount;
- the amount must not be hard-coded in source code;
- customer UI does not describe the trial as `NT$X AI 額度`;
- the trial is issued once per eligible AFTERTRACE account;
- it does not refresh monthly;
- it does not roll over into a paid subscription as a separate cash-equivalent balance;
- changing the Admin template affects only accounts that have not yet received the one-time trial;
- historical issued trial grants are never resized retroactively;
- a user may use the trial against the same provider-backed features that are currently enabled for AI Pro, subject to modality/request limits;
- when the trial reaches zero, provider-backed AI stops, while FREE manual/product features continue normally;
- trial usage must use the same provider usage/cost audit and reservation/settlement path as paid AI.

Existing Grant/accounting infrastructure may be reused where it cleanly supports this contract.

## Admin configuration

Admin must expose a setting equivalent to:

- `FREE 初始 AI 試用點數` / `free_initial_ai_trial_points`.

Admin should show enough context to operate this safely:

- configured initial trial points;
- count of users who received the trial;
- average trial points/provider cost consumed;
- exhaustion rate;
- FREE -> AI Pro conversion where durable subscription facts exist.

Do not make the Admin enter a TWD trial price. The commercial control is the initial **point quantity**.

## AI Pro

AI Pro launch price is **NT$99/month**.

AI Pro enables the accepted paid AI capabilities, including AI text/voice/image/file interpretation, AI metadata/date/title/keywords, natural-language search, related Records, summaries, rewrite/cleanup and provider-backed task extraction when those features ship.

Paid runtime retains internal resource/point limits plus a provider-cost hard cap in TWD to protect unit economics. The provider-cost hard cap is an internal operator safety boundary and is not presented to customers as a prepaid cash balance.

Current planning assumption may start around a NT$30/month provider-cost ceiling for AI Pro, but this value must remain Admin/runtime configuration rather than a permanent product constant.

## Payment provider — NewebPay / 藍新

V1 paid subscription provider is **NewebPay / 藍新信用卡定期定額**.

Product/runtime rules:

- customer price remains fixed at NT$99/month;
- checkout is initiated from AFTERTRACE but card entry/authorization occurs on the NewebPay-hosted periodic-payment page;
- AFTERTRACE must not receive/store raw card numbers or CVV;
- merchant id/hash key/hash IV and callback URLs are API Worker secrets/config, never `VITE_*` frontend variables;
- successful first periodic authorization maps to normalized `ACTIVATE` lifecycle processing;
- successful later periodic charges map to `RENEW`;
- cancellation/termination maps to `CANCEL` and stops future renewal while preserving already-paid access through the current period end;
- provider callback retries must remain idempotent through provider event keys plus the shared subscription lifecycle boundary;
- a failed recurring charge must not erase an already-paid current period;
- the core subscription lifecycle remains provider-neutral even though the current transport adapter is NewebPay.

NewebPay merchant credentials/environment values may remain unset in source/default examples until the operator supplies the real Dev/Prod values. Missing NewebPay configuration disables paid checkout only; it must not break FREE/manual product behavior.

## Customer-facing wording

Prefer simple messaging:

- FREE: `免費使用`;
- trial: `免費體驗 AI Pro` / `尚有 AI 試用額度`;
- AI Pro: `NT$99 / 月`;
- paid usage: `日常使用不限次數；AI 功能仍受公平使用原則與每月方案資源上限限制。`

Do not expose provider cost, raw provider token prices, or internal margin calculations to customers.

## Upgrade flow

Suggested flow:

1. account starts on FREE;
2. one-time configured AI trial points are issued idempotently;
3. user can experience AI features until trial allowance is exhausted;
4. product warns as trial allowance approaches zero;
5. once exhausted, AI surfaces offer upgrade to AI Pro NT$99/month;
6. customer completes NewebPay periodic-payment authorization;
7. successful NewebPay activation starts paid period accounting/caps;
8. FREE manual features continue without interruption regardless of AI entitlement/payment state.

## No one-time top-up in V1

Do not ship one-time AI point purchases in V1. If real users repeatedly hit AI Pro limits and show willingness to pay more, evaluate either a higher subscription tier or top-up product later using actual usage data.

GitHub Actions must not be used as validation unless explicitly requested by the user.
