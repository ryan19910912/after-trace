# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 bounded Chrome Extension session handoff hardened; major V1 feature scope mostly source-authored; executable/runtime verification still blocked

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real durable production data exists. This permission expires once real customer/durable production data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no extra paid tiers.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are internal AI points, not TWD; they do not refresh monthly and issued grants are never resized retroactively.
- AI entitlement belongs to the requesting AFTERTRACE account; GROUP membership only authorizes Source data.
- AI Pro retains monthly resource/point cap, provider-cost hard cap, optional per-request cap and operator capability toggles.
- Every provider-backed request must pass server-side Source authorization + unified entitlement + reservation/provider-cost hold before provider execution, then settle actual provider usage/cost.
- A deterministic AI Pro feature may use PostgreSQL logic without a provider call; such a call must not fabricate provider usage or consume AI points.

## Accepted target foundation — do not redo

Current branch already source-authors the following accepted V1 foundation:

- provider-neutral Google / LINE / Apple identities;
- immutable opaque `public_account_id`, Web/PWA display+copy and Admin exact lookup;
- provider-neutral login chooser and optional Apple availability/config behavior;
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
- bounded natural-language search interpretation + deterministic PostgreSQL retrieval + Web `/ai-search`;
- deterministic Related Records backend/Admin capability;
- provider-backed time-range summary with bounded Record-count + provider text envelope;
- explicit proposal-only AI rewrite + optimistic confirm flow;
- customer `/ai-tools` for Related Records, summary and rewrite;
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension explicit Web handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit visible-tab screenshot AI path.

All above are **SOURCE-AUTHORED** unless separately marked runtime verified. Do not infer PASS from source presence.

## This run — bounded Extension session hardening

This run stayed narrow and did not redo the already-authored extension feature set.

### Existing Extension flow confirmed

The actual branch already contained more extension work than the previous checkpoint implied:

- `manifest.json` has only the accepted bounded permissions plus Dev/Prod API host permissions;
- `externally_connectable` is restricted to the AFTERTRACE Dev/Prod Web origins;
- popup-generated extension connect requests use a Chrome extension id + random nonce;
- Web `/extension/connect` validates a 32-character Chrome extension id, bounded base64url nonce and rejects extra query parameters;
- background external-message handling validates the sender Web origin, environment-matched API origin and pending nonce;
- popup loads durable AFTERTRACE Source/group authorization through `/api/v1/worklog/surfaces`;
- quick text and explicit selected-text drafts persist through the existing manual Record API;
- optional page title/URL is bounded and persists to dedicated Record `capture_context`, not AI `extracted_metadata`;
- manual Extension capture remains provider-free;
- screenshot preview does not silently call provider AI.

### Web -> Extension handoff no longer copies the ordinary long Web session

New authenticated account endpoint:

- `POST /api/v1/account/extension-session`

The endpoint:

- requires the already-authenticated provider-neutral AFTERTRACE Web session;
- resolves durable AFTERTRACE `userId`;
- issues a new AFTERTRACE Web-session token with a fixed maximum TTL of **7 days** for explicit Extension handoff;
- returns only the AFTERTRACE session token and TTL; no Google/LINE/Apple credentials or provider identifiers are shared;
- remains the same AFTERTRACE account and reuses the same Source/Record APIs rather than creating extension-only identity/storage.

Account CORS now permits POST for this authenticated exchange.

### Web Extension connect flow uses the bounded session

`ExtensionConnectRoot.tsx` now:

1. validates the extension id + connect nonce through existing `safeLoginReturn()`;
2. calls `/api/v1/account/extension-session` with the current Web bearer session;
3. rejects any returned TTL above seven days;
4. computes explicit session expiry;
5. only then sends the shorter-lived AFTERTRACE session to the installed extension.

The original Web session is no longer copied directly into extension storage.

### Extension background validates and persists expiry

`background.js` now requires `sessionExpiresAt` in the external handoff payload and validates that it is:

- a real timestamp;
- still in the future;
- no more than seven days ahead (small clock-skew allowance only).

The expiry is persisted next to the AFTERTRACE extension session.

### Popup fails closed on locally expired Extension sessions

`popup.js` now validates stored auth using:

- non-empty bounded session token;
- explicit future `sessionExpiresAt` within the seven-day handoff maximum;
- HTTPS API/Web origins;
- allowlisted AFTERTRACE Web environment.

Expired/invalid stored auth is removed on popup load. `authenticatedFetch()` also re-checks local expiry before API calls. The user is asked to reconnect instead of seeing a stale `已連接` state until a later 401.

### Tests authored

`apps/api/src/auth/account-routes.test.ts` now covers bounded seven-day extension-session issuance.

New `apps/web/src/ExtensionConnectRoot.test.ts` covers:

- strict extension id/nonce target parsing;
- bearer exchange of current Web session for the shorter extension session;
- rejection of a server response attempting to issue more than seven days.

These are **AUTHORED / NOT RUN**.

## Files changed this run

- `apps/api/src/auth/account-routes.ts` — bounded extension-session issuance;
- `apps/api/src/auth/account-routes.test.ts` — exchange contract test;
- `apps/web/src/ExtensionConnectRoot.tsx` — exchange before handoff + expiry propagation;
- `apps/web/src/ExtensionConnectRoot.test.ts` — Web handoff tests;
- `apps/extension/background.js` — expiry validation/persistence;
- `apps/extension/popup.js` — local expiry fail-closed behavior;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `665d98ec` — issue bounded extension session from account;
- `17ab028a` — test bounded extension session issuance;
- `e5cbe0b9` — hand off bounded extension session;
- `1e57dc4f` — test bounded extension session handoff;
- `f7a33de4` — include extension session expiry in handoff;
- `2fce1c4a` — persist bounded extension session expiry;
- `3d2fdfb0` — expire bounded extension sessions locally;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- bounded extension-session account endpoint;
- Web extension-session exchange and expiry propagation;
- Extension background expiry validation;
- popup local expiry guard;
- `account-routes.test.ts` extension-session case;
- `ExtensionConnectRoot.test.ts`;
- previously authored Google/LINE/Apple auth tests;
- provider-neutral AUDIO/IMAGE/FILE/PDF capture;
- natural-language search / Related / summary / rewrite;
- Chrome quick text/page/selection/voice/screenshot paths;
- Task/Push/Notification focused tests.

### Executable verification actually attempted

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- focused/full Vitest — **NOT RUN**;
- Chrome unpacked-extension smoke — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- PostgreSQL exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Related Records PostgreSQL ranking smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini text/image/audio/file/search/summary/rewrite provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- Push/Cron runtime smoke — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so accumulated TypeScript/React/SQL/extension code still has not compiled or executed. This is now the dominant project risk.
2. Canonical `drizzle/0000` remains behind the target schema and must be regenerated before clean DB validation.
3. The bounded extension session is still a signed AFTERTRACE bearer session rather than a separately revocable per-device credential. Seven-day TTL + explicit disconnect is acceptable for current V1 source target, but device-level server revocation could be added later if real usage requires it.
4. Extension handoff/Source/manual/page/selection/screenshot flows still require Chrome unpacked-extension smoke.
5. Atomic provider-cost hold requires real PostgreSQL concurrent-reservation smoke.
6. Related Records SQL/ranking requires real PostgreSQL execution.
7. Real Google/LINE/Apple OAuth and Gemini provider configuration remain unverified.
8. Payment provider transport remains disabled (`CHECKOUT_ENABLED=false`). Provider-neutral activation/renewal/cancellation + idempotent SYSTEM lifecycle still needs the final external-event boundary/provider choice.
9. Push/Cron/Task behavior is authored but still needs browser/provider/runtime smoke.
10. `/ai-tools` Related/Rewrite still has numeric Record-ID UX in places; compact Record-card/deep-link polish remains.
11. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are proven and executable validation succeeds.

## Exact next run plan

1. If an executable checkout becomes available, **stop feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/extension-session/entitlement/provider-cost/media/search/related/summary/rewrite/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL database;
   - execute Related Records SQL smoke and exact-Grant/provider-cost-hold concurrency smoke;
   - Dev Google/LINE/Apple + Gemini text/image/audio/file/search/summary/rewrite smoke;
   - Chrome unpacked handoff -> Source -> manual/page/selection -> screenshot AI smoke;
   - Push/Cron browser/runtime smoke.
2. If executable checkout remains unavailable, keep development bounded:
   - add compact Record-card/deep-link entry into `/ai-tools` so Related/Rewrite do not require manual numeric Record ID;
   - complete the provider-neutral subscription lifecycle event boundary (idempotent external payment event -> subscription-period assignment/renewal/cancellation -> deterministic SYSTEM notification) without choosing/hard-coding an unapproved payment provider;
   - avoid adding more major AI product features before compile/runtime validation.
3. After executable validation and target dependency proof, regenerate baseline/rebuild disposable Dev/Prod as appropriate and remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **2.75–8 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **2.5–5.5h**;
- real OAuth/Gemini/Chrome/Push runtime smoke and polish: **0.75–1.75h**;
- AI-tools Record-card/deep-link polish: **0.25–0.75h**;
- provider-neutral subscription lifecycle event boundary: **0.75–2h**;
- final legacy cleanup: **0.5–1.5h**.

Ranges overlap. The largest uncertainty remains the first real compile/test + clean PostgreSQL baseline pass. Major accepted AI and Extension V1 capabilities are **AUTHORED**, not runtime verified.
