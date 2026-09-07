# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including the Subscription, Account Identity, Support, Notification, and Extension policies requested by the current product contract. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 outbound Web Push transport + retry-safe delivery state machine source-authored; automatic runtime trigger and executable verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/baseline rebuilds are allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE is a complete manual product.
- Every newly eligible FREE AFTERTRACE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- The trial is not a TWD balance, is not hard-coded, does not refresh monthly, and does not retroactively resize already-issued trials.
- Trial/AI_PRO provider calls must use the existing reservation/settlement/cost-audit path where it cleanly fits.
- When FREE trial points reach zero, provider-backed AI stops while manual features continue and UI offers AI Pro.
- AI Pro keeps internal monthly point/resource caps plus an operator-configured provider-cost hard cap; a planning value around NT$30/month is configuration only, never customer cash balance.

## Accepted source-authored foundation from prior checkpoints

- Provider-neutral identity model for Google / LINE / Apple; Google + LINE implementation priority, Apple next if sequencing is needed.
- Immutable opaque/non-sequential `public_account_id` distinct from internal DB id; Admin exact lookup foundation.
- No silent merge by provider email/id/name heuristics.
- Current LINE Login callback provisions through provider-neutral account identity.
- Native AFTERTRACE GROUP membership/invites independent from LINE group membership.
- Free manual Record CRUD/search with nullable occurred/event date and content-only create.
- Capture-first PWA/browser speech path without AFTERTRACE provider AI.
- Durable notification categories exactly `ANNOUNCEMENT | SYSTEM | TASK`, with independent `IN_APP | PUSH` channels.
- Durable notification center/unread/read_at.
- Admin ANNOUNCEMENT backend + frontend for ALL/FREE/AI/SPECIFIC, preview, draft/send-now/scheduled/cancel and delivery inspection.
- SYSTEM notification idempotency primitive.
- Authenticated Web/PWA chrome with bell/unread, display name, `帳號 ID`, one-tap copy.
- Browser/PWA push subscription storage, category preferences, explicit `開啟通知`, no auto permission prompt, installed-iOS/iPadOS guidance, and Service Worker push/click handling.
- Chrome extension scaffold remains committed to the shared account/Source/Record/AI entitlement model; no extension-only durable Record store.

## This run — outbound Web Push delivery foundation

This run continued the exact no-executable-checkout path from the prior checkpoint. It did not redo a broad static audit.

### Worker-native encrypted Web Push transport

New `apps/api/src/worklog/web-push-transport.ts` implements the server transport using only Web Crypto + `fetch` so Cloudflare Workers do not depend on Node-only `web-push` crypto/http APIs.

Source-authored behavior:

- RFC 8291-style ECDH/HKDF/AES-128-GCM payload encryption for the browser subscription `p256dh` + `auth` keys;
- RFC 8292-style ES256 VAPID JWT authorization;
- VAPID public key is the browser `applicationServerKey`; private key remains server-only;
- VAPID subject must be `mailto:` or HTTPS;
- endpoint must be HTTPS with no embedded credentials;
- title/body/deep-link payload is bounded before encryption;
- HTTP request uses `aes128gcm`, TTL, urgency, and a bounded per-notification Topic;
- transport returns HTTP success/status only; durable recipient state is handled separately.

No third-party Web Push package was added, so no lockfile/dependency drift was introduced.

### Retry-safe durable delivery state

`apps/api/src/db/schema-worklog-notification.ts` now adds target-schema delivery fields to recipient rows:

- `push_attempt_count`;
- `push_next_attempt_at`;
- existing `push_attempted_at`, `push_sent_at`, `push_failure_code`, `push_status` remain authoritative.

The attempt counter is also a compare-and-set generation. A worker increments it only when claiming a PENDING recipient; completion/reschedule updates must match the same attempt generation so a stale worker cannot overwrite a newer retry result.

The current canonical `drizzle/0000` has **not** been regenerated yet, so this target schema is source-authored only and must not be treated as deployed.

### Bounded push delivery orchestrator

New `apps/api/src/worklog/push-delivery.ts` implements shared delivery semantics:

