# AFTERTRACE AI Point / Pricing Policy

Durable product/development contract for branch `revive/line-worklog`.

## Goal

Customer-facing AI allowance is shown as **AI 點數**, not raw provider tokens or USD cost. Provider usage/cost remains separately auditable in Admin.

## Admin pricing workflow

Plan/top-up configuration is intentionally human-controlled.

Admin UI provides a pricing calculator using:

- customer price in TWD;
- target gross-margin percentage entered by Admin;
- implied maximum AI cost budget = price × (1 - target gross-margin percentage);
- selected model/pricing snapshot;
- current AI-point conversion rule.

Current commercial starting targets:

- **one-time AI top-up / one-time allowance products: target gross margin 50%**;
- **monthly subscription included AI allowance: target gross margin 40%**, intentionally giving recurring subscribers more AI value to encourage ongoing product use and retention.

These are editable planning defaults, not immutable business constants.

Examples:

- NT$100 one-time product at 50% target gross margin -> suggested AI cost budget NT$50;
- NT$99 subscription at 40% target gross margin -> suggested AI cost budget NT$59.4.

The Admin calculator shows a **recommended included AI points** value, but the final included points are still explicitly entered/confirmed by Admin and persisted. Backend must not silently recalculate or change an existing plan's included AI points when price, FX, model pricing, or margin assumptions change.

If the product later wants fully automatic pricing, it requires a separate explicit decision and durable configuration for the target margin.

## FREE acquisition grant direction

FREE has no purchase price, so its initial grant is not derived from a gross-margin formula. Treat it as a customer-acquisition / product-trial subsidy.

Current launch direction is to give each eligible new user approximately **NT$30 of conservative output-price-equivalent AI value once**.

Rules:

- granted once per eligible user/account;
- no calendar expiry unless product policy changes later;
- never refreshes automatically;
- after it reaches zero, manual PWA functionality remains available for free;
- exact displayed point count is calculated from the selected launch model/pricing snapshot using the accepted point basis and then intentionally rounded to a customer-friendly launch amount;
- Admin must be able to compare the FREE grant's average real provider cost, conversion to paid plans/top-ups and exhaustion rate so the subsidy can be tuned after launch.

This NT$30 value is a current launch direction, not a promise that future new-user promotions must always use the same subsidy.

## Conservative allowance sizing and actual charging

Allowance sizing intentionally uses the selected provider/model's output-token price as the conservative reference price when converting an AI budget into a suggested customer point balance.

This does **not** mean actual provider accounting ignores input or other usage. Every AI call still records and charges from actual provider usage/cost, including input, output, thinking/reasoning and modality-specific usage where applicable.

The purpose of using the higher output reference price for suggested allowance sizing is to give the customer a conservatively sized balance: when real requests contain cheaper input usage, realized margin may be higher than the planning target.

## Provider cost vs customer points

Provider-dollar cost and customer AI points are separate concepts.

For every provider call retain sufficient usage/pricing facts to calculate actual cost, including input tokens, output tokens, thinking/reasoning tokens where applicable, model, pricing snapshot, and modality-specific usage where applicable.

Admin profitability reports must use actual provider cost rather than assuming points equal provider cost.

## AI point conversion — frozen

**1 AI point = 1 output-price-equivalent token.**

The point is a customer-facing accounting unit, not a claim that the provider request contained one actual output token.

For an AI call:

1. calculate the call's full actual provider cost using the immutable pricing snapshot that applied to that request, including all billable input/output/thinking/modality usage;
2. take the same model/pricing snapshot's output price per token as the point reference price;
3. convert total provider cost into output-price-equivalent tokens;
4. charge that number as AI points, using a deterministic whole-point rounding rule.

Conceptual formula:

`AI points used = total actual provider cost / output reference price per token`

Therefore all billable input/output/thinking/media costs are represented in point consumption even though the reference unit is the output price.

Large balances such as hundreds of thousands or millions of AI points are acceptable and intentional. Customer UI should use readable thousands separators and percentages rather than hiding the scale.

