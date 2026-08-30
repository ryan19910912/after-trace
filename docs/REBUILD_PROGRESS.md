# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every manual or scheduled round must read both this file and `docs/REBUILD_PLAN.md` before changing code, verify the actual latest `main`, and update this file before finishing.

## Current product target

Public sports venue availability search + Radar.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI requirement.
- Do not book/pay for users or store venue credentials; direct users to official booking channels.
- Public-source polling + normalized availability + conditional Web Push are the product core.
- Badminton is the first launch sport, while the domain/source model remains generic for other slot-based sports.

## Actual current `main`

The retired LINE-first AI memory product has been removed from the runtime. `apps/` now contains only `api` and `web`; the old admin application is gone.

The current product path is implemented end-to-end at code level:

1. `TaipeiSportsCenterAdapter` reads public venue/calendar/availability endpoints.
2. source synchronization normalizes venue/sport/court/slot state into Neon/Drizzle models.
3. Cloudflare scheduled work claims bounded due poll targets and records availability transitions.
4. anonymous browser identity owns private Radar watch rules.
5. newly `AVAILABLE` events are matched idempotently to enabled watches.
6. matching events create Web Push delivery intents with bounded freshness, lease/retry and dead-subscription handling.
7. VAPID-authenticated payload-free Web Push wakes the PWA Service Worker.
8. the Service Worker claims one owner-isolated accepted presentation from the API, displays venue/date/time context, and deep-links back to the relevant search/official booking flow.
9. the React PWA can search availability, create/list/pause/resume/delete Radar rules, enable/disable Push, and recover its anonymous Radar identity.

Current migrations:

- `drizzle/0000_aftertrace_rebuild.sql` — clean sports-radar baseline; refuses a detected legacy LINE/AI database instead of carrying old tables forward.
- `drizzle/0001_radar_watch_foundation.sql` — anonymous Radar ownership, matching cursor and watch idempotency state.
- `drizzle/0002_web_push_delivery_runtime.sql` — Push lease/retry/expiry/presentation runtime.

Current polling policy:

- Worker Cron wakes every minute.
- unwatched poll targets request 300-second polling.
- watch-covered targets are priority 100 and request 180-second polling.
- every target is clamped by its source minimum interval.
- one-minute per-target polling is intentionally still disabled until deployed source behavior/rate limits are measured.

## Completed rebuild batches

### 1. Retired product removal + clean sports domain

Completed:

- removed LINE webhook/group conversation, Group Memory, Gemini/AI, Energy, Rewarded Ad, Commerce, Reminder, Proactive Push and old admin runtime.
- replaced legacy schema with clean sports availability/Radar tables.
- preserved pnpm monorepo, Cloudflare Worker/Hono, React/Vite, Neon/Drizzle and common verification tooling.
- built public sports/venue/availability read APIs and mobile-first search UI.

### 2. Taipei source adapter + normalization

Completed:

- generic `AvailabilitySourceAdapter` boundary and registry.
- Taipei sports-center adapter using form-encoded public booking endpoints.
- venue/sport/court/slot normalization, deterministic external slot identity, official booking references and stale-slot reconciliation.
- bounded retry/error classification and source health behavior.
- launch synchronization is badminton-first; other known sports remain behind the generic domain until live coverage is verified.

### 3. Race-safe polling orchestration

Completed:

- priority/`next_poll_at` due-target selection.
- bounded claiming with crash-recovery lease and settlement fence.
- one-minute Cron wake-up with independent target intervals.
- Taipei-local 14-day polling window and per-target failure isolation.

### 4. Anonymous Radar ownership + watch matching

Completed:

- 256-bit anonymous browser credential; DB stores only SHA-256 identity subject.
- bearer-authenticated watch CRUD with user isolation.
- idempotent create via `Idempotency-Key` + canonical payload fingerprint.
- sport/venue/city/district/date/day-of-week/time matching.
- newly-available event cursor and idempotent watch/event delivery keys.
- old availability that predates a watch is not retroactively notified.
- overlapping rules for the same user/event are deduplicated so one availability event does not fan out duplicate notifications to the same browser identity.
- enabled watch coverage raises relevant poll-target priority/frequency without rewriting an active poll lease.

### 5. Web Push + PWA Radar UX

Completed before this round:

- authenticated Push subscription upsert/deactivation endpoints.
- public VAPID application-server-key endpoint; private key remains Worker-only.
- edge-native P-256 VAPID signing/sending with no Node-only Push dependency.
- delivery runtime with claim lease, bounded retry, 30-minute freshness cutoff, 404/410 dead-subscription retirement and click/open acknowledgement.
- payload-free Push presentation design: Service Worker wakes, proves anonymous identity + current endpoint, atomically claims the accepted notification context, then renders it locally.
- manifest, Service Worker, notification click handling and deep-link search parameters.
- React UI for anonymous identity, Watch creation/list/pause/resume/delete and notification enable/disable.
- Push settlement/presentation race handling and delivery-settlement fencing.

## Current round — Push lifecycle recovery, VAPID rotation safety and dispatch fencing

### Starting state verified

Latest `main` at the beginning of this round was `5f3f8e7be380dbee885626a3f4382255293d812f` (`fix: dedupe overlapping Radar watches per user event`). The rebuild plan/progress, current Web Push dispatcher/repository/routes, PWA helper, React app, service worker, schema, Taipei source adapter, CI and verification scripts were re-read before changes.

The old progress handoff was materially stale: it still described Web Push and PWA Radar UX as future work even though those features already existed on `main`. This file is now corrected to the actual repository state.

### Code completed this round

Push subscription lifecycle hardening:

- `52860adf726c0f9f23bb0c8f128cbae2a0bdd909` — `fix: reconcile Radar push subscriptions safely`
  - added browser subscription/current VAPID public-key comparison.
  - startup reconciliation now re-upserts a still-valid browser `PushSubscription` to the backend. This repairs a fresh/reset database or a previously deactivated server row without forcing the user to toggle notifications again.
  - explicit notification enable detects VAPID key rotation, unsubscribes the obsolete browser endpoint, best-effort deactivates it server-side, and creates a new subscription with the current application-server key.
  - startup intentionally does **not** silently resubscribe after VAPID rotation; a new subscription remains behind explicit user action.
  - notification disable now unsubscribes the browser first, so a transient API failure cannot leave local notifications enabled. Backend deactivation is best-effort; a stale server endpoint will also be retired when Push returns 404/410.

React startup recovery:

- `f504d370b8d07ce5a7435ed0b5529cad777fb827` — `fix: repair push registration on PWA startup`
  - replaced the old browser-only `currentPushEnabled()` check with server reconciliation.
  - Push reconciliation failure is isolated from Watch loading (`catch(() => false)`), so a Push config/API issue does not make the Radar screen fail to initialize.

PWA test coverage:

- `4051274b719c9892df19bb7911bd83ce29b01db5` — `test: cover VAPID subscription key matching`
  - covers matching key, rotated/different key, null key and malformed base64url input.

Verification script completeness:

- `a877aa21a6034bbc7707101e97a4cbdbc3d4f5e5` — `chore: include Drizzle schema in local verification`
  - `verify.ps1` now includes `pnpm db:schema:check` after build, matching the intended complete verification chain.

Push dispatch fencing:

- `408449b16c2446021b6d91d8008175d8576536ad` — `fix: fence push subscription binding by delivery claim`
- `1dc1f1e23299b54068abce5a1cd852dd057bd6bd` — `fix: stop stale push workers before send`
  - binding a concrete Push subscription to a pending delivery now requires the same active `dispatch_claim_key` that owns the delivery lease.
  - binding returns success/failure instead of blindly updating the row.
  - dispatcher refuses to call the Push service when it lost the delivery claim before binding, preventing a stale/overlapping Worker from sending after ownership moved elsewhere.

