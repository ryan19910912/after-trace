# AFTERTRACE Rebuild Progress

This file is the durable handoff between rebuild rounds. Every manual or scheduled round must read both this file and `docs/REBUILD_PLAN.md` before changing code, verify the actual latest `main`, and update this file before finishing.

## Current product target

Public sports venue availability search + radar.

V1 principles:

- Web/PWA first.
- Cloudflare Worker + Hono backend.
- Neon PostgreSQL + Drizzle.
- No AI requirement.
- Do not book/pay for users; direct them to official booking channels.
- Public-source polling + normalized availability + conditional notifications are the product core.
- Badminton is the first launch sport, while the domain model remains generic for other slot-based sports.

## Actual current repository state

The retired LINE/AI product runtime is gone. Current `main` is now a sports-availability + Radar backend foundation:

- `apps/api/src/index.ts` exposes health/search APIs, anonymous Radar identity, watch CRUD and a Cloudflare `scheduled` handler.
- `apps/api/src/db/schema.ts` contains only sports-radar domain tables; Radar matching state and idempotent watch creation fields are present.
- all old `schema-round*`, LINE/AI/Energy/commerce/reminder/proactive modules and old admin runtime are gone.
- `drizzle/0000_aftertrace_rebuild.sql` remains the clean sports-radar baseline; `0001_radar_watch_foundation.sql` adds current Radar ownership/matching state.
- `apps/web` is still the mobile-first availability search shell; watch/PWA Push UI is not implemented yet.
- Taipei source synchronization launches badminton-first while retaining generic mappings/model support for later sports.
- poll targets are race-safely claimed; watch-covered targets are elevated to priority 100 / requested 180-second polling while unwatched targets remain at 300 seconds, with source minimum interval always enforced.
- newly `AVAILABLE` events are matched exactly once (retry-safe) into idempotent `PENDING` Web Push delivery intents; actual Web Push transport is not implemented yet.

## Round 1 — retired runtime/database/web pivot

Commit previously inspected: `fbc18bf46d7ea0905e442dd1c1dabe99eb8090ce` (`refactor: replace legacy LINE AI runtime with availability core`).

Completed:

- retired LINE/group-memory/AI/Energy/commerce/reminder/proactive runtime removal.
- clean sports-radar schema/baseline creation.
- normalized sports/venues/availability read API.
- mobile-first availability search shell + official booking links.
- environment cleanup.

## Round 2 — Taipei source adapter + synchronization core

Completed:

- `AvailabilitySourceAdapter` boundary and default source registry.
- Taipei sports-center adapter with 11 independently verified booking-system venue IDs; Nangang LID is not guessed.
- known category mapping kept provider-neutral; production launch targets are badminton-only until other live venue/category behavior is verified.
- form-encoded public-source calls, non-JSON rejection and bounded retry handling for network/302/429/5xx behavior.
- calendar-first polling, court/slot normalization, deterministic external slot identity and official booking reference.
- metadata/slot upserts, stale-slot `UNKNOWN` reconciliation and meaningful availability event creation.
- source health / bounded failure backoff.
- synthetic adapter + synchronization tests.

## Round 3 — race-safe Cloudflare polling orchestration

Completed:

- due-target selection by priority / `next_poll_at` / id.
- bounded race-safe claiming; `next_poll_at` acts as crash-recovery lease and `last_polled_at` is the settlement fence.
- one-minute Cloudflare Cron wake-up, while individual targets retain their own intervals.
- default batch size 3, hard max 6, five-minute recovery lease.
- Taipei-local 14-day polling window.
- per-target failure isolation.
- scheduler/bootstrap tests and Worker multi-handler export.

Verification status from prior round:

- Cloudflare scheduled-handler / Hono multi-handler contracts were checked against current official docs.
- no dependency-complete local environment existed; full pnpm verification remained unexecuted.
- connector-created commits did not produce GitHub Actions workflow runs.

## Round 4 — anonymous Radar ownership, watch CRUD, matcher and watch-driven polling

### Starting state verified

Before changes, latest `main` was `0f0d8a2222075b8f00f48df5aed8e7c6f055176f` (`docs: record polling orchestration round`). The rebuild plan/progress, current schema, API entry point, availability routes/repository, polling orchestrator, migration baseline and source synchronization repository were re-read. The next planned coherent batch was Radar ownership/watch/matching.

