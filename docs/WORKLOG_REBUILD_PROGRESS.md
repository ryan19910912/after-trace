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
- Gemini attachment usage now reads `usageMetadata.promptTokensDetails`: total `promptTokenCount` remains the quota input total while AUDIO/IMAGE values are stored as subsets for pricing. Provider cost subtracts modality subsets from ordinary input so a token is not priced twice; null modality-specific price falls back to the ordinary input rate rather than treating media as free.
- GROUP/PRIVATE one-time Web entry and ordinary LINE Login; no LIFF.
- PWA personal/group browsing, owner usage/member controls, customer/project CRUD, record organization, finance and feedback.
- Admin username/password + HMAC session, users/groups/plans/quota/AI runtime/feedback/anomaly/audit views.
- LINE group/OA lifecycle/message/reply/query-entry failures have best-effort writers into `worklog_anomaly_events`.
- API Worker now also records best-effort anomalies for ADMIN, subscription and Worklog Web API responses >=500 plus unhandled boundary exceptions; expected 4xx validation/auth failures are not treated as operational incidents.
- Attachment and text-normalization failures remain durably represented in their dedicated ingestion/normalization state tables and are separately surfaced by Admin.
- Provider-neutral checkout-intent boundary exists, but payment provider/recurring renewal is not connected.

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

The product contract requires a dedicated plan billing type, but current plan schema/API/Admin/Web do not carry it.

Recommended:
- add dedicated plan enum/column;
- thread through Admin input/repository/UI, subscription plan API and customer Web UI;
- display `一次性` / `每月` and price cadence explicitly;
- make `assignPlan()` billing-type aware;
- do not add quarterly/yearly before actually offered.

Migration/data note: existing plan rows need an explicit migration/default decision; do not silently infer cadence from price. Because the branch is currently migration-squashed and existing target migration history is unresolved, do not add a production-assumed billing column migration until the reconciliation approach is decided.

### B. Monthly renewal/new quota period — confirmed, unresolved

Current `assignPlan()` can default an end to `+1 calendar month`, but there is no recurring renewal workflow.

Required:
- idempotent renewal-domain operation;
- confirmed provider success advances the subscription and snapshots fresh allowance;
- payment failure creates no new quota and moves to the selected failure state/retry policy;
- prior unused quota does not roll over.

### C. Recurring provider lifecycle — expected external gap, unresolved

Checkout intent is provider-neutral only. There is no provider recurring authorization/subscription identity, webhook event ledger, recurring charge lifecycle, renewal transition, cancellation or retry workflow.

After provider selection:
- store provider-approved customer/subscription/authorization references only, never raw card data;
- process provider events idempotently;
- duplicate success notifications must not create duplicate periods/quota;
- cancellation stops future renewal without deleting history.

### D. Capability enforcement — partially fixed, high priority

Fixed for GROUP:
- `aiTextRecording=false` preserves raw TEXT but skips Gemini normalization.
- `aiMediaIngestion=false` prevents quota/provider work for real media.
- A cache-missed quoted message still performs minimal LINE content classification so old quoted TEXT retains the required re-entry guidance.

Still unresolved:
- `privateOaRecording`: private OA runtime checks OA friendship, not this capability.
- private `aiTextRecording`: private TEXT still invokes normalization when available.
- private `aiMediaIngestion`: private quoted attachment still enters attachment ingestion with no capability context.
- `pwaEditing`: mutation routes enforce workspace ownership, not this capability. Product must first confirm exact scope: record edit only vs all customer/project/finance mutations.
- `export`: capability exists but no export API/feature was found.

Architecture recommendation:
- centralize effective user-plan/capability resolution rather than add ad-hoc SQL to each caller;
- preserve historical read access when a write/AI capability is disabled;
- normalize legacy plan capability JSON before production.

Private capability work remains coupled to unresolved FREE semantics: OA bootstrap creates no FREE subscription row, while quota service treats no subscription as `NO_SUBSCRIPTION`. Do not accidentally lock all FREE private users by requiring a durable subscription row before the FREE model is decided.

