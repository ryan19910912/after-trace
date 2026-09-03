# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

This file is the current-state handoff. Git history preserves older implementation history; stale assumptions must not be kept here merely for chronology.

## Stable product contract

- LINE records; Web/PWA browses/manages.
- FREE / PRO / TEAM are the initial launch defaults.
- FREE: NT$0, `ONE_TIME`, 500 AI units once, no calendar expiry, no refresh, personal-only.
- PRO: NT$99/month, `MONTHLY`, 500 AI units on each confirmed successful renewal, max 3 groups.
- TEAM: NT$299/month, `MONTHLY`, 2500 AI units on each confirmed successful renewal, max 20 groups.
- Paid monthly unused allowance does not roll over. A new allowance snapshot is created only after successful recurring payment/renewal.
- Current AI target is stable `gemini-3.5-flash`; Gemini 2.5 compatibility is not an MVP requirement.
- Group ownership is explicitly claimed with `@AFTERTRACE 啟用` because LINE Bot join does not reliably identify the inviter.
- The bound group Owner must remain an active LINE group member. If Owner leaves, group query/record/provider use is suspended before quota/provider work.
- While Owner is absent, an active member may run `@AFTERTRACE 啟用` to take over Owner/billing responsibility. A still-active Owner cannot be overwritten.
- After takeover, the old Owner returning later does not reclaim ownership automatically. If no takeover happened, the original Owner rejoining restores use under the original binding.
- `groupCollaboration` is the group on/off gate; `maxGroupCount` is enforced for LINE/Web group read/query/recording.
- Export is an MVP feature; start with capability-gated, source-scoped CSV unless a stronger format is justified.
- DOCX and XLSX are MVP input targets, but they require a bounded Office extraction/conversion layer before Gemini. Current raw Office input is still unsupported until that layer lands.
- `pwaEditing` means editing an existing Worklog record through PWA; customer/project/finance CRUD are separate operations unless later explicitly included.
- Product/subscription decisions agreed with the user must be persisted into durable docs in the same development batch.

## Implemented core surface

- Worklog users/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Worklog-only group/OA webhook runtime; retired Memory/Energy/conversation/commerce/reminder runtime removed from active paths.
- Stable group owner binding and member recording controls.
- GROUP authorization checks active source/member, current Owner presence, current enabled paid plan, temporal validity, `groupCollaboration`, explicit numeric `maxGroupCount`, and stable owned-group ordinal.
- Owner absence now fails authorization with `OWNER_ABSENT` before quota/provider work.
- Explicit group claim can replace an absent Owner but not an Owner who is still active in the group.
- LINE user-facing suspended-owner copy tells the responsible member to run `@AFTERTRACE 啟用`.
- Missing/malformed `maxGroupCount` on a group-enabled plan fails closed rather than granting unlimited groups.
- Web `/surfaces` and `/records/group/:sourceId` use the same current group entitlement boundary, preventing expired/no-capability/over-limit Web read bypass.
- Group raw TEXT persists when `aiTextRecording=false`; AI normalization is skipped rather than blocking the base record.
- Group quoted media honors `aiMediaIngestion`; real media is rejected before quota/Gemini while old quoted TEXT classification remains intact.
- Raw TEXT persistence/idempotency; bounded GROUP quoted-TEXT PostgreSQL cache; direct LINE attachment fetch with no binary persistence.
- Durable Gemini TEXT normalization and attachment ingestion with quota reservation/settlement and provider-price snapshots.
- Current Gemini TEXT and attachment providers now validate exact model `gemini-3.5-flash`, use Gemini 3.5 `thinkingConfig.thinkingLevel = low`, remove the old `temperature: 0.1` override, and fold `thoughtsTokenCount` into billed output-token usage so thinking is included in provider cost/quota without a schema migration.
- Gemini attachment usage reads `promptTokensDetails`; AUDIO/IMAGE token subsets are priced exactly once, with null media-specific prices falling back to normal input price.
- AI reservation is preflight only after provider success: actual usage may settle above the held estimate; `EXPIRED` reservation settlement is recoverable without double-decrement; duplicate COMMITTED settlement is idempotent.
- Attachment source-loss after Gemini success preserves usage/reservation first, settles real provider cost, then terminalizes the source-loss failure without re-calling Gemini.
- GROUP/PRIVATE one-time Web entry and ordinary LINE Login; no LIFF.
- PWA personal/group browsing, owner usage/member controls, customer/project CRUD, record organization, finance and feedback.
- Admin username/password + HMAC session, users/groups/plans/quota/AI runtime/feedback/anomaly/audit views.
- LINE group/OA lifecycle/message/reply/query-entry failures have best-effort writers into `worklog_anomaly_events`.
- API Worker records best-effort anomalies for Admin/subscription/Worklog Web API responses >=500 plus unhandled boundary exceptions; expected 4xx failures are not operational incidents.
- Provider-neutral checkout-intent boundary exists, but payment provider/recurring renewal is not connected.

