# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-09 target-only legacy source cleanup complete; canonical baseline + executable validation remain

AFTERTRACE is Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the Record/GROUP/AI product surface and remains only as:

- provider-neutral LINE Login;
- the external official LINE OA support contact link.

User completion rule remains: compile/tests/runtime/deployment do not count toward functional completion. Under that rule, accepted V1 feature scope remains **100% source-authored**. Validation/release-readiness is separate and is not yet PASS/RUNTIME VERIFIED.

Current prelaunch Dev and current Prod data are disposable. Clean target-schema/canonical-baseline rebuilds remain allowed while no real customer data exists.

## Product/commercial contract

- V1 exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No one-time top-up / extra paid tier.
- FREE remains a complete manual product.
- New eligible FREE accounts receive one idempotent Admin-configured `free_initial_ai_trial_points` grant.
- AI entitlement is per requesting user; GROUP only authorizes Source data.
- AI Pro has monthly point/resource cap, provider-cost hard cap, optional per-request cap and capability toggles.
- V1 payment transport is NewebPay / 藍新信用卡定期定額.
- No target GROUP AI funding-owner/responsible-user concept.

## V1 functional scope — source-authored complete

Current branch source-authors provider-neutral Google/LINE/Apple auth, public account id, native groups/invites, manual Record CRUD/search/revisions/delete/restore, Tasks/reminders, notifications/PUSH/Admin announcements, Feedback/Admin workflow, FREE AI trial, AI Pro entitlement/accounting/cost caps, text/image/audio/file/PDF AI, natural-language search, Related Records, summaries, rewrite, AI Task proposal, Record-level AI actions, Chrome Extension V1 capture including screenshot/image AI, NewebPay periodic subscription transport, and target-first Admin surfaces.

## Target-only legacy cleanup — COMPLETE at source/schema/test/document level

Physical cleanup is now complete for the retired product generation covered by the development policy.

Removed from active source/schema/test surfaces:

- LINE Messaging webhook/runtime and `apps/api/src/line` runtime tree;
- 小跡 command / LINE GROUP bot behavior;
- LINE Reply/cache/edit orchestration;
- LINE attachment quoted-message ingestion runtime/schema;
- bot-entry / LINE GROUP Web-entry nonce schema;
- LINE OA friendship/product identity state;
- LINE GROUP ids as Source identity/authorization;
- Entity/Alias master-data workflow;
- title/entity confirmation workflow;
- legacy Record entity/message-id persistence;
- GROUP AI responsible-user/funding-owner schema/runtime;
- `ONE_TIME` / `TOP_UP` commercial product shape;
- retired LINE/CRM validation notes and obsolete tests;
- compatibility attachment shim that existed only to expose a legacy type name.

Target runtime paths now route only accepted V1 product surfaces. Retired route tombstones were removed; unsupported retired paths simply fall through to normal not-found behavior rather than keeping a legacy route contract alive.

`apps/api/src/db/schema-all.ts` now exports target schema modules only. The branch tree contains no retired LINE schema/runtime filenames from the removed product generation. Allowed LINE-related code is provider-neutral LINE Login and the external OA support link/config only.

## Latest cleanup batch

This final cleanup pass included the following source changes, all committed with `[skip ci]`:

- `f65f53f2` — remove retired legacy route tombstones from the Worker router;
- `1c011d03` — delete retired LINE normalization tests;
- `12874d47` — reduce text AI contract to target title/date/search-term interpretation only;
- `ae547948` — remove retired title-confirmation output from Gemini text capture;
- `1687fa5d` — align Gemini text tests to the target enrichment contract;
- `d8a08815` — replace retired LINE Record tests with PRIVATE/native-GROUP read tests;
- `78c1050f` — remove LINE Messaging readiness fixtures and keep provider-neutral Login readiness;
- `8f6d1bbe` — remove stale LINE-era local validation notes;
- `89b2b13f` — align AI text capture test provider output with the target contract;
- `494e0e83` — sync the Entity Model to physical target-only schema rules;
- `d958e1ec` — sync Deployment docs to remove temporary LINE Messaging requirements;
- `946abafc` — point AI media routes directly at the target-native `AiMediaProvider` contract;
- `003ed852` — delete the final retired attachment compatibility shim.

Tests modified in this cleanup are **AUTHORED / NOT RUN**.

## Latest validation-tooling batch — 2026-09-09

No new product/domain work was added because legacy cleanup is already complete.

This run found one stale release-tooling message in `scripts/regenerate-worklog-baseline.mjs`: after successful baseline generation it still instructed developers to keep existing environment databases and use a forward migration, which contradicted the current authoritative prelaunch policy allowing disposable Dev/current Prod databases to be cleanly rebuilt from the canonical target baseline.

Fixed with `[skip ci]` commit:

- `2efce4b9` — align baseline regeneration success guidance with the current disposable-prelaunch database policy.

This is tooling/documentation alignment only; it does not change product behavior, schema, generated Drizzle artifacts, or migration state.

## Previously fixed static defects

Earlier validation passes found and fixed important release defects including:

1. Feedback Admin public-account join.
2. AI Task hard-cap SYSTEM notification parity.
3. NewebPay callback stable idempotency facts.
4. Root API auth/PUSH/NewebPay bindings.
5. NewebPay AlterStatus version separation.
6. Provider-neutral Admin account lookup.
7. Target `/health/ready` schema/config checks.
8. Provider-neutral in-product Feedback session resolution.
9. Deploy verification for valid AI Pro/FREE-trial bootstrap-pending states.
10. Target-first canonical baseline guard.
11. PRIVATE Source task authorization.
12. Task deep-link login return preservation.
13. AI Pro `enabled=true` readiness check.
14. Active Task list ranking before closed history.
15. Extension screenshot session-expiry fail-fast behavior.
16. NewebPay cancel-at-period-end renewal-state UI.
17. Subscription cancel 401 session recovery.
18. AI Task provider-success settlement precedence over malformed proposal output.

These remain source/static findings unless separately recorded as executed PASS.

## Canonical Drizzle baseline — STATIC FAIL / known stale generated artifacts

`drizzle/0000_worklog_baseline.sql` and `drizzle/meta/0000_snapshot.json` still represent the older schema generation and are intentionally **not** hand-edited.

Current authoritative target schema is `apps/api/src/db/schema-all.ts`.

Required next action when an executable checkout is available:

1. generate a fresh canonical `drizzle/0000_worklog_baseline.sql` from current `schema-all.ts` using the repository regeneration flow;
2. regenerate matching Drizzle snapshot/journal metadata together;
3. run `scripts/check-worklog-baseline.mjs`;
4. apply the baseline to a fresh disposable PostgreSQL database.

Until that is done, canonical-baseline status is **FAIL / STALE**, not release-ready.

## Executable verification status

Actually attempted earlier:

- local checkout discovery under available execution storage — **FAIL**, no usable `.git` checkout;
- direct networked `git ls-remote` — **FAIL**, host resolution unavailable;
- one explicitly authorized temporary GitHub Actions attempt — **FAIL**, no workflow run was created; temporary trigger change was reverted.

Attempted again in the 2026-09-09 validation-tooling run:

- searched `/mnt/data`, `/home/oai/share`, `/workspace`, and `/workspaces` for a usable checkout — **FAIL**, no `.git` checkout or AFTERTRACE working tree was present;
- `git ls-remote https://github.com/ryan19910912/after-trace.git refs/heads/revive/line-worklog` — **FAIL**, execution environment DNS could not resolve `github.com`;
- GitHub connector reads/writes remained available, but they do not provide an executable working tree for `pnpm`, Drizzle generation, PostgreSQL, browser, or provider smoke.

GitHub Actions were not run, dispatched, rerun, enabled, or modified in this run.

Therefore still **NOT RUN** for the current target-only tree:

- API/Web/Admin TypeScript typecheck;
- ESLint;
- focused/full Vitest;
- Worker/Web/Admin builds;
- Drizzle schema export/regeneration;
- regenerated baseline guard;
- clean PostgreSQL rebuild;
- lifecycle/provider-cost concurrency DB smoke;
- NewebPay TEST checkout/callback/renew/cancel flow;
- Google/LINE/Apple OAuth smoke;
- Gemini provider smoke;
- Chrome unpacked-extension smoke;
- Push/Cron runtime smoke;
- Dev E2E.

No unexecuted item is claimed PASS or RUNTIME VERIFIED.

## Remaining blockers / risks

1. No executable repository checkout is available in the current tool environment, and direct GitHub network access from the execution container cannot resolve `github.com`; compile/test/build and generated baseline work cannot be run here.
2. Canonical Drizzle baseline + snapshot remain stale and must be regenerated from the now-clean target schema.
3. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL are not supplied in repository defaults.
4. NewebPay callback/AlterStatus still needs merchant TEST/sandbox verification.
5. PostgreSQL lifecycle/provider-cost concurrency needs executable DB verification.
6. OAuth/Gemini/Chrome/Push/Cron require real provider/browser/runtime smoke.

There is **no remaining known legacy LINE Messaging/Entity/Confirmation/GROUP-funding/ONE_TIME/TOP_UP source cleanup batch** to perform. Future work should not make more product-domain changes merely to continue cleanup; it should move to executable validation and canonical baseline regeneration.

## Exact next validation plan

When executable checkout becomes available:

1. `pnpm install --frozen-lockfile` if needed;
2. `pnpm release:preflight` and fix real compile/lint/test/build failures only;
3. regenerate canonical `drizzle/0000` + metadata from current `schema-all.ts` with `pnpm db:baseline:regenerate --confirm-prelaunch-reset` and run the V1 baseline guard;
4. clean rebuild disposable PostgreSQL;
5. focused DB smoke for account lookup, Feedback, Tasks PRIVATE/GROUP authorization, FREE trial/AI Pro grants, provider-cost concurrency, lifecycle replay/stale cancel and Related ranking;
6. NewebPay TEST checkout -> callback retry/idempotency -> renewal -> cancel;
7. Google/LINE/Apple + Gemini + Chrome + Push/Cron Dev smoke;
8. only then consider the branch release-ready.

## Remaining estimate

- Functional feature development: **0 focused hours**.
- Legacy product source/schema/test cleanup: **0 focused hours**.
- Validation/release-readiness after executable checkout: approximately **1.25–3.5 focused hours**, depending on failures discovered.

`apps/api/verify-admin-schema.mjs` was not staged or committed.