### E. Web group entitlement bypass — FIXED IN CODE, validation pending

`/records/group/:sourceId` and `/surfaces` authorize current group entitlement instead of relying only on active membership.

Still needs executable route/typecheck/E2E validation.

### F. FREE identity vs actual subscription row — confirmed, unresolved

OA bootstrap creates user/workspace/private source but no FREE subscription row. Some UI/reporting code displays fallback `FREE`, while entitlement/quota service can return `NO_SUBSCRIPTION` and zero allowance.

Do not implement a permanent model until FREE `ONE_TIME` vs `MONTHLY` is decided. Then choose one consistent strategy: durable FREE subscription/cycle or explicitly virtual FREE entitlement, and use it everywhere.

### G. `maxGroupCount` legacy configuration — runtime fixed, data cleanup pending

Missing/malformed max count fails closed. Existing group-enabled plan rows should be normalized to an explicit numeric `maxGroupCount` and invalid legacy configuration should be visible in Admin.

### H. AI quota unit / provider accounting — modality double-count FIXED, broader accounting still unresolved

Fixed this batch:
- Gemini `promptTokenCount` is retained as total prompt usage for quota.
- `promptTokensDetails` is parsed for AUDIO/IMAGE modality subsets instead of copying the entire prompt count into a media field.
- provider-cost calculation prices ordinary input plus modality subsets exactly once;
- when a modality-specific price is null, its units use the ordinary input rate instead of becoming free;
- impossible media subsets larger than total prompt usage are rejected as invalid provider usage.

Newly confirmed remaining risk:
- Gemini `usageMetadata` also exposes `thoughtsTokenCount`, while current TEXT and attachment normalizers only use `candidatesTokenCount` as output usage.
- Current Gemini pricing documents state output pricing includes thinking tokens. Therefore historical provider cost and quota accounting can under-count thinking-enabled models.
- Gemini 3 models use dynamic thinking by default unless controlled. The current requests do not set `thinkingConfig` and also hard-code temperature `0.1`; current Gemini 3 guidance recommends model-appropriate thinking control and generally default temperature behavior.
- Simply adding thought tokens to `actualUnits` is not enough: current preflight reservation estimates do not reserve a bounded thinking budget, so provider success could exceed the reservation and leave an awkward settlement path.

Required before final FREE/paid quotas:
- decide a model-compatible thinking policy (for example low/minimal where supported) and reservation bound;
- account billable thinking tokens exactly once in provider cost and quota semantics;
- keep canonical user quota units conceptually separate from provider-dollar cost even if the first implementation still uses token-equivalent units;
- verify PDF/DOCUMENT modality treatment and real image/audio calls;
- calculate plan allowances only after measured real calls.

Admin AI pricing UI mismatch also remains: backend fields support separate audio/image prices, but the current Admin editor does not expose them independently and writes the ordinary input price into both fields on save. This can overwrite a provider-specific audio rate and must be corrected before cost configuration is trusted.

### I. Admin/current-effective quota drift — confirmed, unresolved

`DrizzleWorklogUsageRepository.getActiveUsageWindow()` requires an enabled, temporally current ACTIVE plan, so `/usage/me` does not present a disabled plan as current quota.

Admin list/detail/group SQL still directly shows subscription/balance/template allowance without the same effective-state calculation. Expired, not-yet-effective or disabled subscriptions can therefore show nonzero fields labeled as current allowance/remaining.

Also current `user_type = GROUP_ENABLED` really means “owns at least one ACTIVE group source,” not “has current group entitlement.” A FREE/expired owner may still be labeled GROUP_ENABLED.

Recommended:
- centralize/reuse one effective-subscription evaluator in Admin reporting;
- distinguish current-cycle values from stored/historical snapshot values;
- calculate `GROUP_ENABLED` from actual current group entitlement, or rename the factual classification to `GROUP_OWNER`;
- add compact actual related group/source IDs to the main user list as required by product spec, not counts only.

