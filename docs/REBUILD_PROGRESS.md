# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and the actual latest `main` before changing code. Repository state wins over older notes.

## Current product target

AFTERTRACE is now a public sports venue availability search + Radar product.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI.
- Do not book/pay for users or store venue credentials; direct users to official human booking channels.
- Public-source polling + normalized current availability + conditional Web Push are the core.
- Badminton is the first launch sport; the domain/source model remains generic for table tennis, squash, tennis, pickleball, basketball and other slot-based sports.

## Actual current `main`

The retired LINE-first product is absent from application runtime. `apps/` contains only `api` and `web`. LINE group ingestion, LIFF, Group Memory, Gemini/AI, Energy/Credit, Rewarded Ad, Commerce, Reminder, Proactive Push, old admin/auth/retention runtime and legacy schema modules have been removed.

Current runtime flow:

1. `TaipeiSportsCenterAdapter` reads the public Taipei sports-center booking source.
2. `MetadataRefreshingPollingStage` owns provider metadata freshness/backoff.
3. metadata discovery stages a complete venue/enabled-sport snapshot before normalized venue/sport changes are applied; empty venue snapshots fail closed.
4. `source_metadata_runtime` keeps six-hour successful refresh cadence and 15-minute failure retry state independently from source-row timestamps.
5. Polling claims already-normalized targets only. Cron may wake every minute, while each target has its own interval and source minimum.
6. `poll_targets.last_polled_at` is the active poll-claim fence. Critical court + slot + status-event writes are all guarded by the same row-locking claim fence.
7. `poll_targets.last_success_at` is also the current availability freshness anchor. Search/Radar/Push require a successful target poll within `max(15 minutes, 3 × current target interval)`.
8. stale Workers stop when ownership changes and cannot overwrite newer polling health/backoff.
9. anonymous browser identity owns Radar watch rules.
10. watch creation/update validates the active normalized catalog: area-only watches need an active venue/sport mapping, selected venues must support the sport through an active source and must remain inside the declared city/district.
11. common Taiwan top-level city spellings such as `台北市` are canonicalized to `臺北市` before fingerprint/storage so equivalent scope does not become a silent never-match rule.
12. matching requires a new/current AVAILABLE transition, current active source mapping, fresh successful target truth, an actionable future slot start, and a watch activation boundary that predates the event.
13. matching creates durable Web Push delivery intents; pre-dispatch and presentation-time current-truth checks suppress stale alerts, including prolonged-source-outage truth and slots whose Taipei start time has already arrived.
14. payload-free VAPID Push wakes the PWA Service Worker, which fetches one owner-isolated presentation and deep-links back to search.
15. public search exposes only fresh actionable AVAILABLE rows: future Taipei dates, or today's slots whose start time is still in the future.
16. provider-machine booking references stay internal; public/shared search contracts use verified human `booking_url` only.
17. `/health` is liveness and `/ready` checks sports schema reachability plus complete valid VAPID configuration.

Current migration chain:

- `drizzle/0000_aftertrace_rebuild.sql` — clean sports-radar baseline; refuses detected legacy LINE/AI tables.
- `drizzle/0001_radar_watch_foundation.sql` — Radar matching/watch idempotency.
- `drizzle/0002_web_push_delivery_runtime.sql` — Push retry/lease/freshness/presentation runtime.
- `drizzle/0003_source_metadata_runtime.sql` — provider metadata success/retry state.

No schema change was required in the current round.

## Completed rebuild areas

### Retired product cleanup

- [x] Remove LINE/group/LIFF runtime.
- [x] Remove conversation extraction/Group Memory/Gemini/AI runtime.
- [x] Remove Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push runtime.
- [x] Remove old admin/auth/retention schema/runtime modules.
- [x] Keep reusable pnpm/Hono/Workers/React/Vite/Neon/Drizzle/tooling base.

### Sports availability + source normalization

- [x] Generic `AvailabilitySourceAdapter` boundary.
- [x] Taipei sports-center adapter.
- [x] Normalized source/sport/venue/venue-sport/court/slot/event domain.
- [x] Public sports/venue/actionable-current-availability APIs.
- [x] Human booking handoff separated from provider-machine API references.
- [x] Periodic staged metadata refresh with persisted success/backoff state.
- [x] Disable/hide inactive source mappings.
- [x] Prolonged provider-failure freshness gate based on exact poll-target successful truth.

