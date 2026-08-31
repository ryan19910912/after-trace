# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a Taipei sports venue availability search + Radar PWA. V1 is no-AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public **and private official booking sources**, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Public sports-center coverage is baseline. Source-layer V1 is not complete until at least one private official booking source is actually registered through the same metadata/polling/search/Radar/Push pipeline.

## Actual current `main`

Retired LINE-first runtime is absent. `apps/` contains only `api` and `web`; LINE group/LIFF, Group Memory, Gemini/AI, Energy/Credit, rewarded ads, commerce, Reminder, Proactive Push, old admin/auth/retention runtime and legacy schema modules are removed.

Current core flow:

1. `AvailabilitySourceAdapter` isolates provider shapes. `SourceAdapterRegistry` is multi-source; the only registered live source today is `TaipeiSportsCenterAdapter`.
2. `AvailabilitySourceError` is the common typed provider-error contract; generic synchronization no longer imports a Taipei-specific error class.
3. Generic slot-sport ingestion now allows badminton, table tennis, squash, tennis, pickleball and basketball, while each adapter may narrow its own safe catalog with `ingestSportCodes`. Taipei public ingestion remains intentionally badminton-only until its venue-specific sport discovery is normalized; a future private pickleball/tennis adapter is no longer blocked by that public-source restriction.
4. `MetadataRefreshingPollingStage` owns registry-driven, per-source metadata cadence/backoff through `source_metadata_runtime`.
5. Provider metadata is staged as a complete non-empty snapshot before normalized mutations; one provider metadata failure does not stop other providers or already-normalized availability polling.
6. Polling claims `poll_targets`; `last_polled_at` is the claim fence and `last_success_at` the freshness anchor. Court + slot + event + missing-slot + final target writes are fenced against stale Workers.
7. Search/Radar/Push require exact-target freshness within `max(15 minutes, 3 × target interval)` and Taipei-local actionability. An AVAILABLE slot re-confirmed after a longer gap emits a recovery AVAILABLE event.
8. Anonymous browser identities own Radar rules. Watch rules validate current active catalog/geography and canonicalize common `台`/`臺` city spellings.
9. Radar matching uses activation boundaries, current slot/source truth, event supersession and freshness; matching creates durable Web Push deliveries.
10. Push dispatch is claim-fenced. Only Push-service acceptance may settle a durable delivery to `SENT`; browser presentation never promotes `PENDING` anymore.
11. Bare Push wakes are treated as fungible presentation capacity for the active endpoint, but `/push/presentation` only claims already-accepted `SENT` deliveries. If a wake races ahead of dispatch settlement while that endpoint still has a live fenced PENDING dispatch, the API returns HTTP 425 and the Service Worker retries briefly. This prevents wake A from falsely settling overlapping delivery B.
12. Pre-dispatch reconciliation and final browser presentation fail closed on stale truth. Stale accepted presentation candidates are drained within the same wake; generic unverified fallback notifications are absent.
13. Public search exposes only actionable AVAILABLE rows and uses normalized venue `booking_url`; provider-machine `external_booking_ref` remains ingestion/provenance only.
14. Web/PWA includes search, Radar CRUD, Push subscription, notification deep-link, `/ready`, deploy and smoke scripts.

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
- [x] reusable pnpm/Hono/Workers/React/Vite/Neon/Drizzle tooling kept.

### Sports availability + polling

- [x] generic adapter + registry.
- [x] generic `AvailabilitySourceError` provider-failure contract.
- [x] source-specific generic sport ingestion policy.
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
- [ ] one private Taipei official booking adapter actually integrated.

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
- [x] overlapping payload-free wake/delivery correlation hardened with accepted-only presentation and bounded settlement retry.

### Web/PWA

- [x] mobile availability search + official booking handoff.
- [x] anonymous identity bootstrap + Radar management UI.
- [x] manifest + Service Worker + Push subscription/deep link.
- [x] `/ready`, `smoke.ps1`, `worker-deploy.ps1`, `pages-deploy.ps1`.
- [ ] final source-inspection pass of the mixed public/private V1 flow after private integration.

## Current round — private-source expansion + accepted-only Push presentation

### Starting state verified

At the beginning of this development round, the previous completed Push batch ended at `405aaf124df228fcedd78190d006e3e21d3286a6`. The latest `main`, `docs/REBUILD_PLAN.md`, this file, source adapter types/registry/synchronization and notification repository/dispatcher/routes/Service Worker were re-read before changes. Repository state was checked again during the round because several source-layer commits were made before the final handoff update.

Initial truth:

- only `TaipeiSportsCenterAdapter` was registered;
- generic synchronization still carried a provider-specific error coupling and a product-wide badminton ingestion assumption that would have blocked a private pickleball/tennis adapter;
- presentation could claim `PENDING + dispatchClaimKey` deliveries and promote them to SENT from the browser, leaving an ambiguous correlation when two payload-free Push sends overlapped for the same endpoint;
- private-source research had confirmed AiNFOLiNK/PicklePickle but had not yet found an anonymous slot transport suitable for a real adapter.

