# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and the actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a Taipei sports venue availability search + Radar PWA. V1 has no AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public **and private official booking sources**, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Public sports-center coverage is baseline. Private official booking coverage is a core V1 source requirement.

## Actual current architecture

The retired LINE-first product is absent from runtime. `apps/` contains only `api` and `web`; LINE group/LIFF, Group Memory, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention runtime and legacy schema modules are removed.

Current main flow:

1. `AvailabilitySourceAdapter` isolates provider response shapes. `SourceAdapterRegistry` is multi-source.
2. Registered sources are now `TaipeiSportsCenterAdapter` and `TinyBookAdapter`.
3. Generic product ingestion supports badminton/table-tennis/squash/tennis/pickleball/basketball while each adapter can narrow `ingestSportCodes`.
4. `MetadataRefreshingPollingStage` owns registry-driven per-source metadata cadence/backoff through `source_metadata_runtime`; one provider failure cannot stop another provider.
5. Polling uses `poll_targets`; `last_polled_at` is the claim fence and `last_success_at` the freshness anchor. Court + slot + event + missing-slot + settlement writes are fenced against stale workers.
6. Search/Radar/Push require exact-target freshness within `max(15 minutes, 3 × target interval)` and Taipei-local actionability. AVAILABLE after a longer stale gap emits a re-confirmation event.
7. Anonymous browser identities own Radar rules; create/edit/resume activation boundaries prevent old backlog from notifying.
8. Radar produces durable Push deliveries. Only Push-service acceptance can settle PENDING → SENT; browser presentation only consumes accepted SENT deliveries and fails closed on stale truth.
9. Web/PWA provides search, official booking handoff, Radar CRUD, Push subscription and notification deep links.

Migration chain remains `0000` → `0003`; no migration was needed this round.

## Completed rebuild areas

### Retired product cleanup
- [x] LINE/group/LIFF runtime removed.
- [x] conversation extraction/Group Memory/Gemini/AI removed.
- [x] Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push removed.
- [x] old admin/auth/retention schema/runtime removed.
- [x] reusable pnpm/Hono/Workers/React/Vite/Neon/Drizzle foundation retained.

### Sports availability / polling
- [x] generic adapter + registry + provider-error contract.
- [x] generic multi-sport ingestion with source-specific narrowing.
- [x] Taipei sports-center public adapter.
- [x] normalized source/sport/venue/venue-sport/court/slot/event domain.
- [x] public sports/venue/actionable availability APIs.
- [x] registry-driven metadata refresh and provider-failure isolation.
- [x] poll demand, source interval clamp, 14-day watch horizon and complete claim fencing.
- [x] Taipei time actionability, stale-source fail closed and stale-gap recovery events.
- [x] **TinyBook private adapter implemented and registered with a verified Taipei private sports booking product.**
- [ ] TinyBook live POST/XHR smoke still must prove the tenant returns parsable resource/time blocks in a dependency/network-complete environment.

### Radar / Web Push
- [x] anonymous identity + watch CRUD/idempotency/isolation.
- [x] active catalog/geographic validation + city canonicalization.
- [x] current AVAILABLE + exact-target freshness matching.
- [x] durable delivery/retry/expiry/dispatch lease fencing.
- [x] pre-dispatch and final presentation current-truth validation.
- [x] accepted-only presentation resolves overlapping payload-free wake correlation.
- [x] Service Worker transient settlement retry and fail-closed notification behavior.

### Web/PWA
- [x] mobile availability search + official booking handoff.
- [x] anonymous identity bootstrap + Radar management UI.
- [x] manifest + Service Worker + Push subscription/deep link.
- [x] `/ready`, deploy scripts and smoke script exist.
- [ ] final mixed-source source-inspection pass after TinyBook live smoke.

## Current round — first private Taipei source implementation

### Starting state verified

