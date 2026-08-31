# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a Taipei sports venue availability search + Radar PWA. V1 is no-AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public **and private official booking sources**, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Public sports-center coverage is baseline. Source-layer V1 is no longer considered complete until at least one private official booking source is actually registered through the same metadata/polling/search/Radar/Push pipeline.

## Actual current `main`

Retired LINE-first runtime is absent. `apps/` contains only `api` and `web`; LINE group/LIFF, Group Memory, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention runtime and legacy schema modules are removed.

Current core flow:

1. `AvailabilitySourceAdapter` isolates provider shapes. `SourceAdapterRegistry` is multi-source; the only live adapter today is `TaipeiSportsCenterAdapter`.
2. `AvailabilitySourceError` is now the common typed provider-error contract. Synchronization/retry code no longer imports Taipei-specific error types, so a private adapter can preserve its own provider error codes without adding source-specific branching to orchestration.
3. `MetadataRefreshingPollingStage` owns registry-driven, per-source metadata cadence/backoff through `source_metadata_runtime`.
4. Provider metadata is staged as a complete non-empty snapshot before normalized venue/sport mutations; one provider metadata failure does not stop other providers or already-normalized availability polling.
5. Polling claims `poll_targets`; `last_polled_at` is the claim fence and `last_success_at` the freshness anchor. Court + slot + event + missing-slot + final target writes are fenced against stale Workers.
6. Search/Radar/Push require exact-target freshness within `max(15 minutes, 3 × target interval)` and Taipei-local actionability.
7. An AVAILABLE slot re-confirmed after a gap longer than freshness allowance emits a new recovery AVAILABLE event.
8. Anonymous browser identities own Radar rules. Watch rules validate current active catalog/geography and canonicalize common `台`/`臺` city spellings.
9. Radar matching uses activation boundaries, current slot/source truth, event supersession and freshness; matching creates durable Web Push deliveries.
10. Pre-dispatch reconciliation and final browser presentation both fail closed on stale truth. The Service Worker no longer shows generic unverified fallback notifications and drains stale presentation candidates within the same wake.
11. Public search exposes only actionable AVAILABLE rows and uses normalized venue `booking_url`; provider machine `external_booking_ref` remains ingestion/provenance only.
12. Web/PWA includes search, Radar CRUD, Push subscription, notification deep-link, `/ready`, deploy and smoke scripts.

Current migration chain:

- `drizzle/0000_aftertrace_rebuild.sql`
- `drizzle/0001_radar_watch_foundation.sql`
- `drizzle/0002_web_push_delivery_runtime.sql`
- `drizzle/0003_source_metadata_runtime.sql`

No schema migration was required this round.

## Completed rebuild areas

### Retired product cleanup

- [x] LINE/group/LIFF runtime removed.
- [x] conversation extraction/Group Memory/Gemini/AI removed.
- [x] Energy/Credit/Rewarded Ad/Commerce/Reminder/Proactive Push removed.
- [x] old admin/auth/retention schema/runtime removed.
- [x] reusable pnpm/Hono/Workers/React/Vite/Neon/Drizzle tooling kept.

### Sports availability + polling

- [x] generic adapter + registry.
- [x] generic `AvailabilitySourceError` provider-failure contract.
- [x] Taipei sports-center adapter.
- [x] normalized source/sport/venue/venue-sport/court/slot/event domain.
- [x] public sports/venue/actionable availability APIs.
- [x] staged periodic metadata refresh + persisted per-source success/backoff.
- [x] registry-driven multi-source metadata cadence + provider-failure isolation.
- [x] 300-second unwatched / 180-second watched demand, source minimum clamp, 14-day watch horizon.
- [x] poll claim fencing through court/slot/event/missing-slot/final settlement.
- [x] shared Taipei date/time actionability.
- [x] prolonged provider-outage freshness fail-closed policy.
- [x] stale-gap AVAILABLE re-confirmation events.
- [ ] one private official booking adapter actually integrated.

### Radar + Web Push

