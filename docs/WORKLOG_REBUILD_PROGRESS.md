# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Account Identity, Support, Notification, Extension and Subscription policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 auth-provider availability + Chrome Extension explicit session handoff / Source picker / durable manual quick capture source-authored; executable/runtime verification pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real customer/durable production data exists. This permission expires once real durable production data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no extra paid tiers.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are not TWD, do not refresh monthly and do not retroactively resize issued grants.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership authorizes data only.
- AI Pro retains monthly resource/point cap, provider-cost hard cap and optional per-request cap.
- Every provider-backed request must pass unified entitlement before low-level reservation/settlement.

## Accepted target foundation — do not redo

- provider-neutral account identities for Google / LINE / Apple;
- immutable opaque `public_account_id`, Web/PWA display+copy and Admin exact lookup;
- provider-neutral Google/LINE/Apple login chooser and canonical Apple form_post Login flow;
- native AFTERTRACE groups/invites independent from LINE GROUP membership;
- free manual Record CRUD/search, nullable `occurred_at`, provider-free browser speech-to-text;
- notification center + ANNOUNCEMENT/SYSTEM/TASK + IN_APP/PUSH;
- Admin announcements, Web Push subscriptions/preferences/delivery, one shared ~5 minute scheduler;
- native Task backend + Web/PWA task surface;
- dedicated FREE trial config + provider-neutral onboarding issuance;
- Admin `/commercial`, V1-only customer FREE + AI_PRO subscription surface;
- unified `AiEntitlementService`, exact selected Grant admission and `EntitledAiPointLedgerService`;
- atomic AI Pro provider-cost reservation hold using exact subscription-period Grant;
- target provider-backed AI text capture backend + PWA `一般紀錄` / `AI 整理紀錄` UI;
- deterministic AI-limit SYSTEM notification caller;
- Chrome extension scaffold with selected-text draft, browser STT and visible-tab screenshot preview.

## This run — auth provider availability

### Public provider availability endpoint

New `apps/api/src/auth/provider-availability.ts` defines a customer-safe availability contract for Google / LINE / Apple.

`GET /api/v1/auth/providers` now returns booleans only:

- `google`;
- `line`;
- `apple`.

No client id, Team ID, key id, secret, redirect configuration or other provider configuration is exposed.

Availability fails closed when the shared AFTERTRACE auth/session boundary is incomplete. Google/LINE require their complete provider configuration. Apple reports available only when all four optional Apple bindings are present.

This closes the prior UX risk where Apple was displayed even when optional Apple credentials were absent and `/apple/start` would inevitably return `APPLE_LOGIN_NOT_CONFIGURED`.

### Web login chooser availability behavior

New `apps/web/src/login-provider-availability.ts` loads `/api/v1/auth/providers`.

`LoginProviderButtons` now:

- renders only providers confirmed available by the API;
- keeps Google + LINE as the network-failure fallback because they are the required first-priority providers;
- keeps optional Apple hidden in the fallback and only exposes it after the API reports configured;
- shows a clear configuration error if the API explicitly reports no usable provider;
- continues provider-neutral copy: login services authenticate identity only; AFTERTRACE account id remains independent and matching email never auto-merges accounts.

Provider availability tests were authored in API and Web packages — **NOT RUN**.

## This run — Chrome Extension real account/API wiring

This run continued the exact extension order from `WORKLOG_EXTENSION_POLICY.md`:

1. popup/auth handoff;
2. Source/group picker;
3. quick text persistence.

It does not create extension-only account, subscription, Record domain or provider credential storage.

### Explicit Web -> Extension session handoff

New Web route `/extension/connect` is implemented by `ExtensionConnectRoot.tsx`.

Connection flow:

1. extension popup generates a cryptographically random short-lived connect nonce;
2. nonce is stored in `chrome.storage.session` and the popup opens the appropriate AFTERTRACE Web `/extension/connect?extensionId=...&nonce=...` route;
3. if the user is not already logged in, the existing provider-neutral login flow preserves only this strictly validated extension-connect return path;
4. user explicitly presses `連接這個擴充功能` on Web;
5. Web sends the current AFTERTRACE Web session, API origin, Web origin and nonce to the target extension using Chrome external messaging;
6. extension background accepts the handoff only when the sender is the known AFTERTRACE Dev/Prod Web origin, the Web/API environment pair matches, and the nonce equals the pending popup nonce;
7. the pending nonce is consumed from session storage;
8. the AFTERTRACE first-party bearer session is stored for subsequent extension API calls.

Google/LINE/Apple provider access tokens or credentials are never sent to/stored in the extension. The extension reuses the same AFTERTRACE account/session boundary.

`login-return.ts` strictly permits only the existing fixed return pages or a canonical `/extension/connect` containing:

- Chrome extension id matching Chrome's 32-character `a-p` form;
- bounded connect nonce;
- no arbitrary extra redirect/query target.

