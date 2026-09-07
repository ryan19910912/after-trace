# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 target provider-backed AI text capture now uses shared selected-Grant entitlement ledger; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are explicitly allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE AFTERTRACE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- Trial points are not a TWD balance, are not hard-coded, do not refresh monthly, and do not retroactively resize already-issued trials.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership authorizes data only and never transfers another user's allowance.
- AI Pro is fixed at NT$99/month with monthly resource/point cap, configurable provider-cost hard cap, and optional per-request point cap.
- Every retained/new provider-backed path must go through unified entitlement admission before low-level reservation/settlement.

## Accepted foundation from prior checkpoints

Do not redo these already-authored batches:

- provider-neutral Google / LINE / Apple identity model, immutable opaque `public_account_id`, Admin exact lookup, authenticated account chrome;
- native AFTERTRACE GROUP membership/invites independent from LINE group membership;
- free manual Record CRUD/search with nullable `occurred_at` and content-only create;
- capture-first PWA/browser speech path without AFTERTRACE provider AI;
- notification categories exactly `ANNOUNCEMENT | SYSTEM | TASK`, independent `IN_APP | PUSH`, durable notification center/read state;
- Admin ANNOUNCEMENT backend/frontend, scheduled dispatch, Web Push subscriptions/preferences/encrypted transport/retry state;
- one shared `*/5 * * * *` Worker scheduler for due ANNOUNCEMENT -> due TASK -> pending PUSH;
- native Task backend + Web/PWA Task surface;
- dedicated FREE trial commercial config + provider-neutral onboarding issuance + idempotent FREE-trial SYSTEM notification;
- Admin `/commercial` page for FREE trial + AI Pro safety/resource controls;
- customer subscription surface restricted to exactly FREE + AI_PRO; legacy ONE_TIME is not customer-purchasable;
- legacy generic Admin plan mutation disabled in favor of dedicated commercial config;
- authenticated read-only `GET /api/v1/ai/entitlement?sourceId=...`;
- unified `AiEntitlementService` resolving `FREE_TRIAL | AI_PRO | BLOCKED` per requesting user + authorized Source;
- `admitWithGrant()` exact selected-Grant admission;
- selected Grant Source scope activation disables competing user-owned scopes for the same Source;
- shared `EntitledAiPointLedgerService` gates provider reservations before the generic low-level ledger;
- Record normalization reservation is already routed through that shared entitlement wrapper;
- AI Pro resource accounting includes customer-charged + platform-subsidized points;
- AI Pro fails closed on missing current-period provider TWD cost accounting;
- Chrome extension scaffold remains committed to shared account/Source/Record/AI entitlement model.

## This run — target Web/PWA/Chrome-ready provider-backed AI text capture

This run continued the current provider-runtime batch and did not redo a broad static audit.

### New target AI text capture service

New `apps/api/src/worklog/ai-text-capture.ts` adds the first provider-backed text capture path intended for Web/PWA and later Chrome extension reuse.

The final source-authored execution order is:

1. validate durable user/source/text input;
2. call read-only entitlement `resolve()` before runtime lookup so unauthorized Sources cannot learn provider/runtime state;
3. load durable AI runtime pricing/model config;
4. compute bounded provider reservation estimate without provider execution;
5. reserve through `EntitledAiPointLedgerService`, which internally calls exact selected-Grant `admitWithGrant()` and activates only that user's selected Source scope;
6. only after successful entitled reservation, call Gemini;
7. persist one enriched AFTERTRACE Record;
8. settle/audit provider usage through the same entitled ledger wrapper.

Manual Record creation remains unchanged and provider-free.

If provider execution fails before success, reservation release is attempted. If provider execution succeeds but Record persistence later fails, provider usage settlement is still attempted so successful provider cost does not disappear from accounting.

### Enriched Record persistence

New `apps/api/src/worklog/drizzle-ai-text-capture.ts` persists target AI-created text Records with:

- raw text as durable source of truth;
- optional AI title;
- bounded `search_terms`;
- nullable AI-resolved occurred date;
- `ai_enrichment_status = ENRICHED`;
- `ai_enriched_at`;
- requesting user as author;
- authorized Source;
- no required Entity;
- no LINE message/group identity;
- no GROUP AI responsible-user/funding field.

Runtime config comes from the durable AI runtime config row. Workspace lookup is an explicit query rather than a correlated `INSERT ... RETURNING` expression.

### Provider-backed API

New authenticated endpoint:

- `POST /api/v1/ai/capture/text`

