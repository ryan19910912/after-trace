# AFTERTRACE AI Subscription / Usage Policy

## Goal

AI is a **paid per-user subscription capability**. Free users receive no provider-backed AI allowance. Manual Web/PWA Record use remains available without AI.

The target product no longer exposes LINE group AI responsible-user funding. GROUP data authorization and each user's AI subscription are separate concerns.

## Customer-facing model

Do not advertise mathematically unlimited provider compute.

Preferred customer wording:

> **日常使用不限次數；AI 功能仍受公平使用原則與每月方案資源上限限制。達到上限後，AI 功能將於下一個週期恢復。**

Customer UI may show:

- AI 可使用 / 正常;
- 接近本月使用上限;
- 本月 AI 使用量已達上限;
- next reset/billing date.

Do not expose provider USD/TWD cost, target margin, or internal point-conversion details to customers.

## Per-user entitlement

AI entitlement belongs to the requesting user.

- paid user in PRIVATE Source: may use entitled AI features;
- paid user in authorized GROUP Source: may use entitled AI features against authorized GROUP data;
- free user in the same GROUP: may use permitted manual features but cannot invoke provider AI;
- no GROUP AI responsible-user binding is required.

## Free plan

FREE has no provider-backed AI entitlement in the target product.

Free users may still use browser/device speech-to-text when it does not consume AFTERTRACE provider AI. That capability is plain voice input, not AI interpretation.

Existing prelaunch `FREE_INITIAL` Grants/point balances are legacy migration data and must not define the future customer contract.

## Paid plan configuration

Admin must be able to configure plan economics and feature boundaries. Target fields/capabilities include:

- `price_twd`;
- `ai_enabled`;
- monthly AI resource/point cap;
- monthly provider-cost cap in TWD;
- optional per-request maximum resource/cost cap;
- optional audio duration limit;
- optional image count/size limit;
- optional file size/page/text limit;
- natural-language search enabled;
- time-range summary enabled;
- AI rewrite enabled;
- image/file AI enabled;
- AI Q&A enabled when shipped.

Existing capability-definition infrastructure may be reused where it fits.

## Hard cap rule

Each provider-backed request must pass entitlement/resource checks before provider work begins.

At minimum runtime should fail closed when either of these has reached the configured subscription-period limit:

1. internal AI resource/point usage cap;
2. actual provider-cost cap in TWD.

Whichever hard cap is reached first blocks new AI work until the next entitled period or operator adjustment.

The provider-cost cap is mandatory operational protection because model/token/modality mix can change even when internal point estimates remain stable.

## Reservation / settlement

The existing reservation/settlement accounting model may be retained internally if useful for concurrency and audit.

Rules:

- reserve enough bounded capacity before provider execution;
- provider work must not start when the request cannot be safely admitted;
- settle against actual provider usage/cost after completion;
- release unused reservation on failure/cancel where applicable;
- do not let customer-facing balance presentation become the product's primary UX.

Internal points are an accounting unit, not the product promise.

## Actual provider cost

For every provider call retain enough immutable facts to calculate actual cost:

- provider;
- model;
- input/output/thinking/media usage;
- pricing snapshot;
- FX snapshot when TWD cost is shown/enforced;
- actual provider cost USD/TWD;
- operation;
- requesting user;
- Source/group;
- subscription plan/period;
- reservation/settlement references when used.

## AI operations

Provider-backed operations may include:

- natural-language Record create;
- AI voice interpretation;
- image/file/PDF interpretation;
- title/keyword/date/entity enrichment for new AI operations;
- natural-language search interpretation;
- related-record ranking when AI is actually used;
- time-range summary;
- AI rewrite;
- AI Q&A;
- task extraction/proposal when provider-backed.

Manual CRUD/search/date filtering and non-provider browser speech-to-text consume no AI allowance.

## Historical data

Subscribing to AI does **not** trigger historical free-Record enrichment.

- old Records stay unchanged;
- no bulk provider backfill cost is incurred;
- future AI search can still search old raw `content` deterministically;
- new AI Records can carry richer metadata.

## Usage warnings

The product should warn users before a hard stop where practical.

Recommended states are based on plan-period utilization thresholds, for example:

- normal;
- approaching limit;
- limit reached.

Exact warning percentages are Admin/product configuration, not immutable business constants.

## Subscription-period reset

Usage limits apply to the current successful subscription period. At period renewal, new period accounting/caps begin according to the plan active for that successful renewal.

No carry-over promise is required unless a later explicit product decision adds one.

## Admin economics

Admin should expose at minimum:

- plan price;
- current-period AI requests;
- internal resource/point use;
- actual provider cost USD/TWD;
- configured provider-cost cap;
- cost-cap utilization;
- active/blocked users;
- average provider cost per request/user;
- model/operation/modality breakdown;
- period revenue facts only when durable successful-payment data exists.

The operator must be able to set a provider-cost ceiling below the subscription selling price to protect unit economics after infrastructure/payment costs.

## Legacy point definition

Historical prelaunch AI points and Grants remain auditable migration facts while legacy code is removed. Do not silently rewrite historical usage accounting.

The old customer contract in which FREE received a large AI-point grant and GROUP AI was funded by a responsible user's scoped Grant is retired for the target product.

GitHub Actions must not be used as validation unless explicitly requested by the user.
