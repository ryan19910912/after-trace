# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 time-range summary + explicit AI rewrite + customer AI tools authored; provider summary input now bounded; executable/runtime verification still blocked

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
- deterministic Related Records backend/Admin capability;
- provider-backed time-range summary backend/provider/accounting/capability;
- explicit AI rewrite proposal backend/provider/accounting/capability;
- customer `/ai-tools` surface for Related Records, time-range summary and rewrite proposal/confirm;
- deterministic AI-limit SYSTEM notification caller;
- Chrome Extension explicit Web session handoff, Source/group picker, durable quick text, selected text, browser STT, bounded page title/URL metadata and explicit visible-tab screenshot AI capture.

## Branch reconciliation performed this run

The previous durable checkpoint ended at commit `7460fb7e`, but the actual branch had already advanced to `ec0b1323` before this run resumed: **25 commits ahead, 0 behind**.

Those already-present branch changes were accepted as the effective starting implementation rather than re-authored. They include:

- provider-backed `AiTimeRangeSummaryService`;
- deterministic same-Source/time-range PostgreSQL Record retrieval;
- Gemini time-range summary provider;
- `aiTimeRangeSummary` Admin/operator capability;
- authenticated `POST /api/v1/ai/capture/summary`;
- summary entitlement/reservation/provider-cost/settlement tests;
- proposal-only `AiRecordRewriteService`;
- exact authorized Record lookup for rewrite;
- Gemini rewrite provider;
- `aiRecordRewrite` Admin/operator capability;
- authenticated `POST /api/v1/ai/capture/rewrite`;
- rewrite accounting tests;
- Web `/ai-tools` customer surface for Related Records, summary and rewrite;
- bounded `/ai-tools` login-return support.

Do not redo these features on the next run. They are **AUTHORED**, not runtime verified.

## Completed in this run

### Provider-backed time-range summary safety hardening

The existing authored time-range summary flow is now bounded by both Record count and provider-input text size.

Current flow:

`authenticated user -> Source/user AI entitlement -> aiTimeRangeSummary capability -> deterministic PostgreSQL same-Source range retrieval -> bounded provider dataset -> reserve provider capacity/cost hold -> Gemini summary -> settle actual provider usage/cost`

Current boundaries:

- entitlement/Source authorization is checked before Record retrieval;
- range must be valid and is capped at 366 days;
- PostgreSQL retrieval remains chronological and exact-Source;
- provider input is capped at at most 200 Records;
- provider input now additionally has a **120,000-character Record/title envelope budget** so 200 individually large manual Records cannot create an unexpectedly multi-megabyte provider request;
- truncation is surfaced when either Record-count or provider-character budget is reached;
- when the selected range contains no Records, provider/runtime/ledger work is skipped and zero AI usage is created;
- provider-backed success uses the same unified reservation/settlement/provider-cost path as other AI operations;
- usage operation is `AI_TIME_RANGE_SUMMARY`.

The 120k character boundary is an internal safety parameter, not a customer cash balance or commercial allowance.

### Explicit AI rewrite proposal flow accepted from actual branch

The branch now contains proposal-only AI rewrite behavior matching `WORKLOG_RECORD_EDIT_POLICY.md`.

Current flow:

`authenticated user -> Source/user AI entitlement -> aiRecordRewrite capability -> exact ACTIVE Record in authorized Source -> reserve/provider -> rewrite proposal -> user preview -> explicit confirm -> existing Record PATCH expectedVersion`

Safety/accounting rules:

- Source authorization/entitlement happens before target Record existence is queried;
- AI never directly mutates a Record;
- proposal returns `recordId`, `expectedVersion`, original text and proposed text;
- cancelling the proposal leaves durable Record data unchanged while already-incurred provider usage remains auditable;
- accepting uses the normal optimistic version/revision API, so a concurrent edit causes the existing version conflict rather than a silent overwrite;
- usage operation is `AI_RECORD_REWRITE_PROPOSAL`.

### Customer AI tools surface accepted from actual branch

Web `/ai-tools` now exposes a compact customer surface for:

- Related Records via deterministic backend ranking;
- time-range summary using the provider-backed bounded summary endpoint;
- explicit AI rewrite proposal + preview + `確認套用` through the normal Record update API.

The surface reuses the same authenticated AFTERTRACE session and Source selector. It does not add a separate account, subscription or AI ledger.

Current UI limitation: Related/Rewrite still require manually entering a numeric Record ID. A compact Record-card/deep-link integration remains polish work rather than a backend gap.

### Summary / rewrite Admin capability controls

AI Pro commercial config now includes:

- `aiTimeRangeSummary`;
- `aiRecordRewrite`.

They follow the existing V1 capability contract:

- fixed AI Pro customer price remains NT$99/month;
- missing prelaunch capability values default on for compatibility;
- eligible FREE trial access mirrors enabled AI Pro capabilities;
- disabling a provider-backed capability fails closed without affecting FREE manual features.

### Focused tests authored this run

Added/extended test coverage for:

- large manual summary Records being truncated by provider-input character budget before reservation/provider execution;
- invalid summary range rejected before any AI dependency construction;
- unauthorized summary blocked before capability/runtime/Record/provider/ledger work;
- unauthorized rewrite blocked before target Record existence probing/provider/ledger work;
- operator-disabled rewrite returning 409 without target lookup/reservation/provider execution.

All tests are **AUTHORED / NOT RUN** because executable checkout remains unavailable.

## Files changed since the previous durable checkpoint

### API / Summary

- `apps/api/src/worklog/ai-time-range-summary.ts`;
- `apps/api/src/worklog/drizzle-ai-time-range-summary.ts`;
- `apps/api/src/worklog/gemini-time-range-summary.ts`;
- `apps/api/src/worklog/ai-time-range-summary.test.ts`.

### API / Rewrite

- `apps/api/src/worklog/ai-record-rewrite.ts`;
- `apps/api/src/worklog/drizzle-ai-record-rewrite.ts`;
- `apps/api/src/worklog/gemini-record-rewrite.ts`;
- `apps/api/src/worklog/ai-record-rewrite.test.ts`.

### API / Routes and capability configuration

- `apps/api/src/worklog/ai-text-capture-routes.ts`;
- `apps/api/src/worklog/ai-tools-routes.test.ts`;
- `apps/api/src/worklog/commercial-config.ts`;
- `apps/api/src/worklog/drizzle-commercial-config.ts`;
- `apps/api/src/worklog/commercial-config.test.ts`;
- `apps/api/src/admin/commercial-config-routes.ts`.

### Web

- `apps/web/src/AiToolsRoot.tsx`;
- `apps/web/src/main.tsx`;
- `apps/web/src/login-return.ts`;
- `apps/web/src/login-return.test.ts`.

### Admin Web

- `apps/admin/src/AdminCommercialPage.tsx`;
- `apps/admin/src/commercial-api.ts`;
- `apps/admin/src/commercial-api.test.ts`.

### Docs

- `docs/WORKLOG_REBUILD_PROGRESS.md`.

## Commits reconciled/authored since the previous durable checkpoint

All development commits listed below contain `[skip ci]`:

- `73cdd037` — provider-backed time-range summary service;
- `17f56047` — deterministic summary Record retrieval;
- `d7d3f2d3` — Gemini time-range summary provider;
- `38d67db8` — time-range summary capability config;
- `2bdddb52` — persist time-range summary capability;
- `052e9cc0` — expose summary capability setting;
- `00d90a79` — expose time-range summary capture route;
- `fae59761` — summary entitlement/accounting tests;
- `e1b1a63a` — explicit AI rewrite proposal service;
- `0c02dff3` — authorized Record lookup for AI rewrite;
- `341d4b68` — provider-neutral Gemini rewrite proposer;
- `a3d68726` — summary capability in Admin client;
- `879875e4` — AI rewrite capability config;
- `5b2ae780` — persist AI rewrite capability;
- `65c39993` — expose AI rewrite capability setting;
- `e17bd827` — rewrite capability in Admin client;
- `ae132fba` — summary/rewrite Admin toggles;
- `3e66c6a0` — explicit AI rewrite proposal route;
- `83de3b5c` — summary/rewrite commercial capability regression coverage;
- `41913b47` — AI rewrite proposal accounting tests;
- `2b7ac166` — summary/rewrite Admin payload coverage;
- `91ea5dc7` — customer Related/Summary/Rewrite AI tools;
- `fa17dc08` — route customer `/ai-tools` surface;
- `5665d876` — bounded AI-tools login return;
- `ec0b1323` — login-return test coverage;
- `20e1884d` — bound summary provider input size;
- `df6e6237` — cover summary provider text budget;
- `3ad88458` — cover summary/rewrite route boundaries;
- this checkpoint commit follows.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified or used as validation. `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### AUTHORED / NOT RUN

- provider-neutral AUDIO capture entitlement/reservation/provider-cost/settlement;
- supported FILE/PDF capture and MIME/base64 limits;
- natural-language search interpretation + deterministic PostgreSQL retrieval;
- Related Records entitlement/capability/ranking/API;
- time-range summary Source/range/capability/bounded-provider-input/accounting/API;
- explicit AI rewrite proposal/accounting/API;
- Web `/ai-search` and `/ai-tools` customer surfaces;
- summary/rewrite/Related Admin capability payload/UI wiring;
- screenshot/image entitlement/accounting/Extension flow;
- prior auth/provider/Apple/AI entitlement/provider-cost tests;
- Task/Push/Notification focused tests.

### Executable verification actually attempted this run

- mounted AFTERTRACE checkout discovery — **FAIL**; no repository checkout/.git found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- Web/Admin TypeScript typecheck — **NOT RUN**;
- focused Vitest including summary/rewrite/AI-tools tests — **NOT RUN**;
- full API/Web/Admin Vitest — **NOT RUN**;
- Chrome unpacked-extension smoke — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Web/Admin production builds — **NOT RUN**;
- PostgreSQL clean target-schema rebuild — **NOT RUN**;
- Related Records PostgreSQL SQL/ranking smoke — **NOT RUN**;
- PostgreSQL exact-Grant/provider-cost concurrency smoke — **NOT RUN**;
- Google/LINE/Apple real OAuth smoke — **NOT RUN**;
- Gemini real text/image/audio/file/search/summary/rewrite provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- Push/Cron runtime smoke — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so accumulated TypeScript/React/SQL/extension code still has not compiled or executed. This remains the dominant project risk; major feature expansion should stay paused/bounded.
2. Canonical `drizzle/0000` remains behind the target schema and must be regenerated before clean DB validation.
3. Summary/rewrite `/ai-tools` code is authored but uncompiled; the first executable pass may expose TypeScript/provider/schema integration fixes.
4. The 120,000-character summary provider budget is a conservative internal safety boundary and may be tuned after real Gemini/runtime measurements; it is not a customer-visible quota.
5. Atomic provider-cost hold still requires a real PostgreSQL concurrent-reservation smoke test.
6. Related Records SQL/ranking still needs real PostgreSQL execution to verify JSONB lateral queries, score ordering and performance.
7. Real Google/LINE/Apple OAuth and Gemini text/image/audio/file/search/summary/rewrite configuration have not been runtime tested.
8. Extension handoff/Source/manual/page/screenshot flows require Chrome unpacked-extension smoke; stale popup preview-state wording should be polished during that smoke/refactor.
9. Payment provider transport remains disabled (`CHECKOUT_ENABLED=false`). Provider-neutral activation/renewal/cancellation + idempotent SYSTEM lifecycle still needs the final external-event boundary/provider choice; do not invent a provider-specific checkout.
10. Push/Cron/Task behavior is authored but still requires real browser/provider/runtime smoke.
11. `/ai-tools` currently requires numeric Record IDs for Related/Rewrite rather than opening directly from a Record card. Add a compact deep-link/action during UI polish.
12. Retired LINE/ONE_TIME/GROUP-funding runtime/schema cleanup remains after target dependencies are proven and executable validation succeeds.

## Exact next run plan

1. If an executable checkout becomes available, **stop feature expansion immediately** and run/fix:
   - API/Web/Admin typecheck;
   - focused auth/Apple/entitlement/provider-cost/media/search/related/summary/rewrite/notification/task tests;
   - full package tests;
   - API Worker dry-run + Web/Admin builds;
   - regenerate canonical Drizzle `0000` baseline and rebuild a disposable PostgreSQL database;
   - execute Related Records SQL smoke and exact-Grant/provider-cost-hold concurrency smoke;
   - Dev Google/LINE/Apple + Gemini text/image/audio/file/search/summary/rewrite smoke;
   - Chrome unpacked handoff -> Source -> manual/page -> screenshot AI smoke;
   - Push/Cron browser/runtime smoke.
2. If executable checkout remains unavailable, keep development bounded:
   - add compact Record-card/deep-link entry into `/ai-tools` so Related/Rewrite do not require manual numeric Record ID;
   - complete the **provider-neutral subscription lifecycle event boundary** (idempotent external payment event -> subscription-period assignment/renewal/cancellation -> deterministic SYSTEM notification) without choosing or hard-coding an unapproved payment provider;
   - avoid adding more major AI product features before compile/runtime validation.
3. Once executable validation is possible and target dependencies are proven, regenerate baseline/rebuild disposable Dev/Prod and remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **3–8.5 focused development hours** remain for the currently accepted V1 scope, excluding external waiting for Apple/payment-provider account setup.

Rough allocation:

- first executable compile/test + canonical baseline/clean DB fixes: **2.5–5.5h**;
- real OAuth/Gemini/Chrome/Push runtime smoke and polish: **0.75–1.75h**;
- AI-tools Record-card/deep-link polish: **0.25–0.75h**;
- provider-neutral subscription lifecycle event boundary: **0.75–2h**;
- final legacy cleanup: **0.5–1.5h**.

Ranges overlap. The largest uncertainty remains the first real compile/test + clean PostgreSQL baseline pass. AUDIO/FILE/search/Related/summary/rewrite/customer AI tools are **AUTHORED**, not runtime verified.