## Latest batch changes

Completed in the latest interactive batch:

1. Product/development docs finalized:
   - Gemini 3.5 Flash only for MVP;
   - FREE one-time 500-unit entitlement;
   - PRO/TEAM monthly defaults;
   - Owner absent suspension/rebind semantics;
   - export is MVP;
   - DOCX/XLSX are MVP input targets;
   - `pwaEditing` scope clarified as existing-work-record editing.

2. Group Owner lifecycle code:
   - collaboration context now includes `ownerIsActiveMember`;
   - read/record authorization rejects `OWNER_ABSENT` before quota/provider work;
   - Drizzle authorization query resolves current Owner member presence;
   - explicit `@AFTERTRACE 啟用` can rebind only when the previous Owner is absent;
   - claimant becomes workspace/subscription Owner for the group after rebind;
   - if old Owner later returns after rebind, no automatic ownership rollback occurs;
   - if no rebind occurred, old Owner rejoining makes the existing Owner member active and authorization resumes.

3. Gemini 3.5 runtime alignment:
   - TEXT provider uses exact `gemini-3.5-flash` and low thinking;
   - attachment provider uses exact `gemini-3.5-flash` and low thinking;
   - both read `thoughtsTokenCount` and fold it into billed output usage;
   - both removed legacy low-temperature override;
   - reservation estimates include an extra output-sized thinking cushion while exact settlement remains authoritative.

4. Tests authored/updated:
   - collaboration base context includes Owner presence;
   - Owner-absent read and record rejection cases added.
   - These tests were **not executed**.

5. Office support remains truthful:
   - Word/Excel are documented as MVP targets;
   - current provider still returns unsupported until an extraction layer is implemented;
   - LINE error copy says Office support is still being implemented instead of falsely claiming current support.

## Current migration/deployment reality

The repository is migration-squashed:

- `drizzle/meta/_journal.json` contains only `0000_worklog_baseline`.
- `drizzle/0000_worklog_baseline.sql` is the consolidated current Worklog baseline.
- Existing target DBs may have older multi-migration Drizzle history while this branch has one consolidated baseline.
- `worker-deploy.ps1` automatically executes `db:deploy:migrate`.
- Production migrate is not proven safe until target migration history/schema are inspected and a reconciliation strategy is tested on a disposable clone.

This is still a production blocker for any new billing-type/schema migration.

## Remaining consistency / implementation queue

### A. Billing type + durable FREE entitlement — high priority

Product decision is now final but code is not aligned:

- plan schema/API/Admin/Web still have no dedicated `billing_type`;
- OA bootstrap still creates user/workspace/private source without a durable FREE subscription/quota row;
- some UI/reporting paths display virtual FREE while entitlement service can return `NO_SUBSCRIPTION`;
- `assignPlan()` still defaults unspecified period end to +1 month, which is wrong for FREE `ONE_TIME`.

Required after migration-history strategy is safe:
- add `ONE_TIME | MONTHLY` billing type;
- seed/normalize FREE, PRO, TEAM defaults;
- create durable FREE one-time entitlement/quota on onboarding or an idempotent first-entitlement path;
- FREE period end should be null / non-calendar-expiring while allowance remains;
- paid monthly period end follows actual successful billing period;
- thread billing type through Admin/PWA plan presentation.

### B. Monthly renewal / recurring provider lifecycle — unresolved external/domain work

Need:
- recurring authorization/token/mandate from selected provider;
- idempotent renewal event ledger;
- successful renewal creates next period + fresh quota snapshot;
- failed renewal creates no new paid quota and moves to selected failure/retry state;
- cancellation stops future charges without deleting history.

Payment provider remains undecided.

### C. PRIVATE capability enforcement — now unblocked conceptually, code pending

FREE semantics are now decided, so next implementation should centralize effective user entitlement and enforce:
- `privateOaRecording` for new private records;
- private `aiTextRecording`: save raw TEXT but skip Gemini when false;
- private `aiMediaIngestion`: block real private media before quota/provider when false.

Historical read access should remain available when write/AI capability is disabled.

### D. Admin effective subscription/quota reporting — unresolved