Do not silently change the definition of one AI point later. If a future product revision needs a different point unit, it requires an explicit migration/versioning decision so historical grants and usage remain auditable.

## Model pricing snapshot

As of 2026-09-03, official Gemini Developer API standard paid pricing for `gemini-3.5-flash-lite` is USD $0.30 / 1M input tokens and USD $2.50 / 1M output tokens including thinking tokens. Pricing changes over time, therefore historical usage must retain the pricing snapshot that applied when the request ran.

## Existing plan point counts must be recalibrated

Legacy values such as FREE `500`, PRO `500`, and TEAM `2500` were defined before the AI-point unit was frozen and must **not** be treated as final customer allowances under the new 1:1 output-price-equivalent model.

Before implementation is considered complete, Admin/product configuration must set new explicit point balances for FREE / PRO / TEAM and each top-up product using the pricing calculator plus manual Admin confirmation.

Historical/prelaunch data is disposable, so these launch defaults may be replaced directly while there is no real production customer data.

## Admin usage and profitability analytics

Admin must make pricing decisions possible from real usage rather than intuition. At minimum provide selectable periods such as today / 7 days / 30 days / current billing month and show:

- total AI requests;
- total AI points consumed;
- total provider cost in USD and converted TWD;
- average AI points consumed per AI request;
- average provider cost per AI request;
- average AI points consumed per active user;
- average provider cost per active user;
- average and median monthly AI usage per subscriber where enough data exists;
- total customer revenue for the selected plan/product cohort where available;
- realized AI cost ratio = actual AI provider cost / relevant revenue;
- realized gross margin based on captured direct costs;
- platform-subsidized AI points and provider cost;
- percentage of users exhausting their allowance;
- average allowance utilization percentage and distribution where practical;
- FREE-to-paid conversion and average real provider subsidy per FREE user where available.

Breakdowns should be available by at least:

- plan: FREE / PRO / TEAM;
- allowance source: FREE initial / subscription period / top-up;
- model;
- AI operation/input type such as text Record, image, audio, file and LINE edit where shipped;
- PRIVATE vs GROUP scope.

Useful decision views include:

- `PRO: average subscriber used 31% of monthly points, median 18%, AI provider cost NT$X/user`;
- `TEAM: average subscriber used 62%, AI provider cost NT$Y/user`;
- `top-up: average realized gross margin 54%`;
- `subscription: average realized gross margin 46%`.

These reports are for Admin only. Customer PWA shows points and usage percentages, not internal revenue/margin/provider-cost calculations.

## Gross-margin interpretation

The Admin `target gross margin %` is a planning aid, not guaranteed net profit.

Current intended commercial distinction is deliberate:

- one-time purchases target about 50% gross margin;
- subscriptions target about 40% gross margin so recurring customers receive more usable AI allowance and have more reason to keep using the product.

Actual realized margin must be measured from production usage. Admin may later adjust target margin or manually entered included points without retroactively changing historical grants.

Gross-margin planning must distinguish direct cost of delivering the service (AI inference, infrastructure, payment processing and other applicable COGS) from later operating expenses such as development, marketing and general administration.

## User-facing usage display

PWA should display customer-friendly values such as:

- remaining AI points;
- used AI points;
- total included/available AI points;
- usage percentage / remaining percentage;
- progress indicator.

Do not expose raw Gemini USD pricing or token accounting in normal customer UI.

Group PWA displays only group-scoped available/used points under the current AI allowance responsible user's authorized grants, without exposing unrelated private/other-group balances.

## Zero-balance / overage rule

- eligible AI points must be greater than zero before starting an AI operation;
- if points are zero before request start, do not call provider AI;
- if a request starts with positive points and actual usage exceeds remaining points, customer balance floors at zero and AFTERTRACE absorbs the shortfall for that already-started request;
- Admin records customer-charged points, actual provider cost, and platform subsidy separately.

GitHub Actions must not be used as validation unless explicitly requested by the user.
