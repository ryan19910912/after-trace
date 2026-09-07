# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 Chrome Extension page title/URL durable capture complete; screenshot/image AI path next; executable/runtime verification still blocked

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are allowed while no real customer/durable production data exists. This permission expires once real durable production data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no extra paid tiers.
- FREE remains a complete manual product.
- Newly eligible FREE accounts receive one idempotent one-time AI trial using Admin-configured `free_initial_ai_trial_points`.
- Trial points are not TWD, do not refresh monthly and do not retroactively resize issued grants.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership authorizes data only.
- AI Pro retains monthly resource/point cap, provider-cost hard cap and optional per-request/modality caps.
- Every provider-backed request must pass unified entitlement before reservation/provider execution/settlement.

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
- unified `AiEntitlementService`, selected Grant admission, reservation/settlement and provider-cost accounting;
- atomic AI Pro concurrent provider-cost reservation hold;
- provider-backed AI text capture backend + PWA manual/AI capture UI;
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension explicit Web session handoff, Source/group picker, durable quick text, selected-text draft, browser STT and visible-tab screenshot preview.

## Completed in this run

### Bounded Record capture metadata

Added a creation-time `capture_context` JSONB field to the target Record schema for explicit bounded capture metadata. It is optional, is not Record body text and normal manual edits cannot rewrite it.

New `record-capture-context.ts` strictly accepts only Chrome-extension-origin page metadata shaped as:

```text
{
  page: {
    title: string | null,
    url: http(s) URL | null
  }
}
```

Rules:

- client identity is derived server-side as `CHROME_EXTENSION`, not trusted from request JSON;
- title is normalized and capped at 255 characters;
- URL is capped at 2048 characters and only `http:` / `https:` is accepted;
- credential-bearing URLs and unsafe schemes are rejected;
- arbitrary keys/full-page text are rejected;
- Web-origin clients cannot use this extension-only V1 capture-context input path;
- capture context is immutable after Record creation.

Focused parser tests were authored — **AUTHORED / NOT RUN**.

### Manual Record API persistence

Manual Record create now parses optional `captureContext` and passes the validated value into the existing repository create path.

`DrizzleManualRecordRouteRepository` now:

- persists `capture_context` with the same durable Record insert;
- selects it in list/detail reads;
- maps only the accepted `CHROME_EXTENSION` + bounded `page` shape back into the product view.

Manual CRUD still performs zero provider AI work.

### Chrome Extension page title / URL persistence

`apps/extension/popup.js` now completes the accepted extension delivery-order page-context step:

- active page title/URL are normalized into a bounded draft context;
- selected-text context-menu drafts retain the originating page title/URL independently from whatever tab is active when the popup later opens;
- selected-text drafts with safe source metadata explicitly preselect `附上目前頁面` and remain user-cancellable before save;
- normal quick text can explicitly opt into `附上目前頁面`;
- save sends `captureContext.page.title/url` through the same PRIVATE/GROUP manual Record API;
- title/URL are never appended to `rawText`;
- no full-page contents, history or clipboard are captured;
- page metadata remains provider-free and available to FREE users;
- unsafe/non-http(s) URL metadata is omitted client-side and rejected server-side if attempted.

Extension copy was updated so it no longer claims page metadata is preview-only.

### Screenshot boundary remains safe

Visible-tab screenshot is still local preview only. It is **not** sent to Gemini/provider and is **not** persisted as an attachment in this batch.

The next batch must send an explicitly captured bounded image through AFTERTRACE backend AI entitlement, FREE-trial/AI-Pro reservation and provider-cost accounting. The extension must never call a provider directly.

## Files changed since the previous checkpoint

### API / schema

- `apps/api/src/db/schema-worklog-record-core.ts`;
- `apps/api/src/worklog/record-capture-context.ts`;
- `apps/api/src/worklog/record-capture-context.test.ts`;
- `apps/api/src/worklog/manual-record-routes.ts`;
- `apps/api/src/worklog/drizzle-manual-record-routes.ts`;
- `apps/api/src/worklog/manual-record-capture-context.test.ts`.

