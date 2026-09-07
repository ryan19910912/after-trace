# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every substantive development run, in this exact order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

Latest docs are the only product/development specification. Never use GitHub Actions unless explicitly requested. Every development commit contains `[skip ci]`.

## Current checkpoint — 2026-09-07 capture-first PWA surface + provider-free browser speech input authored; PWA manifest/service worker/install icons added; executable/schema/Dev verification still pending

AFTERTRACE remains **Web + PWA-first work memory**, with optional Chrome extension. LINE is retired/migration-only and must not drive new customer behavior.

This run continued directly from the free Record/native GROUP Web checkpoint. It did not broad-audit the repository, did not run/modify/trigger GitHub Actions, did not reset Dev data, and did not touch the unrelated local `apps/api/verify-admin-schema.mjs`.

## Foundation retained

The accepted target foundation from prior runs remains:

- `worklog_records.occurred_at` is nullable with no implicit current-time business default;
- nullable Record `title`, `extracted_metadata`, `ai_enriched_at` plus explicit `ai_enrichment_status = NONE | ENRICHED | LEGACY`;
- existing Records are forward-mapped to `LEGACY`, not mislabeled as current paid-AI output;
- `worklog_users.line_user_id` is nullable;
- provider-neutral `worklog_auth_identities` schema exists;
- signed `WEB_SESSION` supports durable numeric `userId`; legacy LINE id is only bounded fallback for already-issued migration sessions;
- `resolveWebSessionUserId()` prefers durable `userId`;
- native GROUP Sources have `name`, nullable legacy `line_group_id`, creator, `OWNER | MEMBER` membership and hashed invite tokens;
- `/api/v1/groups` supports list/create/invite/revoke/join through durable Web sessions;
- target manual Record routes support content-only create, nullable event time, deterministic search/date filters, soft delete/restore, immutable revisions and optimistic versioning;
- free/manual Web APIs are routed before legacy LINE/Gemini runtime construction;
- subscription-plan AI hard-cap fields exist in target TypeScript schema;
- primary Web UI uses content-only free Records and native GROUP names/roles rather than Entity/funding/LINE-group concepts;
- subscription Web boundary resolves durable `userId` first and checkout remains fail-closed.

Canonical generated `drizzle/0000` is still behind the target TypeScript schema. **Do not deploy or migrate this branch until executable validation and baseline regeneration are green.**

## Capture-first PWA — authored this run

A dedicated `apps/web/src/CaptureRoot.tsx` now provides the intended installed-PWA landing experience at `/capture`.

Behavior:

- microphone is the visually primary capture action;
- microphone never auto-starts; explicit user click is required;
- the current destination Source is always visible before capture/save;
- eligible destinations are the user's PRIVATE Source plus authorized native AFTERTRACE GROUP Sources returned by the existing surfaces API;
- last selected valid Source reuses the same `aftertrace.worklog.scope` preference as the full Web surface;
- switching Source aborts any active speech capture so recognition cannot silently continue into a different destination;
- browser/device speech-to-text writes final recognized text into the same manual text draft;
- interim recognition text is shown separately and is never persisted as a Record by itself;
- recognized text is editable before save;
- optional event time uses the same nullable manual Record semantics as Web;
- `確認記錄` calls the existing content-only manual Record API;
- this free speech path never calls Gemini/provider AI and does not consume AFTERTRACE AI entitlement/accounting;
- unsupported browser, denied microphone, missing audio device, no-speech and network failures all fall back explicitly to manual text entry;
- no original microphone audio is persisted by AFTERTRACE;
- full Record management remains available through `/`.

The migration-era login adapter still uses LINE Login underneath, but `/capture` preserves its requested return path through the existing local return-key bridge so successful login comes back to the PWA capture surface. This is a temporary auth adapter only; the capture/domain API is not LINE-shaped.

## Browser speech adapter — authored this run

New `apps/web/src/speech-input.ts` isolates the non-provider Web Speech API boundary.

It:

- detects both standard `SpeechRecognition` and `webkitSpeechRecognition` constructors;
- configures `zh-TW`, interim results and short-form continuous capture;
- separates final and interim transcript parts;
- maps browser recognition failures to customer-readable manual-text fallback guidance;
- exposes no AFTERTRACE provider call or AI accounting path.

New `apps/web/src/speech-input.test.ts` covers capability detection, standard/prefixed constructors, recognition configuration, result-index handling, final/interim separation and error-message mapping.

Status: **AUTHORED / NOT RUN**.

## PWA install shell — authored this run

The Web package now includes a minimal installable PWA shell without introducing an offline Record cache.

Files/behavior:

- `apps/web/public/manifest.webmanifest` — `start_url = /capture`, standalone display, AFTERTRACE metadata;
- `apps/web/public/aftertrace-icon-192.png` and `aftertrace-icon-512.png` — raster install icons;
- `apps/web/public/aftertrace-icon.svg` — scalable fallback/favicon;
- `apps/web/public/sw.js` — minimal install/activate service worker only;
- `apps/web/index.html` — manifest/theme/mobile-app metadata and AFTERTRACE title;
- `apps/web/src/main.tsx` — routes `/capture`, preserves login return to `/capture`, registers `/sw.js` only in production.

The service worker intentionally does **not** cache authenticated Record/API responses. Offline durable Record behavior requires a later explicit product/security policy and is not silently introduced here.

GitHub repository listing was used to confirm the PNG/SVG/manifest/service-worker files exist on the branch. This is repository-state confirmation only, **not runtime/installability verification**.

## User guidance — updated this run

`apps/web/src/HelpRoot.tsx` now explains:

- installed PWA opens quick capture;
- microphone requires an explicit tap;
- browser speech-to-text is the free voice-input path;
- free speech recognition does not invoke AFTERTRACE AI or consume AI allowance;
- unsupported/denied speech cleanly falls back to text;
- paid AI voice remains a separate future provider-backed capability.

## Commits in this run

All commits contain `[skip ci]`:

- `d1c57695` — add provider-free browser speech input adapter;
- `f7349e01` — cover browser speech capability and transcript handling;
- `f94684a7` — add capture-first PWA surface with free speech input;
- `33f77fa7` — style capture-first PWA microphone experience;
- `fb65f3f1` — route installed PWA to capture surface;
- `2e735ee2` — add capture-first AFTERTRACE web app manifest;
- `5b04ca2a` — add AFTERTRACE PWA app icon;
- `b6bcf4f1` — add minimal non-caching PWA service worker;
- `314ed73b` — wire PWA manifest metadata into Web shell;
- `da8a0f5a` — document free PWA speech capture behavior;
- `ddc412f7` — add raster PWA install icons;
- `f4322c6d` — use install-safe raster PWA icons;
- checkpoint doc commit follows this list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Validation status

### Authored / updated in this run

- `apps/web/src/speech-input.ts` — **AUTHORED / NOT RUN**
- `apps/web/src/speech-input.test.ts` — **AUTHORED / NOT RUN**
- `apps/web/src/CaptureRoot.tsx` — **AUTHORED / NOT RUN**
- `apps/web/src/capture.css` — **AUTHORED / NOT RUN**
- `apps/web/src/main.tsx` — **UPDATED / NOT RUN**
- `apps/web/src/HelpRoot.tsx` — **UPDATED / NOT RUN**
- `apps/web/index.html` — **UPDATED / NOT RUN**
- `apps/web/public/manifest.webmanifest` — **AUTHORED / NOT RUN**
- `apps/web/public/sw.js` — **AUTHORED / NOT RUN**
- PWA PNG/SVG icons — **AUTHORED / NOT RUN**

### Earlier target tests still awaiting execution

- `apps/web/src/worklog-api.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/auth/token.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/native-groups.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/native-group-routes.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/manual-record-routes.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/records.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/subscription-routes.test.ts` — **UPDATED / NOT RUN**
- `product-record-schema.test.ts` — **AUTHORED / NOT RUN**
- `product-foundation-schema.test.ts` — **AUTHORED / NOT RUN**

### Executable validation

- Web TypeScript typecheck — **NOT RUN**
- Web Vitest including `speech-input.test.ts` / `worklog-api.test.ts` — **NOT RUN**
- Web production build — **NOT RUN**
- browser Web Speech permission/capture smoke — **NOT RUN**
- PWA manifest/install/standalone `/capture` smoke — **NOT RUN**
- service-worker registration smoke — **NOT RUN**
- API TypeScript typecheck — **NOT RUN**
- focused auth/native-group/manual-record/subscription/schema tests — **NOT RUN**
- full API Vitest — **NOT RUN**
- Drizzle baseline regenerate / guard — **NOT RUN**
- Dev DB forward migration — **NOT RUN**
- Native GROUP PostgreSQL invite concurrency smoke — **NOT RUN**
- free manual Record PostgreSQL smoke — **NOT RUN**
- Native GROUP + manual Record Dev HTTP E2E — **NOT RUN**
- Web/PWA browser smoke — **NOT RUN**

Reason: GitHub connector can read/write the repository, but no executable `after-trace` checkout is mounted in the runtime. A fresh `git ls-remote https://github.com/ryan19910912/after-trace.git` attempt in this run again failed DNS resolution for `github.com`. Therefore no compile/test/runtime success is inferred from source review.

## Known blockers / risks

