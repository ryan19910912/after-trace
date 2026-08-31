# AFTERTRACE Rebuild Progress

This is the durable handoff between rebuild rounds. Every round must read this file, `docs/REBUILD_PLAN.md`, and actual latest `main`; repository state wins over older notes.

## Current product target

AFTERTRACE is a sports venue availability search + Radar PWA. V1 has no AI, never books/pays for users and never stores venue credentials. It normalizes current availability from public and private official booking sources, searches across them, continuously monitors matching conditions and sends Web Push only after current truth is revalidated.

Taipei City is the primary launch market. Private official booking coverage is a core V1 requirement; adjacent New Taipei coverage is acceptable when it validates a reusable booking-system source and improves real coverage.

## Current architecture

- Retired LINE/LIFF/Group Memory/Gemini/Energy/Commerce/Reminder/Proactive runtime is removed.
- `AvailabilitySourceAdapter` registry is multi-source; registered adapters are `TaipeiSportsCenterAdapter` and `TinyBookAdapter`.
- Generic normalized domain supports badminton/table-tennis/squash/tennis/pickleball/basketball.
- Metadata refresh is registry-driven and source-isolated.
- Polling uses claim fencing plus exact-target freshness; stale provider truth fails closed.
- Search is city/district/venue aware and exposes source identity + latest successful target poll time.
- Radar rules are anonymous-browser owned and support geographic, date range, day-of-week and time constraints.
- Push only presents accepted `SENT` deliveries after current truth is revalidated.
- PWA provides mixed-source search, official handoff, Radar management and Web Push.

Migration chain remains `0000` → `0003`; no migration was required this round.

## Completed rebuild areas

### Retired product cleanup
- [x] LINE/group/LIFF runtime removed.
- [x] Group Memory/Gemini/AI removed.
- [x] Energy/Credit/Ads/Commerce/Reminder/Proactive removed.
- [x] old admin/auth/retention schema/runtime removed.

### Availability / polling
- [x] generic adapter + registry + provider-error contract.
- [x] Taipei sports-center public adapter.
- [x] TinyBook private booking-system adapter.
- [x] normalized source/sport/venue/court/slot/event pipeline.
- [x] source-isolated metadata refresh.
- [x] polling demand/interval clamp/claim fencing/freshness/recovery.
- [x] city-aware search.
- [x] availability result source provenance + freshness.
- [x] venue catalog source provenance.
- [x] TinyBook non-empty unrecognized HTTP-200 payloads fail closed instead of being treated as sold out.

### Radar / Push / PWA
- [x] anonymous identity + watch CRUD/idempotency/isolation.
- [x] active catalog/geographic validation + city canonicalization.
- [x] current AVAILABLE + exact-target freshness matching.
- [x] durable Push/retry/expiry/dispatch fencing.
- [x] accepted-only presentation + fail-closed final validation.
- [x] city-aware notification links and historical venue-authoritative restoration.
- [x] PWA source/freshness visibility.
- [x] full one-venue Radar editor: date range, optional weekdays, time window, edit, pause/resume and delete.
- [x] existing multi-venue rules are protected from destructive editing by the current one-venue Web editor.

## Current round — Radar editor completion + source-catalog trust + private-source expansion

### Starting state

At the start of this round latest `main` was `7707f08b941a51bae5fffadf468aa9a7ce221dc7`. Plan/progress, current TinyBook source, availability repository, notification repository and PWA were re-read before changes.

### Code completed this round

#### `apps/web/src/App.tsx`

The backend already supported date ranges and day-of-week rules, but the Web product only created one-day Radar rules and exposed pause/delete. That was a real V1 functional gap.

Now the PWA supports:

- Radar end date;
- optional weekday filters (`不選＝每天`);
- existing start/end time filters;
- edit an existing one-venue/area Radar by loading its conditions back into the editor;
- update Radar via the existing PATCH API;
- cancel edit;
- pause/resume/delete as before;
- weekday summary in Radar cards;
- guard against accidentally converting an existing multi-venue Radar into a one-venue rule. Multi-venue rules remain pause/delete capable but are not edited by this Web form.

Commit:

- `c1f544598af57bbd3f84e54fdf41afd9c0d42162` — `Complete Radar range and weekday editing UX`

#### `apps/api/src/availability/repository.ts`

Venue catalog rows now include normalized `sourceCode` + `sourceName`, not just availability-result rows. This makes private/public source identity available before the user searches and gives the PWA room to distinguish venues from different booking systems in selectors/details.

