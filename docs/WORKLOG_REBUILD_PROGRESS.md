# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 provider-neutral AUDIO/FILE/PDF + natural-language search already authored on branch; Related Records backend/Admin authored; executable/runtime verification still blocked

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real customer/durable production data exists. This permission expires once real durable production data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no extra paid tiers.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are internal AI points, not TWD; they do not refresh monthly and issued grants are never resized retroactively.
- AI entitlement belongs to the requesting AFTERTRACE account; GROUP membership only authorizes Source data.
- AI Pro retains monthly resource/point cap, provider-cost hard cap, optional per-request cap and operator capability toggles.
- Every provider-backed request must pass server-side Source authorization + unified entitlement + reservation/provider-cost hold before provider execution, then settle actual provider usage/cost.
- A paid feature may use deterministic PostgreSQL logic without a provider call; such an operation must not fabricate provider usage or consume AI points merely because it is an AI Pro product surface.

## Accepted target foundation — do not redo

- provider-neutral Google / LINE / Apple identities;
- immutable opaque `public_account_id`, Web/PWA display+copy and Admin exact lookup;
- provider availability endpoint and provider-neutral login chooser;
- native AFTERTRACE groups/invites independent from LINE GROUP membership;
- free manual Record CRUD/search, nullable `occurred_at`, provider-free browser speech-to-text;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH;
- Admin announcements, Web Push subscription/preferences/delivery, one shared ~5 minute scheduler;
- native Task backend + Web/PWA task surface;
- FREE one-time AI trial config + provider-neutral onboarding issuance;
- V1-only FREE + AI_PRO subscription surface;
- unified `AiEntitlementService`, exact selected Grant admission, `EntitledAiPointLedgerService`, reservation/settlement and provider-cost accounting;
- atomic AI Pro concurrent provider-cost reservation hold;
- provider-backed AI text capture backend + PWA manual/AI capture UI;
- provider-neutral bounded IMAGE/AUDIO/FILE/PDF backend capture routes using shared entitlement/accounting;
- bounded natural-language search interpretation with deterministic PostgreSQL retrieval and Web `/ai-search` surface;
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension explicit Web session handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit visible-tab screenshot AI capture.

## Branch reconciliation performed this run

The previous durable checkpoint ended at commit `ae4527da`, but the actual branch had already advanced to `be1c2ed` before this run began: **26 commits ahead, 0 behind**.

Those already-present branch changes were accepted as the effective starting implementation rather than re-authored. They include:

- generalization of `AiMediaCaptureService` from IMAGE to bounded AUDIO + supported FILE/PDF;
- durable AUDIO/FILE Record persistence;
- authenticated `/api/v1/ai/capture/audio` and `/file` routes;
- media route/service tests;
- natural-language search service/provider/repository with bounded interpretation and PostgreSQL retrieval;
- Web `/ai-search` customer surface/login return wiring;
- Admin `aiNaturalSearch` capability configuration and related tests.

Do not redo these features on the next run. They are **AUTHORED**, not runtime verified.

## Completed in this run

### Entitled deterministic Related Records service

Added `AiRelatedRecordsService` as a bounded retrieval/ranking feature rather than a generic RAG/vector graph.

Current flow:

`authenticated user -> Source/user AI entitlement -> aiRelatedRecords capability -> exact target Record inside authorized Source -> deterministic PostgreSQL ranking -> bounded related Record list`

Security/accounting rules:

- entitlement/Source authorization is evaluated before target Record existence is queried, preventing cross-Source existence probing;
- the target and candidates must be ACTIVE Records in the exact same Source;
- exhausted/no-trial FREE users and non-entitled users are blocked from the paid Related Records surface while all manual FREE product features remain unaffected;
- eligible FREE trial / AI Pro users may use Related Records while the capability is enabled;
- V1 Related Records does **not** call a provider, so it deliberately does not reserve points, decrement the FREE trial, or create fake provider-cost usage events;
- no durable generic RecordRelation table was introduced.

### PostgreSQL Related Records ranking

`DrizzleAiRelatedRecordsRepository` implements a deterministic bounded rank using existing Record metadata:

- exact normalized title match receives the strongest fixed boost;
- overlap with target title/search terms across candidate content/title/search terms/extracted metadata adds score;
- equal scalar extracted-metadata key/value pairs add score;
- exact raw-text equality adds a small duplicate-like boost;
- tie-breaking prefers closer event/create time, then recent Record/id;
- zero-score candidates are excluded;
- result limit is bounded to 1..20.

This remains retrieval/ranking only. It does not create or mutate relationships.

### Authenticated Related Records API

Added `POST /api/v1/ai/capture/related` under the existing authenticated AI product boundary.

Input:

- `sourceId`;
- `recordId`;
- optional `limit`, default 8, max 20.

Response behavior:

- `200` bounded results;
- `403` Source not authorized;
- `404` target Record not found, but only after entitlement/Source authorization passes;
- `409` entitlement/capability disabled state;
- retrieval failure remains a server failure rather than silently returning an empty list.

No provider/ledger dependency is constructed for this deterministic operation.

### Related Records operator capability

AI Pro config now includes `aiRelatedRecords` in the existing `worklog_subscription_plans.capabilities` JSONB contract.

- missing historical capability defaults to enabled, matching current prelaunch compatibility behavior;
- Admin API reads/writes the flag without changing the fixed V1 NT$99 price;
- the same capability governs eligible FREE-trial access because the trial mirrors currently enabled AI Pro capabilities;
- Admin Web `/commercial` exposes `啟用相關紀錄推薦` and clearly states that current ranking is PostgreSQL deterministic rather than provider-backed.

### Focused tests authored

New/updated tests cover:

- Source/entitlement before Related target existence;
- operator-disabled Related Records before target query;
- eligible FREE trial deterministic Related results;
- target-not-found only after authorization;
- Related Records capability defaults/config shape;
- Admin API payload preserves `aiRelatedRecords`;
- authenticated route 403/409 boundaries.

All are **AUTHORED / NOT RUN** because executable checkout is unavailable.

## Files changed in this run

### API / Related Records

- `apps/api/src/worklog/ai-related-records.ts`;
- `apps/api/src/worklog/drizzle-ai-related-records.ts`;
- `apps/api/src/worklog/ai-related-records.test.ts`;
- `apps/api/src/worklog/ai-text-capture-routes.ts`;
- `apps/api/src/worklog/ai-text-capture-routes.test.ts`.

### Commercial/Admin backend

- `apps/api/src/worklog/commercial-config.ts`;
- `apps/api/src/worklog/drizzle-commercial-config.ts`;
- `apps/api/src/worklog/commercial-config.test.ts`;
- `apps/api/src/admin/commercial-config-routes.ts`.

### Admin Web

- `apps/admin/src/commercial-api.ts`;
- `apps/admin/src/commercial-api.test.ts`;
- `apps/admin/src/AdminCommercialPage.tsx`.

### Docs

- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Commits authored in this run

All successful development commits contain `[skip ci]`:

- `30b9362a` — deterministic AI Related Records service;
- `e928466a` — PostgreSQL Related Record ranking;
- `b902e074` — Related Records entitlement tests;
- `dbff4bf9` — Related Records commercial capability shape;
- `5dc66da7` — persist Related Records capability;
- `61c396f6` — Admin request boundary for Related Records capability;
- `5bd4dfb5` — authenticated Related Records API;
- `66e6b79f` — Admin client Related Records capability;
- `d15e0552` — Admin Related Records toggle UI;
- `dbc7ecdf` — Admin capability payload test;
- `770e2816` — commercial capability regression tests;
- `c099588a` — Related Records route boundary tests;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- provider-neutral AUDIO capture entitlement/reservation/provider-cost/settlement;
- provider-neutral supported FILE/PDF capture and MIME/base64 limits;
- natural-language search interpretation + deterministic PostgreSQL retrieval;
- Web `/ai-search` login/search surface;
- Related Records Source/entitlement/capability/ranking/API boundaries;
- Related Records Admin capability payload/UI wiring;
- screenshot/image entitlement/accounting/Extension flow;
- prior auth/provider/Apple/AI entitlement/provider-cost tests;
- Task/Push/Notification focused tests.

### Executable verification actually attempted this run

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- focused Vitest — **NOT RUN**;
- full API/Web/Admin Vitest — **NOT RUN**;
- Chrome unpacked-extension smoke — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- PostgreSQL exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini real text/image/audio/file/search provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so accumulated TypeScript/React/SQL/extension code has still not compiled or executed. This is the dominant risk and feature expansion should remain bounded.
2. Canonical `drizzle/0000` remains behind the target schema and must be regenerated before clean DB validation.
3. Atomic provider-cost hold still requires a real PostgreSQL concurrent-reservation smoke test.
4. Real Google/LINE/Apple OAuth and Gemini text/image/audio/file/search configuration have not been runtime tested.
5. Extension handoff/Source/manual/page/screenshot flows require Chrome unpacked-extension smoke. The known stale popup preview-state wording should be polished during that smoke/refactor.
6. Related Records SQL/ranking is authored but has not been executed against PostgreSQL; verify JSONB lateral queries, score ordering and performance during the first DB validation pass.
7. Related Records currently has backend/Admin capability but no dedicated customer Record-detail UI entry yet. Add a compact action/panel rather than a large new workspace.
8. Payment provider transport remains disabled (`CHECKOUT_ENABLED=false`). Provider-neutral activation/renewal/cancellation + idempotent SYSTEM lifecycle still needs final transport semantics/provider choice; do not invent a provider-specific checkout.
9. Time-range summary and explicit AI rewrite proposal/accept flow remain pending provider-backed V1 operations.
10. Push/Cron/Task behavior is authored but still requires real browser/provider/runtime smoke.
11. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are fully replaced and executable validation succeeds.

## Exact next run plan

1. If an executable checkout becomes available, **stop feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/entitlement/provider-cost/media/search/related/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL database;
   - execute Related Records SQL smoke and exact-Grant/provider-cost-hold concurrency smoke;
   - Dev Google/LINE/Apple + Gemini text/image/audio/file/search smoke;
   - Chrome unpacked handoff -> Source -> manual/page -> screenshot AI smoke.
2. If executable checkout remains unavailable, keep development bounded:
   - add a compact customer Related Records action/panel reusing the new endpoint;
   - implement provider-backed **time-range summary** with Source-bounded deterministic Record retrieval before provider call and shared entitlement/reservation/cost accounting;
   - implement explicit **AI rewrite proposal -> user accept/cancel -> optimistic revision** flow;
   - complete provider-neutral subscription lifecycle boundary without choosing an unapproved payment provider.
3. Once executable validation is possible and target dependencies are proven, regenerate baseline/rebuild disposable Dev/Prod and remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **3.5–9 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **3–6h**;
- real OAuth/Gemini/Chrome/Push runtime smoke and polish: **0.75–1.75h**;
- Related Records customer UI + summary/rewrite: **1–2.5h**;
- provider-neutral subscription lifecycle + deterministic SYSTEM callers: **0.75–2h**;
- final legacy cleanup: **0.5–1.5h**.

Ranges overlap. The largest uncertainty remains the first real compile/test + clean PostgreSQL baseline pass. AUDIO/FILE/search/Related Records are **AUTHORED**, not runtime verified.
