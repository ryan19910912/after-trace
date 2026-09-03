# AFTERTRACE AI Point / Pricing Policy

Durable product/development contract for branch `revive/line-worklog`.

## Goal

Customer-facing AI allowance is shown as **AI 點數**, not raw provider tokens or USD cost. Provider usage/cost remains separately auditable in Admin.

## Admin pricing workflow

Plan/top-up configuration is intentionally human-controlled.

Admin UI may provide a calculator using:

- customer price in TWD;
- target gross-margin percentage entered by Admin, e.g. `60%`;
- implied maximum AI cost budget = price × (1 - target gross-margin percentage);
- selected model/pricing snapshot;
- candidate AI-point conversion rule.

Example: NT$99 plan with target gross margin 60% implies a suggested AI cost budget of NT$39.6 before considering payment fees, infrastructure, support, taxes, subsidies, and other COGS.

The Admin calculator may show a **recommended included AI points** value, but the final included points are still explicitly entered/confirmed by Admin and persisted. Backend must not silently recalculate or change an existing plan's included AI points when price, FX, model pricing, or margin assumptions change.

If the product later wants fully automatic pricing, it requires a separate explicit decision and durable configuration for the target margin.

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

## Model pricing snapshot

As of 2026-09-03, official Gemini Developer API standard paid pricing for `gemini-3.5-flash-lite` is USD $0.30 / 1M input tokens and USD $2.50 / 1M output tokens including thinking tokens. Pricing changes over time, therefore historical usage must retain the pricing snapshot that applied when the request ran.

## Gross-margin interpretation

The Admin `target gross margin %` is a planning aid, not guaranteed net profit. Gross-margin planning must distinguish direct cost of delivering the service (AI inference, infrastructure, payment processing and other applicable COGS) from later operating expenses such as development, marketing and general administration.

If the point recommendation is calculated using only output-token price, input-token cost and other delivery costs remain outside that simplified recommendation and reduce the realized gross margin. Admin reporting must surface the actual realized margin/cost.

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
