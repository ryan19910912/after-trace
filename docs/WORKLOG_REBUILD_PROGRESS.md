# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 provider-neutral subscription lifecycle is source-authored and hardened against stale/out-of-order payment events; AI-tools bounded Record deep links are source-authored; executable/runtime verification still blocked

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
- Deterministic paid features such as current Related Records ranking must not fabricate provider usage or consume trial points when no provider call occurs.

## Accepted target foundation — do not redo

Current branch already source-authors:

- provider-neutral Google / LINE / Apple identities and login chooser;
- immutable opaque `public_account_id`, Web/PWA display+copy and Admin exact lookup;
- native AFTERTRACE groups/invites independent from LINE GROUP membership;
- free manual Record CRUD/search + nullable `occurred_at` + provider-free browser STT;
- notification center + exactly ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH;
- Admin announcements, Web Push subscription/preferences/delivery and one shared ~5 minute scheduler;
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
- Chrome Extension bounded session handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit screenshot/image AI path;
- provider-neutral normalized AI Pro subscription lifecycle core;
- bounded `/ai-tools?sourceId=&recordId=&tool=related|rewrite` deep-link parser/prefill.

All above are **SOURCE-AUTHORED** unless separately marked runtime verified. Do not infer PASS from source presence.

## Branch reconciliation at start of this run

The durable checkpoint initially visible for this run was behind the actual branch. The branch had advanced from the bounded Extension checkpoint to `08fe3353`, ten commits ahead and zero behind.

Those already-present commits were accepted rather than re-authored. They included:

- provider-neutral lifecycle schema/service/repository for ACTIVATE / RENEW / CANCEL;
- idempotency boundary `provider + external_event_key`;
- AI Pro subscription-period Grant creation;
- lifecycle SYSTEM notification adapter;
- initial lifecycle tests;
- bounded AI-tools Record deep-link parser/builder and AiToolsRoot prefill.

Relevant pre-existing commits accepted this run:

- `8672381b` — add provider-neutral subscription lifecycle events;
- `2eaafcc8` — export subscription lifecycle schema;
- `95042644` — add provider-neutral subscription lifecycle service;
- `fd5d4442` — persist idempotent AI Pro lifecycle events;
- `da0d88df` — connect subscription lifecycle to SYSTEM notifications;
- `2879efc2` — author subscription lifecycle tests;
- `61692310` — constrain subscription lifecycle inbox;
- `02879150` — add bounded AI tools Record deep links;
- `89284e30` — test bounded AI tools deep links;
- `08fe3353` — prefill AI tools from bounded Record deep links.

Do not redo these next run.

## Completed in this run — monotonic / replay-safe subscription lifecycle

### Persisted lifecycle processing result

`worklog_subscription_lifecycle_events` now records a durable processing result:

- `PENDING`;
- `APPLIED`;
- `IGNORED_STALE`.

The lifecycle inbox continues to retain provider `occurred_at`, while AFTERTRACE processing/creation timestamps now use processing time. This keeps provider event time separate from when AFTERTRACE handled the webhook.

A newly received event is inserted once by `(provider, external_event_key)`, then atomically finalized as APPLIED or IGNORED_STALE according to whether it was allowed to mutate the current subscription state.

### ACTIVATE / RENEW cannot rewind a newer period

AI Pro period application now has monotonic guards before updating `worklog_user_subscriptions`:

- incoming event update time must not be older than the current subscription row update time;
- incoming `current_period_start` must not be older than the already-current period start.

A stale older activation/renewal therefore remains auditable in the lifecycle inbox as `IGNORED_STALE` but cannot rewind the active paid period.

The `SUBSCRIPTION_PERIOD` Grant insert now depends on the successfully applied subscription upsert rather than merely on event insertion. Therefore an ignored stale period cannot create an obsolete AI Grant.

### Scheduled cancellation is bound to the exact billing period

The normalized provider-neutral contract was tightened for cancel-at-period-end safety:

