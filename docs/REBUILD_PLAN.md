# AFTERTRACE Rebuild Plan

## New product direction

AFTERTRACE is being rebuilt from the previous LINE-first AI memory assistant into a public sports venue availability search + radar product.

V1 product goal:

- Search public sports venue availability across supported Taipei sources.
- Start with high-friction slot-based sports such as badminton, tennis, table tennis and squash; add basketball only where slot-based booking is meaningful.
- Let a user define a watch by sport, venue/area, date/day-of-week and time window.
- Poll supported public booking sources in the background.
- Notify the user when a matching slot becomes available.
- Never book or pay on behalf of the user in V1; link back to the official booking channel.
- V1 does not require AI.
- Web/PWA first; native app later only if usage justifies it.

## Architectural direction

Keep the parts that remain useful for the new product:

- TypeScript + pnpm monorepo.
- Cloudflare Workers + Hono for the API and scheduled polling.
- React + Vite web frontend.
- PostgreSQL/Neon + Drizzle ORM.
- Cloudflare Pages/Workers deployment model.
- Generic validation/test/lint/build tooling.
- Generic auth primitives only where they are not tied to LINE group/LIFF semantics.

Remove old product code completely rather than quarantine it when it has no use in the new product:

- LINE group webhook ingestion and group lifecycle.
- Group conversation buffering.
- Memory extraction and memory management.
- Gemini/AI chat, intent routing and AI billing/cost accounting.
- User Energy wallets, lots, reservations and allocations.
- Rewarded ads.
- Subscription/PAID Energy commerce.
- Reminder and proactive LINE push infrastructure tied to the old product.
- LINE-group/LIFF-specific management surfaces.
- Legacy group-credit compatibility code.
- Old AI/product-specific schema tables, enums, migrations and environment variables after replacement migrations are defined.
- Old AI/product docs once their useful historical information has been captured here.

Review before deciding whether to keep:

- Existing web authentication implementation: retain only generic token/session primitives; remove LINE Login/group-entry assumptions.
- Existing admin app: keep only if it gives real value for venue/source health operations; otherwise delete it entirely.
- Existing shared package: keep generic types/utilities, delete old memory/energy/LINE domain types.
- Existing CI/deployment files: keep if generic, simplify product-specific secrets and checks.

## Target domain model

The rebuild should converge on a small explicit schema. Suggested tables:

### users

- id
- email / auth identity as required by chosen login method
- display_name optional
- created_at / updated_at

### venues

- id
- source_id
- external_venue_id
- name
- district/city
- address
- latitude/longitude optional
- booking_channel (`WEB`, `APP`, `PHONE`, `ONSITE`)
- booking_url / app_url optional
- active
- created_at / updated_at

### sports

- id
- code
- name
- active

### venue_sports

- venue_id
- sport_id
- external_category_id
- active

### courts

- id
- venue_id
- sport_id
- external_court_id
- name
- active

### availability_slots

Current normalized availability state, upserted instead of appending every poll.

- id
- source_id
- venue_id
- sport_id
- court_id optional
- use_date
- start_time
- end_time
- status (`AVAILABLE`, `UNAVAILABLE`, `UNKNOWN`)
- price optional
- external_booking_ref optional
- first_seen_at
- last_seen_at
- updated_at

Unique key should identify the external slot deterministically.

### availability_events

Write only when a meaningful state transition occurs, especially `UNAVAILABLE -> AVAILABLE`.

- id
- availability_slot_id
- previous_status
- new_status
- occurred_at

### watch_rules

- id
- user_id
- sport_id
- enabled
- date mode / day-of-week constraints
- start_time/end_time
- venue IDs and/or area/distance constraints
- created_at / updated_at

### notification_subscriptions

- id
- user_id
- channel (`WEB_PUSH`, later `EMAIL`, `LINE` if justified)
- endpoint/token configuration
- active
- created_at / updated_at

### notification_deliveries

- id
- watch_rule_id
- availability_event_id
- channel
- status
- sent_at
- opened_at optional
- idempotency key

### source_configs / poll_targets

