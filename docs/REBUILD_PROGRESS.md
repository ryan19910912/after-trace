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

The retired LINE-first AI memory product has been removed from the runtime. `apps/` contains only `api` and `web`; the old admin application is gone.

Current code-level product path:

1. `TaipeiSportsCenterAdapter` reads public venue/calendar/availability endpoints.
2. source synchronization normalizes venue/sport/court/slot state into Neon/Drizzle models.
3. Cloudflare scheduled work claims bounded due poll targets and records availability transitions.
4. anonymous browser identity owns private Radar watch rules.
5. newly `AVAILABLE` events are matched idempotently to enabled watches.
6. matching events create Web Push delivery intents with bounded freshness, lease/retry and dead-subscription handling.
7. VAPID-authenticated payload-free Web Push wakes the PWA Service Worker.
8. the Service Worker claims one owner-isolated accepted presentation, displays venue/date/time context, and deep-links back to matching search/official booking.
9. the React PWA can search availability, create/list/pause/resume/delete Radar rules, enable/disable Push, and recover anonymous Radar identity.
10. `/health` is liveness only; `/ready` verifies the migrated sports schema is queryable and that full VAPID configuration is valid before reporting production readiness.
11. `smoke.ps1` verifies deployed Worker liveness/readiness, public Push config and search API shape, with optional Pages and post-sync source-data checks.
12. CI now installs with `pnpm install --frozen-lockfile` so verification cannot silently rewrite dependency state.

Current migrations:

- `drizzle/0000_aftertrace_rebuild.sql` — clean sports-radar baseline; refuses a detected legacy LINE/AI database instead of carrying old tables forward.
- `drizzle/0001_radar_watch_foundation.sql` — anonymous Radar ownership, matching cursor and watch idempotency state.
- `drizzle/0002_web_push_delivery_runtime.sql` — Push lease/retry/expiry/presentation runtime.

Current polling policy:

- Worker Cron wakes every minute.
- unwatched poll targets request 300-second polling.
- watch-covered targets are priority 100 and request 180-second polling.
- every target is clamped by its source minimum interval.
- one-minute per-target polling stays disabled until deployed source behavior/rate limits are measured.

## Completed rebuild batches

### Retired product removal + clean sports domain

- removed LINE webhook/group conversation, Group Memory, Gemini/AI, Energy, Rewarded Ad, Commerce, Reminder, Proactive Push and old admin runtime.
- replaced legacy schema with clean sports availability/Radar tables.
- preserved pnpm monorepo, Cloudflare Worker/Hono, React/Vite, Neon/Drizzle and common verification tooling.
- built public sports/venue/availability read APIs and mobile-first search UI.

### Taipei source adapter + normalization

- generic `AvailabilitySourceAdapter` boundary and registry.
- Taipei sports-center adapter using form-encoded public booking endpoints.
- venue/sport/court/slot normalization, deterministic external slot identity, official booking references and stale-slot reconciliation.
- bounded retry/error classification and source health behavior.
- launch synchronization is badminton-first; other sports remain behind the generic domain until live coverage is verified.

### Race-safe polling orchestration

- priority/`next_poll_at` due-target selection.
- bounded claiming with crash-recovery lease and settlement fence.
- one-minute Cron wake-up with independent target intervals.
- Taipei-local 14-day polling window and per-target failure isolation.

### Anonymous Radar ownership + watch matching

- 256-bit anonymous browser credential; DB stores only SHA-256 identity subject.
- bearer-authenticated watch CRUD with user isolation.
- idempotent create via `Idempotency-Key` + canonical payload fingerprint.
- sport/venue/city/district/date/day-of-week/time matching.
- newly-available event cursor and idempotent watch/event delivery keys.
- old availability that predates a watch is not retroactively notified.
- overlapping rules for the same user/event are deduplicated.
- enabled watch coverage raises relevant poll-target priority/frequency without rewriting active poll leases.

### Web Push + PWA Radar UX

