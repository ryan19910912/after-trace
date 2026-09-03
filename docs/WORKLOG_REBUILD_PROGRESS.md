# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:
- `docs/WORKLOG_PRODUCT_SPEC.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

## Stable product contract

- LINE is the fast AI-assisted capture surface; Web/PWA is the durable manual record surface.
- FREE = NT$0, ONE_TIME, 500 AI units once, no calendar expiry/no refresh.
- PRO = NT$99/month, MONTHLY, 500 included AI units per successful renewal.
- TEAM = NT$299/month, MONTHLY, 2500 included AI units per successful renewal.
- Users on any plan may purchase one-time AI top-up packs; top-up balance does not disappear at monthly renewal.
- Paid plans and FREE do **not** limit group count.
- FREE may add AFTERTRACE Bot to LINE groups and use group PWA manually.
- Group existence/manual collaboration is free; AI billing ownership is a separate concept required only when LINE AI/provider work spends quota.
- PWA manual read/create/edit is baseline free functionality and consumes zero AI units unless an explicit AI action is invoked.
- Private manual scope: owner only.
- Group manual scope: active group members may read/create/edit collaboratively even without a paid plan, even if a previous billing Owner is absent, and even after included AI is exhausted.
- Record deep links are durable authenticated `/records/<id>` routes, not short-lived capability links.
- Successful LINE AI recording must return what was actually saved/normalized plus that record deep link.
- AI use requires spendable included/top-up balance and, for group AI, an eligible bound billing Owner.
- If group billing Owner leaves, LINE AI-assisted recording pauses; manual PWA group work continues.
- Another active member may run `@AFTERTRACE 啟用` to take over AI billing responsibility only while old billing Owner is absent.
- Current AI billing Owner may explicitly transfer responsibility to another active group member through a two-party approval flow: Owner initiates in LINE/PWA, target confirms in authenticated PWA, transfer request is single-use/expiring, and balances do not move with the role.
- Export is MVP; CSV first is acceptable and currently remains paid.
- XLSX/DOCX are MVP input targets; prefer verified Google provider-native file ingestion before custom parsing.
- Dev/prod DBs are prelaunch/disposable and may be rebuilt.
- GitHub Actions must not run unless explicitly requested by user.

## Implemented / fixed

- Worklog-only OA/group runtime, Web/Admin Workers, PostgreSQL/Drizzle foundations.
- Explicit billing Owner binding because LINE Bot join does not reliably identify inviter.
- Owner-presence / absent-owner rebind flow exists in current AI collaboration path.
- Group AI text/media capability gates exist.
- Gemini modality double-count and provider-success reservation settlement defects were corrected.
- Gemini 3.x thinking usage accounting exists in current provider path; executable validation pending.
- `pwaEditing` removed from Admin plan capability definitions.
- Product/development/deployment docs reflect rebuildable prelaunch DBs.

## Superseded code/contracts requiring cleanup

### 1. `maxGroupCount` is obsolete

Remove end-to-end:
- Admin capability definition/control/defaults;
- plan JSON/defaults;
- collaboration ordinal SQL;
- GROUP_LIMIT_REACHED result/copy/tests;
- any Web filtering based on group ordinal.

No plan limits number of groups.

### 2. Generic paid `groupCollaboration` is too broad

FREE group/manual collaboration is now allowed. If a group capability remains, rename/redefine it specifically for AI-assisted group spending rather than generic group existence/read/manual CRUD.

### 3. Group source existence must not depend on paid billing Owner

Current bootstrap/source model was designed around promotion into an Owner workspace. Re-audit and refactor so:
- Bot can join/create a usable group surface without paid entitlement;
- active members can reach the group PWA and manually create/edit records without a billing Owner;
- billing Owner may remain null until AI-assisted group capture is requested/enabled;
- binding/rebinding only determines whose AI balance is charged, not whether the group can exist.

This may require separating source/workspace ownership from AI billing ownership in the data model instead of overloading one Owner field for both concerns.

### 4. Historical/manual group access is still over-restricted

Current Web group read/surface routes still use stronger collaboration entitlement in places.

Required:
- manual/history read: authenticated active group membership + active source;
- manual PWA create/edit: same membership/source boundary;
- no paid plan, Owner presence or AI balance requirement;
- LINE AI/provider path uses stronger billing-owner/AI balance gates.

### 5. Generic record edit is still workspace-owner-centric

Required:
- PRIVATE -> private owner only;
- GROUP -> active group member may edit;
- add manual PWA create API for both scopes;
- manual create/edit costs zero AI units;
- preserve actor/editor identity and timestamps.

## High-priority implementation queue

1. Remove `maxGroupCount` / GROUP_LIMIT_REACHED end-to-end.
2. Separate free group/source existence from AI billing-owner binding.
3. Split manual group authorization from LINE AI entitlement.
4. Implement PWA manual create + collaborative group edit/private-owner edit.
5. Implement LINE success summary + durable record deep link.
6. Add billing_type and durable FREE/PRO/TEAM defaults now that DBs are rebuildable.
7. Add first-class AI top-up products/grants/balances and deterministic spend order: included allowance first, top-up second.
8. Implement AI billing-owner transfer requests/approval: initiator must be current billing Owner; target active member; reliable mention user id or PWA member selection; expiring single-use request; target PWA acceptance; no quota/balance transfer; auditable history.
9. Implement private OA AI entitlement gates while preserving manual PWA access.
10. Fix Admin effective included/top-up balance and AI media pricing; expose billing-owner transfer status/history.
11. Implement CSV export.
12. Verify Gemini provider-native XLSX/DOCX path.
13. Finish AI hardening and enter concentrated local validation.

## AI top-up domain requirement

Top-up is separate from subscription plan identity.

Need:
- top-up product: code/name/price/units/enabled/rank;
- idempotent purchase/payment reference;
- durable grant/remaining-balance ledger;
- top-up balance survives monthly plan rollover;
- Admin shows included, top-up and aggregate spendable balance separately;
- pack sizes/prices remain undecided until real Gemini cost measurements.

## AI billing-owner transfer requirement

Accepted product flow:

- command example: `@AFTERTRACE 擁有者轉移 @Ryan Hsu`;
- only current AI billing Owner may initiate;
- target must be active member of same group;
- use LINE mention `userId` when reliably available; never resolve transfer target by display-name guessing;
- if reliable mention id is unavailable, current Owner chooses target in PWA;
- create pending transfer request with bounded expiry (24–72h target range), single-use state and cancellation/rejection handling;
- target authenticates in PWA and explicitly accepts;
- existing billing Owner remains in force until acceptance;
- after acceptance future group AI charges target user's own eligible balance;
- balances/top-ups remain personal and never transfer with the role;
- transfer event/history must be auditable.

## LINE non-AI manual mode

Still not required for MVP. Current recommendation remains:
- LINE: fast AI-assisted capture + query/deep-link entry;
- PWA: free structured manual create/edit.

Do not build a second complex LINE manual CRUD grammar unless user testing shows real demand.

## Validation status

Recent tests are authored but not executed. Typecheck/test/build/schema/browser/Worker/LINE/Gemini concentrated validation remains pending.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning estimate

Planning estimates only:
- MVP non-payment-provider implementation: about 92–94% after free-group/manual scope, top-up, and billing-owner-transfer additions.
- Static architecture/logic audit: about 98–99%.
- Production readiness including unrun validation/provider integration: about 81–84%.
- Remaining internal development before concentrated validation: about 4 large batches / roughly 10–18 focused hours.
- After concentrated validation begins, reserve 2–8 focused hours for ordinary compile/schema/browser/runtime fixes.
- Payment-provider recurring + top-up purchase integration remains separate and likely 1–3 working days after provider selection.

Do not use GitHub Actions as validation.
