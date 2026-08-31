# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is a Taipei sports venue availability search + Radar PWA rebuilt from the retired LINE-first AI memory assistant.

V1 goals:

- Search normalized, actionable availability across supported **public and private official booking sources**.
- Start from badminton/public sports-center data but keep the source/domain model generic for badminton, table tennis, squash, tennis, pickleball, basketball and other court/slot sports.
- Let users watch sport + area/venue + date/day-of-week + time conditions.
- Poll sources conservatively, detect meaningful availability changes, fail closed when source truth is stale, and notify through Web Push only while the slot is still actionable.
- Never book/pay for users, never store venue/customer credentials, and do not add AI in V1. Booking always hands off to an official human booking page.
- Web/PWA first.

Public sports-center coverage is baseline, not the moat. Private official booking coverage is a V1 source requirement.

## Keep vs retire

Keep the reusable engineering foundation: TypeScript/pnpm monorepo, Cloudflare Workers + Hono, React + Vite, Neon PostgreSQL + Drizzle and shared tooling.

Retire completely without compatibility runtime: LINE webhook/group/LIFF, Group Memory/conversation extraction, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention flows and all legacy schema modules.

## Domain/data model

- `users`: generic identity; V1 uses anonymous browser identities and stores only token hashes.
- `sources`, `sports`, `venues`, `venue_sports`, `courts`: normalized provider/venue/sport/resource mapping.
- `source_metadata_runtime`: independent per-source metadata refresh success/retry state.
- `poll_targets`: source + venue + sport polling schedule/health. `last_polled_at` is the claim fence; `last_success_at` anchors freshness.
- `availability_slots`: normalized current slot truth and last observation.
- `availability_events`: first AVAILABLE observations, meaningful transitions and stale-gap AVAILABLE re-confirmations.
- `watch_rules` + `watch_rule_venues`: Radar conditions owned by anonymous users.
- `notification_subscriptions`, `notification_deliveries`, `notification_delivery_runtime`: durable Web Push state.

Provider machine references such as `external_booking_ref` are provenance only. Public search and Push never expose them. Human booking navigation uses normalized venue `booking_url`.

Database migration chain remains:

- `drizzle/0000_aftertrace_rebuild.sql`
- `drizzle/0001_radar_watch_foundation.sql`
- `drizzle/0002_web_push_delivery_runtime.sql`
- `drizzle/0003_source_metadata_runtime.sql`

There is no launched legacy data to preserve; deployment should use a fresh Neon branch/database rather than compatibility tables.

## Source architecture

Every provider implements `AvailabilitySourceAdapter`; search/watch/Radar never consume provider-specific response shapes directly.

Generic V1 ingestion supports badminton, table tennis, squash, tennis, pickleball and basketball. A source may narrow its own safely normalized catalog with `ingestSportCodes`.

### Registered source 1 — TaipeiSportsCenterAdapter

Public Taipei sports-center source around the verified endpoint family:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

Until venue-specific sport discovery is fully normalized, this adapter intentionally ingests badminton only. That restriction is source-local, not product-wide.

### Registered source 2 — TinyBookAdapter

TinyBook is now the first private-source implementation registered in the default source registry.

Initial curated Taipei venue:

- **Pickle Day 新光 A11 4F**
- Taipei City / Xinyi District, 4F, No. 11 Songshou Rd.
- sport: pickleball
- official booking product: `https://tinybot.cc/pickledaysocial/product/新光a11專區-匹克球場租借/` (stored percent-encoded in code)
- official product advertises 30-minute NT$699 / 1-hour NT$1,300 rental and a 72-hour booking horizon.

The official consumer product renders a WooCommerce Bookings form with a resource selector, date picker and dynamic available time blocks. TinyBook itself publicly describes its product as a no-registration, time/date based venue booking system, and other TinyBook sports tenants expose the same booking UI, including badminton/basketball/pickleball examples. Therefore the implementation is system-level with curated venue configuration rather than a one-off page scraper.

`TinyBookAdapter` behavior:

1. metadata is curated only for explicitly verified official sports booking products;
2. fetch the public booking product anonymously;
3. parse the WooCommerce booking form defaults and bookable resource options;
4. resolve the public WordPress booking AJAX endpoint from the page, with a same-site fallback;
5. for each resource/date, POST the same anonymous `wc_bookings_get_blocks` request the consumer UI uses;
6. normalize returned available start blocks as `court × date × 30-minute slot` AVAILABLE rows;
7. use the official product page as `booking_url`; never add to cart, log in, book or pay;
8. fail closed if the booking form/resources disappear or the AJAX contract returns an explicit WordPress error.

TinyBook minimum polling interval is currently 300 seconds to avoid aggressive traffic on a private SaaS source. The A11 product's documented 72-hour window bounds polling dates.

**Important verification boundary:** the source-level adapter is implemented and registered, but the current tool environment cannot execute the tenant's anonymous POST/XHR end-to-end. V1 private-source release completion therefore still requires a real network smoke proving the live A11 product returns parsable court/time blocks. Do not claim private live verification until that succeeds.

### Private-source acquisition policy

Continue private research every development round. Prefer, in order:

1. a booking SaaS used by multiple private sports venues;
2. an official venue booking page exposing anonymous current availability;
3. a stable public HTML/JSON/XHR surface used by the normal consumer flow;
4. venue-specific parsing only when durable and high-value.

Never use a competitor's closed aggregation feed or bypass login, CAPTCHA, access controls or security boundaries. Public anonymous consumer availability only.

Current research priority after TinyBook integration:

- broaden TinyBook only with independently verified sports tenants/products;
- keep AiNFOLiNK/PicklePickle as the next system-level candidate;
- SnowPick remains proof of anonymous private availability but is New Taipei, so it does not replace Taipei launch coverage.

