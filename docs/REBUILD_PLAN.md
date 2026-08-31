# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is a public sports venue availability search + Radar product rebuilt from the retired LINE-first AI memory assistant.

V1 goals:

- Search normalized, actionable public sports venue availability across supported Taipei sources.
- Launch with badminton while keeping the domain/source model generic for table tennis, squash, tennis, pickleball, basketball and other slot-based sports.
- Let users watch sport + venue/area + date/day-of-week + time conditions.
- Poll public booking sources with explicit source-specific limits.
- Notify only when matching availability is newly observed or re-confirmed after a prolonged source outage, and still remains actionable before its Taipei-local start time.
- Never book, pay, store venue credentials, or add AI in V1; send users to the official human booking channel.
- Web/PWA first.

## Architecture kept vs retired

Keep TypeScript/pnpm monorepo, Cloudflare Workers + Hono, React + Vite Pages, Neon PostgreSQL + Drizzle and shared verification tooling.

Retire completely, without compatibility runtime: LINE webhook/group/LIFF, conversation extraction/Group Memory/Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, LINE-specific auth/admin/retention and all legacy schema modules.

## Current domain model

- `users`: generic identity; V1 uses anonymous browser identities and stores only token hashes.
- `sources`, `sports`, `venues`, `venue_sports`, `courts`: normalized provider/venue/sport mapping.
- `source_metadata_runtime`: per-source provider metadata success/retry state.
- `availability_slots`: normalized current slot truth plus last observation time.
- `availability_events`: meaningful status transitions, first AVAILABLE observations, and stale-gap AVAILABLE re-confirmations; `matched_at` is the Radar queue cursor.
- `watch_rules` + `watch_rule_venues`: user-owned Radar conditions with idempotent creation keys.
- `notification_subscriptions`: Web Push endpoint state.
- `notification_deliveries`: durable idempotent watch/event delivery ledger.
- `notification_delivery_runtime`: retry/dispatch lease/freshness/presentation state.
- `poll_targets`: source/venue/sport schedule and health; `last_polled_at` is the poll-claim fence token and `last_success_at` is the current-data freshness anchor.

Provider `external_booking_ref` is ingestion/provenance only. It may remain in synchronization/storage, but public availability contracts and Push presentation must never expose it or derive a human navigation URL from it. User-facing booking uses normalized venue `booking_url` through the normal availability/search flow.

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

## Source + metadata strategy

First source is the Taipei sports-center booking platform around the verified endpoint shapes:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

All sources implement `AvailabilitySourceAdapter`; domain/search/watch logic never consumes raw provider response shapes directly.

`MetadataRefreshingPollingStage` is the sole metadata refresh owner. Its source list comes from the registered `AvailabilitySourceAdapter`s rather than hard-coded provider branches. Each source has independent persisted cadence/backoff in `source_metadata_runtime`: a successful refresh is due again after six hours and a provider refresh failure retries after 15 minutes. Discovery reads a complete non-empty venue + enabled-sport snapshot before normalized mutations and applies deactivation only after successful discovery.

Metadata-source failures are isolated. If one registered provider fails metadata discovery, other due providers still refresh and already-normalized poll targets still run using their last-known catalog; current availability remains fail-closed independently through each target's `last_success_at` freshness rule. Failure-runtime persistence is best effort when a provider fails before its source anchor/runtime row can be used, but after successful provider discovery the new success cadence must persist—database/runtime persistence failure remains a stage failure so Cron does not silently hammer provider metadata on the next wake-up. `PollingOrchestrator` never bootstraps metadata or bypasses this cadence.

## Polling demand + claim fencing

- Cron may wake every minute; each target has an independent interval.
- unwatched requested interval: 300 seconds.
- watch-covered requested interval: 180 seconds, priority `100`.
- intervals are clamped by source minimum.
- watch-driven hot polling applies only when the watch intersects the 14-day polling horizon.
- demand reconciliation changes priority/interval only; it never shortens `next_poll_at`, which doubles as the recovery lease.
- `last_polled_at` is the active claim fence; reclaim changes the token.
- every mutation derived from a claimed poll uses the same boundary: court metadata, slot truth, status/recovery events, missing-slot-to-UNKNOWN and final target settlement.
- critical court + slot + event mutation is one SQL statement guarded by row-locking `SELECT ... FOR UPDATE` on the active poll target.
- stale Workers cannot reactivate/rename a court, write availability, or overwrite health/backoff after claim loss.
- scheduled polling, Radar matching and Push stages remain failure-isolated.
- one-minute watched polling is not enabled until deployed rate-limit/latency measurements justify it.

