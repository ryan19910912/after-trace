# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 provider-neutral screenshot/image AI capture authored end-to-end; executable/runtime verification still blocked

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

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
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension explicit Web session handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit visible-tab screenshot capture.

## Completed in this run

### Provider-neutral image capture service

Added `AiMediaCaptureService` instead of extending retired LINE ingestion behavior.

Image request flow is now structurally:

`authenticated AFTERTRACE client -> Source authorization / AiEntitlementService -> AI media capability -> runtime pricing -> conservative point + provider-cost reservation hold -> Gemini -> durable IMAGE Record -> actual usage/cost settlement`

Rules implemented:

- accepted MIME: PNG / JPEG / WebP;
- max inline image size: 5 MB;
- provider work is impossible before Source/entitlement admission;
- FREE users require remaining one-time FREE trial points;
- AI Pro uses the same monthly points, per-request cap and actual provider-cost hard cap;
- provider-cost reservation hold is included before provider execution;
- provider failure before a response releases the reservation;
- successful provider calls are settled even if later Record persistence fails, so provider usage cannot disappear from accounting;
- actual image modality usage is costed via the existing immutable pricing snapshot path;
- original screenshot/image bytes are not durably stored in V1;
- only provider-derived durable text plus bounded metadata is stored as an `IMAGE` Record;
- no provider API key exists in the extension.

### Authenticated image API

`POST /api/v1/ai/capture/image` is now part of the existing AI capture boundary.

The API:

- accepts exact Web origin or canonical `chrome-extension://<id>` product origin using the existing bounded product-client-origin helper;
- still requires a valid AFTERTRACE first-party bearer session;
- resolves the provider-neutral user before AI work;
- validates MIME/base64/decoded byte length before calling the service;
- accepts optional bounded Chrome page `captureContext` through the existing strict parser;
- maps exhausted/not-entitled/provider-cost/point-cap decisions without interrupting FREE manual product capability;
- keeps deterministic AI-limit SYSTEM notification behavior for durable AI Pro hard-limit states;
- returns operator-disabled media as a product-level blocked response rather than treating it as an upstream provider outage.

The route helper no longer carries temporary `any` typing.

### Chrome Extension explicit screenshot AI action

The extension now separates local capture from provider submission:

1. user explicitly presses `擷取可見畫面`;
2. Chrome captures only the visible tab/viewport and shows local preview;
3. only after the user explicitly presses `用 AI 整理截圖並儲存` is the image sent to AFTERTRACE;
4. selected Source/group is included and re-authorized by backend;
5. optional page title/URL context follows the existing explicit toggle;
6. success creates the shared AFTERTRACE IMAGE Record;
7. exhausted FREE trial/AI Pro limits leave manual FREE features usable and direct the user toward the full Web subscription surface.

There is no automatic screenshot, continuous screen monitoring, full-page scraping, browsing-history capture or direct provider call.

### AI media operator capability

AI Pro commercial configuration now has a real `aiMediaIngestion` capability switch.

- stored in existing `worklog_subscription_plans.capabilities`;
- Admin API reads/writes it while keeping V1 price fixed at NT$99;
- Admin Web `/commercial` exposes `啟用圖片／截圖 AI`;
- the switch applies to AI Pro and eligible FREE trial users because trial access follows currently enabled AI Pro capabilities;
- service checks the capability after user/Source entitlement and before runtime/reservation/provider work;
- disabled media fails closed while manual Record functionality is unaffected.

Existing plans with no explicit media flag default to enabled until Admin writes the explicit setting, avoiding an accidental prelaunch disable caused solely by older config shape.

### Attachment provider neutralization

The shared Gemini attachment normalizer no longer tells the model it is processing a LINE attachment. Its system prompt now describes an explicitly provided AFTERTRACE attachment, so the shared analyzer can be safely reused from Web/PWA/Chrome without preserving LINE product semantics.

## Files changed in this run

### API / AI runtime

- `apps/api/src/worklog/ai-media-capture.ts`;
- `apps/api/src/worklog/drizzle-ai-media-capture.ts`;
- `apps/api/src/worklog/ai-media-capture.test.ts`;
- `apps/api/src/worklog/ai-text-capture-routes.ts`;
- `apps/api/src/worklog/gemini-attachment-normalizer.ts`.

### Commercial/Admin backend

- `apps/api/src/worklog/commercial-config.ts`;
- `apps/api/src/worklog/drizzle-commercial-config.ts`;
- `apps/api/src/admin/commercial-config-routes.ts`.

### Admin Web

