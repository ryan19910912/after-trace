# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 V1 commercial surfaces + unified per-user AI entitlement/admission source-authored; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are explicitly allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE AFTERTRACE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- Trial points are not a TWD balance, are not hard-coded, do not refresh monthly, and do not retroactively resize already-issued trials.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership only authorizes data access; it never transfers another member's AI allowance.
- AI Pro is fixed at NT$99/month and keeps monthly internal resource/point cap, configurable provider-cost hard cap, and optional per-request point cap.
- Trial/AI_PRO provider calls continue through existing reservation/settlement/provider-cost accounting where it cleanly fits.

## Accepted foundation from prior checkpoints

- Provider-neutral identity model for Google / LINE / Apple, immutable opaque `public_account_id`, Admin exact lookup and authenticated account chrome.
- Native AFTERTRACE GROUP membership/invites independent from LINE group membership.
- Free manual Record CRUD/search with nullable `occurred_at` and content-only create.
- Capture-first PWA/browser speech path without AFTERTRACE provider AI.
- Notification categories exactly `ANNOUNCEMENT | SYSTEM | TASK`, independent `IN_APP | PUSH` channels, durable notification center/read state.
- Admin ANNOUNCEMENT backend/frontend, scheduled dispatch, Web Push subscriptions/preferences/encrypted transport/retry state.
- One shared `*/5 * * * *` Worker scheduler for due ANNOUNCEMENT -> due TASK -> pending PUSH.
- Native Task target schema/service/repository/API + Web/PWA Task surface.
- Dedicated FREE trial commercial config + provider-neutral onboarding issuance + idempotent FREE-trial SYSTEM notification.
- Chrome extension scaffold remains committed to shared account/Source/Record/AI entitlement model.

## This run — V1 commercial cleanup + unified AI entitlement

This run continued the exact next planned batch and did not redo a broad static audit.

### Unified AI entitlement domain

New `apps/api/src/worklog/ai-entitlement.ts` defines one shared decision model for Web/PWA/GROUP/Chrome provider-backed AI:

- `FREE_TRIAL`;
- `AI_PRO`;
- `BLOCKED`.

The service enforces Source authorization before entitlement. PRIVATE requires the requesting user; GROUP requires current AFTERTRACE membership. No LINE GROUP fact and no GROUP AI responsible/funding user participates.

`resolve()` is intentionally read-only for UI/status checks.

`admit(userId, sourceId, requestedPoints)` is the provider preflight and only then ensures the requesting user's own current grant scope for that authorized Source.

Admission now fails closed for:

- unauthorized Source;
- no entitlement / exhausted trial;
- disabled AI Pro plan;
- missing matching AI Pro current-period grant;
- monthly AI resource/point cap reached;
- monthly provider-cost TWD hard cap reached;
- incomplete current-period provider TWD cost accounting;
- optional per-request AI point cap exceeded.

### PostgreSQL entitlement accounting

New `drizzle-ai-entitlement.ts` reads provider-neutral user/Source facts and current commercial state.

Important source-authored rules:

- authorized GROUP Source uses the requesting user's own grant only;
- AI Pro active period must be current and specifically `AI_PRO`;
- matching `SUBSCRIPTION_PERIOD` grant must match current period start/end;
- monthly resource use counts `customer_points_charged + platform_subsidized_points`, so provider work cannot evade the monthly resource cap through subsidy accounting;
- provider-cost hard cap sums actual `provider_cost_twd` for the current period;
- any current-period usage event missing `provider_cost_twd` blocks new paid provider work rather than undercounting cost;
- FREE trial inherits the configured AI Pro per-request point safety cap where available;
- Source scope creation is idempotent and happens only on `admit()`, not on status GET.

### Provider-neutral entitlement API

New authenticated:

- `GET /api/v1/ai/entitlement?sourceId=...`

It resolves the durable Web session to AFTERTRACE `userId`, checks the requested Source, and returns the shared decision. It is mounted before legacy LINE/Gemini runtime initialization.

This endpoint is suitable for Web/PWA/Extension status display. Provider execution must use `AiEntitlementService.admit()` rather than treating the status endpoint as authority to bypass preflight.

### Admin commercial page

New Admin `/commercial` customer-economics/operator page now manages the accepted V1 shape:

FREE:

- `FREE 初始 AI 試用點數` / `free_initial_ai_trial_points`;
- clear one-time/non-TWD/non-monthly-refresh wording;
- recipients / exhausted recipients / issued / remaining / consumed point stats.

AI Pro:

- price is fixed as `NT$99 / 月` and is not editable through this surface;
- enabled state;
- monthly AI point/resource cap;
- monthly Provider Cost hard cap TWD;
- optional per-request AI point cap;
- explicit wording that provider-cost cap is internal risk control, not customer cash balance.

The Admin commercial API has corresponding GET/PUT endpoints for FREE trial and AI Pro config, with audit-backed persistence.

### Customer subscription surface now exposes only V1 products

`GET /api/v1/subscription/plans` now returns only:

- `FREE` with price 0;
- `AI_PRO` with `SUBSCRIPTION`, price exactly 99 and AI enabled.

