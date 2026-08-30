# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every manual or scheduled round must read both this file and `docs/REBUILD_PLAN.md` before changing code, verify the actual latest `main`, and update this file before finishing.

## Current product target

Public sports venue availability search + radar.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI requirement.
- Do not book/pay for users; direct them to official booking channels.
- Public-source polling + normalized availability + conditional notifications are the product core.
- Badminton is the first launch sport, while the domain model remains generic for other slot-based sports.

## Actual current repository state

The latest `main` has already completed the large retired-product cut that Round 0 planned. The application no longer contains the old LINE/AI runtime surface. Current runtime is the new availability shell:

- `apps/api/src/index.ts` exposes only health + normalized availability APIs.
- `apps/api/src/db/schema.ts` is the new venue/sport/court/availability/watch/notification/poll-target schema.
- all `schema-round*` files and old LINE/AI schema exports are gone.
- `drizzle/0000_aftertrace_rebuild.sql` is a clean sports-radar baseline and refuses to coexist with detected legacy tables.
- old admin app/runtime and retired LINE/AI/Energy/commerce/reminder/proactive modules are gone.
- `apps/web` is now a mobile-first availability search shell with official booking links.

The rebuild plan is therefore authoritative over the stale Round 0 wording that previously remained in this progress file.

## Round 1 — runtime/database/web pivot already present on `main`

Commit inspected: `fbc18bf46d7ea0905e442dd1c1dabe99eb8090ce` (`refactor: replace legacy LINE AI runtime with availability core`).

Confirmed completed from repository state:

- Phase 1 retired runtime removal.
- Phase 2 clean schema/migration rebuild, except deployment to a fresh Neon database/branch.
- Phase 3 normalized read APIs and query validation foundation.
- Phase 5 old LIFF UI removal + initial mobile availability search shell.
- environment example cleaned of LINE/Gemini/Energy settings.

## Round 2 — Taipei source adapter + synchronization core

### Source behavior verified before implementation

Publicly observable/current references confirm the Taipei sports-center booking source uses:

- `POST /Location/findAllowBookingCalendars` with form fields `LID`, `categoryId`, `start`, `end`.
- `POST /Location/findAllowBookingList?LID=...&categoryId=...&useDate=...` with form fields such as `rows`, `page`, `sord`.
- calendar responses containing date entries such as `start`.
- booking-list rows containing identifiers/names such as `LSID` / `LSIDName`, object-or-string start/end time, `allowBooking`, and `TotalPrice`.
- retryable source behavior can include 302/429/5xx responses.

The implementation uses independently written adapter/parsing code plus synthetic fixtures; it does not import or copy another application runtime.

### Changes completed this round

Added/updated source domain:

- `apps/api/src/sources/types.ts`
  - added source metadata to the adapter contract (`name`, `baseUrl`, minimum poll interval).
  - added optional bookable-date query support.
  - added normalized `courtName` so source-specific court labels can be persisted.
- `apps/api/src/sources/taipei-sports-center.ts`
  - implemented the first real source adapter.
  - uses the known Taipei booking-system venue IDs instead of guessing unknown IDs.
  - supports six known source category mappings while keeping normalized sport codes provider-neutral.
  - performs form-encoded POST requests with explicit AJAX-style headers and manual redirect handling.
  - retries only network / 302 / 429 / 5xx failures with bounded backoff.
  - rejects successful non-JSON payloads so login/error HTML cannot be mistaken for `no availability`.
  - normalizes calendar dates, court IDs/names, times, availability status, price, deterministic external slot key and official booking reference.
- `apps/api/src/sources/registry.ts`
  - added a multi-source adapter registry and default Taipei registration.
- `apps/api/src/sources/sync-repository.ts`
  - added metadata upsert/deactivation for source/venue/sport mappings.
  - creates/refreshes poll targets from normalized venue-sport mappings.
  - resolves a poll target back to provider-neutral + provider-specific identifiers.
  - upserts courts and availability slots.
  - creates `availability_events` only on a meaningful first AVAILABLE observation or status transition.
  - clears stale slots to `UNKNOWN` after a successful target/date response no longer contains them.
  - updates poll-target success/failure health and next-poll timestamps.
