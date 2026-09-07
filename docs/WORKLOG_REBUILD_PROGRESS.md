# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 provider-neutral subscription lifecycle boundary + bounded AI-tools Record deep links source-authored; executable/runtime verification still blocked

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds remain explicitly allowed while no real durable production data exists. This destructive permission expires once real customers/durable production data exist.

## Commercial/product contract still in force

- V1 has exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No one-time AI top-up and no extra paid tier.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are internal AI points, not TWD; they do not refresh monthly and issued grants are never resized retroactively.
- AI entitlement belongs to the requesting AFTERTRACE account; GROUP membership only authorizes Source data.
- AI Pro retains monthly resource/point cap, provider-cost hard cap, optional per-request cap and operator capability toggles.
- Every provider-backed request must pass server-side Source authorization + unified entitlement + reservation/provider-cost hold before provider execution, then settle actual provider usage/cost.

## Accepted target foundation — do not redo

Current branch already source-authors:

- provider-neutral Google / LINE / Apple identities and login chooser;
- immutable opaque `public_account_id`, Web/PWA display+copy and Admin exact lookup;
- native AFTERTRACE groups/invites independent from LINE GROUP membership;
- free manual Record CRUD/search + nullable `occurred_at` + provider-free browser STT;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH;
- Admin announcements, Web Push subscription/preferences/delivery, one shared ~5 minute scheduler;
- native Task backend + Web/PWA task surface;
- FREE one-time AI trial config + provider-neutral onboarding issuance;
- V1-only FREE + AI_PRO subscription surface, checkout still disabled;
- unified `AiEntitlementService`, exact selected-Grant admission, `EntitledAiPointLedgerService`, reservation/settlement/provider-cost accounting;
- atomic AI Pro concurrent provider-cost hold;
- provider-backed text/image/audio/file/PDF capture paths and PWA AI capture UI;
- natural-language search + deterministic PostgreSQL retrieval + `/ai-search`;
- Related Records deterministic ranking;
- bounded time-range summary;
- proposal-only AI rewrite + optimistic confirm flow;
- customer `/ai-tools` surface;
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension bounded session handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit screenshot/image AI path.

All above are SOURCE-AUTHORED unless separately marked runtime verified. Do not infer PASS from source presence.

## This run — provider-neutral subscription lifecycle boundary

This run stayed bounded and did not choose or hard-code a payment provider.

### Durable external-event inbox

New target table `worklog_subscription_lifecycle_events` records normalized payment/subscription lifecycle facts.

Idempotency boundary:

`provider + external_event_key`

The table stores no raw card credentials. It is constrained to:

- event type `ACTIVATE | RENEW | CANCEL`;
- plan `AI_PRO` only for current V1;
- user id;
- optional paid period start/end;
- occurred/processed timestamps;
- bounded metadata.

The schema is exported through authoritative `schema-all.ts` and must be included when the canonical `drizzle/0000` baseline is regenerated.

### Provider-neutral lifecycle service

New `SubscriptionLifecycleService` accepts only the normalized AFTERTRACE contract:

- `ACTIVATE`;
- `RENEW`;
- `CANCEL`.

Payment adapters are expected to authenticate/verify their own webhook first and then call this core service. The core service has no Stripe/ECPay/LINE Pay/etc dependency.

Validation fails closed for:

- non-AI_PRO plans;
- malformed provider/event keys;
- invalid user ids/timestamps;
- invalid activation/renewal periods;
- oversized metadata.

Duplicate external events return `DUPLICATE` and do not emit another SYSTEM notification.

### PostgreSQL lifecycle persistence

New `DrizzleSubscriptionLifecycleRepository` source-authors idempotent application of normalized lifecycle events.

For ACTIVATE / RENEW:

1. verify the current AI_PRO commercial template is enabled, AI-enabled, fixed at NT$99 and has a positive monthly AI point cap;
2. insert the provider event only when `(provider, external_event_key)` is new;
3. upsert the user's `worklog_user_subscriptions` row to active AI_PRO / PAYMENT with the new period;
4. append durable subscription history;
5. create the period's `SUBSCRIPTION_PERIOD` Grant using the monthly point-cap snapshot;
6. use a user+period origin key so repeated processing cannot create another period Grant.

For CANCEL:

- cancellation is treated as **stop renewal / cancel-at-period-end** when a future `periodEnd` is supplied;
- the already-paid current period remains ACTIVE until that end rather than being revoked immediately;
- an immediate/no-period-end cancellation ends the current period at the cancellation timestamp;
- if cancellation shortens the paid period, the matching period Grant expiry is shortened to the same durable period end;
- no per-user Cron is introduced; existing entitlement already fails after `current_period_end`.

### Subscription SYSTEM notifications

`SubscriptionLifecycleNotificationAdapter` reuses the existing shared Notification Service and deterministic helpers for:

- AI Pro activated;
- AI Pro renewed;
- AI Pro cancelled / period ending.

Notifications occur only after repository result `APPLIED`; duplicate external events do not emit another lifecycle notification.

Checkout remains disabled (`CHECKOUT_ENABLED=false`). This batch creates the provider-neutral core boundary only; it does not pretend a real payment transport exists.

## This run — bounded AI-tools Record deep links

New `ai-tools-deep-link.ts` defines a strict same-app deep-link contract:

`/ai-tools?sourceId=<positive-id>&recordId=<positive-id>&tool=related|rewrite`

Parser safety:

- only `sourceId`, `recordId`, `tool` keys are accepted;
- duplicate query keys are rejected;
- ids must be positive safe integers;
- tool must be exactly `related` or `rewrite`;
- arbitrary external destinations/extra params are rejected.

`AiToolsRoot.tsx` now:

- reads the bounded deep-link state;
- pre-fills the Related or Rewrite Record ID;
- selects the linked Source only if that Source exists in the authenticated user's returned surfaces;
- otherwise falls back to the user's authorized default Source and shows a notice;
- scrolls to the requested Related/Rewrite section when the linked Source is authorized.

The URL never grants authorization. Backend Source/Record authorization remains mandatory.

A future small Worklog Record-card button may now use `aiToolsDeepLinkUrl()` instead of constructing arbitrary query strings. The large WorklogRoot file was intentionally not broadly rewritten in the no-compile environment.

## Files changed this run

- `apps/api/src/db/schema-worklog-subscription-lifecycle.ts`;
- `apps/api/src/db/schema-all.ts`;
- `apps/api/src/worklog/subscription-lifecycle.ts`;
- `apps/api/src/worklog/drizzle-subscription-lifecycle.ts`;
- `apps/api/src/worklog/subscription-lifecycle-notifications.ts`;
- `apps/api/src/worklog/subscription-lifecycle.test.ts`;
- `apps/web/src/ai-tools-deep-link.ts`;
- `apps/web/src/ai-tools-deep-link.test.ts`;
- `apps/web/src/AiToolsRoot.tsx`;
- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Commits this run

All successful development commits contain `[skip ci]`:

- `8672381b` — add provider-neutral subscription lifecycle events;
- `2eaafcc8` — export subscription lifecycle schema;
- `95042644` — add provider-neutral subscription lifecycle service;
- `fd5d4442` — persist idempotent AI Pro lifecycle events;
- `da0d88df` — connect subscription lifecycle to SYSTEM notifications;
- `2879efc2` — author subscription lifecycle tests;
- `61692310` — constrain subscription lifecycle inbox;
- `02879150` — add bounded AI tools Record deep links;
- `89284e30` — test bounded AI tools deep links;
- `08fe3353` — prefill AI tools from bounded Record deep links;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN this run

- subscription lifecycle event target schema — **AUTHORED / NOT RUN**;
- lifecycle ACTIVATE/RENEW/CANCEL service — **AUTHORED / NOT RUN**;
- idempotent lifecycle PostgreSQL SQL — **AUTHORED / NOT RUN**;
- subscription-period Grant creation/renewal SQL — **AUTHORED / NOT RUN**;
- cancel-at-period-end + period-Grant expiry update — **AUTHORED / NOT RUN**;
- lifecycle SYSTEM notification adapter — **AUTHORED / NOT RUN**;
- `subscription-lifecycle.test.ts` — **AUTHORED / NOT RUN**;
- bounded AI-tools deep-link parser/builder — **AUTHORED / NOT RUN**;
- `ai-tools-deep-link.test.ts` — **AUTHORED / NOT RUN**;
- AiToolsRoot deep-link prefill/authorized Source selection — **AUTHORED / NOT RUN**.

### Executable verification actually attempted

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- focused/full Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- subscription lifecycle PostgreSQL/idempotency/concurrency smoke — **NOT RUN**;
- exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Related Records SQL/ranking smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini provider smoke — **NOT RUN**;
- Chrome unpacked-extension smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- Push/Cron runtime smoke — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout is still unavailable. Accumulated TypeScript/React/SQL/extension code has not compiled or executed; this is now the dominant project risk.
2. Canonical `drizzle/0000` remains behind the target schema, now also including `worklog_subscription_lifecycle_events`.
3. Lifecycle SQL is source-authored and must be exercised against real PostgreSQL before a payment adapter is enabled.
4. No payment provider transport/webhook adapter is enabled. `CHECKOUT_ENABLED=false` remains correct.
5. Cancellation currently models normal cancel-at-period-end semantics when the adapter supplies a future period end. A chosen payment provider must map its webhook semantics to that normalized contract correctly.
6. Atomic provider-cost hold still needs real PostgreSQL concurrency smoke.
7. Google/LINE/Apple OAuth, Gemini operations, Chrome Extension and Push/Cron still need runtime/browser/provider smoke.
8. Main Worklog Record cards do not yet expose the final one-click Related/Rewrite buttons; the safe deep-link builder/parser is ready, but broad WorklogRoot editing is deferred until executable validation or a small safe component extraction.
9. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are proven.

## Exact next run plan

1. If executable checkout becomes available, **stop feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/extension-session/subscription-lifecycle/entitlement/provider-cost/media/search/related/summary/rewrite/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL DB;
   - run lifecycle idempotency/renew/cancel smoke, Related SQL smoke and exact-Grant/provider-cost concurrency smoke;
   - Dev OAuth + Gemini + Chrome + Push/Cron runtime smoke.
2. If executable checkout remains unavailable, do only low-risk finishing work:
   - optionally extract a small Record-card AI-actions component and wire `aiToolsDeepLinkUrl()` without broad WorklogRoot rewrite;
   - inspect/remove target-independent retired LINE/ONE_TIME/GROUP-funding entry points only where replacement dependencies are already clear;
   - do not add more major V1 features.
3. Keep checkout disabled until a real payment provider is selected, its webhook authenticity is implemented, and the provider-neutral lifecycle boundary passes runtime validation.

## Current estimated remaining development time

Approximately **2.5–7 focused development hours** remain for the accepted V1 source/runtime scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **2.5–5.5h**;
- real OAuth/Gemini/Chrome/Push/lifecycle runtime smoke and polish: **0.75–1.75h**;
- final Record-card AI action polish + safe legacy cleanup: **0.25–1h**.

Ranges overlap. The largest uncertainty is still the first real compile/test + clean PostgreSQL baseline pass. Major V1 feature scope is now predominantly SOURCE-AUTHORED, not runtime verified.
