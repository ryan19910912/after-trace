# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and the actual latest `main` before changing code. Repository state wins over older notes.

## Current product target

AFTERTRACE is a public sports venue availability search + Radar product.

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
2. `MetadataRefreshingPollingStage` receives source codes from the adapter registry. Metadata cadence/backoff is per-source and persisted in `source_metadata_runtime`.
3. Provider metadata discovery stages a complete non-empty venue + enabled-sport snapshot before normalized mutations. One provider metadata failure does not stop healthy providers or already-normalized availability polling.
4. Polling claims normalized `poll_targets`; `last_polled_at` is the claim fence and `last_success_at` is the freshness anchor.
5. Court + slot + event writes are serialized behind the active poll claim. Stale workers cannot write current availability or overwrite target health.
6. Search/Radar/Push require exact-target freshness within `max(15 minutes, 3 × target interval)` and Taipei-local actionability.
7. A persisted AVAILABLE slot re-confirmed after a gap longer than the freshness allowance emits a new AVAILABLE recovery event.
8. Anonymous browser identities own Radar rules. Watch rules validate active catalog/geographic scope and canonicalize common Taiwan `台`/`臺` spellings.
9. Radar matching uses activation boundaries, current source/slot truth, freshness and event supersession rules.
10. Matching creates durable Web Push deliveries. Pre-dispatch reconciliation rejects stale truth before send.
11. Bare Web Push wakes the Service Worker, which authenticates with the anonymous token + current endpoint and asks `/api/v1/push/presentation` for one contextual notification.
12. Presentation scans through stale claimed candidates within the same browser wake instead of letting an older stale delivery hide a later actionable delivery.
13. The Service Worker retries transient presentation HTTP/network failures briefly, but fails closed if current truth cannot be revalidated; it no longer emits a generic fallback notification on errors or missing context.
14. Public search exposes only actionable AVAILABLE rows and uses normalized venue `booking_url`; provider-machine `external_booking_ref` remains ingestion/provenance only.
15. `/health` is liveness and `/ready` checks sports schema reachability plus complete valid VAPID configuration.

Current migration chain:

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
- [x] staged periodic metadata refresh + persisted success/backoff state.
- [x] registry-driven multi-source metadata cadence and provider-failure isolation.
- [x] 300-second unwatched / 180-second watched demand, source minimum clamp and 14-day watch horizon.
- [x] complete poll claim fencing through court/slot/event/missing-slot/final target settlement.
- [x] shared Taipei date/time actionability.
- [x] prolonged provider-outage freshness fail-closed policy.
- [x] stale-gap AVAILABLE re-confirmation events on first trustworthy recovery observation.

### Radar + Web Push

- [x] anonymous identity + watch CRUD/idempotency/user isolation.
- [x] watch active-catalog/geographic validation + city canonicalization.
- [x] create/edit/resume activation boundary.
- [x] superseded/already-started event retirement.
- [x] Radar matching requires current AVAILABLE + exact-target freshness.
- [x] durable Push delivery/retry/expiry/dispatch lease fencing.
- [x] pre-dispatch stale delivery invalidation.
- [x] final presentation-time current-truth validation.
- [x] Worker-native VAPID + Service Worker flow.
- [x] presentation requires the active subscription endpoint.
- [x] provider-machine booking refs are absent from presentation/public navigation contracts.
- [x] stale presentation candidates are drained within one wake so they cannot mask the next actionable delivery.
- [x] Service Worker presentation failures are fail-closed; no unverified generic notification is shown.

### Web/PWA + release path

- [x] mobile search + official booking handoff.
- [x] anonymous identity bootstrap + Radar management UI.
- [x] manifest + Service Worker + Push subscription/deep link.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [x] CI frozen-lockfile install policy.

## Current round — fail-closed Push presentation + stale candidate draining

### Starting state verified

At round start latest `main` was `0716b76ce6a2996e5ae96fe482a3821c13caf6df`. `docs/REBUILD_PLAN.md`, this progress file, notification repository/reconciler/routes, the PWA Service Worker and the latest commit history were re-read before changes.

Concrete issues confirmed:

1. `/push/presentation` called `claimPresentation()` first. That marks a candidate as presented, then the route checked current truth. If that candidate had gone stale, the route immediately returned `notification: null`; a later actionable delivery for the same endpoint could therefore remain unpresented even though the browser wake had already happened.
2. `sw.js` showed a generic Radar notification when presentation API calls failed, browser context was missing, or subscription/context could not be resolved. The wording was neutral, but this still violated the product rule that a user-visible notification must only be shown after current availability truth has been revalidated.

