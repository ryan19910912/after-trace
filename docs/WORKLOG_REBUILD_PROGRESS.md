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
- Users on any plan may purchase one-time AI top-up packs; each purchase remains a separate durable allowance grant.
- AI allowance is always **user-owned**, never group-owned.
- Every included/top-up grant can independently allow PRIVATE and selected GROUP scopes and can optionally set per-scope usage caps.
- Multiple one-time top-up purchases must not be merged if doing so would lose independent allocation settings.
- If a scope has no cap, it may consume until the shared grant is exhausted; aggregate usage across all scopes can never exceed the real grant balance.
- Recommended grant spend order: current included grant first, then one-time top-up grants oldest first.
- Group members may see current group-specific AI billing Owner + available/used/remaining amount **and the historical AI usage ledger for that group across prior Billing Owners/grants**.
- Historical group AI usage must remain visible after Owner transfer, plan renewal/expiry, allocation changes or AI pause; history is append-only/auditable and group-scoped.
- Group history may show actor, charged Owner, grant source/type, units used, record reference/type and time, but must not reveal Owner private/global/other-group balances or unrelated payment details.
- Platform does not police private agreements about whether an Owner also uses their own allowance privately; it enforces only the Owner's configured allocation/caps.
- Group dissolution requires no quota refund because units never leave the user's grant; the obsolete group allocation simply stops being eligible while historical group usage remains intact.
- Paid plans and FREE do **not** limit group count.
- FREE may add AFTERTRACE Bot to LINE groups and use group PWA manually.
- Group existence/manual collaboration is free; AI billing ownership is required only when LINE AI/provider work spends quota.
- PWA manual read/create/edit is baseline free functionality and consumes zero AI units unless an explicit AI action is invoked.
- Private manual scope: owner only.
- Group manual scope: active group members may read/create/edit collaboratively even without a paid plan, even if billing Owner is absent, and even after AI allowance is exhausted.
- Record deep links are durable authenticated `/records/<id>` routes, not short-lived capability links.
- Successful LINE AI recording must return what was actually saved/normalized plus that record deep link.
- AI use requires at least one eligible allowance grant and, for group AI, an eligible bound billing Owner whose allocation permits that group.
- If group billing Owner leaves, LINE AI-assisted recording pauses; manual PWA group work continues.
- Another active member may run `@AFTERTRACE 啟用` to take over AI billing responsibility only while old billing Owner is absent.
- Current AI billing Owner may explicitly transfer responsibility to another active group member through two-party approval: Owner initiates, target confirms in authenticated PWA, request is single-use/expiring, balances do not move with the role.
- Export is MVP; CSV first is acceptable and currently remains paid.
- XLSX/DOCX are MVP input targets; prefer verified Google provider-native ingestion before custom parsing.
- Dev/prod DBs are prelaunch/disposable and may be rebuilt.
- GitHub Actions must not run unless explicitly requested by user.

## Implemented / fixed

- Worklog-only OA/group runtime, Web/Admin Workers, PostgreSQL/Drizzle foundations.
- Explicit billing Owner binding because LINE Bot join cannot reliably identify inviter.
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

FREE group/manual collaboration is allowed. If a group capability remains, redefine it specifically for AI-assisted spending rather than group existence/read/manual CRUD.

### 3. Group source existence must not depend on billing Owner

Refactor so:
- Bot can join/create a usable group surface without paid entitlement;
- active members can reach group PWA and manually create/edit records without billing Owner;
- billing Owner may remain null until AI group capture is requested/enabled;
- binding/rebinding determines whose eligible grants may be charged, not whether the group exists.

This likely requires separating source/workspace ownership from AI billing ownership rather than overloading one Owner field.

### 4. Historical/manual group access is still over-restricted

Required:
- manual/history read: authenticated active group membership + active source;
- manual PWA create/edit: same membership/source boundary;
- no paid plan, Owner presence or AI balance requirement;
- LINE AI/provider path uses stronger billing-owner/allocation/balance gates.

### 5. Generic record edit is still workspace-owner-centric

Required:
- PRIVATE -> private owner only;
- GROUP -> active group member may edit;
- add manual PWA create API for both scopes;
- manual create/edit costs zero AI units;
- preserve actor/editor identity and timestamps.

## AI grant/allocation domain requirement

The previous simple “user aggregate balance” model is now insufficient.

Required grant model:

- every FREE initial grant, monthly included period grant, and one-time top-up purchase is an identifiable allowance grant;
- top-up purchases remain separate grant rows so allocation rules can differ per purchase;
- grants are owned by a user and never transferred to a group;
- allocation policy supports PRIVATE plus selected GROUP source ids;
- each grant can optionally set PRIVATE cap and per-group cap;
- no cap means the allowed scope may consume until grant balance is exhausted;
- aggregate consumption across scopes cannot exceed grant remaining units;
- usage/reservations must retain which grant(s) funded the provider call and which PRIVATE/GROUP scope consumed them;
- reservation/commit spanning multiple grants must be transactional/idempotent;
- deterministic initial grant selection order: current included grant first, then oldest top-up grants;
- monthly renewal replaces/creates only the included-period grant; top-up grants survive;
- group closure simply disables that group's allocation eligibility; no refund/ownership transfer is necessary;
- immutable usage/grant-consumption references must be sufficient to reconstruct group history across Owner/grant/allocation changes.

Recommended default allocation on new grant:
- PRIVATE allowed;
- no group automatically allowed until the user explicitly accepts/configures billing responsibility for that group;
- no per-scope caps by default.

## Group AI visibility/history requirement

Group members should be able to understand both the group's **current AI state** and **historical AI consumption** without seeing a Billing Owner's unrelated personal finances.

Current state exposed to active group members:
- current AI billing Owner;
- amount currently available to this group under eligible allocations/caps;
- amount already used from the current eligible group allocations;
- amount remaining available to this group.

Historical group AI ledger exposed to active group members:
- usage timestamp/date;
- actor who triggered the AI work;
- charged Billing Owner at that time;
- funding grant source/type (`FREE`, subscription-period grant, or individual top-up grant) at an appropriate non-sensitive level;
- AI units consumed by this group for the usage event;
- related record id/type where useful;
- group totals/period totals so users can understand historical consumption;
- Owner-transfer/period boundaries sufficient to explain why the funding Owner/grant changed.

History rules:
- Owner transfer must not hide or rewrite previous Owner usage;
- subscription renewal/expiry or allocation/cap changes must not rewrite old group usage;
- group AI pause/resume must not erase history;
- group close/inactive state may stop future use but preserves history;
- usage history should come from immutable provider/AI usage events plus funding-grant references, not from recomputing only the current Owner state.

Do not expose:
- Owner's unrelated private balance or private AI usage;
- Owner's global remaining balance beyond what is made available/consumed by this group;
- other groups' allocation or usage;
- raw payment method/provider secrets or unrelated purchase details.

## High-priority implementation queue

1. Remove `maxGroupCount` / GROUP_LIMIT_REACHED end-to-end.
2. Separate free group/source existence from AI billing-owner binding.
3. Split manual group authorization from LINE AI entitlement.
4. Implement PWA manual create + collaborative group edit/private-owner edit.
5. Implement user-owned AI grant/allocation/cap model and migrate quota reservation/settlement to eligible-grant selection, retaining immutable grant-funding references for group history.
6. Add billing_type and durable FREE/PRO/TEAM defaults now that DBs are rebuildable.
7. Add one-time top-up products/purchases as separate grant creators.
8. Implement AI billing-owner transfer requests/approval; after acceptance new Owner must use/configure their own eligible grants.
9. Implement LINE success summary + durable record deep link.
10. Implement private OA AI entitlement/allocation gates while preserving manual PWA access.
11. Fix Admin effective included/top-up/grant allocation facts and AI media pricing; expose billing-owner transfer, current group-specific AI availability and **historical group AI usage**.
12. Implement group PWA AI history UI/API (current state + paginated historical ledger/summary).
13. Implement CSV export.
14. Verify Gemini provider-native XLSX/DOCX path.
15. Finish AI hardening and enter concentrated local validation.

## AI billing-owner transfer requirement

Accepted product flow:

- command example: `@AFTERTRACE 擁有者轉移 @Ryan Hsu`;
- only current AI billing Owner may initiate;
- target must be active member of same group;
- use reliable LINE mention user id when available; never guess by display name;
- if reliable mention id unavailable, Owner chooses target in PWA;
- create pending transfer request with bounded expiry (24–72h target range), single-use state and cancellation/rejection handling;
- target authenticates in PWA and explicitly accepts;
- existing Owner remains in force until acceptance;
- after acceptance future group AI can use only the new Owner's own grants permitted for that group;
- previous Owner's grants/allocation settings remain personal and do not transfer;
- transfer event/history is auditable.

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
- MVP non-payment-provider implementation: about **90–93%** after introducing per-grant allocation/cap accounting, free-group/manual scope, top-up, billing-owner transfer and group AI history UI requirements.
- Static architecture/logic audit: about **98–99%**.
- Production readiness including unrun validation/provider integration: about **79–83%**.
- Remaining internal development before concentrated validation: about **4–5 large batches / roughly 13–23 focused hours** because the AI quota ledger needs a real grant-allocation refactor plus group-history reporting/API/UI.
- After concentrated validation begins, reserve **2–8 focused hours** for ordinary compile/schema/browser/runtime fixes.
- Payment-provider recurring + top-up purchase integration remains separate and likely **1–3 working days after provider selection**.

Do not use GitHub Actions as validation.
