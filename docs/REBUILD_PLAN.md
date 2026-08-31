# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is a Taipei sports venue availability search + Radar product rebuilt from the retired LINE-first AI memory assistant.

V1 goals:

- Search normalized, actionable sports venue availability across supported **public and private** Taipei sources.
- Launch the first proven flow with badminton while keeping the domain/source model generic for table tennis, squash, tennis, pickleball, basketball and other slot-based sports.
- Let users watch sport + venue/area + date/day-of-week + time conditions.
- Poll booking sources with explicit source-specific limits and fail closed when current truth is stale.
- Notify only when matching availability is newly observed or re-confirmed after a prolonged source outage and still remains actionable before its Taipei-local start time.
- Never book, pay, store venue credentials, or add AI in V1; send users to the venue/operator's official human booking channel.
- Web/PWA first.

Public sports-center data is the baseline, not the moat. V1 source-layer completion now requires at least one real private booking source to be normalized through the same adapter/polling/Radar pipeline.

## Architecture kept vs retired

Keep TypeScript/pnpm monorepo, Cloudflare Workers + Hono, React + Vite Pages, Neon PostgreSQL + Drizzle and shared tooling.

Retire completely, without compatibility runtime: LINE webhook/group/LIFF, conversation extraction/Group Memory/Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, LINE-specific auth/admin/retention and all legacy schema modules.

## Current domain model

- `users`: generic identity; V1 uses anonymous browser identities and stores only token hashes.
- `sources`, `sports`, `venues`, `venue_sports`, `courts`: normalized provider/venue/sport mapping.
- `source_metadata_runtime`: per-source provider metadata success/retry state.
- `availability_slots`: normalized current slot truth plus last observation time.
- `availability_events`: meaningful status transitions, first AVAILABLE observations and stale-gap AVAILABLE re-confirmations; `matched_at` is the Radar queue cursor.
- `watch_rules` + `watch_rule_venues`: user-owned Radar conditions with idempotent creation keys.
- `notification_subscriptions`: Web Push endpoint state.
- `notification_deliveries`: durable idempotent watch/event delivery ledger.
- `notification_delivery_runtime`: retry/dispatch lease/freshness/presentation state.
- `poll_targets`: source/venue/sport schedule and health; `last_polled_at` is the poll-claim fence token and `last_success_at` is the current-data freshness anchor.

Provider machine references such as `external_booking_ref` are ingestion/provenance only. Public availability contracts and Push presentation must never expose them or derive a human navigation URL from them. User-facing booking uses normalized venue `booking_url` through the normal search flow.

## Database strategy

There is no launched legacy product data to preserve. Use a clean sports-radar database rather than an in-place compatibility migration.

Migration chain:

- `0000_aftertrace_rebuild.sql`: clean sports-radar baseline; refuses detected legacy LINE/AI tables.
- `0001_radar_watch_foundation.sql`: watch idempotency + Radar match cursor.
- `0002_web_push_delivery_runtime.sql`: Push retry/lease/expiry/presentation runtime.
- `0003_source_metadata_runtime.sql`: source metadata refresh success/retry state.

Deployment must point `DATABASE_URL` at a fresh Neon branch/database and apply/review the full chain.

## Identity strategy

- `POST /api/v1/session/anonymous` issues a cryptographically random browser token.
- DB stores only its SHA-256 subject under provider `ANONYMOUS`.
- Watch/Push APIs require `Authorization: Bearer <token>` and isolate by resolved `user_id`.
- Never place raw identity tokens in URLs, Push payloads or logs.

## Source strategy

All providers implement `AvailabilitySourceAdapter`; domain/search/watch logic never consumes provider response shapes directly.

The first live adapter is `TaipeiSportsCenterAdapter`, around the verified Taipei sports-center endpoint family:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

The source layer must remain provider-neutral. `AvailabilitySourceError` is the common typed provider-failure contract so synchronization/retry code does not import one concrete adapter's error type.

### Private-source acquisition policy

Private sources are a V1 core requirement, not an optional post-launch expansion.

Prioritize sources in this order:

1. a booking SaaS/platform used by multiple private sports venues;
2. an official venue booking page exposing anonymous current availability;
3. a stable public HTML/JSON/XHR surface used by the venue's normal consumer flow;
4. venue-specific parsing only when it is durable and high-value.

Do not use a competitor's closed aggregation feed as a source. Do not bypass login, CAPTCHA, access controls or other security boundaries. A candidate becomes eligible for an adapter only when current availability can be read through the normal public/anonymous consumer flow without storing venue/customer credentials.

Current highest-priority private-system candidate is **AiNFOLiNK**:

- PicklePickle Taipei's own official site links its “Book Court / 訂球場” action directly to `pickleball.ainfolink.net`, establishing that AiNFOLiNK is the venue's booking operator rather than an unrelated aggregator.
- AiNFOLiNK publicly positions itself as a sports-venue reservation/operations SaaS and names multiple badminton-hall customers, making a system-level adapter materially more valuable than a one-venue scraper.
- The public booking SPA is reachable anonymously, but the exact anonymous availability transport/API still needs to be identified and validated before code is registered as a live adapter. Do not guess undocumented payloads or ship a non-functional compatibility shell.

Secondary research candidates include other public booking SaaS surfaces and venue-owned systems. LINE/phone-only venues remain catalog candidates but are not realtime-availability sources.

At least one private source must be actually registered and flow through metadata sync → poll target → normalized slot/event → search → Radar → Push before source-layer V1 is considered complete.

## Metadata refresh

`MetadataRefreshingPollingStage` is the sole metadata refresh owner. Its source list comes from the registered adapters rather than hard-coded provider branches. Each source has independent persisted cadence/backoff in `source_metadata_runtime`: successful refresh after six hours; provider refresh failure retries after 15 minutes.

Discovery reads a complete non-empty venue + enabled-sport snapshot before normalized mutations and applies deactivation only after successful discovery. One source metadata failure must not stop healthy sources or polling of already-normalized targets.

`PollingOrchestrator` never bootstraps metadata or bypasses this cadence.

## Polling demand + claim fencing

- Cron may wake every minute; each target has an independent interval.
- unwatched requested interval: 300 seconds.
- watched requested interval: 180 seconds, priority `100`.
- intervals are clamped by source minimum.
- watch-driven hot polling applies only when the watch intersects the 14-day polling horizon.
- demand reconciliation changes priority/interval only; it never shortens `next_poll_at`, which also acts as recovery lease timing.
- `last_polled_at` is the active claim fence; reclaim changes the token.
- every mutation derived from a claimed poll uses the same fence: court metadata, slot truth, status/recovery events, missing-slot-to-UNKNOWN and final target settlement.
- critical court + slot + event mutation is guarded by row-locking ownership on the active poll target.
- stale Workers cannot reactivate/rename a court, write availability, or overwrite health/backoff after claim loss.
- scheduled polling, Radar matching and Push stages remain failure-isolated.
- one-minute watched polling is not enabled until deployed rate-limit/latency measurements justify it.

## Availability freshness + outage recovery

Persisted `AVAILABLE` alone is never enough to claim a slot is current. Public search, Radar matching, pre-dispatch Push reconciliation and final browser presentation require a recent successful full poll for the exact `source + venue + sport` target.

Freshness allowance is `max(15 minutes, 3 × current poll interval)`.

A missing/disabled target or target with no successful poll is not fresh. Historical rows remain in PostgreSQL for continuity but cannot surface as current availability or alerts while stale.

If a slot remained `AVAILABLE` in storage but its previous `last_seen_at` is older than the freshness allowance when an owned poll observes it AVAILABLE again, synchronization emits a new AVAILABLE re-confirmation event. Equality with the boundary remains fresh; normal repeated polls do not generate duplicate events.

## Watch geographic scope

A Radar rule must describe a scope that currently exists in the normalized active catalog:

- sport must be active;
- area-only watch requires at least one active source + venue + venue-sport mapping in its city/district;
- every selected venue must support the sport through an active source/mapping;
- selected venues must also sit inside the declared city/district;
- common Taiwan `台` spellings such as `台北市` are canonicalized to normalized `臺` form before idempotency fingerprinting/storage.

Venue IDs narrow the geographic boundary; they do not override it.

## Taipei calendar + actionable availability

All product calendar/wall-clock boundaries use `Asia/Taipei`.

A slot is actionable only when:

- status is `AVAILABLE`;
- source, venue, sport and venue-sport mapping are active;
- exact poll target is fresh;
- `use_date` is later than current Taipei date, or it is today and `start_time` is strictly later than current Taipei wall clock.

## Radar current-truth rules

- create events for meaningful transitions, first AVAILABLE observations and stale-gap AVAILABLE re-confirmations;
- watch latest `updated_at` must be at or before event `occurred_at`, so create/edit/resume never consumes old backlog;
- match sport, city/district, optional venues, date range, days-of-week and time window;
- match only while exact slot/target truth is fresh/actionable;
- retire unmatched AVAILABLE events once superseded or once slot start time arrives;
- one user gets one wake per event even when multiple rules overlap;
- delivery idempotency remains `watch:{rule}:event:{event}:web-push`;
- delivery freshness is capped at 30 minutes after the event.

## Web Push strategy

V1 uses Worker Web Crypto for VAPID and sends a payload-free Push wake-up.

Worker configuration:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

Flow:

1. Radar creates durable PENDING delivery only from fresh source truth.
2. pre-dispatch reconciliation invalidates changed watch/source/slot truth, stale target truth and deliveries whose slot start time arrived.
3. dispatcher claims with a fenced lease and sends an empty VAPID Push.
4. Push-service acceptance settles the durable delivery without allowing stale claims to overwrite newer state.
5. Service Worker wakes and requests `/api/v1/push/presentation` using browser identity + current endpoint.
6. presentation considers only the active subscription endpoint and performs the final exact truth check; stale wake-ups stay silent.
7. presentation returns display fields + search deep-link only; booking URL comes from normal current availability after the app opens.

Retry rules: network/408/425/429/5xx => bounded retry inside freshness window; 404/410 => deactivate exact dead subscription; other HTTP failures => terminal; missing/invalid VAPID => dispatch disabled, never false-success.

The remaining concurrency review is correlation of multiple overlapping payload-free wakes for one endpoint. Correctness/idempotency wins over maximizing notification count.

## API surface

Public:

- `GET /health`
- `GET /ready`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?...`
- `GET /api/v1/push/config`

Anonymous Radar:

- `POST /api/v1/session/anonymous`
- `GET /api/v1/watch-rules`
- `POST /api/v1/watch-rules` + `Idempotency-Key`
- `PATCH /api/v1/watch-rules/:watchRuleId`
- `DELETE /api/v1/watch-rules/:watchRuleId`

Push:

- `POST /api/v1/push/subscription`
- `DELETE /api/v1/push/subscription`
- `POST /api/v1/push/presentation`
- `POST /api/v1/push/deliveries/:deliveryId/opened`

## Web/PWA flow

1. Select sport/date/time and optional venue/area.
2. Search only actionable current/future availability across normalized sources.
3. Open the venue/operator's verified human booking flow.
4. Create a Radar from filters; backend rejects impossible/contradictory scopes.
5. Reuse anonymous identity to list/pause/resume/delete watches.
6. Enable/disable Web Push.
7. Service Worker displays contextual notification only after final current-truth validation.
8. Click restores matching search context; booking still uses current search data + official venue URL.

Do not add AI chat, feeds, teams, automatic booking/payment or credential storage to V1.

## Development phase policy

Current phase is **function/source completion**, not release verification.

Until V1 features and at least one private source are complete, do not spend repeated rounds on pnpm availability, lockfile regeneration, full build/test/CI, migration rehearsal, PowerShell smoke or deployment. Record those as deferred. Still fix obvious source-level compile/contract/schema/runtime defects when found.

Once feature/source work is complete, switch to concentrated verification:

- regenerate current `pnpm-lock.yaml`;
- typecheck/lint/test/build/schema check;
- fresh Neon migrations;
- Worker/PWA deploy and VAPID configuration;
- `/ready` + smoke;
- live public + private source polling → transition/reconfirmation → Radar → Push → presentation → click;
- final retired-term/deployment-leftover scan and rate-limit measurements.

## Phase status

### Retired product + clean model
- [x] LINE/LIFF/group runtime removed.
- [x] AI/memory/conversation removed.
- [x] Energy/ads/commerce/reminder/proactive/legacy admin/auth/retention removed.
- [x] Sports-radar schema + migrations through `0003`.

### Source/search/polling
- [x] Generic adapter contract + registry.
- [x] Generic source-error contract; synchronization no longer imports Taipei-specific errors.
- [x] Taipei sports-center adapter.
- [x] Normalized domain + actionable public search.
- [x] staged registry-driven metadata refresh + provider-failure isolation.
- [x] horizon-aware watch demand + poll claim fencing.
- [x] Taipei actionability + stale-source freshness + recovery re-confirmation.
- [ ] Identify and validate anonymous availability transport for an official private booking system.
- [ ] Implement/register at least one private `AvailabilitySourceAdapter` and prove it flows through the same normalized pipeline.

### Radar + Web Push
- [x] Anonymous watch CRUD/idempotency/current-truth matching.
- [x] active-catalog/geographic validation + city canonicalization.
- [x] durable Push retry/lease/freshness/presentation runtime.
- [x] fail-closed Service Worker presentation and stale candidate draining.
- [ ] Finish overlapping payload-free Push correlation review.

### Web/PWA
- [x] Mobile search + official booking handoff.
- [x] anonymous identity + Radar management UI.
- [x] manifest/Service Worker/Push subscription/deep link.
- [ ] Final V1 flow source inspection after private source integration.

### Deferred release verification
- [ ] regenerate lockfile / full typecheck-lint-test-build-schema checks.
- [ ] fresh Neon migration review.
- [ ] configure VAPID + deploy Worker/PWA.
- [ ] deployed public + private live smoke.

## Definition of done

The rebuild is complete only when the retired LINE/AI product cannot run and is absent from application schema; at least one public source and at least one **private official booking source** are registered through the same normalized metadata/polling/search/Radar/Push pipeline; provider outages fail closed and recover deterministically; past/already-started/stale slots cannot appear or alert; Push cannot leak provider-machine booking references; booking always hands off to the official human flow; and after feature completion all executable repository, migration, readiness and deployed smoke verification passes.