1. **Executable validation is still the immediate deployment blocker.** New Web/PWA TypeScript, tests and browser behavior have not been compiled/executed.
2. **Canonical Drizzle baseline is still behind target TypeScript schema.** No Dev migration/deploy until typecheck/tests and baseline regeneration are green.
3. **PWA installability still needs real browser verification.** Manifest, 192/512 PNG icons and service worker are present, but Chrome/Android/iOS install behavior has not been runtime-smoked.
4. **Web Speech support is browser-dependent.** The free voice path intentionally falls back to text; do not promise universal speech recognition.
5. **Browser Web Speech may use browser-vendor speech infrastructure.** Product wording must stay precise: it does not call AFTERTRACE provider AI or consume AFTERTRACE AI allowance; do not claim all recognition is necessarily on-device.
6. **Native GROUP invite SQL locking/manual Record SQL still need real PostgreSQL verification.**
7. **Provider-neutral login itself remains unimplemented.** Session/domain APIs are userId-first, but the real login adapter is still migration-era LINE Login.
8. **The invite UI has no durable invite-list endpoint.** OWNER can revoke only the just-created invite while its id is retained in the current UI state.
9. **Paid entitlement/accounting migration is incomplete.** Target hard-cap fields are schema-only; provider runtime still contains legacy Grant-era logic and checkout remains disabled.
10. **Readiness/env requirements still contain migration-era LINE dependencies.** Free/manual routes are isolated, but full application readiness is not yet LINE-independent.
11. **Tasks/reminders/PWA Push, Related Records/summary/rewrite, paid AI capture/search and Chrome extension remain unimplemented.**

## Exact next development order

1. Re-read required docs and this checkpoint; do not broad-audit.
2. If an executable checkout becomes available, stop adding speculative layers long enough to run and fix:
   - `pnpm --filter @aftertrace/web typecheck`;
   - Web Vitest focused on `speech-input.test.ts` and `worklog-api.test.ts`;
   - Web production build;
   - API typecheck;
   - focused auth/native GROUP/manual Record/subscription/product-schema tests.
   Never mark them PASS without actual execution.
3. If executable checkout is still unavailable, continue the next bounded source batch: **durable native GROUP invite management polish**:
   - add OWNER-only list endpoint for active/recent invite metadata without raw tokens;
   - keep raw invite token one-time-only on creation;
   - allow OWNER to revoke an older active invite from durable metadata;
   - do not expose token hash or invent additional roles;
   - add route/service tests as **AUTHORED / NOT RUN** unless executable validation becomes available;
   - update Web GROUP UI to list/revoke durable invites without pretending raw tokens can be recovered.
4. After API/Web local green, regenerate canonical `drizzle/0000`, run baseline guard, then apply the idempotent forward migration to Dev while preserving existing durable data.
5. Run Dev E2E:
   - durable signed session -> surfaces;
   - create content-only PRIVATE Record with null event time -> list/search/edit -> set/clear time -> delete/restore -> revision history;
   - create native GROUP -> invite -> second authenticated user joins -> both can use manual GROUP Records -> revoke invite -> new join rejected while existing member retains access;
   - verify `/capture` selects only authorized Sources and saves through manual Record API;
   - verify target Web renders null event time as `記錄時間`, not invalid/fabricated event time;
   - verify PWA install opens `/capture` and microphone never auto-starts;
   - verify supported browser speech inserts editable text and unsupported/denied cases remain usable via manual text.
6. Once free core/native GROUP/PWA are runtime green, wire paid **per-user** AI entitlement with real subscription-period resource + Provider Cost TWD hard caps before enabling any paid provider call or checkout.
7. Then build AI capture/enrichment/natural-language search, Related Records, range summary/rewrite, Tasks/PWA Push, Chrome extension, readiness LINE isolation and final legacy cleanup.

## Remaining development estimate

Current estimate: **about 44–83 focused development hours** remaining.

Approximate buckets:

- executable validation, PWA/browser smoke, baseline/forward migration and free/native-GROUP Dev E2E: 7–13h;
- native GROUP invite management/Web polish: 2–4h;
- provider-neutral login completion and migration isolation: 3–6h, dependent on the chosen login provider;
- paid per-user AI entitlement/hard caps + capture/enrichment/search: 14–24h;
- Related Records + range summary/rewrite: 6–10h;
- Tasks/reminders + PWA Push/Cron: 6–11h;
- Chrome extension: 4–8h;
- readiness/release hardening/final LINE cleanup: 2–7h.

The range should be tightened after the first executable Web/API typecheck, PWA browser smoke, regenerated baseline, forward Dev migration and target Dev E2E. Those remain the largest uncertainty around legacy compatibility cost.
