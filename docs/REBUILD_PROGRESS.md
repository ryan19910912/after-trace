# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a sports venue availability search + Radar PWA. V1 has no AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public and private official booking sources, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Taipei City is the primary launch market. Private official booking coverage is a core V1 requirement; adjacent New Taipei coverage is acceptable when it validates a reusable booking-system source and improves real coverage.

## Actual current architecture

The retired LINE-first product is absent from runtime. `apps/` contains only `api` and `web`; LINE group/LIFF, Group Memory, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention runtime and legacy schema modules are removed.

Current flow:

1. `AvailabilitySourceAdapter` isolates provider response shapes; registry is multi-source.
2. Registered adapters are `TaipeiSportsCenterAdapter` and `TinyBookAdapter`.
3. Generic ingestion supports badminton/table-tennis/squash/tennis/pickleball/basketball while each source can narrow `ingestSportCodes`.
4. Metadata refresh is registry-driven and source-isolated through `source_metadata_runtime`.
5. Polling uses `poll_targets`; `last_polled_at` is claim fence and `last_success_at` freshness anchor. Court/slot/event/missing-slot/settlement writes are fenced.
6. Search/Radar/Push require exact-target freshness within `max(15 minutes, 3 × target interval)` and future Taipei-local actionability; recovery after a prolonged stale gap emits a new AVAILABLE event.
7. Search supports city + district + venue, and availability rows expose venue city.
8. Anonymous browser identities own Radar rules. Radar stores the selected/actual venue city instead of hardcoding Taipei.
9. Radar produces durable Web Push deliveries; only Push-service acceptance settles to SENT; presentation consumes only accepted SENT rows and fails closed on stale truth.
10. Web/PWA provides mixed-source search, official booking handoff, Radar CRUD, Push subscription and notification deep links.

Migration chain remains `0000` → `0003`; no migration was required this round.

## Completed rebuild areas

### Retired product cleanup
- [x] LINE/group/LIFF runtime removed.
- [x] conversation extraction/Group Memory/Gemini/AI removed.
- [x] Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push removed.
- [x] old admin/auth/retention schema/runtime removed.

### Availability / polling
- [x] generic adapter + registry + provider-error contract.
- [x] generic multi-sport ingestion with source-specific narrowing.
- [x] Taipei sports-center public adapter.
- [x] TinyBook private booking-system adapter.
- [x] normalized source/sport/venue/court/slot/event pipeline.
- [x] registry-driven metadata refresh + provider-failure isolation.
- [x] poll demand/source interval clamp/claim fencing/freshness/recovery.
- [x] city-aware availability search and response contract.

### Radar / Push / PWA
- [x] anonymous identity + watch CRUD/idempotency/isolation.
- [x] active catalog/geographic validation + city canonicalization.
- [x] current AVAILABLE + exact-target freshness matching.
- [x] durable Push/retry/expiry/dispatch fencing.
- [x] accepted-only presentation and fail-closed final validation.
- [x] mobile search + official booking handoff + Radar management + Push subscription/deep link.
- [x] PWA city selector and city-aware Radar creation; no hardcoded Taipei rule for a New Taipei private venue.

## Current round — expand private TinyBook coverage + remove Taipei-only UI assumption

### Starting state verified

At round start latest `main` was `a2215778090e30bfed73129ee270ec6ab0e9c854` (`Record TinyBook private adapter integration`). `REBUILD_PLAN.md`, this file, `tinybook.ts`, generic source contract/synchronizer, availability query/repository, and web search/Radar code were re-read before changes.

Starting truth:

- TinyBook had one curated private venue: Pickle Day 新光 A11 4F in Taipei;
- A11 is explicitly a limited-time product and uses a 72-hour horizon;
- backend/source model already stores city, but availability search had no city query/response field;
- the PWA hardcoded `city: '臺北市'` when creating a Radar, which would make a future New Taipei/private venue watch internally inconsistent;
- TinyBook AJAX fallback assumed the first pathname segment was always the WordPress tenant root, which is wrong for root installs whose booking URL is `/product/...`.

### Private-source research this round

#### Pickle Day 中和 — promoted into TinyBookAdapter

Official Pickle Day/TinyBook pages currently show a stable Zhonghe flagship booking product in addition to the A11 limited-time product.

Verified source semantics as of 2026-08-31:

- official address: `新北市中和區錦和路388號2樓`;
- official site says reservations are handled through the same TinyBook website;
- booking opens three weeks ahead;
- court rental is one-hour units;
- four dedicated pickleball courts are listed;
- peak/off-peak prices vary (`NT$1,200` / `NT$1,000`), so AFTERTRACE intentionally does not persist a fake single slot price for this venue.

This is useful because it validates a second venue on the same system-level adapter with a different city, booking horizon, slot length and pricing model. It is not a second one-off crawler.

#### Other private systems/tenants still under research

