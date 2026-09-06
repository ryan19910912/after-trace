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

## Current checkpoint — 2026-09-07 target Web free Record UI + native GROUP invite UI authored; subscription Web boundary moved to durable user session; executable/schema/Dev verification still pending

AFTERTRACE remains **Web + PWA-first work memory**, with optional Chrome extension. LINE is retired/migration-only and must not drive new customer behavior.

This run continued directly from the durable-session free manual Record API checkpoint. It did not broad-audit the repository, did not run/modify/trigger GitHub Actions, did not reset Dev data, and did not touch the unrelated local `apps/api/verify-admin-schema.mjs`.

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
- subscription-plan AI hard-cap fields exist in target TypeScript schema.

Canonical generated `drizzle/0000` is still behind the target TypeScript schema. **Do not deploy or migrate this branch until executable validation and baseline regeneration are green.**

## Target Web API contract — reset this run

`apps/web/src/worklog-api.ts` was reduced from the retired Entity/funding/confirmation-centered client to the current Web/PWA contract.

Current behavior:

- `WorklogRecord.occurredAt` is `string | null`;
- revision previous/new event times are nullable;
- API `null` stays `null` and is no longer converted to the literal string `"null"`;
- GROUP surfaces use `sourceId`, native `name`, `OWNER | MEMBER` role and optional migration-only `legacyLineGroupId`;
- manual create requires `rawText`; `occurredAt` is optional/null; title/Entity are only bounded legacy compatibility fields;
- target client no longer exposes Entity listing/title-move, GROUP funding/responsible-user or pending LINE AI confirmation methods to the primary Worklog UI;
- native GROUP methods now cover list/create/create-invite/revoke-invite/join;
- raw invite token is returned only from invite creation response; normal group summaries contain no raw token.

The migration-era `lineLoginUrl()` and old entry-link exchange remain temporarily because provider-neutral login itself is not implemented yet. They are not target domain dependencies.

## Primary Worklog Web UI — reset this run

`apps/web/src/WorklogRoot.tsx` now consumes the target free/manual Record model.

### Free Record UX

- create/edit requires only Record content;
- event time is explicitly optional and may be cleared;
- a new manual Record no longer defaults event time to now;
- empty event time sends `occurredAt: null`;
- Record card displays `發生時間` only when an event time exists;
- otherwise it displays `createdAt` as `記錄時間`, avoiding a fabricated business event time;
- title is not a save gate and is shown only when metadata already exists;
- deterministic filters are content query + from/to time;
- delete/restore/history stay available;
- title move, batch move, Entity selector/datalist, pending AI confirmations, personal Grant panel and GROUP AI responsible-user/funding UI were removed from the primary target surface.

### Native GROUP UX

A new `群組` tab now supports:

- create AFTERTRACE group;
- list current groups with native name and role;
- open GROUP Record scope by `sourceId` only;
- OWNER creates a one-use invite through the existing native GROUP API;
- display/copy the raw share link only after creation;
- revoke the currently displayed created invite;
- paste an invite link/token and explicitly join;
- `?invite=<token>` links are temporarily persisted client-side across the current login redirect, then consumed after authentication;
- successful join switches to the joined GROUP Record scope.

The raw invite token is deliberately not recoverable from database state. Current Web UX creates `maxUses = 1`; the backend service remains capable of bounded expiry/use-count configuration.

Legacy LINE `?t=` group entry links remain migration-only and resolve only through `legacyLineGroupId`. Normal native GROUP UI does not depend on LINE ids.

## Retired LINE customer UI removed/isolate further this run

- `apps/web/src/main.tsx` no longer renders `LineOaFriendHint` on the main Web shell;
- `HelpRoot.tsx` now documents Web/PWA manual Records, native GROUP invites and paid per-user AI direction instead of LINE bot commands/Reply/funding;
- `FeedbackRoot.tsx` user-facing login/error copy now says AFTERTRACE rather than instructing users to use LINE;
- `SubscriptionRoot.tsx` no longer advertises the retired FREE AI grant / GROUP funding model. It now states that FREE has no provider-backed AI, paid AI is per user, manual features stay free, and paid AI will be fair-use/hard-cap protected.

The actual migration-era authentication adapter still uses LINE underneath until a provider-neutral login is implemented. The UI copy change does not claim that replacement auth already exists.

## Subscription route identity boundary — improved this run

`apps/api/src/worklog/subscription-routes.ts` no longer stores `session.lineUserId` as its request identity.

Current flow:

1. verify signed Web session;
2. retain the full `WebSessionClaims` in request context;
3. for DB-backed plan/checkout work, resolve AFTERTRACE user through `resolveWebSessionUserId()`;
4. prefer durable signed `userId` and retain legacy LINE fallback only through the shared migration resolver;
5. query subscription state by `worklog_users.id` rather than `line_user_id`.

Checkout remains deliberately fail-closed (`CHECKOUT_ENABLED = false`). The plan query still returns legacy point/Grant compatibility fields because the paid runtime/accounting migration is not complete; the target Web page no longer presents those fields as the new product promise.

## Tests authored/updated this run

### Web contract

New `apps/web/src/worklog-api.test.ts` covers:

- nullable manual Record event time remains null;
- nullable revision event times remain null;
- native GROUP surface maps `name` / role without requiring a LINE group id;
- content-only create sends explicit `occurredAt: null`;
- invite creation returns the one-time raw invite token while invite metadata remains structured.

Status: **AUTHORED / NOT RUN**.

### Subscription boundary

`apps/api/src/worklog/subscription-routes.test.ts` now issues a durable **userId-only** Web session for the disabled-checkout boundary. It verifies the route can accept the target session identity without requiring a LINE id before returning the intentional `CHECKOUT_NOT_ENABLED` fail-closed response.

Status: **UPDATED / NOT RUN**.

## Commits in this run

All commits contain `[skip ci]`:

- `93f284d5` — align Web API with free Records and native groups;
- `701759eb` — reset Worklog UI to free Records and native groups;
- `57c140ea` — remove retired LINE hint from target Web shell;
- `f1d666ab` — add nullable Record/native GROUP Web API tests;
- `6ff0f68e` — replace LINE help with Web/PWA guidance;
- `165222ff` — remove retired LINE copy from feedback login;
- `635f614e` — align subscription page with paid per-user AI model;
- `acded79f` — resolve subscription user from durable Web session;
- `00bfea7b` — cover durable user session on subscription boundary;
- checkpoint doc commit follows this list.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

## Validation status

### Authored / updated in this run

- `apps/web/src/worklog-api.ts` — **UPDATED / NOT RUN**
- `apps/web/src/WorklogRoot.tsx` — **UPDATED / NOT RUN**
- `apps/web/src/worklog-api.test.ts` — **AUTHORED / NOT RUN**
- `apps/web/src/main.tsx` — **UPDATED / NOT RUN**
- `apps/web/src/HelpRoot.tsx` — **UPDATED / NOT RUN**
- `apps/web/src/FeedbackRoot.tsx` — **UPDATED / NOT RUN**
- `apps/web/src/SubscriptionRoot.tsx` — **UPDATED / NOT RUN**
- `apps/api/src/worklog/subscription-routes.ts` — **UPDATED / NOT RUN**
- `apps/api/src/worklog/subscription-routes.test.ts` — **UPDATED / NOT RUN**

### Earlier target tests still awaiting execution