### J. Structured anomaly coverage — main LINE/Web/Admin boundaries FIXED, deduplication optional

Current behavior:
- group lifecycle/message/reply/query-entry failures write best-effort OPEN anomaly rows;
- OA lifecycle/message/reply/query-entry failures write best-effort OPEN anomaly rows;
- Admin/subscription/Worklog Web API server responses >=500 are captured at the API Worker boundary;
- unhandled exceptions escaping those route apps are captured and return a stable 500;
- normal 4xx validation/auth failures are deliberately not persisted as anomalies;
- anomaly persistence failure never recursively breaks customer handling; it falls back to console logging;
- attachment and normalization failures remain structured/durable in their own tables, which Admin already displays separately.

Remaining optional hardening:
- anomaly rows have no explicit deduplication/fingerprint, so repeated webhook or repeated 5xx failures may create repeated incident rows. Decide later whether request/category fingerprinting is worth a schema/index change.
- boundary-level 5xx captures method/path/status but not response bodies, intentionally avoiding accidental sensitive-data logging.

### K. Owner leaves group while other members can still charge Owner — PRODUCT/CONSENT DECISION REQUIRED

Current authorization requires the actor to be active but does not require the bound Owner to remain an active member. If Owner leaves while Bot/members remain, other active members can keep consuming that Owner's subscription/AI quota.

Recommended direction for user decision:
- preserve stable Owner/history;
- suspend new group record/query/provider work while Owner is absent;
- resume on Owner rejoin or future explicit transfer/rebind;
- never silently transfer ownership.

Do not implement until approved.

### L. Admin main user list group ids — confirmed medium mismatch

Product spec asks for group id(s) where collaboration applies. Main list shows owned/member group counts but not actual IDs; detail view has group lists.

Recommended: add compact related group/source id array/summary unless product spec is intentionally revised to counts-only.

### M. PWA editing capability scope — product decision required

Admin copy says `pwaEditing` means Web/PWA work-record editing, but Web routes also expose customer/project/finance CRUD. Current capability is not enforced on any of those mutations.

Need explicit scope before server-side enforcement.

### N. Export capability is currently a dormant switch

Admin can configure `export`, but no export endpoint/UI was found. Either implement later or present it as future/unavailable; do not imply the switch currently controls an existing feature.

### O. LINE general-file support wording vs implementation — documentation/product ambiguity

LINE content policy says supported files may include examples such as DOCX/XLSX “when practical.” Current Gemini attachment normalizer explicitly rejects Word/Excel MIME types and asks users to convert to PDF/text; current implemented file support is PDF and text-like formats.

Do not silently rewrite the product contract. Decide later whether Office parsing belongs in MVP or whether docs should explicitly mark it future-only.

### P. Low-level record-read service is membership-only — intentional layering, hardening recommended

The direct Web bypass is fixed at route composition, but low-level `WorklogRecordReadService` methods remain membership/source primitives. Rename/document them as low-level methods or move entitlement composition higher so future routes do not accidentally bypass paid entitlement.

### Q. Migration history reconciliation — operational production blocker

Docs reflect the consolidated `0000`, but actual target DB migration history still needs inspection, one-time reconciliation design and proof on a disposable clone before production deploy helper is allowed to migrate automatically.

## Other verified good contracts

- Ordinary GROUP text is bounded-cache-only and is not a permanent record without explicit trigger.
- Ordinary private OA support text is not cached.
- LINE attachment binaries are not persisted.
- Cache-missed old quoted TEXT still gets explicit re-entry guidance; media capability gating does not destroy this classification.
- Group Owner cannot be silently overwritten by another claim.
- Group member recording disable occurs before new group record/provider work.
- Expired persisted `status='ACTIVE'` does not grant collaboration entitlement through collaboration service.
- Consolidated DB baseline includes important quota/project consistency guards.
- Admin presentation preserves raw enum/code values and adds translated labels separately.
- Group Web one-time entry verifies nonce/current membership; downstream group APIs enforce current paid entitlement on each protected operation.

