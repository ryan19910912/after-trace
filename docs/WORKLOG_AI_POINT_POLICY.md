# AFTERTRACE AI Point / Pricing Policy

Durable product/development contract for branch `revive/line-worklog`.

## Goal

Customer-facing AI allowance is shown as **AI 點數**, not raw provider tokens or USD cost. Provider usage/cost remains separately auditable in Admin.

## Admin pricing workflow

Plan/product configuration is intentionally human-controlled.

Admin pricing tools may use customer price, target gross margin, selected model/pricing snapshot, FX, and the current AI-point conversion rule to suggest a point amount. The final `grant_points` value is explicitly entered/confirmed by Admin and persisted.

Current commercial planning defaults:

- one-time purchases / top-ups: about **50% target gross margin**;
- subscription included allowance: about **40% target gross margin**.

These are editable planning defaults, not immutable business constants. Backend must never silently resize existing Grants when price, FX, model pricing, target margin, or plan templates change.

## Three plan/product point meanings

`worklog_subscription_plans.grant_points` is a generic commercial-template value. Its meaning is determined by `plan_type`:

- `FREE`: **首次贈送 AI 點數** — issued once as `FREE_INITIAL` to an eligible user who has not received it before.
- `SUBSCRIPTION`: **訂閱週期 AI 點數** — frozen into each successful `SUBSCRIPTION_PERIOD` Grant.
- `ONE_TIME`: **購買可得 AI 點數** — frozen into one successful one-time/TOP_UP Grant.

The template is not the user's live balance. Grants are durable accounting facts.

## FREE acquisition grant — Admin configured

FREE has no purchase price, so its initial grant is a customer-acquisition/product-trial subsidy rather than a gross-margin-derived purchase allowance.

Rules:

- Exactly one `FREE` plan exists.
- FREE `grant_points` is configured in Admin/DB, not hard-coded in source code and not stored in environment variables.
- A new eligible user receives the currently configured amount once.
- No calendar refresh and no calendar expiry unless a later explicit product decision changes that policy.
- After FREE reaches zero, manual PWA remains available for free.
- Changing the FREE template affects only users who have not yet received `FREE_INITIAL`.
- Existing FREE Grants are never resized or recalculated retroactively.
- Admin should measure average real provider subsidy, exhaustion rate, and FREE-to-paid conversion before changing the acquisition amount.

The operator may currently configure **400,000** points as the launch value, but that number is not frozen in code or in this policy.

## Subscription allowance

Each successful subscription period freezes that plan's current `grant_points` into a separate `SUBSCRIPTION_PERIOD` Grant. Later template changes do not change the already-created period Grant.

Unused subscription-period allowance does not roll into the next period unless a later explicit product decision changes the policy.

## One-time / buyout allowance

Each successful ONE_TIME purchase freezes that product's current `grant_points` into a separate one-time/TOP_UP Grant. It does not create a recurring subscription allowance and never refreshes monthly.

## Conservative allowance sizing and actual charging

Allowance sizing may use the selected provider/model's output-token price as the conservative reference price when converting an AI budget into suggested customer points.

This does **not** mean actual provider accounting ignores input or other usage. Every successful AI call records/charges from actual provider cost including billable input, output, thinking/reasoning, and modality-specific usage where applicable.

## Provider cost vs customer points

Provider-dollar cost and customer AI points are separate facts.

For every provider call retain sufficient usage/pricing facts to calculate actual cost, including input tokens, output tokens, thinking/reasoning where applicable, model, immutable pricing snapshot, and modality-specific usage where applicable.

Admin profitability reports use actual provider cost rather than assuming points equal provider cost.

## AI point conversion — frozen

**1 AI point = 1 output-price-equivalent token.**

For a successful provider call:

1. calculate full actual provider cost using the immutable pricing snapshot for that request;
2. use the same snapshot's output price per token as the point reference price;
3. convert total provider cost into output-price-equivalent tokens;
4. round any positive fractional result upward (`ceil`). Zero cost remains zero points.

Conceptual formula:

`AI points used = ceil(total actual provider cost / output reference price per token)`

All billable input/output/thinking/media costs are therefore represented in point consumption even though the reference unit is output price.

Large balances such as hundreds of thousands or millions are intentional. Customer UI should use readable separators and percentages.

Do not silently change the definition of one AI point or the historical rounding rule. A future unit change requires explicit versioning/migration so historical Grants and usage stay auditable.

## Model pricing snapshot

Provider/model prices are durable configurable pricing snapshots, not entitlement constants. Historical usage retains the exact provider/model pricing snapshot that applied when the request ran.

Do not hard-code current provider web prices into entitlement logic.

## AI provider/model runtime rule

Provider may be restricted to implemented adapters (currently `GOOGLE`). Model identifiers are runtime data and must not be hard-coded or allowlisted. The current intended operator model is `gemini-3.5-flash-lite`; future compatible model identifiers may be selected without a code release.

## Legacy point values

Legacy values such as FREE `500`, PRO `500`, TEAM `2500`, or any old aggregate quota unit are not accepted customer allowances under the current point definition.

Current point amounts for FREE, subscription products, and ONE_TIME products are explicit Admin configuration. Prelaunch disposable data may be rebuilt to remove obsolete defaults.

## Admin usage and profitability analytics

Admin should support periods such as today / 7 days / 30 days / current billing month and expose at minimum:

- total AI requests and AI points consumed;
- provider cost USD/TWD;
- average points/provider cost per request and per active user;
- platform-subsidized points/provider cost;
- allowance exhaustion and utilization;
- FREE real subsidy and conversion where available;
- model, operation/input type, PRIVATE/GROUP, Grant type, and commercial plan/product breakdowns;
- realized revenue/cost/margin only when durable successful-payment facts exist.

Customer PWA shows customer-friendly point balances/usage percentages, not internal provider pricing or margins.

## Gross-margin interpretation

Target gross margin is a planning aid, not guaranteed net profit. Direct AI/infrastructure/payment costs must be distinguished from broader operating expenses.

## User-facing usage display

PWA should display remaining, used and available/included AI points plus usage/remaining percentage/progress. GROUP PWA exposes only authorized group-scoped availability/usage under the current AI 額度負責人, not unrelated balances.

## Zero-balance / overage rule

- eligible AI points must be greater than zero before starting an AI operation;
- if zero at request start, do not call provider AI;
- if the request starts with positive balance and real usage exceeds remaining points, customer balance floors at zero and AFTERTRACE absorbs the shortfall for that already-started request;
- Admin records customer charge, provider cost, and platform subsidy separately.

GitHub Actions must not be used as validation unless explicitly requested by the user.
