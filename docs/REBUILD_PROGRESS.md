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
2. source synchronization normalizes venue/sport/court/slot state into Neon.
3. `source_metadata_runtime` separately records successful metadata refresh cadence/backoff so partial refreshes cannot appear fresh.
4. scheduled polling refreshes due metadata, disables invalid mappings, reapplies horizon-aware watch demand, then claims due targets.
5. anonymous browser identity owns private Radar watch rules.
6. current `AVAILABLE` events are matched only against watch state that already existed at the event time.
7. superseded availability events are retired and cannot wake Radar later.
8. matching events create durable Web Push delivery intents.
9. immediately before Push, stale intents are invalidated if watch/source/slot truth changed.
10. VAPID-authenticated payload-free Push wakes the PWA Service Worker.
11. presentation performs one final current-truth check; stale wake-ups return `notification: null` and remain silent.
12. React PWA supports search, Radar create/list/pause/resume/delete and Push enable/disable.
13. public search/presentation never expose provider-machine booking references; human navigation uses `venues.booking_url`.
14. `/health` is cheap liveness; `/ready` checks migrated sports schema + complete valid VAPID configuration.
15. deploy smoke verifies readiness/public APIs and optionally Pages/source data.

Current migrations:

- `drizzle/0000_aftertrace_rebuild.sql` — clean sports-radar baseline; refuses detected legacy LINE/AI tables.
- `drizzle/0001_radar_watch_foundation.sql` — Radar ownership/matching/watch idempotency.
- `drizzle/0002_web_push_delivery_runtime.sql` — Push retry/lease/freshness/presentation runtime.
- `drizzle/0003_source_metadata_runtime.sql` — persisted provider metadata success/retry state.

Current polling policy:

- Cron wakes every minute.
- unwatched target requested interval: 300 seconds.
- watch-covered target requested interval: 180 seconds, priority 100.
- every target is clamped by source minimum interval.
- watch demand is relevant only when the watch intersects the current 14-day polling horizon; expired/far-future watches do not keep endpoints hot.
- demand reconciliation never shortens `next_poll_at`, because that field also acts as the active polling recovery lease.
- source metadata normal refresh cadence is six hours; failed refreshes back off 15 minutes.
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
- public availability now requires active source + active venue/sport mapping, not just a stale `AVAILABLE` row.

### Polling + source freshness

- due-target priority/lease/fencing.
- per-target polling failure isolation.
- scheduled polling/Radar/Push stage isolation.
- periodic provider metadata synchronization backed by `source_metadata_runtime`.
- successful metadata clock advances only after the synchronization call finishes.
- metadata failures persist a 15-minute retry boundary.
- invalid source/venue/sport/venue-sport poll targets are disabled.
- watch polling demand is recalculated on CRUD and scheduled passage of time from the current 14-day horizon.
- watch demand changes priority/interval only; active target lease timestamps are left untouched.

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

## Current round — source freshness + false-alert prevention

### Starting state verified

At this round start latest `main` was `d13546f20d11de8d49a8206ce93443688e5c5c5f` (`docs: align plan with cron and booking boundaries`). The rebuild plan/progress and current availability repository, source sync, polling orchestrator, watch matcher/repository/rules, notification dispatcher/repository/routes, Service Worker, schema/migrations and scheduled entrypoint were re-read from `main` before changes.

Concrete issues found:

1. public availability could still expose an `AVAILABLE` row after its source or `venue_sports` mapping became inactive.
2. Radar could match an old `AVAILABLE` event even when the current slot was no longer available or a newer transition already existed.
3. matching used watch `created_at`; an edit/resume before delayed matching could make pre-edit events notify under the new watch state.
4. provider metadata only bootstrapped when no poll targets existed, so venue/sport mappings could drift indefinitely after startup.
5. enabled watches outside the current polling horizon could keep endpoints on the hot 180-second schedule forever; future watches also had no time-driven path to become hot later.
6. metadata synchronization resets target interval during upsert, so any periodic metadata refresh must reapply current watch demand.
7. pending Push intents were not invalidated when watch/source/slot truth changed between Radar matching and dispatch.
8. a stale bare Push wake-up could receive `notification: null`, but the Service Worker previously converted that into a generic message implying a new bookable slot.
9. using demand reconciliation to shorten `next_poll_at` would break the existing target lease semantics and permit overlapping source polls.
10. `sources.updated_at` cannot safely represent metadata success because `syncMetadata` touches the source row before the full provider metadata operation completes.