Admin users/groups/details still directly show stored balance/template allowance in places where runtime would consider the subscription expired, not-yet-effective, disabled, or otherwise invalid.

Need:
- return server-computed effective state facts;
- remove optimistic client fallback to ACTIVE;
- distinguish current effective quota from historical stored snapshot;
- make `GROUP_ENABLED` mean true current entitlement or rename it to factual `GROUP_OWNER`;
- show compact actual related group/source ids;
- expose whether Owner is currently an active member.

### E. Admin AI pricing editor — unresolved destructive mismatch

Backend supports independent audio/image prices, but Admin currently only exposes input/output and overwrites both media prices with ordinary input on save.

Need:
- optional audio and image price inputs;
- null means fallback to ordinary input price;
- default/restrict model to `gemini-3.5-flash` while this is the only supported runtime target;
- explanatory copy aligned with modality-specific pricing.

### F. Export MVP — unresolved

Implement a server-side capability-gated CSV export and PWA entry point. Export must reuse the same private/group/source authorization as record browsing and must not leak records from inaccessible groups.

### G. DOCX/XLSX MVP extraction — unresolved, medium complexity

Current direct Gemini attachment path still rejects Office MIME types.

Recommended implementation:
- Worker-compatible ZIP/XML extraction, preferably a small audited dependency or bounded parser rather than a heavyweight Node-only Office library;
- DOCX: extract paragraphs and table text;
- XLSX: extract workbook/sheet names, shared strings and bounded cell/table values;
- enforce archive size, uncompressed size, entry count, sheet count, rows/cells and extracted-text caps;
- pass extracted bounded text into the existing FILE normalization path;
- no raw Office binary persistence.

Difficulty: moderate, not conceptually hard; the main work is safe ZIP/XML parsing under Cloudflare Worker runtime/resource limits and regression coverage.

### H. PWA editing capability — partially specified, not enforced

Current product meaning: controls editing an existing work record through PWA. Do not automatically apply it to customer/project/finance CRUD.

Need to enumerate the exact existing record mutation endpoints/fields and enforce capability server-side before re-advertising this benefit.

### I. AI/provider hardening still pending

Thinking accounting is now captured using existing output token fields, but still validate with real Gemini 3.5 responses.

Remaining edge:
- provider succeeds but no durable usage snapshot can be written at all due infrastructure failure; do not replay Gemini automatically;
- optional hardening: verify a repeated COMMITTED settlement payload is compatible with durable committed units rather than accepting any divergent retry payload.

### J. Low-level entitlement layering

Direct Web group bypass is fixed, but low-level record-read services remain membership/source primitives. Document/rename them or centralize entitlement composition so future endpoints cannot accidentally bypass paid entitlement.

### K. Production migration-history reconciliation — production blocker

Before schema changes/deploy:
- inspect actual target Drizzle migration history and schema;
- design one-time reconciliation with consolidated `0000`;
- prove on disposable clone;
- only then add/apply billing-type migration safely.

## Validation status

Static review only for this latest batch.

Not executed:
- `pnpm typecheck`
- `pnpm test`
- build
- schema check
- migration
- browser smoke
- Worker smoke
- LINE E2E
- Gemini E2E

Tests changed in source are **authored but not executed**.

**GitHub Actions were not run, dispatched, rerun, enabled, or modified during this batch.** Commits use `[skip ci]` where applicable.

## Planning estimate

Planning estimates only, not validation results:

- MVP non-payment implementation: about **96–97%**.
- Static architecture/logic audit: about **98–99%**.
- Production readiness including deferred executable validation/external billing: about **83–86%**.
- Remaining internal large development batches before concentrated validation: about **2–3**.
- Expected focused internal implementation time before validation: roughly **4–8 hours**.
- After concentrated local validation starts, reserve roughly **2–8 additional hours** for failure-driven fixes if issues are ordinary compile/schema/browser/runtime defects.
- Payment-provider recurring integration is separate and likely **1–3 working days after provider selection**, depending on provider sandbox/webhook complexity.

## Next batch

Continue from:

1. update Gemini 3.5 request/usage regression tests for thinking-level and thoughts-token accounting;
2. fix Admin AI model/media pricing editor;
3. design/implement migration-safe billing type + durable FREE entitlement once migration-history reconciliation strategy is available;
4. enforce PRIVATE capabilities through a centralized effective entitlement boundary;
5. implement CSV export MVP;
6. implement bounded DOCX/XLSX extraction;
7. audit/enforce `pwaEditing` on existing record mutations;
8. then enter concentrated local validation rather than continuing broad static audit indefinitely.