At round start latest `main` was `723961d981768ff6676207557d0079c7cdfde59a` (`Record private-source and Push correlation round`). `docs/REBUILD_PLAN.md`, this file, source adapter contract/registry, Taipei adapter, synchronization service and scheduled registry construction were re-read before changes.

Starting truth:

- only `TaipeiSportsCenterAdapter` was registered;
- BookFast and AiNFOLiNK were strong research candidates but their exact anonymous current-slot transports were unresolved;
- the architecture was already ready for another adapter, but V1 had no private source implementation;
- build/test/release verification was intentionally deferred by current development policy.

### Private-source research this round

#### TinyBook / Pickle Day A11 — promoted and implemented

A much stronger private source was identified than the previously unresolved BookFast/AiNFOLiNK candidates.

Verified public evidence as of 2026-08-31:

- `https://tinybot.cc/pickledaysocial/` is Pickle Day Social Club's official consumer booking site and explicitly says reservations are handled through that website.
- Its product `[新光A11專區] 匹克球場租借` is a real Taipei private court-rental product at New Taipei? No: the booked facility is **新光三越信義 A11 4F, Taipei City, Xinyi District**; the operator's corporate/contact address shown in the site footer is in Zhonghe and must not be confused with the booked venue.
- The product advertises NT$699 per 30 minutes / NT$1,300 per hour and says A11 products open only within a 72-hour reservation window.
- The public booking widget exposes a `服務提供者` resource selector, date fields and dynamic available-time UI. It explicitly requires JavaScript for the booking service.
- The page footer identifies the system as TinyBook.
- TinyBook's own product pages describe anonymous/no-registration venue booking by time/date and live scheduling.
- Search also found other TinyBook sports tenants/products using the same booking UI, including badminton/basketball/pickleball examples. This makes TinyBook valuable as a **system-level adapter**, not merely a Pickle Day page parser.

The underlying booking transport was identified as the standard public WooCommerce Bookings consumer flow:

- WooCommerce's current troubleshooting documentation says the front-end calendar obtains booking availability through public `wc-ajax` requests.
- A current 2026 WooCommerce issue documents that selecting a date populates start times through `admin-ajax.php?action=wc_bookings_get_blocks`.
- Public WooCommerce booking-form examples show the standard serialized field names (`wc_bookings_field_resource`, start date year/month/day, duration, hidden `add-to-cart` product id) and the time-block response uses `<li class="block" data-block="HHmm">` style entries.

No login, CAPTCHA, credential, checkout or security bypass is involved; the adapter reads only the same anonymous product page and availability request used by the normal browser UI.

### Code completed this round

#### `apps/api/src/sources/tinybook.ts` — new

Added `TinyBookAdapter` with the first curated venue config:

- source code `tinybook`;
- source minimum poll interval 300 seconds;
- current ingestion `pickleball`;
- venue `pickleday-a11` / `Pickle Day 新光 A11 4F`;
- city `臺北市`, district `信義區`, address `臺北市信義區松壽路11號4樓`;
- official TinyBook A11 court-rental product as `bookingUrl`;
- provider booking horizon 72 hours;
- normalized minimum slot 30 minutes, current public price `699` per minimum slot.

Runtime implementation is not an adapter shell:

1. fetches the official public product page;
2. finds the WooCommerce booking form;
3. serializes default input/select values and resolves the product id;
4. parses the public `wc_bookings_field_resource` options as courts/resources;
5. resolves `booking_form_params.ajax_url` when present, with a same-site WordPress sub-site fallback;
6. posts `action=wc_bookings_get_blocks` with the selected date/resource and one minimum duration unit;
7. parses available start blocks and normalizes them into AVAILABLE `SourceAvailabilitySlot`s;
8. uses missing-resource/form/explicit WordPress AJAX errors as fail-closed provider errors;
9. caches page bootstrap briefly within the adapter to avoid refetching form metadata for every date/resource in one run;
10. never adds to cart, authenticates, pays or derives a fake human booking URL.

