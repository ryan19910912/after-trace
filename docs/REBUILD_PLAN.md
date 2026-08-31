# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is a sports venue availability search + Radar PWA rebuilt from the retired LINE-first AI memory assistant.

V1:

- search normalized actionable availability across supported public and private official booking sources;
- monitor sport + city/district/venue + date range/day-of-week + time conditions;
- notify through Web Push only while current provider truth is still fresh/actionable;
- hand off to the official human booking page;
- never book/pay for users, never store venue credentials, and do not add AI.

Taipei City remains the primary launch market. Adjacent New Taipei private coverage is allowed when it validates a reusable booking-system adapter and materially improves real user coverage. Public sports-center coverage is baseline; private official booking coverage is a V1 requirement.

## Keep vs retire

Keep TypeScript/pnpm monorepo, Cloudflare Workers + Hono, React + Vite, Neon PostgreSQL + Drizzle and shared tooling.

Retire without compatibility runtime: LINE webhook/group/LIFF, Group Memory/conversation extraction, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention flows and legacy schema modules.

## Domain/data model

Core tables:

- `users`: anonymous browser identities, token hashes only;
- `sources`, `sports`, `venues`, `venue_sports`, `courts`;
- `source_metadata_runtime`;
- `poll_targets`: `last_polled_at` is claim fence, `last_success_at` freshness anchor;
- `availability_slots`, `availability_events`;
- `watch_rules`, `watch_rule_venues`;
- `notification_subscriptions`, `notification_deliveries`, `notification_delivery_runtime`.

Provider-machine references such as `external_booking_ref` are provenance only. Search/Push expose normalized venue `booking_url` for human navigation.

Migration chain remains `drizzle/0000_aftertrace_rebuild.sql` through `0003_source_metadata_runtime.sql`. Production should start on a fresh Neon branch/database.

## Source architecture

Every provider implements `AvailabilitySourceAdapter`. Search, Radar and Push consume only normalized data. Generic ingestion supports badminton, table tennis, squash, tennis, pickleball and basketball. Each adapter may narrow its own `ingestSportCodes`.

### Source 1 — TaipeiSportsCenterAdapter

Verified public endpoint family:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

This adapter currently ingests badminton only; that restriction is source-local.

### Source 2 — TinyBookAdapter

TinyBook is the first private booking-system adapter. It reads only the same anonymous WooCommerce Bookings consumer flow shown by official venue pages:

`official product page → booking form/resources → public wc_bookings_get_blocks AJAX → normalized available start blocks`.

It never logs in, adds to cart, books or pays. Products are curated only after official venue/sport/location/booking behavior is verified.

Current curated products:

1. **Pickle Day 新光 A11 4F** — Taipei / Xinyi / pickleball; 72-hour horizon; 30-minute minimum slot; public 30-minute price currently NT$699.
2. **Pickle Day 中和俱樂部** — New Taipei / Zhonghe / pickleball; three-week horizon; one-hour unit; variable peak/off-peak pricing is not flattened into one invented price.

TinyBook minimum polling interval remains 300 seconds. The adapter supports path tenants and root/custom-domain WordPress installs, trusts only same-origin HTTPS AJAX URLs and fails closed when HTTP 200 contains an unrecognized non-empty payload rather than legitimate WooCommerce time-block HTML.

**Verification boundary:** adapter code is integrated, but live anonymous POST/XHR end-to-end still belongs to release verification.

### High-value candidate — AiNFOLiNK

Verified public consumer evidence:

- official material describes online court booking/payment/member/order management;
- official venue consumers link to `guestBooking`/`booking` frontends;
- known hosts include `pickleball.ainfolink.net`, `sportxai-hsp.ainfolink.net`, `sportxai.ainfolink.net` and `longtan.ainfolink.net`;
- Pickle Pickle 台北專業匹克球場 is a verified Taipei tenant and the system also serves badminton venues.

**Current blocker:** the normal anonymous browser XHR/REST transport has not been resolved from this tool environment. Do not implement a guessed adapter or bypass login/CAPTCHA/access controls.

### High-value candidate — PickleBook / PickleTown

PickleBook is now a parallel high-priority private source candidate:

- its official product page states multiple partner venues already use the system;
- its consumer UI is explicitly a `court × time` matrix with available/booked/held/activity states and peak/off-peak prices;
- official case-study venue **DOPE 水獺綠洲** exposes a public `/booking` page whose rendered consumer view contains four courts, hourly availability and live prices;
- the vendor positions the same booking engine as reusable across partner venues, making a system-level adapter much more valuable than a one-off scraper.

Promotion criterion is the same as AiNFOLiNK: reproduce the normal anonymous availability transport, or identify a stable server-rendered contract that can be parsed conservatively and fail closed. Do not infer hidden bookings or use account-only data.

### Private-source acquisition policy