## Availability freshness + outage recovery

Persisted `AVAILABLE` is not enough by itself to claim a slot is currently actionable. Public search, Radar matching, pre-dispatch Push reconciliation and the final browser presentation check require a recent successful full poll for the exact `source + venue + sport` target.

Freshness allowance is deterministic from the configured target interval:

- minimum: 15 minutes;
- otherwise: three current poll intervals when that is longer.

A missing/disabled target or a target with no successful poll is not fresh. Historical rows stay in PostgreSQL for continuity but cannot surface as current availability or alerts while stale.

Recovery semantics are explicit:

- If a slot remained `AVAILABLE` in storage but its previous `last_seen_at` is older than the freshness allowance when a claimed poll observes it `AVAILABLE` again, synchronization emits a new AVAILABLE re-confirmation event even though the status value did not change.
- Equality with the freshness boundary is still fresh; re-confirmation happens only after a strictly longer gap.
- Normal repeated polls inside the freshness allowance do not create duplicate AVAILABLE events.
- Direct/unfenced synchronization does not invent recovery events; stale-gap re-confirmation is tied to a real owned poll target so the configured source cadence is authoritative.
- The first recovery event supersedes older slot events. Radar can therefore notify active watches that the slot is trustworthy/actionable again after the system had intentionally failed closed during the outage.

This avoids both bad outcomes: silently never alerting after a long outage, and repeatedly alerting during ordinary polling.

## Watch geographic scope

A Radar rule must describe a scope that currently exists in the normalized active catalog:

- sport must be active;
- an area-only watch requires at least one active source + venue + venue-sport mapping in its city/district;
- every explicitly selected venue must support the sport through an active source/mapping;
- selected venues must also sit inside the rule's declared city/district;
- common Taiwan top-level `台` spellings such as `台北市` are canonicalized to normalized `臺` form before idempotency fingerprinting/storage.

Venue IDs are a narrowing constraint inside the geographic boundary, not an override of it.

## Taipei calendar + actionable availability

All product calendar/wall-clock boundaries use `Asia/Taipei`.

A slot is actionable only when:

- status is `AVAILABLE`;
- source, venue, sport and venue-sport mapping are active;
- the exact poll target is fresh;
- `use_date` is later than the current Taipei date, or it is today and `start_time` is strictly later than the current Taipei wall clock.

Historical rows remain useful for state/audit continuity but never reappear after their actionable window passes.

## Radar current-truth rules

- create events for meaningful transitions, first AVAILABLE observations and stale-gap AVAILABLE re-confirmations;
- watch latest `updated_at` must be at or before event `occurred_at`, so create/edit/resume never consumes old backlog;
- match sport, city/district, optional venues, date range, days-of-week and time window;
- match only while the exact slot and poll target are fresh/actionable;
- retire unmatched AVAILABLE events once superseded or once the slot start time arrives;
- one user gets one wake per event even when multiple rules overlap;
- delivery idempotency remains `watch:{rule}:event:{event}:web-push`;
- delivery freshness is capped at 30 minutes after the event.

A stale-gap re-confirmation is intentionally a new event and therefore a new idempotency identity. This is allowed because the product had stopped claiming that slot was actionable during the outage and has now obtained new current truth.

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
6. presentation considers only the active subscription endpoint, then performs the final exact truth check; stale wake-ups return `notification: null`.
7. presentation returns display fields + search deep-link only. It never returns `external_booking_ref` or an internally computed booking URL; the normal availability API supplies the verified human venue booking URL after the app opens.

