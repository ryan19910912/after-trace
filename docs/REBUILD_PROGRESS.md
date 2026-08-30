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

The large retired-product cut is already complete. Current `main` no longer contains the old LINE/AI product runtime. The application is now a sports-availability shell with a real Taipei source adapter and an active polling scheduler:

- `apps/api/src/index.ts` exposes health + normalized availability APIs and a Cloudflare `scheduled` handler.
- `apps/api/src/db/schema.ts` contains only venue/sport/court/availability/watch/notification/poll-target product tables.
- all old `schema-round*`, LINE/AI/Energy/commerce/reminder/proactive modules and old admin runtime are gone.
- `drizzle/0000_aftertrace_rebuild.sql` remains the clean sports-radar baseline and must be deployed to a fresh Neon database/branch.
- `apps/web` is a mobile-first availability search shell with official booking links.
- source synchronization currently launches badminton-first while retaining generic mappings/model support for later sports.

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

### Changes completed

- `apps/api/src/sources/types.ts`
  - source metadata contract (`name`, `baseUrl`, minimum poll interval).
  - optional bookable-date query support.
  - normalized `courtName`.
- `apps/api/src/sources/taipei-sports-center.ts`
  - first real source adapter.
  - 11 independently verified booking-system venue IDs; no guessed Nangang booking ID.
  - six known provider category mappings with provider-neutral normalized sport codes.
  - form-encoded POST requests, AJAX-style headers, manual redirect handling and bounded retries for network/302/429/5xx failures.
  - rejects successful non-JSON payloads instead of treating login/error HTML as an empty result.
  - normalizes dates, court IDs/names, times, status, price, deterministic slot key and official booking reference.
- `apps/api/src/sources/registry.ts`
  - multi-source adapter registry with Taipei as the first default source.
- `apps/api/src/sources/sync-repository.ts`
  - source/venue/sport metadata upsert/deactivation.
  - court and availability-slot upsert.
  - meaningful `availability_events` creation on first AVAILABLE observation/status transition.
  - stale-slot clearing to `UNKNOWN` after successful source responses.
  - poll-target health and next-poll state.
- `apps/api/src/sources/sync-service.ts`
  - metadata sync and bounded availability-window sync.
  - calendar-first behavior to avoid unnecessary slot-list requests on closed dates.
  - source-target/date consistency hard check.
  - source minimum polling interval + bounded failure backoff.
  - launch metadata is explicitly filtered to badminton by default, so the known extra category mappings do not create unverified production poll targets.

Tests added:

- `apps/api/src/sources/taipei-sports-center.test.ts`
- `apps/api/src/sources/sync-service.test.ts`

### Source coverage decision

The public sports-center homepage currently lists Nangang among sports-center introductions, but the separately verified booking-system implementation/reference set exposes 11 known booking LIDs and does not establish a Nangang booking LID. Do not add a guessed `NGSC` mapping. Add Nangang only after the actual booking source is verified.

The adapter knows six category IDs, but production metadata/poll-target creation is badminton-first until live per-venue behavior for the other sports is measured. The schema/source abstraction remains generic.

## Round 3 — race-safe Cloudflare polling orchestration

### Changes completed

- `apps/api/src/sources/sync-repository.ts`
  - added `hasEnabledPollTargets()` for scheduler bootstrap.
  - added due-target selection ordered by priority, `next_poll_at`, then id.
  - added bounded `claimDuePollTargets()`.
  - claiming uses the existing `poll_targets.next_poll_at` as a temporary recovery lease instead of adding another lease table/column.
  - the claim stamps `last_polled_at`; success/failure settlement optionally fences on that exact timestamp, so an older invocation cannot overwrite a newer claim after lease recovery.
  - candidate selection may race, but the subsequent conditional `UPDATE ... WHERE next_poll_at <= claimedAt` is authoritative; PostgreSQL rechecks the predicate after row-lock waits, preventing two cron invocations from successfully claiming the same due row.
- `apps/api/src/sources/sync-service.ts`
  - accepts an optional claim timestamp and refuses to start a stale/lost claimed target.
  - success/failure settlement carries the claim fence.
