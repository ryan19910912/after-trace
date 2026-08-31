# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and the actual latest `main` before changing code. Repository state wins over older notes.

## Current product target

Public sports venue availability search + Radar.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI requirement.
- Do not book/pay for users or store venue credentials; direct users to official human booking channels.
- Public-source polling + normalized availability + conditional Web Push are the product core.
- Badminton is the first launch sport; the domain/source model remains generic for other slot-based sports.

## Actual current `main`

The retired LINE-first AI memory product is absent from runtime. `apps/` contains only `api` and `web`; old LINE/AI/Memory/Energy/Commerce/Reminder/Proactive/Admin runtime has been removed.

Current product flow:

1. `TaipeiSportsCenterAdapter` reads the public Taipei sports-center booking source.
2. metadata synchronization keeps the source anchor current, stages a complete provider venue/enabled-sport snapshot, then applies normalized venue/sport mappings only after provider discovery succeeds.
3. empty provider venue snapshots fail closed rather than deactivating every known venue.
4. `source_metadata_runtime` records successful metadata refresh cadence/backoff independently from `sources.updated_at`.
5. scheduled polling refreshes due metadata, disables invalid mappings, reapplies horizon-aware watch demand, then claims due targets.
6. `poll_targets.last_polled_at` is the active poll-claim fence; claimed Workers propagate it through slot/event/missing-slot writes and final target settlement.
7. anonymous browser identity owns private Radar watch rules.
8. current `AVAILABLE` events are matched only against watch state that already existed at the event time.
9. superseded availability events are retired and cannot wake Radar later.
10. matching events create durable Web Push delivery intents.
11. immediately before Push, stale intents are invalidated if watch/source/slot truth changed.
12. VAPID-authenticated payload-free Push wakes the PWA Service Worker.
13. presentation performs one final current-truth check; stale wake-ups return `notification: null` and remain silent.
14. React PWA supports search, Radar create/list/pause/resume/delete and Push enable/disable.
15. public search/presentation never expose provider-machine booking references; human navigation uses `venues.booking_url`.
16. `/health` is cheap liveness; `/ready` checks migrated sports schema + complete valid VAPID configuration.
17. deploy smoke verifies readiness/public APIs and optionally Pages/source data.

Current migrations:

- `drizzle/0000_aftertrace_rebuild.sql` — clean sports-radar baseline; refuses detected legacy LINE/AI tables.
- `drizzle/0001_radar_watch_foundation.sql` — Radar ownership/matching/watch idempotency.
- `drizzle/0002_web_push_delivery_runtime.sql` — Push retry/lease/freshness/presentation runtime.
- `drizzle/0003_source_metadata_runtime.sql` — persisted provider metadata success/retry state.

No schema change was required by the current polling-fence hardening round.

Current polling policy:

- Cron wakes every minute.
- unwatched target requested interval: 300 seconds.
- watch-covered target requested interval: 180 seconds, priority 100.
- every target is clamped by source minimum interval.
- watch demand is relevant only when the watch intersects the current 14-day polling horizon; expired/far-future watches do not keep endpoints hot.
- demand reconciliation never shortens `next_poll_at`, because that field also acts as the active polling recovery lease.
- `last_polled_at` identifies the Worker claim; stale Workers are fenced from critical availability slot/event writes and final health/backoff settlement.
- source metadata normal refresh cadence is six hours; failed refreshes back off 15 minutes.
- provider venue/sport discovery is staged before normalized venue/sport truth is changed, and an empty venue list is treated as a failed snapshot.
- one-minute per-target polling remains disabled until deployed source behavior is measured.

## Completed rebuild areas

### Old product retirement

- LINE webhook/group conversation/LIFF removed.
- Group Memory/Gemini/AI removed.
- Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push removed.
- old admin/auth/retention/runtime schema modules removed.
- retained pnpm monorepo, Hono/Workers, React/Vite, Neon/Drizzle and common verification tooling.

### Sports availability domain

- generic `AvailabilitySourceAdapter` boundary.
- Taipei sports-center adapter.
- normalized sports/venues/venue-sports/courts/availability slots/events.
- public sports/venue/availability APIs.
- mobile search UI + official human booking handoff.
- public availability requires active source + active venue/sport mapping, not just a stale `AVAILABLE` row.

### Polling + source freshness