Every development round continues private-source research. Prefer one booking SaaS covering multiple sports venues, official anonymous current availability, and stable public HTML/JSON/XHR used by normal consumers. Never use a competitor's closed aggregation feed or bypass login, CAPTCHA or access control. Third-party venue directories are discovery-only.

## Mixed-source consumer trust

Search results expose normalized source identity and the exact poll target's latest successful synchronization time. Venue catalog responses also expose source identity so the PWA can distinguish private/public providers before search.

Different source booking horizons, slot lengths, price policies and minimum polling intervals remain provider-level facts; AFTERTRACE must not flatten them by inventing availability or prices.

## Mixed-city behavior

Search accepts `city` in addition to sport/venue/district/date/time. Availability responses expose venue city. Radar stores the selected/actual venue city instead of forcing Taipei.

Notification deep links include `city` explicitly. Historical links remain venue-authoritative: when a deep link carries `venueId`, the PWA waits for venue metadata and hydrates the actual normalized venue city before searching.

## Metadata refresh, polling, freshness

`MetadataRefreshingPollingStage` owns registry-driven per-source refresh cadence/backoff. One provider failure must not stop another provider or already-normalized polling.

Polling rules:

- Cron may wake every minute; each target has its own interval;
- normal request 300 seconds, watched request 180 seconds, clamped to source minimum;
- watch-driven hot polling is limited to the 14-day product horizon;
- all court/slot/event/missing-slot/final-settlement writes are fenced by poll claim;
- stale workers cannot overwrite current truth or target health.

Persisted `AVAILABLE` alone is never current truth. Search, Radar, pre-dispatch reconciliation and presentation require a recent successful full poll for the exact source + venue + sport target. Freshness allowance is `max(15 minutes, 3 × current poll interval)`. AVAILABLE observed again after a longer stale gap emits a recovery event. Same-day slots are actionable only while their start time is strictly in the future in `Asia/Taipei`.

## Radar and Web Push

Radar rules validate active catalog/geographic scope, canonicalize common Taiwan `台`/`臺` spelling, use create/edit/resume activation boundaries, and match only current AVAILABLE + fresh exact-target truth.

The PWA now exposes the backend's real Radar model instead of only one-day creation:

- date range editing;
- optional day-of-week filters;
- start/end time window;
- city/district/one-venue narrowing;
- edit, pause/resume and delete;
- multi-venue rules are preserved but are not destructively edited by the current one-venue Web editor.

Web Push flow:

1. Radar creates durable PENDING delivery.
2. Pre-dispatch reconciliation invalidates stale truth.
3. Dispatcher claims a fenced lease and sends payload-free Push.
4. Only Push-service acceptance may settle PENDING → SENT.
5. Presentation consumes only SENT deliveries; in-flight settlement race returns 425 and Service Worker retries briefly.
6. Stale accepted candidates are drained within the same wake.
7. Final presentation revalidates current truth and fails closed.
8. Click deep-links back to normalized search context; booking URL is resolved from current search data.

## API / PWA V1 flow

Public:

- `GET /health`
- `GET /ready`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?sport=...&city=...&district=...&date=...&start=...&end=...`
- `GET /api/v1/push/config`

Anonymous Radar:

- `POST /api/v1/session/anonymous`
- watch CRUD
- Push subscription CRUD
- Push presentation/open tracking

User flow:

`choose sport/city/venue/date/time → search mixed-source current availability → inspect provider/freshness → open official booking page → create/edit/manage Radar → enable/disable Push → receive current-truth notification → return to matching search context`.

## Development phase policy

Current phase is **function/source completion**. Do not spend repeated rounds on pnpm/lockfile/full build/test/CI/migration rehearsal/deployment while source/product work remains. Fix obvious compile/contract/schema/runtime defects discovered by inspection.

Function/source completion requires:

- [x] retired LINE/AI product removed;
- [x] clean sports/Radar data model;
- [x] generic adapter/registry + public Taipei adapter;
- [x] at least one private booking-system adapter (TinyBook);
- [x] mixed-source normalized search/polling/Radar/Push pipeline;
- [x] mixed-city search/Radar/deep-link behavior;
- [x] source provenance/freshness visible to consumers;
- [x] mobile PWA search, official handoff, one-venue Radar create/edit/pause/delete and Push flow;
- [ ] continue private-source expansion/research until no obvious high-value V1 source gap remains;
- [ ] resolve AiNFOLiNK or PickleBook public availability transport, or record a concrete external blocker after exhausting normal public paths;
- [ ] source-inspect remaining duration/price/horizon semantics before switching phases.

After functional work is complete, switch to concentrated verification: regenerate lockfile, typecheck/lint/test/build/schema check, clean Neon migrations, live private-source smoke, Worker/PWA deploy + VAPID, `/ready`, real-device Radar/Push/click smoke and final provider rate-limit measurements.