Legacy `ONE_TIME` rows cannot leak onto the customer plan list.

The response also includes the authenticated user's FREE trial state:

- `AVAILABLE` + original/remaining points;
- `EXHAUSTED`;
- `NOT_ISSUED`.

`POST /checkout-intents` now fails closed for any plan code other than `AI_PRO`; existing `CHECKOUT_ENABLED=false` remains in place until payment/runtime validation is complete.

Web `/subscription` was updated accordingly:

- FREE is described as the complete manual product plus one-time AI Pro trial;
- trial remaining/exhausted/not-issued state is shown without TWD semantics;
- AI Pro is shown as `NT$99 / 月`;
- fair-use/monthly resource/provider-cost language is preserved;
- only AI_PRO can ever enter the checkout path.

### Legacy Admin plan mutation retired

The old generic Admin plan GET/read surface may remain temporarily for migration diagnostics, but Worker now rejects legacy `PUT/DELETE /api/v1/admin/plans/:code` with HTTP 410 and points operators to the dedicated commercial config surface.

This prevents the old generic plan editor from creating `ONE_TIME`, extra tiers, or mutating the fixed AI Pro V1 commercial shape. Target commercial mutation is `/api/v1/admin/commercial-config/*`.

### Tests authored/updated

- `ai-entitlement.test.ts` now covers read-only resolution, admission scope creation, GROUP isolation, FREE-trial per-request cap, AI Pro monthly point cap, provider-cost cap, incomplete provider cost fail-closed, missing period grant fail-closed, and normal AI_PRO admission.
- `ai-entitlement-routes.test.ts` covers durable userId session, FREE_TRIAL response, GROUP isolation, invalid Source, and asserts the GET path does not mutate grant scope.
- `commercial-config.test.ts` covers FREE trial semantics plus fixed AI Pro price and cap validation.
- `commercial-api.test.ts` covers Admin bearer auth and FREE trial point-only API shape.

## Files changed this run

- `apps/api/src/worklog/ai-entitlement.ts` — unified read/admission domain;
- `apps/api/src/worklog/drizzle-ai-entitlement.ts` — Source authorization + trial/AI Pro current-period/cost accounting;
- `apps/api/src/worklog/ai-entitlement.test.ts` — entitlement/admission tests;
- `apps/api/src/worklog/ai-entitlement-routes.ts` — provider-neutral status route;
- `apps/api/src/worklog/ai-entitlement-routes.test.ts` — route tests;
- `apps/api/src/worklog/commercial-config.ts` — AI Pro V1 commercial config domain;
- `apps/api/src/worklog/drizzle-commercial-config.ts` — fixed-price AI Pro config persistence/audit;
- `apps/api/src/worklog/commercial-config.test.ts` — FREE + AI Pro config tests;
- `apps/api/src/admin/commercial-config-routes.ts` — FREE/AI Pro Admin commercial config APIs;
- `apps/api/src/worklog/subscription-routes.ts` — V1-only customer plan/checkout + trial status;
- `apps/api/src/worker.ts` — entitlement route + retired generic Admin plan mutations;
- `apps/admin/src/commercial-api.ts` — Admin commercial config client;
- `apps/admin/src/commercial-api.test.ts` — client tests;
- `apps/admin/src/AdminCommercialPage.tsx` — FREE trial + AI Pro operator page;
- `apps/admin/src/main.tsx` — `/commercial` route;
- `apps/web/src/worklog-api.ts` — V1 subscription/trial types;
- `apps/web/src/SubscriptionRoot.tsx` — customer FREE trial + AI Pro UI;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `6255ba3f` — add unified AI entitlement domain;
- `d653e7b7` — persist unified AI entitlement lookup;
- `784abaf6` — fix FREE trial entitlement origin key;
- `3eac435e` — author unified AI entitlement tests;
- `c8a5b6b5` — add Admin commercial config client;
- `afa42e14` — add Admin FREE trial commercial page;
- `f14aec01` — route Admin commercial settings;
- `8f953f05` — author Admin commercial API tests;
- `192e1dc5` — add AI Pro commercial config domain;
- `f2f64ab0` — persist AI Pro commercial config;
- `932d0b99` — expose AI Pro commercial config routes;
- `852d3d5f` — expose AI Pro Admin commercial client;
- `b1115f5a` — manage AI Pro caps in Admin commercial page;
- `4e9b08ec` — extend commercial config tests for AI Pro;
- `889f5a04` — enforce V1 FREE and AI Pro subscription surface;
- `96b638a4` — expose V1 subscription trial state;
- `9b48c84e` — align customer subscription UI with FREE trial and AI Pro;
- `54d5c632` — expose provider-neutral AI entitlement route;
- `6a4a56ea` — mount provider-neutral AI entitlement API;
- `128f62a8` — author AI entitlement route tests;
- `10e5c948` — harden AI entitlement provider admission;
- `c9f49596` — enforce complete AI Pro accounting in entitlement;
- `0f263889` — harden unified AI entitlement tests;
- `3865c320` — align AI entitlement route tests;
- `f2085da9` — retire legacy Admin plan mutations;
- this checkpoint commit follows.