### Polling correctness

- [x] Priority + lease based due-target claiming.
- [x] 300-second unwatched and 180-second watched requested intervals, clamped by source minimum.
- [x] 14-day watch-aware polling demand horizon.
- [x] Demand reconciliation never shortens active `next_poll_at` lease.
- [x] Failure isolation by target and scheduled stage.
- [x] `last_polled_at` claim fencing through slot/event/missing-slot writes and final settlement.
- [x] Row-lock critical availability writes against concurrent reclaim.
- [x] Court discovery/upsert is inside the same claim-fenced SQL statement as slot/event mutation, so an expired Worker cannot rename/reactivate a court after losing ownership.
- [x] Shared Taipei date/time helpers are used wherever wall-clock actionability affects polling/search/Radar/Push.

### Radar + Web Push

- [x] Anonymous identity with only SHA-256 token subject stored server-side.
- [x] Watch CRUD, user isolation and idempotent creation.
- [x] Venue/district/date/day/time matching.
- [x] Watch create/edit/resume activation boundary prevents retroactive alerts.
- [x] Watch area + selected venue validation against active source/venue/sport mappings.
- [x] Common Taiwan `台`/`臺` top-level city canonicalization.
- [x] Superseded event retirement.
- [x] Already-started AVAILABLE events are retired instead of creating late Radar notifications.
- [x] Radar matching requires fresh exact poll-target truth.
- [x] Durable Push delivery ledger, retry, expiry and dispatch lease fencing.
- [x] Pre-dispatch stale intent reconciliation includes target freshness and Taipei slot start-time expiry.
- [x] Final presentation-time current-truth validation includes target freshness and Taipei slot start-time expiry.
- [x] Worker-native VAPID + PWA Service Worker presentation/click flow.

### Web/PWA + release path

- [x] Mobile search and official booking links.
- [x] Anonymous identity storage/bootstrap.
- [x] Radar create/list/pause/resume/delete UI.
- [x] manifest + Service Worker + Push subscription UI.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [x] CI frozen-lockfile install policy.
- [x] README migration list synchronized through `0003`.

## Current round — watch scope correctness + prolonged-source-outage freshness

### Starting state verified

At round start, latest `main` already contained the clean 0000→0003 schema, staged metadata refresh, sole metadata ownership, horizon-aware polling demand, complete poll mutation fencing, Taipei date/start-time actionability, current-truth Radar/Push protections and the React PWA.

`docs/REBUILD_PLAN.md`, this progress file, current watch rules/repository, availability search, poll-target schema, Radar matcher, Push reconciler, README and current repository tree were re-read before changes.

Concrete issues found:

1. A watch could select venue IDs that support the sport but contradict its declared city/district. The rule would be accepted and then silently never match.
2. An area-only watch could name a city/district with no current active source/venue/sport coverage and still be persisted as if it were usable.
3. Venue validation checked venue + venue-sport activity but did not require the underlying source itself to be active.
4. API callers could submit `台北市` while normalized source data uses `臺北市`, producing an equivalent human scope that failed exact matching.
5. Public search, Radar matching and Push final truth checks trusted an AVAILABLE row indefinitely during a prolonged provider outage as long as no newer status transition arrived.
6. README still listed migrations only through `0002` even though `0003_source_metadata_runtime.sql` is part of current `main`.

### Code completed this round

Commits on `main`:

- `3b3fca893354b118fad39d4b8b63a916c6fe7a47` — normalize watch place names and add explicit selected-venue geographic rule.
- `41873586ffbfc208a2d342c755474d9e5848eab0` — validate watch area/selected venues against active source + venue + venue-sport catalog.
- `e3c7cab9a06fe703f406ec08820139b9a3c47b9d` — add watch normalization/geographic-scope tests.
- `e42177f95ccbec04a4451756beacd068145e3391` — add deterministic poll-derived availability freshness policy.
- `fbb280809e77994d77aa6c10ad936522d3792b82` — add initial freshness-policy tests.
- `07195fab46bca0df9e594701aae2363955a07b19` — align invalid interval fallback with the SQL minimum policy.
- `90b5a548edb601a69aad050bbe70834a75854d2d` — correct freshness fallback test expectations.
- `e76633e99b0127b7f3eb80e53c3eea889a2cad63` — require fresh exact poll-target truth in public availability search.
- `4219cecc77e9d4706232d58ec5d99aa719f7282c` — require fresh exact poll-target truth before Radar creates deliveries.
- `f9967c22129f63b9cd9cb683142561511d8c078e` — invalidate/suppress Push when the target has become operationally stale.
- `c72b41cad28074b5b1447a4932cb52e6f1b0e236` — update rebuild plan with watch scope and source-freshness invariants.
- `adf765a3ec30cf9c575c24e1fee422e1e94c85a5` — align README with migration `0003`, watch scope and freshness behavior.

