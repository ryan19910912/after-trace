# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-08 V1 functional scope remains 100% source-authored; static validation continues to find/fix release defects; executable validation still blocked

AFTERTRACE is Web + PWA-first with a compact Chrome extension fast-capture surface. LINE is retired from the core Record/GROUP/AI product surface and remains only as a provider-neutral login provider plus official OA support channel.

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

## Static validation defects found/fixed so far

1. Feedback Admin joined wrong public-account table -> `32492d9e`.
2. AI Task hard-cap path lacked AI-limit SYSTEM notification parity -> `589e138b`.
3. NewebPay callback idempotency used wall-clock fallback -> stable provider facts required, `51868af5`.
4. Root API bindings omitted Google/Apple/Web Push/NewebPay -> `7e8f1ce9`.
5. NewebPay AlterStatus incorrectly reused checkout 1.5 -> separate `Version=1.0`, `7b2be28a`; regression test `0ed1e0ec` AUTHORED / NOT RUN.
6. Admin `/accounts` still depended on legacy LINE/OA/GROUP AI responsibility -> target-facing query detached, `c1559d8a`; unused alternate route removed `26180c5c`.
7. `/health/ready` still validated retired LINE-era schema/config -> target readiness + thin Worker entry, `c3bbd8d3`, `d7afaf42`, `b3a8b089`.
8. Retired `/webhooks/line` remained reachable -> 410 outer tombstone, `d83f0e72`.
9. In-product Feedback still resolved session via `lineUserId` -> provider-neutral route, `31506bfa`, `ee77a6a0`.
10. Retired confirmations/funding/generic Worklog routes remained reachable -> target allowlist/tombstones, `459a60b6`, `fb0b6d42`.
11. Deploy verification missed legitimate AI Pro/FREE-trial bootstrap-pending readiness states -> `7723c337`.
12. Baseline guard enforced retired LINE-era schema -> V1 target-first guard, `d879ce1e`.
13. Task creation authorized every Source only through `worklog_source_members`, incorrectly blocking PRIVATE owner Sources -> PRIVATE owner OR active GROUP member authorization, `2f133faa`.
14. `/tasks/:id` notification deep-link was lost when session expired because login return only allowed `/tasks` -> bounded `/tasks/<positive-id>` return + TaskRoot preserves focused id, `8cee0772`, `3ec94c38`.
15. Target readiness checked AI Pro type/price/AI/caps but not `enabled=true` -> `8a870682`.
16. Bounded Task list could let old completed/cancelled rows crowd active Tasks out of the first 100 -> OPEN tasks rank first; closed history ranks by latest update, `c451c263`.
17. Extension screenshot AI helper did not enforce the locally-known bounded `sessionExpiresAt` before sending an otherwise guaranteed-failing request -> fail-fast expiry validation aligned with popup auth, `4aa7f03a`.
18. AI Pro cancel-at-period-end left core entitlement correctly ACTIVE, but Subscription UI could not distinguish NewebPay `TERMINATED` from auto-renew ACTIVE and kept offering a second cancel action -> adapter renewal state exposed from `/subscription/plans` and UI now shows cancelled-renewal state, `85b7ae0c`, `3284962e`.
19. Subscription cancel path did not clear/recover an expired Web session on 401 unlike bootstrap/checkout -> aligned session recovery, `9508268b`.
20. AI Task provider-success + invalid proposal output could swallow a usage settlement failure and report only output invalid -> provider success now requires confirmed `COMMITTED` usage settlement before output validation result is returned; accounting failure wins, `abe26262`.

## Additional static verification in latest passes

- Manual Record allowlisted backend uses `verifyWebSessionToken + resolveWebSessionUserId`: **STATIC VERIFIED provider-neutral**.
- Web session token accepts provider-neutral userId with empty migration-only LINE id: **STATIC VERIFIED**.
- Task reminder claim + notification creation happen in one PostgreSQL statement; insert failure rolls back the claim: **STATIC VERIFIED transaction shape**.
- Notification-center and Service Worker deep-link helpers reject external/protocol-relative destinations and keep same-origin relative paths: **STATIC VERIFIED**.
- Native GROUP create writes OWNER membership in the same SQL statement; invite join uses row locking and bounded use counts: **STATIC VERIFIED**.
- Feedback provider-neutral write fields match current durable schema; Feedback workflow change + audit are one PostgreSQL statement: **STATIC VERIFIED**.
- Record and Record Revision `occurred_at` fields are nullable in current target schema: **STATIC VERIFIED**.
- AI entitlement prefers current AI Pro over FREE trial, authorizes PRIVATE owner / GROUP member, uses `[periodStart, periodEnd)` and exact current period Grant: **STATIC VERIFIED source shape**.
- Public account id provisioning is atomic with provider identity and retries the exact public-account unique collision up to 8 times: **STATIC VERIFIED**.
- Extension screenshot/image AI is genuinely implemented in `screenshot-ai.js`: visible PNG -> `/api/v1/ai/capture/image` -> shared Source authorization / AI entitlement / provider-cost accounting; earlier suspicion that screenshot was preview-only is withdrawn.
- NewebPay adapter status values exposed to customer UI match schema constraint exactly: `PENDING | ACTIVE | TERMINATED | FAILED`: **STATIC VERIFIED**.

