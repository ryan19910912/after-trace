# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is a sports venue availability search + Radar PWA rebuilt from the retired LINE-first AI memory assistant.

V1:

- search normalized actionable availability across supported public and private official booking sources;
- monitor sport + city/district/venue + date/day-of-week + time conditions;
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

Migration chain remains `drizzle/0000_aftertrace_rebuild.sql` through `0003_source_metadata_runtime.sql`. No launched legacy data must be preserved; production should start on a fresh Neon branch/database.

## Source architecture

Every provider implements `AvailabilitySourceAdapter`. Search, Radar and Push consume only normalized data.

Generic ingestion supports badminton, table tennis, squash, tennis, pickleball and basketball. Each adapter may narrow its own `ingestSportCodes`.

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

1. **Pickle Day 新光 A11 4F** — Taipei City / Xinyi District / pickleball.
   - official TinyBook product page;
   - 72-hour booking horizon;
   - 30-minute minimum slot;
   - current public 30-minute price NT$699.
2. **Pickle Day 中和俱樂部** — New Taipei City / Zhonghe District / pickleball.
   - official TinyBook product page;
   - stable flagship venue at 新北市中和區錦和路388號2樓;
   - official site states four dedicated courts, one-hour booking units and a three-week booking horizon;
   - peak/off-peak pricing varies, so normalized slots intentionally do not invent one fixed price.

TinyBook minimum polling interval remains 300 seconds. The adapter derives the WordPress AJAX base from the path before `/product/`, supports both path tenants and root/custom-domain installs, and only trusts same-origin HTTPS AJAX URLs parsed from product markup.

TinyBook availability payload rules are fail-closed:

- numeric WordPress AJAX error responses are failures;
- a truly empty `wc_bookings_get_blocks` body is accepted as a legitimate no-slot day;
- a non-empty HTTP-200 body with no recognized WooCommerce booking time block is treated as an invalid provider payload, not as “sold out”, so a WAF/proxy/theme error page cannot erase previously known availability.

**Verification boundary:** adapter code is integrated, but this tool environment still has not executed the tenants' live anonymous POST/XHR end-to-end. Real network smoke remains a release gate.

### Private-source candidate — AiNFOLiNK

AiNFOLiNK is now a concrete, high-value system candidate rather than only a vendor lead.

Verified public consumer evidence as of 2026-08-31:

- AiNFOLiNK officially advertises consumer court booking plus venue booking/payment/member/order management and names sports-venue customers such as 格恩羽球館、佛雷斯羽球館、動智 AI 羽球館;
- the official 動智 AI 羽球竹科館 site links its public `訂場地` action directly to `https://sportxai-hsp.ainfolink.net/guestBooking`;
- search-engine rendered snapshots of AiNFOLiNK `guestBooking` pages expose a booking calendar, sold-out dates, booking-window wording and current availability presentation without requiring an AFTERTRACE credential;
- `https://pickleball.ainfolink.net/` is an official AiNFOLiNK consumer tenant for **Pickle Pickle 台北專業匹克球場**, at 臺北市內湖區堤頂大道二段409號1F, advertising 24-hour booking;
- `longtan.ainfolink.net/booking` is another public AiNFOLiNK consumer booking tenant whose rendered page exposes calendar, peak/off-peak filtering, booking horizon, fees and provider branding, strengthening the evidence that a reusable booking-system contract exists across tenants.

This makes AiNFOLiNK especially valuable because one system can potentially cover both badminton and pickleball and already has a verified Taipei private venue tenant.

**Current blocker:** the browser-side XHR/REST transport used by `guestBooking`/`booking` has not yet been resolved from this tool environment. Do not implement a guessed adapter from rendered search snapshots. Promote AiNFOLiNK to a real adapter only after the normal anonymous consumer request contract can be identified and reproduced without bypassing login, CAPTCHA or access controls.

### Private-source acquisition policy

Every development round continues private-source research. Prefer:

1. one booking SaaS covering multiple sports venues;
2. official venue pages exposing anonymous current availability;
3. stable public HTML/JSON/XHR used by the normal consumer flow;
4. venue-specific parsing only when durable and high value.

Never use a competitor's closed aggregation feed or bypass login, CAPTCHA, access control or other security boundaries.

Research priorities after TinyBook:

- resolve AiNFOLiNK's anonymous `guestBooking`/`booking` availability transport, now that multiple public tenant URLs are known;
- prioritize the Taipei Pickle Pickle tenant because it directly validates private Taipei coverage on AiNFOLiNK;
- find more verified Taipei sports tenants using TinyBook;
- keep BookFast as a system candidate where true venue-slot transport can be proven;
- use third-party venue directories only for discovery, never as the normalized availability source;
- do not count phone/LINE-only venues as real-time sources.

## Mixed-source trust and search behavior

The domain is not hardcoded to Taipei. Search accepts `city` in addition to sport/venue/district/date/time. Availability responses expose venue city, normalized source code/name and the exact poll target's latest successful synchronization time.

