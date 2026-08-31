# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is being rebuilt from the retired LINE-first AI memory assistant into a public sports venue availability search + Radar product.

V1 goals:

- Search normalized current public sports venue availability across supported Taipei sources.
- Launch with badminton while keeping the domain/source model generic for table tennis, squash, tennis, pickleball, basketball and other slot-based sports.
- Let users watch sport + venue/area + date/day-of-week + time conditions.
- Poll public booking sources with explicit source-specific limits.
- Notify only when a matching slot is newly and still currently available.
- Never book, pay, store venue credentials, or add AI in V1; send users to the official human booking channel.
- Web/PWA first.

## Architecture kept vs retired

Keep:

- TypeScript + pnpm monorepo.
- Cloudflare Workers + Hono.
- React + Vite on Cloudflare Pages.
- PostgreSQL/Neon + Drizzle ORM.
- shared lint/typecheck/test/build tooling.

Retire completely, without compatibility runtime:

- LINE webhook/group lifecycle and LIFF management.
- conversation extraction/group memory and Gemini/AI chat.
- Energy/Credit, rewarded ads, commerce, Reminder and Proactive Push.
- LINE-specific auth/admin/retention rules and legacy schema modules.

## Current domain model

- `users`: generic identity; V1 uses anonymous browser identities. Raw browser tokens are never stored server-side.
- `sources`, `sports`, `venues`, `venue_sports`, `courts`: normalized provider/venue/sport mapping.
- `source_metadata_runtime`: provider metadata refresh success/retry state.
- `availability_slots`: current normalized slot truth.
- `availability_events`: meaningful status transitions; `matched_at` is the Radar matching cursor.
- `watch_rules` + `watch_rule_venues`: user-owned Radar conditions with idempotent creation keys.
- `notification_subscriptions`: Web Push subscription state.
- `notification_deliveries`: durable idempotent watch/event delivery ledger.
- `notification_delivery_runtime`: retry/dispatch lease/freshness/presentation state.
- `poll_targets`: source/venue/sport polling schedule and health. `last_polled_at` is also the current poll-claim fence token.

`availability_slots` uses `(source_id, external_slot_key)` as provider identity. `external_booking_ref` is internal provider-machine provenance only. User-facing booking uses normalized venue `booking_url` and public/shared API contracts must not expose provider-machine booking references.

## Database strategy

There is no launched legacy product data that must be carried into the new domain. Use a clean sports-radar database, not an in-place compatibility migration.

Current migration chain:

- `0000_aftertrace_rebuild.sql`: clean baseline; refuses detected legacy LINE/AI tables.
- `0001_radar_watch_foundation.sql`: Radar match cursor + watch idempotency metadata.
- `0002_web_push_delivery_runtime.sql`: Push retry/lease/expiry/presentation state.
- `0003_source_metadata_runtime.sql`: persisted source metadata refresh success/backoff state.

Deployment must point `DATABASE_URL` at a fresh Neon branch/database. Runtime Drizzle loading, Drizzle Kit config and schema verification use `schema-all.ts`.

## Identity strategy

- `POST /api/v1/session/anonymous` issues a cryptographically random browser token.
- DB stores only its SHA-256 subject under provider `ANONYMOUS`.
- Radar/Push APIs require `Authorization: Bearer <token>` and resolve private operations to `user_id`.
- The Web app stores the token locally and passes it to its same-origin Service Worker context.
- Never put the token in URLs, Push payloads or logs.

## Source + metadata strategy

First source is the Taipei sports-center booking platform, using verified endpoint shapes around:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

All providers implement `AvailabilitySourceAdapter`; product search/watch logic never consumes raw provider response shapes directly.

Provider-machine endpoints and user navigation are separate. `findAllowBookingList` is ingestion-only; public CTA uses the venue's human booking URL.

`MetadataRefreshingPollingStage` is the sole owner of provider metadata refresh. It:

1. checks `source_metadata_runtime`;
2. refreshes only when `next_attempt_at` is due;
3. retains/updates the source anchor before discovery so first-run failures can persist retry state;
4. reads a complete venue + enabled-sport snapshot before mutating normalized venue/sport mappings;
5. rejects an empty venue snapshot rather than interpreting it as authoritative deletion;
6. applies deactivation only after provider metadata discovery succeeds;
7. records successful refresh only after the full sync finishes;
8. schedules normal refresh six hours later;
9. records a 15-minute retry boundary on failure;
10. disables invalid poll targets and then reapplies watch-driven demand.

