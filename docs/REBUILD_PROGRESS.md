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
2. `MetadataRefreshingPollingStage` exclusively owns provider metadata freshness/backoff.
3. metadata discovery stages a complete non-empty venue + enabled-sport snapshot before normalized metadata mutation.
4. `source_metadata_runtime` keeps six-hour success refresh cadence and 15-minute failure retry state.
5. polling claims already-normalized targets only; each target has its own interval/source minimum.
6. `poll_targets.last_polled_at` is the active poll-claim fence. Court + slot + event writes are serialized behind the same row-locking fence.
7. `poll_targets.last_success_at` is the current availability freshness anchor. Search/Radar/Push require successful exact-target truth within `max(15 minutes, 3 × target interval)`.
8. if a persisted AVAILABLE slot was not observed for longer than that same freshness allowance and an owned poll confirms it AVAILABLE again, synchronization emits a new AVAILABLE re-confirmation event even though the status value stayed AVAILABLE.
9. anonymous browser identity owns Radar rules; watches validate active source/sport/venue geography and canonicalize common Taiwan `台`/`臺` city spellings.
10. Radar matching requires fresh actionable slot truth, activation boundary ordering and current active source mappings.
11. matching creates durable Web Push intents. Pre-dispatch and browser presentation recheck source/slot/watch truth and Taipei slot-start actionability.
12. Push presentation only accepts the active endpoint. It returns display fields + search deep-link only; provider-machine `external_booking_ref` is no longer selected/computed in the notification repository.
13. public search exposes only fresh actionable AVAILABLE rows and supplies the normalized venue human `booking_url`.
14. `/health` is liveness and `/ready` checks sports schema reachability plus complete valid VAPID configuration.

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
- [x] presentation now requires an active subscription endpoint.
- [x] presentation repository no longer selects/returns `external_booking_ref` or internally derived `officialBookingUrl`.

### Web/PWA + release path

- [x] mobile search + official booking handoff.
- [x] anonymous identity bootstrap + Radar management UI.
- [x] manifest + Service Worker + Push subscription/deep link.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [x] CI frozen-lockfile install policy.

## Current round — outage recovery semantics + Push presentation cleanup

### Starting state verified

At round start latest `main` was `e90db6ed689d6abb51c19d1d3c0040557fd0aa79`. The rebuild plan/progress, recursive repository tree, availability freshness policy, source synchronization repository, Radar matcher, notification repository/routes/reconciler and current lockfile were re-read.

Concrete remaining issues confirmed:

1. prolonged provider outage correctly made old AVAILABLE truth disappear, but recovery behavior was accidental: if the provider later confirmed the same slot was still AVAILABLE, no new event was emitted because status stayed AVAILABLE. An active watch could therefore remain notification-silent after truth became trustworthy again.
2. notification `claimPresentation` still selected `availability_slots.external_booking_ref`, selected venue `booking_url`, and computed an internal `officialBookingUrl` even though the route intentionally never exposed that field. This was a future machine-reference misuse footgun.
3. presentation did not require `notification_subscriptions.active = true`, so an already deactivated/replaced endpoint could still be considered for a late wake-up.
4. dependency-complete verification remains unavailable because Corepack still cannot download pnpm from npm registry.

### Code completed this round

Commits on `main` before this progress update:

- `2460faae3c34bc3b06288ee72083dcd8124752f8` — define shared stale-gap observation policy in `availability/freshness.ts`.
- `20f76fd4f3df602ad0750cebcaf4f2aefd181f1f` — add freshness-boundary/reconfirmation unit cases.
- `f39c426ab9e49a65c9dbb35acc152f3fe0295318` — emit a same-status AVAILABLE recovery event when an owned poll observes a slot after a strictly stale observation gap.
- `8040b7be4a2ef3cc87b64bc1ca0f8f71f3203293` — remove provider-machine booking data from Push presentation repository and require active Push endpoint.
- `0474d840bbcdb20042e89b700ff1409280546757` — update rebuild plan with explicit recovery/presentation boundaries.

Important behavior now:

- freshness and stale-gap recovery use the same allowance: `max(900 seconds, 3 × poll target interval)`.
- an observation exactly on the freshness boundary remains fresh; re-confirmation requires a strictly longer gap.
- normal repeated AVAILABLE polls do not create duplicate events.
- after a prolonged outage, the first owned poll that re-confirms a still-AVAILABLE slot creates an AVAILABLE→AVAILABLE event. Older slot events are then superseded by existing Radar current-truth logic.
- a watch active before that recovery event may receive a new notification because the product had intentionally stopped claiming the slot was actionable while stale and now has new trustworthy truth.
- direct/unfenced synchronization does not create stale-gap recovery events; a real poll target/claim is required so source cadence remains authoritative.
- Push presentation no longer has an `external_booking_ref -> officialBookingUrl` path at all.
- a deactivated/replaced Push endpoint cannot claim a presentation candidate.

No migration was added; existing `availability_slots.last_seen_at`, `poll_targets.interval_seconds` and event tables are sufficient.

### Verification actually performed

- Retried `corepack prepare pnpm@10.15.0 --activate` in the runtime. It still fails fetching `https://registry.npmjs.org/pnpm/-/pnpm-10.15.0.tgz`.
- Runtime still reports Node `v22.16.0` and Corepack `0.32.0`.
- Executed independent Node vectors mirroring the new stale-gap helper: **7/7 passed**, including exact-boundary and slower-source cases.
- Re-read latest `main` after code commits and confirmed the new recovery SQL and cleaned Push presentation projection are present.
- Confirmed `pnpm-lock.yaml` still contains an `apps/admin` importer while `apps/admin` is absent from the repository tree.
- GitHub combined status for code head `8040b7be4a2ef3cc87b64bc1ca0f8f71f3203293` exposes no completed statuses.

Not truthfully executable in this environment:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell deploy/smoke script execution

Full repository verification remains **unverified**, not green. The committed Vitest cases have not run in a dependency-complete checkout.

## Remaining work — highest priority first

### Repository correctness / cleanup

- [ ] Regenerate `pnpm-lock.yaml` with actual current workspace using pnpm so stale `apps/admin` importer metadata is removed by the package manager rather than hand editing a generated file.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix real failures.
- [ ] Run PowerShell syntax/execution checks for deploy/smoke scripts on normal Windows development environment.
- [ ] Full retired-term/source-boundary scan from a dependency-complete/local checkout.
- [ ] Review SQL-level integration of stale-gap recovery against a real PostgreSQL/Neon database; current logic is source-reviewed and pure timing policy tested, but no DB integration test has executed here.

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

First retry dependency-complete verification. If pnpm remains externally unavailable, inspect current SQL/notification concurrency for another concrete correctness issue rather than expanding product scope. In particular, review whether stale-gap recovery event creation should gain DB-level idempotency protection for crash/retry edge cases and whether notification presentation claiming can be made more atomic with final current-truth validation without increasing false negatives.
