# AFTERTRACE V1 Production Checklist

This checklist separates completed product code from operator/provider configuration. Do not invent values; use official provider/account values only.

## 1. LINE / LIFF

- Configure `LINE_CHANNEL_SECRET`.
- Configure `LINE_CHANNEL_ACCESS_TOKEN`.
- Configure `LIFF_CHANNEL_ID` and `VITE_LIFF_ID` from the same intended LIFF channel.
- Configure `LIFF_APP_URL` to the production LIFF entry URL.
- Configure `LIFF_WEB_ORIGIN` to the exact production browser origin.
- Register the production LINE webhook URL and enable required Group events, including message, join/leave and memberJoined/memberLeft.
- Confirm the bot has permissions required for Group membership lookup, reply and Push.

## 2. Neon / schema

- Configure production `DATABASE_URL` with TLS.
- Apply generated Drizzle migrations only after the final verification phase validates schemas Round 16-18.
- Confirm backups/PITR and production retention settings at the Neon account level.

## 3. Gemini / Energy economics

- Configure `GEMINI_API_KEY`.
- Confirm `GEMINI_MODEL` against the intended production model.
- Configure current official `GEMINI_INPUT_USD_PER_MILLION_TOKENS` and `GEMINI_OUTPUT_USD_PER_MILLION_TOKENS`.
- Configure the operational `USD_TWD_RATE` snapshot source/process.
- Choose product economics and set `ENERGY_UNITS_PER_TWD`.
- Set `GEMINI_CHAT_MAX_OUTPUT_TOKENS`.
- Deliberately choose `GEMINI_MEMORY_MAX_OUTPUT_TOKENS`; it is part of the computed pre-provider worst-case budget bound.
- Set `GLOBAL_FREE_AI_BUDGET_COST_TWD`.
- Set `BACKGROUND_AI_MAX_SUBSIDY_COST_TWD` as the additional per-call ceiling. If the computed request risk exceeds it, Memory Gemini is not invoked.
- Confirm the chosen values preserve acceptable gross margin under worst-case usage before launch.

## 4. User Energy products

Set the approved product amounts/prices:

- `FREE_INITIAL_ENERGY`
- `SUBSCRIPTION_MONTHLY_ENERGY`
- `SUBSCRIPTION_PRICE_TWD`
- `PAID_PACK_SMALL_ENERGY` / `PAID_PACK_SMALL_PRICE_TWD`
- `PAID_PACK_MEDIUM_ENERGY` / `PAID_PACK_MEDIUM_PRICE_TWD`
- `PAID_PACK_LARGE_ENERGY` / `PAID_PACK_LARGE_PRICE_TWD`
- `REMINDER_RESERVATION_ENERGY`

FREE and PAID do not expire; Subscription Energy expires at real provider `period_end` and does not roll over.

## 5. Payment adapter

AFTERTRACE core is provider-neutral. Deploy or connect one trusted adapter implementing the checkout/event contract, then configure:

- `COMMERCE_PROVIDER`
- `COMMERCE_CHECKOUT_CREATE_URL`
- `COMMERCE_ADAPTER_SECRET`
- `COMMERCE_RETURN_URL`
- `COMMERCE_WEBHOOK_SECRET`

Adapter requirements:

- use AFTERTRACE `requestKey` as provider-side idempotency key;
- return an HTTPS `checkoutUrl` and stable provider checkout id;
- verify the actual provider webhook/signature using the provider's official mechanism;
- emit only verified internal events to AFTERTRACE: `SUBSCRIPTION_CYCLE_PAID`, `SUBSCRIPTION_CANCELLED`, `PAID_PACK_PURCHASED`;
- map the authenticated AFTERTRACE LINE user identity to the provider customer/purchase safely;
- never trust price or Energy amount from browser input.

## 6. Google Ad Manager Web Rewarded

- Configure `REWARDED_AD_ENERGY`.
- Configure official production `GOOGLE_AD_MANAGER_NETWORK_CODE`.
- Configure official production `GOOGLE_AD_MANAGER_REWARDED_AD_UNIT_PATH`.
- Review `REWARDED_AD_DAILY_LIMIT` and `REWARDED_AD_COOLDOWN_MINUTES`.
- Confirm the GAM account/ad unit actually supports the Web Rewarded inventory used by the GPT client.

Web Rewarded is not mobile SSV. AFTERTRACE's V1 trust boundary is authenticated LIFF identity + short-lived server nonce + one-time claim + provider-event idempotency + cooldown/daily limit.

## 7. Proactive Push

- Configure a strong `PROACTIVE_INTERNAL_SECRET`.
- Connect only approved product trigger producers to the internal enqueue endpoint/dispatcher.
- Each producer must decide the business trigger; it must not bypass `ProactiveService` or write queue rows directly.
- Validate the first launch trigger rules separately before enabling them in production.

## 8. Retention / privacy

- Review `UNPAID_RETENTION_DAYS` and `PAID_RETENTION_DAYS` before launch; current values remain legacy compatibility timing.
- Confirm Group cleanup preserves all User-owned Energy/subscription/payment/AI financial reconciliation.
- Confirm logs do not include secrets, raw conversation text or raw LINE identifiers by default.

## 9. Final verification gate

Only after V1 functional scope is frozen:

1. dependency-aware typecheck;
2. lint;
3. all Vitest suites;
4. API and Vite production builds;
5. `pnpm db:schema:check` plus Drizzle migration generation/review;
6. GitHub Actions CI;
7. fix all repository failures until green;
8. smoke-test LINE webhook, generic `@AI`, `@AI 記住`, background memory, LIFF wallet, Rewarded Ad, checkout adapter, Reminder and Proactive Push in a non-production Group;
9. only then deploy production schema/configuration.
