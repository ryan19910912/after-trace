# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

This file is the current-state handoff. Git history preserves older implementation history; stale migration or product assumptions should not be retained here merely for chronology.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` records text.
- Group Reply + `@AFTERTRACE` records bounded cached quoted TEXT; Reply AUDIO/IMAGE/FILE uses direct LINE content fetch. Ordinary private OA support text is not cached.
- `@AFTERTRACE 查詢` opens scoped Web/PWA; no LIFF.
- FREE is personal-only; group collaboration requires current paid entitlement/capability.
- LINE Bot `join` does not reliably identify the inviter. Current MVP ownership uses explicit `@AFTERTRACE 啟用`; never infer Owner from first speaker or synthetic join `source.userId`.
- Owner binding is stable. Owner leaving does not silently transfer ownership; conflicting claims do not overwrite an existing Owner.
- Group AI usage charges the stable Owner while retaining actor attribution.
- `groupCollaboration` is the group on/off gate; `maxGroupCount` is enforced for LINE/Web group read/query/recording.
- Plan billing cadence is a dedicated plan property. Initial product types are `ONE_TIME` and `MONTHLY`; quarterly/yearly are future-only until actually offered.
- Paid `MONTHLY` requires provider-supported recurring-payment authorization/token/mandate. Only confirmed renewal success creates the next paid period/quota snapshot; failed renewal creates no new paid allowance.
- Monthly unused allowance does not roll over. Historical usage/cost remains in its original period.
- Whether FREE is `ONE_TIME` or `MONTHLY` remains undecided and must not be inferred from price zero.
- Product/subscription decisions agreed with the user must be persisted into durable docs in the same development batch.

## Implemented core surface

- Worklog users/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Worklog-only group/OA webhook runtime; retired Memory/Energy/conversation/commerce/reminder runtime removed from active paths.
- Stable group owner binding and member recording controls.
- GROUP authorization checks active source/member, stable Owner, current enabled paid plan, temporal validity, `groupCollaboration`, explicit numeric `maxGroupCount`, and stable owned-group ordinal.
- Missing/malformed `maxGroupCount` on a group-enabled plan fails closed rather than granting unlimited groups.
- Web `/surfaces` and `/records/group/:sourceId` use the same current group entitlement boundary, preventing expired/no-capability/over-limit Web read bypass.
- Group raw TEXT still persists when `aiTextRecording=false`; AI normalization is skipped rather than blocking the base record.
- Group quoted media honors `aiMediaIngestion`: LINE content is minimally resolved first so expired quoted TEXT can still be classified correctly, then real media is rejected before quota reservation/Gemini when capability is disabled.
- Raw TEXT persistence/idempotency; bounded GROUP quoted-TEXT PostgreSQL cache; direct LINE attachment fetch with no binary persistence.
- Durable Gemini TEXT normalization and attachment ingestion with quota reservation/settlement and provider-price snapshots.
- Gemini attachment usage reads `usageMetadata.promptTokensDetails`: total `promptTokenCount` remains the quota input total while AUDIO/IMAGE values are stored as subsets for pricing. Provider cost subtracts modality subsets from ordinary input so a token is not priced twice; null modality-specific price falls back to ordinary input rate.
- GROUP/PRIVATE one-time Web entry and ordinary LINE Login; no LIFF.
- PWA personal/group browsing, owner usage/member controls, customer/project CRUD, record organization, finance and feedback.
- Admin username/password + HMAC session, users/groups/plans/quota/AI runtime/feedback/anomaly/audit views.
- LINE group/OA lifecycle/message/reply/query-entry failures have best-effort writers into `worklog_anomaly_events`.
- API Worker records best-effort anomalies for ADMIN, subscription and Worklog Web API responses >=500 plus unhandled boundary exceptions; expected 4xx validation/auth failures are not operational incidents.
- Attachment and text-normalization failures remain durably represented in dedicated ingestion/normalization state tables and are separately surfaced by Admin.
- Provider-neutral checkout-intent boundary exists, but payment provider/recurring renewal is not connected.
- Customer subscription cards no longer advertise dormant `pwaEditing` / `export` capabilities as if they were currently enforced/implemented features.

## Current migration/deployment reality

The repository is migration-squashed:

- `drizzle/meta/_journal.json` contains only `0000_worklog_baseline`.
- `drizzle/0000_worklog_baseline.sql` is the consolidated current Worklog baseline.
- Separate `0011`–`0014` files and `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql` are not present.
- The consolidated baseline includes quota-cycle allowance snapshot preservation, project/customer link synchronization and `oa_friend_state_at`.
- Active workspace is `apps/*`; no `packages/shared` importer remains.

Production migration blocker:

- `worker-deploy.ps1` automatically executes `db:deploy:migrate`.
- Existing target DBs may have older multi-migration Drizzle history while this branch has one consolidated baseline.
- Production migrate is not proven safe until target migration history/schema are inspected and a reconciliation strategy is tested on a disposable clone.

See `docs/WORKLOG_DEPLOYMENT.md`.

## Consistency audit queue

### A. Billing type `ONE_TIME` / `MONTHLY` — confirmed, unresolved

Product contract requires a dedicated plan billing type, but current plan schema/API/Admin/Web do not carry it.

Required when migration/default strategy is safe:
- add dedicated plan enum/column;
- thread through Admin input/repository/UI, subscription plan API and customer Web UI;
- display `一次性` / `每月` and price cadence explicitly;
- make `assignPlan()` billing-type aware;
- do not add quarterly/yearly before actually offered.

Existing plan rows require an explicit migration/default decision; do not infer cadence from price. Because target migration history is unresolved, do not add a production-assumed billing migration before reconciliation design is known.

### B. Monthly renewal/new quota period — confirmed, unresolved

Current `assignPlan()` can default an end to `+1 calendar month`, but there is no recurring renewal workflow.

Required:
- idempotent renewal-domain operation;
- confirmed provider success advances subscription and snapshots fresh allowance;
- payment failure grants no new quota and enters selected failure/retry state;
- prior unused quota does not roll over.

### C. Recurring provider lifecycle — expected external gap, unresolved

Checkout intent is provider-neutral only. There is no provider recurring authorization/subscription identity, webhook-event ledger, recurring charge lifecycle, renewal transition, cancellation or retry workflow.

After provider selection:
- persist provider-approved customer/subscription/authorization references only, never raw card data;
- process provider events idempotently;
- duplicate success notifications must not create duplicate periods/quota;
- cancellation stops future renewal without deleting history.

### D. Capability enforcement — GROUP fixed; PRIVATE unresolved

Fixed for GROUP:
- `aiTextRecording=false` preserves raw TEXT but skips Gemini normalization.
- `aiMediaIngestion=false` prevents quota/provider work for real media.
- Cache-missed quoted messages still perform minimum LINE-content classification so expired quoted TEXT keeps explicit re-entry guidance.

Still unresolved:
- `privateOaRecording`: private OA runtime checks OA friendship, not this capability.
- private `aiTextRecording`: private TEXT still invokes normalization when available.
- private `aiMediaIngestion`: private quoted attachment still enters attachment ingestion with no capability context.
- `pwaEditing`: mutation routes enforce workspace ownership, not this capability; exact product scope is undecided.
- `export`: capability exists but no export API/feature was found.

Architecture recommendation:
- centralize effective user-plan/capability resolution instead of adding ad-hoc SQL to each caller;
- preserve historical read access when a write/AI capability is disabled;
- normalize legacy plan capability JSON before production.

Private capability work remains coupled to unresolved FREE semantics: OA bootstrap creates no FREE subscription row, while quota service treats no subscription as `NO_SUBSCRIPTION`. Do not accidentally lock all FREE private users before FREE cadence/model is decided.

### E. Web group entitlement bypass — FIXED IN CODE, validation pending

`/records/group/:sourceId` and `/surfaces` authorize current group entitlement instead of relying only on active membership. Executable route/typecheck/E2E validation remains pending.

### F. FREE identity vs actual subscription row — confirmed, unresolved

OA bootstrap creates user/workspace/private source but no FREE subscription row. Some UI/reporting code displays fallback `FREE`, while entitlement/quota service can return `NO_SUBSCRIPTION` and zero allowance.

After FREE `ONE_TIME` vs `MONTHLY` is decided, choose one consistent strategy: durable FREE subscription/cycle or explicitly virtual FREE entitlement, then use it everywhere.

### G. `maxGroupCount` legacy configuration — runtime fixed, data cleanup pending

Missing/malformed max count fails closed. Existing group-enabled plan rows should be normalized to explicit numeric `maxGroupCount` and invalid legacy configuration should be visible in Admin.

### H. AI provider accounting / quota settlement — high priority, unresolved

Fixed previously:
- total Gemini prompt usage and AUDIO/IMAGE modality subsets are no longer double-counted;
- null media-specific price falls back to ordinary input price;
- impossible media subset totals are rejected.

Confirmed current defects:

1. **Provider-success over-reservation is released as unused.**
   - TEXT normalization and attachment ingestion both call Gemini first, then if `actualUnits > unitsReserved`, explicitly release the reservation and fail with `AI_USAGE_EXCEEDED_RESERVATION`.
   - That means a real provider cost occurred but no `worklog_ai_usage_events` row is committed and quota is restored as if the call never happened.
   - This contradicts the surrounding provider-success reliability invariant.

2. **Provider-success can also lose settlement through reservation expiry.**
   - AI reservations use a finite TTL (current normalization/attachment callers request 10 minutes).
   - `reserveAi()` expires stale reservations for the charged user before creating a new hold.
   - Therefore another request can transition an old in-flight reservation to `EXPIRED` and release its held units if provider execution/persistence/settlement outlives the TTL.
   - Current `commitAiUsage()` and both Drizzle commit implementations only settle `RESERVED`; a durable `PROVIDER_SUCCEEDED` result whose reservation is now `EXPIRED` cannot create the authoritative provider usage/cost event.
   - TEXT/attachment retry paths then see a non-COMMITTED reservation and terminalize/fail even though provider cost was real.

3. **Thinking tokens are omitted.**
   - Gemini responses can report `usageMetadata.thoughtsTokenCount`; current TEXT/attachment response types ignore it.
   - Current Gemini pricing charges output including thinking tokens, so provider cost and token-equivalent quota can be understated on thinking-enabled models.

4. **One request shape is not safely model-generic.**
   - Active model is DB-configurable, but current requests hard-code `temperature: 0.1` and no thinking policy.
   - Current Google guidance differs by model generation: Gemini 3.x uses `thinkingLevel`, while Gemini 2.5 uses `thinkingBudget`; Gemini 3.5 guidance also recommends removing older manual sampling parameters in normal use.
   - A single hard-coded thinking field is therefore not a safe fix while arbitrary model ids remain operator-configurable.

Important implementation observation from current DB baseline:
- `worklog_ai_quota_balances` has no constraint requiring `used_units <= allowance_units`.
- Reservation preflight already refuses future holds when `used + reserved + requested > allowance`.
- Therefore an exact provider-success settlement can safely record an unexpected overage by adding full actual usage to `used_units` (possibly above allowance), making remaining entitlement effectively zero and naturally blocking future reservations. This is preferable to dropping a real provider cost.

Recommended deterministic settlement design:
- once provider returns successfully, persist provider result + exact usage/cost snapshot before any settlement decision;
- provider success must never call `releaseAi()`;
- make settlement accept exact actual usage even when `actualUnits > unitsReserved`;
- make settlement recover a durable provider-success result whose reservation became `EXPIRED`: lock reservation/balance, avoid subtracting reserved units a second time when expiry already released them, add full actual usage, transition reservation to `COMMITTED`, and insert exactly one usage event;
- retain row-lock/status transition idempotency so duplicate resume cannot double-charge;
- allow `used_units` to exceed allowance only as an accounting consequence of provider overrun, not as a permission to start a call; preflight remains the user-facing quota gate;
- add explicit regression tests for overage commit, expiry-before-settlement, concurrent resume, and provider-success persistence uncertainty;
- separately add billable thinking-token accounting and a model-compatible thinking/reservation policy before plan quotas are finalized.

Do not finalize FREE/paid AI allowance numbers until real text/image/audio/PDF calls are measured with the corrected ledger.

### I. Admin/current-effective quota drift — confirmed, unresolved

`/usage/me` requires an enabled, temporally current ACTIVE plan, but Admin list/detail/group SQL directly shows balance/template allowance without the same effective-state calculation. Expired, not-yet-effective or disabled subscriptions can show nonzero fields labeled as current allowance/remaining.

Concrete issues:
- group-detail backend does not return Owner subscription status/effective-at/plan-enabled fields;
- Admin client falls back to `ACTIVE` whenever an Owner plan code exists, so an inactive Owner can be presented as effectively active;
- current `user_type = GROUP_ENABLED` means “owns at least one ACTIVE group source,” not “has current group entitlement”;
- main user list shows group counts, not compact actual related group/source IDs required by product spec.

Recommended:
- centralize/reuse one effective-subscription evaluator in Admin reporting;
- return effective-state facts from server instead of optimistic client reconstruction;
- distinguish current-cycle values from stored/historical snapshots;
- calculate `GROUP_ENABLED` from current group entitlement, or rename factual classification to `GROUP_OWNER`;
- add compact actual related group/source ids.

### J. Admin AI pricing editor — confirmed destructive mismatch, unresolved

Backend/API support distinct `audio_usd_per_million` and `image_usd_per_million`, but current Admin editor exposes only ordinary input/output prices and on every save writes ordinary input price into both media fields.

Required low-risk fix:
- expose independent optional audio and image input-price fields;
- initialize them from existing config;
- preserve null as “use ordinary input price fallback” instead of overwriting with a duplicate number;
- update explanatory copy so it does not claim all modalities always have the same rate.

### K. Structured anomaly coverage — main LINE/Web/Admin boundaries FIXED, deduplication optional

Current behavior:
- group/OA lifecycle/message/reply/query-entry failures write best-effort OPEN anomaly rows;
- Admin/subscription/Worklog Web API server responses >=500 are captured at API Worker boundary;
- unhandled exceptions escaping those route apps are captured and return stable 500;
- normal 4xx validation/auth failures are not persisted as anomalies;
- anomaly persistence failure does not recursively break customer handling;
- attachment/normalization failures remain structured in dedicated state tables and are separately surfaced by Admin.

Optional later hardening: anomaly deduplication/fingerprint if repeated incidents become noisy.

### L. Owner leaves group while other members can still charge Owner — PRODUCT/CONSENT DECISION REQUIRED

Current authorization requires actor to be active but does not require the bound Owner to remain an active group member. If Owner leaves while Bot/members remain, active members can keep consuming that Owner's subscription/AI quota.

Recommended direction awaiting product approval:
- preserve stable Owner/history;
- suspend new group record/query/provider work while Owner is absent;
- resume on Owner rejoin or future explicit transfer/rebind;
- never silently transfer ownership.

### M. PWA editing capability scope — PRODUCT DECISION REQUIRED

Admin copy says `pwaEditing` means Web/PWA work-record editing, but Web routes also expose customer/project/finance CRUD. Current capability is not enforced on any of those mutations. Exact scope must be decided before server-side enforcement.

### N. Export / dormant customer-facing capabilities — presentation hardened, feature unresolved

Admin can configure `export`, but no export endpoint/UI exists. Customer subscription cards hide `pwaEditing` and `export` until those features are truthful. Implement or keep future-only; re-add customer benefit copy only after enforcement exists.

### O. LINE general-file support wording vs implementation — PRODUCT/DOC DECISION REQUIRED

LINE content policy mentions DOCX/XLSX-style content “when practical”; current attachment normalizer explicitly rejects Word/Excel MIME types and asks users to convert to PDF/text. Decide whether Office parsing is MVP or future-only; do not silently redefine either side.

### P. Low-level record-read service is membership-only — layering hardening recommended

Direct Web bypass is fixed at route composition, but low-level `WorklogRecordReadService` methods remain membership/source primitives. Rename/document them as low-level or move entitlement composition higher so future routes cannot accidentally skip paid entitlement.

### Q. Migration history reconciliation — operational production blocker

Docs reflect consolidated `0000`, but actual target DB migration history still needs inspection, one-time reconciliation design and proof on a disposable clone before production deploy helper may migrate automatically.

## Other verified good contracts

- Ordinary GROUP text is bounded-cache-only and is not permanent without explicit trigger.
- Ordinary private OA support text is not cached.
- LINE attachment binaries are not persisted.
- Cache-missed old quoted TEXT keeps explicit re-entry guidance.
- Group Owner cannot be silently overwritten by another claim.
- Group member recording disable occurs before new group record/provider work.
- Expired persisted `status='ACTIVE'` does not grant collaboration through collaboration service.
- Consolidated DB baseline includes important quota/project consistency guards.
- Admin presentation preserves raw enum/code values and adds translated labels separately.
- Group Web one-time entry verifies nonce/current membership; downstream group APIs enforce current paid entitlement on protected operations.
- Web help copy describes explicit Owner claim rather than claiming inviter auto-detection.

## Static validation performed in latest audit batch

Read before work:
- `WORKLOG_PRODUCT_SPEC.md`
- `WORKLOG_DEVELOPMENT_POLICY.md`
- `WORKLOG_REBUILD_PROGRESS.md`
- `WORKLOG_LINE_CONTENT_POLICY.md`
- `WORKLOG_DEPLOYMENT.md`

Source areas audited this batch:
- `text-normalization.ts` provider-success/settlement boundary;
- `attachment-ingestion.ts` provider-success/settlement boundary;
- `subscription.ts` reservation/commit service semantics;
- `drizzle-subscription.ts` and runtime `drizzle-subscription-safe.ts` atomic settlement predicates;
- consolidated DB quota-balance constraints/trigger;
- Gemini TEXT/attachment reservation and usage response parsing;
- Admin user/group effective-state SQL/client reconstruction;
- Admin AI runtime editor versus backend media-pricing contract.

Current external Google API facts re-verified during this batch:
- thinking tokens are billable as output;
- Gemini 3.x uses model-specific `thinkingLevel` controls and dynamic thinking;
- Gemini 2.5 uses `thinkingBudget` rather than `thinkingLevel`;
- current Gemini 3.5 guidance recommends avoiding older manual sampling settings such as custom temperature/top-p/top-k for ordinary use;
- a thinking level is a relative reasoning control, not an exact token-reservation guarantee.

New confirmed defect this batch:
- provider-success accounting can be lost not only on `actual > reserved`, but also when a reservation expires before durable provider-result settlement. `expireStaleAiReservations()` can be invoked by another request for the same charged user, while commit accepts only `RESERVED`.

Implementation change this batch:
- no runtime code was changed because the correct fix spans provider-result persistence, reservation status transitions, balance settlement and idempotency; a local conditional would leave the expiry race or ledger inconsistency behind.
- this handoff now records the deterministic exact-settlement design so the next implementation batch does not fix only one symptom.

Tests/status:
- no tests were executed.
- existing authored tests still encode the old “reject actual > reserved” behavior and must be changed with the settlement implementation.
- no typecheck, build, schema check, migration, browser smoke, Worker smoke, LINE E2E or Gemini E2E was run.
- **GitHub Actions were not run, dispatched, rerun, enabled or modified.** This documentation commit uses `[skip ci]`.

## Concentrated validation still pending

After remaining static/code gaps are closed, run one explicit local validation phase:

1. install/frozen-install;
2. `pnpm typecheck`;
3. `pnpm test`;
4. schema/drift check;
5. consolidated `0000` on fresh disposable PostgreSQL;
6. existing-DB migration-history reconciliation on disposable clone;
7. Web PWA auth/surfaces/CRUD/filter/subscription smoke;
8. Admin auth/plan/quota/anomaly/manual-subscription smoke;
9. API/Web/Admin Worker local/build smoke;
10. real LINE OA/group lifecycle, owner claim, TEXT, Reply-TEXT expiry, AUDIO/IMAGE/PDF/file flows;
11. real Gemini text/image/audio/PDF usage/cost snapshots including prompt modality details, thinking-token accounting, over-reservation and expiry-before-settlement invariants;
12. capability downgrade/disable cases, maxGroupCount, subscription expiry and anomaly persistence failure cases.

## Current planning estimate

Planning estimates only; not test results:

- MVP non-provider feature implementation: **about 95–96%**.
- Static architecture/logic audit coverage: **about 97–98%**.
- Production readiness including still-unrun executable validation, AI settlement/accounting, migration and provider gaps: **about 79–82%**.
- Remaining internal static/code work before concentrated validation: roughly **2–3 large batches / about 4–8 focused hours**.
- After concentrated validation starts, reserve roughly **2–8 focused hours** for ordinary compile/schema/browser/runtime fixes; deeper migration or AI settlement defects could extend this.
- External/provider work is separate: payment provider selection, recurring authorization/webhooks, production secrets/domains/LINE configuration and production migration-history reconciliation.

## Next batch

Continue from, in order:

1. implement exact provider-success settlement: persist result before settlement, never release successful calls, support actual usage above reserved, and recover durable provider success from reservation `EXPIRED` without double-decrement/double-usage;
2. add regression tests for overage, expiry-before-settlement, idempotent resume and concurrency; tests remain unexecuted until concentrated validation unless explicitly requested earlier;
3. design model-aware thinking usage/configuration and account `thoughtsTokenCount` without assuming one Gemini generation supports the same control shape as another;
4. fix Admin effective subscription/quota presentation, group-detail server facts, `GROUP_ENABLED` semantics and actual group-id list output;
5. fix Admin audio/image pricing editor so media prices are independent/nullable and never destructively overwritten;
6. design private OA entitlement/capability boundary after FREE semantics are decided;
7. continue billing type/renewal scaffolding only where migration/default/provider decisions are not guessed;
8. revisit Office-file support wording versus actual MVP implementation and harden low-level record-read layering if useful.

Do not use GitHub Actions as validation.
