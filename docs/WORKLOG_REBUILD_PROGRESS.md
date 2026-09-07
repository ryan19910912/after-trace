# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 legacy GROUP funding customer API retired as an explicit 410 tombstone; provider-neutral V1 target remains source-authored; executable/runtime verification still blocked

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
- There is no target GROUP AI funding owner / responsible-user concept.

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
- bounded `/ai-tools?sourceId=&recordId=&tool=related|rewrite` deep-link parser/prefill;
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension bounded session handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit screenshot/image AI path;
- provider-neutral normalized AI Pro subscription lifecycle core;
- monotonic/replay-safe subscription lifecycle with stale-event rejection and period-aware SYSTEM notification keys.

All above are **SOURCE-AUTHORED** unless separately marked runtime verified. Do not infer PASS from source presence.

## Starting point for this run

The durable checkpoint and actual branch were aligned at `42490a097fa7975eda315643162696c18ab70a05` when substantive work began. No hidden branch reconciliation was required this run.

Executable verification was retried before feature work and remained unavailable:

- repository checkout discovery under available `/mnt/data` and `/home/oai` — **FAIL**, no AFTERTRACE `.git` checkout found;
- `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`.

Because executable checkout remained unavailable, this run followed the checkpoint rule to avoid major feature expansion and performed only bounded legacy-surface retirement.

## Completed in this run — retire legacy GROUP funding product API

### `/api/v1/worklog/funding` is now an explicit migration tombstone

`apps/api/src/worklog/funding-routes.ts` previously exposed the old product model where:

- customer funding views were Source-scoped;
- GROUP had an AI 額度負責人 / funding-owner concept;
- the responsible user could inspect/manage Grant allocation against the GROUP.

That behavior conflicts with the accepted V1 contract, where AI entitlement is per AFTERTRACE user and GROUP membership only authorizes Source data.

The legacy route module has therefore been replaced with a minimal fail-closed router:

- every old funding path/method returns HTTP `410`;
- error code is `LEGACY_GROUP_FUNDING_DISABLED`;
- response points stale clients toward `/api/v1/subscription`;
- it performs no funding mutation, responsible-user assignment, Grant allocation query or legacy funding business logic;
- `Cache-Control: no-store` is retained;
- shared Grant/reservation/settlement/accounting infrastructure is intentionally **not** deleted because it is still the accepted implementation foundation for FREE trial and AI Pro accounting.

This is an isolation step, not broad schema cleanup. Legacy responsibility/funding tables/services may remain temporarily until executable target dependency validation succeeds.

### Focused tombstone tests authored

Added `apps/api/src/worklog/funding-routes.test.ts` covering:

- old personal funding surface returns `410` without requiring auth/database state;
- old GROUP responsible-user mutation path returns `410`;
- tombstone response remains non-cacheable and directs clients to the subscription surface.

These tests are **AUTHORED / NOT RUN**.

## Files changed in this run

- `apps/api/src/worklog/funding-routes.ts`;
- `apps/api/src/worklog/funding-routes.test.ts`;
- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Development commits authored in this run

All successful development commits contain `[skip ci]`:

- `3db95528` — retire legacy group funding endpoint;
- `78cfb1db` — test retired group funding surface;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN this run

- legacy funding API tombstone behavior — **AUTHORED / NOT RUN**;
- personal funding `410` regression — **AUTHORED / NOT RUN**;
- GROUP responsible-user mutation `410` regression — **AUTHORED / NOT RUN**.

### Previously authored and still NOT RUN

- provider-neutral identity/login/public account id;
- native group/invite authorization;
- FREE one-time AI trial issuance/idempotency;
- AI Pro entitlement/resource/provider-cost caps;
- provider-backed text/image/audio/file/PDF capture;
- natural-language search;
- Related Records SQL/ranking;
- time-range summary;
- AI rewrite proposal/confirm;
- notifications/PUSH/tasks/shared scheduler;
- Chrome Extension handoff/capture paths;
- provider-neutral subscription lifecycle and stale/out-of-order event hardening.

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
2. Canonical `drizzle/0000` is behind the target schema and must include the latest identity/group/notification/task/AI/lifecycle target state before clean DB validation.
3. Subscription lifecycle SQL has not executed against PostgreSQL. The first DB pass must explicitly test duplicate webhook retry, reversed renewal arrival order, stale prior-period cancellation, simultaneous renewal attempts and immediate cancellation.
4. Atomic provider-cost hold still needs real PostgreSQL concurrency smoke.
5. Google/LINE/Apple OAuth, Gemini operations, Chrome Extension and Push/Cron still need runtime/browser/provider smoke.
6. Worker routing still calls `configureWorklogRuntime(env)` before delegating to the now-retired funding tombstone because the old generic `/api/v1/worklog/*` block has not yet been structurally split. The funding endpoint can no longer mutate/query legacy funding data, but final target cleanup should move retired paths ahead of legacy runtime configuration or remove that legacy runtime entirely after compile validation.
7. `confirmation-routes.ts` still uses a legacy `session.lineUserId` resolution path even though its comment describes a PWA title-ambiguity surface. Current Web capture does not visibly depend on this route, but do not delete it solely from static inspection; first verify references/compile/runtime, then either migrate it to provider-neutral `resolveWebSessionUserId` if still required or retire it.
8. Main Worklog Record cards still do not expose final one-click Related/Rewrite buttons. The bounded deep-link builder/parser and AiToolsRoot prefill are ready; avoid a broad 32KB WorklogRoot replacement without executable validation.
9. No payment provider transport/webhook adapter is enabled. `CHECKOUT_ENABLED=false` remains correct. A chosen provider adapter must verify webhook authenticity before translating into the normalized lifecycle contract.
10. Retired LINE/ONE_TIME/GROUP-funding schema/service cleanup remains after target dependencies are proven and executable validation succeeds.

## Exact next run plan

1. If an executable checkout becomes available, **stop source feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/extension-session/subscription-lifecycle/entitlement/provider-cost/media/search/related/summary/rewrite/funding-tombstone/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL DB;
   - run lifecycle duplicate/out-of-order/stale-cancel/concurrency smoke;
   - run Related Records SQL smoke and exact-Grant/provider-cost concurrency smoke;
   - Dev Google/LINE/Apple + Gemini provider smoke;
   - Chrome unpacked handoff -> Source -> manual/page/selection -> screenshot AI smoke;
   - Push/Cron browser/runtime smoke.
2. If executable checkout remains unavailable, only bounded finishing work is allowed:
   - inspect `confirmation-routes.ts` references and retire/migrate it only if the target dependency is unambiguous;
   - isolate more clearly retired `/webhooks/line` / generic LINE worklog runtime entry points only where the replacement target is already complete and the change can be made without a risky broad rewrite;
   - do not add new major V1 AI/product features.
3. Keep checkout/payment transport disabled until a real provider is selected, webhook authenticity is implemented and the provider-neutral lifecycle boundary passes PostgreSQL/runtime validation.

## Current estimated remaining development time

Approximately **2–6 focused development hours** remain for the accepted V1 source/runtime scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **2–4.75h**;
- real OAuth/Gemini/Chrome/Push/lifecycle runtime smoke and polish: **0.75–1.75h**;
- final Record-card AI action + safe legacy isolation/cleanup: **0.25–0.75h**.

Ranges overlap. The largest uncertainty remains the first real compile/test + clean PostgreSQL baseline pass. Major V1 feature scope is predominantly SOURCE-AUTHORED, not runtime verified.