Keep source-specific mapping outside product code where practical.

- source identity
- venue/category mapping
- polling priority/frequency
- enabled/health metadata

## Source strategy

First supported source should be the Taipei sports-center booking platform already manually verified to expose public POST endpoints for:

- location list: `/Home/loadLocationBlock`
- sport list: `/Home/loadSportBlock`
- bookable calendars: `/Location/findAllowBookingCalendars`
- actual slot list: `/Location/findAllowBookingList`

The implementation must normalize external responses behind a source adapter so additional systems can be added without changing watch/search logic.

Polling policy:

- Do not poll the entire universe every minute.
- Active watched targets may be polled every minute if source behavior and rate limits remain safe.
- Popular/search targets can use 5-15 minute polling.
- Unwatched metadata/availability can refresh far less frequently.
- Keep source-specific concurrency/rate limits explicit.

## V1 frontend

Mobile-first responsive web/PWA.

Primary flows:

1. Search availability by sport + date + time + area/venue.
2. View normalized result list across venues.
3. Open official booking channel.
4. If desired slot is unavailable, create a radar/watch.
5. Enable Web Push; use email only as fallback if implemented.
6. Manage active watches.

Do not add AI chat, social feed, team management, booking/payment proxy or unrelated sports-community features in V1.

## Cleanup phases

### Phase 0 — inventory and pivot docs

- [x] Inspect current main entry point, core schema and product docs.
- [x] Create this rebuild plan.
- [x] Create `REBUILD_PROGRESS.md` as the state handoff for each work round.
- [ ] Replace stale README/product description.

### Phase 1 — remove old runtime surface

- [ ] Replace `apps/api/src/index.ts` with a minimal new-product API shell.
- [ ] Remove LINE webhook routes and old LINE modules.
- [ ] Remove AI/chat/intent/memory/extraction/conversation runtime modules.
- [ ] Remove Energy/commerce/rewarded-ad/reminder/proactive runtime modules.
- [ ] Remove old management routes.
- [ ] Remove obsolete environment bindings/secrets from code/config.

### Phase 2 — rebuild database cleanly

- [ ] Enumerate every old schema file/table/enum.
- [ ] Replace schema exports with the new venue/availability/watch schema.
- [ ] Remove old Drizzle schema files that are no longer referenced.
- [ ] Create a deliberate rebuild migration strategy; do not leave legacy tables in the application schema just for compatibility.
- [ ] Update DB schema check scripts.

### Phase 3 — source adapters and availability search

- [ ] Add source adapter contract.
- [ ] Implement Taipei sports-center adapter.
- [ ] Normalize venues/sports/courts/slots.
- [ ] Add source sync service and health logging.
- [ ] Add availability search API.
- [ ] Add tests using captured/synthetic fixtures rather than live network calls.

### Phase 4 — radar engine

- [ ] Add watch-rule API.
- [ ] Add scheduled polling orchestration.
- [ ] Add status-diff/event creation.
- [ ] Add idempotent watch matching.
- [ ] Add Web Push subscription and notification delivery.
- [ ] Add adaptive polling/rate-limit behavior.

### Phase 5 — web rebuild

- [ ] Remove LIFF/LINE/AI/Energy UI.
- [ ] Build mobile-first search page.
- [ ] Build availability results.
- [ ] Build watch creation/management.
- [ ] Add PWA manifest/service worker/Web Push permission flow.
- [ ] Add official-booking deep links.

### Phase 6 — cleanup/verification

- [ ] Remove obsolete docs, tests, dependencies, secrets and deployment variables.
- [ ] Remove unused admin app if it is not repurposed.
- [ ] Run typecheck/lint/test/build/schema validation.
- [ ] Verify no old LINE/AI/Energy product terminology or dead modules remain.
- [ ] Document supported data sources and operational rate limits.

## Definition of done for the rebuild

The rebuild is complete when `main` contains only code required by the sports availability/radar product (plus genuinely reusable platform infrastructure), the old AI/group-memory product is not runnable or referenced, the database schema has no old product tables retained as compatibility debt, and the repository passes the full verification chain.