`PollingOrchestrator` never performs metadata bootstrap. An empty target set returns without bypassing metadata cadence/backoff.

## Polling demand + claim fencing

- Cron may wake every minute; targets keep independent intervals.
- unwatched requested interval: 300 seconds.
- watch-covered requested interval: 180 seconds, priority `100`.
- every interval is clamped by the source minimum.
- watch-driven hot polling is relevant only when the watch intersects the current 14-day polling horizon.
- far-future/expired watches do not keep endpoints hot and automatically become relevant as the moving horizon reaches them.
- demand reconciliation changes priority/interval only; it never shortens `next_poll_at` because that field also acts as the recovery lease.
- `last_polled_at` is the active claim fence. A reclaimed target changes the token.
- every mutation derived from a claimed poll must use the same claim boundary: court metadata, availability slots, status events, missing-slot-to-UNKNOWN transitions and final target health/backoff settlement.
- critical court + slot + event mutation is one SQL statement guarded by a row-locking `EXISTS (... SELECT ... FOR UPDATE)` claim predicate.
- the row lock prevents a concurrent reclaim from interleaving stale court/slot/event truth; either reclaim wins before the statement and no mutation occurs, or it waits for the legitimate statement to finish.
- after critical writes the Worker rechecks ownership and stops before further provider/date work if the claim changed.
- a stale Worker never overwrites failure/backoff owned by a newer claim.
- do not enable one-minute watched polling until deployed source latency/rate-limit behavior supports it.

Scheduled responsibilities remain failure-isolated: polling failure cannot suppress matching of already-persisted events, and matching failure cannot suppress already-durable Push dispatch.

## Taipei calendar/current-search rules

Product date boundaries are Asia/Taipei calendar dates, not Worker-local/UTC dates. Polling orchestration and demand reconciliation share one calendar helper implementation.

Public availability is a current-state surface:

- only `AVAILABLE` slots are returned;
- source, venue, sport and venue-sport mapping must all remain active;
- `use_date` must be on or after the current Asia/Taipei calendar date;
- historical rows may remain for state/audit continuity but must not reappear as user-visible current availability after the moving polling horizon advances.

## Radar current-truth rules

Radar is transition-based but every notification decision must reflect current truth:

- write `availability_events` only for meaningful transitions / first AVAILABLE observation;
- a watch may match an event only when its latest `updated_at` is at or before the event's `occurred_at`;
- creating, editing or resuming a watch creates a new activation boundary and does not consume old backlog;
- match sport, city/district, optional venues, date range, days-of-week and time window;
- match only while the slot remains AVAILABLE and normalized source mappings remain active;
- a newer transition for the same slot supersedes an older event;
- superseded unmatched AVAILABLE events are retired so they cannot accumulate indefinitely;
- delivery idempotency key remains `watch:{rule}:event:{event}:web-push`;
- every delivery expires 30 minutes after its availability event.

## Web Push strategy

V1 uses Worker Web Crypto for VAPID authentication and sends a payload-free Push signal.

Worker configuration:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

Flow:

1. Radar creates a durable PENDING delivery.
2. immediately before dispatch, stale pending deliveries are invalidated when watch/source/slot truth changed;
3. dispatcher claims the delivery with a fenced recovery lease and sends the empty VAPID Push;
4. Push-service acceptance settles the delivery without allowing an older Worker claim to overwrite newer state;
5. Service Worker wakes and requests `/api/v1/push/presentation` with its anonymous browser identity/current endpoint;
6. presentation performs a final exact current-truth recheck; stale wake-ups return `notification: null` and remain silent;
7. browser receives display/deep-link fields only, never provider-machine booking references;
8. notification click deep-links to normalized search, where human `booking_url` is used.

Retry rules:

- network, 408/425/429 and 5xx => bounded exponential retry inside freshness window;
- 404/410 => deactivate the dead subscription and safely unbind that exact endpoint;
- other HTTP failures => terminal;
- missing/invalid VAPID configuration => dispatch disabled, never reported as success.

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
2. Search normalized current/future availability.
3. Open the venue's verified human booking flow.
4. Create a Radar from current filters.
5. Reuse anonymous identity to list/pause/resume/delete watches.
6. Enable/disable Web Push.
7. Service Worker shows a contextual notification only after final current-truth validation.
8. Notification click restores matching search context.