- bounded batch size;
- category preference is checked independently for `ANNOUNCEMENT`, `SYSTEM`, `TASK`;
- disabled preference -> `SKIPPED` without touching durable IN_APP history;
- no active subscription -> `SKIPPED`;
- any successful installation delivery -> recipient `SENT`;
- 404/410-equivalent delivery -> endpoint is treated as permanently invalid and revoked;
- 408/425/429/5xx/network failures are transient;
- transient failures remain `PENDING` with bounded retry time rather than becoming false success;
- retry budget is bounded; exhaustion -> `FAILED`;
- default retry delays are 5m, 15m, 30m, 60m, 180m;
- success updates subscription `last_success_at`;
- durable IN_APP notification remains available regardless of PUSH result.

### PostgreSQL claim/completion repository

New `apps/api/src/worklog/drizzle-push-delivery.ts` provides the persistence side:

- claims only `PENDING` recipients whose notification is `SENT` and `push_enabled = TRUE`;
- respects `push_next_attempt_at`;
- uses `FOR UPDATE ... SKIP LOCKED` plus a stale-claim lease;
- increments `push_attempt_count` on claim;
- loads active non-revoked subscriptions and per-category preferences;
- completion/reschedule uses recipient id + exact attempt count compare-and-set;
- permanent-invalid subscription revocation is soft/durable;
- successful subscription delivery updates `last_success_at`.

This is designed so the future single shared scheduled Worker can safely call the same bounded dispatcher without one-Cron-per-task behavior.

### Runtime configuration foundation

New `apps/api/src/worklog/push-runtime.ts` centralizes:

- `WEB_PUSH_PUBLIC_KEY`;
- `WEB_PUSH_PRIVATE_KEY`;
- `WEB_PUSH_SUBJECT`;
- construction of `DrizzlePushDeliveryRepository + WorkerWebPushTransport + PushDeliveryService`;
- a reusable `deliverPendingPushBatch()` entry point for the upcoming shared scheduled handler/immediate dispatch hook.

`apps/api/src/worklog/notification-routes.ts` now reports `serverPushEnabled: true` and allows new subscription registration only when the complete VAPID server configuration is structurally present. A public key by itself no longer causes the Web/PWA UI to claim PUSH is operational.

`.env.example` documents all three VAPID values and also corrects the LINE OA comments to the current support-only boundary.

Important deployment blocker: `scripts/deploy-workers.mjs` still does not include the three new Web Push bindings in its selected secret list. A source update was attempted in this run but was not committed. Do not assume `.env.dev/.env.prod` VAPID values are uploaded by the existing deployment script yet.

### Automatic dispatch boundary still pending

The encrypted sender and durable delivery state machine now exist, but `deliverPendingPushBatch()` is **not yet automatically invoked** by `worker.ts` or a Worker `scheduled()` handler.

Therefore actual device PUSH is still **NOT RUNTIME VERIFIED** and immediate Admin PUSH should still be treated as delivery intent until the next runtime-trigger batch is wired and tested.

The next shared scheduled handler should invoke this same dispatcher rather than invent a second push path.

## Files changed this run

- `apps/api/src/worklog/web-push-transport.ts` — new Web Crypto/fetch encrypted Web Push sender;
- `apps/api/src/db/schema-worklog-notification.ts` — retry-safe recipient delivery state;
- `apps/api/src/worklog/push-delivery.ts` — bounded preference-aware delivery state machine;
- `apps/api/src/worklog/drizzle-push-delivery.ts` — PostgreSQL claim/CAS completion/retry/revocation persistence;
- `apps/api/src/worklog/push-runtime.ts` — VAPID runtime config + reusable pending batch entry point;
- `apps/api/src/worklog/push-delivery.test.ts` — delivery orchestration tests authored;
- `apps/api/src/worklog/web-push-transport.test.ts` — encrypted request/VAPID tests authored;
- `apps/api/src/worklog/notification-routes.ts` — complete VAPID config required before advertising/registering PUSH;
- `apps/api/src/worklog/notification-routes.test.ts` — route tests updated for complete VAPID config;
- `.env.example` — VAPID config + support-only LINE OA comments;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All committed development changes contain `[skip ci]`:

