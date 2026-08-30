# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is being rebuilt from the retired LINE-first AI memory assistant into a public sports venue availability search + radar product.

V1 goals:

- Search normalized public sports venue availability across supported Taipei sources.
- Start with slot-based sports such as badminton, tennis, table tennis and squash; keep the model generic for other slot-based sports.
- Let users watch sport + venue/area + date/day-of-week + time conditions.
- Poll public booking sources with explicit source-specific limits.
- Notify users when a matching slot becomes newly available.
- Never book, pay, store venue credentials, or add AI in V1; send users to the official booking channel.
- Web/PWA first; native app only if usage later justifies it.

## Architecture kept vs retired

Keep:

- TypeScript + pnpm monorepo.
- Cloudflare Workers + Hono.
- React + Vite on Cloudflare Pages.
- PostgreSQL/Neon + Drizzle ORM.
- Shared lint/typecheck/test/build tooling.

Retire completely, without compatibility runtime:

- LINE webhook/group lifecycle and LIFF management.
- Conversation extraction/group memory and Gemini/AI chat.
- Energy/Credit, rewarded ads, commerce, Reminder and Proactive Push.
- LINE-specific auth/admin/retention rules and old schema-round/migration history.

## Current domain model

- `users`: generic identity; V1 uses `ANONYMOUS` browser identities. Raw browser tokens are never stored server-side.
- `sources`, `sports`, `venues`, `venue_sports`, `courts`: normalized provider/venue/sport mapping.
- `availability_slots`: current normalized slot state.
- `availability_events`: meaningful status changes; `matched_at` is the Radar matching cursor.
- `watch_rules` + `watch_rule_venues`: user-owned Radar conditions with idempotent creation keys.
- `notification_subscriptions`: browser Web Push subscription state; V1 keeps one active Web Push endpoint per anonymous browser identity.
- `notification_deliveries`: durable idempotent watch/event delivery ledger.
- `notification_delivery_runtime`: dispatch attempts, recovery lease, freshness expiry and Service Worker presentation state.
- `poll_targets`: source/venue/sport polling schedule and health.

`availability_slots` uses `(source_id, external_slot_key)` as provider identity. Radar matching only scans newly `AVAILABLE`, unmatched events.

## Database strategy

There is no launched legacy product data that must be carried into the new domain. Use a clean sports-radar database, not an in-place compatibility migration.

- `0000_aftertrace_rebuild.sql`: clean baseline; refuses detected legacy LINE/AI tables.
- `0001_radar_watch_foundation.sql`: Radar match cursor + watch idempotency metadata.
- `0002_web_push_delivery_runtime.sql`: Push retry/lease/expiry/presentation state and backfill for existing delivery intents.

Deployment must point `DATABASE_URL` at a fresh Neon branch/database. Runtime Drizzle loading, Drizzle Kit config and `db:schema:check` all use `schema-all.ts` so split schema modules cannot be omitted silently.

## Identity strategy

- `POST /api/v1/session/anonymous` issues a cryptographically random browser token.
- DB stores only SHA-256 subject under provider `ANONYMOUS`.
- Private Radar/Push APIs require `Authorization: Bearer <token>` and scope every query by resolved `user_id`.
- The Web app stores the token locally and sends it to its same-origin Service Worker via `postMessage`; the Service Worker persists it in IndexedDB.
- Never put the token in URLs, Push payloads or logs.
- A later Google/Apple/email upgrade can link identities without changing watch ownership.

## Source + polling strategy

First source is the Taipei sports-center booking platform, with verified public endpoint shapes around:

- `/Home/loadLocationBlock`
- `/Home/loadSportBlock`
- `/Location/findAllowBookingCalendars`
- `/Location/findAllowBookingList`

All providers implement `AvailabilitySourceAdapter`; search/watch logic never consumes raw provider response shapes directly.

The first adapter currently uses 11 independently verified booking-system venue IDs. Nangang is not guessed because its booking LID is not independently verified. Launch synchronization remains badminton-first; other category mappings wait for live venue/category verification.

Polling policy:

- Cron wakes every minute, but targets have independent intervals.
- bounded target claims use `next_poll_at` as recovery lease and `last_polled_at` as settlement fence.
- unwatched target default: 300 seconds.
- enabled-watch coverage: priority `100`, requested 180 seconds, clamped to source minimum.
- do not enable one-minute watched polling until live source behavior/rate limits support it.

## Radar matching + notification strategy

- Write `availability_events` only for meaningful transitions / first `AVAILABLE` observation.
- A watch can match only when it existed at the event's `occurred_at`, preventing stale pre-watch notifications.
- Match sport, city/district, optional venues, date range, days-of-week and time window.
- Delivery idempotency key: `watch:{rule}:event:{event}:web-push`.
- Every delivery gets runtime state and expires 30 minutes after the availability event rather than notifying stale availability.
- An availability event is marked matched only after candidate processing; partial failures remain retryable.

### Web Push

V1 uses Worker Web Crypto for standards-based VAPID authentication; there is no Node-only runtime Web Push dependency.