### Code completed this round

#### Source-layer preparation for private adapters

- `apps/api/src/sources/types.ts`
  - added common `AvailabilitySourceError`;
  - added optional `AvailabilitySourceAdapter.ingestSportCodes` so each provider can safely narrow the generic V1 sport allowlist.
- `apps/api/src/sources/taipei-sports-center.ts`
  - `TaipeiSportsCenterSourceError` extends the generic source error;
  - Taipei source explicitly narrows ingestion to badminton while its current sport discovery remains static/provider-wide.
- `apps/api/src/sources/sync-service.ts`
  - removed concrete Taipei error dependency;
  - generic product ingestion now recognizes badminton/table-tennis/squash/tennis/pickleball/basketball;
  - source overrides can narrow that list without allowing unsupported product sports;
  - this removes the previous architectural contradiction where the data model was multi-sport but the synchronization default silently dropped every non-badminton private source.

Relevant commits:

- `eeb32df104f53887ca568582bb24070a251c3e2e` — `Generalize availability source errors`
- `91073887f7e311a482e786fae4536a2dfb23608d` — `Use generic source error contract`
- `60969774ad478513999f45a408aa29a2274f1a72` — `Decouple synchronization from Taipei source errors`
- `ce778541a2dbaec0bd479eb46966dbc21cafe3db` — `Support source-specific sport ingestion`
- `de9d43790fcb329b4ce9b45b4328e713bfcbb85a` — `Keep Taipei ingestion badminton scoped`
- `16af9bc316038c30af6291b6a6c684a0bf9616cd` — `Allow source-specific generic sport ingestion`

#### Push payload-free correlation hardening

- `apps/api/src/notifications/repository.ts`
  - `claimPresentation()` now selects only durable `SENT` deliveries; it cannot consume or promote an in-flight PENDING delivery;
  - presentation claim itself rechecks that the durable delivery is still SENT before setting `presented_at`;
  - added `hasActiveDispatchForEndpoint()` to detect a still-live fenced PENDING send bound to the current active endpoint;
  - updated accepted-settlement semantics/comments so only dispatch settlement owns PENDING → SENT.
- `apps/api/src/notifications/routes.ts`
  - presentation still drains stale already-accepted candidates in the same wake;
  - if none is present but an active dispatch for this endpoint is still settling, returns `425 PUSH_SETTLEMENT_PENDING` instead of guessing which PENDING row caused the wake;
  - if no accepted actionable candidate and no in-flight dispatch exists, returns authoritative `notification: null`.
- `apps/web/public/sw.js`
  - increased the bounded presentation window from three to five attempts;
  - retries only transient `408/425/429/5xx` or network failures;
  - auth/validation/other terminal responses fail closed immediately;
  - generic notification fallback remains removed.

Relevant commits:

- `f3783cd89cce224c7511bda8f8e6878291c50e38` — `Correlate Push presentation with accepted deliveries`
- `0b531df5a617cd512fb34b39cbdc8f0e1c05a286` — `Retry presentation while Push settlement is in flight`
- `466af4f00bc8c35d041a6f9ded39d3565fbbdc17` — `Retry transient Push presentation settlement`

#### Documentation/product contract

- `docs/REBUILD_PLAN.md`
  - now records source-specific generic sport ingestion;
  - promotes BookFast alongside AiNFOLiNK as the highest-priority Taipei private booking-system research targets;
  - records accepted-only Push presentation as the intended concurrency rule and marks the previous correlation issue resolved at source level.

Relevant documentation commits before this handoff update include `c195d5f4de987670aa3c2f4d333f573013deba89`, `191ec056f453c23bd13c8495f7d557a8bd2146e1` and `d9f40be69f440902f35464484ead5ab6c012f721`.

### Private source research performed this round

#### 1. BookFast — promoted to top-tier system candidate

**Status: strong multi-venue SaaS candidate with a current Taipei private sports tenant; exact anonymous current-slot transport still unresolved.**

Evidence established this round:

- BookFast's own public product site describes a sports/fitness venue system with online reservation, venue-rental/場租 management and more than one thousand brands using the platform.
- `https://ec.bookfastpos.com/BJ9EWNbnyX/` is a live public tenant branded **花博匹克庭園**. It exposes `找場地 / 找活動 / 找方案`, and its footer states the site is Powered by BookFast.
- The same tenant is actively indexed with current/future pickleball activities, instructors, dates and times, proving this is a live consumer booking surface rather than a dead marketing page.
- A second private sports tenant, **水獺綠洲匹克球俱樂部**, is publicly hosted under the same `ec.bookfastpos.com/<tenant>` pattern. It is in New Taipei, so it is evidence of system reuse rather than the launch-city source.
- BookFast search indexing exposes a demo venue catalog containing first-class venue resources such as badminton courts and tennis halls. This supports the hypothesis that a single system-level adapter could eventually cover multiple court sports.

