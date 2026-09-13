# AFTERTRACE Subscription / Free AI Trial Policy

Durable product/development contract for the current prelaunch AFTERTRACE Web/PWA product.

## Commercial model

Current launch model is intentionally simple:

- `FREE` — NT$0;
- `AI_PRO` — NT$99 / month.

Do not add one-time AI top-up products for launch. Additional subscription definitions may exist in Admin for future preparation, but they are not customer-purchasable until payment/lifecycle support explicitly supports them.

## FREE plan

FREE remains a complete manual work-record product. It includes manual Record CRUD/search/date filters, native groups, tasks/reminders, notification center/PWA Push where supported, and provider-free browser/device speech-to-text where available.

Manual Record input is user-entered text. Browser/device speech-to-text is allowed because it only turns speech into text locally/browser-side and does not use AFTERTRACE provider AI.

FREE does not receive recurring monthly provider-backed AI allowance.

## One-time Free AI Search Trial

A newly eligible FREE account receives a **one-time AI Search trial allowance** so the user can experience natural-language search before subscribing.

The trial is controlled by **AI points**, not by a customer-facing TWD price/value.

Hard rules:

- Admin configures the initial trial point amount;
- the amount must not be hard-coded in source code;
- customer UI does not describe the trial as `NT$X AI 額度`;
- the trial is issued once per eligible AFTERTRACE account;
- it does not refresh monthly;
- it does not roll over into a paid subscription as a cash-equivalent balance;
- changing the Admin template affects only accounts that have not yet received the one-time trial;
- historical issued trial grants are never resized retroactively;
- **trial points may be consumed only by natural-language AI Search**;
- normal keyword/date search consumes no AI points;
- AI text capture/organization, media AI, related Records, summaries, rewrite and AI task proposals are not available from the free trial;
- when the trial reaches zero, AI Search stops, while FREE manual/product features and deterministic search continue normally;
- trial AI Search usage must use the same provider usage/cost audit and reservation/settlement path as paid AI.

## Admin configuration

Admin exposes the one-time AI Search trial point quantity and enough aggregate context to operate it safely, including recipients, consumption and exhaustion where available.

Do not make the Admin enter a TWD trial price. The commercial control is the initial **point quantity**.

## AI Pro

AI Pro launch price is **NT$99/month**.

AI Pro enables the complete accepted provider-backed feature set, including:

- AI text capture/organization;
- AI natural-language search;
- AI voice interpretation;
- image AI;
- supported file/PDF AI;
- related Records;
- time-range summaries;
- rewrite/cleanup suggestions;
- provider-backed task extraction/proposals.

Paid runtime retains internal resource/point limits plus a provider-cost hard cap in TWD to protect unit economics. The provider-cost hard cap is an internal operator safety boundary and is not presented to customers as a prepaid cash balance.

Recommended initial media plan limits are:

- 1 image/request while the API is single-image (4/request when multi-image ships);
- 5 MB/image;
- 300 seconds audio/request;
- 10 MB audio/request;
- 10 MB file/request.

Transport safety ceilings may be higher than plan limits so Admin-configured plan limits remain authoritative below the hard runtime ceiling.

## Payment provider — NewebPay / 藍新

Current paid subscription provider is **NewebPay / 藍新信用卡定期定額**.

Product/runtime rules:

- current purchasable plan is AI Pro NT$99/month;
- checkout is initiated from AFTERTRACE but card entry/authorization occurs on the NewebPay-hosted periodic-payment page;
- AFTERTRACE must not receive/store raw card numbers or CVV;
- merchant id/hash key/hash IV and callback URLs are API Worker secrets/config, never `VITE_*` frontend variables;
- successful first periodic authorization maps to normalized `ACTIVATE` lifecycle processing;
- successful later periodic charges map to `RENEW`;
- cancellation/termination maps to `CANCEL` and stops future renewal while preserving already-paid access through the current period end;
- provider callback retries must remain idempotent through provider event keys plus the shared subscription lifecycle boundary;
- a failed recurring charge must not erase an already-paid current period;
- the core subscription lifecycle remains provider-neutral even though the current transport adapter is NewebPay.

Missing NewebPay configuration disables paid checkout only; it must not break FREE/manual product behavior.

## Customer-facing wording

Prefer simple messaging:

- FREE: `免費使用`;
- trial: `免費 AI 搜尋體驗` / `尚有 AI 搜尋體驗額度`;
- AI Pro: `NT$99 / 月`;
- paid usage: `AI 功能受公平使用原則與每月方案資源上限限制。`

Do not expose provider cost, raw provider token prices, or internal margin calculations to customers.

## Upgrade flow

Suggested flow:

1. account starts on FREE;
2. one-time configured AI Search trial points are issued idempotently;
3. user can use natural-language AI Search until the trial allowance is exhausted;
4. normal Record CRUD and deterministic search stay free throughout;
5. once AI Search trial is exhausted, AI Search offers upgrade to AI Pro;
6. AI Pro unlocks all accepted AI features;
7. customer completes NewebPay periodic-payment authorization;
8. successful activation starts paid period accounting/caps;
9. FREE manual features continue without interruption regardless of AI entitlement/payment state.

## No one-time top-up at launch

Do not ship one-time AI point purchases at launch. If real users repeatedly hit AI Pro limits and show willingness to pay more, evaluate a higher subscription tier or top-up product later using actual usage data.

GitHub Actions must not be used as validation unless explicitly requested by the user.