Important behavior after this round:

- `台北市`, `台中市`, `台南市`, `台東縣` are canonicalized to normalized `臺` forms before watch fingerprint/storage.
- selecting venue IDs is now a narrowing constraint inside `city/district`, not a way to create contradictory scope.
- selected venues must be active, have an active venue-sport mapping and belong to an active source.
- area-only Radar creation/update fails when no active normalized venue supports the sport in that area.
- target current truth is fresh for at least 15 minutes, or three configured poll intervals when the source cadence is slower.
- a target with no successful poll, a disabled target or a target beyond that freshness allowance cannot power public search/Radar/Push truth.
- short provider failures are tolerated; prolonged provider failures fail closed rather than falsely claiming old availability.
- no migration was needed because freshness uses existing `poll_targets.last_success_at`, `interval_seconds` and `enabled` state.

### Verification actually performed

- Re-read the latest recursive `main` tree after code/doc commits and confirmed the new `availability/freshness.ts`, test file and modified watch/search/Radar/Push files are present.
- Executed independent Node 22 vectors for city canonicalization, selected-venue geographic matching and freshness-window calculations: **11/11 passed**.
- Runtime reports Node `v22.16.0`, TypeScript `5.8.3` and Corepack `0.32.0`.
- Retried `corepack prepare pnpm@10.15.0 --activate`; it still fails while fetching `https://registry.npmjs.org/pnpm/-/pnpm-10.15.0.tgz` in this environment.
- Re-read `pnpm-lock.yaml`; stale `apps/admin` importer metadata is still present while `apps/admin` is absent from the repository tree.
- GitHub combined status for current code/docs head exposes no completed status checks; do not infer CI success.

Not truthfully executable here:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell execution of deploy/smoke scripts.

Full repository verification remains **unverified**, not green. Committed Vitest cases have not yet run in a dependency-complete environment.

## Remaining work — highest priority first

### Repository correctness / cleanup

- [ ] Regenerate `pnpm-lock.yaml` from the actual current workspace in a dependency-complete environment so stale `apps/admin` importer metadata is removed by pnpm itself.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix actual failures.
- [ ] Run PowerShell syntax/execution checks for deployment/smoke scripts on the normal Windows development machine.
- [ ] Repeat a full retired-term/source-boundary scan from a dependency-complete/local checkout.
- [ ] Clean the remaining notification presentation repository surface that still computes an internal `officialBookingUrl` from provider-machine `external_booking_ref` even though the HTTP route intentionally does not expose it; remove that dead machine-reference path rather than leaving a future misuse footgun.
- [ ] Review recovery semantics after a provider outage longer than the freshness window: decide whether a re-confirmed still-AVAILABLE slot should emit a new availability event or safely remain notification-silent until the next real transition. Prefer explicit deterministic behavior over accidental old-event expiry.

### Deployment / database

- [ ] Point dev/prod at a fresh Neon branch/database.
- [ ] Execute/review migrations `0000`→`0003` against the clean target.
- [ ] Configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] Deploy Worker + HTTPS PWA and confirm `/ready` = 200.
- [ ] Run deployed smoke with real source data.
- [ ] Run live source polling → availability transition → Radar match → Push → presentation → click flow.
- [ ] Measure live source latency/rate-limit behavior before considering one-minute watched polling.

### Optional after release verification

- [ ] Detailed watch-editing UX / PWA install guidance if useful after live smoke.
- [ ] Add additional sports/sources only after each source is independently validated; do not hard-code the domain to badminton.

## Next round priority

First retry dependency-complete verification. If pnpm remains externally unavailable, remove the dead notification presentation machine-booking surface and review long-outage recovery/re-confirmation event semantics. Keep prioritizing stale-state/race/security correctness over speculative product scope.