Worker configuration:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY` (secret)
- `WEB_PUSH_VAPID_SUBJECT`

`pnpm --filter @aftertrace/api webpush:keys` generates the P-256 key pair. `/api/v1/push/config` exposes only the public key.

V1 deliberately sends a **payload-free Push signal**:

1. scheduled dispatch claims a `PENDING` delivery using a recovery lease;
2. Worker sends an empty Push POST with VAPID + TTL + urgency;
3. Push-service acceptance changes the durable delivery to `SENT` before clearing the lease, preventing a successful send from being duplicated after a crash;
4. the Service Worker wakes and authenticates to AFTERTRACE using its browser token + current Push endpoint;
5. it atomically claims one `SENT`, unpresented delivery and renders venue/time context;
6. notification click deep-links to the matching search and owner-isolated acknowledgement marks it `OPENED`.

Retry rules:

- network, 408/425/429 and 5xx => bounded exponential retry inside freshness window;
- 404/410 => deactivate the dead subscription and safely unbind that exact endpoint;
- other HTTP failures => terminal;
- missing/invalid VAPID config => dispatch is disabled, never reported as success.

`p256dh` and `auth` are still validated/stored for correct subscription state/future encrypted payload support, although V1's empty Push signal does not need payload encryption.

## Runtime health + deployment verification

Liveness and readiness are intentionally separate:

- `GET /health` proves the Worker can answer HTTP and must remain cheap.
- `GET /ready` probes the normalized `sports` table and validates full VAPID configuration. It returns `200` only when the deployed Worker is actually ready for the V1 database + Web Push path; missing/invalid dependencies return `503` with non-secret status/error codes.

Deployment smoke is kept in `smoke.ps1` rather than duplicated in release scripts. It verifies liveness, readiness, public Push configuration and public search API shape; it can also verify the Pages URL. `-RequireSourceData` is reserved for post-Cron verification when source synchronization is expected to have populated normalized sports data.

`worker-deploy.ps1` must run migration + deploy + Worker smoke. `pages-deploy.ps1` must build against the selected Worker URL, deploy Pages, then run the combined Worker + Pages smoke.

CI uses `pnpm install --frozen-lockfile` so package-manifest/lockfile drift is not silently rewritten during verification. The remaining stale `apps/admin` importer is a tracked cleanup item and must be removed by regenerating the lockfile from the current workspace in a dependency-complete environment.

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
2. Search normalized availability across supported venues.
3. Open official booking link when a slot is usable.
4. Create a Radar from current filters when no slot fits or the user wants to keep watching.
5. Reuse the anonymous browser identity and list/pause/resume/delete watches.
6. Enable/disable Web Push on supported browsers.
7. Service Worker shows contextual Radar notification.
8. Notification click restores sport/venue/date/time search context.

Detailed in-place editing of every watch condition is optional UX refinement; the API already supports condition patching. Do not add AI chat, feeds, teams or booking/payment proxy to V1.

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
- [x] New sports-radar schema + clean baseline.
- [x] Radar incremental migration.
- [x] Web Push runtime incremental migration.
- [x] Drizzle runtime/config/schema-check point to complete schema exports.
- [ ] Apply/review migrations on a fresh Neon target.

### Phase 3 — source/search
- [x] Adapter contract + Taipei adapter.
- [x] Normalized sports/venues/availability APIs.
- [x] Metadata/slot synchronization, status diff/events and source health/backoff.

### Phase 4 — Radar backend
- [x] Anonymous ownership + watch CRUD/idempotency.
- [x] Race-safe polling orchestration + watch-driven priority.
- [x] New-AVAILABLE matching/idempotent deliveries.
- [x] Web Push subscription registration/deactivation.
- [x] Worker-native VAPID dispatcher.
- [x] retry lease/freshness expiry/dead-subscription handling.
- [x] Service Worker presentation claim + click acknowledgement/deep link.
- [ ] End-to-end deployed Push smoke with real VAPID keys.
- [ ] Measure source behavior before considering one-minute watched polling.

### Phase 5 — Web/PWA
- [x] Mobile search + official booking links.
- [x] Anonymous identity bootstrap/storage.
- [x] Radar create/list/pause/resume/delete UI.
- [x] Manifest + Service Worker + Push permission/subscription flow.
- [x] Notification deep link to matching search.
- [ ] Optional after-smoke UX: detailed watch editing / install guidance.

### Phase 6 — final verification
- [x] Add explicit liveness/readiness contract and reusable deploy smoke script.
- [x] Enforce frozen-lockfile installation in CI.
- [ ] Regenerate the lockfile from the current workspace to remove stale `apps/admin` importer metadata.
- [ ] Fresh Neon migration execution/review.
- [ ] Configure real VAPID secrets and deploy Worker + HTTPS PWA.
- [ ] Confirm `/ready` returns 200 and `smoke.ps1` passes; then require source data after first polling synchronization.
- [ ] Full `typecheck`, `lint`, `test`, `build`, `db:schema:check` in a dependency-complete environment.
- [ ] Live smoke source polling -> availability transition -> match -> Push -> presentation -> click.
- [ ] Verify no retired runtime/dependency/deployment leftovers outside rebuild-history docs.
- [ ] Record supported live sources and measured rate-limit behavior.

## Definition of done

The rebuild is complete only when the old LINE/AI product cannot run and is absent from the application schema, the Taipei source + polling + watch + Web Push loop works end-to-end in a deployed smoke test, migrations are applied to a clean Neon target, readiness/deploy smoke succeeds, and all executable repository verification passes.
