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
- GROUP LINE authorization checks active source/member, stable Owner, current enabled paid plan, temporal subscription validity, `groupCollaboration`, explicit numeric `maxGroupCount`, and stable owned-group ordinal.
- Stable owned-group ordinal is based on ACTIVE owned groups ordered by ownership/binding time with source-id tie break.
- Missing/malformed `maxGroupCount` on a group-enabled plan now fails closed rather than granting unlimited groups.
- Web `/surfaces` and `/records/group/:sourceId` now use the same current group entitlement boundary, so expired/no-capability/over-limit groups cannot be exposed/read merely because the Web user is still an active member.
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

Current checkout intent is provider-neutral only. `worklog_checkout_intents` tracks one checkout request and has provider/checkout-id/url fields, but there is no provider recurring authorization/subscription identity, webhook-event idempotency ledger, recurring charge lifecycle, renewal-period transition, or cancellation/failure workflow.

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
- `pwaEditing`: customer/project/record/finance mutation routes check workspace ownership, not this capability. Exact intended scope still needs product confirmation; Admin copy currently describes it as Web/PWA work-record editing, while routes also expose customer/project/finance mutation.
- `export`: capability exists but no export API/feature was found.

Recommended implementation:
- centralize user/plan entitlement resolution instead of duplicating plan checks in each runtime;
- allow raw TEXT persistence while cleanly skipping AI normalization when AI text capability is off;
- reject media before LINE/provider work when media capability is off;
- decide exact `pwaEditing` scope before enforcing it (record edit only vs all workspace CRUD/finance mutations);
- either mark export future/unavailable or implement it; do not imply an inactive capability controls an existing feature.

### E. Web group entitlement bypass — FIXED IN CODE, validation pending

Previous behavior:
- `GET /records/group/:sourceId` checked only active group membership.
- `/surfaces` listed active member group surfaces without current owner subscription/capability/group-limit authorization.
- An already-authenticated Web session could therefore bypass the LINE query-link entitlement boundary.

Current behavior:
- `/records/group/:sourceId` calls `WorklogCollaborationService.authorizeGroupAccess()` before record query.
- `/surfaces` filters each group through the same access authorization.
- expired/no-capability/over-limit groups are not exposed as readable surfaces.
- Web failures retain structured status such as `GROUP_NOT_ENTITLED` / `GROUP_LIMIT_REACHED` and include plan display/limit metadata when available.

No route/typecheck/runtime test was executed in this batch; executable validation is still pending.

### F. Admin presentation raw enum concern — re-audited, NOT A BUG

`admin/presentation.ts` preserves the raw field and adds a separate `<field>_label`. No change required unless the UI later chooses to hide/show those fields differently.

### G. FREE identity vs actual subscription row — confirmed semantic inconsistency, unresolved

User bootstrap creates OA/workspace/private source but does not create a FREE subscription row. Some presentation/usage code falls back to display `FREE`, while entitlement service may return `NO_SUBSCRIPTION` and allowance zero.

Recommended implementation after deciding FREE cadence:
- define whether every user gets a durable FREE subscription/quota cycle automatically or whether FREE is virtual;
- then make Admin/Web/entitlement/quota behavior use one consistent model.

Do not implement until FREE `ONE_TIME` vs `MONTHLY` is decided.

### H. `maxGroupCount` missing-value semantics — FIXED IN RUNTIME, data validation pending

Previous behavior:
- missing/non-number `maxGroupCount` meant `null` and effectively unlimited groups.

Current behavior:
- once `groupCollaboration` is otherwise entitled, missing/malformed `maxGroupCount` fails closed as `GROUP_NOT_ENTITLED`;
- valid numeric `0` means no group can pass the ordinal check;
- focused collaboration tests were updated for explicit limit, missing-limit fail-closed and over-limit ordinal behavior, but were not executed.

Still recommended:
- normalize existing plan data so every group-enabled plan stores explicit numeric `maxGroupCount`;
- surface invalid legacy configuration clearly in Admin rather than relying only on runtime rejection.

### I. AI quota unit/accounting semantics — confirmed defect/design gap, unresolved

Current Gemini attachment code reads `usageMetadata.promptTokenCount` into `inputTokens`, then also copies that same total prompt count into `audioInputUnits` for AUDIO or `imageInputUnits` for IMAGE. Provider-cost calculation can then price ordinary input tokens plus the duplicated media units.

Gemini usage metadata semantics make this unsafe: total prompt token count already represents the whole multimodal prompt, while modality-specific counts are available separately through prompt-token details. Therefore copying the total prompt count into a media-specific field is not a real modality breakdown and can double-count cost depending on configured rates.