`listBookableDates()` conservatively bounds A11 polling to its documented 72-hour booking horizon instead of hitting private infrastructure for the full product 14-day window.

#### `apps/api/src/sources/registry.ts`

The default registry now contains both:

- `TaipeiSportsCenterAdapter`
- `TinyBookAdapter`

Therefore metadata refresh, normalized poll target creation, availability sync, search, Radar and Push will automatically see TinyBook through the existing provider-neutral pipeline once its live booking request is executed successfully.

Relevant commits before this progress update:

- `9b0e245344388297ca53a78fa2cb807c57f25c65` — `Add TinyBook private booking adapter`
- `1c0f1f114379cf020b54280f482bfc6f694647a8` — `Register TinyBook private source`
- `a5fa77f3e8bda5a28f800b09ab26ac9e9ccb82d7` — `Promote TinyBook private source integration`

### Architecture/product decisions updated

`docs/REBUILD_PLAN.md` was updated because private-source strategy changed materially:

- TinyBook is now the first implemented/registered private source rather than a research-only candidate;
- the adapter is system-level with curated verified products, so additional TinyBook sports venues can be added without creating per-venue crawler classes;
- TinyBook is intentionally clamped to 300-second polling for now;
- private source code is functionally integrated but **live network verification remains a release gate** because this execution environment cannot POST the tenant XHR and observe the raw response.

BookFast and AiNFOLiNK remain useful future sources but are no longer blocking the first private adapter.

### Verification intentionally deferred

Per the current development strategy, this round did **not** spend time on pnpm installation, lockfile regeneration, full typecheck/lint/test/build/schema checks, PowerShell deployment rehearsal, Neon migration or Cloudflare deployment.

The available web tooling could read the official TinyBook product page and current WooCommerce documentation but cannot execute the tenant's browser POST/XHR flow. Therefore:

- source-level integration is present on `main`;
- the exact A11 `wc_bookings_get_blocks` response has **not yet been live-smoked by this environment**;
- repository build/test status remains unverified, not green;
- no migration was added.

Do not claim release-ready private coverage until a real network smoke confirms resource names and time blocks parse as expected.

## Remaining work — function/source completion first

1. Source-inspect the newly registered TinyBook path for any provider semantics that should be handled before verification (resource naming, empty-day response, product markup variants, price/duration changes) without spending rounds on general build/test.
2. Continue private-source research in parallel. TinyBook has demonstrated a reusable sports booking system; identify more Taipei TinyBook court products if available, and keep AiNFOLiNK as the next distinct system candidate so the product is not dependent on one private SaaS.
3. Check the complete mixed-source user flow at source level: public badminton + private pickleball → venue search → availability → official booking URL → Radar creation/management → Push → deep-link search context.
4. Fix any functional gaps found by having sources with different booking horizons, slot lengths, sports and source minimum intervals.
5. Once source/function work is genuinely complete, switch to concentrated verification.

## Deferred release verification

- regenerate `pnpm-lock.yaml` and remove stale workspace metadata through pnpm.
- full `typecheck`, `lint`, `test`, `build`, `db:schema:check`.
- run migrations `0000`→`0003` against a fresh Neon target.
- configure Worker `DATABASE_URL` + VAPID values.
- **live TinyBook A11 smoke:** public product page → resource options → `wc_bookings_get_blocks` → normalized court/time slots.
- deploy Worker + PWA and confirm `/ready = 200`.
- live public + private polling → transition/re-confirmation → Radar → Push → presentation → click.
- measure source latency/rate limits before reducing any private polling interval.

## Next round priority

Do not return to general build/test yet. First inspect and harden the TinyBook adapter around real WooCommerce/TinyBook empty/error response semantics and continue finding additional Taipei private booking products/systems. Prefer another concrete private-source expansion or mixed-source functional fix over verification-only work.
