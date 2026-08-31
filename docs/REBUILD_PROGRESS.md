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
9. matching requires a new/current AVAILABLE transition, current active source mapping and a watch activation boundary that predates the event.
10. matching creates durable Web Push delivery intents; pre-dispatch and presentation-time current-truth checks suppress stale alerts.
11. payload-free VAPID Push wakes the PWA Service Worker, which fetches one owner-isolated presentation and deep-links back to search.
12. public search exposes only current/future Taipei-date AVAILABLE rows; historical AVAILABLE rows outside the moving polling horizon are not returned.
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
- [x] Public sports/venue/current-availability APIs.
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
- [x] Court discovery/upsert is now inside the same claim-fenced SQL statement as slot/event mutation, so an expired Worker cannot rename/reactivate a court after losing ownership.
- [x] Shared Taipei calendar helpers used by polling horizon and demand logic.

### Radar + Web Push

- [x] Anonymous identity with only SHA-256 token subject stored server-side.
- [x] Watch CRUD, user isolation and idempotent creation.
- [x] Venue/district/date/day/time matching.
- [x] Watch create/edit/resume activation boundary prevents retroactive alerts.
- [x] Superseded event retirement.
- [x] Durable Push delivery ledger, retry, expiry and dispatch lease fencing.
- [x] Pre-dispatch stale intent reconciliation.
- [x] Final presentation-time current-truth validation.
- [x] Worker-native VAPID + PWA Service Worker presentation/click flow.

### Web/PWA + release path

- [x] Mobile search and official booking links.
- [x] Anonymous identity storage/bootstrap.
- [x] Radar create/list/pause/resume/delete UI.
- [x] manifest + Service Worker + Push subscription UI.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [x] CI frozen-lockfile install policy.

## Current round — calendar/current-search cleanup + complete poll mutation fencing

### Starting state verified

At round start, latest `main` already contained the 0000→0003 migration chain, staged metadata refresh, sole metadata ownership, horizon-aware demand, slot/event row-lock claim fencing, current-truth Radar/Push protections and the React PWA.

The latest `REBUILD_PLAN.md`, `REBUILD_PROGRESS.md`, repository tree, polling/source synchronization, public availability, notification, watch and shared-contract files were re-read before changes.

Three concrete issues were found:

1. Taipei date arithmetic was duplicated between polling orchestration and demand reconciliation, creating unnecessary drift risk around the product's calendar boundary.
2. public availability search filtered `status = AVAILABLE` but did not impose a current Taipei-date floor. Because historical slot rows are retained after the moving polling horizon advances, an old `AVAILABLE` row could still appear when the caller omitted a date.
3. court upsert happened after a non-locking ownership precheck but before the authoritative row-locked slot/event fence. A slow Worker could therefore lose its poll claim, then still reactivate/rename a court even though its subsequent slot write was rejected.

A stale provider-machine `externalBookingRef` also remained in the shared public `AvailabilitySearchItem` type even though the actual API/Web flow had already removed it.

### Code completed this round

Commits on `main`:

- `50832538881b2e39e4a3e4ad27436b2f6e396114` — add shared `time/taipei.ts` calendar helpers.
- `a4d760773aa8642fb98a23c630e8777d53dfbc95` — add Taipei midnight/month/leap-day/invalid-date tests.
- `9522d6aaf387a647efc42d0836e3bafcef199e23` — polling orchestrator reuses shared Taipei helpers.
- `456fc0aa09d43476f5735e517c6e31ff42ea2d24` — polling demand reuses the same calendar arithmetic.
- `387496b3236fcaa0cc38b1f0c03bf39d77be8f5c` — public search excludes slot dates earlier than the current Asia/Taipei date.
- `7fcb87d1fd7add790306086f784992e8f8eb70f5` — remove provider-machine booking ref from the shared public search type.
- `b9e88e208bb40e2284ff7cdf6bc97f0066731bc6` — move court upsert into the same row-locking poll-claim-fenced SQL statement as slot/event mutation.

Important behavior after this round:

- all product calendar-day computations used by polling demand/orchestration share one Asia/Taipei implementation;
- `/api/v1/availability` cannot expose past-date slots even if an old row is still marked AVAILABLE;
- an explicit search for a past date naturally returns no rows because it must also satisfy the current-date floor;
- court metadata derived from availability polling is no longer an unfenced side effect;
- direct/manual synchronization without a poll fence still works because the write fence resolves to `TRUE`;
- no new migration was necessary.

### Verification actually performed

- Re-read the modified source from latest `main` after commits and confirmed the current-date floor, shared date imports and court CTE claim fence are present.
- Executed independent Node 22 vectors for the new calendar logic: **8/8 passed**, including the Asia/Taipei midnight transition, month crossing, leap day and invalid input rejection.
- Runtime reports Node `v22.16.0` and Corepack `0.32.0`.
- `pnpm` is still unavailable in this runtime; previous/retried Corepack resolution is blocked by transient DNS/network access to `registry.npmjs.org`.
- `pnpm-lock.yaml` still contains the stale `apps/admin` importer; `apps/admin` itself is absent from the repository.

Not truthfully executable in this runtime:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell execution of deploy/smoke scripts.

Full repository verification therefore remains **unverified**, not green. The committed Vitest cases have not yet run in a dependency-complete environment.

## Remaining work — highest priority first

### Repository correctness / cleanup

- [ ] Regenerate `pnpm-lock.yaml` from the actual current workspace in a dependency-complete environment so the stale `apps/admin` importer is removed by pnpm itself.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix actual failures.
- [ ] Run PowerShell syntax/execution checks for `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1` on the normal Windows development machine.
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

First retry dependency-complete verification. If pnpm remains externally unavailable, continue source review around remaining state/race boundaries (especially watch/source geographic validation, prolonged provider-failure freshness semantics, and notification presentation cleanup) rather than adding new product scope.