The PWA shows source provenance and a human-readable synchronization age on every availability result. This is part of the product trust surface once public and private providers coexist: users should be able to see which official system supplied a result and how recently AFTERTRACE confirmed it.

Radar creation stores the selected/actual venue city rather than forcing `臺北市`.

Notification deep links are now self-describing and include `city`. The PWA additionally keeps venue-authoritative restoration: when a Radar deep link carries a `venueId`, it waits for venue metadata before its one-shot search and hydrates the actual venue city from normalized data. This preserves historical links that omitted `city` and prevents impossible cross-city combinations.

## Metadata refresh and polling

`MetadataRefreshingPollingStage` owns registry-driven per-source refresh cadence/backoff via `source_metadata_runtime`. One provider failure must not stop another provider or already-normalized polling.

Polling rules:

- Cron may wake every minute; each target has its own interval;
- normal request 300 seconds, watched request 180 seconds, always clamped to source minimum;
- watch-driven hot polling is limited to the 14-day product horizon;
- all court/slot/event/missing-slot/final-settlement writes are fenced by the poll claim;
- stale workers cannot overwrite current truth or target health.

## Freshness and recovery

Persisted `AVAILABLE` alone is never current truth. Search, Radar, pre-dispatch reconciliation and presentation require a recent successful full poll for the exact source + venue + sport target.

Freshness allowance is `max(15 minutes, 3 × current poll interval)`.

A missing/disabled target or one without successful polling is stale. AVAILABLE observed again after a gap longer than the freshness allowance emits a new recovery event so Radar can notify after genuine provider recovery without normal-poll duplicates.

All actionability uses `Asia/Taipei`; a same-day slot is actionable only while its start time is strictly in the future.

## Radar and Web Push

Radar rules validate active catalog/geographic scope, canonicalize common Taiwan `台`/`臺` spelling, use create/edit/resume activation boundaries, and match only current AVAILABLE + fresh exact-target truth.

Web Push flow:

1. Radar creates durable PENDING delivery.
2. Pre-dispatch reconciliation invalidates stale truth.
3. Dispatcher claims a fenced lease and sends payload-free Push to the active endpoint.
4. Only Push-service acceptance may settle PENDING → SENT.
5. Presentation consumes only SENT deliveries; an in-flight settlement race returns 425 and the Service Worker retries briefly.
6. Stale accepted candidates are drained within the same wake.
7. Final presentation revalidates current truth and fails closed; no generic fallback notification is shown.
8. New clicks carry sport + venue + city + date/time back to normalized search; booking URL is resolved from current search data.
9. PWA deep-link auto-search waits for venue metadata and restores the venue's real city before searching, preserving older links.

## API / PWA V1 flow

Public:

- `GET /health`
- `GET /ready`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?sport=...&city=...&district=...&date=...&start=...&end=...`
- `GET /api/v1/push/config`

Availability result trust fields include source identity and latest successful target synchronization time.

Anonymous Radar:

- `POST /api/v1/session/anonymous`
- watch CRUD
- Push subscription CRUD
- Push presentation/open tracking

User flow:

`choose sport/city/venue/date/time → search mixed-source current availability + source freshness → open official booking page → create/manage Radar → enable/disable Push → receive current-truth notification → return to matching search context`.

## Development phase policy

Current phase is **function/source completion**. Do not spend repeated rounds on pnpm/lockfile/full build/test/CI/migration rehearsal/deployment while source/product work remains. Fix obvious compile/contract/schema/runtime defects discovered by inspection.

Function/source completion requires:

- [x] retired LINE/AI product removed;
- [x] clean sports/Radar data model;
- [x] generic adapter/registry + public Taipei adapter;
- [x] at least one private booking-system adapter (TinyBook);
- [x] mixed-source normalized search/polling/Radar/Push pipeline;
- [x] mixed-city search/Radar behavior;
- [x] mixed-city notification deep-link restoration + explicit city in new links;
- [x] source provenance/freshness visible in mixed-source search;
- [x] mobile PWA search, official handoff, Radar management and Push flow;
- [ ] continue private-source expansion/research until no obvious high-value V1 source gap remains;
- [ ] resolve AiNFOLiNK anonymous availability transport or document a concrete external blocker after exhausting public consumer paths;
- [ ] source-inspect remaining mixed-source edge cases before switching phases.

After functional work is complete, switch to concentrated verification:

- regenerate `pnpm-lock.yaml`;
- typecheck/lint/test/build/schema check;
- clean Neon migrations;
- live TinyBook A11 + Zhonghe product/resource/time-block smoke;
- live AiNFOLiNK smoke if its adapter is promoted during functional work;
- Worker/PWA deploy and VAPID config;
- `/ready` and real-device public/private polling → Radar → Push → click smoke;
- final retired-term/deployment-leftover scan and provider rate-limit measurements.
