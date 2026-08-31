# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is being rebuilt from the retired LINE-first AI memory assistant into a public sports venue availability search + Radar product.

V1 goals:

- Search normalized public sports venue availability across supported Taipei sources.
- Launch with badminton while keeping the domain/source model generic for table tennis, squash, tennis, pickleball, basketball and other slot-based sports.
- Let users watch sport + venue/area + date/day-of-week + time conditions.
- Poll public booking sources with explicit source-specific limits.
- Notify only when a matching slot is newly and **currently** available.
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
- `source_metadata_runtime`: successful provider-metadata refresh clock, retry boundary and last bounded error code. This is separate from `sources.updated_at` because a source row may be touched before a full metadata refresh succeeds.
- `availability_slots`: current normalized slot truth.
- `availability_events`: meaningful status transitions; `matched_at` is the Radar matching cursor.
- `watch_rules` + `watch_rule_venues`: user-owned Radar conditions with idempotent creation keys.
- `notification_subscriptions`: Web Push subscription state; V1 keeps one active endpoint per anonymous browser identity.
- `notification_deliveries`: durable idempotent watch/event delivery ledger.
- `notification_delivery_runtime`: dispatch attempts, recovery lease, freshness expiry and Service Worker presentation state.
- `poll_targets`: source/venue/sport polling schedule and health. `last_polled_at` is also the current poll-claim fence token.

`availability_slots` uses `(source_id, external_slot_key)` as provider identity. `external_booking_ref` is internal provider-machine provenance only. User-facing booking uses normalized venue `booking_url`, which must point at a human booking flow.

## Database strategy

There is no launched legacy product data that must be carried into the new domain. Use a clean sports-radar database, not an in-place compatibility migration.

Current migration chain:

- `0000_aftertrace_rebuild.sql`: clean baseline; refuses detected legacy LINE/AI tables.
- `0001_radar_watch_foundation.sql`: Radar match cursor + watch idempotency metadata.
- `0002_web_push_delivery_runtime.sql`: Push retry/lease/expiry/presentation state.
- `0003_source_metadata_runtime.sql`: persisted source metadata refresh success/backoff state.

Deployment must point `DATABASE_URL` at a fresh Neon branch/database. Runtime Drizzle loading, Drizzle Kit config and `db:schema:check` use `schema-all.ts`, including the split notification and source-runtime schema modules.

## Identity strategy

- `POST /api/v1/session/anonymous` issues a cryptographically random browser token.
- DB stores only its SHA-256 subject under provider `ANONYMOUS`.
- Radar/Push APIs require `Authorization: Bearer <token>` and resolve every private operation to `user_id`.
- The Web app stores the token locally and sends it to its same-origin Service Worker; the Service Worker persists context in IndexedDB.
- Never put the token in URLs, Push payloads or logs.

## Source + polling strategy

First source is the Taipei sports-center booking platform, using verified endpoint shapes around:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

All providers implement `AvailabilitySourceAdapter`; product search/watch logic never consumes raw provider response shapes directly.

Provider-machine endpoints and user navigation are separate. `findAllowBookingList` is ingestion-only; the public CTA uses the venue's verified human booking URL.

### Metadata freshness

Metadata bootstrap is not one-time forever. The scheduled polling stage now:

1. checks `source_metadata_runtime`;
2. refreshes provider venue/sport metadata when `next_attempt_at` is due;
3. keeps/updates the source anchor first so a first-run provider failure can still persist a retry boundary;
4. reads the complete provider venue + enabled-sport snapshot **before** mutating normalized venue/sport/venue-sport truth;
5. rejects an empty venue snapshot instead of interpreting it as authoritative removal of every known venue;
6. applies normalized metadata/deactivation only after all provider metadata reads for the snapshot succeed;
7. advances the successful refresh clock only after the whole synchronization call succeeds;
8. schedules the next normal metadata refresh six hours later;
9. on failure, persists a 15-minute retry boundary instead of calling metadata endpoints every minute;
10. disables poll targets whose source/venue/sport/venue-sport mapping is no longer active;
11. reapplies watch-driven polling demand after metadata refresh, because metadata upsert may reset a target to the source/default interval.

A provider failure halfway through venue discovery therefore cannot leave public/Radar normalized venue/sport truth half-refreshed. A failed refresh may touch the source anchor/runtime bookkeeping, but does not partially apply venue/sport deactivations.

### Polling demand + claim fencing

- Cron wakes every minute, but targets have independent intervals.
- `next_poll_at` doubles as the target recovery lease; demand reconciliation **must not shorten it**.
- `last_polled_at` is the current poll-claim fence. A reclaimed target changes this token.
- A claimed Worker must carry its expected `last_polled_at` token through **every availability-slot/status-event/missing-slot write**, not only final success/failure settlement.
- Critical slot/event upsert uses a SQL `EXISTS` claim fence so an older Worker cannot write stale availability even if it loses the lease between a preliminary claim check and the actual SQL statement.
- When claim ownership is lost, the old Worker stops and must not overwrite failure/backoff/health state owned by the newer Worker.
- unwatched target request interval: 300 seconds.
- watch-covered target request interval: 180 seconds, priority `100`, clamped to source minimum.
- watch-driven hot polling is recalculated from the same 14-day availability horizon used by polling.
- expired watches and watches that start beyond the current horizon do not keep provider endpoints hot.
- a future watch automatically becomes demand-relevant as the moving horizon reaches it.
- watch CRUD triggers the same reconciliation immediately; scheduled polling also re-runs it so time passage alone can change demand.
- do not enable one-minute watched polling until deployed source latency/rate-limit behavior supports it.

Scheduled responsibilities remain failure-isolated: polling failure cannot suppress matching of already-persisted events, and matching failure cannot suppress already-durable Push dispatch.

