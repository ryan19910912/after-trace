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
7. stale Workers stop when ownership changes and cannot overwrite newer polling health/backoff.
8. anonymous browser identity owns Radar watch rules.
9. matching requires a new/current AVAILABLE transition, current active source mapping, an actionable future slot start, and a watch activation boundary that predates the event.
10. matching creates durable Web Push delivery intents; pre-dispatch and presentation-time current-truth checks suppress stale alerts, including slots whose Taipei start time has already arrived.
11. payload-free VAPID Push wakes the PWA Service Worker, which fetches one owner-isolated presentation and deep-links back to search.
12. public search exposes only actionable AVAILABLE rows: future Taipei dates, or today's slots whose start time is still in the future.
13. provider-machine booking references stay internal; public/shared search contracts use verified human `booking_url` only.
14. `/health` is liveness and `/ready` checks sports schema reachability plus complete valid VAPID configuration.

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
- [x] Superseded event retirement.
- [x] Already-started AVAILABLE events are retired instead of creating late Radar notifications.
- [x] Durable Push delivery ledger, retry, expiry and dispatch lease fencing.
- [x] Pre-dispatch stale intent reconciliation includes Taipei slot start-time expiry.
- [x] Final presentation-time current-truth validation includes Taipei slot start-time expiry.
- [x] Worker-native VAPID + PWA Service Worker presentation/click flow.

### Web/PWA + release path

- [x] Mobile search and official booking links.
- [x] Anonymous identity storage/bootstrap.
- [x] Radar create/list/pause/resume/delete UI.
- [x] manifest + Service Worker + Push subscription UI.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [x] CI frozen-lockfile install policy.

## Current round — actionable-time correctness + complete poll mutation fencing

### Starting state verified

At round start, latest `main` already contained the 0000→0003 migration chain, staged metadata refresh, sole metadata ownership, horizon-aware demand, slot/event row-lock claim fencing, current-truth Radar/Push protections and the React PWA.

The latest plan/progress, repository tree, polling/source synchronization, public availability, notification, watch and shared-contract files were re-read before changes.

Concrete issues found:

1. Taipei date arithmetic was duplicated between polling orchestration and demand reconciliation.
2. public availability search could return historical `AVAILABLE` rows once they fell outside the moving polling horizon.
3. even after a date floor, a same-day slot whose start time had already passed could still appear/actionably notify if the provider row remained AVAILABLE.
4. Radar matching and Push revalidation had no wall-clock slot-start gate, so delayed processing could alert after the court time began.
5. court upsert happened after a non-locking ownership precheck but before the authoritative row-locked slot/event fence, allowing a stale Worker to mutate court metadata after losing its poll claim.
6. the shared public `AvailabilitySearchItem` still exposed stale provider-machine `externalBookingRef` type surface.

### Code completed this round

Commits on `main`:

- `50832538881b2e39e4a3e4ad27436b2f6e396114` — add shared Taipei calendar helpers.
- `a4d760773aa8642fb98a23c630e8777d53dfbc95` — add date/month/leap-day/invalid-input tests.
- `9522d6aaf387a647efc42d0836e3bafcef199e23` — polling orchestrator reuses shared helpers.
- `456fc0aa09d43476f5735e517c6e31ff42ea2d24` — polling demand reuses the same calendar arithmetic.
- `387496b3236fcaa0cc38b1f0c03bf39d77be8f5c` — public search receives a Taipei-date current floor.
- `7fcb87d1fd7add790306086f784992e8f8eb70f5` — remove provider-machine booking ref from shared public search type.
- `b9e88e208bb40e2284ff7cdf6bc97f0066731bc6` — move court upsert into the same row-locking poll-claim-fenced SQL statement as slot/event mutation.
- `3297e069e38f783b495036833c3a1eb01c959ee9` — add shared `taipeiTime()` wall-clock helper.
- `da721444466de072f91232e9813888379129455f` — extend helper tests across Taipei midnight clock transition.
- `9585f39cc827d5182dc6eb155bb7f83458c2cea9` — public search excludes same-day slots once their start time has arrived.
- `9ecdbbf3c55b6eb279e830377ca6e0569421637e` — Radar retires already-started AVAILABLE events and filters them before matching.
- `66df41e7a7f2bf4a9696b10a3843e5725bae152d` — Push pre-dispatch and final presentation gates invalidate deliveries once slot start time arrives.

Important behavior after this round:

- all product calendar-day/wall-clock comparisons in these paths use Asia/Taipei;
- `/api/v1/availability` cannot expose past dates or already-started slots today even if the DB row still says AVAILABLE;
- delayed Radar processing cannot create a delivery after a slot's start time;
- pending Push delivery becomes stale at slot start even without another provider transition;
- browser presentation performs the same final wall-clock current-truth gate;
- court metadata derived from polling is no longer an unfenced side effect;
- direct/manual synchronization without a poll fence still works because the write fence resolves to `TRUE`;
- no migration was needed.

### Verification actually performed

- Re-read modified files from latest `main` after commits and confirmed the new court CTE fence, public actionable-time filter and Push wall-clock gates are present.
- Executed independent Node 22 vectors for the shared Taipei helpers: **10/10 passed**, including Asia/Taipei midnight date/time, month crossing, leap day and invalid input rejection.
- Ran standalone strict TypeScript compilation of the new Taipei helper shape with global `tsc`; it completed without diagnostics.
- Runtime reports Node `v22.16.0` and Corepack `0.32.0`.
- Retried `corepack prepare pnpm@10.15.0 --activate`; it still fails fetching `https://registry.npmjs.org/pnpm/-/pnpm-10.15.0.tgz` in this environment.
- `pnpm-lock.yaml` still contains the stale `apps/admin` importer while `apps/admin` itself is absent.
- GitHub combined status for the current code commits exposes no completed status checks; do not infer CI success.

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
- [ ] Continue correctness review while package execution is blocked; prioritize stale-state/race/security behavior over speculative features.

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

First retry dependency-complete verification. If pnpm remains externally unavailable, continue source review around remaining state/race boundaries (especially watch/source geographic validation, prolonged provider-failure freshness semantics and notification presentation cleanup) rather than adding new product scope.