Blocker:

- On the current 花博匹克庭園 tenant, `?type=venue` presently renders `目前沒有場地～`; the exact anonymous date/court/current-slot request used by BookFast's venue-rental module was not exposed by the available crawler, and this environment cannot perform browser DevTools/XHR capture against that tenant.
- Scheduled activities are not treated as substitute court availability. No guessed BookFast adapter was registered.

Decision:

- keep BookFast as a highest-priority private system candidate because it has a verified Taipei consumer tenant and broad SaaS reuse;
- next rounds should discover the actual venue-rental transport from a BookFast tenant that publicly exposes rentable courts, then validate whether the same request shape works for a Taipei sports tenant.

#### 2. AiNFOLiNK / PicklePickle Taipei

**Status: still a strong system candidate; public tenant confirmed; exact anonymous current-slot API unresolved.**

- `https://pickleball.ainfolink.net/` is directly indexed as PicklePickle's Taipei professional pickleball booking site and advertises 24-hour reservation access.
- AiNFOLiNK is a sports-venue reservation/operations platform with multiple tenant subdomains, so a system-level adapter remains valuable.
- Available tooling still does not expose the SPA's anonymous XHR/REST/GraphQL current-slot request, and container DNS cannot reach the tenant for raw JS/network inspection.
- No authentication/security bypass was attempted and no guessed adapter was added.

#### 3. SnowPick

**Status: proven anonymous private availability fallback, but New Taipei rather than Taipei City.**

- `snowpick.club/booking` publicly renders a date/time availability matrix without login, including booked/free states and pricing in 30-minute units.
- This is useful proof that private current truth can be anonymously consumed through an official venue flow.
- It does not by itself satisfy the current Taipei-private-source completion criterion; avoid expanding city scope only to make the checkbox green.

#### 4. Research-only sources

- SP Pickleball Club, Project Smash, PickleTown and similar directories remain discovery aids for finding venue names and official booking links only. Their aggregated data is not upstream truth.
- LINE/phone/manual venues remain non-realtime candidates until an official public current-availability surface exists.

### Verification policy this round

Per the current development policy, dependency-complete build/test/release verification was deliberately deferred so source/function work could continue. No pnpm-registry retries, lockfile regeneration, full typecheck/lint/test/build/schema run, PowerShell deployment rehearsal or live Neon/Cloudflare smoke was performed in this round.

No migration was added.

Source inspection was performed on every file changed, but the repository is still **not declared build/test green**. The accepted-only Push changes in particular still need database-backed concurrency/integration tests during the concentrated verification phase.

## Remaining work — function/source completion first

1. **Private source first:** continue BookFast venue-rental transport discovery. Find a public tenant whose `找場地` flow actually exposes rentable resources and inspect the anonymous current-slot request shape; then determine whether that transport can support 花博匹克庭園 or another Taipei private court venue.
2. Continue AiNFOLiNK endpoint discovery in parallel; first stable anonymous Taipei private source wins. Do not wait for one vendor if the other becomes integratable sooner.
3. Once a real transport is validated, implement/register the private `AvailabilitySourceAdapter` immediately and send it through metadata sync → poll target → normalized slot/event → public search → Radar → Push. Do not stop at a research-only adapter shell.
4. After private integration, source-inspect the full mixed-source PWA flow: search → official booking handoff → Radar CRUD → Push enable/disable → current-truth notification → deep-link back to the correct source/venue/date/time.
5. Revisit any source/Radar/Push correctness gaps exposed by real private provider semantics (different slot lengths, prices, resource naming, booking horizons, rate limits).
6. Only after the functional/private-source work is complete switch to the concentrated verification/release phase.

## Deferred release verification

- regenerate `pnpm-lock.yaml` so removed `apps/admin` importer disappears through pnpm rather than hand editing;
- frozen-lockfile typecheck/lint/test/build/db:schema:check;
- database-backed notification concurrency checks for accepted-only presentation + 425 settlement races;
- PowerShell deploy/smoke checks;
- fresh Neon database and migrations `0000` → `0003` (plus any later migration if function work requires one);
- configure Worker `DATABASE_URL` + VAPID values;
- deploy Worker + HTTPS PWA and confirm `/ready`;
- live public + private source polling → transition/outage recovery → Radar → Push → presentation → click;
- rate-limit/latency measurements before one-minute watched polling.

## Next round priority

Do not return to build/test work yet. Start with **BookFast rentable-venue endpoint discovery**, using its system-level venue-rental capability and current Taipei tenant as the lead. Keep AiNFOLiNK discovery running in parallel. As soon as either exposes a stable anonymous current-slot transport, implement the actual private adapter in that same round. The source layer remains the main unfinished V1 feature; the previous bare-Push correlation concern is now source-level hardened and no longer the first feature priority.
