# AFTERTRACE Rebuild Plan

## Product direction

AFTERTRACE is being rebuilt from the retired LINE-first AI memory assistant into a public sports venue availability search + radar product.

V1 goals:

- Search normalized public sports venue availability across supported Taipei sources.
- Start with slot-based sports such as badminton, tennis, table tennis and squash; support other sports only where booking is meaningfully slot-based.
- Let users define watches by sport, venue/area, date/day-of-week and time window.
- Poll supported public booking sources in the background with explicit source-specific rate limits.
- Notify users when a matching slot becomes available.
- Never book, pay, or store venue credentials on behalf of users in V1; link to the official booking channel.
- No AI requirement.
- Web/PWA first; native app only if usage later justifies it.

## Architecture

Retained platform:

- TypeScript + pnpm monorepo.
- Cloudflare Workers + Hono.
- React + Vite on Cloudflare Pages.
- PostgreSQL/Neon + Drizzle ORM.
- Generic lint/typecheck/test/build tooling.

Retired product code must not remain as compatibility runtime:

- LINE webhook/group lifecycle and LIFF management.
- Conversation buffering/extraction/group memory.
- Gemini/AI chat, AI cost accounting and intent routing.
- Group Credit/User Energy, rewarded ads and commerce.
- Reminder/proactive LINE push and old retention rules.
- Old admin UI/runtime and old LINE-specific auth.
- Old schema-round files, migration snapshot and product docs.

## Current target domain model

The rebuilt application schema is intentionally small and explicit:

- `users`: generic auth identity; V1 Radar uses an `ANONYMOUS` provider whose high-entropy browser token is never stored raw.
- `sources`: booking-source identity, base URL and minimum polling interval.
- `sports`: normalized sport taxonomy.
- `venues`: source venue mapping, district/address and official booking channel.
- `venue_sports`: per-venue external category mapping.
- `courts`: normalized venue/sport court mapping.
- `availability_slots`: current normalized slot state, upserted instead of append-only polling history.
- `availability_events`: meaningful slot status transitions only; `matched_at` is the retry-safe Radar matching cursor.
- `watch_rules` + `watch_rule_venues`: user-owned desired sport/date/time/area/venue conditions with per-user idempotent creation keys.
- `notification_subscriptions`: Web Push first; email remains an optional fallback channel.
- `notification_deliveries`: idempotent notification delivery ledger; matching may create unbound `PENDING` Web Push intents before subscription delivery is implemented.
- `poll_targets`: adaptive source/venue/sport polling schedule and health state.

`availability_slots` uses `(source_id, external_slot_key)` as the deterministic external identity. Search indexes prioritize sport/date/status/time and venue/date/status. Radar matching indexes newly `AVAILABLE`, not-yet-matched availability events.

## Database rebuild strategy

The retired product has not launched publicly and there is no required LINE/AI financial or memory data migration into the new product. The repository therefore uses a **clean baseline**, not an in-place compatibility migration.

`drizzle/0000_aftertrace_rebuild.sql` refuses to run when key legacy tables are detected. Deployment must point `DATABASE_URL` at a fresh Neon database/branch (or an explicitly reset dedicated database). This prevents old LINE/AI tables from silently surviving beside the new schema.

New sports-radar features may add ordinary incremental migrations after that baseline. `drizzle/0001_radar_watch_foundation.sql` adds Radar event matching state and idempotent watch creation metadata; it contains a safe backfill for any pre-existing test watch rows.

## Identity strategy

V1 must not reintroduce LINE-specific auth just to create a Radar.

Current low-friction identity boundary:

- `POST /api/v1/session/anonymous` creates a cryptographically random browser token.
- only the SHA-256 token subject is persisted in `users` with provider `ANONYMOUS`.
- private Radar APIs use `Authorization: Bearer <token>`.
- watch queries always include the resolved `user_id`; one browser identity cannot list/update/delete another identity's watches.
- a future Google/Apple/email account system may link/upgrade identities later without changing watch ownership tables.

The anonymous token is a credential and the Web/PWA must store it accordingly; it must never be logged or placed in URLs.

## Source strategy

First supported source remains the Taipei sports-center booking platform manually verified to expose public endpoints shaped like:

- location list: `/Home/loadLocationBlock`
- sport list: `/Home/loadSportBlock`
- bookable calendars: `/Location/findAllowBookingCalendars`
- slot list: `/Location/findAllowBookingList`

All external systems must implement the `AvailabilitySourceAdapter` boundary and return normalized venue/sport/court/slot records. Product search/watch logic must never depend on one provider's raw response shape.

The first adapter currently uses 11 independently verified booking-system venue IDs and six known category IDs. The public sports-center homepage also lists Nangang, but its booking-system LID has not been independently verified, so the code must not guess one. Badminton remains the launch sport; other known category mappings can be enabled only after per-venue live behavior is verified.

Polling policy:

- Cloudflare Cron wakes the scheduler every minute, but this does **not** mean every target is called every minute.
- Poll targets are claimed in small bounded batches.
- Claiming temporarily moves `next_poll_at` forward as a recovery lease and stamps `last_polled_at`; success/failure settlement is fenced against that stamp so overlapping cron executions cannot overwrite a newer claim.
- Unwatched targets default to five-minute polling.
- Enabled watches raise matching venue/sport targets to priority `100` and a three-minute requested interval, always clamped to the source minimum interval.
- One-minute watched polling remains disabled until live source behavior/rate limits justify it.
- Popular/search targets may later gain separate demand signals.
- Unwatched metadata/availability refreshes much less often where appropriate.
- Keep per-source concurrency/minimum interval behavior explicit.

## Radar matching strategy

Radar must be retry-safe and must not send stale pre-watch events.

- Source synchronization writes `availability_events` only for meaningful status changes / first `AVAILABLE` observation.
- The scheduled Worker scans bounded `new_status = AVAILABLE AND matched_at IS NULL` events after polling.
- A watch can match only when it existed at the event's `occurred_at` time.
- Matching applies sport, city/district, optional venue set, date range, day-of-week and time window.
- A matching rule/event pair creates one deterministic delivery key: `watch:{rule}:event:{event}:web-push`.
- Concurrent/retried matching is safe because the delivery idempotency key is unique.
- An event is marked `matched_at` only after its candidate processing finishes; partial failures leave it retryable.
- Actual Push delivery is a separate phase from event matching.

## Public API direction

Current public read surface:

- `GET /health`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?sport=...&venueId=...&district=...&date=...&start=...&end=...`

Current Radar ownership/write surface:

- `POST /api/v1/session/anonymous`
- `GET /api/v1/watch-rules`
- `POST /api/v1/watch-rules` with an `Idempotency-Key` header
- `PATCH /api/v1/watch-rules/:watchRuleId`
- `DELETE /api/v1/watch-rules/:watchRuleId`

Next API phases add Web Push subscription registration, delivery lifecycle and delivery/open acknowledgement where needed.

## Frontend direction

Mobile-first responsive Web/PWA.

Primary flow:

1. Select sport, date, time and optional venue/area.
2. View normalized availability across venues.
3. Open official booking channel.
4. If no suitable slot exists, create a Radar watch.
5. Enable Web Push and manage active watches.

Do not add AI chat, social feeds, team management, booking/payment proxy or unrelated sports-community features in V1.

## Cleanup phases

### Phase 0 — pivot docs/inventory

- [x] Inspect old runtime/schema/product docs.
- [x] Replace README/product direction.
- [x] Add rebuild plan and durable progress handoff.

### Phase 1 — remove old runtime surface

- [x] Replace old API entry point with sports-availability API shell.
- [x] Remove LINE webhook/group runtime.
- [x] Remove AI/memory/extraction/conversation runtime.
- [x] Remove Energy/commerce/rewarded-ad/reminder/proactive/retention runtime.
- [x] Remove old LINE-specific auth/management/admin runtime.
- [x] Remove obsolete environment bindings and LINE/AI deployment smoke tests.

### Phase 2 — rebuild database cleanly

- [x] Replace schema exports with venue/availability/watch/notification/poll-target schema.
- [x] Remove every `schema-round*` legacy schema file.
- [x] Replace old migration baseline and snapshot with a clean rebuild baseline.
- [x] Update Drizzle config and schema-check script.
- [x] Add incremental Radar ownership/matching migration.
- [ ] Point deployment at a fresh Neon database/branch and execute the migrations there.

### Phase 3 — source adapters and availability search

- [x] Add source adapter contract.
- [x] Add normalized DB-backed sports/venues/availability read API.
- [x] Add query validation tests.
- [x] Implement Taipei sports-center adapter with synthetic fixtures derived from verified public response shapes.
- [x] Add metadata + availability upsert synchronization service.
- [x] Add slot status diff/event creation and source health logging.

### Phase 4 — radar engine

- [x] Add watch-rule API/auth boundary.
- [x] Add race-safe bounded poll-target claiming/recovery behavior.
- [x] Add scheduled polling orchestration.
- [x] Add watch matching/idempotent delivery-intent creation.
- [x] Add watch-driven polling priority/three-minute interval bounded by source minimum interval.
- [ ] Add Web Push subscription and delivery.
- [ ] Add delivery retry/expiry/open lifecycle after Push transport exists.
- [ ] Measure live source behavior before considering one-minute watched polling.

### Phase 5 — web/PWA

- [x] Remove LIFF/LINE/AI/Energy UI.
- [x] Build mobile-first search shell and normalized result list.
- [x] Add official booking links.
- [ ] Add anonymous identity bootstrap/storage in Web UI.
- [ ] Add watch creation/management.
- [ ] Add PWA manifest/service worker/Web Push permission flow.

### Phase 6 — final verification

- [ ] Remove any remaining stale dependency/lockfile/importer metadata.
- [ ] Run full typecheck/lint/test/build/schema validation in a dependency-complete environment.
- [ ] Verify no retired LINE/AI/Energy product terminology or dead runtime remains outside rebuild-history documentation.
- [ ] Document supported live sources and measured operational rate limits.

## Definition of done

The rebuild is complete when `main` contains only code needed by the sports availability/radar product plus genuinely reusable platform infrastructure, the old AI/group-memory product cannot run and is not represented in the application schema, the Taipei source + polling + watch + Web Push loop works end-to-end, and all executable verification passes.
