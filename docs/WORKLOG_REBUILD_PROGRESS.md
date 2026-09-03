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
- FREE = NT$0, `ONE_TIME`, 500 AI units once, no calendar expiry/no refresh, personal-only.
- PRO = NT$99/month, `MONTHLY`, 500 units per confirmed successful renewal, max 3 groups.
- TEAM = NT$299/month, `MONTHLY`, 2500 units per confirmed successful renewal, max 20 groups.
- Monthly unused quota does not roll over; next quota exists only after successful recurring payment.
- Record editing is baseline for every plan. `pwaEditing` is removed from plan capabilities.
- Private records: only owning private user may view/edit.
- Group historical records: active group members may collaboratively view/edit even if Owner is absent, paid subscription expired, or the group is currently over `maxGroupCount`.
- Owner/subscription/group-limit entitlement is required for **new record creation and AI/provider spend**, not for historical read/manual edit.
- Successful LINE record flow must show what AFTERTRACE actually saved/AI-normalized and include a durable PWA record deep link containing the exact record id.
- Record deep links are not short-lived capability tokens; normal LINE Login/session + API authorization protects the record.
- Owner absence suspends new group recording/AI. Active member may run `@AFTERTRACE 啟用` to rebind only while old Owner is absent.
- Successful rebind remains authoritative; if no rebind occurs and original Owner returns, original binding resumes.
- Export is MVP; CSV first is acceptable and must be capability/server-authorized.
- XLSX and DOCX are MVP input targets. Prefer a verified Google provider-native file path over custom ZIP/XML parsing when possible.
- Dev and prod DBs are prelaunch/disposable and may be rebuilt. Legacy migration-history reconciliation is not a blocker while no real data exists.
- GitHub Actions must not run unless the user explicitly asks.

## Implemented / fixed

- Worklog-only OA/group runtime, secure Web session, Web/Admin Workers, PostgreSQL/Drizzle foundations.
- Explicit Owner binding because LINE Bot join cannot reliably identify inviter.
- Owner-presence authorization and absent-Owner rebind flow implemented for current collaboration authorization.
- FREE personal-only, `groupCollaboration`, `maxGroupCount`, stable group ordinal and fail-closed legacy limits.
- Group `aiTextRecording=false` saves raw text but skips Gemini.
- Group `aiMediaIngestion=false` blocks provider/quota work for real media without breaking old Reply-TEXT guidance.
- Structured anomalies for main LINE OA/group and Web/Admin 5xx boundaries.
- Gemini modality double-count fixed.
- Provider-success over-reservation and EXPIRED settlement preserve real cost.
- Attachment source-loss after provider success preserves/settles usage without replaying Gemini.
- Gemini 3.x TEXT/attachment thinking accounting is implemented in the current approved provider path; executable validation remains pending.
- Admin capability definitions no longer expose `pwaEditing`.
- Product/development/deployment docs reflect baseline editing and rebuildable prelaunch DBs.

## Newly identified contract drift after latest product decision

### Historical group access is currently over-restricted in code

Current `GET /records/group/:sourceId` and `/surfaces` still call `authorizeGroupAccess()`, which currently checks Owner presence, plan status and `maxGroupCount`. That matched the older contract but is now too strict.

Required correction:

- historical group read/surface visibility should require authenticated user + active membership + active source only;
- Owner absence must not hide existing records;
- paid subscription expiry/downgrade must not hide existing records;
- over-limit group position must not hide existing records;
- creation/AI paths continue using the stronger entitlement boundary.

### Group record editing is currently too owner/workspace-centric

Current generic `PATCH /records/:id` flows through `ownerContext()` / owned workspace, which is insufficient for collaborative group editing by ordinary group members.

Required correction:

- resolve record source first;
- PRIVATE -> only private owner may edit;
- GROUP -> any active member of that source may edit;
- group edit does not require Owner presence or paid entitlement and does not spend AI quota;
- preserve editor user id / edited timestamp / audit trail;
- customer/project associations used by a group edit must still be validated safely against the record/workspace data model.

## High-priority implementation gaps

### 1. LINE result reply + durable exact-record deep link

Current LINE success replies still need the new contract:

- return actual normalized/saved content, not only generic `已記錄`;
- append durable `https://<web>/records/<recordId>` style link;
- no one-time/short-expiry token is required merely to identify the record;
- if browser lacks session, LINE Login occurs and returns to the target record;
- API authorization, not URL secrecy, protects access;
- AI disabled/deferred/failed but raw record saved -> state that truthfully and still provide edit link.

### 2. Split historical group access from new-record entitlement

Refactor current group authorization usage so:

- read/manual edit: active group membership/source boundary;
- new record: active actor + recording permission + Owner present + valid group plan + group limit;
- AI/provider: above plus AI capability/quota.

This supersedes the earlier “LINE/Web share one paid entitlement check for group reads” rule.

### 3. Record-edit authorization/audit

All plans can edit authorized records.

Verify/enforce:

- private owner only;
- active group members may collaboratively edit group records;
- editing remains available after Owner leaves or paid plan expires;
- preserve original input/reference;
- retain editor identity/edit timestamp/audit log;
- no `pwaEditing` capability checks/copy remain.

### 4. Billing type + durable FREE/default plans

Now safe to implement because DBs may be rebuilt:

- add `billing_type: ONE_TIME | MONTHLY`;
- seed/default FREE / PRO / TEAM;
- create durable FREE entitlement/quota idempotently on eligible OA onboarding;
- FREE period does not expire by calendar;
- `assignPlan()` becomes billing-type aware;
- Admin exposes billing type;
- Web shows one-time versus `/月` correctly.

### 5. Private OA entitlement

FREE semantics are final, so centralize effective entitlement and enforce for **new** private record/AI work:

- `privateOaRecording`;
- private `aiTextRecording=false`: save raw text, skip Gemini;
- private `aiMediaIngestion=false`: reject media before quota/provider;
- historical private read/edit remains available to owner.

### 6. Monthly renewal/provider lifecycle

Need:

- idempotent renewal success transition;
- exactly one new period/quota snapshot per confirmed success;
- failure -> no new quota / PAST_DUE-style state;
- cancellation semantics;
- recurring authorization/webhooks after provider selection.

### 7. Admin effective quota/group facts

Fix Admin to show current effective subscription state rather than stale template/balance values:

- enabled/ACTIVE/effective/start/end checks;
- Owner presence/status in group detail;
- correct `GROUP_ENABLED` meaning or factual rename;
- actual compact related group/source IDs;
- current effective quota versus historical snapshots.

### 8. Admin AI pricing editor

Backend supports nullable audio/image prices; Admin can still overwrite them with ordinary input price.

Fix independent optional media fields, null fallback semantics, and current approved Gemini 3.x model copy.

### 9. Export MVP

Implement source-scoped, server-authorized CSV export:

- private: owner only;
- group: active member historical scope;
- `export=true` remains required;
- current paid group entitlement is not required merely to export history if export entitlement policy allows that user's plan/source;
- no cross-source leakage.

### 10. XLSX / DOCX provider-native path verification

Current direct `inlineData` attachment provider rejects Office MIME types.

Important distinction from Google docs:

- Gemini 3.5 Flash-Lite supports **File Search** and File Search lists DOCX/XLSX MIME types.
- Its model card lists native model inputs as text/image/video/audio/PDF, not Office binaries.
- Google guidance/forum evidence shows direct `generateContent` Office MIME may still reject DOCX; therefore “File Search supports XLSX/DOCX” is not proof that current direct inline generateContent does.

Preferred next step:

1. prototype the simplest Google-supported Files/File Search upload/import path with representative LINE DOCX/XLSX;
2. enforce file/request size + MIME allowlist;
3. verify one-shot extraction quality and latency/cost;
4. if provider-native flow works, use it and **do not** build custom Office parsing;
5. only fall back to custom extraction if required.

### 11. AI/provider hardening

Core settlement is fixed; still validate/harden:

- provider succeeds but first durable usage snapshot cannot be written during DB outage;
- already-COMMITTED retry payload mismatch guard;
- real Gemini thinking/modality usage versus reservation/pricing;
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
- Gemini E2E including Office provider-native path

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Planning estimates only:

- MVP non-payment-provider implementation: **about 95–97%**.
- Static architecture/logic audit: **about 98–99%**.
- Production readiness including unrun validation/provider integration: **about 84–87%**.
- Remaining internal development before concentrated validation: roughly **2–3 large batches / about 5–10 focused hours**.
- After concentrated validation begins, reserve **2–8 focused hours** for compile/schema/browser/runtime fixes.
- External payment-provider recurring integration remains separate and likely **1–3 working days after provider selection**, depending on sandbox/webhook complexity.

## Next batch

1. split historical group read/edit authorization from new-record/AI entitlement;
2. implement collaborative group record editing + private-owner-only edit authorization;
3. implement LINE success summary + durable record-id deep link;
4. implement billing type + durable FREE + FREE/PRO/TEAM defaults;
5. implement private OA entitlement gates;
6. fix Admin effective quota/group facts and media pricing;
7. implement CSV export;
8. verify provider-native XLSX/DOCX path before building any custom Office parser;
9. finish AI settlement hardening and enter concentrated local validation.

Do not use GitHub Actions as validation.
