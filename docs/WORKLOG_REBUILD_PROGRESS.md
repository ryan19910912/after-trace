# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

## Stable product contract

- LINE is the fast AI-assisted capture surface; Web/PWA is the durable work-record surface.
- FREE = NT$0, `ONE_TIME`, 500 AI units once, no calendar expiry/no refresh, personal-only for LINE AI group collaboration.
- PRO = NT$99/month, `MONTHLY`, 500 included AI units per confirmed successful renewal.
- TEAM = NT$299/month, `MONTHLY`, 2500 included AI units per confirmed successful renewal.
- **Paid plans no longer limit maximum group count.** AI allowance already bounds variable provider cost; users may distribute that allowance across any number of groups.
- `maxGroupCount` is obsolete product logic and must be removed from capability schema/Admin/runtime/tests/docs.
- Monthly included AI allowance does not roll over; next included allowance exists only after successful recurring payment.
- Users may additionally buy **one-time AI top-up packs**. Top-up units are not subscriptions, do not auto-refresh, and do not disappear at monthly renewal.
- Recommended AI spend order: current included plan allowance first, then purchased top-up balance.
- PWA manual read/create/edit is a baseline free function and consumes no AI allowance unless an explicit AI action is invoked.
- Private PWA scope: only the owning user may read/create/edit.
- Group PWA scope: active group members may read/create/edit collaboratively even when Owner is absent or paid subscription is expired, because manual actions do not create AI/provider cost.
- Owner presence + current paid group entitlement + AI allowance are required for new LINE AI-assisted group recording/provider spend, not for historical/manual PWA work.
- Successful LINE AI recording must return the actual saved/normalized result plus a durable PWA deep link containing the record id.
- Record deep links are normal authenticated routes, not short-lived capability URLs; LINE Login/session + API authorization protect access.
- Owner absence suspends LINE AI-assisted group recording. An active member may run `@AFTERTRACE 啟用` to rebind only while old Owner is absent.
- Export is MVP; CSV first is acceptable and server-authorized.
- XLSX/DOCX are MVP input targets; prefer verified Google provider-native Files/File Search ingestion before building custom Office parsing.
- Dev/prod DBs are prelaunch/disposable and may be rebuilt.
- GitHub Actions must not run unless user explicitly asks.

## Implemented / fixed

- Worklog-only OA/group runtime, Web session/auth, Web/Admin Workers, PostgreSQL/Drizzle foundations.
- Explicit Owner binding because LINE Bot join cannot reliably identify inviter.
- Owner-presence authorization and absent-Owner rebind flow implemented in current LINE collaboration path.
- Current code still contains `maxGroupCount` capability/runtime enforcement from the older contract; this is now obsolete and must be removed rather than extended.
- Group `aiTextRecording=false` saves raw text but skips Gemini.
- Group `aiMediaIngestion=false` blocks provider/quota work for real media without breaking Reply-TEXT guidance.
- Structured anomalies for main LINE OA/group and Web/Admin 5xx boundaries.
- Gemini modality double-count fixed.
- Provider-success over-reservation and EXPIRED settlement preserve real cost.
- Attachment source-loss after provider success preserves/settles usage without replaying Gemini.
- Gemini 3.x thinking accounting exists in current approved provider path; executable validation pending.
- `pwaEditing` was removed from Admin plan capability definitions.
- Product/development/deployment docs reflect rebuildable prelaunch DBs.

## Newly superseded code/contracts

### A. `maxGroupCount` must be removed

Current code still:

- defines `maxGroupCount` in Admin capabilities;
- parses/enforces it in collaboration entitlement;
- computes stable owner-group ordinal;
- exposes group-limit error copy/tests;
- may use it in Web entitlement filtering.

New rule:

- paid group collaboration is an on/off entitlement only;
- no numeric group limit for PRO/TEAM;
- any number of groups may consume the same Owner AI balance;
- remove `GROUP_LIMIT_REACHED` and related plan UI/capability fields unless another non-AI resource limit is introduced later.

### B. Historical/manual group access must remain separate from LINE AI entitlement

Current `GET /records/group/:sourceId` and `/surfaces` still use stronger collaboration entitlement in places.

Required:

- historical/manual PWA read: authenticated active group membership + active source;
- manual PWA create/edit: authenticated active group membership + active source;
- no Owner presence, paid subscription, group-count or AI-quota checks for manual PWA operations;
- LINE AI-assisted create/provider path keeps stronger Owner/paid/quota gates.

### C. Generic record edit/create routes need collaborative source authorization

Current `PATCH /records/:id` is still owner/workspace-centric.

Required:

- resolve record/source first;
- PRIVATE -> owner only;
- GROUP -> active member may edit;
- add manual create API targeting private/group source with same authorization;
- manual create/edit consumes zero AI units;
- preserve actor/editor identity, timestamps and original input history.

## High-priority implementation gaps

### 1. Remove max-group entitlement everywhere

Remove:

- `maxGroupCount` capability definition/defaults;
- Admin controls and customer copy;
- group ordinal SQL/calculation;
- `GROUP_LIMIT_REACHED` authorization status/copy/tests;
- plan defaults that contain max group counts.

Keep `groupCollaboration` as the paid LINE group AI-assisted feature gate.