- a scheduled/future cancellation (`periodEnd != null`) must provide both the exact `periodStart` and `periodEnd` of that paid billing period;
- the period must be valid and the cancellation period end cannot already predate the provider event occurrence;
- PostgreSQL applies the scheduled cancellation only when `worklog_user_subscriptions.current_period_start` exactly matches that incoming `periodStart`;
- a delayed cancellation from a previous period is stored as `IGNORED_STALE` instead of shortening a newer renewal;
- an explicit immediate cancellation remains representable by `periodEnd = null` and does not require a scheduled period pair.

When an applicable cancellation shortens/ends the current paid period, the matching period Grant expiry remains aligned to the resulting subscription period end.

### Duplicate applied events can heal a failed SYSTEM notification

The repository now distinguishes duplicates that were originally:

- APPLIED;
- IGNORED_STALE.

For a duplicate previously APPLIED event, the repository reconstructs the original applied lifecycle facts. `SubscriptionLifecycleService` deliberately replays the deterministic SYSTEM notification call.

This is safe because the shared Notification Service has its own durable idempotency key. The retry path solves a failure mode where subscription/Grant persistence succeeds but the first notification write temporarily fails: a payment-provider webhook retry can now heal the missing notification without re-applying entitlement.

For duplicates of IGNORED_STALE events, `applied = null`; no notification is emitted.

### Subscription SYSTEM idempotency keys are period-aware

Lifecycle SYSTEM event keys now include the relevant billing period boundary:

- activation key includes `periodStart`;
- renewal key already includes `periodStart`;
- cancellation key includes the effective `periodEnd` (or `immediate`).

This keeps retries for one event idempotent while allowing a later legitimate activation/cancellation on another billing period of the same durable subscription row to create a distinct SYSTEM notification.

## Tests authored in this run

Updated/new focused tests cover:

- activation notification includes the billing period;
- duplicate IGNORED_STALE lifecycle event emits no notification;
- duplicate APPLIED lifecycle event replays the idempotent notification call;
- first-seen IGNORED_STALE event emits no notification;
- scheduled cancellation requires exact billing period start/end;
- immediate cancellation remains accepted without scheduled period end;
- subscription period SQL contains monotonic ordering guards;
- stale period Grant insertion is structurally blocked behind successful subscription upsert;
- scheduled cancellation SQL matches current `periodStart`;
- activation/renew/cancel SYSTEM keys are period-aware and retry-stable.

All tests above are **AUTHORED / NOT RUN** because an executable checkout is still unavailable.

## Files changed in this run

- `apps/api/src/db/schema-worklog-subscription-lifecycle.ts`;
- `apps/api/src/worklog/subscription-lifecycle.ts`;
- `apps/api/src/worklog/drizzle-subscription-lifecycle.ts`;
- `apps/api/src/worklog/subscription-lifecycle-notifications.ts`;
- `apps/api/src/worklog/system-notification-events.ts`;
- `apps/api/src/worklog/subscription-lifecycle.test.ts`;
- `apps/api/src/worklog/subscription-lifecycle-ordering.test.ts`;
- `apps/api/src/worklog/system-notification-events.test.ts`;
- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Development commits authored in this run

All successful development commits contain `[skip ci]`:

- `633d38a1` — harden subscription lifecycle replay semantics;
- `5bf15ee1` — persist subscription lifecycle processing result;
- `ab489b2a` — ignore stale subscription lifecycle events;
- `561890af` — make lifecycle SYSTEM notification keys period-aware;
- `ca9e61ec` — scope subscription SYSTEM idempotency by period;
- `de2920fd` — test lifecycle replay and stale event behavior;
- `b41c9859` — guard monotonic subscription lifecycle SQL;
- `5bd4203a` — bind scheduled cancellation to billing period;
- `aff5eb89` — reject cross-period delayed cancellations;
- `add12124` — test scheduled cancel period binding;
- `874fb668` — guard cross-period cancellation SQL;
- `41795208` — test period-aware subscription SYSTEM keys;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN this run

- lifecycle `processing_result` target schema — **AUTHORED / NOT RUN**;
- monotonic ACTIVATE/RENEW SQL — **AUTHORED / NOT RUN**;
- stale-period Grant prevention — **AUTHORED / NOT RUN**;
- exact-period scheduled cancellation SQL — **AUTHORED / NOT RUN**;
- lifecycle notification retry healing — **AUTHORED / NOT RUN**;
- period-aware SYSTEM notification keys — **AUTHORED / NOT RUN**;
- `subscription-lifecycle.test.ts` updated cases — **AUTHORED / NOT RUN**;
- `subscription-lifecycle-ordering.test.ts` — **AUTHORED / NOT RUN**;
- `system-notification-events.test.ts` — **AUTHORED / NOT RUN**;
- previously authored AI-tools bounded deep-link tests — **AUTHORED / NOT RUN**.