This prevents the provider callback return mechanism from becoming an open redirect.

### Manifest / external-connect boundary

`apps/extension/manifest.json` now includes only the additional access required for the accepted flow:

- exact AFTERTRACE Dev/Prod API `host_permissions`;
- exact AFTERTRACE Dev/Prod Web `externally_connectable.matches`.

The existing minimal permissions remain `activeTab`, `contextMenus`, `storage`; a temporary broad `tabs` permission was added during authoring then immediately removed. Final manifest does **not** request browsing-history, clipboard or broad host permissions.

### Manual Record API Chrome origin

Existing manual Record routes previously rejected every origin except exact Web origin.

New `allowedProductClientOrigin()` keeps normal Web exact-origin matching and additionally accepts canonical `chrome-extension://<32-char-id>` origins **only on the bearer-session protected manual product route**.

The extension still needs the normal AFTERTRACE Web session and all existing server-side PRIVATE/GROUP authorization. Admin/payment/anonymous APIs were not broadly opened to extension origins.

Focused origin and route tests were authored — **NOT RUN**.

### Source/group picker

The extension popup now loads:

`GET /api/v1/worklog/surfaces`

with the handed-off AFTERTRACE bearer session.

It renders:

- `我的紀錄` for the user's PRIVATE Source;
- each authorized native AFTERTRACE GROUP Source.

The last selected Source is stored only as a local UI preference. Authorization remains backend truth; stale/unauthorized Source writes still fail server-side.

A 401/invalid Web session clears the extension's local AFTERTRACE session and requires explicit reconnect.

### Durable manual quick text

The extension popup now writes text through the same existing manual Record endpoints:

- PRIVATE -> `POST /api/v1/worklog/records/personal`;
- GROUP -> `POST /api/v1/worklog/records/group/:sourceId`.

Request uses only manual fields (`rawText`, nullable `occurredAt`) and does not invoke provider AI.

As a result, the already-authored explicit capture drafts now converge on durable manual Records:

- typed quick text;
- selected webpage text loaded by the context-menu flow;
- free browser speech-to-text output.

Selected-text/page draft data remains user editable before save.

### Page context and screenshot boundary in this batch

This batch intentionally does **not** pretend page metadata or screenshot AI is already persisted.

- active-page title/URL can still be previewed in the popup, but the save status explicitly states that title/URL metadata has not yet been written to the Record;
- visible-tab screenshot remains local preview only;
- screenshot is not sent to a provider in this batch;
- popup explicitly states image provider work requires AI Pro or eligible FREE trial entitlement.

The next extension capture batch must persist page title/URL as bounded Record capture metadata rather than appending it silently to Record body, then wire screenshot/image through the shared AI entitlement/cost path.

## Files changed this run

### API

- `apps/api/src/auth/provider-availability.ts`;
- `apps/api/src/auth/provider-availability.test.ts`;
- `apps/api/src/auth/routes.ts`;
- `apps/api/src/auth/product-client-origin.ts`;
- `apps/api/src/auth/product-client-origin.test.ts`;
- `apps/api/src/worklog/manual-record-routes.ts`;
- `apps/api/src/worklog/manual-record-extension-origin.test.ts`.

### Web/PWA

- `apps/web/src/login-provider-availability.ts`;
- `apps/web/src/login-provider-availability.test.ts`;
- `apps/web/src/LoginProviderButtons.tsx`;
- `apps/web/src/login-return.ts`;
- `apps/web/src/login-return.test.ts`;
- `apps/web/src/ExtensionConnectRoot.tsx`;
- `apps/web/src/LoginRoot.tsx`;
- `apps/web/src/main.tsx`.

### Chrome Extension

- `apps/extension/manifest.json`;
- `apps/extension/background.js`;
- `apps/extension/popup.html`;
- `apps/extension/popup.js`.

### Docs

- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `4d717c04` — auth provider availability contract;
- `f3a835b4` — public configured-provider endpoint;
- `9bf44425` — provider availability API tests;
- `2e57c8a0` — Web provider availability client;
- `6ec6a408` — hide unavailable login providers;
- `20f0a38c` — Web provider availability tests;
- `3f51ccdd` — bounded extension login return;
- `718c38f9` — explicit Web extension session handoff page;
- `fcaacae5` — preserve bounded extension return in provider login;
- `22dcc251` — LoginRoot extension return support;
- `2c965005` — route extension connection surface after provider callback;
- `2f4a05ed` — bounded Chrome product client origin;
- `f6da3b09` — manual Record routes accept authenticated Chrome client;
- `846101c1` — extension Web/API access manifest authoring;
- `3a3a99ab` — remove unnecessary broad `tabs` permission;
- `b253a408` — explicit Web session handoff receiver;
- `a67a68dc` — extension account/Source controls;
- `d1c44837` — Source loading + manual Record persistence;
- `13c5554c` — product origin tests;
- `a9a8f185` — bounded login return tests;
- `55144083` — extension manual Record CORS route test;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation. The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- API login provider availability helper/endpoint tests;
- Web login provider availability mapping/fallback tests;
- bounded login-return tests;
- Web `/extension/connect` browser handoff;
- external Chrome message sender/environment/nonce checks;
- Chrome manual product origin tests;
- manual Record route Chrome-origin test;
- extension Source loading;
- extension PRIVATE/GROUP manual quick-text persistence;
- selected-text -> durable manual Record flow;
- browser STT -> durable manual Record flow.