- authenticated Push subscription upsert/deactivation endpoints.
- public VAPID application-server-key endpoint; private key remains Worker-only.
- edge-native P-256 VAPID signing/sending with no Node-only Push dependency.
- delivery runtime with claim lease, bounded retry, 30-minute freshness cutoff, 404/410 dead-subscription retirement and click/open acknowledgement.
- payload-free Push presentation: Service Worker wakes, proves anonymous identity + current endpoint, atomically claims accepted notification context, then renders locally.
- manifest, Service Worker, notification click handling and deep-link search parameters.
- React UI for anonymous identity, Watch creation/list/pause/resume/delete and notification enable/disable.
- startup Push subscription reconciliation and safe VAPID rotation behavior.
- delivery claim fencing prevents stale overlapping Workers from sending after ownership moves.

## Current round — release readiness + deploy smoke hardening

### Starting state verified

Latest `main` at round start was `016a98e3271f2daed37639f30470526608a80043` (`docs: record push hardening verification limits`). Before changing code this round, the latest rebuild plan/progress, complete repository tree, current API entrypoint/env/schema, VAPID dispatcher/config, CI, lockfile header/importers, Worker/Pages deploy scripts and local verification script were re-read.

The recursive `main` tree confirms there are no retired LINE/Gemini/admin runtime paths. One known retired-workspace artifact still exists inside `pnpm-lock.yaml`: the stale `apps/admin` importer.

### Code completed this round

Production readiness contract:

- `4dc9cc461b4f215252efc90c8623f95b474e2432` — added `apps/api/src/readiness.ts`.
  - database is `missing` when `DATABASE_URL` is blank.
  - database probe failures become the non-secret `DATABASE_PROBE_FAILED` code.
  - Web Push is `missing` unless all VAPID values exist, and `invalid` when VAPID validation fails.
  - readiness is true only when both database and Web Push checks are `ok`.
- `bdf89374c7fd395845e133b59be1c174b35022b4` — added readiness unit coverage for missing DB, missing VAPID, invalid VAPID, DB probe failure and fully-ready state.
- `c2986847a24046a626b452b46c7fe7a9014e5659` — added `GET /ready`.
  - it performs a real query against the normalized `sports` table, so a reachable but unmigrated/wrong database is not reported as ready.
  - it returns HTTP 200 only for `ready`; otherwise HTTP 503.
  - `/health` remains cheap liveness and no longer has to be misinterpreted as dependency readiness.

Deployed smoke/release scripts:

- `45b530189a24720e4a01061daf50c6db96cbddd3` — added root `smoke.ps1`.
  - verifies `/health`, `/ready`, public Push config, sports API, and when synchronized data exists also venue + availability API shape.
  - optional Pages HTTP check.
  - `-RequireSourceData` turns an empty fresh database into a smoke failure after polling is expected to have synchronized data.
  - Worker/Pages URLs are parameters so the same script can verify another environment.
- `10948557d9d8703ded7abb2ea49a1947d48a98f0` — Worker deploy now runs deployed readiness/API smoke after migration + Wrangler deploy and accepts `-WorkerUrl`.
- `1e35a8aff79dc1f2e33bb6d609dbfaaf3c47c8e7` — Pages deploy now accepts Worker/Pages/project parameters, builds against the selected Worker URL, and runs combined Worker + Pages smoke after deployment.
- `b9659e75c8b3e34efaafc5a672bda1cad1cff433` — README documents liveness vs readiness, `/ready`, smoke usage and deploy behavior.

CI hardening:

- `d3fef5266c4da3982e1b8ce48acdcff51e7c243c` — `.github/workflows/ci.yml` now uses `pnpm install --frozen-lockfile` instead of `--no-frozen-lockfile`; CI can no longer hide manifest/lock drift by rewriting the lockfile during verification.
- the stale `apps/admin` importer is still present and is intentionally not hand-pruned from generated lockfile dependency snapshots without a real pnpm regeneration. It remains a cleanup blocker rather than being disguised as resolved.

### Verification performed this round

Performed:

- verified latest `main` commit history and recursive repository tree before editing.
- confirmed current runtime paths contain only sports availability/Radar/API/PWA code; no retired LINE/Gemini/admin path exists in the repository tree.
- inspected the full `pnpm-lock.yaml` blob and confirmed the stale `apps/admin` importer still exists while current `apps/api`, `apps/web` and `packages/shared` importers are present.
- attempted `corepack pnpm --version` again in the automation container. It still fails because DNS lookup for `registry.npmjs.org` returns `EAI_AGAIN`, so dependency-complete workspace verification and lockfile regeneration are still unavailable here.
- independently strict-compiled the new pure readiness contract with TypeScript 5.8.3 using local stubs for its imported contracts; no diagnostics were produced. This is syntax/type evidence for `readiness.ts`, not a substitute for the repository's TypeScript 5.9 workspace.
- re-read the updated deploy script source after writing it.
- queried GitHub Actions for `b9659e75c8b3e34efaafc5a672bda1cad1cff433` and later CI commit `d3fef5266c4da3982e1b8ce48acdcff51e7c243c`; both returned zero workflow runs, so GitHub Actions does not validate this round.

Not truthfully executable in this environment:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm db:schema:check`
- PowerShell execution of `smoke.ps1` / deploy scripts (`pwsh` is not installed in the automation container).

Therefore the full chain remains **unverified**, not green.

## Remaining work — highest priority first

### Repository cleanup / verification

- [ ] `pnpm-lock.yaml` still contains a stale `apps/admin` importer although the directory no longer exists. Regenerate the lockfile from the current workspace in a dependency-complete environment; do not fabricate package snapshots.
- [x] CI installation is frozen and will no longer rewrite the lockfile during verification.
- [ ] run the complete `verify.ps1` / CI chain and fix any real TypeScript/lint/test/build/schema failure.
- [ ] run PowerShell syntax/execution checks for `smoke.ps1`, `worker-deploy.ps1`, and `pages-deploy.ps1` on the normal Windows development machine.
- [ ] verify no retired LINE/LIFF/Gemini/Energy/Commerce/Reminder/Proactive terminology remains outside explicit rebuild-history documentation. The current repository-tree path scan is clean, but content-level search must be repeated when code search/index or a local checkout is available.

### Deployment / database

- [ ] point production/development deployment at a fresh Neon database/branch.
- [ ] execute/review migrations `0000`, `0001`, `0002` against that clean database.
- [ ] configure Worker `DATABASE_URL` and VAPID public/private/subject values.
- [ ] deploy Worker and confirm `GET /ready` returns HTTP 200.
- [ ] deploy Pages and run `./smoke.ps1`; after first Cron synchronization run `./smoke.ps1 -RequireSourceData`.
- [ ] confirm Cloudflare Cron is active.

### Real-device / source smoke verification

- [ ] Chrome/Android: search -> create Radar -> grant Push -> observe a real matching availability transition -> notification -> deep-link -> official booking.
- [ ] iPhone/iPad installed Web App: add to Home Screen -> grant Push -> notification -> deep-link.
- [ ] confirm VAPID rotation behavior on a real browser: old subscription remains disabled until explicit re-enable.
- [ ] measure Taipei source latency/error/rate-limit behavior from the deployed Worker before considering one-minute watched polling.
- [ ] verify known non-badminton categories per venue before expanding launch sports.

### Optional post-smoke UX

- [ ] full Watch-condition editing UI if real users need it; backend PATCH already supports condition updates other than changing sport.
- [ ] improve iOS install guidance if device testing shows current copy is insufficient.
- [ ] consider email fallback only after Push reliability/demand are measured; it is not required for V1 launch.

## Next round — planned

Prioritize verification/cleanup, not feature scope:

1. re-read latest `main`, rebuild plan/progress and CI state.
2. retry dependency-complete pnpm availability. If available, regenerate the lockfile to remove `apps/admin`, then run the full frozen-lockfile verification chain.
3. if pnpm remains externally blocked, perform source-level correctness review of release/readiness/polling/Push paths and address concrete issues without guessing generated artifacts.
4. if deployment credentials/configuration have become available through the repository environment, apply the clean migrations, deploy and use `/ready` + `smoke.ps1`; otherwise leave deployment as an explicit external blocker.
5. do not enable one-minute watched polling or extra launch sports until deployed measurements exist.

## Scheduled-round rules

Each rebuild round must read latest `main`, `REBUILD_PLAN.md` and this file first; verify prior work exists; prefer a large coherent batch; delete obsolete code instead of preserving compatibility debt; run only verification that actually exists; and update this file with exact changes, results, remaining work and the next batch before finishing.
