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

1. Registered `AvailabilitySourceAdapter`s provide provider-specific venue/sport/calendar/availability reads; the first live adapter is `TaipeiSportsCenterAdapter`.
2. `MetadataRefreshingPollingStage` receives its metadata source codes from the adapter registry instead of hard-coding one provider branch.
3. Each source uses independent `source_metadata_runtime` cadence: successful metadata refresh after six hours, provider failure retry after 15 minutes.
4. Provider metadata discovery stages a complete non-empty venue + enabled-sport snapshot before normalized mutations.
5. A metadata failure for one provider does not stop other due providers or polling of already-normalized targets. Successful metadata refresh must still persist its cadence state; a database/runtime persistence failure after success remains a real stage failure.
6. polling claims already-normalized targets only; each target has its own interval/source minimum.
7. `poll_targets.last_polled_at` is the active poll-claim fence. Court + slot + event writes are serialized behind the same row-locking fence.
8. `poll_targets.last_success_at` is the current availability freshness anchor. Search/Radar/Push require successful exact-target truth within `max(15 minutes, 3 × target interval)`.
9. if a persisted AVAILABLE slot was not observed for longer than that freshness allowance and an owned poll confirms it AVAILABLE again, synchronization emits a new AVAILABLE re-confirmation event even though the status value stayed AVAILABLE.
10. anonymous browser identity owns Radar rules; watches validate active source/sport/venue geography and canonicalize common Taiwan `台`/`臺` city spellings.
11. Radar matching requires fresh actionable slot truth, activation boundary ordering and current active source mappings.
12. matching creates durable Web Push intents. Pre-dispatch and browser presentation recheck source/slot/watch truth and Taipei slot-start actionability.
13. Push presentation only accepts the active endpoint and returns display fields + search deep-link only; provider-machine `external_booking_ref` is not a public navigation path.
14. public search exposes only fresh actionable AVAILABLE rows and supplies the normalized venue human `booking_url`.
15. `/health` is liveness and `/ready` checks sports schema reachability plus complete valid VAPID configuration.

Current migration chain remains:

- `drizzle/0000_aftertrace_rebuild.sql`
- `drizzle/0001_radar_watch_foundation.sql`
- `drizzle/0002_web_push_delivery_runtime.sql`
- `drizzle/0003_source_metadata_runtime.sql`

No schema migration was required in this round.

## Completed rebuild areas

### Retired product cleanup

- [x] LINE/group/LIFF runtime removed.
- [x] conversation extraction/Group Memory/Gemini/AI removed.
- [x] Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push removed.
- [x] old admin/auth/retention schema/runtime removed.
- [x] reusable pnpm/Hono/Workers/React/Vite/Neon/Drizzle/tooling kept.

### Sports availability + polling

- [x] Generic `AvailabilitySourceAdapter` + Taipei sports-center adapter.
- [x] normalized source/sport/venue/venue-sport/court/slot/event domain.
- [x] public sports/venue/actionable availability APIs.
- [x] provider-machine booking references isolated from public/shared contracts.
- [x] staged periodic metadata refresh with persisted success/backoff state.
- [x] registry-driven multi-source metadata cadence and provider failure isolation.
- [x] 300-second unwatched / 180-second watched demand, source minimum clamp and 14-day watch horizon.
- [x] demand reconciliation never shortens active `next_poll_at` lease.
- [x] complete `last_polled_at` claim fencing through court/slot/event/missing-slot/final target settlement.
- [x] shared Taipei date/time actionability.
- [x] prolonged provider-outage freshness fail-closed policy.
- [x] stale-gap AVAILABLE re-confirmation events on first trustworthy recovery observation.

### Radar + Web Push

- [x] anonymous identity + watch CRUD/idempotency/user isolation.
- [x] watch area/selected-venue active-catalog validation + city canonicalization.
- [x] create/edit/resume activation boundary.
- [x] superseded/already-started event retirement.
- [x] Radar matching requires current AVAILABLE + exact-target freshness.
- [x] durable Push delivery/retry/expiry/lease fencing.
- [x] pre-dispatch stale delivery invalidation.
- [x] final presentation-time current-truth validation.
- [x] Worker-native VAPID + Service Worker flow.
- [x] presentation requires an active subscription endpoint.
- [x] presentation repository no longer selects/returns `external_booking_ref` or internally derived `officialBookingUrl`.

### Web/PWA + release path

- [x] mobile search + official booking handoff.
- [x] anonymous identity bootstrap + Radar management UI.
- [x] manifest + Service Worker + Push subscription/deep link.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [x] CI frozen-lockfile install policy.

## Current round — registry-driven metadata refresh + provider failure isolation

### Starting state verified

At round start latest `main` was `2926ca345a214c64dc3050026e5345a55e22ce53`. The latest rebuild plan/progress, repository tree, polling metadata stage/tests, source registry, API composition, scheduled summary types, source synchronization/repository, notification repository/reconciler/routes and CI workflow were re-read before changing code.

Concrete issues confirmed:

1. `MetadataRefreshingPollingStage` still hard-coded `taipei-sports-center` even though `SourceAdapterRegistry` already supports multiple adapters. Adding a second source would therefore require hidden polling-stage branching instead of only registering an adapter.
2. When a due provider metadata refresh failed, the stage persisted retry state and then threw immediately. That skipped invalid-target cleanup, watch-demand reconciliation and polling of already-normalized targets for the entire run. A metadata endpoint outage should not stop last-known normalized availability polling when those endpoints remain usable; target-level freshness already fails closed if polling itself later becomes stale.
3. Full dependency-complete verification is still externally blocked because Corepack cannot fetch pnpm from npm registry. `pnpm-lock.yaml` still contains the removed `apps/admin` workspace importer and must be regenerated by pnpm rather than hand-edited.

### Code completed this round

Files changed in this round:

- `apps/api/src/polling/stage.ts`
  - added `refreshDueMetadataSources`, a testable per-source refresh coordinator;
  - source metadata due/backoff is evaluated independently per registered source;
  - one provider discovery failure records a failure result, best-effort persists its 15-minute retry boundary, and continues to later sources;
  - provider metadata failure no longer aborts invalid-target cleanup, demand reconciliation or polling of already-normalized targets;
  - successful provider refresh still requires successful cadence persistence so a DB/runtime write failure cannot silently cause metadata hammering on the next Cron wake-up;
  - stage summary now includes due/refreshed/failed source counts and failed source codes.
- `apps/api/src/polling/stage.test.ts`
  - retained due-boundary tests;
  - added a multi-source case proving a failed source (including failure-runtime persistence failure) does not prevent another due source from refreshing;
  - added a case proving success-cadence persistence failure is not swallowed.
- `apps/api/src/index.ts`
  - creates the default source registry once, shares it with `SourceSynchronizationService`, and passes `registry.list().map(adapter => adapter.code)` into the metadata stage.
- `apps/api/src/scheduled/run.ts`
  - scheduled polling summary now carries metadata source due/refreshed/failed counts and failed source codes.
- `docs/REBUILD_PLAN.md`
  - source strategy now explicitly defines registry-driven source enumeration, per-source failure isolation and success-cadence persistence semantics.
- `docs/REBUILD_PROGRESS.md`
  - records this batch and the remaining verification/deployment work.

Behavioral result:

- adding a new adapter to the default source registry is enough for scheduled metadata refresh to discover its source code; the polling stage no longer needs a new hard-coded branch;
- one provider metadata outage cannot monopolize the whole scheduled polling phase;
- previously normalized targets continue to be polled after that provider metadata failure, while `last_success_at` freshness still prevents stale availability from surfacing if actual availability polling also stops succeeding;
- no migration was added because `source_metadata_runtime` is already keyed by `source_id` and supports independent source cadence.

### Verification actually performed

- Runtime reports Node `v22.16.0` and Corepack `0.32.0`.
- Retried `corepack prepare pnpm@10.15.0 --activate`; it still fails fetching `https://registry.npmjs.org/pnpm/-/pnpm-10.15.0.tgz`.
- Direct GitHub clone from the execution container is also unavailable due DNS resolution, so a dependency-complete local checkout cannot be manufactured as a workaround.
- Source-reviewed the changed constructor/composition path against the actual `SourceAdapterRegistry.list()` contract.
- The new Vitest cases are committed but cannot be truthfully claimed as executed until pnpm dependencies are available.

Not truthfully executable in this environment:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell deploy/smoke script execution

Full repository verification remains **unverified**, not green.

## Remaining work — highest priority first

### Repository correctness / cleanup

- [ ] Regenerate `pnpm-lock.yaml` with the actual current workspace using pnpm so stale `apps/admin` importer metadata is removed by the package manager rather than hand editing a generated file.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix real failures.
- [ ] Run PowerShell syntax/execution checks for deploy/smoke scripts on a normal Windows development environment.
- [ ] Full retired-term/source-boundary scan from a dependency-complete/local checkout.
- [ ] Review SQL-level integration of stale-gap recovery against a real PostgreSQL/Neon database; current logic is source-reviewed and pure timing policy tested, but no DB integration test has executed here.
- [ ] Review Push presentation claiming/current-truth ordering for a possible stale-candidate wake consumption race before declaring notification concurrency final.

### Deployment / database

- [ ] Point dev/prod at a fresh Neon branch/database.
- [ ] Execute/review migrations `0000`→`0003` against clean target.
- [ ] Configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] Deploy Worker + HTTPS PWA and confirm `/ready` = 200.
- [ ] Run deployed smoke with real source data.
- [ ] Run live source polling → normal transition + prolonged-outage re-confirmation → Radar match → Push → presentation → click.
- [ ] Measure live source latency/rate-limit behavior before considering one-minute watched polling.

### Optional only after release verification

- [ ] Detailed watch-editing UX / PWA install guidance if live smoke shows it is useful.
- [ ] Add additional sports/sources only after each source is independently validated.

## Next round priority

First retry dependency-complete verification and regenerate the lockfile if pnpm becomes available. If registry access remains unavailable, inspect Push presentation claim/current-truth ordering and remaining SQL concurrency for another concrete correctness issue rather than expanding V1 scope.