### Executable verification actually attempted this run

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- focused auth/provider/extension-origin Vitest — **NOT RUN**;
- full API/Web/Admin Vitest — **NOT RUN**;
- extension unpacked Chrome smoke — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- PostgreSQL exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini real provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so accumulated TypeScript/React/SQL/static-extension code has not compiled or executed.
2. Canonical `drizzle/0000` remains behind the target schema and must be regenerated before clean DB/runtime validation.
3. Atomic provider-cost hold is structurally present in schema + SQL but still needs a real PostgreSQL concurrent-reservation smoke test.
4. Real Google/LINE/Apple OAuth configuration has not been runtime tested. Apple especially requires real Services ID/domain/HTTPS return URL/private key setup.
5. Extension external messaging and `chrome.storage.session` require real Chrome unpacked-extension smoke. Source code assumes current workers.dev Dev/Prod origins listed in the manifest/background environment map; future custom domains require an explicit manifest/map update.
6. The extension currently stores the handed-off **AFTERTRACE first-party Web session** in extension-local storage. No third-party provider credential is stored. If later device-level revocation/scoped sessions are required, add a dedicated first-party extension-session lifecycle rather than provider-specific auth.
7. Page title/URL are preview-only in the extension and need a bounded durable Record capture-metadata field before being claimed persisted. Do not append them silently to `rawText`.
8. Screenshot remains preview-only and must enter the shared AI entitlement/reservation/provider-cost pipeline before persistence/provider execution.
9. Payment provider transport/lifecycle remains disabled (`CHECKOUT_ENABLED=false`). Activation/renewal/cancel webhook idempotency and SYSTEM callers still need a final provider-neutral lifecycle boundary once cancellation semantics/payment provider are chosen.
10. Target AI voice/image/file, natural-language search, related Records, time-range summary and explicit rewrite remain pending.
11. Push/Cron/Task still need real browser/provider/runtime smoke.
12. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are fully replaced.

## Exact next run plan

1. If executable checkout becomes available, **stop feature expansion** and run/fix:
   - API/Web/Admin typecheck;
   - auth/provider/Apple/AI entitlement/provider-cost focused tests;
   - extension-origin/manual Record focused tests;
   - Task/Push/Notification focused tests;
   - API Worker dry-run build + Web/Admin production builds;
   - regenerate canonical Drizzle baseline and rebuild a disposable DB;
   - real PostgreSQL selected-Grant/provider-cost concurrency smoke;
   - Dev Google/LINE/Apple auth + AI text smoke;
   - load `apps/extension` unpacked and smoke Web handoff -> Source -> PRIVATE/GROUP quick text.
2. If executable checkout remains unavailable, continue the next bounded extension capture batch:
   - add bounded durable Record `capture_context`/equivalent metadata suitable for explicit Chrome page title + URL context;
   - wire the existing `附上目前頁面` toggle to that metadata without copying full page contents into Record body;
   - preserve manual/provider-free behavior;
   - then align selected-text capture to carry the same explicit page metadata.
3. After page context, wire screenshot/image through the same AI entitlement + FREE-trial/AI-Pro reservation/cost accounting path; do not provider-call from extension directly.
4. Complete payment-provider-neutral AI Pro lifecycle once cancel-at-period-end semantics/provider choice are explicit.
5. Complete target AI voice/image/file and retrieval/rewrite features on the same entitlement/accounting boundary.
6. Regenerate canonical baseline, rebuild disposable Dev/Prod as appropriate, run runtime E2E, then remove/isolate remaining retired LINE-era code.

## Current estimated remaining development time

Approximately **6–16 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **4–8h**;
- real Google/LINE/Apple + extension browser smoke/polish: **0.5–1.5h**;
- extension page-context metadata + screenshot AI entitlement wiring: **1–2.5h**;
- payment lifecycle + deterministic SYSTEM callers: **1–3h**;
- target AI voice/image/file + search/related/summary/rewrite: **2–4h**;
- final Push/Cron/PWA/browser/runtime smoke + legacy cleanup: **1–3h**.

Ranges overlap. The largest uncertainty is still the first real compile/test + clean PostgreSQL baseline pass. Once that can run, the remaining estimate should become much tighter.