- `apps/api/src/sources/sync-service.ts`
  - added source metadata synchronization.
  - added bounded availability-window synchronization (maximum 31 days).
  - uses the source calendar to avoid requesting slot lists for closed dates.
  - validates every returned slot belongs to the requested poll target/date.
  - applies source minimum polling interval and bounded failure backoff.
  - records target health on success/failure.

Added tests:

- `apps/api/src/sources/taipei-sports-center.test.ts`
  - calendar parsing/form request fixture.
  - booking-row normalization fixture.
  - non-JSON success rejection.
- `apps/api/src/sources/sync-service.test.ts`
  - metadata/poll-target creation flow.
  - bookable-date polling + stale-slot clearing flow.
  - failure health recording.

### Important source coverage decision

The official sports-center homepage currently lists Nangang among sports-center introductions, but the separately verified booking-system implementation/reference set exposes 11 known booking LIDs and does not establish a Nangang booking LID. The adapter therefore does **not** guess an ID for Nangang. Add it only after the booking source itself is verified.

The source adapter contains six known category mappings, but launch support must still be treated as badminton-first until per-venue coverage and live behavior for the other categories are measured. The generic sport/schema design remains ready for those later categories without making the product badminton-specific.

### Verification performed this round

- Re-read latest `main`, `docs/REBUILD_PLAN.md`, old progress state, latest commit, schema, availability repository/routes, source types, API entry point and DB client before coding.
- Independently checked the live public booking homepage and current public references for source request/response behavior.
- Ran local TypeScript parsing/type analysis for the new source modules with the available global compiler. The only reported errors were expected missing workspace dependencies (`drizzle-orm`, `vitest`, local DB modules) because the private repository dependencies are not installed in the automation container; no syntax or cross-module type errors were reported for the source/service code itself.
- Checked the repository CI workflow. It is configured for push to `main`, but connector-created commits in this round did not produce workflow runs; the latest visible historical CI runs still predate the rebuild and failed before they can validate this new code. Full `pnpm typecheck/lint/test/build/db:schema:check` must therefore remain unverified until an actual dependency-complete execution occurs.

## Remaining work — highest priority first

### Phase 2 deployment blocker

- [ ] Point deployment at a fresh Neon database/branch and execute/review `drizzle/0000_aftertrace_rebuild.sql` there.

### Phase 4 — radar engine

- [ ] Add poll-target claiming/lease so the same target cannot be concurrently polled by overlapping cron executions.
- [ ] Add due-target selection + Cloudflare scheduled orchestration.
- [ ] Add watch-rule CRUD/auth boundary.
- [ ] Add watch matcher from `availability_events` to idempotent notification deliveries.
- [ ] Add adaptive polling priority based on active watches/search demand, bounded by source minimum interval.
- [ ] Add Web Push subscription/delivery.

### Phase 5 — web/PWA completion

- [ ] Add watch creation/management UI.
- [ ] Add PWA manifest/service worker/Web Push permission flow.

### Phase 6 — final cleanup/verification

- [ ] Remove any remaining stale lockfile/importer/deployment-script references after feature work stabilizes.
- [ ] Run full typecheck/lint/test/build/schema validation in a dependency-complete environment.
- [ ] Verify no retired LINE/AI/Energy runtime terminology remains outside rebuild-history documentation.
- [ ] Live-smoke the Taipei adapter from the deployed Worker and record measured source rate-limit behavior before enabling one-minute watched polling.

## Next round — planned

Implement the poll orchestration/lease foundation as one coherent batch:

1. extend `poll_targets` with a safe claim/lease/fencing mechanism and update the clean baseline (it has not been deployed yet).
2. implement due-target claiming ordered by priority/next-poll time.
3. add Cloudflare `scheduled` execution that claims a bounded number of targets and calls `SourceSynchronizationService.syncPollTarget` using a Taipei-local date window.
4. make failure/recovery release/advance claims safely so overlapping cron executions cannot duplicate source work.
5. add orchestration tests and then proceed to watch matching/notifications.

## Scheduled-round rules

Each rebuild round must read latest `main`, `REBUILD_PLAN.md` and this file first; verify prior work exists; prefer a large coherent batch; delete obsolete code instead of preserving compatibility debt; run only verification that actually exists; and update this file with exact changes, results, remaining work and the next batch before finishing.