A stale-SHA GitHub update attempt returned HTTP 409 before commit; it produced no repository change.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/ai-entitlement.test.ts` — **AUTHORED/UPDATED / NOT RUN**;
- `apps/api/src/worklog/ai-entitlement-routes.test.ts` — **AUTHORED/UPDATED / NOT RUN**;
- `apps/api/src/worklog/commercial-config.test.ts` — **AUTHORED/UPDATED / NOT RUN**;
- `apps/admin/src/commercial-api.test.ts` — **AUTHORED / NOT RUN**;
- unified FREE_TRIAL / AI_PRO admission — **AUTHORED / NOT RUN**;
- GROUP per-requesting-user grant scope behavior — **AUTHORED / NOT RUN**;
- AI Pro point/provider-cost hard caps — **AUTHORED / NOT RUN**;
- Admin `/commercial` UI/API — **AUTHORED / NOT RUN**;
- V1-only customer subscription API/UI — **AUTHORED / NOT RUN**;
- legacy generic Admin plan mutation guard — **AUTHORED / NOT RUN**.

### Executable verification actually attempted

- executable AFTERTRACE checkout discovery — **FAIL**; no mounted checkout was found;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- entitlement/commercial/subscription focused Vitest — **NOT RUN**;
- existing Task/Push/Notification focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Admin TypeScript/tests/build — **NOT RUN**;
- Web TypeScript/tests/build — **NOT RUN**;
- PostgreSQL entitlement GROUP scope/current-period/cost-cap smoke — **NOT RUN**;
- PostgreSQL FREE trial/config/AI Pro config smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so current TypeScript/React/SQL has not compiled or executed.
2. Canonical `drizzle/0000` is still behind target schema, including provider-neutral auth, notification/PUSH, native Task, commercial config and current entitlement assumptions.
3. `AiEntitlementService.admit()` is now the target provider preflight, but existing migration-era LINE/Gemini normalization/attachment paths still call the old grant ledger directly. New Web/PWA/Extension provider-backed operations must use `admit()`; retired LINE paths should be removed/isolate rather than expanded.
4. AI Pro provider-cost hard cap currently fails closed if any current-period usage lacks `provider_cost_twd`; real provider usage/FX settlement must consistently populate TWD cost before paid launch.
5. Payment lifecycle remains disabled (`CHECKOUT_ENABLED=false`); payment provider, webhook idempotency, renewal/cancellation state and actual SYSTEM notification callers remain incomplete.
6. Google Login and Apple Login callbacks remain incomplete. LINE Login is provider-neutral and uses shared onboarding.
7. Admin old plan read/UI artifacts may still display legacy migration fields, but generic plan mutation is now disabled and cannot create new V1-incompatible products.
8. Real Web Push/Cron/Task runtime and browser/provider validation remain pending.
9. Chrome extension real auth handoff/Source picker/durable Record persistence remains incomplete.
10. Target paid AI capture/search/summary/rewrite routes still need to be built on top of unified entitlement + reservation/settlement.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix first:
   - API typecheck;
   - entitlement/commercial/subscription focused tests;
   - Task/Push/Notification focused tests;
   - API Worker dry-run build;
   - Admin typecheck + commercial API tests + build;
   - Web typecheck + existing focused tests + build;
   - PostgreSQL entitlement/current-period/cost-cap + FREE trial/AI Pro config smoke.
2. If executable checkout remains unavailable, continue the next bounded target batch:
   - add a new provider-backed Web/PWA AI capture/admission path that calls `AiEntitlementService.admit()` before the existing reservation/settlement/provider call;
   - emit idempotent AI-limit SYSTEM notification when hard-cap admission blocks at the durable period boundary;
   - keep manual capture provider-free;
   - do not extend retired LINE AI runtime.
3. Complete Google Login using provider-neutral provisioning + shared account onboarding; keep LINE Login; add Apple next.
4. Implement payment provider/AI Pro activation-renewal-cancellation lifecycle with deterministic SYSTEM notifications; keep checkout disabled until verified.
5. Complete natural-language search / related Records / time-range summary / explicit rewrite using the same entitlement/accounting boundary.
6. Continue Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page context -> selected text -> quick voice -> screenshot/image AI entitlement -> permission/privacy/browser smoke/package.
7. Regenerate canonical baseline, rebuild disposable Dev/Prod, run runtime E2E, then remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **18–38 focused development hours** remain.

Rough remaining allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **4–8h**;
- provider-backed AI capture/admission + limit SYSTEM caller + settlement integration: **3–6h**;
- Google + Apple login completion/auth smoke: **3–5h**;
- payment/AI Pro lifecycle + deterministic SYSTEM callers: **2–4h**;
- natural-language search / related / summary / rewrite accepted gaps: **2–5h**;
- Chrome extension real auth/capture integration: **2–5h**;
- Web Push/Cron/PWA/browser/runtime smoke + final legacy cleanup: **2–5h**.

Largest uncertainty remains the first real API/Web/Admin compile/test pass, PostgreSQL target-schema rebuild, Web Push provider/browser smoke, and Dev runtime E2E. Narrow this estimate again after those execute.