- due-target priority/lease/fencing.
- per-target polling failure isolation.
- scheduled polling/Radar/Push stage isolation.
- periodic provider metadata synchronization backed by `source_metadata_runtime`.
- provider metadata venue/sport reads are staged before normalized mapping mutations, preventing a later provider metadata failure from leaving earlier venues half-refreshed.
- empty venue snapshots fail closed instead of deactivating every venue.
- source anchor is retained/updated before discovery so first-run failures can still persist metadata retry/backoff state.
- successful metadata clock advances only after the synchronization call finishes.
- metadata failures persist a 15-minute retry boundary.
- invalid source/venue/sport/venue-sport poll targets are disabled.
- watch polling demand is recalculated on CRUD and scheduled passage of time from the current 14-day horizon.
- watch demand changes priority/interval only; active target lease timestamps are left untouched.
- availability slot/status-event and missing-slot writes carry the same `last_polled_at` claim fence as final success/failure settlement.
- the critical slot/event SQL checks the live claim at write time, so a Worker reclaimed between preliminary validation and SQL mutation cannot overwrite current availability truth.
- claim loss is distinct from source failure and does not let an old Worker overwrite newer target health/backoff.

### Radar current-truth guarantees

- anonymous browser identity using a 256-bit credential with only SHA-256 subject persisted.
- watch CRUD/user isolation/idempotent creation.
- empty watch PATCH payloads rejected.
- venue/district/date/day/time matching.
- watch `updated_at` is the activation boundary, so create/edit/resume never retroactively consumes older availability backlog.
- matcher requires the slot to still be `AVAILABLE` and source/venue/sport/venue-sport mapping to still be active.
- a newer transition for the same slot supersedes an older `AVAILABLE` event.
- superseded unmatched events are marked handled so they do not accumulate forever.

### Web Push + PWA

- Push subscription register/deactivate/reconciliation.
- Worker-native VAPID signing/sending.
- dispatch lease/retry/freshness/dead-subscription handling.
- stale pending delivery reconciliation immediately before dispatch.
- final owner/watch/source/slot current-truth check at presentation time.
- successful `notification: null` presentation is silent in the Service Worker instead of becoming a false generic availability alert.
- generic transport fallback wording is neutral and does not claim that a slot is currently bookable.
- browser presentation response is explicitly projected to display/deep-link fields; provider-machine booking refs stay internal.
- Service Worker presentation + click acknowledgement/deep link.

### Release readiness

- `/ready` checks DB schema reachability and VAPID configuration.
- `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1` define deployed verification path.
- CI uses `pnpm install --frozen-lockfile`.

## Current round — provider snapshot safety + stale poll-worker fencing

### Starting state verified

At round start the latest repository already contained periodic metadata refresh, current-truth Radar/Push protections, horizon-aware demand and the `0000` -> `0003` migration chain. `REBUILD_PLAN.md`, this progress file, polling stage/orchestrator, source synchronization repository/service/tests, Radar matcher, notification reconciler/dispatcher/repository/routes and current lockfile were re-read from latest `main` before changes.

Two concrete correctness issues were found in source synchronization:

1. `syncMetadata` interleaved provider `listSports()` calls with venue/sport DB mutations. If a later provider metadata call failed, earlier venues could already have been modified/deactivated even though the refresh was recorded as failed.
2. poll ownership was checked when loading target context and again only when settling success/failure. If a source call exceeded the target lease and another Worker reclaimed the target, the older Worker could still mutate `availability_slots`, create `availability_events`, or mark unseen slots `UNKNOWN` after ownership was lost.

### Code completed this round

Commits on `main`:

- `53f9aa41070c398ac27a48674ebe71e98270a8f6` — staged metadata snapshot + introduced poll-claim-loss semantics.
- `e18a7edd576f608421e529c26419cb0b8f63269c` — added active poll write fences to availability slot/event/missing-slot persistence.
- `be602ef01538078e25bad042d127160f84aab698` — stopped poll work when the repository reports a lost write claim and fenced final settlement.
- `bdcd1ec63c4a0d98771d818fc395a3191eabd2d5` — added metadata-staging and poll-write-fence tests.
- `22e4eff09986693f11641a001f934725efde8b5b` — test/lint cleanup.
- `9d799d9237cfcc6519eb301e743722610d12e683` — retained source anchor before provider discovery so metadata retry runtime works on first failure.
- `ffcf45ad377c6058fd08767550d86afe0d36e64d` — aligned failed-metadata tests with the source-anchor boundary.
- `6fe7918aa60360a0cbcc69c48e5abc3f994de9f1` — synchronized `REBUILD_PLAN.md` with the new safety boundaries.

