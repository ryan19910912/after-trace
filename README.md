# AFTERTRACE

AFTERTRACE is a Web/PWA-first sports venue availability search and radar product.

The retired LINE/AI memory-assistant prototype has been removed from the runtime. V1 does not use AI and does not book, pay, or store venue credentials on a user's behalf. It normalizes public venue availability, lets users search across supported venues, lets a browser create private Radar watch rules, and sends Web Push when a matching slot becomes newly available before directing the user to the official booking channel.

## V1 stack

- TypeScript + pnpm monorepo
- Hono on Cloudflare Workers
- React + Vite on Cloudflare Pages
- PostgreSQL on Neon + Drizzle ORM
- Public source adapters for venue/slot availability
- Cloudflare Cron polling with bounded target claiming
- Server-issued anonymous browser identity for Radar ownership
- Standards-based Web Push using VAPID + Service Worker/PWA

## Workspace

```text
apps/
  api/       public availability API + Radar/Push API + source sync + polling scheduler
  web/       mobile-first search/Radar PWA
packages/
  shared/    shared availability domain types
docs/
  REBUILD_PLAN.md
  REBUILD_PROGRESS.md
drizzle/     clean sports-availability schema + incremental rebuild migrations
```

## Local setup

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:schema:check
```

`DATABASE_URL` must point at the new sports-availability database. The clean rebuild baseline intentionally refuses to run against a detected legacy LINE/AI schema; create a fresh Neon database/branch instead of carrying retired product tables forward.

Current migrations:

- `0000_aftertrace_rebuild.sql` — clean sports-radar baseline.
- `0001_radar_watch_foundation.sql` — anonymous Radar ownership/matching state.
- `0002_web_push_delivery_runtime.sql` — Push retry lease, expiry and presentation state.
- `0003_source_metadata_runtime.sql` — provider metadata refresh success/backoff state.

## Web Push configuration

Generate one P-256 VAPID key pair:

```bash
pnpm --filter @aftertrace/api webpush:keys
```

Configure the Worker with:

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY` — secret; never expose it to the web build.
- `WEB_PUSH_VAPID_SUBJECT` — operator contact URI such as `mailto:ops@example.com` or an HTTPS URL.

The public key is exposed through `GET /api/v1/push/config` so the browser can create a `PushSubscription`. The private key remains Worker-only.

V1 sends an authenticated **payload-free** Web Push signal. When the Service Worker wakes, it uses the browser's anonymous Radar credential plus its current Push endpoint to atomically claim one already-accepted notification presentation from AFTERTRACE, then shows the venue/time context locally. This keeps notification context user-isolated without adding Web Push payload-encryption code or placing the anonymous credential in the push payload/URL.

## Health and release readiness

The Worker exposes separate liveness and readiness endpoints:

- `GET /health` confirms that the Worker runtime can answer requests. It does not claim that external dependencies are ready.
- `GET /ready` probes the migrated sports schema and validates the complete VAPID configuration. It returns HTTP `200` only when both database and Web Push checks are ready; otherwise it returns `503` with non-secret error codes.

A deployed smoke script verifies Worker liveness/readiness, public Push configuration, sports/venue/availability API shape and optionally the Pages site:

```powershell
./smoke.ps1
```

After the first source synchronization has produced normalized sports data, use the stricter source-data check:

```powershell
./smoke.ps1 -RequireSourceData
```

`worker-deploy.ps1` now runs the Worker smoke automatically after migration + deployment. `pages-deploy.ps1` builds the PWA against the selected Worker URL and runs the combined Worker + Pages smoke after deployment. Both scripts accept URL parameters so release verification does not depend on hard-coded endpoints when environments change.

## Current API surface

Public search/status:

- `GET /health`
- `GET /ready`
- `GET /api/v1/sports`
- `GET /api/v1/venues?sport=...`
- `GET /api/v1/availability?sport=...&venueId=...&district=...&date=...&start=...&end=...`

Radar ownership and watches:

- `POST /api/v1/session/anonymous` — issues a high-entropy browser token; the database stores only its SHA-256 identity subject.
- `GET /api/v1/watch-rules`
- `POST /api/v1/watch-rules` — requires `Authorization: Bearer <token>` and an `Idempotency-Key` header.
- `PATCH /api/v1/watch-rules/:watchRuleId`
- `DELETE /api/v1/watch-rules/:watchRuleId`

Web Push:

- `GET /api/v1/push/config` — public VAPID application-server key only.
- `POST /api/v1/push/subscription` — register/reactivate this browser's Push subscription.
- `DELETE /api/v1/push/subscription` — deactivate this browser's Push endpoint.
- `POST /api/v1/push/presentation` — authenticated Service Worker claim for one accepted notification.
- `POST /api/v1/push/deliveries/:deliveryId/opened` — owner-isolated click acknowledgement.

Private Radar/Push endpoints use the anonymous browser bearer token. The raw token is not stored server-side and must never be put in URLs or logs.

## Radar behavior

Watch conditions support sport, venue IDs, city/district, date range, day-of-week (`0` Sunday through `6` Saturday) and time window. The API validates that the requested area currently has an active source/venue/sport mapping; explicitly selected venue IDs must support the sport and must remain inside the declared city/district. Common top-level Taiwan `台` spellings such as `台北市` are canonicalized to the normalized `臺` form before storage/idempotency fingerprinting.

The Worker Cron wakes every minute, but poll targets are individually scheduled and claimed in bounded batches. Unwatched targets default to five-minute polling; targets covered by an enabled watch are raised to higher scheduler priority and a three-minute interval, still clamped by each source's minimum interval. One-minute per-target polling remains disabled until live source behavior is measured.

Current availability is also freshness-gated. Search, Radar matching, Push dispatch reconciliation and the final Service Worker presentation check require the exact source/venue/sport target to have completed a successful poll within at least the last 15 minutes, or within three configured poll intervals when that is longer. Short provider/network incidents therefore do not immediately blank the product, while prolonged outages fail closed instead of leaving old `AVAILABLE` rows visible or notifying from stale truth.

A newly `AVAILABLE` event is matched once against watches. A matching watch/event pair creates an idempotent delivery. Push dispatch uses a recovery lease, bounded retries and a 30-minute delivery freshness window; expired work becomes terminal instead of notifying about stale availability. A 404/410 Push response deactivates the dead subscription instead of repeatedly retrying it.

Launch synchronization is badminton-first; additional sports stay behind the generic source/domain model until live per-venue coverage is verified.

## PWA behavior

The React app now:

- bootstraps/reuses the anonymous Radar identity in the browser;
- searches normalized availability and opens official booking links;
- creates Radar watches from the current search filters;
- lists, pauses/resumes and deletes watches;
- installs a manifest + Service Worker;
- lets supported browsers opt into/out of Web Push;
- deep-links a notification back to the matching sport/venue/date/time search.

On iPhone/iPad, Web Push availability follows the platform's installed web-app requirements, so users may need to add the site to the Home Screen before notification permission can be enabled.

See `docs/REBUILD_PROGRESS.md` for exact implementation/verification status and remaining deployment work.