### Code committed

Primary implementation commit:

- `4b5e0098ad02d5e143b283a3317f1c2ac5fa9bb6` — `feat: add anonymous radar watches and matching`

Added `apps/api/src/auth/anonymous.ts`:

- high-entropy 256-bit anonymous browser token (`atr_anon_v1_...`).
- SHA-256 token subject stored in `users`; raw token is never persisted.
- token resolution uses provider `ANONYMOUS` + hashed subject.
- bearer parsing helper.

Added `apps/api/src/auth/routes.ts`:

- `POST /api/v1/session/anonymous`.
- no existing bearer -> issue identity.
- valid bearer -> reuse the same identity/token.
- invalid supplied bearer -> 401 instead of silently replacing identity.

Added `apps/api/src/watch/rules.ts`:

- create/update validation for sport, venue IDs, city/district, date range, day-of-week and time window.
- normalized sport code, deduplicated/sorted venue/day lists and `HH:mm` -> `HH:mm:ss` normalization.
- inverted date/time window rejection.
- strict `Idempotency-Key` validation.
- canonical SHA-256 create-payload fingerprint.
- reusable pure watch/event matcher.

Added `apps/api/src/watch/repository.ts`:

- owner-isolated list/create/update/delete repository.
- sport/venue compatibility checks before persistence.
- creation uses `(user_id, client_key)` idempotency plus stored payload fingerprint; reusing a key for a different payload returns `IDEMPOTENCY_KEY_REUSE` instead of mutating/reduplicating data.
- watch venue replacement is performed inside one PostgreSQL data-modifying CTE statement together with rule update.
- watch create/read/update/delete never queries another user's rule without `user_id` ownership scope.
- enabled watch coverage recalculates matching `poll_targets` to priority `100` and 180-second requested interval; unmatched targets return to priority `0` / 300 seconds; interval is clamped against each source's minimum interval.
- watch-driven refresh deliberately does not rewrite `next_poll_at`, so it cannot break an active poll claim/recovery lease.

Added `apps/api/src/watch/routes.ts`:

- bearer-authenticated `GET /api/v1/watch-rules`.
- idempotent `POST /api/v1/watch-rules` (requires `Idempotency-Key`).
- owner-isolated `PATCH /api/v1/watch-rules/:watchRuleId`.
- owner-isolated `DELETE /api/v1/watch-rules/:watchRuleId`.
- database/identity middleware remains generic and does not restore LINE auth.

Added `apps/api/src/watch/matcher.ts`:

- bounded scan of newly `AVAILABLE` and unmatched `availability_events`.
- only watches created on/before the event's `occurred_at` can match, preventing a newly-created watch from receiving old pre-watch availability.
- sport, city/district, optional venue set, date range, day-of-week and time-window matching.
- creates deterministic `watch:{rule}:event:{event}:web-push` delivery keys.
- `notification_deliveries` remains `PENDING` and `subscription_id = null` until actual Push transport is implemented.
- unique delivery key makes concurrent/retried matcher execution idempotent.
- event is marked `matched_at` only after candidate processing; a mid-event failure leaves it retryable.

Updated `apps/api/src/index.ts`:

- explicit CORS allowance for `Authorization` and `Idempotency-Key`.
- mounts anonymous session and watch routes.
- scheduled polling now runs the Radar matcher after source polling and logs the Radar summary.

Updated `apps/api/src/db/schema.ts`:

- `availability_events.matched_at` + matching queue index.
- `watch_rules.client_key` + `client_payload_hash`.
- per-user unique watch creation key.

Added migration:

- `drizzle/0001_radar_watch_foundation.sql`.
- adds matching cursor and idempotency columns/indexes.
- includes deterministic backfill for any existing test watch rows before applying `NOT NULL`.
- `drizzle/meta/_journal.json` now records the second migration.

Tests added:

- `apps/api/src/auth/anonymous.test.ts` — bearer parsing behavior.
- `apps/api/src/watch/rules.test.ts` — input normalization, invalid windows, idempotency-key validation and combined match semantics.

### Behavioral decisions

