# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a sports venue availability search + Radar PWA. V1 has no AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public and private official booking sources, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Taipei City is the primary launch market. Private official booking coverage is a core V1 requirement; adjacent New Taipei coverage is acceptable when it validates a reusable booking-system source and improves real coverage.

## Current architecture

The retired LINE-first product is absent from runtime. `apps/` contains only `api` and `web`; LINE group/LIFF, Group Memory, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention runtime and legacy schema modules are removed.

Current runtime flow:

1. `AvailabilitySourceAdapter` isolates provider response shapes; registry is multi-source.
2. Registered adapters are `TaipeiSportsCenterAdapter` and `TinyBookAdapter`.
3. Generic ingestion supports badminton/table-tennis/squash/tennis/pickleball/basketball while each source can narrow `ingestSportCodes`.
4. Metadata refresh is registry-driven and source-isolated through `source_metadata_runtime`.
5. Polling uses `poll_targets`; `last_polled_at` is claim fence and `last_success_at` freshness anchor. Court/slot/event/missing-slot/settlement writes are fenced.
6. Search/Radar/Push require exact-target freshness within `max(15 minutes, 3 × target interval)` and future Taipei-local actionability; recovery after a prolonged stale gap emits a new AVAILABLE event.
7. Search is city/district/venue aware and now returns source identity plus the exact poll target's `last_success_at`, so the PWA can show where each mixed-source result came from and how recently that source was confirmed.
8. Anonymous browser identities own Radar rules. Radar stores selected/actual venue city.
9. Radar produces durable Web Push deliveries; only Push-service acceptance settles to SENT; presentation consumes only accepted SENT rows and fails closed on stale truth.
10. Notification deep links now explicitly carry `city` in addition to the historical venue-authoritative PWA restoration fallback.
11. Web/PWA provides mixed-source search, official booking handoff, source/freshness visibility, Radar CRUD, Push subscription and notification deep links.

Migration chain remains `0000` → `0003`; no migration was required in this round.

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
- [x] availability results expose normalized source name/code + latest successful target poll timestamp.
- [x] TinyBook availability parsing now fails closed when a HTTP-200 response is non-empty but does not contain a recognized WooCommerce Bookings time block. Standard empty-string `wc_bookings_get_blocks` responses remain valid sold-out/no-slot days.

### Radar / Push / PWA
- [x] anonymous identity + watch CRUD/idempotency/isolation.
- [x] active catalog/geographic validation + city canonicalization.
- [x] current AVAILABLE + exact-target freshness matching.
- [x] durable Push/retry/expiry/dispatch fencing.
- [x] accepted-only presentation and fail-closed final validation.
- [x] mobile search + official booking handoff + Radar management + Push subscription/deep link.
- [x] PWA city selector and city-aware Radar creation.
- [x] mixed-city deep-link restoration waits for venue metadata and uses authoritative venue city.
- [x] new notification links also include `city` explicitly for self-describing cross-city navigation.
- [x] result cards show source identity and latest successful synchronization age instead of hiding which provider supplied a mixed-source slot.

## Current round — mixed-source trust surface + TinyBook truth hardening

### Starting state

At round start latest `main` was `7707f08b941a51bae5fffadf468aa9a7ce221dc7`. The plan/progress docs, TinyBook adapter, availability repository, notification repository and PWA search UI were inspected before changes.

### Code completed

- `apps/api/src/availability/repository.ts`
  - availability search now returns `sourceCode`, `sourceName`, and the exact target's `sourceLastSuccessAt`.
  - this metadata comes from the same source/poll target already required by the freshness gate; it is not a separate stale cache.
- `apps/web/src/api.ts`
  - updated the public availability client contract for source identity + source freshness.
- `apps/web/src/App.tsx`
  - every result card now shows the normalized source and a human-readable last-success age (`剛剛同步`, `N 分鐘前同步`, etc.).
  - this is important once public and multiple private systems coexist: users can see provider provenance rather than treating every result as one opaque feed.
- `apps/api/src/notifications/repository.ts`
  - new Radar notification deep links include normalized venue `city` explicitly.
  - the PWA still keeps venue-authoritative restoration for older links, so this is backward-compatible without a compatibility runtime.
