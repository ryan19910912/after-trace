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
- Current LINE Bot `join` webhook does not reliably identify the inviter. Group ownership therefore uses explicit `@AFTERTRACE 啟用` binding in the current MVP; never infer Owner from the first speaker or a synthetic join `source.userId`.
- Owner binding is stable; Owner leaving does not silently transfer ownership. Conflicting manual claims do not overwrite an existing Owner.
- Group AI usage charges the stable Owner while retaining actor attribution.
- `groupCollaboration` is the group on/off gate; `maxGroupCount` is an enforced entitlement for group read/query/recording.
- Plan billing cadence is a dedicated plan property. Initial product types are `ONE_TIME` and `MONTHLY`; quarterly/yearly are future-only until actually offered.
- Paid `MONTHLY` requires provider-supported recurring-payment authorization/token/mandate. Only confirmed renewal success creates the next paid period/quota snapshot. Failed renewal creates no new paid allowance.
- Monthly unused allowance does not roll over. Historical usage/cost remains in its original period.
- Whether FREE is `ONE_TIME` or `MONTHLY` remains undecided and must not be inferred from price zero.
- Product/subscription decisions agreed in conversation must be persisted into durable docs in the same batch.

## Implemented core surface

- Worklog users/OA friendship/workspace/source/member/customer/project/record/transaction/plan/subscription/AI config/usage/feedback/anomaly/audit foundations.
- Worklog-only group/OA webhook runtime; retired Memory/Energy/conversation/commerce/reminder runtime removed from active paths.
- Stable group owner binding model and member recording permission controls.
- GROUP LINE authorization checks active source/member, stable Owner, current enabled paid plan, temporal subscription validity, `groupCollaboration`, and numeric `maxGroupCount`.
- Stable owned-group ordinal is based on active groups ordered by ownership/binding time with source-id tie break.
- Raw TEXT persistence/idempotency; bounded GROUP quoted-TEXT PostgreSQL cache; direct LINE attachment fetch with no binary persistence.
- Durable Gemini TEXT normalization and attachment ingestion with quota reservation/settlement and provider-price snapshots.
- GROUP/PRIVATE one-time Web entry and ordinary LINE Login; no LIFF.
- PWA personal/group browsing, owner usage/member controls, customer/project CRUD, record organization, finance and feedback.
- Admin username/password + HMAC session, users/groups/plans/quota/AI runtime/feedback/anomaly/audit views.
- Provider-neutral checkout-intent boundary exists, but payment provider/recurring renewal is not connected.

## Current migration/deployment reality

The repository is currently migration-squashed:

- `drizzle/meta/_journal.json` contains only `0000_worklog_baseline`.
- `drizzle/0000_worklog_baseline.sql` is a consolidated current Worklog baseline, not a historical pre-Worklog migration.
- Separate `0011`–`0014` files are not present.
- `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql` is not present.
- The consolidated baseline already includes important DB guards such as quota-cycle allowance snapshot preservation and project/customer link synchronization, and includes `oa_friend_state_at`.
- Current workspace is `apps/*`; no `packages/shared` directory/importer remains in workspace or lockfile.

Production migration risk:

- `worker-deploy.ps1` automatically executes `db:deploy:migrate`.
- Existing target DBs may have an older multi-migration Drizzle history while the branch now has one consolidated baseline.
- Do not treat production migration as safe until the target migration-history table/schema is inspected and a reconciliation strategy is tested on a disposable clone.

See `docs/WORKLOG_DEPLOYMENT.md` for the corrected deployment contract.

## Consistency audit queue

### A. Billing type missing from implementation — confirmed, unresolved

Product requires `ONE_TIME` / `MONTHLY`, but current plan schema/API/Admin/Web do not carry a billing-type field.

Recommended implementation:
- add dedicated enum/column on `worklog_subscription_plans`;
- thread through Admin input/repository/UI, subscription plan API and Web UI;
- display `一次性` / `每月` and price cadence explicitly;
- make `assignPlan` period behavior billing-type aware;
- do not add quarterly/yearly before product actually offers them.

### B. Monthly renewal/new quota period missing — confirmed, unresolved

Current `assignPlan()` defaults missing period end to `+1 calendar month`, but there is no recurring renewal workflow.

Recommended implementation:
- create idempotent renewal-domain operation;
- confirmed provider payment success advances to a new period and snapshots fresh allowance;
- payment failure does not create quota and should move state to `PAST_DUE` or later-selected retry policy;
- do not roll unused units forward.