- V1 identity is intentionally browser-anonymous and low-friction; no LINE/LIFF dependency was reintroduced.
- anonymous token is a credential and must later be stored by the Web/PWA outside URLs/logs.
- day-of-week uses JavaScript/PostgreSQL-compatible `0 = Sunday ... 6 = Saturday` semantics.
- watch sport is immutable through PATCH in this first API; users can delete/recreate a watch when switching sport. This keeps venue/sport validation deterministic and the create idempotency identity stable.
- watch-matched delivery rows are intents only. The next phase must register actual Push subscriptions and bind/send safely rather than pretending Push is complete.
- one-minute target polling remains disabled. Watched targets use three minutes until live source behavior is measured.

### Verification performed this round

- Re-read latest `main` and all planned handoff files before coding.
- Re-read changed files from `main` after commit and inspected the generated commit diff.
- Confirmed the commit is now the `main` runtime implementation and the new `auth/` + `watch/` directories exist.
- Confirmed the new migration file and journal entry exist.
- Queried GitHub Actions for implementation commit `4b5e0098ad02d5e143b283a3317f1c2ac5fa9bb6`: no workflow runs were produced, so CI does **not** validate this round.
- The automation container has Node 22 and global TypeScript but no pnpm/repository dependencies. Network package lookup timed out, so a dependency-complete `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm db:schema:check` could not truthfully be executed. Do not mark them green.
- Current Drizzle/Neon official docs were checked while designing writes: Neon HTTP is appropriate for single/non-interactive transactions; interactive transaction assumptions were deliberately avoided in the watch implementation.

## Remaining work — highest priority first

### Phase 2 deployment blocker

- [ ] Point deployment at a fresh Neon database/branch and execute/review `0000_aftertrace_rebuild.sql` + `0001_radar_watch_foundation.sql` there.

### Phase 4 — Radar delivery

- [x] Race-safe bounded poll-target claiming/recovery.
- [x] Due-target Cloudflare scheduled orchestration.
- [x] Anonymous/browser ownership boundary.
- [x] Owner-isolated watch CRUD + idempotent create.
- [x] New-AVAILABLE watch matching + idempotent delivery intents.
- [x] Watch-driven priority / three-minute interval bounded by source minimum.
- [ ] Web Push subscription registration/deactivation.
- [ ] Bind/send pending delivery intents to active subscriptions with retry/expiry behavior.
- [ ] Notification open/click acknowledgement only if it materially helps product behavior/analytics.
- [ ] Measure live source behavior before considering one-minute watched polling.

### Phase 5 — web/PWA completion

- [ ] Bootstrap/store anonymous Radar token in Web UI.
- [ ] Add create/list/toggle/edit/delete watch UI.
- [ ] Add PWA manifest/service worker.
- [ ] Add Web Push permission + subscription flow.
- [ ] Deep-link notifications to the relevant availability/official-booking context.

### Phase 6 — final cleanup/verification

- [ ] Remove any remaining stale lockfile/importer/deployment-script references after feature work stabilizes.
- [ ] Run full typecheck/lint/test/build/schema validation in a dependency-complete environment.
- [ ] Verify no retired LINE/AI/Energy runtime terminology remains outside rebuild-history documentation.
- [ ] Live-smoke the Taipei adapter from the deployed Worker and record measured source rate-limit behavior.

## Next round — planned

Implement actual Web Push + Web/PWA Radar UX as the next coherent batch:

1. add authenticated Web Push subscription upsert/deactivate APIs under the anonymous identity boundary; validate endpoint + `p256dh` + `auth` shape and never log subscription secrets.
2. choose an edge-compatible Web Push signing/sending approach for Cloudflare Workers (VAPID keys from Worker secrets; no Node-only runtime dependency).
3. change pending delivery intents into concrete per-subscription deliveries or add a clear binding stage; add retry/terminal handling and avoid sending stale events after a bounded age.
4. add the PWA manifest + service worker notification handlers.
5. bootstrap/reuse `/session/anonymous` in the React app, store the credential locally, and add watch create/list/toggle/delete UI based on the existing search filters.
6. add Push permission/subscription UI and notification click deep link to availability / official booking.
7. add tests for subscription validation, delivery idempotency/retry and Web watch state helpers.
8. update this file and the rebuild plan again before finishing.

## Scheduled-round rules

Each rebuild round must read latest `main`, `REBUILD_PLAN.md` and this file first; verify prior work exists; prefer a large coherent batch; delete obsolete code instead of preserving compatibility debt; run only verification that actually exists; and update this file with exact changes, results, remaining work and the next batch before finishing.