### Code completed this round

Files added/changed:

- `apps/api/src/notifications/presentation.ts`
  - added `claimFirstActionablePresentation()`;
  - consumes stale claimed candidates but continues scanning in the same presentation request;
  - hard-caps scanning to avoid an unbounded Service Worker request when queue state is pathological.
- `apps/api/src/notifications/presentation.test.ts`
  - tests stale-stale-actionable draining;
  - tests empty queue behavior;
  - tests the hard scan cap.
- `apps/api/src/notifications/routes.ts`
  - presentation route now uses one captured `now` for claim/current-truth checks;
  - stale candidates no longer force an immediate null response; the same wake can proceed to the next candidate.
- `apps/web/public/sw.js`
  - removed generic notification fallback entirely;
  - transient presentation HTTP/network failures are retried up to three times with short bounded delays;
  - a missing browser identity/context/subscription, successful `notification: null`, or exhausted API/network failure stays silent because current availability was not verified.
- `docs/REBUILD_PROGRESS.md`
  - records this batch and remaining verification/deployment work.

No product scope or data-model decision changed, so `docs/REBUILD_PLAN.md` already describes the intended fail-closed presentation behavior and did not require a semantic change this round.

Commits in this round before this progress update:

- `cc8316c7c7c05811fa86b601b60d63b3394145d0` — `Drain stale Push presentation candidates`
- `b768a6199afea18386133b7b8bcd8ce6d3e8ff47` — `Keep stale Push candidates from consuming a wake`
- `c3e3aed983ee751167f21240e056ad3fa15d91fe` — `Test stale Push presentation draining`
- `9f64ed8f31511d6e3a02468aecfc9d17d232b949` — `Make Push presentation fail closed`

### Verification actually performed

- Global TypeScript strict compile of the exact new `presentation.ts` helper completed with no diagnostics.
- Independent Node behavior vectors for stale-candidate draining and scan capping passed `2/2`.
- `node --check` on the updated Service Worker control flow completed successfully.
- Retried `corepack prepare pnpm@10.15.0 --activate`; it still fails fetching `https://registry.npmjs.org/pnpm/-/pnpm-10.15.0.tgz`.
- GitHub combined status for `9f64ed8f31511d6e3a02468aecfc9d17d232b949` contains no completed status checks.

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

- [ ] Regenerate `pnpm-lock.yaml` with the actual current workspace using pnpm so stale `apps/admin` importer metadata is removed by the package manager rather than hand editing generated lock state.
- [ ] Run frozen-lockfile `typecheck`, `lint`, `test`, `build`, `db:schema:check`; fix real failures.
- [ ] Run PowerShell syntax/execution checks for deploy/smoke scripts on a normal Windows development environment.
- [ ] Full retired-term/source-boundary scan from a dependency-complete/local checkout.
- [ ] Review SQL-level integration of stale-gap recovery against a real PostgreSQL/Neon database.
- [ ] Review whether allowing a `PENDING + dispatchClaimKey` delivery to be selected by presentation is sufficiently correlated when multiple pushes for one endpoint overlap. Bare payload-free Push cannot carry a delivery id, so this remains the main notification concurrency area to scrutinize before declaring Push final.

### Deployment / database

- [ ] Point dev/prod at a fresh Neon branch/database.
- [ ] Execute/review migrations `0000`→`0003` against a clean target.
- [ ] Configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] Deploy Worker + HTTPS PWA and confirm `/ready` = 200.
- [ ] Run deployed smoke with real source data.
- [ ] Run live source polling → normal transition + prolonged-outage re-confirmation → Radar match → Push → presentation → click.
- [ ] Measure live source latency/rate-limit behavior before considering one-minute watched polling.

### Optional only after release verification

- [ ] Detailed watch-editing UX / PWA install guidance if live smoke shows it is useful.
- [ ] Add additional sports/sources only after each source is independently validated.

## Next round priority

First retry dependency-complete verification and regenerate the lockfile if pnpm becomes available. If registry access remains unavailable, inspect the remaining bare-Push correlation problem around `PENDING + dispatchClaimKey` candidates and overlapping deliveries for one endpoint; prefer correctness/idempotency hardening over new V1 features.