- **AiNFOLiNK** remains the strongest distinct-system candidate. Its official site still describes online court booking/payment/member/order management and names badminton customers such as 格恩羽球館、佛雷斯羽球館、動智AI羽球館. The exact anonymous consumer current-slot transport is still unresolved; no adapter should be guessed until that is found.
- TinyBook search also surfaced sports tenants such as 夢想體育學院-三蘆運動園區 and other badminton/basketball booking products, but those are outside Taipei City and are not automatically ingested. Curated ingestion remains deliberate.
- Search did not yet identify another clearly verified Taipei City private court-rental TinyBook tenant beyond Pickle Day A11; continue looking rather than padding source count with generic room rentals.

### Code completed this round

#### `apps/api/src/sources/tinybook.ts`

- added `Pickle Day 中和俱樂部` as the second curated TinyBook venue;
- city `新北市`, district `中和區`, sport `pickleball`;
- 21-day/504-hour booking horizon;
- 60-minute normalized minimum slot;
- no fixed price because official pricing varies by time;
- retained a single `TinyBookAdapter`; both Pickle Day products use the same WooCommerce Bookings transport;
- generalized the duration-unit comment so it no longer assumes all TinyBook products are A11/30-minute products;
- hardened `findBookingAjaxUrl()` so WordPress base path is derived from the path before `/product/` rather than blindly using the first URL segment;
- parsed AJAX URLs are accepted only when HTTPS and same-origin with the official product page; otherwise the adapter falls back to the same-site WordPress endpoint.

#### `apps/api/src/availability/query.ts`

- added optional `city` filter to availability search.

#### `apps/api/src/availability/repository.ts`

- availability rows now return `city`;
- search can filter by city;
- venue/result ordering includes city for deterministic mixed-city output.

#### `apps/web/src/api.ts`

- `AvailabilitySlot` now includes `city`;
- client search accepts/sends city.

#### `apps/web/src/App.tsx`

- added city selector derived from active venues for the selected sport;
- venue list is filtered to the selected city;
- switching city clears incompatible venue/district state;
- search sends actual city;
- Radar creation stores `selectedVenue.city`/selected city instead of hardcoded `臺北市`;
- result cards display real city + district;
- Radar cards show city/district for area-wide watches.

Relevant commits before this progress update:

- `bc569a0ab7db198d427195eb7e8487f416b64fc5` — `Add city to availability search`
- `f9e454518bf6909237d4a66e7a3163b7cd0f416a` — `Make availability search city-aware`
- `56c7f2033deac3169688e975c2b1ac54196854c8` — `Expose city in mixed-source search`
- `0e61e45e2263f497ec73551473e2544ca9274415` — `Make PWA search and Radar city-aware`
- `e2f905cbb0a913c4aeac5af581836b0db7661b35` — `Expand and harden TinyBook private coverage`
- `37786e00a6f83e503a52b31689af29089f0b1eb4` — `Expand private-source and mixed-city plan`

### Verification intentionally deferred

Per current product strategy this round did not spend time on pnpm installation, lockfile regeneration, full typecheck/lint/test/build/schema checks, CI, migration rehearsal, PowerShell deploy scripts, Neon or Cloudflare deployment.

No schema migration was needed.

The current environment can inspect official public TinyBook pages and current WooCommerce booking behavior, but still cannot execute the tenant's browser POST/XHR end-to-end. Therefore A11 and Zhonghe `wc_bookings_get_blocks` responses remain **not live-smoked**, and repository build/test status remains unverified rather than green.

## Remaining function/source work — highest priority first

1. Continue private-source research every round, with highest priority on resolving AiNFOLiNK's anonymous consumer availability transport or another Taipei booking SaaS used by multiple sports venues.
2. Look for additional real Taipei City TinyBook sports/court products; do not ingest generic room rentals merely to increase source count.
3. Source-inspect TinyBook response semantics that can affect truth: empty-day response vs provider failure, resource markup variants, duration/price changes, and whether one-duration-unit start blocks always match the curated minimum slot.
4. Revisit notification/deep-link presentation with mixed-city venues. The deep link already carries unique `venueId`, but the presentation payload currently does not explicitly include city; ensure the PWA restores city cleanly for a New Taipei venue rather than relying on default Taipei UI state.
5. Inspect any remaining mixed-source functional gaps caused by different booking horizons, slot lengths, source minimum intervals and variable prices.

## Deferred release verification

- regenerate `pnpm-lock.yaml` and remove stale workspace metadata through pnpm;
- full `typecheck`, `lint`, `test`, `build`, `db:schema:check`;
- migrations `0000`→`0003` on fresh Neon;
- configure Worker `DATABASE_URL` + VAPID;
- live TinyBook A11 + Zhonghe smoke: product → resources → `wc_bookings_get_blocks` → normalized slots;
- deploy Worker/PWA and confirm `/ready = 200`;
- live public + private polling → transition/re-confirmation → Radar → Push → presentation → click;
- measure provider latency/rate limits before lowering private polling intervals.

## Next round priority

Do not return to general build/test yet. Continue private-source acquisition first, especially AiNFOLiNK/Taipei private venue systems. In parallel, close the mixed-city Push deep-link/UI restoration gap and harden TinyBook empty/error/duration semantics if source inspection reveals a safe concrete fix.