### Chrome Extension

- `apps/extension/popup.js`;
- `apps/extension/popup.html`.

### Docs

- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Commits since the previous checkpoint

All development commits contain `[skip ci]`:

- `22af4e03` — bounded Record capture-context parser;
- `89d6af6b` — bounded capture-context tests;
- `4383107a` — target schema capture-context field;
- `cde57b2f` — parse/persist bounded manual capture context at API boundary;
- `2c8856bc` — store/read manual Record capture context in Drizzle repository;
- `32e9641c` — author manual Record capture-context route tests;
- `172e671d` — persist extension page capture context;
- `a29cb389` — align extension capture status copy;
- `83c36de2` — checkpoint durable extension page context.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- bounded capture-context parser tests;
- API route capture-context persistence behavior;
- capture-context immutability on manual edit;
- Extension selected-text -> page metadata -> durable Record flow;
- Extension normal quick text + explicit page metadata -> durable Record flow;
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
- Gemini real provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so accumulated TypeScript/React/SQL/extension code has not compiled or executed.
2. Canonical `drizzle/0000` remains behind target schema, now including `capture_context`; regenerate before clean DB/runtime validation.
3. Atomic provider-cost hold still needs a real PostgreSQL concurrent-reservation smoke test.
4. Real Google/LINE/Apple OAuth configuration has not been runtime tested.
5. Extension external messaging, `chrome.storage.session`, Source persistence and page-context persistence need real Chrome unpacked-extension smoke.
6. Screenshot/image remains preview-only and must enter shared AI entitlement/reservation/provider-cost path before provider execution.
7. Payment provider transport/lifecycle remains disabled (`CHECKOUT_ENABLED=false`); provider-neutral activation/renewal/cancellation/idempotent SYSTEM lifecycle remains pending.
8. Target AI voice/image/file, natural-language search, related Records, time-range summary and explicit rewrite remain pending.
9. Push/Cron/Task still need real browser/provider/runtime smoke.
10. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are fully replaced.

## Exact next run plan

1. If executable checkout becomes available, stop feature expansion and run/fix typecheck, focused tests, production builds, canonical baseline regeneration, disposable PostgreSQL rebuild, provider-cost concurrency smoke and Chrome unpacked-extension smoke.
2. If executable checkout remains unavailable, continue directly with **screenshot/image AI integration**:
   - define one bounded backend image-capture request contract;
   - enforce image size/content-type limits before provider work;
   - authorize selected PRIVATE/GROUP Source server-side;
   - call the existing unified AI entitlement boundary so eligible FREE trial or active AI_PRO is required;
   - reserve points/provider-cost before Gemini/provider execution;
   - fully audit and settle actual usage/cost;
   - return a proposed/AI-created Record result through the shared Record domain;
   - never expose provider keys to the extension and never call Gemini directly from the extension.
3. Reuse the same image path later for Web/PWA image input rather than creating an extension-only AI pipeline.
4. Then complete provider-neutral AI Pro subscription lifecycle and remaining AI voice/search/related/summary/rewrite features.
5. Regenerate canonical baseline, rebuild disposable Dev/Prod as appropriate, run runtime E2E, then remove/isolate remaining retired LINE-era code.

## Current estimated remaining development time

Approximately **5–14 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **3.5–7h**;
- real Google/LINE/Apple + Chrome browser smoke/polish: **0.5–1.5h**;
- screenshot/image shared AI entitlement wiring: **0.75–2h**;
- payment lifecycle + deterministic SYSTEM callers: **1–2.5h**;
- remaining AI voice/search/related/summary/rewrite: **1.5–3.5h**;
- final Push/Cron/PWA/runtime smoke + legacy cleanup: **1–2.5h**.

Ranges overlap. The largest uncertainty remains the first real compile/test + clean PostgreSQL baseline pass.
