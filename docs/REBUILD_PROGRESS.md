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
11. Radar deep-link auto-search now waits for venue metadata and restores the actual city from `venueId`, so cross-city private venues cannot be searched with the stale Taipei UI default.

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
- [x] mixed-city notification deep links wait for venue metadata and restore the venue's authoritative city before auto-search.

## Current round — AiNFOLiNK consumer discovery + mixed-city Radar deep-link restoration

### Starting state verified

At round start latest `main` was `695850bf6e43902c106d72dd2285bd96e1f04a75` (`Record TinyBook expansion and mixed-city flow`). `REBUILD_PLAN.md`, this file, current source adapters, notification repository/routes and `apps/web/src/App.tsx` were re-read before changes.

Starting functional gap:

- backend Radar notification deep links carried `sport + venueId + date + start + end + radar=1`, but no explicit city;
- the PWA initialized city to `臺北市` and its auto-search could run after sport metadata loaded but before venue metadata loaded;
- for a New Taipei private venue this could issue an internally contradictory `venueId=<New Taipei venue> + city=臺北市` search before the venue's actual city was known.

### Private-source research this round

#### AiNFOLiNK — promoted from vendor lead to concrete consumer-system candidate

Fresh public research on 2026-08-31 found the first concrete consumer tenant paths:

- AiNFOLiNK's official site still describes consumer court booking plus booking/payment/member/order management and names customers including 格恩羽球館、佛雷斯羽球館、動智 AI 羽球館.
- The official **動智 AI 羽球竹科館** site links its `訂場地` action directly to `https://sportxai-hsp.ainfolink.net/guestBooking`.
- Search-engine rendered snapshots for AiNFOLiNK `guestBooking` pages expose booking-calendar state, sold-out dates, booking-window wording and current-slot presentation. This confirms a real consumer booking frontend exists; it is no longer speculative vendor capability.
- A second concrete official tenant is `https://pickleball.ainfolink.net/`: **Pickle Pickle 台北專業匹克球場**, at `臺北市內湖區堤頂大道二段409號1F`, advertising 24-hour booking. This is especially high value because it is a Taipei private venue on the same system and a different sport from badminton.

Current blocker remains transport-level, not discovery-level: this tool environment can see the public SPA/renderer/search snapshots but has not exposed the underlying anonymous XHR/REST request contract used by `guestBooking`. No guessed `AiNFOLiNKAdapter` was added. The next promotion criterion is reproducing that normal consumer request without login/security bypass.

#### Other Taipei private venue research

- **Downstairs Pickleball Club / 樓下匹克球俱樂部** was inspected through its official Shopify site. It exposes four `體驗區` products, but the product page explicitly says the offering is a product-demo/experience session and **not court rental**, and the public page does not expose a date × court × live availability matrix. It is therefore rejected as a real-time V1 source for now rather than being padded into the adapter count.
- **Ahhh Pickleball Social Hub** currently directs public booking through LINE, so it remains non-ingestable as a real-time anonymous source.
- Third-party directories/aggregators surfaced useful venue names, but they remain discovery-only and must not become AFTERTRACE's availability truth.

### Code completed this round

#### `apps/web/src/App.tsx`

- added `venuesReady` state so Radar deep-link auto-search cannot run before venue metadata is loaded;
- when a deep link contains a valid `venueId`, the fetched normalized venue becomes authoritative for city and replaces the default Taipei UI city before searching;
- invalid/stale venue IDs are cleared after the sport's active venue catalog is loaded;
- auto-search now waits for sport metadata + venue metadata and, when `venueId` is present, a resolved `selectedVenue`;
- this keeps historical notification links that omitted city working and prevents impossible cross-city query combinations.

Relevant commit:

- `1c0ecf1b1ed61144c8240d44e4cd7d73b1f7463b` — `Restore mixed-city Radar deep links safely`

#### `docs/REBUILD_PLAN.md`

- recorded concrete AiNFOLiNK consumer tenant discovery and current transport blocker;
- promoted Pickle Pickle Taipei as the highest-value AiNFOLiNK tenant for transport resolution;
- recorded venue-authoritative mixed-city deep-link restoration as current product behavior.

Relevant commit:

- `ea7bacebda7b27abe7e4816ece08b568ee4fed51` — `Record AiNFOLiNK discovery and deep-link restoration`

### Verification intentionally deferred

Per current product strategy this round did not spend time on pnpm installation, lockfile regeneration, full typecheck/lint/test/build/schema checks, CI, migration rehearsal, PowerShell deploy scripts, Neon or Cloudflare deployment.

No schema migration was needed.

Source inspection confirmed the previous auto-search could run before venue metadata and the new flow explicitly gates on `venuesReady`. Full repository verification remains intentionally deferred rather than green.

## Remaining function/source work — highest priority first

1. Resolve AiNFOLiNK `guestBooking` anonymous availability transport. Known consumer hosts now include `sportxai-hsp.ainfolink.net` and `pickleball.ainfolink.net`; inspect only the normal public booking flow and do not bypass login/CAPTCHA/access controls.
2. If the transport is reproducible, implement `AiNFOLiNKAdapter` at the system level and curate at least the verified Taipei Pickle Pickle tenant plus any venue whose official consumer booking behavior can be validated.
3. Continue finding additional real Taipei City TinyBook sports/court products; do not ingest generic rooms or non-rental experience products merely to increase source count.
4. Source-inspect TinyBook response semantics that can affect truth: empty-day response vs provider failure, resource markup variants, duration/price changes, and whether one-duration-unit start blocks always match the curated minimum slot.
5. Inspect remaining mixed-source functional gaps caused by different booking horizons, slot lengths, source minimum intervals and variable prices.
6. Consider making future backend notification deep links explicitly include `city` as self-describing state, while retaining the new venue-authoritative fallback for historical links.

## Deferred release verification

- regenerate `pnpm-lock.yaml` and remove stale workspace metadata through pnpm;
- full `typecheck`, `lint`, `test`, `build`, `db:schema:check`;
- migrations `0000`→`0003` on fresh Neon;
- configure Worker `DATABASE_URL` + VAPID;
- live TinyBook A11 + Zhonghe smoke: product → resources → `wc_bookings_get_blocks` → normalized slots;
- live AiNFOLiNK smoke if its adapter is promoted during functional work;
- deploy Worker/PWA and confirm `/ready = 200`;
- live public + private polling → transition/re-confirmation → Radar → Push → presentation → click;
- measure provider latency/rate limits before lowering private polling intervals.

## Next round priority

Do not return to general build/test yet. AiNFOLiNK is now the highest-value private-source target because a real Taipei tenant and public `guestBooking` consumer path are known. First try to resolve the normal anonymous request transport; if that remains unavailable, continue private booking-system discovery while source-inspecting mixed-source truth edge cases instead of guessing an adapter.
