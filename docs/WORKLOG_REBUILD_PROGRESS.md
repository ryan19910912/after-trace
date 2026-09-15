# AFTERTRACE Worklog Rebuild Progress

Durable development handoff for branch `revive/line-worklog`.

Before substantive work, read the latest documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`. Latest docs are authoritative.

Default rule: do not run/dispatch/rerun/enable/modify GitHub Actions unless the user explicitly authorizes it. Every normal development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-16 backend-driven subscription catalog AUTHORED / NOT RUN

AFTERTRACE remains Web + PWA-first with a compact Chrome extension fast-capture surface. `/` remains the Record home page. Search remains independent. LINE is only provider-neutral LINE Login plus the external LINE OA support link.

Prelaunch Dev data is disposable. Canonical target database remains one generated `drizzle/0000_worklog_baseline.sql` with comments and application-side domain validation.

## Current product boundary

FREE is a complete manual product and receives one Admin-configured one-time shared AI experience allowance usable across supported AI features. It does not refresh monthly.

Paid subscriptions are now intended to be fully backend-driven rather than tied to one hard-coded `AI_PRO` / NT$99 definition.

Admin-created enabled `SUBSCRIPTION` plans should appear automatically on the customer plan page. Checkout, provider callbacks, subscription lifecycle, monthly AI Grants, entitlement and cost admission must preserve/read the selected plan code and plan limits.

## Dynamic subscription implementation authored in this batch

- public `/api/v1/subscription/plans` now returns FREE plus all enabled/AI-enabled paid subscription plans rather than only exact code `AI_PRO`;
- Web Subscription UI renders backend plan code/name/price/caps and no longer filters to FREE/AI_PRO only;
- checkout modal sends the selected `planCode`;
- NewebPay checkout loads the selected plan from PostgreSQL and uses its DB display name + monthly price;
- checkout intent persists the selected plan code;
- NewebPay callback recovers the plan through checkout intent and validates provider amount against the selected plan price;
- lifecycle ACTIVATE/RENEW/CANCEL now accepts/preserves dynamic plan codes;
- subscription history and period Grants use the actual selected plan code;
- paid AI entitlement resolves whichever paid SUBSCRIPTION plan is actually active;
- provider-cost admission no longer requires exact code `AI_PRO` / price 99;
- readiness now requires FREE plus at least one valid enabled paid subscription plan rather than exact `AI_PRO` / NT$99;
- only one active paid subscription is allowed at a time;
- cancellation preserves paid access until current period end; later purchase uses a new checkout;
- NewebPay periodic online purchase currently requires a positive integer-TWD monthly price.

## FREE AI experience

FREE trial remains one shared balance for:

- AI text organization;
- AI Search;
- image/audio/file/PDF AI;
- Chrome screenshot AI;
- related Records;
- time-range summaries;
- rewrite;
- AI task proposals.

Browser/device speech-to-text remains free and does not consume provider AI points.

## Auth / notification findings

Fresh Dev DB Google login previously returned an unhandled 500. FREE trial NULL handling was fixed, and post-login welcome notification failure is now non-fatal so login itself is not coupled to a non-critical notification write.

Important remaining cleanup: handwritten notification SQL still needs to be checked for stale PostgreSQL enum casts after enum removal. The application policy remains no PostgreSQL application-domain ENUM types/casts.

## Canonical baseline / Dev DB

No schema change is required for the dynamic paid-plan catalog batch. Existing generic plan, checkout-intent, subscription, lifecycle and Grant columns already carry plan codes.

Accepted clean-reset procedure remains:

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
```

Do not reset the database for this dynamic-plan code refactor unless a separate schema issue requires it.

## Last known executable validation

A prior local run before the current dynamic-subscription batch passed:

- monorepo typecheck: PASS;
- Admin tests: 20/20 PASS;
- API tests: 270/270 PASS;
- Web tests: 41/41 PASS;
- lint: PASS;
- Admin/API/Web/Extension builds: PASS.

Later API-only testing also showed API tests 270/270 passing while one temporary typecheck issue was fixed afterward.

**Current dynamic subscription batch is AUTHORED / NOT RUN. Do not claim PASS until the user reruns validation.**

No GitHub Actions were run or modified.

## Database/schema rules

- one canonical prelaunch SQL baseline;
- every persistent table/column has PostgreSQL COMMENT metadata;
- no PostgreSQL enum for application domain/status values;
- no stale casts to removed application enum types in handwritten SQL;
- no business/domain CHECK constraints;
- structural PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT stay in PostgreSQL;
- statuses, feature rules, pricing, subscription availability, point/media limits and transitions remain application logic.

## Validation/runtime remaining

Run locally after pulling latest:

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

If PASS, deploy API + Web:

```text
pnpm deploy:dev:api
pnpm deploy:dev:web
```

Then runtime-smoke at least:

- Admin enabled plan `AI_PRO_99` appears on customer plan page;
- displayed plan name/price/cap match Admin values;
- selected plan code is sent to checkout;
- NewebPay TEST checkout amount/product description match DB plan;
- successful callback activates the same plan code;
- monthly AI entitlement uses that plan's configured point/cost caps;
- cancellation stops renewal but keeps access through period end;
- after expiry, a fresh checkout can purchase any currently enabled plan;
- FREE trial AI paths continue to work;
- Google + LINE Login real-browser smoke;
- notification center/welcome notification after fresh-account login.

GitHub Actions remain disabled unless explicitly requested.