Recommended implementation before final plan quotas/pricing:
- define one canonical quota-unit model independent of provider billing display;
- parse provider modality token details rather than duplicating total prompt tokens into media fields;
- map each provider-billed input unit exactly once to its applicable modality price;
- make audio/image pricing optional dedicated Admin fields rather than automatically mirroring general text input price;
- verify PDF/text-file treatment separately;
- then calculate sustainable FREE/paid allowances from measured real calls.

### J. Subscription UI copy understated remaining provider work — copy FIXED, domain unresolved

The Web placeholder previously claimed that connecting a provider only required wiring checkout intent and would not require subscription domain/UI work. That was false after `ONE_TIME` / `MONTHLY` and recurring-renewal decisions.

Current placeholder now states that billing type, provider payment flow, recurring authorization, renewal success/failure, and next-period AI quota still need implementation.

Price cards still cannot show `/月` vs `/一次` until billing type exists in the data model/API.

### K. Migration documentation/history — corrected docs, operational blocker remains

Previous docs described `0000`–`0014` plus post-cutover `9000`, but current repo has one consolidated `0000` journal entry and no `9000` file. Deployment doc has been corrected.

Still unresolved:
- inspect actual target DB migration history;
- decide one-time reconciliation strategy;
- prove it on disposable clone before production `worker-deploy.ps1` migration step.

### L. LINE inviter auto-binding assumption — fixed in code/docs

Official LINE group-source behavior does not provide a reliable inviter identity on Bot JOIN. Current code ignores JOIN for owner binding and uses explicit `@AFTERTRACE 啟用`.

Focused regression coverage was authored previously but has not been executed.

### M. Owner leaves the LINE group but other members can continue charging that Owner — NEW PRODUCT/CONSENT DECISION REQUIRED

Current behavior:
- `memberLeft` marks only that member inactive; it does not deactivate the group source.
- stable `owner_user_id` remains bound by design.
- group authorization requires the **actor** to be an active member, but does not require the bound Owner to remain an active LINE group member.
- therefore if the Owner leaves while the Bot and other members stay, those members can continue creating records and consuming the departed Owner's subscription/AI quota as long as the Owner subscription itself remains entitled.

This is not safe to change silently because the durable product contract only says ownership must not silently transfer; it does not yet say whether owner absence should suspend the group's new usage.

Recommended product direction for discussion:
- keep the stable Owner binding/history;
- when Owner is no longer an active group member, suspend new group record/query/provider work until Owner rejoins or a future explicit transfer/rebind completes;
- preserve historical records/usage without deleting or silently changing Owner.

Do not implement until user confirms desired behavior.

### N. Admin/current-usage effective-state drift — confirmed, partially fixed

The dedicated `WorklogUsageService` path previously treated any temporally ACTIVE subscription as a current usage window even if its plan was now disabled. `DrizzleWorklogUsageRepository.getActiveUsageWindow()` now joins only `plan.enabled = TRUE`, so `/usage/me` and service-based owner usage no longer present a disabled plan as a current quota window.

However Admin list/detail SQL still directly displays subscription/balance/template allowance without consistently computing the same effective state. An expired, not-yet-effective, or disabled subscription can therefore still show nonzero fields labeled as current allowance/remaining in Admin.

Also `user_type = GROUP_ENABLED` currently means “owns at least one ACTIVE group source,” not “currently has a valid group collaboration entitlement.” A FREE/expired Owner can therefore be labeled GROUP_ENABLED even though runtime group use is blocked.

Recommended implementation:
- centralize or reproduce one effective-subscription calculation for Admin list/detail;
- distinguish current-cycle values from historical/template values;
- either rename the factual type to `GROUP_OWNER` or compute `GROUP_ENABLED` from actual current entitlement;
- keep raw historical data available for diagnosis rather than zeroing it without labels.

### O. Structured anomaly coverage — audit incomplete, likely gap

Admin can read `worklog_anomaly_events` plus failed attachment/normalization state. Group/OA webhook/runtime failure paths visibly use structured `console.error` in several places. A complete source-level trace of every writer into `worklog_anomaly_events` is not yet finished.

Next audit should confirm whether LINE webhook/reply/content/DB/runtime failures are ever persisted into the anomaly table as the product spec expects, or whether the table is currently mostly read-only/manual infrastructure.

Do not claim this is definitely missing until writer search is completed across the branch.

### P. Admin user list does not expose group ids — confirmed medium mismatch

Product spec says the main Admin user list should show group id(s) where collaboration applies. Current list exposes `owned_group_count` and `member_group_count`, but not the actual related group/source ids. User detail contains group lists.

Recommended implementation:
- either add a compact owned-group id summary/array to the main list, or explicitly revise the product spec if counts-only is intentionally sufficient for the list view.

### Q. Low-level record read service remains membership-only — intentional layering but easy to misuse

