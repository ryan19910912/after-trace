# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-11 source cleanup complete; static validation PASS; PostgreSQL readiness PASS; Google Login runtime PASS; field-worker UI refinement iterated/authored

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. LINE remains only as provider-neutral LINE Login plus the external official LINE OA support link. Apple Login source remains available but is intentionally disabled for the current launch because the user is not enrolled in the paid Apple Developer Program. Current active launch login providers are Google + LINE.

Current prelaunch Dev/current Prod data remain disposable while no real customer data exists. Canonical target schema is `apps/api/src/db/schema-all.ts`.

## Product/commercial contract

- V1 exactly `FREE` NT$0 + `AI_PRO` NT$99/month.
- No ONE_TIME/TOP_UP or extra paid tier.
- FREE remains a complete manual product plus one idempotent Admin-configured AI trial grant.
- AI entitlement is per requesting user; GROUP only authorizes Source data.
- AI Pro uses monthly point/resource cap, provider-cost hard cap, optional per-request cap and capability toggles.
- V1 payment transport is NewebPay periodic card billing.
- No GROUP AI responsible-user/funding-owner concept.

## Target-only legacy cleanup — COMPLETE

Physically removed from target source/schema/tests/docs: LINE Messaging webhook/runtime, 小跡/GROUP bot, LINE Reply/cache/attachment runtime, bot-entry nonce/group identity state, Entity/Alias/Confirmation workflow, legacy Record entity/message ids, GROUP AI funding/responsibility, ONE_TIME/TOP_UP, and obsolete compatibility tests/docs. Do not restore them.

## Executable validation proven

User checkout: `D:\Project\after-trace`.

PASS:

- `pnpm install --frozen-lockfile`;
- regenerated canonical baseline guard;
- full monorepo TypeScript;
- full monorepo ESLint;
- Admin Vitest: 6 files / 20 tests;
- Web Vitest: 11 files / 41 tests;
- API Vitest: 59 files / 261 tests;
- Worker/API Wrangler dry-run build;
- Admin Vite production build;
- Web Vite production build;
- Extension static build step;
- Drizzle schema export;
- complete local `pnpm release:preflight`;
- canonical baseline/lockfile push to origin;
- `pnpm db:migrate` against the configured PostgreSQL database, including repeated idempotent migrator execution;
- `pnpm db:integrity` target integrity probes;
- local `/health` HTTP 200;
- local `/health/ready` HTTP 200 after Google/LINE/Web Push bindings and AI/commercial seed rows were initialized.

Evidence boundary: the user did not provide proof of a destructive empty-schema reset immediately before migration, so literal clean-from-empty rebuild remains unclaimed.

## Google Login runtime smoke — PASS

Real browser Google OAuth was exercised locally. The first callback reached the provider profile successfully but exposed two real account-provisioning defects:

1. `worklog_users.last_interaction_at` was still referenced by runtime SQL even though target schema had removed it.
   - fixed by `b1c1d32e` `[skip ci] align account provisioning with target user schema`.
2. first-login provisioning used sibling data-modifying CTE statements that attempted to UPDATE the newly INSERTed user in the same PostgreSQL statement snapshot, causing `ACCOUNT_IDENTITY_PROVISION_FAILED`.
   - fixed by `87c87743` `[skip ci] fix first-login account provisioning visibility` using a two-stage flow: atomic identity/public-account resolution followed by profile update/readback.

After the second fix, the user successfully logged in with Google and reached the authenticated Worklog UI. The resulting account/public id was visibly present, and onboarding had issued the one-time FREE AI Pro trial notification/500-point trial state. Therefore Google OAuth real browser/runtime smoke is now **PASS**.

LINE Login real browser smoke is still pending.

## Current runtime configuration

Readiness-required local config is proven present:

- target PostgreSQL schema;
- Google Login config;
- LINE Login config;
- valid Web Push VAPID config;
- Gemini API binding;
- AI runtime config singleton;
- FREE plan;
- AI_PRO plan;
- FREE initial AI trial config;
- Admin runtime config.

Apple Login is intentionally blank/disabled and is not a readiness requirement.

## Field-worker UI/UX refinement — AUTHORED / NOT YET EXECUTED

Target audience clarified: field workers, small workshops and small companies. The UI direction is mobile-first, task-first and lower-cognitive-load rather than developer/admin-oriented.

Initial authored `[skip ci]` UI commits:

- `dabded7b` — add `MobileBottomNav` for primary mobile navigation.
- `b2c75073` — mount mobile-first navigation on authenticated product surfaces.
- `51f828fc` — refine global visual system: smaller hierarchy, stronger controls, larger touch targets, reduced border noise, 1180px content width, mobile safe-area bottom nav.
- `a4e3ae87` — simplify Worklog/task/subscription visual surfaces; improve search/filter layout, record cards, responsive actions, subscription cards and help cards.
- `a18fb982` — simplify account/notification chrome; hide duplicated AI/Task top shortcuts on mobile, compact account id, improve notification panel hierarchy.
- `7c607fab` — rewrite Help as short task-oriented onboarding steps for non-technical users.

