# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`, including Subscription, Account Identity, Support, Notification, and Extension policies. Latest docs are authoritative.

Never run/dispatch/rerun/enable/modify GitHub Actions. Every development commit must contain `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-07 V1 commercial surfaces + unified per-user AI entitlement + Record-normalization provider admission source-authored; executable/runtime verification still pending

AFTERTRACE remains Web + PWA-first with a committed compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface. LINE remains only as a provider-neutral login provider and official OA customer-support contact channel.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds are explicitly allowed while no real customer/durable production data exists. This destructive permission expires once real data exists.

## Commercial/product contract still in force

- Exactly `FREE` NT$0 + `AI_PRO` NT$99/month for V1.
- No one-time AI top-up products and no additional paid tiers.
- FREE remains a complete manual product.
- Every newly eligible FREE AFTERTRACE account receives one idempotent one-time AI trial allowance in internal points.
- Admin config key is `free_initial_ai_trial_points` / `FREE 初始 AI 試用點數`.
- Trial points are not a TWD balance, are not hard-coded, do not refresh monthly, and do not retroactively resize already-issued trials.
- AI entitlement belongs to the requesting AFTERTRACE user. GROUP membership only authorizes data access; it never transfers another member's AI allowance.
- AI Pro is fixed at NT$99/month and keeps monthly internal resource/point cap, configurable provider-cost hard cap, and optional per-request point cap.
- Trial/AI_PRO provider calls continue through existing Grant reservation/settlement/provider-cost accounting where it cleanly fits.

## Accepted foundation from prior checkpoints

Do not redo these already-authored batches:

- provider-neutral Google / LINE / Apple identity model, immutable opaque `public_account_id`, Admin exact lookup, authenticated account chrome;
- native AFTERTRACE GROUP membership/invites independent from LINE group membership;
- free manual Record CRUD/search with nullable `occurred_at` and content-only create;
- capture-first PWA/browser speech path without AFTERTRACE provider AI;
- notification categories exactly `ANNOUNCEMENT | SYSTEM | TASK`, independent `IN_APP | PUSH`, durable notification center/read state;
- Admin ANNOUNCEMENT backend/frontend, scheduled dispatch, Web Push subscriptions/preferences/encrypted transport/retry state;
- one shared `*/5 * * * *` Worker scheduler for due ANNOUNCEMENT -> due TASK -> pending PUSH;
- native Task target schema/service/repository/API + Web/PWA Task surface;
- dedicated FREE trial commercial config + provider-neutral onboarding issuance + idempotent FREE-trial SYSTEM notification;
- Admin `/commercial` page for FREE trial points and AI Pro safety/resource controls;
- customer subscription surface restricted to exactly FREE + AI_PRO; legacy ONE_TIME is not customer-purchasable;
- legacy generic Admin plan mutation disabled in favor of dedicated commercial config;
- authenticated read-only `GET /api/v1/ai/entitlement?sourceId=...`;
- unified `AiEntitlementService` resolving `FREE_TRIAL | AI_PRO | BLOCKED` per requesting user + authorized Source;
- AI Pro current-period point/resource accounting includes customer-charged + platform-subsidized resource use;
- AI Pro fails closed when current-period provider TWD cost accounting is incomplete;
- Chrome extension scaffold remains committed to shared account/Source/Record/AI entitlement model.

## This run — exact provider admission + selected Grant scope

This run continued the next bounded provider-runtime batch and did not redo a broad static audit.

### Provider admission now exposes an internal exact Grant result

`AiEntitlementService` keeps customer/UI `resolve()` read-only while provider preflight now has internal `admitWithGrant()` returning the exact selected Grant id together with the decision.

Additional hardening:

- optional per-request AI point cap remains enforced before provider work;
- AI Pro conservative requested-point hold may not exceed the remaining current-period point cap;
- that case fails closed as `MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED` rather than knowingly starting work that would overrun the monthly resource cap;
- existing `admit()` remains a decision-only compatibility surface.

### Selected entitlement Grant becomes the only enabled Source scope

`DrizzleAiEntitlementRepository.ensureGrantScope()` now activates the entitlement-selected Grant for the requested Source and disables other Grant scopes owned by the same user for that Source.

This prevents the generic low-level ledger from consuming an older FREE trial merely because a user has upgraded to AI Pro and both Grants happen to have Source scopes. If AI Pro later ends and an eligible FREE trial remains, the next trial admission can re-activate the trial scope.

The low-level `WorklogAiPointLedgerService` remains entitlement-agnostic accounting infrastructure; provider callers are expected to pass through the entitlement layer before reservation.

### Shared provider-facing entitlement wrapper

New `EntitledAiPointLedgerService` is a shared AI point port that:

1. validates Source/charged-user/requested-point inputs;
2. calls `AiEntitlementService.admitWithGrant()`;
3. fails closed as `AI_ENTITLEMENT_BLOCKED` with the durable entitlement reason when admission is denied;
4. delegates to existing exactly-once Grant reservation/settlement only after the selected Source scope is activated.

`AiPointReservationResult` now includes the blocked result shape so provider services can stop before provider execution.

### Record normalization provider reservation is now gated

`RecordNormalizationAiPointPort` now wraps its reservation path with `EntitledAiPointLedgerService` backed by `DrizzleAiEntitlementRepository`.

The existing Record text/title/date normalization provider path can therefore no longer reserve AI points merely because some Grant is available. It must first pass requesting-user Source authorization + FREE trial/AI Pro admission/caps.

This is migration hardening of an existing provider path, not an expansion of retired LINE product behavior.

### Tests authored

New `apps/api/src/worklog/entitled-ai-point-ledger.test.ts` covers:

- eligible FREE trial admission;
- Source authorization fail-closed behavior;
- AI Pro requested hold exceeding remaining monthly point cap;
- AI Pro precedence over a remaining FREE trial and selection of the current AI Pro Grant.

These tests are **AUTHORED / NOT RUN** because no executable repository checkout is mounted in the current tool environment.

## Files changed this run

- `apps/api/src/worklog/ai-entitlement.ts` — exact internal Grant admission + AI Pro request-would-exceed-period-cap rejection;
- `apps/api/src/worklog/ai-point-ledger.ts` — entitlement-blocked result shape and low-level accounting boundary documentation;
- `apps/api/src/worklog/drizzle-ai-entitlement.ts` — activate selected Grant scope and disable competing user-owned scopes for the same Source;
- `apps/api/src/worklog/entitled-ai-point-ledger.ts` — shared provider-facing entitlement gate wrapper;
- `apps/api/src/worklog/record-normalization-ai-points.ts` — Record normalization reservation now uses unified entitlement gate;
- `apps/api/src/worklog/entitled-ai-point-ledger.test.ts` — focused provider admission tests authored;
- `docs/WORKLOG_REBUILD_PROGRESS.md` — this checkpoint.

## Commits this run

All successful development commits contain `[skip ci]`:

- `30e96352` — expose exact AI entitlement admission grant;
- `edb60149` — intermediate entitlement-scoped reservation design, immediately refined so the low-level ledger remains generic;
- `0c26caf0` — keep AI grant ledger entitlement-agnostic;
- `3815b322` — activate only the selected AI entitlement grant scope;
- `b4e1d465` — gate provider reservations through AI entitlement;
- `4f9c479f` — make entitlement AI gate a shared port wrapper;
- `8cf5bd25` — gate Record normalization through unified AI entitlement;
- `8d5ddef2` — author unified AI provider admission tests;
- this checkpoint commit follows.

A stale-SHA progress-document update attempt returned HTTP 409 before commit; it produced no repository change.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, or used as validation.

The unrelated local `apps/api/verify-admin-schema.mjs` was not staged or committed.

## Validation status

### Authored/updated this run

- `apps/api/src/worklog/entitled-ai-point-ledger.test.ts` — **AUTHORED / NOT RUN**;
- exact selected-Grant entitlement admission — **AUTHORED / NOT RUN**;
- selected Source-scope activation SQL — **AUTHORED / NOT RUN**;
- Record normalization provider admission integration — **AUTHORED / NOT RUN**.

### Executable verification actually attempted this run

- mounted executable AFTERTRACE checkout discovery — **FAIL**; no checkout/.git directory was found in available container paths;
- API TypeScript typecheck — **NOT RUN**;
- entitlement/commercial/subscription focused Vitest — **NOT RUN**;
- new entitled-ledger focused Vitest — **NOT RUN**;
- existing Task/Push/Notification focused Vitest — **NOT RUN**;
- full API Vitest — **NOT RUN**;
- API Worker dry-run build — **NOT RUN**;
- Admin TypeScript/tests/build — **NOT RUN**;
- Web TypeScript/tests/build — **NOT RUN**;
- PostgreSQL selected Grant Source-scope/concurrency smoke — **NOT RUN**;
- PostgreSQL FREE trial/config/AI Pro config smoke — **NOT RUN**;
- Drizzle canonical baseline regeneration/guard — **NOT RUN**;
- Dev/Prod clean rebuild — **NOT RUN**;
- runtime E2E — **NOT RUN**.

No test/build/runtime item is claimed PASS or RUNTIME VERIFIED.

## Known blockers / risks

1. Executable checkout remains unavailable, so current TypeScript/React/SQL has not compiled or executed.
2. Canonical `drizzle/0000` is still behind target schema, including provider-neutral auth, notification/PUSH, native Task, commercial config and entitlement assumptions.
3. Selected-Grant Source-scope activation SQL is source-authored but not PostgreSQL runtime verified. Concurrency behavior must be exercised before paid launch.
4. Record normalization reservation now uses the shared entitlement gate, but the older first-stage attachment/media ingestion path still receives the raw point ledger directly. Do not expand that retired LINE attachment path; either gate it only as migration safety or replace it with the target Web/PWA/Extension media pipeline using the same entitlement wrapper.
5. AI Pro provider-cost hard cap currently evaluates committed provider cost. Concurrent in-flight requests can still race near the TWD hard cap unless an estimated/in-flight provider-cost hold or another atomic admission boundary is added. Per-request caps bound risk but do not fully remove this race.
6. AI-limit SYSTEM notification helper exists, but actual hard-cap admission failure is not yet wired to emit the idempotent limit notification.
7. Existing migration-era normalization context may still contain legacy `chargedUserId` semantics. Target Web/PWA/Extension provider requests must charge the requesting user; the new entitlement gate intentionally prevents borrowing another user's entitlement.
8. Payment lifecycle remains disabled (`CHECKOUT_ENABLED=false`); payment provider, webhook idempotency, renewal/cancellation state and actual subscription SYSTEM callers remain incomplete.
9. Google Login and Apple Login callbacks remain incomplete. LINE Login is provider-neutral and uses shared onboarding.
10. Real Web Push/Cron/Task runtime and browser/provider validation remain pending.
11. Chrome extension real auth handoff/Source picker/durable Record persistence remains incomplete.
12. Retired `worklog/funding` and LINE-era provider/runtime/schema paths remain for migration and should be removed/isolate only after retained target dependencies are replaced.

## Exact next run plan

1. If executable checkout becomes available, pause feature expansion and run/fix first:
   - API typecheck;
   - entitlement/commercial/subscription + entitled-ledger focused tests;
   - Task/Push/Notification focused tests;
   - API Worker dry-run build;
   - Admin typecheck + commercial API tests + build;
   - Web typecheck + existing focused tests + build;
   - PostgreSQL entitlement/current-period/cost-cap + selected-scope + FREE trial/AI Pro config smoke.
2. If executable checkout remains unavailable, continue the next bounded provider-runtime batch:
   - make every retained provider-backed media/capture path use `EntitledAiPointLedgerService` without reviving LINE product behavior;
   - expose durable blocked/fair-use reasons to the target Web/PWA AI UI;
   - wire idempotent `AI_LIMIT_REACHED` SYSTEM notification at actual AI Pro hard-cap admission failure;
   - close the concurrent provider-cost hard-cap race with a bounded atomic/in-flight cost reservation design before paid launch.
3. Complete Google Login using provider-neutral provisioning + shared account onboarding; keep LINE Login; add Apple next.
4. Implement payment provider/AI Pro activation-renewal-cancellation lifecycle with deterministic SYSTEM notifications; keep checkout disabled until verified.
5. Complete target paid AI capture/search/related/summary/rewrite paths using the same entitlement/accounting boundary.
6. Continue Chrome extension in committed order: auth handoff -> Source picker -> quick text -> page context -> selected text -> quick voice -> screenshot/image AI entitlement -> permission/privacy/browser smoke/package.
7. Regenerate canonical baseline, rebuild disposable Dev/Prod, run runtime E2E, then remove/isolate remaining retired LINE/ONE_TIME/GROUP-funding code.

## Current estimated remaining development time

Approximately **18–38 focused development hours** remain.

Rough remaining allocation:

- executable validation + canonical baseline/clean DB rebuild fixes: **4–8h**;
- finish provider entitlement/cost hard-cap integration + AI-limit SYSTEM caller: **3–6h**;
- Google + Apple login completion/auth smoke: **3–5h**;
- payment/AI Pro lifecycle + deterministic SYSTEM callers: **2–4h**;
- natural-language search / related / summary / rewrite accepted gaps: **2–5h**;
- Chrome extension real auth/capture integration: **2–5h**;
- Web Push/Cron/PWA/browser/runtime smoke + final legacy cleanup: **2–5h**.

Largest uncertainty remains the first real API/Web/Admin compile/test pass, PostgreSQL target-schema rebuild, concurrent provider-cost hard-cap design, Web Push provider/browser smoke, and Dev runtime E2E. Narrow this estimate again after those execute.

## Next run checklist

- [ ] Read latest policy docs in required order and this checkpoint.
- [ ] Re-check for an executable checkout; if present, validate before adding more code.
- [ ] Gate/replace remaining provider media path with the shared entitlement wrapper.
- [ ] Add idempotent AI-limit SYSTEM caller and close provider-cost cap concurrency gap.
- [ ] Keep FREE manual behavior completely independent from provider AI failure/exhaustion.
- [ ] Keep V1 commercial shape exactly FREE + AI_PRO NT$99/month.
- [ ] Do not use GitHub Actions.