- `69ca727b` — add Worker-native Web Push transport;
- `15a4d168` — add retry-safe push delivery state;
- `4ea0df58` — add idempotent push delivery orchestration;
- `269cb426` — persist bounded push delivery claims;
- `1deaef48` — wire Web Push delivery runtime;
- `15995e35` — author push delivery state tests;
- `53e63ea2` — author Worker Web Push transport tests;
- `0976993f` — document Web Push VAPID runtime config;
- `4b01f04d` — update push routes for complete VAPID config;
- this checkpoint commit follows the list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/push-delivery.test.ts` — **AUTHORED / NOT RUN**;
- `apps/api/src/worklog/web-push-transport.test.ts` — **AUTHORED / NOT RUN**;
- push route config cases in `apps/api/src/worklog/notification-routes.test.ts` — **AUTHORED (updated) / NOT RUN**.

### Executable verification

- executable AFTERTRACE checkout discovery — **FAIL** (no mounted checkout found);
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- push delivery focused Vitest — **NOT RUN**;
- Web Push transport focused Vitest — **NOT RUN**;
- notification route focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- PostgreSQL `FOR UPDATE SKIP LOCKED`/CAS/retry smoke — **NOT RUN**;
- real FCM/Apple/Firefox push endpoint smoke — **NOT RUN**;
- Service Worker device receipt/click smoke — **NOT RUN**;
- iOS/iPadOS installed Home Screen PWA push — **NOT RUN**;
- Web/Admin typecheck/tests/build — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so the new Web Crypto TypeScript and PostgreSQL SQL have not compiled/executed.
2. Canonical `drizzle/0000` is behind the current target schema, including push attempt/retry columns.
3. Automatic outbound PUSH invocation is not wired yet; `deliverPendingPushBatch()` exists but is not called by `worker.ts`/scheduled handler.
4. Manual deploy secret selection still does not upload `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`; fix before any PUSH deployment.
5. Real Web Push protocol compatibility (FCM/Apple/Firefox, including VAPID signature and RFC8291 payload framing) needs browser/provider smoke even if authored unit tests later pass.
6. Native Task/reminder persistence/runtime is still incomplete.
7. Scheduled ANNOUNCEMENT dispatch is still not connected to one global Worker `scheduled()` handler.
8. SYSTEM notification primitive still needs deterministic payment/subscription/trial/AI-limit callers.
9. FREE one-time AI trial issuance/runtime is still not implemented to the current contract.
10. Google Login and Apple Login callbacks remain incomplete; LINE Login must stay provider-neutral and must not regain legacy product authority.
11. AI Pro entitlement/provider-cost-hard-cap runtime remains incomplete.
12. Extension real auth handoff/Source picker/durable Record persistence remains incomplete.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix:
   - API typecheck;
   - `web-push-transport.test.ts`;
   - `push-delivery.test.ts`;
   - push cases in `notification-routes.test.ts`;
   - API Worker dry-run build;
   - then Web/Admin focused validation and PostgreSQL delivery smoke.
2. If executable checkout is still unavailable, finish the notification runtime trigger as one bounded batch:
   - add the three Web Push secrets to the manual deploy secret selection;
   - wire immediate successfully-dispatched ANNOUNCEMENT to enqueue/run a bounded `deliverPendingPushBatch()` through `executionContext.waitUntil` without blocking the Admin HTTP response;
   - implement native durable Task/reminder persistence/service only for user-confirmed reminders;
   - add exactly one Worker `scheduled()` handler at about five-minute cadence;
   - in that single handler, bounded-dispatch due scheduled ANNOUNCEMENTs, due TASK reminders, then pending PUSH recipients;
   - keep all operations idempotent and bounded; never one Cron per task; do not add Queue unless actual fan-out/volume warrants it;
   - author tests, but do not claim PASS without execution.
3. Wire deterministic SYSTEM callers for payment/subscription/FREE-trial/AI-limit events.
4. Implement FREE one-time AI trial Admin config + idempotent account issuance + reservation/settlement/cost accounting.
5. Complete Google + LINE priority auth path and Apple next, preserving provider-neutral account identity/no silent merge.
6. Complete AI Pro entitlement/monthly point-resource caps/provider-cost hard cap.
7. Return to Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page context -> selected text -> quick voice -> screenshot/image AI entitlement -> permission/privacy/browser smoke/package.
8. Regenerate canonical baseline, rebuild disposable Dev/Prod when safe, then run runtime E2E and continue remaining Related Records/summary/rewrite/final legacy cleanup.

## Current estimated remaining development time

Approximately **33–64 focused development hours** remain.

Largest uncertainty remains the first real API/Web/Admin compile/test pass, PostgreSQL target-schema rebuild, Web Push provider/browser smoke, and Dev runtime E2E. After those execute, narrow this estimate again.