## Metadata refresh and polling

`MetadataRefreshingPollingStage` is the sole metadata refresh owner. Source list comes from the adapter registry, with independent persisted cadence/backoff in `source_metadata_runtime`. A failed private source must not stop public source refresh or already-normalized polling.

Polling rules:

- Cron may wake every minute; each target has its own interval.
- default unwatched request: 300 seconds.
- watched request: 180 seconds, but always clamped to source minimum (TinyBook remains 300 seconds for now).
- watch-driven hot polling only applies within the 14-day product polling horizon.
- `last_polled_at` is the active claim fence; court/slot/event/missing-slot/final-settlement writes all use the same ownership fence.
- stale workers cannot rename/reactivate courts, write availability or overwrite target health after claim loss.

## Freshness and outage recovery

Persisted `AVAILABLE` alone is never current truth. Search, Radar matching, pre-dispatch reconciliation and browser presentation require a recent successful full poll for the exact source + venue + sport target.

Freshness allowance is `max(15 minutes, 3 × current poll interval)`.

A missing/disabled target or one with no successful poll is stale. If an AVAILABLE slot is observed AVAILABLE again after a gap longer than the freshness allowance, synchronization emits a new AVAILABLE re-confirmation event so Radar can notify after a genuine provider recovery without duplicating normal polls.

## Radar rules

- validate active sport/catalog/geographic scope when creating or editing watches;
- canonicalize common Taiwan `台`/`臺` city spelling before storage/fingerprinting;
- create/edit/resume activation boundaries prevent old backlog from triggering;
- match sport, city/district, optional venues, date range, weekday and time window;
- match only current AVAILABLE + fresh exact-target truth;
- retire superseded or already-started events;
- one user receives one wake per event even if multiple rules overlap;
- delivery freshness is capped at 30 minutes after the event.

All wall-clock/actionability logic uses `Asia/Taipei`. A same-day slot is actionable only while `start_time` is strictly later than current Taipei time.

## Web Push

V1 uses Worker Web Crypto/VAPID and payload-free Push wake-ups.

Configuration:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

Flow:

1. Radar creates a durable PENDING delivery from fresh truth.
2. pre-dispatch reconciliation invalidates changed/stale watch/source/slot truth.
3. dispatcher claims with a fenced lease and sends an empty Push to the concrete active endpoint.
4. only Push-service acceptance may settle the delivery to `SENT`.
5. browser presentation can claim only already-accepted `SENT` deliveries for the active endpoint; it cannot promote PENDING rows.
6. if a wake races ahead of settlement while a fenced dispatch is still in flight, presentation returns HTTP 425 and the Service Worker retries briefly.
7. stale accepted candidates are drained within the same wake until an actionable one is found.
8. final presentation revalidates current truth and fails closed; no generic fallback notification is shown.
9. notification click restores search context; booking URL is resolved again from current normalized search data.

## API / PWA V1 flow

Public:

- `GET /health`
- `GET /ready`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?...`
- `GET /api/v1/push/config`

Anonymous Radar:

- `POST /api/v1/session/anonymous`
- watch CRUD
- Push subscription CRUD
- Push presentation/open tracking

User flow:

`search current availability across normalized sources → open official booking page → create/manage Radar → enable/disable Push → receive current-truth notification → deep-link back to matching search context`.

Do not add AI chat, feeds, teams, automatic booking/payment or venue credential storage to V1.

## Development phase policy

Current phase remains **function/source completion**, not release verification.

Do not spend repeated rounds on pnpm/lockfile/full build/test/CI/migration rehearsal/deployment while product/source functionality is still being completed. Still fix obvious source-level compile/contract/schema/runtime defects when discovered.

After functional work is complete, switch to concentrated verification:

- regenerate current `pnpm-lock.yaml`;
- typecheck/lint/test/build/schema check;
- fresh Neon migrations;
- execute a real TinyBook A11 public product → resource/time blocks smoke;
- Worker/PWA deploy and VAPID config;
- `/ready` + deployed smoke;
- live public + private polling → transition/reconfirmation → Radar → Push → presentation → click;
- final retired-term/deployment-leftover scan and provider rate-limit measurements.

## Phase status

### Retired product / clean model
- [x] LINE/LIFF/group runtime removed.
- [x] AI/memory/conversation removed.
- [x] Energy/ads/commerce/reminder/proactive/legacy admin/auth/retention removed.
- [x] clean sports-radar schema + migrations through `0003`.

### Source/search/polling
- [x] generic adapter contract + multi-source registry.
- [x] generic source-error contract and source-specific sport ingestion.
- [x] Taipei sports-center adapter.
- [x] TinyBook private adapter implemented and registered with Pickle Day A11 curated product.
- [x] normalized current availability/search/polling/freshness/recovery pipeline supports mixed sources.
- [ ] live network verification that TinyBook A11 anonymous `wc_bookings_get_blocks` returns the expected resource/time-slot markup.
- [ ] broaden private source coverage only after each additional source is independently validated.

### Radar / Push / PWA
- [x] anonymous identity and Radar CRUD.
- [x] current-truth matching + outage recovery semantics.
- [x] durable Web Push, claim fencing, accepted-only presentation and fail-closed final validation.
- [x] mobile search, official booking handoff, Radar management, Push subscription and deep links.
- [ ] final mixed public/private source inspection after private live smoke.

### Deferred release verification
- [ ] lockfile regeneration.
- [ ] full typecheck/lint/test/build/schema checks.
- [ ] clean Neon migration rehearsal.
- [ ] Cloudflare/VAPID deployment + real-device smoke.
