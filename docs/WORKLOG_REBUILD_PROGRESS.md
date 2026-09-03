# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

## Stable product contract

- LINE records; Web/PWA browses, corrects, organizes and exports.
- Current AI target: stable `gemini-3.5-flash`; Gemini 2.5 compatibility is not MVP work.
- FREE = NT$0, `ONE_TIME`, 500 AI units once, no calendar expiry/no refresh, personal-only.
- PRO = NT$99/month, `MONTHLY`, 500 units per confirmed successful renewal, max 3 groups.
- TEAM = NT$299/month, `MONTHLY`, 2500 units per confirmed successful renewal, max 20 groups.
- Monthly unused quota does not roll over; next quota exists only after successful recurring payment.
- Record editing is baseline for every plan. `pwaEditing` is removed from plan capabilities.
- Private records: only owning private user may view/edit.
- Group records: currently authorized members of that group may collaboratively view/edit.
- Successful LINE record flow must show what AFTERTRACE actually saved/AI-normalized and include a short-lived scoped PWA edit link for the exact record.
- Owner must remain active in group; absence suspends group use. Active member may run `@AFTERTRACE 啟用` to rebind only while old Owner is absent.
- Successful rebind remains authoritative; if no rebind occurs and original Owner returns, original binding resumes.
- Export is MVP; CSV first is acceptable and must be capability/server-authorized.
- XLSX and DOCX are MVP input targets; implement bounded extraction before Gemini.
- Dev and prod DBs are prelaunch/disposable and may be rebuilt. Legacy migration-history reconciliation is no longer a blocker while no real data exists.
- GitHub Actions must not run unless the user explicitly asks.

## Implemented / fixed

- Worklog-only OA/group runtime, secure Web entry/session, Web/Admin Workers, PostgreSQL/Drizzle foundations.
- Explicit Owner binding because LINE Bot join cannot reliably identify inviter.
- Owner-presence authorization and absent-Owner rebind flow implemented.
- FREE personal-only, `groupCollaboration`, `maxGroupCount`, stable group ordinal and fail-closed legacy limits.
- Web group entitlement bypass fixed; LINE/Web share current group entitlement checks.
- Group `aiTextRecording=false` saves raw text but skips Gemini.
- Group `aiMediaIngestion=false` blocks provider/quota work for real media without breaking old Reply-TEXT guidance.
- Structured anomalies for main LINE OA/group and Web/Admin 5xx boundaries.
- Gemini modality double-count fixed.
- Provider-success over-reservation and EXPIRED settlement now preserve real cost.
- Attachment source-loss after provider success preserves/settles usage without replaying Gemini.
- Gemini 3.5 TEXT/attachment request paths use Gemini-3 thinking controls and account `thoughtsTokenCount`; executable validation still pending.
- Admin capability definitions no longer expose `pwaEditing`.
- Product/development/deployment docs now reflect baseline editing and rebuildable prelaunch DBs.

## High-priority implementation gaps

### 1. LINE result reply + exact-record edit link

Current LINE success replies still need the new contract:

- return actual normalized/saved content, not only generic `已記錄`;
- generate short-lived scoped Web entry to exact record edit view;
- group link authorizes current group member;
- private link authorizes only owning user;
- AI disabled/deferred/failed but raw record saved -> state that truthfully and still provide edit link.

Likely requires normalization readback/result payload plus record-target entry token/route rather than only current query-page URLs.

### 2. Record-edit authorization/audit re-audit

All plans can edit authorized records.

Verify/enforce:

- private owner only;
- currently authorized group members may collaboratively edit group records;
- preserve original input/reference;
- retain editor identity/edit timestamp/audit log where supported;
- no old `pwaEditing` checks or customer-facing capability copy remain.

### 3. Billing type + durable FREE/default plans

Now safe to implement because DBs may be rebuilt:

- add `billing_type: ONE_TIME | MONTHLY`;
- seed/default FREE / PRO / TEAM;
- create durable FREE entitlement/quota idempotently on eligible OA onboarding;
- FREE period does not expire by calendar;
- `assignPlan()` becomes billing-type aware;
- Admin exposes billing type;
- Web shows one-time versus `/月` correctly.

### 4. Private OA entitlement