The route resolves signed Web session -> durable AFTERTRACE user id, then uses:

- `AiEntitlementService` for read-only preliminary status;
- `EntitledAiPointLedgerService` for exact request admission + selected Grant scope;
- existing `WorklogAiPointLedgerService` only as low-level accounting delegate;
- current Gemini structured text interpreter;
- target AI Record repository.

The route is mounted in `worker.ts` before legacy LINE/Gemini Worklog runtime initialization.

### Hard-limit SYSTEM notification integration

Actual AI Pro hard-cap admission failures now trigger the existing deterministic `AI_LIMIT_REACHED` SYSTEM notification helper for:

- `MONTHLY_POINT_CAP_REACHED`;
- `MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED`;
- `MONTHLY_PROVIDER_COST_CAP_REACHED`.

The notification event key includes the durable period/reason and remains idempotent through Notification Service uniqueness.

`PROVIDER_COST_ACCOUNTING_INCOMPLETE` still blocks provider work but is intentionally not misrepresented as a normal customer usage-limit event.

### Safety/privacy hardening completed in this run

The first draft loaded AI runtime config before entitlement. It was tightened so preliminary read-only entitlement happens first.

The first draft also repeated `admit() + raw ledger` even though the branch already contained a stronger selected-Grant shared wrapper. It was refactored to use `EntitledAiPointLedgerService` directly. This avoids duplicate admission semantics and prevents a paid request from accidentally consuming an older FREE trial scope.

### Tests authored/updated

New/updated tests cover:

- blocked/unauthorized entitlement exits before runtime config/provider/ledger work;
- expected order `resolve -> runtime -> estimate -> entitled reservation -> provider -> Record -> settlement`;
- exact hard-cap reason from the entitled wrapper is surfaced before provider execution;
- provider failure releases reservation;
- route rejects invalid Source before constructing AI dependencies;
- route unauthorized Source does not execute runtime/provider/ledger work.

## Files changed this run

- `apps/api/src/worklog/ai-text-capture.ts` — target provider-backed capture service using shared entitled ledger;
- `apps/api/src/worklog/drizzle-ai-text-capture.ts` — runtime config + enriched Record persistence;
- `apps/api/src/worklog/ai-text-capture-routes.ts` — authenticated capture API + hard-limit SYSTEM caller;
- `apps/api/src/worklog/ai-text-capture.test.ts` — service tests authored/updated;
- `apps/api/src/worklog/ai-text-capture-routes.test.ts` — route safety tests authored;
- `apps/api/src/worker.ts` — mount `/api/v1/ai/capture/*` before legacy runtime;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits from this run

All successful development commits contain `[skip ci]`:

- `e1d7f824` — add provider-backed AI text capture service;
- `241e55dc` — persist provider-backed AI text capture;
- `4f12b625` — expose provider-backed AI text capture route;
- `c4825719` — mount provider-backed AI text capture API;
- `f653e0fa` — harden AI text capture persistence;
- `4c2750db` — author AI text capture service tests;
- `74e8774d` — authorize AI capture before runtime lookup;
- `b8dd1503` — align AI text capture tests with read-only entitlement;
- `ef02c165` — author AI text capture route tests;
- `ef70b5c5` — route AI capture through entitled point ledger;
- `d47e1448` — use shared entitled ledger in AI capture route;
- `75630c0d` — align AI capture tests with entitled ledger wrapper;
- this checkpoint commit follows.