## Radar current-truth rules

Radar is intentionally transition-based, but notification decisions must reflect current truth:

- Write `availability_events` only for meaningful transitions / first `AVAILABLE` observation.
- A watch may match an event only when its latest `updated_at` is at or before the event's `occurred_at`. Creating, editing or resuming a watch is therefore a new activation boundary; old backlog does not become a retroactive alert.
- Match sport, city/district, optional venues, date range, days-of-week and time window.
- Match only when the current slot is still `AVAILABLE` and its source/venue/sport/venue-sport mapping is active.
- If a newer transition exists for the same slot, the older event is superseded and cannot notify; superseded unmatched `AVAILABLE` events are retired from the queue so they do not accumulate forever.
- Public search applies the same active source/mapping boundaries, so deactivated provider mappings cannot remain visible as stale availability.
- Delivery idempotency key remains `watch:{rule}:event:{event}:web-push`.
- Every delivery expires 30 minutes after its availability event.

## Web Push strategy

V1 uses Worker Web Crypto for VAPID authentication and deliberately sends a payload-free Push signal.

Worker configuration:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

Flow:

1. Radar creates a durable `PENDING` delivery.
2. Immediately before dispatch, stale pending deliveries are reconciled. A delivery is invalidated when its watch was paused/edited, the slot is no longer available, the normalized source mapping is inactive, or a newer slot event supersedes it.
3. Dispatcher claims the current delivery with a fenced recovery lease and sends the empty VAPID Push.
4. Push-service acceptance settles the delivery without allowing an older Worker claim to overwrite newer state.
5. The Service Worker wakes and asks `/api/v1/push/presentation` for one owner-isolated presentation.
6. Presentation performs a final current-truth recheck after the claim. If source/watch/slot state changed after Push acceptance, the API returns `notification: null` and the browser stays silent.
7. Browser presentation exposes display/deep-link fields only; provider-machine booking references never cross this boundary.
8. Notification click deep-links to normalized search, where the verified human booking URL is used.

The generic Service Worker fallback is deliberately neutral; a transport/presentation failure must not falsely claim that a bookable slot currently exists.

Retry rules:

- network, 408/425/429 and 5xx => bounded exponential retry inside freshness window;
- 404/410 => deactivate the dead subscription and safely unbind that exact endpoint;
- other HTTP failures => terminal;
- missing/invalid VAPID config => dispatch disabled, never reported as success.

## Runtime health + deployment verification

- `GET /health`: cheap Worker liveness.
- `GET /ready`: probes normalized sports schema and validates complete VAPID configuration; returns `503` with non-secret codes if not ready.
- `smoke.ps1`: Worker readiness/public API/Push config and optional Pages/source-data verification.
- `worker-deploy.ps1`: frozen install + typecheck/lint/test/build/schema check + migrations + Worker deploy + smoke.
- `pages-deploy.ps1`: build/deploy Pages then combined Worker/Pages smoke.
- CI uses `pnpm install --frozen-lockfile`; lockfile drift must fail rather than be silently rewritten.

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
2. Search normalized current availability.
3. Open the venue's verified human booking flow when a slot is usable.
4. Create a Radar from current filters.
5. Reuse anonymous identity to list/pause/resume/delete watches.
6. Enable/disable Web Push.
7. Service Worker shows a contextual notification only after final current-truth validation.
8. Notification click restores matching search context.

Do not add AI chat, feeds, teams, automatic booking/payment or credential storage to V1.

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
- [x] Radar incremental migration.
- [x] Web Push runtime migration.
- [x] Source metadata runtime migration.
- [x] Complete split-schema export through `schema-all.ts`.
- [ ] Apply/review all migrations on a fresh Neon target.

### Phase 3 — source/search/polling
- [x] Adapter contract + Taipei adapter.
- [x] Normalized sports/venues/availability APIs.
- [x] slot synchronization, status diff/events and target health/backoff.
- [x] separate provider-machine refs from human booking navigation.
- [x] periodic provider metadata refresh with persisted success/backoff state.
- [x] stage provider metadata before applying normalized venue/sport changes; fail closed on empty venue snapshot.
- [x] deactivate invalid source mappings and hide them from public/Radar truth.
- [x] horizon-aware watch polling demand without mutating active target leases.
- [x] fence slot/event/missing-slot writes with the active poll claim, not only final target settlement.

### Phase 4 — Radar backend/Web Push
- [x] Anonymous ownership + watch CRUD/idempotency.
- [x] watch activation boundary + current-slot/current-source matching.
- [x] superseded-event retirement.
- [x] idempotent deliveries + retry/freshness/lease fencing.
- [x] pre-dispatch stale delivery reconciliation.
- [x] final presentation-time current-truth validation.
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
- [ ] Regenerate `pnpm-lock.yaml` from the current workspace to remove stale `apps/admin` importer metadata.
- [ ] Fresh Neon migration execution/review through `0003`.
- [ ] Configure real VAPID secrets and deploy Worker + HTTPS PWA.
- [ ] Confirm `/ready` = 200 and deployed smoke passes.
- [ ] Full `typecheck`, `lint`, `test`, `build`, `db:schema:check` in a dependency-complete environment.
- [ ] Live smoke source polling -> transition -> Radar -> Push -> presentation -> click.
- [ ] Verify no retired runtime/dependency/deployment leftovers outside rebuild-history docs.
- [ ] Record supported live sources and measured rate-limit behavior.

## Definition of done

The rebuild is complete only when the old LINE/AI product cannot run and is absent from the application schema; source metadata + polling + current-truth Radar + Web Push work end-to-end on deployed infrastructure; human booking links resolve to the official flow; migrations are applied to a clean Neon target; readiness/deploy smoke succeeds; and all executable repository verification passes.