- `apps/admin/src/commercial-api.ts`;
- `apps/admin/src/AdminCommercialPage.tsx`.

### Chrome Extension

- `apps/extension/popup.html`;
- `apps/extension/screenshot-ai.js`.

### Docs

- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Commits in this run

All successful development commits contain `[skip ci]`:

- `0c775530` — provider-neutral AI image capture service;
- `80cfb788` — shared IMAGE Record persistence;
- `d4c860bb` — authenticated bounded image API;
- `bc9032ca` — explicit screenshot AI submit action;
- `68b7f81f` — screenshot AI client loading;
- `8d9e3b4a` — Extension screenshot -> shared AI backend;
- `7680413a` — screenshot entitlement/accounting tests;
- `a0f3d37e` — AI Pro media capability config shape;
- `7a88301f` — durable media capability persistence;
- `5c1c399e` — Admin media capability request boundary;
- `1959bfdd` — enforce capability before provider work;
- `39464ead` — read media capability from AI Pro template;
- `b3623130` — media capability gate tests;
- `14e5639c` — Admin client media toggle support;
- `3a8f5ce4` — Admin media capability UI;
- `35686ce5` — shared AI capture route typing/status hardening;
- `5af9e78f` — provider-neutral attachment prompt;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- AI media entitlement blocks before provider;
- operator-disabled AI media blocks before runtime/reservation/provider;
- FREE trial image flow reserves provider-cost hold and settles actual image modality usage;
- AI Pro provider-cost hard cap blocks concurrent/new image work before provider;
- Extension visible screenshot -> authenticated `/api/v1/ai/capture/image` -> IMAGE Record;
- existing bounded capture-context tests;
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
- Gemini real text/image provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so accumulated TypeScript/React/SQL/extension code has still not compiled or executed. This is the dominant risk.
2. Canonical `drizzle/0000` remains behind the target schema (including provider-neutral identity/notifications/tasks/commercial/cost-hold/capture_context) and must be regenerated before clean DB validation.
3. Atomic provider-cost hold still requires a real PostgreSQL concurrent-reservation smoke test.
4. Real Google/LINE/Apple OAuth and Gemini text/image configuration have not been runtime tested.
5. Extension handoff/Source/manual/page/screenshot flows require Chrome unpacked-extension smoke.
6. The screenshot AI helper clears the screenshot preview after successful submit, but the older popup module still has its private preview-state variable; this can cause stale status wording after a later manual text save in the same popup session. It does not cause a second provider submission because the AI helper reads the cleared image preview. Polish this during Chrome smoke/refactor.
7. Payment provider transport remains disabled (`CHECKOUT_ENABLED=false`). Provider-neutral activation/renewal/cancellation + idempotent SYSTEM lifecycle still needs final transport semantics/provider choice; do not invent a provider-specific checkout.
8. Provider-backed generic audio/file/PDF product endpoints and natural-language search/related/time-range summary/explicit rewrite remain pending.
9. Push/Cron/Task behavior is authored but still requires real browser/provider/runtime smoke.
10. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are fully replaced and executable validation succeeds.

## Exact next run plan

1. If an executable checkout becomes available, **stop feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/entitlement/provider-cost/media/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL database;
   - concurrent exact-Grant/provider-cost-hold smoke;
   - Dev Google/LINE/Apple + Gemini text/image smoke;
   - Chrome unpacked handoff -> Source -> manual/page -> screenshot AI smoke.
2. If executable checkout remains unavailable, continue only bounded missing V1 product work rather than more broad auditing:
   - generalize provider-neutral media capture from IMAGE to explicit AUDIO + supported FILE/PDF endpoints using the same entitlement/accounting service;
   - implement bounded natural-language search interpretation with deterministic PostgreSQL retrieval;
   - then related Records, time-range summary and explicit rewrite proposal/accept flow;
   - complete provider-neutral subscription lifecycle boundary without choosing an unapproved payment provider.
3. Once executable validation is possible and target dependencies are proven, regenerate baseline/rebuild disposable Dev/Prod and remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **4–11 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **3–6h**;
- real OAuth/Gemini/Chrome/Push runtime smoke and polish: **0.75–1.75h**;
- provider-neutral AUDIO/FILE/PDF + search/related/summary/rewrite: **1.5–3.5h**;
- provider-neutral subscription lifecycle + deterministic SYSTEM callers: **0.75–2h**;
- final legacy cleanup: **0.5–1.5h**.

Ranges overlap. The largest uncertainty is still the first real compile/test + clean PostgreSQL baseline pass; the new screenshot/image path is **AUTHORED**, not runtime-verified.
