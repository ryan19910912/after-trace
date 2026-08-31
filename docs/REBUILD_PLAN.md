# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is the public sports venue availability search + Radar product rebuilt from the retired LINE-first AI memory assistant.

V1 goals:

- Search normalized, actionable public sports venue availability across supported Taipei sources.
- Launch with badminton while keeping the domain/source model generic for table tennis, squash, tennis, pickleball, basketball and other slot-based sports.
- Let users watch sport + venue/area + date/day-of-week + time conditions.
- Poll public booking sources with explicit source-specific limits.
- Notify only when a matching slot is newly available **and remains actionable before its Taipei-local start time**.
- Never book, pay, store venue credentials, or add AI in V1; send users to the official human booking channel.
- Web/PWA first.

## Architecture kept vs retired

Keep TypeScript/pnpm monorepo, Cloudflare Workers + Hono, React + Vite Pages, Neon PostgreSQL + Drizzle and shared verification tooling.

Retire completely, without compatibility runtime: LINE webhook/group/LIFF, conversation extraction/Group Memory/Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, LINE-specific auth/admin/retention and all legacy schema modules.

## Current domain model

- `users`: generic identity; V1 uses anonymous browser identities and stores only token hashes.
- `sources`, `sports`, `venues`, `venue_sports`, `courts`: normalized provider/venue/sport mapping.
- `source_metadata_runtime`: provider metadata success/retry state.
- `availability_slots`: normalized current slot truth.
- `availability_events`: meaningful status transitions; `matched_at` is the Radar queue cursor.
- `watch_rules` + `watch_rule_venues`: user-owned Radar conditions with idempotent creation keys.
- `notification_subscriptions`: Web Push endpoint state.
- `notification_deliveries`: durable idempotent watch/event delivery ledger.
- `notification_delivery_runtime`: retry/dispatch lease/freshness/presentation state.
- `poll_targets`: source/venue/sport schedule and health; `last_polled_at` is also the poll-claim fence token and `last_success_at` is the current-data freshness anchor.

Provider `external_booking_ref` is ingestion/provenance only. User-facing booking uses normalized venue `booking_url`; public/shared contracts must never expose provider-machine API references.

## Database strategy

There is no launched legacy product data to preserve. Use a clean sports-radar database rather than an in-place compatibility migration.

Migration chain:

- `0000_aftertrace_rebuild.sql`: clean sports-radar baseline; refuses detected legacy LINE/AI tables.
- `0001_radar_watch_foundation.sql`: watch idempotency + Radar match cursor.
- `0002_web_push_delivery_runtime.sql`: Push retry/lease/expiry/presentation runtime.
- `0003_source_metadata_runtime.sql`: source metadata refresh success/backoff state.

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

`MetadataRefreshingPollingStage` is the sole metadata refresh owner. It uses persisted `source_metadata_runtime`, reads a complete non-empty venue + enabled-sport snapshot before normalized mutations, applies deactivation only after successful discovery, refreshes successful metadata after six hours and retries failures after 15 minutes. `PollingOrchestrator` never bypasses this cadence by bootstrapping metadata itself.

## Polling demand + claim fencing

- Cron may wake every minute; each target has an independent interval.
- unwatched requested interval: 300 seconds.
- watch-covered requested interval: 180 seconds, priority `100`.
- intervals are clamped by source minimum.
- watch-driven hot polling applies only when the watch intersects the 14-day polling horizon.
- demand reconciliation changes priority/interval only; it never shortens `next_poll_at`, which doubles as the recovery lease.
- `last_polled_at` is the active claim fence; reclaim changes the token.
- every mutation derived from a claimed poll uses the same boundary: court metadata, slot truth, status events, missing-slot-to-UNKNOWN and final target settlement.
- critical court + slot + event mutation is one SQL statement guarded by row-locking `SELECT ... FOR UPDATE` on the active poll target.
- a stale Worker therefore cannot reactivate/rename a court or write availability after claim loss.
- post-write ownership is rechecked before further provider/date work.
- stale Workers never overwrite health/backoff owned by a newer claim.
- scheduled polling, Radar matching and Push stages remain failure-isolated.
- one-minute watched polling is not enabled until deployed rate-limit/latency measurements justify it.

## Availability freshness during provider failure

Persisted `AVAILABLE` is not enough by itself to claim a slot is currently actionable. Public search, Radar matching, pre-dispatch Push reconciliation and the final browser presentation check also require a recent successful full poll for the exact `source + venue + sport` target.

Freshness allowance is deterministic from the configured target interval:

- minimum: 15 minutes;
- otherwise: three current poll intervals when that is longer.

This tolerates short provider/network incidents while failing closed during prolonged outages. A missing/disabled target or a target with no successful poll is not considered fresh. Historical slot/event rows stay in PostgreSQL for transition continuity but cannot surface as current availability or alerts until the target has fresh successful truth again.

## Watch geographic scope