During the run, an older progress-doc SHA update returned HTTP 409. It produced no repository change. The newer pre-existing selected-Grant/provider-admission checkpoint was preserved and incorporated here.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/ai-text-capture.test.ts` — **AUTHORED/UPDATED / NOT RUN**;
- `apps/api/src/worklog/ai-text-capture-routes.test.ts` — **AUTHORED / NOT RUN**;
- target AI text capture service/persistence/routes — **AUTHORED / NOT RUN**;
- entitlement-before-runtime privacy boundary — **AUTHORED / NOT RUN**;
- selected-Grant entitled ledger integration — **AUTHORED / NOT RUN**;
- AI hard-limit SYSTEM caller — **AUTHORED / NOT RUN**.

### Executable verification actually attempted

- mounted executable AFTERTRACE checkout discovery — **FAIL**; no checkout/.git directory found in available container paths;
- direct `git ls-remote https://github.com/ryan19910912/after-trace.git HEAD` — **FAIL**, `Could not resolve host: github.com`;
- API TypeScript typecheck — **NOT RUN**;
- AI capture / entitlement / entitled-ledger focused Vitest — **NOT RUN**;
- existing Task/Push/Notification focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Admin/Web TypeScript/tests/build — **NOT RUN**;
- PostgreSQL selected Grant scope + AI capture reservation/settlement/Record persistence smoke — **NOT RUN**;
- Gemini real provider smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so current TypeScript/SQL has not compiled or executed.
2. Canonical `drizzle/0000` is still behind target schema.
3. Selected-Grant Source-scope activation and new AI capture SQL are source-authored but not PostgreSQL runtime verified.
4. Target AI text capture is backend-only; Web/PWA UI has not yet exposed the explicit AI text action.
5. AI text is the first target provider capture modality. Target AI voice/image/file remain pending.
6. Existing migration-era attachment/media provider path still uses retired LINE-era assumptions. Do not expand it; replace/gate only as needed while target Web/PWA/Extension media path is built.
7. AI Pro provider-cost hard cap still evaluates committed cost; concurrent in-flight requests can race near the cost cap. A bounded in-flight provider-cost reservation/hold remains required before paid launch.
8. Payment lifecycle remains disabled (`CHECKOUT_ENABLED=false`); payment provider, webhook idempotency, renewal/cancellation state and subscription SYSTEM callers remain incomplete.
9. Google Login and Apple Login callbacks remain incomplete. LINE Login is provider-neutral and uses shared onboarding.
10. Real Web Push/Cron/Task runtime and browser/provider validation remain pending.
11. Chrome extension real auth handoff/Source picker/durable Record persistence remains incomplete.
12. Natural-language search / related Records / time-range summary / explicit rewrite remain pending on the same entitlement/accounting boundary.
13. Retired `worklog/funding` and LINE-era runtime/schema remain for migration and should be removed/isolate after retained target dependencies are replaced.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix first:
   - API typecheck;
   - AI capture + entitlement + entitled-ledger + commercial focused tests;
   - Task/Push/Notification focused tests;
   - API Worker dry-run build;
   - Admin/Web typecheck/tests/build;
   - PostgreSQL clean target-schema selected-scope + AI capture + FREE trial/AI Pro config smoke.
2. If executable checkout remains unavailable:
   - add Web/PWA explicit `AI 記錄` text capture UI using `/api/v1/ai/entitlement` + `/api/v1/ai/capture/text`;
   - show FREE trial / AI_PRO / BLOCKED state and upgrade CTA without provider-cost details;
   - keep manual capture unchanged/provider-free;
   - then close the concurrent provider-cost hard-cap race with a bounded in-flight cost reservation design.
3. Complete Google Login using provider-neutral provisioning + shared onboarding; keep LINE Login; add Apple next.
4. Implement payment provider/AI Pro activation-renewal-cancellation lifecycle with deterministic SYSTEM notifications; keep checkout disabled until verified.
5. Build target AI voice/image/file, then natural-language search / related / time-range summary / explicit rewrite using the same entitlement/accounting boundary.
6. Continue Chrome extension in committed order using shared auth/Source/Record/AI APIs.
7. Regenerate canonical baseline, rebuild disposable Dev/Prod, run runtime E2E, then remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **14–31 focused development hours** remain.

Rough remaining allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **4–8h**;
- Web/PWA AI text capture UI + entitlement state: **1–2h**;
- provider-cost concurrent hard-cap hold: **1–3h**;
- Google + Apple login completion/auth smoke: **3–5h**;
- payment/AI Pro lifecycle + deterministic SYSTEM callers: **2–4h**;
- target AI voice/image/file + search/related/summary/rewrite: **2–5h**;
- Chrome extension real auth/capture integration: **2–4h**;
- final Push/Cron/PWA/runtime smoke + retired legacy cleanup: **1–3h**.

Largest uncertainty remains the first real compile/test pass, PostgreSQL clean target-schema rebuild, concurrent provider-cost hold behavior, provider/browser smoke and Dev runtime E2E. Narrow this estimate again after those execute.

## Next run checklist

- [ ] Read latest policy docs in required order and this checkpoint.
- [ ] Re-check for executable checkout; if present, validate before adding more code.
- [ ] Add Web/PWA explicit AI text capture surface without changing manual capture.
- [ ] Close concurrent provider-cost hard-cap race before paid launch.
- [ ] Keep every provider operation behind `EntitledAiPointLedgerService` / unified entitlement.
- [ ] Keep V1 commercial shape exactly FREE + AI_PRO NT$99/month.
- [ ] Do not use GitHub Actions.