`WorklogRecordReadService.groupRecords()` and `surfaces()` remain membership/source primitives and do not understand paid entitlement. Web routes now wrap group exposure/read in the collaboration authorization service, so the direct Web bypass is closed.

Recommended hardening later:
- rename/document these methods as low-level membership primitives or move entitlement composition into a higher-level service to make future routes less likely to call them unsafely.

## Other verified good contracts

- Ordinary GROUP text is bounded-cache-only and does not become permanent records without explicit trigger.
- Ordinary private OA support text is not cached.
- LINE attachment binaries are not persisted.
- Group Owner cannot silently be overwritten by another manual claim.
- Group member recording disable happens before group record authorization/provider work.
- Expired persisted `status='ACTIVE'` does not grant collaboration entitlement through the collaboration service.
- Current consolidated DB baseline contains quota-cycle snapshot preservation and project/customer synchronization triggers, so those protections were not lost when migrations were squashed.
- Admin presentation preserves raw values and adds separate translated labels.
- Group Web one-time entry exchange verifies nonce and current LINE membership; private entry exchange verifies current OA-friend/private-source access. Entry exchange itself is intentionally not the paid entitlement boundary, so downstream group APIs must continue enforcing current group entitlement on each protected operation.

## Static validation performed in latest audit batch

- Re-read product, development, content-policy, deployment and progress contracts before continuing.
- Re-audited Web group records/surfaces, one-time entry exchange, group collaboration authorization and stable group ordinal.
- Fixed the direct Web group entitlement bypass in `/surfaces` and `/records/group/:sourceId`.
- Changed missing/malformed `maxGroupCount` from accidental unlimited to fail-closed and updated focused collaboration tests.
- Audited Owner/member leave behavior and identified the departed-Owner quota-consent ambiguity; left it as a documented product decision rather than guessing.
- Audited usage presentation and fixed disabled-plan leakage in the service-based current usage window; Admin direct SQL still needs alignment.
- Audited Admin user/group current quota presentation and `GROUP_ENABLED` semantics.
- Audited checkout-intent schema and confirmed recurring authorization/event/renewal state is not implemented.
- Re-audited Gemini attachment usage accounting against provider usage-metadata semantics; current total-prompt-to-media duplication is a confirmed accounting defect/design gap.
- Corrected misleading Web subscription placeholder copy.
- Tests were authored/updated but **not executed**.
- No typecheck/test/schema/migration/browser/Worker/LINE/Gemini execution was run.
- **GitHub Actions were not run, dispatched, rerun, enabled or modified.** Source/document commits used `[skip ci]`.

## Next audit batch

Continue from these areas rather than restarting:

1. Trace private entitlement resolution end-to-end and design/implement a central capability-check boundary for `privateOaRecording`, `aiTextRecording`, `aiMediaIngestion` where behavior is already unambiguous.
2. Complete structured anomaly writer audit for LINE webhook/reply/content/DB/provider failures.
3. Audit PWA editing UI/routes and prepare the exact `pwaEditing` scope decision; do not enforce ambiguous scope until user confirms.
4. Continue Admin effective-state/current-quota alignment and decide whether `GROUP_ENABLED` should mean entitlement or be renamed `GROUP_OWNER`.
5. Audit FREE bootstrap/subscription/quota lifecycle in detail; wait for user decision on FREE `ONE_TIME` vs `MONTHLY` before choosing durable model.
6. Design the corrected Gemini modality usage/cost mapping and canonical quota-unit boundary; do not finalize plan allowances until this is fixed/validated.
7. Add billing-type schema/API/Admin/Web plumbing and provider-neutral renewal domain after the FREE cadence/product choices are resolved where necessary.
8. Keep migration-history reconciliation as a production blocker until target DB history is known.
9. Ask user to decide departed-Owner behavior before changing group authorization semantics.

## Planning estimate

Planning estimates, not test results:

- MVP feature implementation: **about 93–95%** for the non-provider product surface; Web entitlement and max-limit gaps were closed, while billing/capability/accounting work remains.
- Static architecture/logic audit: **about 88–91%**; major LINE/Web/subscription/migration/auth/usage surfaces are now inspected, with capability/anomaly/Admin/payment edges remaining.
- Production readiness: **about 76–81%** because executable validation is still deferred, recurring billing is absent, capability enforcement is incomplete, AI modality accounting needs correction, Owner-absence semantics are undecided, and production DB migration-history compatibility is unproven.
- Remaining internal code/static-audit work: roughly **3–4 large batches** before a clean concentrated validation pass.
- External/payment work: provider selection + recurring authorization/webhook/renewal integration remains a separate batch family after provider decision.
- Estimated time to reach concentrated local validation after internal code gaps/product decisions are resolved: **about 5–10 focused development hours**.
- Expected failure-driven fixes after the validation pass: **about 2–8 additional focused hours** if no deep DB/provider issue appears.