A Radar rule must describe a scope that currently exists in the normalized active catalog:

- sport must be active;
- an area-only watch requires at least one active source + venue + venue-sport mapping in its city/district;
- every explicitly selected venue must support the sport through an active source/mapping;
- selected venues must also sit inside the rule's declared city/district, so contradictory combinations are rejected instead of becoming silent never-match rules;
- common Taiwan top-level `台` spellings such as `台北市` are canonicalized to the normalized `臺` form before idempotency fingerprinting/storage.

Venue IDs are therefore a narrowing constraint inside the geographic boundary, not an override of it.

## Taipei calendar + actionable availability

All product calendar and wall-clock boundaries use `Asia/Taipei`, not Worker-local/UTC calendar assumptions. Polling orchestration, demand, public search, Radar and Push use shared Taipei date/time helpers.

A slot is actionable only when:

- status is `AVAILABLE`;
- source, venue, sport and venue-sport mapping are active;
- the exact poll target is fresh under the policy above;
- `use_date` is later than the current Taipei date, **or** it is today and `start_time` is strictly later than the current Taipei wall clock.

Historical rows remain useful for state/audit continuity but must not reappear as current search results or alerts after the moving horizon advances. A same-day slot becomes non-actionable at its start time even if the upstream source fails to emit another status transition.

## Radar current-truth rules

- write `availability_events` only for meaningful transitions / first AVAILABLE observation;
- watch latest `updated_at` must be at or before event `occurred_at`, so create/edit/resume never consumes old backlog;
- match sport, city/district, optional venues, date range, days-of-week and time window;
- match only while the slot is actionable under the Taipei date/start-time rule **and the exact poll target is fresh**;
- retire an unmatched AVAILABLE event once its slot start time arrives, even without a later provider event;
- a newer transition for the same slot supersedes an older event;
- superseded/expired unmatched AVAILABLE events are retired instead of accumulating indefinitely;
- one user gets one wake per slot event even when multiple rules overlap;
- delivery idempotency remains `watch:{rule}:event:{event}:web-push`;
- delivery freshness is also capped at 30 minutes after the availability event.

## Web Push strategy

V1 uses Worker Web Crypto for VAPID and sends a payload-free Push wake-up.

Worker configuration:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

Flow:

1. Radar creates durable PENDING delivery only from fresh source truth.
2. pre-dispatch reconciliation invalidates changed watch/source/slot truth, stale poll-target truth **and deliveries whose slot start time has arrived**.
3. dispatcher claims with a fenced lease and sends an empty VAPID Push.
4. Push-service acceptance settles the durable delivery without allowing stale claims to overwrite newer state.
5. Service Worker wakes and requests `/api/v1/push/presentation` with browser identity/current endpoint.
6. presentation performs the final exact truth check, including target freshness and the Taipei slot-start boundary; stale wake-ups return `notification: null` and stay silent.
7. browser receives display/deep-link fields only; official human booking URL is supplied by the normal availability API.

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
4. Create a Radar from filters; the backend rejects impossible or geographically contradictory source/venue scopes.
5. Reuse anonymous identity to list/pause/resume/delete watches.
6. Enable/disable Web Push.
7. Service Worker displays a contextual notification only after final current-truth validation.
8. Click restores matching search context.

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
- [x] Sports-radar schema + migration chain through `0003`.
- [ ] Apply/review on fresh Neon.

### 3: source/search/polling
- [x] Generic adapter + Taipei source.
- [x] Normalized sports/venue/court/slot/event domain.
- [x] actionable public search and human booking separation.
- [x] staged metadata refresh with persisted cadence/backoff and sole ownership.
- [x] horizon-aware watch demand.
- [x] poll claim fencing through court/slot/event/missing-slot/final settlement.
- [x] row-lock serialization against concurrent reclaim.
- [x] shared Taipei date/time semantics.
- [x] prolonged provider-failure freshness gate using successful target polls.

### 4: Radar + Web Push
- [x] Anonymous ownership + watch CRUD/idempotency.
- [x] watch area/selected-venue catalog validation + city canonicalization.
- [x] activation boundary + current source/slot/actionable-time/freshness matching.
- [x] superseded and already-started event retirement.
- [x] durable Web Push delivery/retry/lease fencing.
- [x] pre-dispatch + final presentation current-truth/start-time/freshness validation.
- [x] Worker-native VAPID + Service Worker flow.
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
- [ ] Live source polling -> transition -> Radar -> Push -> presentation -> click.
- [ ] Final retired-term/deployment-leftover scan and source rate-limit record.

## Definition of done

The rebuild is complete only when the retired LINE/AI product cannot run and is absent from the application schema; source metadata + polling + actionable search + current-truth Radar + Web Push work end-to-end on deployed infrastructure; past/already-started or operationally stale slots cannot appear or alert; human booking links resolve to official flows; migrations are applied on a clean Neon target; readiness/deploy smoke succeeds; and all executable repository verification passes.
