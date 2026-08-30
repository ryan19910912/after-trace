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

- `users`: generic future auth identity; no LINE identity assumptions.
- `sources`: booking-source identity, base URL and minimum polling interval.
- `sports`: normalized sport taxonomy.
- `venues`: source venue mapping, district/address and official booking channel.
- `venue_sports`: per-venue external category mapping.
- `courts`: normalized venue/sport court mapping.
- `availability_slots`: current normalized slot state, upserted instead of append-only polling history.
- `availability_events`: meaningful slot status transitions only.
- `watch_rules` + `watch_rule_venues`: desired sport/date/time/area/venue conditions.
- `notification_subscriptions`: Web Push first; email remains an optional fallback channel.
- `notification_deliveries`: idempotent notification delivery ledger.
- `poll_targets`: adaptive source/venue/sport polling schedule and health state.

`availability_slots` uses `(source_id, external_slot_key)` as the deterministic external identity. Search indexes prioritize sport/date/status/time and venue/date/status.

## Database rebuild strategy

The retired product has not launched publicly and there is no required LINE/AI financial or memory data migration into the new product. The repository therefore uses a **clean baseline**, not an in-place compatibility migration.

`drizzle/0000_aftertrace_rebuild.sql` refuses to run when key legacy tables are detected. Deployment must point `DATABASE_URL` at a fresh Neon database/branch (or an explicitly reset dedicated database). This prevents old LINE/AI tables from silently surviving beside the new schema.

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
- Poll targets default to a five-minute interval and are claimed in small bounded batches.
- Claiming temporarily moves `next_poll_at` forward as a recovery lease and stamps `last_polled_at`; success/failure settlement is fenced against that stamp so overlapping cron executions cannot overwrite a newer claim.
- Active watched targets may later reach one-minute polling only where source behavior/rate limits permit it.
- Popular/search targets can use 5–15 minute refreshes.
- Unwatched metadata/availability refreshes much less often.
- Keep per-source concurrency/minimum interval behavior explicit.

## Public API direction

Current public read surface:

- `GET /health`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?sport=...&venueId=...&district=...&date=...&start=...&end=...`

Next API phases add watch CRUD, push subscriptions and notification delivery.

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
- [ ] Point deployment at a fresh Neon database/branch and execute the baseline there.

### Phase 3 — source adapters and availability search

- [x] Add source adapter contract.
- [x] Add normalized DB-backed sports/venues/availability read API.
- [x] Add query validation tests.
- [x] Implement Taipei sports-center adapter with synthetic fixtures derived from verified public response shapes.
- [x] Add metadata + availability upsert synchronization service.
- [x] Add slot status diff/event creation and source health logging.

### Phase 4 — radar engine

- [ ] Add watch-rule API/auth boundary.
- [x] Add scheduled polling orchestration with race-safe bounded target claiming/recovery lease behavior.
- [ ] Add watch matching/idempotency.
- [ ] Add Web Push subscription and delivery.
- [ ] Add adaptive polling/rate-limit behavior based on active watch/search demand.

### Phase 5 — web/PWA

- [x] Remove LIFF/LINE/AI/Energy UI.
- [x] Build mobile-first search shell and normalized result list.
- [x] Add official booking links.
- [ ] Add watch creation/management.
- [ ] Add PWA manifest/service worker/Web Push permission flow.

### Phase 6 — final verification

- [ ] Remove any remaining stale dependency/lockfile/importer metadata.
- [ ] Run full typecheck/lint/test/build/schema validation in a dependency-complete environment.
- [ ] Verify no retired LINE/AI/Energy product terminology or dead runtime remains outside rebuild-history documentation.
- [ ] Document supported live sources and measured operational rate limits.

## Definition of done

The rebuild is complete when `main` contains only code needed by the sports availability/radar product plus genuinely reusable platform infrastructure, the old AI/group-memory product cannot run and is not represented in the application schema, the Taipei source + polling + watch + Web Push loop works end-to-end, and all executable verification passes.