## Static validation performed in latest audit batch

Read before work:
- `WORKLOG_PRODUCT_SPEC.md`
- `WORKLOG_DEVELOPMENT_POLICY.md`
- `WORKLOG_REBUILD_PROGRESS.md`
- `WORKLOG_LINE_CONTENT_POLICY.md`
- `WORKLOG_DEPLOYMENT.md`

Source areas audited this batch:
- private OA runtime/wiring re-read to avoid premature FREE-dependent capability changes;
- Admin current quota/group classification SQL re-read;
- Gemini attachment `usageMetadata` and provider-cost path;
- shared AI pricing snapshot helper;
- Gemini text usage accounting, revealing missing thinking-token accounting;
- Worker-level Admin/subscription/Worklog Web API error boundary.

External API facts re-verified against current Google Gemini API documentation during this batch:
- `usageMetadata.promptTokenCount` is total prompt usage;
- `promptTokensDetails[]` reports per-modality token subsets with TEXT/IMAGE/VIDEO/AUDIO/DOCUMENT modalities;
- `usageMetadata.thoughtsTokenCount` is a separate field;
- current Gemini pricing charges output including thinking tokens;
- Gemini 3 uses dynamic thinking unless controlled and supports `thinkingConfig`/`thinkingLevel`.

Completed code changes:
- corrected historical multimodal cost calculation so AUDIO/IMAGE subsets are not added on top of the same total prompt token count;
- added null-media-price fallback to ordinary input price;
- Gemini attachment normalizer now parses real `promptTokensDetails` instead of copying total input into media fields;
- added regression tests for image modality split, missing detail fallback, impossible modality totals, one-time pricing and null price fallback;
- added API Worker 5xx/unhandled anomaly boundary for Admin, subscription and Worklog Web APIs while excluding ordinary 4xx.

Tests/status:
- Tests were authored/updated but **not executed**.
- No typecheck, build, schema check, migration, browser smoke, Worker smoke, LINE E2E or Gemini E2E was run in this batch.
- **GitHub Actions were not run, dispatched, rerun, enabled or modified.** Commits use `[skip ci]`.

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
11. real Gemini text/image/audio/PDF usage/cost snapshots including prompt modality details and thinking-token accounting;
12. capability downgrade/disable cases, maxGroupCount, subscription expiry and anomaly persistence failure cases.

## Current planning estimate

Planning estimate only; not test results:

- MVP non-provider feature implementation: **about 95–96%**.
- Static architecture/logic audit coverage: **about 94–96%**.
- Production readiness including still-unrun executable validation, AI-thinking accounting, migration and provider gaps: **about 81–84%**.
- Remaining internal static/code work before concentrated validation: roughly **2–3 large batches / about 3–7 focused hours**.
- After concentrated validation starts, reserve roughly **2–8 focused hours** for ordinary compile/schema/browser/runtime fixes; deeper migration or AI-accounting defects could extend this.
- External/provider work is separate: payment provider selection, recurring authorization/webhooks, production secrets/domains/LINE configuration and production migration-history reconciliation.

## Next batch

Continue from, in order:

1. fix/audit Admin effective subscription/quota presentation, `GROUP_ENABLED` semantics and actual group-id list output;
2. resolve Gemini thinking-token accounting and model-compatible thinking/temperature/reservation policy before final AI quotas;
3. design the private OA entitlement/capability boundary without prematurely choosing FREE virtual-vs-durable semantics;
4. continue billing-type/renewal scaffolding only where migration/default/provider decisions are not being guessed;
5. revisit Office-file support wording versus actual MVP implementation;
6. harden low-level record-read layering naming/documentation if useful.

Do not use GitHub Actions as validation.