- `apps/api/src/auth/token.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/native-groups.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `apps/api/src/worklog/native-group-routes.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/manual-record-routes.test.ts` — **AUTHORED / NOT RUN**
- `apps/api/src/worklog/records.test.ts` — **AUTHORED/UPDATED / NOT RUN**
- `product-record-schema.test.ts` — **AUTHORED / NOT RUN**
- `product-foundation-schema.test.ts` — **AUTHORED / NOT RUN**

### Executable validation

- Web TypeScript typecheck — **NOT RUN**
- Web Vitest including `worklog-api.test.ts` — **NOT RUN**
- Web production build — **NOT RUN**
- API TypeScript typecheck — **NOT RUN**
- focused auth/native-group/manual-record/subscription/schema tests — **NOT RUN**
- full API Vitest — **NOT RUN**
- Drizzle baseline regenerate / guard — **NOT RUN**
- Dev DB forward migration — **NOT RUN**
- Native GROUP PostgreSQL invite concurrency smoke — **NOT RUN**
- free manual Record PostgreSQL smoke — **NOT RUN**
- Native GROUP + manual Record Dev HTTP E2E — **NOT RUN**
- Web/PWA browser smoke — **NOT RUN**

Reason: GitHub connector can read/write the repository, but no executable `after-trace` checkout is mounted in the runtime. A direct container `git ls-remote` attempt also failed DNS resolution for `github.com`. Therefore no compile/test/runtime success is inferred from source review.

## Known blockers / risks

1. **Executable validation is the immediate blocker to deployment.** The newly rewritten Web client/React code and target API code have not been compiled or executed.
2. **Canonical Drizzle baseline is still behind target TypeScript schema.** No Dev migration/deploy until typecheck/tests and baseline regeneration are green.
3. **Native GROUP invite SQL locking and manual Record SQL still need real PostgreSQL verification.**
4. **Provider-neutral login itself remains unimplemented.** Session/domain APIs are userId-first, but the real login adapter is still migration-era LINE Login.
5. **The invite UI has no durable invite-list endpoint.** OWNER can revoke the just-created invite while it is displayed; durable management/listing of older active invites is not implemented yet. Current MVP may remain single-use if validated, but do not claim complete invite administration yet.
6. **Subscription route identity is userId-first, but paid entitlement/accounting is not.** Plan responses retain legacy Grant compatibility fields; provider-backed runtime still uses old Grant-era logic and target monthly resource/provider-cost hard caps are schema-only.
7. **Some secondary legacy code/files remain present but unreferenced or migration-only**, including LINE OA hint implementation and old Worklog routes below the legacy runtime boundary. Remove only after dependency review.
8. **PWA capture-first microphone/browser speech-to-text is not implemented yet.** Current target UI supports free manual text capture only.
9. **Readiness/env requirements still contain migration-era LINE dependencies.** Free routes are isolated, but full application readiness has not been made LINE-independent yet.
10. **Tasks/reminders/PWA Push, Related Records/summary/rewrite, paid AI capture/search and Chrome extension remain unimplemented.**

## Exact next development order

1. Re-read required docs and this checkpoint; do not broad-audit.
2. If an executable checkout becomes available, stop adding speculative layers long enough to run and fix:
   - `pnpm --filter @aftertrace/web typecheck`;
   - focused Web `worklog-api.test.ts` and Web build;
   - API typecheck;
   - focused auth/native GROUP/manual Record/subscription/product-schema tests.
   Never mark them PASS without actual execution.
3. If executable checkout is still unavailable, continue the next bounded source batch: **capture-first PWA/free voice input**:
   - inspect only the existing Web entry/PWA manifest/service-worker surfaces needed for this feature;
   - make microphone the primary PWA capture action without auto-starting it;
   - implement best-effort browser/device speech-to-text as provider-free input where supported;
   - fall back cleanly to manual text when unsupported/denied;
   - never send this free speech-to-text path through Gemini/provider AI;
   - reuse the same content-only manual Record API and optional event-time editor.
4. Add focused Web tests around speech-input capability detection/state transitions where practical without browser-specific integration assumptions.
5. Then finish Native GROUP Web polish needed for MVP, especially deciding whether an OWNER invite-list/revoke-old-invite endpoint is required before launch; do not expand roles beyond `OWNER | MEMBER` without a concrete need.
6. After API/Web local green, regenerate canonical `drizzle/0000`, run baseline guard, then apply the idempotent forward migration to Dev while preserving existing durable data.
7. Run Dev E2E:
   - durable signed session -> surfaces;
   - create content-only PRIVATE Record with null event time -> list/search/edit -> set/clear time -> delete/restore -> revision history;
   - create native GROUP -> invite -> second authenticated user joins -> both can use manual GROUP Records -> revoke invite -> new join rejected while existing member retains access;
   - verify target Web renders null event time as `記錄時間`, not invalid/fabricated event time.
8. Once free core/native GROUP are runtime green, wire paid **per-user** AI entitlement with real subscription-period resource + Provider Cost TWD hard caps before enabling any paid provider call or checkout.
9. Then build AI capture/enrichment/natural-language search, Related Records, range summary/rewrite, Tasks/PWA Push, Chrome extension, readiness LINE isolation and final legacy cleanup.

## Remaining development estimate

Current estimate: **about 48–88 focused development hours** remaining.

Approximate buckets:

- executable validation, baseline/forward migration and free/native-GROUP Dev E2E: 6–12h;
- capture-first PWA + provider-free browser/device speech-to-text + Web polish: 4–7h;
- provider-neutral login completion and migration isolation: 3–6h, dependent on the chosen login provider;
- paid per-user AI entitlement/hard caps + capture/enrichment/search: 14–24h;
- Related Records + range summary/rewrite: 6–10h;
- Tasks/reminders + PWA Push/Cron: 6–11h;
- Chrome extension: 5–9h;
- readiness/release hardening/final LINE cleanup: 4–9h.

The range should be tightened after the first executable Web/API typecheck, regenerated baseline, forward Dev migration and target Dev E2E. Those remain the largest uncertainty around legacy compatibility cost.