- `apps/api/src/sources/tinybook.ts`
  - hardened `wc_bookings_get_blocks` truth semantics.
  - numeric WordPress AJAX errors still fail.
  - an empty body is treated as a valid no-slot day, matching WooCommerce Bookings' standard time-slot HTML behavior.
  - a non-empty HTTP-200 body with no recognized time block now fails closed instead of being interpreted as an empty day; this prevents WAF/proxy/theme error HTML from incorrectly marking previously-known slots unavailable.

Commits created during this round before this progress update:

- `00e136dc9655c749fc2bc296ddb2412f462de74b` — `Expose source freshness in availability search`
- `e30bddfc59ca094af1b600d749537ab08c97773b` — `Surface source freshness to PWA`
- `8254eca492808d7810f1cd3c5eb73ae6429deb22` — `Show mixed-source freshness in search results`
- `b63c423e3859f2285714d22e6c665d6cd042f94f` — `Make Radar notification links city-aware`
- `7526749fc6aaf9cea1c6a6a5fcfee13deeb19bea` — `Fail closed on invalid TinyBook availability payloads`

### Private-source research this round

#### AiNFOLiNK

- Public consumer evidence remains strong: official AiNFOLiNK material describes online court booking/payment/member/order management and the public `guestBooking` frontends are indexable/renderable.
- `pickleball.ainfolink.net` remains the highest-value Taipei tenant candidate (Pickle Pickle 台北專業匹克球場).
- `sportxai-hsp.ainfolink.net/guestBooking` remains a concrete badminton consumer tenant path.
- Public search also surfaced another AiNFOLiNK booking tenant (`longtan.ainfolink.net/booking`) whose rendered page shows a real booking calendar, peak/off-peak filters, a 14-day booking horizon, fees and provider branding. This further validates that the system has reusable consumer booking semantics across tenants.
- Current blocker is still transport-level: the available environment can render/index public booking pages but cannot resolve/execute the tenant hosts' underlying browser XHR/REST contract directly. No guessed adapter or security bypass was added.

#### TinyBook / WooCommerce Bookings

- Public WooCommerce material confirms `wc_bookings_get_blocks` returns time-slot HTML and the standard time-slot builder starts with an empty HTML string, only appending `<li class="block" ...>` for available blocks. That supports the new fail-closed distinction between a legitimate empty response and arbitrary non-empty error HTML.

### Verification intentionally deferred

Per current strategy, this round did not spend time on pnpm installation, lockfile regeneration, full typecheck/lint/test/build/schema checks, CI, migration rehearsal, PowerShell deploy scripts, Neon or Cloudflare deployment.

No schema migration was needed. Full repository verification remains intentionally deferred rather than green.

## Remaining function/source work — highest priority first

1. Resolve AiNFOLiNK `guestBooking`/`booking` anonymous availability transport from the normal public consumer flow. Known hosts include `pickleball.ainfolink.net`, `sportxai-hsp.ainfolink.net`, and `longtan.ainfolink.net`.
2. If reproducible, implement `AiNFOLiNKAdapter` at the booking-system level and curate verified Taipei tenants first.
3. Continue finding additional real Taipei TinyBook court-rental products; do not ingest generic rooms/classes/non-rental experience products merely to increase count.
4. Continue TinyBook truth inspection: resource markup variants, duration-unit semantics and dynamic pricing. The dangerous HTTP-200-error-as-empty case is now closed.
5. Inspect remaining mixed-source gaps caused by different booking horizons, slot lengths, source minimum intervals and variable prices.
6. Review the complete PWA path with multiple providers: search → provider provenance → official handoff → Radar → Push → cross-city deep link.

## Deferred release verification

- regenerate `pnpm-lock.yaml` and remove stale workspace metadata through pnpm;
- full `typecheck`, `lint`, `test`, `build`, `db:schema:check`;
- migrations `0000`→`0003` on fresh Neon;
- configure Worker `DATABASE_URL` + VAPID;
- live TinyBook A11 + Zhonghe smoke: product → resources → `wc_bookings_get_blocks` → normalized slots;
- live AiNFOLiNK smoke if its adapter is promoted;
- deploy Worker/PWA and confirm `/ready = 200`;
- live public + private polling → transition/re-confirmation → Radar → Push → presentation → click;
- measure provider latency/rate limits before lowering private polling intervals.

## Next round priority

Keep functional/source work ahead of build/test. Continue attacking AiNFOLiNK's normal anonymous transport while expanding only verified private court-rental sources. In parallel, inspect mixed-source duration/price/horizon semantics and remove any remaining assumptions that only hold for the Taipei public source.