Important implementation details:

- `syncMetadata` upserts only the source anchor before provider discovery, then reads every venue's enabled launch-sport metadata into memory before mutating normalized venue/sport/venue-sport state.
- an empty provider venue list throws instead of calling `deactivateMissingVenues(..., [])`.
- `PollTargetClaimLostError` separates stale ownership from actual provider/source failure.
- `PollWriteFence` carries `pollTargetId + expectedClaimedAt` through every availability write.
- the critical `availability_slots` + `availability_events` CTE uses a SQL `EXISTS` check against enabled `poll_targets.last_polled_at`, protecting the mutation even if claim ownership changes after a preliminary repository check.
- missing-slot-to-`UNKNOWN` writes reuse the same fence.
- final success settlement is checked; if the expected claim no longer owns the target, the old Worker terminates without writing a failure/backoff over the newer claim.
- tests cover provider failure on a later venue, empty venue snapshot, claim propagation, lost write ownership and lost final settlement.

### Verification performed this round

Actually performed:

- re-read the changed files from latest `main` after commits and confirmed the source snapshot + poll-fence code is present.
- confirmed no database schema/migration change is required for this round; the fence reuses existing `poll_targets.last_polled_at`.
- runtime still reports Node `v22.16.0`, TypeScript `5.8.3`, Corepack `0.32.0`.
- retried `corepack prepare pnpm@10.15.0 --activate`; it again failed fetching the pnpm tarball from `registry.npmjs.org`, so pnpm is unavailable in this runtime.
- inspected the complete `pnpm-lock.yaml` blob and confirmed the stale `apps/admin` importer is still present; `apps/admin` itself is no longer a workspace/runtime app.
- GitHub reports no workflow run for the latest documentation/code chain.

Not truthfully executable here:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell execution of deploy/smoke scripts.

Full repository verification therefore remains **unverified**, not green. The new Vitest cases are committed but have not been executed in a dependency-complete environment.

## Remaining work — highest priority first

### Repository correctness / cleanup

- [ ] Regenerate `pnpm-lock.yaml` from the actual current workspace in a dependency-complete environment so the stale `apps/admin` importer and any now-orphaned snapshots are removed by pnpm itself.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix actual failures.
- [ ] Run PowerShell syntax/execution checks for `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1` on the normal Windows development machine.
- [ ] Repeat full retired-term/source-boundary scan from a local checkout once repository search is reliable.
- [ ] Continue source review for remaining event-ordering/race boundaries while dependency execution remains externally blocked; do not add speculative features.

### Deployment / database

- [ ] point dev/prod at a fresh Neon branch/database.
- [ ] execute/review migrations `0000` -> `0003` against the clean target.
- [ ] configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] deploy Worker and confirm `/ready` = 200.
- [ ] deploy Pages and run `smoke.ps1`; after initial synchronization run with `-RequireSourceData`.
- [ ] confirm Cloudflare Cron is active and `source_metadata_runtime` advances success/backoff as designed.

### Real-device / live-source smoke

- [ ] Chrome/Android: search -> Radar -> Push permission -> real availability transition -> notification -> deep link -> official booking.
- [ ] specifically verify `AVAILABLE -> unavailable/newer transition` before browser presentation produces **no false notification**.
- [ ] pause/edit/resume a Radar while a delivery is pending and verify stale intent is suppressed.
- [ ] iPhone/iPad installed Web App: add to Home Screen -> Push -> notification -> deep link.
- [ ] verify VAPID rotation on a real browser.
- [ ] measure Taipei source latency/error/rate-limit behavior before considering one-minute watched polling.
- [ ] verify non-badminton category IDs per venue before expanding launch sports.

## Next round — planned

1. re-read latest `main`, this progress file and rebuild plan.
2. retry dependency-complete pnpm availability first; if available, regenerate the lockfile and execute the full verification chain before adding scope.
3. if pnpm remains externally blocked, inspect current event chronology/source synchronization/Radar/Push code for another concrete race or stale-state issue and fix only verified problems.
4. keep migration/VAPID/deployed real-device work explicit blockers unless the actual environment/credentials are available.
5. do not enable one-minute polling or expand launch sports without live measurements/category verification.