### C. Recurring payment/provider lifecycle missing — expected external gap, unresolved

Current checkout intent is provider-neutral only. No provider token/mandate, recurring charge, webhook, renewal/cancel/failure lifecycle exists.

After provider selection:
- persist provider-approved customer/subscription/authorization references only, never raw card data;
- process provider events idempotently;
- duplicate success notifications must not create duplicate periods/quota;
- cancellation stops future renewal without erasing historical usage.

### D. Capability enforcement incomplete — confirmed, high priority

Current configurable capabilities are not consistently enforced server-side:

- `privateOaRecording`: OA runtime checks friendship, not this capability.
- `aiTextRecording`: text normalization can reserve quota/call AI without an explicit capability gate.
- `aiMediaIngestion`: attachment ingestion can fetch/call provider without an explicit capability gate.
- `pwaEditing`: customer/project/record/finance mutation routes check workspace ownership, not this capability.
- `export`: capability exists but no export API/feature was found.

Recommended implementation:
- centralize user/plan entitlement resolution;
- allow raw TEXT persistence while cleanly skipping AI normalization when AI text capability is off;
- reject media before provider work when media capability is off;
- decide exact `pwaEditing` scope before enforcing it (record edit only vs all workspace CRUD/finance mutations);
- either mark export future/unavailable or implement it; do not imply an inactive capability controls an existing feature.

### E. Web group entitlement bypass — confirmed, high priority, unresolved

`GET /records/group/:sourceId` currently checks only active group membership. `/surfaces` also lists active memberships without applying current paid/group-limit authorization.

LINE `@AFTERTRACE 查詢` is authorized before link generation, but an already-authenticated Web session can call APIs directly, so link-generation authorization is not sufficient.

Recommended implementation:
- route Web group-record reads through `WorklogCollaborationService.authorizeGroupAccess()`;
- filter `/surfaces` consistently so expired/no-capability/over-limit groups are not advertised as readable;
- map entitlement failure to stable Web error responses.

### F. Admin presentation raw enum concern — re-audited, NOT A BUG

Earlier audit text suggested server labels might overwrite raw enum/status values. Current `admin/presentation.ts` preserves the raw field and adds a separate `<field>_label`. No change required unless the UI later chooses to hide/show those fields differently.

### G. FREE identity vs actual subscription row — confirmed semantic inconsistency, unresolved

User bootstrap creates OA/workspace/private source but does not create a FREE subscription row. Some presentation/usage code falls back to display `FREE`, while entitlement service may return `NO_SUBSCRIPTION` and allowance zero.

Recommended implementation after deciding FREE cadence:
- define whether every user gets a durable FREE subscription/quota cycle automatically or whether FREE is virtual;
- then make Admin/Web/entitlement/quota behavior use one consistent model.

Do not implement until FREE `ONE_TIME` vs `MONTHLY` is decided.

### H. `maxGroupCount` missing-value semantics — confirmed risk, unresolved

`configuredGroupLimit()` currently treats missing/non-number `maxGroupCount` as `null` = unlimited. Admin defaults new plan input to zero, but legacy/imported paid plan capability JSON may omit the key.

Recommended implementation:
- migrate/normalize all group-enabled plans to explicit numeric `maxGroupCount`;
- fail closed or reject invalid group-enabled plan configuration rather than silently grant unlimited groups;
- add Admin validation tying `groupCollaboration=true` to an explicit non-negative numeric group limit.

### I. AI quota unit/accounting semantics — confirmed design gap, unresolved

TEXT and attachment quota `actualUnits` are currently input tokens + output tokens. Attachment usage also stores audio/image input fields and provider cost adds optional media-price components. Admin currently mirrors general input price into audio/image price fields, which can double-count media cost if those fields represent an additional modality charge rather than an alternative price basis.

Recommended implementation before final plan quotas/pricing:
- define one canonical quota-unit model;
- confirm Gemini/provider billing semantics for text/image/audio/PDF and map provider usage metadata once;
- make audio/image pricing optional dedicated Admin fields rather than automatically copying text input price;
- ensure provider-cost computation never charges the same units twice;
- then calculate sustainable FREE/paid allowances from measured cost.

### J. Subscription UI copy understates remaining provider work — confirmed, unresolved

Current Web subscription UI says connecting a provider later only needs wiring the checkout intent and does not require reworking subscription domain/UI. This is no longer accurate because billing type, recurring authorization, renewal/failure/cancel state and new-period quota behavior are still missing.

