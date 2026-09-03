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
- candidate AI-point conversion rule.

Current commercial starting targets:

- **one-time AI top-up / one-time allowance products: target gross margin 50%**;
- **monthly subscription included AI allowance: target gross margin 40%**, intentionally giving recurring subscribers more AI value to encourage ongoing product use and retention.

These are editable planning defaults, not immutable business constants.

Examples:

- NT$100 one-time product at 50% target gross margin -> suggested AI cost budget NT$50;
- NT$99 subscription at 40% target gross margin -> suggested AI cost budget NT$59.4.

The Admin calculator shows a **recommended included AI points** value, but the final included points are still explicitly entered/confirmed by Admin and persisted. Backend must not silently recalculate or change an existing plan's included AI points when price, FX, model pricing, or margin assumptions change.

If the product later wants fully automatic pricing, it requires a separate explicit decision and durable configuration for the target margin.

## Conservative allowance sizing and actual charging

Allowance sizing may intentionally use the provider's higher output-token price as the conservative reference price when converting an AI budget into a suggested customer point balance.

This does **not** mean actual provider accounting ignores input or other usage. Every AI call still records and charges from actual provider usage/cost, including input, output, thinking/reasoning and modality-specific usage where applicable.

The purpose of using the higher output reference price for suggested allowance sizing is to give the customer a conservatively sized balance: when real requests contain cheaper input usage, realized margin may be higher than the planning target.

## Provider cost vs customer points

Provider-dollar cost and customer AI points are separate concepts.

For every provider call retain sufficient usage/pricing facts to calculate actual cost, including input tokens, output tokens, thinking/reasoning tokens where applicable, model, pricing snapshot, and modality-specific usage where applicable.

Customer points may use a simplified conversion rule, but Admin profitability reports must use actual provider cost rather than assuming points equal provider cost.

## Point conversion — not yet frozen

Candidate approaches under discussion:

1. `1 AI point = 1 output-equivalent token` — transparent and produces large balances, potentially hundreds of thousands or millions of points.
2. `1 AI point = 10 output-equivalent tokens` — keeps balances in tens/hundreds of thousands while retaining fine-grained usage.
3. `1 AI point = 100 output-equivalent tokens` — cleaner/smaller numbers but individual short requests may require rounding rules.

Current preference should be chosen only after checking plan balances and typical request usage. Do not hard-code 1:1 until approved.

When converting an actual provider call into customer points, all billable usage/cost must be represented. A future approved formula may convert total actual provider cost into output-price-equivalent points rather than counting output tokens alone.

## Model pricing snapshot

As of 2026-09-03, official Gemini Developer API standard paid pricing for `gemini-3.5-flash-lite` is USD $0.30 / 1M input tokens and USD $2.50 / 1M output tokens including thinking tokens. Pricing changes over time, therefore historical usage must retain the pricing snapshot that applied when the request ran.

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
- average allowance utilization percentage and distribution where practical.

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
