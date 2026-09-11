# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`. Do not stage/commit the unrelated local `apps/api/verify-admin-schema.mjs` unless separately reviewed/approved.

## Current checkpoint — 2026-09-11 source cleanup complete; static validation PASS before latest UI work; PostgreSQL readiness PASS; Google Login runtime PASS; field-worker UI visual hierarchy refined

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

## Executable validation proven before latest UI redesign/refinement

User checkout: `D:\Project\after-trace`.

PASS before the latest UI-only commit batches:

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

The latest visual/UI commits have NOT YET been revalidated locally. Do not claim they passed until the user runs the Web validation commands again.

## Google Login runtime smoke — PASS

Real browser Google OAuth was exercised locally. The user successfully logged in with Google and reached the authenticated Worklog UI after account-provisioning defects were repaired. Public account id and one-time FREE AI trial state were visible. LINE Login real browser smoke is still pending.

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

## Field-worker UI/UX direction

Target audience: field workers, small workshops and small companies. Product UI should feel simple, practical and mobile-first rather than like an engineering/admin console.

The first refinement batch improved hierarchy, mobile bottom navigation, copy, empty states, task flows, AI Search examples and subscription wording. The user still found the result visually unattractive, so a second visual-system redesign was authored rather than continuing to tweak the same flat black style.

Second visual-system redesign checkpoint:

- `42e7e2b8` — replace the flat black/gray global theme with a more polished deep-blue neutral system, softer layered background, clearer primary/secondary buttons, stronger focus states and improved mobile bottom navigation.
- `ad69f340` — redesign Worklog, group, AI Search, subscription and help surfaces with consistent raised panels/cards, stronger spacing, chip/meta treatment and cleaner visual hierarchy.
- `f32887b7` — align Tasks with the new visual system, improve status/time treatment and card depth.
- `b072f7ac` — align account/notification chrome with the same visual language and simplify notification popover styling.
- `e87f8395` — record the second visual-system redesign handoff.

### Latest source-level visual refinement

After another self-review, the remaining weakness was that the deep-blue redesign still behaved visually like a SaaS/admin dashboard: too many equally weighted bordered surfaces, relatively heavy shadows and Record cards reading as a card wall rather than a chronological work stream.

Latest commits:

- `b62fe1a` — refine Worklog hierarchy: lighter setup surfaces, softer filters, GROUP setup visually secondary to daily work, Record list redesigned as a restrained chronological stream with timeline rail/dots, reduced card depth and denser mobile treatment.
- `5cac0d8` — soften the shared visual system: smaller desktop title scale, lighter shared panel/card shadows, quieter secondary buttons, cleaner fields, reduced border weight and app-like mobile bottom navigation with a compact active indicator.
- `45039d8` — simplify Record date filtering to day-level inputs. Filter start resolves to local-day 00:00:00.000 and filter end resolves to local-day 23:59:59.999 so the selected ending day is included in full; Record `occurred_at` editing remains date-time capable.

Current visual principles:

- dark mode remains, but avoid pure-black empty expanses;
- one restrained blue accent is used for primary action/current state instead of gray-on-gray everywhere;
- content width is constrained around 1080px desktop, with AI/Tasks/Subscription narrower where appropriate;
- panels/cards are reserved for meaningful grouping instead of putting every control inside an equally heavy container;
- Worklog Records should read as a chronological work stream, not an admin dashboard card grid;
- setup/configuration surfaces are visually quieter than day-to-day capture, records and tasks;
- primary actions use a distinct filled treatment; secondary actions stay quiet;
- mobile navigation remains fixed, touch-friendly and clearly marks the current section without large filled blocks;
- customer-facing copy avoids internal backend/domain terminology;
- empty states always explain what to do next;
- FREE trial is shown before paid upsell when available;
- user/account id remains visible and copyable, but does not dominate the header.

## Validation status for latest UI batch

AUTHORED / NOT YET EXECUTED after `b62fe1a` + `5cac0d8` + `45039d8`:

- `pnpm --filter @aftertrace/web typecheck`
- `pnpm --filter @aftertrace/web lint`
- `pnpm --filter @aftertrace/web test`
- `pnpm --filter @aftertrace/web build`

No GitHub Actions were run, rerun, enabled or modified.

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

1. Pull `revive/line-worklog`.
2. Run focused Web typecheck/lint/test/build.
3. Start local Web/API and capture representative desktop + mobile browser screenshots of Worklog first, then Tasks/AI Search/Subscription.
4. Review real rendering for spacing, density, horizontal overflow, timeline readability, account chrome, date-filter usability and mobile bottom-nav safe area. If rendering still feels visually weak, continue structural layout changes rather than cosmetic border tweaks.
5. Continue LINE Login, Gemini, Web Push/Cron, Chrome extension and NewebPay runtime smoke after UI is accepted.

`apps/api/verify-admin-schema.mjs` was not staged or committed. GitHub Actions were not run or modified.