Do not add AI chat, feeds, teams, automatic booking/payment or credential storage to V1.

## Runtime health + deployment verification

- `GET /health`: cheap Worker liveness.
- `GET /ready`: probes normalized sports schema and validates complete VAPID configuration; returns 503 with non-secret codes when not ready.
- `smoke.ps1`: Worker readiness/public API/Push config and optional Pages/source-data verification.
- `worker-deploy.ps1`: frozen install + typecheck/lint/test/build/schema check + migrations + Worker deploy + smoke.
- `pages-deploy.ps1`: build/deploy Pages then combined Worker/Pages smoke.
- CI uses `pnpm install --frozen-lockfile`; lockfile drift must fail rather than be silently rewritten.

## Rebuild phases

### Phase 0 — pivot/docs
- [x] Inspect old runtime/schema.
- [x] Replace product direction/docs and durable progress handoff.

### Phase 1 — retire old product
- [x] Remove LINE/group/LIFF runtime.
- [x] Remove AI/memory/conversation runtime.
- [x] Remove Energy/commerce/ad/reminder/proactive/retention runtime.
- [x] Remove old admin/auth/environment bindings and legacy schema modules.

### Phase 2 — clean database
- [x] Sports-radar clean baseline.
- [x] Radar/Web Push/source-runtime incremental migrations through `0003`.
- [x] Complete split-schema export through `schema-all.ts`.
- [ ] Apply/review all migrations on a fresh Neon target.

### Phase 3 — source/search/polling
- [x] Adapter contract + Taipei adapter.
- [x] Normalized sports/venues/current availability APIs.
- [x] slot synchronization, status diff/events and target health/backoff.
- [x] separate provider-machine refs from human booking navigation/public contracts.
- [x] periodic staged provider metadata refresh with persisted cadence/backoff.
- [x] sole metadata ownership; zero-target state cannot bypass cadence.
- [x] deactivate invalid source mappings and hide them from public/Radar truth.
- [x] horizon-aware watch polling demand without mutating active leases.
- [x] fence court/slot/event/missing-slot writes and final settlement with active poll claim.
- [x] serialize critical polling mutations against concurrent reclaim with row locking.
- [x] share Asia/Taipei calendar arithmetic and exclude historical dates from public availability.

### Phase 4 — Radar backend/Web Push
- [x] Anonymous ownership + watch CRUD/idempotency.
- [x] watch activation boundary + current-slot/current-source matching.
- [x] superseded-event retirement.
- [x] idempotent deliveries + retry/freshness/lease fencing.
- [x] pre-dispatch and final presentation current-truth validation.
- [x] Worker-native VAPID + Service Worker deep-link flow.
- [x] failure-isolated polling/matching/Push scheduled stages.
- [ ] End-to-end deployed Push smoke with real VAPID keys.
- [ ] Measure source behavior before considering one-minute watched polling.

### Phase 5 — Web/PWA
- [x] Mobile search + official booking links.
- [x] anonymous identity bootstrap/storage.
- [x] Radar create/list/pause/resume/delete UI.
- [x] manifest + Service Worker + Push permission/subscription flow.
- [x] notification deep link.
- [ ] Optional after-smoke UX: detailed watch editing / install guidance.

### Phase 6 — final verification
- [x] liveness/readiness and reusable deploy smoke path.
- [x] frozen-lockfile CI install.
- [ ] Regenerate `pnpm-lock.yaml` from current workspace to remove stale `apps/admin` importer metadata.
- [ ] Fresh Neon migration execution/review through `0003`.
- [ ] Configure real VAPID secrets and deploy Worker + HTTPS PWA.
- [ ] Confirm `/ready` = 200 and deployed smoke passes.
- [ ] Full `typecheck`, `lint`, `test`, `build`, `db:schema:check` in a dependency-complete environment.
- [ ] Live source polling -> transition -> Radar -> Push -> presentation -> click.
- [ ] Verify no retired runtime/dependency/deployment leftovers outside rebuild-history docs.
- [ ] Record supported live sources and measured rate-limit behavior.

## Definition of done

The rebuild is complete only when the old LINE/AI product cannot run and is absent from the application schema; source metadata + polling + current-truth Radar + Web Push work end-to-end on deployed infrastructure; public search cannot expose stale historical availability; human booking links resolve to the official flow; migrations are applied to a clean Neon target; readiness/deploy smoke succeeds; and all executable repository verification passes.