### Executable verification actually attempted this run

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found under available `/mnt/data` or `/home/oai` paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- focused/full Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- lifecycle duplicate/out-of-order/concurrency PostgreSQL smoke — **NOT RUN**;
- exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Related Records SQL/ranking smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini text/image/audio/file/search/summary/rewrite provider smoke — **NOT RUN**;
- Chrome unpacked-extension smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- Push/Cron runtime smoke — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout is still unavailable. Accumulated TypeScript/React/SQL/extension code has not compiled or executed; this remains the dominant project risk.
2. Canonical `drizzle/0000` is behind the target schema and now must include `worklog_subscription_lifecycle_events.processing_result` plus all other accepted target schema changes before clean DB validation.
3. Lifecycle SQL has not executed against PostgreSQL. The first DB pass must explicitly test duplicate webhook retry, reversed renewal arrival order, stale prior-period cancellation, simultaneous renewal attempts and immediate cancellation.
4. The notification retry-healing path relies on the already-authored Notification Service idempotency boundary and still needs real DB/runtime verification.
5. No payment provider transport/webhook adapter is enabled. `CHECKOUT_ENABLED=false` remains correct. A chosen provider adapter must verify webhook authenticity before translating into the normalized lifecycle contract, and scheduled cancellations must supply the exact provider billing-period start/end.
6. Atomic provider-cost hold still needs real PostgreSQL concurrency smoke.
7. Google/LINE/Apple OAuth, Gemini operations, Chrome Extension and Push/Cron still need runtime/browser/provider smoke.
8. Main Worklog Record cards still do not expose final one-click Related/Rewrite buttons. The safe deep-link builder/parser and AiToolsRoot prefill are ready; avoid a broad 32KB WorklogRoot rewrite until compile validation is available or extract a small component safely.
9. The bounded Extension session remains a signed AFTERTRACE bearer session with seven-day TTL, not a separately revocable per-device credential. This is acceptable for current V1 source target but should be revisited only if real usage demonstrates a need.
10. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are proven and executable validation succeeds.

## Exact next run plan

1. If an executable checkout becomes available, **stop feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/extension-session/subscription-lifecycle/entitlement/provider-cost/media/search/related/summary/rewrite/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL DB;
   - run lifecycle duplicate/out-of-order/stale-cancel/concurrency smoke;
   - run Related Records SQL smoke and exact-Grant/provider-cost concurrency smoke;
   - Dev Google/LINE/Apple + Gemini provider smoke;
   - Chrome unpacked handoff -> Source -> manual/page/selection -> screenshot AI smoke;
   - Push/Cron browser/runtime smoke.
2. If executable checkout remains unavailable, do only bounded finishing work:
   - add the final compact Worklog Record-card -> `/ai-tools` Related/Rewrite actions only if it can be done by extracting/safely replacing a small component rather than broadly rewriting WorklogRoot;
   - inspect target-independent retired LINE/ONE_TIME/GROUP-funding entry points only where replacement dependencies are already clearly complete;
   - do not add more major V1 AI/product features.
3. Keep checkout/payment transport disabled until a real provider is selected, webhook authenticity is implemented and this provider-neutral lifecycle boundary passes PostgreSQL/runtime validation.

## Current estimated remaining development time

Approximately **2.25–6.5 focused development hours** remain for the accepted V1 source/runtime scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **2.25–5h**;
- real OAuth/Gemini/Chrome/Push/lifecycle runtime smoke and polish: **0.75–1.75h**;
- final Record-card AI action polish + safe legacy cleanup: **0.25–1h**.

Ranges overlap. The largest uncertainty remains the first real compile/test + clean PostgreSQL baseline pass. Major V1 feature scope is predominantly SOURCE-AUTHORED, not runtime verified.