Iterative self-review commits after inspecting rendered screenshots and repeatedly re-reviewing source rather than stopping at an arbitrary round count:

- `39ec5a3a` — simplify AI Search wording, reduce technical explanation, add one-tap example queries and a narrower search surface.
- `134526c4` — restructure Tasks around current work: open/closed grouping, stronger empty-state CTA and shorter customer wording.
- `5c066249` — refine Task hierarchy/touch layout and reduce oversized empty surfaces.
- `7297dc4f` — remove customer-facing internal AI accounting language (`entitlement`, provider-cost/hard-cap wording) from Subscription UI.
- `ab7c2b90` — reduce global desktop title/width density after reviewing the first rendered UI pass.
- `23fc1a35` — make GROUP daily destinations visually primary, move the group list before create/join setup actions through layout ordering, narrow AI Search/Subscription surfaces, and add quick-search chip layout.
- `ca19fd95` — correct an upsell-order regression found during self-review by showing available FREE AI trial state before paid upgrade content and clarify the payment-email prerequisite.
- `1e78e354` — improve Worklog empty states with direct create/clear-filter actions; replace GROUP/internal-system vocabulary (`membership`, raw token/database explanation) with worker-facing copy; reduce feedback wording complexity.
- `8691b8c8` — polish Worklog hierarchy, make feedback visually secondary, and add dedicated record/group empty-state styling.
- `0838b4b9` — align authenticated account/notification chrome width with the final 1120px desktop content system.

Current UX review rule for this branch: repeat `edit -> code-level UI/UX review -> edit` until no obvious hierarchy, wording, target-audience, responsive or workflow defect remains. Browser screenshots are final render verification, not the primary mechanism for discovering obvious UX defects.

Design priorities now represented in source:

- daily work actions dominate over setup/support/commercial actions;
- desktop density is narrower and less presentation-like;
- mobile touch targets and fixed navigation remain prioritized;
- AI Search provides example questions instead of requiring users to invent prompt syntax;
- Tasks emphasize active work and actionable empty states;
- Worklog empty states distinguish no-data, filtered-no-result and empty-trash states and provide the next action;
- GROUP destinations are surfaced before create/join setup controls and customer copy avoids internal membership/token/database terminology;
- feedback is visually secondary to Records/Groups;
- customer Subscription copy no longer exposes provider cost, internal entitlement vocabulary or hard-cap implementation details;
- FREE trial availability is presented before paid upsell for eligible FREE users;
- Help remains task-oriented rather than implementation/documentation-oriented;
- notification center/account header retain required public account id / copy affordance while staying compact and aligned with the page grid.

The latest UI changes have **not yet been locally typechecked/linted/tested/built after these iterative commits**. Do not claim PASS until executable validation is run in the user's Windows checkout.

## Canonical Drizzle baseline

Validated regenerated baseline SQL/snapshot and `pnpm-lock.yaml` were pushed to `origin/revive/line-worklog` in commit `4e32854`.

Generated SQL/snapshot must not be hand-edited to simulate success.

## Remaining runtime verification

NOT RUN / NOT RUNTIME VERIFIED:

- clean-from-empty PostgreSQL rebuild unless separately proven;
- LINE Login real browser/runtime smoke;
- focused DB smoke for account lookup, Feedback, PRIVATE/GROUP Task authorization, FREE trial/AI Pro Grant accounting, provider-cost concurrency, lifecycle replay/stale cancel and Related ranking;
- Gemini real provider smoke;
- Chrome unpacked-extension browser smoke;
- Web Push real browser/delivery smoke;
- shared Cloudflare Cron runtime smoke;
- NewebPay TEST checkout/callback retry/idempotency/renew/cancel flow;
- Dev end-to-end smoke;
- actual Worker deployment.

## Exact next steps

1. Pull the latest iterative UI commits.
2. Run `pnpm --filter @aftertrace/web typecheck`, `pnpm --filter @aftertrace/web lint`, and `pnpm --filter @aftertrace/web test`.
3. Run `pnpm --filter @aftertrace/web build` or full `pnpm release:preflight` if focused Web validation passes.
4. Render-check representative desktop and mobile widths. Only concrete browser-render discrepancies should trigger another visual iteration; obvious source-level UX issues were reviewed before handoff.
5. Continue LINE Login, Gemini, Web Push/Cron, Chrome extension and NewebPay runtime smoke.

`apps/api/verify-admin-schema.mjs` was not staged or committed. GitHub Actions were not run or modified.