- `apps/api/src/polling/orchestrator.ts`
  - bootstraps Taipei metadata when no enabled poll targets exist.
  - claims a small bounded batch (default 3, hard max 6).
  - uses a five-minute recovery lease.
  - polls a 14-day Taipei-local date window.
  - isolates per-target failures with `Promise.allSettled` so one upstream failure does not fail all claimed targets.
- `apps/api/src/polling/orchestrator.test.ts`
  - covers metadata bootstrap, Taipei-local date handling and partial-batch failure isolation.
- `apps/api/src/index.ts`
  - converted the Worker export to the Hono-supported multi-handler shape (`fetch: app.fetch` + `scheduled`).
  - scheduled work builds the DB/source/sync/orchestrator dependencies and logs structured success/failure summaries.
  - export is checked against `ExportedHandler<Bindings>`.
- `apps/api/wrangler.toml`
  - added `* * * * *` Cron Trigger. This only wakes the scheduler every minute; individual targets still obey their own `next_poll_at`/interval.
- `README.md`
  - updated runtime description to reflect active source synchronization + cron polling.

### Polling behavior now

- New metadata-created targets default to 300-second polling.
- Every minute, the Worker claims at most 3 due targets by default.
- A claimed target is temporarily moved 5 minutes into the future as crash recovery protection.
- Normal successful settlement resets its next poll according to the target/source interval; failure applies bounded backoff.
- Launch metadata creates badminton targets only, so the initial target set is intentionally much smaller than `11 venues × all known categories`.
- One-minute per-target polling is **not enabled yet**. It belongs to the later adaptive/watch-priority phase after real source behavior is measured.

### Verification performed

- Re-read latest `main`, rebuild plan/progress, schema, source contract, API entry point, Wrangler config and related tests before/while changing code.
- Verified current Cloudflare Workers documentation (last updated 2026-06-20) supports an ES-module `scheduled(controller, env, ctx)` handler and TOML `[triggers] crons = [...]` syntax.
- Verified current Hono documentation explicitly supports combining Hono with other Cloudflare handlers via `export default { fetch: app.fetch, scheduled: ... }`.
- Earlier local TypeScript parsing/type analysis for the new source modules found only missing-workspace-dependency errors in the automation container; the container does not have pnpm/repository dependencies installed, so this run still cannot truthfully mark full `pnpm typecheck/lint/test/build/db:schema:check` green.
- Repository CI is configured for pushes to `main`, but connector-created commits in this rebuild have not produced new workflow runs. The latest visible historical CI executions predate this rebuild and therefore do not validate current code.

## Remaining work — highest priority first

### Phase 2 deployment blocker

- [ ] Point deployment at a fresh Neon database/branch and execute/review `drizzle/0000_aftertrace_rebuild.sql` there.

### Phase 4 — radar engine

- [x] Add race-safe bounded poll-target claiming/recovery behavior.
- [x] Add due-target selection + Cloudflare scheduled orchestration.
- [ ] Add watch-rule CRUD/auth boundary.
- [ ] Add matcher from newly AVAILABLE `availability_events` to idempotent notification deliveries.
- [ ] Add adaptive polling priority based on active watches/search demand, bounded by source minimum interval and live rate-limit evidence.
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

Implement the Radar ownership/watch foundation as the next coherent batch:

1. decide and implement a low-friction Web/PWA identity boundary that does not reintroduce LINE-specific auth; prefer a server-issued anonymous/browser identity for V1 unless existing generic auth is clearly reusable.
2. add watch-rule create/list/update/delete APIs with validation for sport, venue/area, date/day-of-week and time window.
3. enforce owner isolation and idempotent writes.
4. add DB-backed watch matching for `UNKNOWN/UNAVAILABLE -> AVAILABLE` events and create idempotent `notification_deliveries` rows without sending Push yet.
5. use active watch coverage to raise relevant poll-target priority/interval only within source minimum bounds.
6. add unit/repository tests and update docs before beginning actual Web Push delivery/UI.

## Scheduled-round rules

Each rebuild round must read latest `main`, `REBUILD_PLAN.md` and this file first; verify prior work exists; prefer a large coherent batch; delete obsolete code instead of preserving compatibility debt; run only verification that actually exists; and update this file with exact changes, results, remaining work and the next batch before finishing.