- [x] anonymous identity + watch CRUD/idempotency/user isolation.
- [x] watch active-catalog/geographic validation + city canonicalization.
- [x] create/edit/resume activation boundary.
- [x] superseded/already-started event retirement.
- [x] current AVAILABLE + exact-target freshness matching.
- [x] durable Push delivery/retry/expiry/dispatch lease fencing.
- [x] pre-dispatch stale invalidation + final presentation truth check.
- [x] Worker-native VAPID + Service Worker flow.
- [x] active subscription endpoint required for presentation.
- [x] provider-machine booking refs absent from presentation/public navigation.
- [x] stale presentation candidates drained in one wake.
- [x] Service Worker presentation failures fail closed.
- [ ] overlapping bare-Push wake/delivery correlation review remains.

### Web/PWA

- [x] mobile availability search + official booking handoff.
- [x] anonymous identity bootstrap + Radar management UI.
- [x] manifest + Service Worker + Push subscription/deep link.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [ ] final source-inspection pass of full V1 flow after private source integration.

## Current round — private booking-system research + source contract decoupling

### Starting state verified

At round start latest `main` was `405aaf124df228fcedd78190d006e3e21d3286a6`. `docs/REBUILD_PLAN.md`, this progress file, source adapter types/registry, Taipei adapter, synchronization service/tests and current source composition were re-read before changing code.

Current truth was confirmed: `createDefaultSourceRegistry()` registers only `TaipeiSportsCenterAdapter`; no private adapter exists yet.

A source-layer coupling was also confirmed: `SourceSynchronizationService` imported `TaipeiSportsCenterSourceError` only to preserve provider error codes. That would force every new private adapter either to lose useful error codes or add another concrete-source branch in generic orchestration.

### Code completed this round

- `apps/api/src/sources/types.ts`
  - added generic runtime `AvailabilitySourceError(message, code, status?)`.
- `apps/api/src/sources/taipei-sports-center.ts`
  - `TaipeiSportsCenterSourceError` now extends the common source error while retaining its current adapter-specific class/name and behavior.
- `apps/api/src/sources/sync-service.ts`
  - removed concrete Taipei error import;
  - poll failure classification now accepts any `AvailabilitySourceError`, so future private adapters preserve typed provider failure codes without orchestration branching.
- `docs/REBUILD_PLAN.md`
  - changed source-layer definition-of-done to require public + private official sources;
  - documented private-source eligibility rules and AiNFOLiNK as the current highest-priority system-level candidate;
  - explicitly deferred build/test/release work until feature/source completion.
- `docs/REBUILD_PROGRESS.md`
  - records this research, code batch and next source-integration step.

Commits before this progress update:

- `eeb32df104f53887ca568582bb24070a251c3e2e` — `Generalize availability source errors`
- `91073887f7e311a482e786fae4536a2dfb23608d` — `Use generic source error contract`
- `60969774ad478513999f45a408aa29a2274f1a72` — `Decouple synchronization from Taipei source errors`
- `c195d5f4de987670aa3c2f4d333f573013deba89` — `Prioritize private venue source integration`

### Private source research performed this round

#### 1. AiNFOLiNK — highest-priority system candidate

**Status: strong system-level candidate; official venue relationship confirmed; anonymous availability transport still unresolved.**

- PicklePickle Taipei is a private indoor pickleball venue in Taipei Neihu. Its own official `picklepickle.tw` site has a `Book Court / 訂球場` action that links directly to `https://pickleball.ainfolink.net/`.
- This is important because it establishes AiNFOLiNK as the venue's actual booking operator, not a third-party availability aggregator.
- AiNFOLiNK's own site describes a sports-venue SaaS covering online reservation, booking/order management, payments, memberships and venue automation. It publishes customer testimonials naming `格恩羽球館`, `佛雷斯羽球館` and `動智AI羽球館`, so the platform potentially gives one adapter access to multiple private sports venues rather than one-off scraping.
- The PicklePickle booking SPA itself is publicly reachable without an authentication redirect, but the web crawler returns no rendered body and this execution environment cannot resolve the domain through container DNS. The exact XHR/REST/GraphQL availability transport therefore has **not** been safely identified yet.
- Decision: do not ship a guessed/non-functional AiNFOLiNK adapter. Next round should continue endpoint discovery from the public booking flow; once date/court/slot availability can be anonymously read, implement the real adapter immediately.