### 2. PWA manual record create + collaborative edit

Implement baseline free manual workflow:

- create record button in PWA;
- private source manual create by owner;
- group source manual create by active member;
- manual create/edit remains usable after AI quota exhaustion or subscription expiry;
- no Gemini call/no quota reservation unless user explicitly selects an AI-assisted action.

### 3. LINE result reply + durable exact-record deep link

Current success replies still need:

- actual normalized/saved content;
- durable `/records/<recordId>` PWA link;
- login redirect back to requested record;
- truthful raw-saved message if AI disabled/deferred/failed.

### 4. AI top-up domain

Need a first-class add-on/grant model separate from subscription plan periods.

Recommended domain:

- top-up product definition: code/display name/price/AI units/enabled/rank;
- top-up purchase/payment event with idempotent provider reference;
- durable top-up grant/balance ledger;
- aggregate available AI = eligible current plan-period balance + unspent top-up balance;
- deterministic consumption order: plan period first, then oldest eligible top-up grant;
- monthly renewal replaces only the plan-period bucket and must not erase top-up balance;
- Admin can inspect purchased/granted/used/remaining top-up units.

Top-up pack sizes/prices are still a product/pricing decision and should wait for real Gemini cost measurement.

### 5. Billing type + durable FREE/default plans

Now safe to implement because DBs may be rebuilt:

- `billing_type: ONE_TIME | MONTHLY`;
- seed/default FREE/PRO/TEAM without max-group count;
- durable FREE entitlement/quota idempotently on onboarding;
- FREE period has no calendar expiry;
- Admin/Web billing cadence display;
- `assignPlan()` billing-type aware.

### 6. Private OA entitlement

For new LINE AI-assisted private work:

- `privateOaRecording`;
- `aiTextRecording=false`: save raw text, skip Gemini;
- `aiMediaIngestion=false`: reject media before quota/provider;
- historical/manual private PWA access remains available.

### 7. Monthly renewal/provider lifecycle

Need idempotent renewal success/failure/cancellation and provider recurring authorization/webhooks. Monthly renewal refreshes only included plan-period allowance; top-up balance remains untouched.

### 8. Admin effective quota + top-up facts

Admin should show:

- current included plan allowance/used/remaining;
- purchased top-up granted/used/remaining;
- aggregate spendable AI balance;
- subscription effective state;
- Owner presence in group detail;
- related group/source IDs;
- no max-group count fields.

### 9. Admin AI pricing editor

Fix nullable independent audio/image prices and approved Gemini model copy.

### 10. Export MVP

Server-authorized CSV export:

- private owner scope;
- active group-member historical/manual scope;
- `export=true` remains paid capability unless later changed;
- no cross-source leakage.

### 11. XLSX / DOCX provider-native path verification

Current direct inline provider rejects Office MIME types. Prototype supported Files/File Search upload/import with representative XLSX/DOCX first. Enforce file-size and MIME allowlist. Build custom extraction only if provider-native flow fails the LINE use case.

### 12. AI/provider hardening

Still validate/harden provider-success DB-outage edge, committed-payload mismatch, real thinking/modality usage, concurrency/expiry/overage.

## LINE manual-entry product decision still open

PWA manual create/edit is decided and required.

Whether LINE itself should also support a separate **non-AI manual mode** is intentionally not fixed yet. Current recommendation is to avoid a second complex LINE CRUD grammar in MVP and keep LINE optimized for fast AI capture while PWA handles structured manual CRUD. Revisit only if user testing shows strong demand for LINE-only manual operation.

## Migration/deployment status

Both dev/prod databases are prelaunch and may be rebuilt. Rebuild from current repo migrations as schema changes land; once real production data exists, switch immediately to forward-only migrations.

## Validation status

Recent tests are authored but not executed. Concentrated typecheck/test/build/schema/browser/Worker/LINE/Gemini validation remains pending.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Planning estimates only:

- MVP non-payment-provider implementation: about **94–96%** after adding manual-create/top-up scope and removing obsolete group-limit work.
- Static architecture/logic audit: about **98–99%**.
- Production readiness including unrun validation/provider integration: about **83–86%**.
- Remaining internal development before concentrated validation: roughly **3 large batches / about 7–14 focused hours** because top-up ledger, PWA manual create, entitlement cleanup and billing/FREE work are substantive.
- After concentrated validation begins, reserve **2–8 focused hours** for ordinary fixes.
- External recurring/top-up payment-provider integration remains separate and likely **1–3 working days after provider selection**, depending on provider sandbox/webhook complexity.

## Next batch

1. remove `maxGroupCount` / `GROUP_LIMIT_REACHED` end-to-end;
2. split historical/manual group authorization from LINE AI entitlement;
3. implement PWA manual create + collaborative group edit/private owner edit;
4. implement billing type + durable FREE + FREE/PRO/TEAM defaults;
5. design/implement AI top-up grant/balance ledger;
6. implement LINE success summary + durable record deep link;
7. fix Admin quota/media pricing and add top-up visibility;
8. implement CSV export;
9. verify provider-native XLSX/DOCX;
10. finish AI hardening and enter concentrated local validation.

Do not use GitHub Actions as validation.
