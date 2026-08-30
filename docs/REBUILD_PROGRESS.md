# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and the actual latest `main` before changing code. Repository state wins over older notes.

## Current product target

Public sports venue availability search + Radar.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI requirement.
- Do not book/pay for users or store venue credentials; direct users to official booking channels.
- Public-source polling + normalized availability + conditional Web Push are the product core.
- Badminton is the first launch sport; the domain/source model remains generic for other slot-based sports.

## Actual current `main`

The retired LINE-first AI memory product is absent from the runtime. `apps/` contains only `api` and `web`; the old admin app/runtime is gone.

Current product flow:

1. `TaipeiSportsCenterAdapter` reads the public Taipei sports-center booking source.
2. source synchronization normalizes venue/sport/court/slot state into Neon.
3. scheduled polling claims bounded due targets and records meaningful availability transitions.
4. anonymous browser identity owns private Radar watch rules.
5. newly `AVAILABLE` events are matched idempotently to enabled watches.
6. matching events create durable Web Push delivery intents with lease/retry/freshness handling.
7. VAPID-authenticated payload-free Push wakes the PWA Service Worker.
8. the Service Worker claims one owner-isolated presentation and deep-links back to search.
9. the React PWA supports search, Radar creation/list/pause/resume/delete and Push enable/disable.
10. public availability responses expose the venue's human booking URL; provider-machine references stay internal and are not used/exposed as the public booking CTA.
11. `/health` is cheap liveness; `/ready` checks the migrated sports schema plus valid complete VAPID configuration.
12. deploy smoke verifies Worker readiness/public API shape and optionally Pages/source data.
13. CI installs with `pnpm install --frozen-lockfile`.

Current migrations:

- `drizzle/0000_aftertrace_rebuild.sql` — clean sports-radar baseline; refuses detected legacy LINE/AI tables.
- `drizzle/0001_radar_watch_foundation.sql` — Radar ownership/matching/watch idempotency.
- `drizzle/0002_web_push_delivery_runtime.sql` — Push retry/lease/freshness/presentation runtime.

Current polling policy:

- Cron wakes every minute.
- unwatched target request interval: 300 seconds.
- watch-covered target request interval: 180 seconds, priority 100.
- every target remains clamped by its source minimum interval.
- one-minute per-target polling stays disabled until live rate-limit/source behavior is measured.

## Completed rebuild areas

### Old product retirement

- LINE webhook/group conversation/LIFF removed.
- Group Memory/Gemini/AI removed.
- Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push removed.
- old admin/auth/retention/runtime schema modules removed.
- retained pnpm monorepo, Hono/Workers, React/Vite, Neon/Drizzle and shared verification tooling.

### Sports availability domain

- generic `AvailabilitySourceAdapter` boundary.
- Taipei sports-center adapter.
- normalized sports/venues/venue-sports/courts/availability slots/events.
- public sports/venue/availability APIs.
- mobile search UI + official booking handoff.

### Polling + Radar

- due-target priority/lease/fencing.
- per-target polling failure isolation.
- scheduled pipeline stage isolation: polling failure cannot suppress matching/push, and matching failure cannot suppress already-durable Push dispatch.
- anonymous browser identity using a 256-bit credential with only SHA-256 subject persisted.
- watch CRUD/user isolation/idempotent creation.
- venue/district/date/day/time matching.
- old pre-watch availability is not retroactively notified.
- watch coverage increases relevant target priority/frequency.

### Web Push + PWA

- Push subscription register/deactivate/reconciliation.
- Worker-native VAPID signing/sending.
- dispatch lease/retry/freshness/dead-subscription handling.
- Service Worker presentation claim + click acknowledgement/deep link.
- manifest + Radar/Push UI.
- stale overlapping dispatcher claims are fenced before send.

### Release readiness

- `/ready` checks DB schema reachability and VAPID configuration.
- `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1` verify deployed readiness/API paths.
- CI uses frozen lockfile installation.

## Current round — cron resilience + official booking handoff correctness

### Starting state verified

At round start latest `main` was `c92a450796613cf81ac412964ca61d3e282ea3d6` (`docs: record frozen CI and remaining lock cleanup`). Re-read the latest rebuild plan/progress plus current API entrypoint, polling orchestrator, Radar matcher, Push dispatcher/VAPID implementation, schema, deploy scripts, lockfile importers, web search UI/API model and relevant tests.

Two concrete correctness issues were found and fixed:

1. scheduled polling -> Radar matching -> Push dispatch were one promise chain, so a bootstrap/repository-level polling failure could suppress already-durable Radar/Push work for that cron run.
2. the Taipei adapter stores an `externalBookingRef` built from the machine `findAllowBookingList` endpoint, while the React CTA preferred that reference over the venue's real booking page. Fresh verification of the live Taipei booking site on 2026-08-31 confirmed the root booking site is the actual interactive `Booking NOW` flow; the machine endpoint is not an appropriate user navigation target.

### Code completed this round

Scheduled pipeline isolation:

- `a462b2efa9fa01fc299cebc68e96746477e9c306` — added `apps/api/src/scheduled/run.ts`.
  - always attempts polling, Radar matching and Push dispatch in order.
  - a failed stage is recorded but does not block later durable work.
  - orchestration only emits bounded/sanitized error codes instead of arbitrary exception text.
- `cb9da05e3fed7ccec7200436c2ec6b21c58266f9` — added `apps/api/src/scheduled/run.test.ts` covering all-success, polling failure, Radar failure and all-stage failure behavior.
- `ce400ef071f3d2a728361d838672126572d5b94b` — API scheduled handler now uses `ScheduledRadarRunner` and logs one structured summary.

Official booking handoff boundary:

- `786cb9a6b684758df65025fbbf9da38a568a6147` — `apps/web/src/App.tsx` no longer uses `externalBookingRef` for the `前往官方預約` CTA; it uses the synchronized venue human booking URL instead.
- `049d1194fcd04620754b722966dfd36162ed7092` — public availability repository no longer exposes `availability_slots.external_booking_ref`; that field remains provider-machine provenance in storage/sync only.
- `962b58fb50a6d8f648dbeac4f7ead6d0a256a3ee` — web `AvailabilitySlot` model removed the now-private `externalBookingRef` field, so frontend code cannot accidentally regress to the machine endpoint without an explicit API contract change.

### Verification performed this round

Performed:

- independently strict-compiled the new scheduled runner contract with TypeScript 5.8.3 and local stubs; zero diagnostics.
- re-read committed scheduled runner and booking CTA snippets from latest `main` after writing.
- live source verification on 2026-08-31 confirmed `https://booking-tpsc.sporetrofit.com/` is the interactive booking flow and the site links its navigation as `Booking NOW`; this supports using the venue booking URL rather than `findAllowBookingList` as the public CTA.
- confirmed the latest round commits exist on `main`.
- GitHub Actions returned zero workflow runs for the new cron commit, so CI still does not validate this round.
- local automation environment still has Node 22 + TypeScript 5.8.3 but no `pnpm` and no `pwsh`.

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

- [ ] `pnpm-lock.yaml` still contains stale `apps/admin` importer metadata although the directory no longer exists. Regenerate the lockfile from the current workspace in a dependency-complete environment; do not fabricate dependency snapshots.
- [ ] Run complete frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check` and fix real failures.
- [ ] Run PowerShell syntax/execution checks for `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1` on the normal Windows development machine.
- [ ] Repeat content-level retired-term scan when local checkout/code search is reliable.
- [ ] Continue source-level review for any other provider-machine fields accidentally exposed as user-facing navigation or product truth.

### Deployment / database

- [ ] point dev/prod at a fresh Neon branch/database.
- [ ] execute/review migrations `0000`, `0001`, `0002` against that clean target.
- [ ] configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] deploy Worker and confirm `/ready` = 200.
- [ ] deploy Pages and run `smoke.ps1`; after first synchronization run with `-RequireSourceData`.
- [ ] confirm Cloudflare Cron is active.

### Real-device / live-source smoke

- [ ] Chrome/Android: search -> Radar -> Push permission -> real availability transition -> notification -> deep link -> official booking.
- [ ] iPhone/iPad installed Web App: add to Home Screen -> Push -> notification -> deep link.
- [ ] verify VAPID rotation behavior on a real browser.
- [ ] measure Taipei source latency/error/rate-limit behavior before considering one-minute watched polling.
- [ ] verify non-badminton category IDs per venue before expanding launch sports.

## Next round — planned

1. re-read latest `main`, rebuild plan/progress and actual source.
2. retry dependency-complete pnpm availability; if available, regenerate lockfile and run the complete frozen verification chain.
3. if pnpm remains blocked, continue source-level correctness review of sync/matcher/notification routes and source/provider boundaries; fix concrete issues rather than adding feature scope.
4. only deploy/migrate if real environment credentials are available; otherwise keep those as explicit external blockers.
5. do not enable one-minute watched polling or extra launch sports without deployed measurements.