FREE semantics are now final, so centralize effective entitlement and enforce:

- `privateOaRecording` for new private records;
- private `aiTextRecording=false`: save raw text, skip Gemini;
- private `aiMediaIngestion=false`: reject media before quota/provider;
- historical read remains available.

### 5. Monthly renewal/provider lifecycle

Still needs provider-neutral domain plus provider-specific integration later:

- idempotent renewal success transition;
- exactly one new period/quota snapshot per confirmed success;
- failure -> no new quota / PAST_DUE-style state;
- cancellation semantics;
- recurring authorization/webhooks after provider selection.

### 6. Admin effective quota/group facts

Fix Admin to show current effective subscription state rather than stale template/balance values:

- enabled/ACTIVE/effective/start/end checks;
- Owner presence/status in group detail;
- correct `GROUP_ENABLED` meaning or factual rename;
- actual compact related group/source IDs;
- current effective quota versus historical snapshots.

### 7. Admin AI pricing editor

Backend supports nullable audio/image prices; Admin can still overwrite them with ordinary input price.

Fix:
- independent optional audio/image fields;
- null = fallback to ordinary input price;
- current model constrained/defaulted to `gemini-3.5-flash`;
- copy reflects thinking/output and modality pricing.

### 8. Export MVP

Implement source-scoped, server-authorized CSV export:

- private: owner only;
- group: currently authorized group members;
- `export=true` required;
- useful raw/normalized/category/customer/project/time fields;
- no cross-source leakage.

### 9. XLSX / DOCX extraction

Current direct attachment provider still rejects Office MIME types.

Priority recommendation for engineering workflows:

- **XLSX first**: material lists, estimates, quantities, schedules, cost/progress sheets are common and highly useful.
- **DOCX second**: useful for reports/spec notes, but generally lower frequency than Excel/PDF/image/audio in field workflows.

Implement bounded Worker-safe extraction:

- compressed/uncompressed size and ZIP-entry limits;
- XLSX sheet/row/cell/extracted-text caps;
- DOCX paragraph/table/extracted-text caps;
- no raw Office binary persistence;
- extracted text enters existing FILE normalization flow.

### 10. AI/provider hardening

Core settlement is fixed; still validate/harden:

- provider succeeds but first durable usage snapshot cannot be written during DB outage;
- already-COMMITTED retry payload mismatch guard;
- real Gemini 3.5 thinking/modality usage versus reservation and pricing;
- concurrency/expiry/overage tests.

## Migration/deployment status

Old migration-history reconciliation concern is closed for prelaunch because both dev/prod may be rebuilt.

Current rule:

- rebuild environments from current repository journal/baseline as schema work lands;
- do not add legacy compatibility code for disposable DBs;
- before launch do one final clean rebuild plus schema/migration validation;
- once real production data exists, switch to forward-only migrations immediately.

## Validation status

Recent tests are **authored but not executed**.

Still not run in concentrated phase:

- typecheck
- tests
- build
- schema/fresh migration
- Web/Admin browser smoke
- Worker local smoke
- LINE E2E
- Gemini 3.5 E2E including Office once implemented

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Planning estimates only:

- MVP non-payment-provider implementation: **about 95–97%**.
- Static architecture/logic audit: **about 98–99%**.
- Production readiness including unrun validation/provider integration: **about 84–87%**.
- Remaining internal development before concentrated validation: roughly **2–3 large batches / about 5–10 focused hours** because LINE result/edit-link, billing/FREE, export and Office extraction remain real implementation.
- After concentrated validation begins, reserve **2–8 focused hours** for compile/schema/browser/runtime fixes.
- External payment-provider recurring integration remains separate and likely **1–3 working days after provider selection**, depending on sandbox/webhook complexity.

## Next batch

1. implement billing type + durable FREE + FREE/PRO/TEAM defaults now that DBs are rebuildable;
2. implement private OA entitlement gates;
3. implement LINE success summary + exact-record scoped edit link for group/private flows;
4. re-audit record edit authorization/audit;
5. fix Admin effective quota/group facts and media pricing;
6. implement CSV export;
7. implement XLSX extraction first, then DOCX;
8. finish AI settlement hardening and enter concentrated local validation.

Do not use GitHub Actions as validation.