#### 2. PicklePickle Taipei

**Status: high-value private venue; use through AiNFOLiNK if anonymous availability is validated.**

- Official site identifies the venue in Taipei Neihu and explicitly describes an automated reservation system.
- Official booking handoff is AiNFOLiNK, making it the best current Taipei test tenant for a system-level adapter.

#### 3. SNOWPICK

**Status: technically promising fallback/proof, but New Taipei rather than Taipei City.**

- Private indoor pickleball venue in Xinzhuang.
- Public site exposes online date/time selection and a current slot matrix without requiring login merely to view availability; booking/payment is a later step.
- It demonstrates that anonymous private availability sources exist, but because the current first-city scope is Taipei and an official AiNFOLiNK Taipei tenant has been found, Snowpick is secondary for now.

#### 4. SP Pickleball Club court finder / Project Smash / similar aggregators

**Status: research aid only, not a source.**

- These sites aggregate other venues' availability and are useful for discovering venue names/operator systems.
- Per product policy, competitor/aggregator data is not used as an upstream availability source unless an official venue relationship is independently established.

#### 5. LINE/phone-only venue flows

**Status: not realtime source candidates.**

- Current searches still surface venues such as Ahhh and several traditional badminton/tennis facilities whose booking path is LINE/phone/manual rather than a publicly readable availability matrix.
- These may later become catalog-only entries, but they cannot power Radar without a reliable public current-truth source.

### Verification policy this round

Per current product priority, full dependency/build/test verification was deliberately not retried. The previous pnpm-registry blocker remains recorded but is not consuming feature-development rounds.

No migration was added. Source-level inspection was performed for the files changed above. Full typecheck/lint/test/build/schema checks remain explicitly **deferred**, not green.

## Remaining work — function/source completion first

1. Continue AiNFOLiNK public booking-flow discovery, preferably from PicklePickle's official tenant. Identify the anonymous date/court/slot availability request shape and determine whether it is stable enough for polling.
2. If validated, implement/register an `AvailabilitySourceAdapter` for AiNFOLiNK (system-level if possible, tenant-specific configuration only where metadata demands it) and send it through metadata sync → poll targets → normalized slots/events → search → Radar → Push.
3. If AiNFOLiNK transport is not anonymously available, continue private booking-SaaS discovery rather than bypassing auth/security. Keep Snowpick as a technically proven fallback outside the initial city boundary.
4. After a private adapter is live, source-inspect the full Web/PWA user flow with mixed public/private results and official booking handoff.
5. Finish the remaining overlapping payload-free Push correlation/concurrency review and other source/Radar correctness gaps found during that pass.
6. Only after feature/source completion switch to concentrated lockfile/typecheck/lint/test/build/schema/migration/deploy/live-smoke work.

## Deferred release verification

- regenerate `pnpm-lock.yaml` so removed `apps/admin` importer disappears through pnpm rather than hand editing;
- frozen-lockfile typecheck/lint/test/build/db:schema:check;
- PowerShell deploy/smoke checks;
- fresh Neon database and migrations `0000` → `0003` (plus any later migration if function work requires one);
- configure Worker `DATABASE_URL` + VAPID values;
- deploy Worker + HTTPS PWA and confirm `/ready`;
- live public + private source polling → transition/outage recovery → Radar → Push → presentation → click;
- rate-limit/latency measurements before one-minute watched polling.

## Next round priority

Keep feature work moving, but make private-source integration the first source task. Start from the now-confirmed official PicklePickle → AiNFOLiNK booking relationship and resolve the anonymous availability transport. If a stable public request is found, implement the private adapter in the same round rather than stopping at research notes. If not, continue researching other multi-venue private booking systems while finishing the remaining Push correlation correctness work; do not return to repeated build/test attempts yet.