### Code completed this round

Primary batch commit:

- `6e360ee0d0079534a6dced6b50f9c0f26be53c29` — current-truth Radar/search/Push and periodic polling-demand/source refresh foundation.

Follow-up correctness commits:

- `78ff0b8d87df6e0e01707626e1209e9a2f282a75` — demand reconciliation no longer shortens `next_poll_at`; active poll leases remain fenced.
- `54944d13dc9a4b47ffc0a65a5adf5d8ec9618c39` — superseded unmatched `AVAILABLE` events are retired from the Radar queue.
- `84fdffe4740ff72cac25716ae7283025a4a9c810` + `023d4275c4954f98c138528d563c7fb99e4a80e7` — added/exported `source_metadata_runtime` Drizzle schema.
- `11d123ab564492ec0426ad9a47c3a1ed9e2f3c6a` + `f9196770a4141125b844244b6fec202fe3db27b3` — migration `0003_source_metadata_runtime.sql` and Drizzle journal registration.
- `5207b8eb0a74926d354935f35fed17e2f7a5fbfd` — metadata refresh success/backoff now uses the dedicated runtime row instead of `sources.updated_at`.
- `1ef5fab77b3ef9dd9fa2e46b0c1e103f8effae13` — updated metadata cadence tests.

Important implementation changes inside the primary batch:

- `apps/api/src/availability/repository.ts` gates sports/venues/search by active source and active venue-sport mapping.
- `apps/api/src/polling/demand.ts` centralizes horizon-aware watch demand for both CRUD and Cron.
- `apps/api/src/polling/stage.ts` performs due metadata refresh -> invalid target disable -> demand reapply -> availability polling.
- `apps/api/src/watch/repository.ts` delegates demand updates to the shared reconciler instead of maintaining a second policy implementation.
- `apps/api/src/watch/matcher.ts` uses latest watch state, current slot/source truth and latest-event truth.
- `apps/api/src/notifications/reconciler.ts` invalidates stale pending deliveries and performs final presentation-time actionability checks.
- `apps/api/src/notifications/stage.ts` requires stale-intent reconciliation before actual Web Push dispatch.
- `apps/api/src/notifications/routes.ts` suppresses stale presentations and explicitly excludes machine booking refs from browser output.
- `apps/web/public/sw.js` stays silent for a successful null presentation and uses neutral fallback wording.
- `apps/api/src/watch/rules.ts` rejects empty PATCH bodies.
- new tests cover polling-horizon demand, metadata cadence and Push-stage reconciliation ordering/fail-closed behavior.

### Verification performed this round

Actually performed:

- confirmed all above commits are on latest `main`.
- confirmed the migration directory now contains `0000` through `0003`, and `_journal.json` registers `0003`.
- runtime has Node `v22.16.0`, TypeScript `5.8.3`, Corepack `0.32.0`.
- independent Node logic vectors for polling-horizon and metadata-due behavior: **9/9 passed**.
- `node --check` passed on the changed Service Worker null-presentation control-flow extraction.
- attempted `corepack prepare pnpm@10.15.0 --activate`; it failed fetching `registry.npmjs.org`, so pnpm is still unavailable in this runtime.
- `pwsh` is not installed.
- GitHub reports zero workflow runs for the new batch commit/current chain.
- re-read `pnpm-lock.yaml`; stale `apps/admin` importer is still present.

Not truthfully executable here:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell execution of deploy/smoke scripts.

Full repository verification therefore remains **unverified**, not green.

## Remaining work — highest priority first

### Repository correctness / cleanup

- [ ] Regenerate `pnpm-lock.yaml` from the actual current workspace in a dependency-complete environment so the stale `apps/admin` importer and any now-orphaned snapshots are removed by pnpm itself.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix actual failures.
- [ ] Run PowerShell syntax/execution checks for `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1` on the normal Windows development machine.
- [ ] Repeat full retired-term/source-boundary scan from a local checkout once repository search is reliable.

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
3. if pnpm remains externally blocked, inspect current sync/Radar/Push code for remaining concrete race, stale-state or privacy boundary issues and fix only verified issues.
4. review the new `0003` migration/schema contract for any mismatch that `db:schema:check` would expose once dependencies become available.
5. keep deployment/VAPID/live-device items explicit blockers unless actual credentials/environment are available.
6. do not enable one-minute polling or expand launch sports without live measurements/category verification.
