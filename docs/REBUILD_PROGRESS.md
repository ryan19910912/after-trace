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

The product owner has decided to use a brand-new Neon database/branch for the rebuilt sports/Radar product, so destructive legacy cleanup is not part of the active migration path. The temporary cleanup script that had been added for a reused legacy database was removed again in commit `2ce3edfa61aaa616d9f0300c92024bdd639655ee`.

Actual database execution has not been performed from this environment.

## Private-source status

### TinyBook — integrated

`TinyBookAdapter` is the first private booking-system adapter. Current curated court-rental products include Pickle Day 新光 A11 4F and Pickle Day 中和俱樂部. It reads the normal anonymous WooCommerce Bookings flow and fails closed on malformed provider responses.

Live anonymous POST/XHR smoke remains deferred to verification.

### AiNFOLiNK — anonymous availability transport resolved; time mapping remains

The prior transport blocker is resolved. AiNFOLiNK exposes a reusable anonymous availability endpoint of the form:

`https://<tenant>-backend.ainfolink.net/api/booking-item/available?booking_date=YYYY-MM-DD&booking_period_id=1,2,3`

Known backend tenants currently include:

- `flex-backend.ainfolink.net`
- `sunny-backend.ainfolink.net`
- `pickleball-backend.ainfolink.net`

The verified response contract is:

- `content[]` = courts/resources;
- `venue_id` = court ID;
- `display_name` = court name;
- `booking_type`;
- `shared_capacity`;
- `available[]` rows contain `booking_date`, `booking_hours_code`, `time_slot`, `unit_price`, `quantity`;
- `quantity > 0` means AVAILABLE;
- `quantity = 0` means UNAVAILABLE;
- `unit_price` is the real slot price;
- the external slot key must include `booking_date + booking_hours_code + time_slot`;
- provider responses may include rows outside the requested date, so the adapter must filter each row by `booking_date` again.

The same contract has been observed across pickleball, badminton, billiards and multi-purpose resources. `time_slot` may be `null` for some tenants and `1`/`2` for others. This makes AiNFOLiNK suitable for one config-driven system adapter rather than one parser per venue.

**Only remaining blocker before registering `AiNFOLiNKAdapter`:** obtain the normal consumer-flow mapping from `booking_hours_code + time_slot` to actual `startTime/endTime`. Do not infer that a numeric code equals an hour and do not infer that `time_slot=1/2` means first/second half-hour. The mapping must come from a public booking-period / booking-hours / time-slot / setting / config API or equivalent response used by the normal anonymous frontend.

Public web research confirms that AiNFOLiNK exposes live booking UIs and treats time-slot configuration and price tiers as first-class venue settings, but the exact raw mapping contract was not exposed by the searchable/indexed public pages inspected in this round. No guessed runtime mapping was committed.

Once that mapping is reproducible, implement `AiNFOLiNKAdapter` immediately and wire it through registry → metadata sync → courts → normalized availability → polling → Radar → Push. Tenant definitions must remain config-driven.

### PickleBook / PickleTown — blocked on transport/SSR capture

Official public booking matrices are confirmed and show court × time status and prices. The missing piece is a stable raw JSON/XHR or server-rendered data contract.

**User-assisted capture requested:** on the official public booking matrix, DevTools → Network → Fetch/XHR, reload and change date; send the relevant request as cURL plus response. If there is no XHR, send the page/document response or embedded Next.js/RSC/JSON payload that changes with the date.

Once reproducible, implement a system-level adapter rather than a venue-specific scraper.

## Remaining function/source work — highest priority first

1. Resolve AiNFOLiNK's public time mapping (`booking_hours_code + time_slot` → start/end) and then implement the config-driven `AiNFOLiNKAdapter`.
2. Continue PickleBook/PickleTown transport discovery in parallel if AiNFOLiNK mapping remains externally opaque.
3. Continue verified Taipei private-court discovery without padding coverage with rooms/classes/LINE-only flows.
4. Finish mixed-source semantics review: booking horizon, slot duration, dynamic prices and source minimum intervals.
5. Finish small mixed-source PWA polish, including source labeling in venue selection where useful.
6. Keep removing any retired source/config artifact found by inspection; current runtime/schema audit is clean.

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

Do not research AiNFOLiNK availability transport again: that endpoint is already known. Start from the time-mapping blocker. If a normal anonymous booking-period / booking-hours / setting response is obtained, implement and register the adapter in the same round. Otherwise continue PickleBook/private-source acquisition plus mixed-source edge-case cleanup; do not return to repetitive build/test attempts yet.
