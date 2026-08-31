# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a sports venue availability search + Radar PWA. V1 has no AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public and private official booking sources, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Taipei City is the primary launch market. Private official booking coverage is a core requirement; adjacent New Taipei coverage is acceptable when it validates a reusable booking-system adapter.

## Current architecture / completed product work

- Retired LINE/LIFF/Group Memory/Gemini/Energy/Credit/Ads/Commerce/Reminder/Proactive runtime is removed.
- `apps/` contains only `api` and `web`.
- Current DB source files are only `schema.ts`, `schema-notifications.ts`, `schema-source-runtime.ts`, `schema-all.ts` and `client.ts`; old `schema-round*` files are absent from `main`.
- `AvailabilitySourceAdapter` registry is multi-source; registered adapters are `TaipeiSportsCenterAdapter` and `TinyBookAdapter`.
- Generic normalized domain supports badminton/table-tennis/squash/tennis/pickleball/basketball.
- Metadata refresh is registry-driven and source-isolated.
- Polling uses claim fencing plus exact-target freshness; stale provider truth fails closed.
- Search is city/district/venue aware and exposes source identity + latest successful target poll time.
- Radar supports date range, optional weekdays, time window, edit, pause/resume and delete.
- Push only presents accepted `SENT` deliveries after current truth is revalidated.
- Notification deep links carry city and retain venue-authoritative restoration for historical links.
- PWA provides mixed-source search, source/freshness visibility, official handoff, Radar management and Web Push.

Current migration chain remains `0000` → `0003`.

## Legacy code/schema audit — 2026-08-31

A fresh source-tree/schema audit was performed after the product rebuild.

### Current repository result

The current runtime and Drizzle schema contain no retired LINE-first product tables/modules. Current product tables are limited to sports/Radar concerns (`users`, source/sport/venue/court/availability/watch/push/polling/runtime tables).

GitHub code search also returned no current matches for the old LINE/memory/Energy/Commerce runtime terms inspected in this audit.

### Existing old database caveat

`drizzle/0000_aftertrace_rebuild.sql` was originally written for a fresh Neon database. Its legacy guard only aborts when representative old tables are detected; it does **not** delete an already-existing legacy schema.

Because the product owner has explicitly decided the retired product data does not need to be preserved, a destructive one-time cleanup script is now committed:

- `scripts/drop-retired-product-schema.sql`

It hard-deletes the known retired LINE/group/conversation/memory/credit/AI/Energy/rewarded-ad/reminder/commerce/proactive/web-auth/settings tables and their retired enum types using `DROP ... IF EXISTS ... CASCADE`.

It intentionally does **not** drop the current sports/Radar `users` table.

If production/dev uses a brand-new Neon branch, this script is unnecessary. If an old AFTERTRACE database is reused, run the cleanup script before applying the sports/Radar baseline. Actual database execution has not been performed from this environment.

Relevant commit:

- `4c6175bd707e077bb6ce7fb1aec096c7fd0fdd08` — `Add destructive legacy schema cleanup`

## Private-source status

### TinyBook — integrated

`TinyBookAdapter` is the first private booking-system adapter. Current curated court-rental products include Pickle Day 新光 A11 4F and Pickle Day 中和俱樂部. It reads the normal anonymous WooCommerce Bookings flow and fails closed on malformed provider responses.

Live anonymous POST/XHR smoke remains deferred to verification.

### AiNFOLiNK — blocked on transport capture

Public booking UI and multiple real consumer tenants are confirmed, including Taipei Pickle Pickle and badminton tenants. What is still missing is the exact anonymous browser request contract that loads date/court availability.

**User-assisted capture requested:** open a public AiNFOLiNK booking page while logged out, DevTools → Network → Fetch/XHR, reload/change booking date, then send the request that changes availability as **Copy as cURL** plus its response body. Cookies/auth values may be redacted if present; no login/security bypass is wanted.

Once one normal anonymous availability request is reproducible, implement `AiNFOLiNKAdapter` immediately.

### PickleBook / PickleTown — blocked on transport/SSR capture

Official public booking matrices are confirmed and show court × time status and prices. The missing piece is a stable raw JSON/XHR or server-rendered data contract.

**User-assisted capture requested:** on the official public booking matrix, DevTools → Network → Fetch/XHR, reload and change date; send the relevant request as cURL plus response. If there is no XHR, send the page/document response or embedded Next.js/RSC/JSON payload that changes with the date.

Once reproducible, implement a system-level adapter rather than a venue-specific scraper.

## Remaining function/source work — highest priority first

1. Use user-captured AiNFOLiNK or PickleBook request/response to implement the next private booking-system adapter.
2. Continue verified Taipei private-court discovery without padding coverage with rooms/classes/LINE-only flows.
3. Finish mixed-source semantics review: booking horizon, slot duration, dynamic prices and source minimum intervals.
4. Finish small mixed-source PWA polish, including source labeling in venue selection where useful.
5. Keep removing any retired source/config artifact found by inspection; current runtime/schema audit is clean.

## Verification intentionally deferred

Per current strategy, functional/source work remains ahead of general verification. The following are not yet claimed green:

- regenerate `pnpm-lock.yaml`;
- full `typecheck`, `lint`, `test`, `build`, `db:schema:check`;
- migrations on a fresh/clean Neon branch;
- Worker `DATABASE_URL` + VAPID configuration;
- live TinyBook and future private-adapter smoke;
- deploy Worker/PWA + `/ready`;
- real-device polling → Radar → Push → click;
- provider latency/rate-limit measurements.

## Next round priority

If the user supplies AiNFOLiNK/PickleBook cURL + response, stop researching that transport and implement the adapter directly. Otherwise continue private-source acquisition plus mixed-source edge-case cleanup; do not return to repetitive build/test attempts yet.