Commit:

- `c6197868f21509f80873a41d13b1608a09cf69db` — `Expose source identity in venue catalog`

#### `apps/web/src/api.ts`

- `VenueOption` now includes `sourceCode` and `sourceName` so the Web contract matches the expanded venue catalog.

Commit:

- `9a352c4b1e60e0eef3218fc893160969fb2c9ad3` — `Expose venue source identity to PWA`

### Private-source research this round

#### AiNFOLiNK

Public consumer evidence remains strong and includes multiple reusable tenants (`pickleball`, `sportxai-hsp`, `sportxai`, `longtan`). The blocker is still transport-level: the current environment can see/render the public booking UIs but has not exposed the underlying normal anonymous XHR/REST contract. No guessed adapter or bypass was added.

#### PickleBook / PickleTown — newly promoted high-value candidate

A stronger private booking-system candidate was found this round:

- PickleBook's official product page states multiple partner venues are already using the system;
- the normal player UI is explicitly a `court × time` availability matrix with available/booked/held/activity states and variable peak/off-peak prices;
- its official DOPE 水獺綠洲 case study has a public booking page that renders four courts, hourly availability and current prices without requiring an AFTERTRACE credential;
- vendor material shows the same consumer booking engine is intended for additional partner venues.

This is potentially more attractive than a one-off private venue integration because one system adapter could cover multiple private courts. Current blocker: this environment has not yet exposed a stable raw XHR/JSON contract or raw server-rendered DOM contract reliable enough to write a fail-closed parser. PickleBook is now researched in parallel with AiNFOLiNK rather than waiting behind it.

#### Rejected / discovery-only paths

- LINE-only / login-only court flows remain non-real-time sources for V1.
- Third-party venue directories are used only to discover official booking links.
- No competitor aggregation feed is treated as truth.

### Documentation completed

`docs/REBUILD_PLAN.md` now records:

- full Radar date-range/day-of-week editing as V1 behavior;
- source identity in venue catalog/search trust surface;
- PickleBook as a parallel high-value private booking-system candidate;
- promotion criteria for AiNFOLiNK/PickleBook remain normal anonymous transport or conservative stable public markup, never guessed/private access.

Relevant commit:

- `b0d06c2bce90bab58685f1141f5779747b0dcdf1` — `Expand Radar UX and PickleBook source plan`

### Verification intentionally deferred

Per current product strategy this round did not spend time on pnpm installation, lockfile regeneration, full typecheck/lint/test/build/schema checks, CI, migration rehearsal, PowerShell deployment, Neon or Cloudflare deployment.

Full repository verification remains intentionally deferred rather than green.

## Remaining function/source work — highest priority first

1. Continue resolving **AiNFOLiNK** anonymous availability transport from normal `guestBooking`/`booking` consumer flows.
2. In parallel resolve **PickleBook** public availability transport / stable server-rendered contract, starting from DOPE's official public booking matrix. Whichever system becomes reproducible first should become the next system-level Adapter.
3. Continue finding verified Taipei private court tenants for TinyBook/PickleBook/AiNFOLiNK; do not pad coverage with rooms/classes/non-rental products.
4. Inspect remaining mixed-source semantics: booking horizon, slot duration, dynamic prices and source minimum intervals.
5. Consider showing `sourceName` directly in the venue selector now that the venue catalog carries it, especially when two systems eventually expose similarly named venues.
6. Source-inspect the complete PWA path after the new Radar editor: search → source trust → official handoff → date-range/weekday Radar → Push → cross-city deep link.

## Deferred release verification

- regenerate `pnpm-lock.yaml`;
- full `typecheck`, `lint`, `test`, `build`, `db:schema:check`;
- migrations `0000`→`0003` on fresh Neon;
- Worker `DATABASE_URL` + VAPID configuration;
- live TinyBook A11/Zhonghe availability smoke;
- live additional private-source smoke if promoted;
- deploy Worker/PWA + `/ready`;
- real-device public/private polling → Radar → Push → click;
- measure provider latency/rate limits before lowering polling intervals.

## Next round priority

Keep source/function work ahead of build/test. Attack AiNFOLiNK and PickleBook in parallel. If either public transport becomes reproducible, implement the next `AvailabilitySourceAdapter` immediately. Otherwise continue strengthening mixed-source UX/semantics without guessing provider APIs.