Recommended fix:
- update user-facing/internal placeholder copy when billing type work lands;
- keep checkout disabled until provider path is real.

### K. Migration documentation/history — corrected docs, operational blocker remains

Previous docs described `0000`–`0014` plus post-cutover `9000`, but current repo has one consolidated `0000` journal entry and no `9000` file. Deployment doc has been corrected in this audit.

Still unresolved:
- inspect actual target DB migration history;
- decide one-time reconciliation strategy;
- prove it on disposable clone before production `worker-deploy.ps1` migration step.

### L. LINE inviter auto-binding assumption — fixed in code/docs this audit

Official LINE Messaging API group source semantics state `source.userId` is only included in message events. A Bot `join` event therefore cannot identify who invited the Bot.

Fix applied:
- group join parser no longer treats `source.userId` as inviter evidence;
- group lifecycle no longer auto-binds Owner on Bot JOIN;
- explicit `@AFTERTRACE 啟用` is current MVP Owner binding path;
- synthetic regression test authored to ensure join `source.userId` is ignored even if supplied in a test payload;
- product spec corrected accordingly.

Tests authored but **not executed**.

## Other verified good contracts

- Ordinary GROUP text is bounded-cache-only and does not become permanent records without explicit trigger.
- Ordinary private OA support text is not cached.
- LINE attachment binaries are not persisted.
- Group Owner cannot silently be overwritten by another manual claim.
- Group member recording disable happens before group record authorization/provider work.
- Expired persisted `status='ACTIVE'` does not grant collaboration entitlement through the collaboration service.
- Current consolidated DB baseline contains quota-cycle snapshot preservation and project/customer synchronization triggers, so those protections were not actually lost when migrations were squashed.
- Admin presentation preserves raw values and adds separate translated labels.

## Static validation performed in latest audit batch

- Re-read product, development, content-policy, deployment and progress contracts.
- Audited LINE event parsing/group lifecycle against official LINE source semantics.
- Audited Web group record/surface authorization.
- Audited OA runtime and capability gates.
- Audited text/media AI unit/cost flow.
- Audited current Drizzle tree, journal, consolidated baseline, pnpm workspace/lockfile and production deploy migration call.
- Verified consolidated baseline contains the quota snapshot and project/customer consistency DB triggers.
- Authored/updated source and test changes for LINE join ownership behavior; tests were not executed.
- Updated product and deployment docs to remove stale assumptions.
- No typecheck/test/schema/migration/browser/Worker/LINE/Gemini execution was run.
- **GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Next audit batch

Continue from these areas rather than restarting:

1. Fix and test Web `/surfaces` + `/records/group/:sourceId` current-entitlement/maxGroup enforcement.
2. Trace private entitlement resolution end-to-end and design a central capability-check boundary for `privateOaRecording`, `aiTextRecording`, `aiMediaIngestion`.
3. Audit PWA editing routes and decide/document exact `pwaEditing` scope before code change.
4. Audit FREE bootstrap/subscription/quota lifecycle in detail; wait for user decision on FREE `ONE_TIME` vs `MONTHLY` before choosing durable model.
5. Audit Admin AI pricing fields and Gemini provider usage semantics to remove media-cost double-count risk.
6. Audit checkout tables/idempotency and design provider-neutral recurring renewal state without selecting a payment provider prematurely.
7. Inspect remaining Web auth one-time entry paths and owner/member management APIs for entitlement bypasses.
8. Keep migration-history reconciliation as a production blocker until target DB history is known.

## Planning estimate

Planning estimates, not test results:

- MVP feature implementation: **about 92–94%** after accounting for billing-type/renewal and newly confirmed capability/Web-auth gaps.
- Static architecture/logic audit: **about 80–85%**; major LINE/Web/subscription/migration surfaces have been inspected, but capability/payment/auth edge paths remain.
- Production readiness: **about 72–78%** because executable validation is still deferred, recurring billing is absent, Web group entitlement bypass remains, and production DB migration-history compatibility is unproven.
- Remaining code/static-audit work: roughly **3–5 large batches** before a clean concentrated validation pass.
- External/payment work: provider selection + recurring authorization/webhook/renewal integration is a separate batch family after provider decision.
- Estimated time to reach concentrated local validation after internal code gaps are fixed: **about 6–12 focused development hours**.
- Expected failure-driven fixes after the validation pass: **about 2–8 additional focused hours** if no deep DB/provider issue appears.