## GitHub Actions trial

User explicitly authorized one Actions attempt on 2026-09-08. Existing CI was validation-only (typecheck/lint/test/build/Drizzle export, no deployment). Branch push trigger was temporarily enabled in `9580bd4f`, but query returned `total_count: 0`; no run was created. Temporary trigger was restored to main-only in `a2596e85`. Status: **FAIL / unavailable execution path**. Do not retry Actions unless user explicitly authorizes again.

## Canonical Drizzle baseline — STATIC FAIL

`drizzle/0000_worklog_baseline.sql` is still stale relative to target schema, including legacy non-null LINE identity / GROUP LINE identity assumptions and missing current identity/notification/task/Feedback/NewebPay/provider-cost/lifecycle state.

Status: **FAIL — canonical baseline must be regenerated from `apps/api/src/db/schema-all.ts` together with snapshot + journal before clean DB validation/deployment.** Do not hand-edit the baseline to simulate success.

## Executable verification status

Actually attempted earlier:

- local checkout discovery under available `/mnt/data` and `/home/oai` — **FAIL**, no `.git` checkout;
- direct `git ls-remote` — **FAIL**, `Could not resolve host: github.com`;
- temporary GitHub Actions validation — **FAIL**, no workflow run created.

Therefore still **NOT RUN**:

- API/Web/Admin TypeScript typecheck;
- ESLint;
- focused/full Vitest;
- Worker/Web/Admin builds;
- Drizzle schema export;
- regenerated baseline guard;
- clean PostgreSQL rebuild;
- NewebPay sandbox flow;
- lifecycle/provider-cost concurrency smoke;
- Google/LINE/Apple OAuth smoke;
- Gemini provider smoke;
- Chrome unpacked-extension smoke;
- Push/Cron runtime smoke;
- Dev E2E.

No unexecuted item is claimed PASS or RUNTIME VERIFIED.

## Known remaining blockers / risks

1. No executable checkout/networked git in current execution environment.
2. GitHub Actions trial produced no run.
3. Canonical `drizzle/0000` is stale.
4. Real NewebPay MerchantID/HashKey/HashIV/NotifyURL/ReturnURL not yet supplied.
5. NewebPay callback/AlterStatus needs sandbox verification against the merchant account.
6. PostgreSQL lifecycle/provider-cost concurrency remains unverified.
7. OAuth/Gemini/Chrome/Push/Cron require real provider/browser/runtime smoke.
8. Legacy LINE/ONE_TIME/GROUP-funding/confirmation source/schema remain migration residue, though main customer runtime tombstones retired paths. Physical deletion waits for executable dependency proof.
9. Manual deploy still requires legacy LINE Messaging token/secret because retained legacy modules are still compiled/delegated outside target customer paths; remove only with physical legacy-runtime deletion after typecheck/build proof.

## Exact next validation plan

When executable checkout becomes available:

1. `pnpm install --frozen-lockfile` if needed;
2. `pnpm release:preflight`, fix compile/lint/test/build failures;
3. regenerate canonical `drizzle/0000` + metadata from `schema-all.ts` and run V1 baseline guard;
4. clean rebuild disposable PostgreSQL;
5. focused DB smoke for account lookup, Feedback, Tasks PRIVATE/GROUP authorization, FREE trial/AI Pro grants, provider-cost concurrency, lifecycle replay/stale cancel, Related ranking;
6. NewebPay TEST checkout -> callback retry/idempotency -> renewal -> cancel;
7. Google/LINE/Apple + Gemini + Chrome + Push/Cron Dev smoke;
8. after dependency proof, physically remove retired LINE/ONE_TIME/GROUP-funding/confirmation source/schema and legacy LINE Messaging deploy requirements.

## Remaining estimate

- Functional scope: **0 focused feature-development hours**.
- Validation/release-readiness after executable checkout: approximately **1.25–3.5 focused hours**.

`apps/api/verify-admin-schema.mjs` was not staged or committed.