Retry rules: network/408/425/429/5xx => bounded retry inside freshness window; 404/410 => deactivate exact dead subscription; other HTTP failures => terminal; missing/invalid VAPID => dispatch disabled, never false-success.

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
2. Search only actionable current/future availability.
3. Open the venue's verified human booking flow.
4. Create a Radar from filters; backend rejects impossible/contradictory scopes.
5. Reuse anonymous identity to list/pause/resume/delete watches.
6. Enable/disable Web Push.
7. Service Worker displays a contextual notification only after final current-truth validation.
8. Click restores matching search context; booking still goes through normal availability data and official venue URL.

Do not add AI chat, feeds, teams, automatic booking/payment or credential storage to V1.

## Runtime health + deployment verification

- `/health`: cheap Worker liveness.
- `/ready`: normalized sports schema probe + complete VAPID validation; 503 with non-secret codes when not ready.
- `smoke.ps1`: Worker/public API/Push config and optional Pages/source-data verification.
- `worker-deploy.ps1`: frozen install + typecheck/lint/test/build/schema check + migrations + deploy + smoke.
- `pages-deploy.ps1`: Pages build/deploy + combined smoke.
- CI uses `pnpm install --frozen-lockfile`; lockfile drift must fail rather than rewrite silently.

## Phase status

### 0–1: pivot + old runtime retirement
- [x] Product/docs pivot.
- [x] LINE/LIFF/group runtime removed.
- [x] AI/memory/conversation removed.
- [x] Energy/ads/commerce/reminder/proactive/legacy admin/auth/retention removed.

### 2: clean database
- [x] Sports-radar schema + migrations through `0003`.
- [ ] Apply/review on fresh Neon.

### 3: source/search/polling
- [x] Generic adapter + Taipei source.
- [x] Normalized domain + actionable public search.
- [x] staged periodic metadata refresh + persisted cadence/backoff.
- [x] registry-driven multi-source metadata cadence with provider-failure isolation.
- [x] horizon-aware watch demand.
- [x] full poll claim fencing and row-lock serialization.
- [x] shared Taipei date/time semantics.
- [x] prolonged provider-failure freshness gate.
- [x] stale-gap AVAILABLE re-confirmation event semantics.

### 4: Radar + Web Push
- [x] Anonymous ownership + watch CRUD/idempotency.
- [x] watch catalog/geographic validation + city canonicalization.
- [x] activation/current-truth/freshness matching.
- [x] superseded/already-started event retirement.
- [x] durable Push delivery/retry/lease fencing.
- [x] pre-dispatch + presentation current-truth validation.
- [x] Worker-native VAPID + Service Worker flow.
- [x] Push presentation no longer carries provider-machine booking references and requires the active endpoint.
- [ ] End-to-end deployed Push smoke.
- [ ] Measure source behavior before considering one-minute watched polling.

### 5: Web/PWA
- [x] Mobile search + official booking.
- [x] anonymous identity + Radar management UI.
- [x] manifest/Service Worker/Push subscription/deep link.
- [ ] Optional after-smoke detailed watch editing/install guidance.

### 6: final verification
- [x] liveness/readiness + deploy smoke path.
- [x] frozen-lockfile CI policy.
- [ ] Regenerate `pnpm-lock.yaml` from current workspace to remove stale `apps/admin` importer metadata.
- [ ] Fresh Neon migrations through `0003`.
- [ ] Configure real VAPID secrets and deploy Worker + HTTPS PWA.
- [ ] `/ready` = 200 + deployed smoke.
- [ ] Full `typecheck`, `lint`, `test`, `build`, `db:schema:check` in dependency-complete environment.
- [ ] Live source polling → transition/reconfirmation → Radar → Push → presentation → click.
- [ ] Final retired-term/deployment-leftover scan and source rate-limit record.

## Definition of done

The rebuild is complete only when the retired LINE/AI product cannot run and is absent from application schema; registered source metadata + polling + actionable search + current-truth Radar + Web Push work end-to-end on deployed infrastructure; one provider outage cannot stall healthy providers or last-known normalized polling; provider outages fail closed and recover deterministically; past/already-started or operationally stale slots cannot appear or alert; Push cannot leak/use provider-machine booking references; human booking resolves through official venue flows; migrations are applied on a clean Neon target; readiness/deploy smoke succeeds; and all executable repository verification passes.