### Verification performed this round

Performed:

- re-read the latest `main` handoff and relevant source files before modifying code.
- re-read the current Push/PWA implementation and verified the code path from browser subscription -> API -> delivery claim -> Push wake -> Service Worker presentation.
- inspected the clean current schema and migrations; no retired LINE/AI domain tables were found in the runtime schema.
- confirmed `apps/` contains only `api` and `web`.
- checked the latest commit's GitHub Actions association before this round: no workflow run existed, so no CI result can be claimed.
- current public Taipei sports-center booking site was independently checked as still present/current during this round; direct source smoke execution was not possible from the automation container because its outbound DNS/package environment is not dependency-complete.

Not truthfully executable in this environment:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`

The automation runtime does not contain a checked-out dependency-complete repository/pnpm workspace. Therefore these remain **unverified**, not green. `verify.ps1` and CI both describe the required chain, but a real dependency-complete execution is still required.

## Remaining work — highest priority first

### Deployment / database

- [ ] Point deployment at a fresh Neon database/branch.
- [ ] execute/review migrations `0000`, `0001`, `0002` against that clean database.
- [ ] configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] deploy Worker + Pages and confirm Cron is active.

### Real-device / source smoke verification

- [ ] Chrome/Android: search -> create Radar -> grant Push -> create/observe a real matching availability transition -> receive notification -> deep-link -> official booking.
- [ ] iPhone/iPad installed Web App: add to Home Screen -> grant Push -> receive notification -> deep-link.
- [ ] confirm VAPID rotation behavior on a real browser: old subscription is shown as disabled until the user explicitly re-enables notifications.
- [ ] measure Taipei source latency/error/rate-limit behavior from the deployed Worker before considering one-minute watched polling.
- [ ] verify known non-badminton categories per venue before expanding production launch sports.

### Repository cleanup / verification

- [ ] `pnpm-lock.yaml` still contains an `apps/admin` importer even though the old app directory is gone. Regenerate the lockfile from the current workspace in a dependency-complete environment and commit the clean result; do not hand-edit dependency snapshots blindly.
- [ ] after lock regeneration, change CI installation from `--no-frozen-lockfile` to `--frozen-lockfile` so stale workspace metadata cannot silently return.
- [ ] run the complete `verify.ps1` / CI chain and fix any actual TypeScript/lint/test/build/schema failures.
- [ ] verify no retired LINE/LIFF/Gemini/Energy/Commerce/Reminder/Proactive runtime terminology remains outside historical rebuild documentation.

### Optional post-smoke UX

- [ ] add full Watch-condition editing UI if real users need it; backend PATCH already supports condition updates other than changing sport.
- [ ] improve iOS install guidance if real-device testing shows the current copy is insufficient.
- [ ] consider email fallback only after Push reliability and demand are measured; it is not required for V1 launch.

## Next round — planned

Prioritize **release verification and remaining repository cleanup**, not new feature scope:

1. inspect latest `main` and any new CI/run information.
2. remove remaining stale retired-product references that can be safely removed from source/config/docs without a generated-lockfile guess.
3. if a dependency-complete execution path becomes available, regenerate `pnpm-lock.yaml`, switch CI to frozen lockfile and run the full verification chain.
4. inspect deployment scripts/config for a clean Worker + Pages + fresh-Neon release path and strengthen smoke checks where code can do so without external credentials.
5. only after the core verification/release path is clean should optional Watch editing or extra sports be added.

## Scheduled-round rules

Each rebuild round must read latest `main`, `REBUILD_PLAN.md` and this file first; verify prior work exists; prefer a large coherent batch; delete obsolete code instead of preserving compatibility debt; run only verification that actually exists; and update this file with exact changes, results, remaining work and the next batch before finishing.
