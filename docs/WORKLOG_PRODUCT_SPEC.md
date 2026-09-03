# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a LINE-first work-record assistant for individual tradespeople and small crews.

Primary surfaces:

- LINE OA private chat: personal/private work records, subscription entry, feedback, help.
- LINE group bot: shared work-record surface for crews/projects.
- Web/PWA: browse, filter, manually create, edit, organize and export records; manage customers/projects/finance; owner usage/member controls.
- Internal Admin: users/groups/plans/quota, AI pricing, anomalies, feedback and audit.
- AI: Gemini 3.5 normalizes human input into concise work records. AI output is derived and must remain editable by users.

## Product monetization principle

AFTERTRACE charges for AI convenience and paid capabilities, not for access to a user's own data, manual record keeping, or the number of LINE groups used.

Baseline functions available without AI quota:

- add AFTERTRACE Bot to a LINE group;
- open that group's PWA record surface;
- read/search/filter authorized records;
- manually create records in PWA;
- manually edit authorized records in PWA.

AI-assisted ingestion consumes AI allowance. When allowance is exhausted, users may keep working manually for free or purchase additional one-time AI allowance.

## LINE interaction contract

### AI-assisted record commands

- `@AFTERTRACE <text>` is the fast AI-assisted recording path and requires spendable AI allowance plus any required billing-owner binding for that source.
- Reply to an image/audio/file and send `@AFTERTRACE` to use AI-assisted attachment ingestion.
- Ordinary group chat is not persisted as product records unless explicitly triggered.
- Ordinary private OA text without `@AFTERTRACE` remains human-support traffic.
- Group quoted TEXT is available only through the bounded temporary cache. If an old quoted TEXT can no longer be reconstructed, ask the user to re-enter the original text.
- If LINE attachment content has expired/unavailable, ask the user to resend it.

### Non-AI group actions

The Bot may exist in FREE groups even when no paid subscription or AI billing owner is active.

Non-AI commands such as opening the PWA/group history must not require paid entitlement or AI allowance. The exact command copy may remain `@AFTERTRACE 查詢` or an equivalent entry action.

### Success reply after recording

Every successful LINE AI record flow must tell the user what AFTERTRACE actually recorded.

Preferred structure:

```text
已記錄：
{{AI 整理後摘要或實際保存內容}}

修改紀錄：
https://<aftertrace-web>/records/{{recordId}}
```

Rules:

- When AI normalization succeeds, show the normalized summary/category-relevant result rather than only `已記錄。`.
- When raw content is saved but AI is disabled/deferred/failed, state that truthfully and never fabricate an AI summary.
- The record URL is a durable PWA deep link containing the durable record id.
- PWA authentication/authorization remains authoritative; knowing a record id/URL never grants access by itself.
- If the new message appears to update/resolve an earlier business item but AFTERTRACE cannot determine the exact target confidently, the reply must say so explicitly instead of pretending the relationship is known.

## PWA manual record creation and editing

Manual PWA recording/editing is a baseline product function for every user, including FREE users and users whose AI allowance is exhausted.

Manual PWA create/edit must not consume AI allowance unless the user explicitly invokes an AI-assisted action.

### Private scope

- Only the owning LINE/OA user may view, manually create into, and edit their private record scope.
- Losing AI quota or paid subscription state never removes manual read/create/edit access to existing personal data.

### Group scope

- Any currently active member of a LINE group that has AFTERTRACE may view existing records, manually create PWA records into that group, and manually edit that group's records.
- Manual PWA group use is available on FREE and paid plans.
- Manual group use does not require an AI billing owner to be present, an active paid subscription, or AI allowance.
- Group membership/source authorization still applies; unrelated users cannot access the group by guessing ids.
- If a previous AI billing Owner leaves or their subscription expires, active members may continue all manual PWA work.

### Edit auditability

- Preserve original user-provided content/reference as source-of-truth where practical.
- Retain actor/editor identity and timestamps for manual create/edit.
- Keep enough audit history to distinguish original AI/raw input from later user corrections.

`pwaEditing` is not a plan capability.

## Group identity versus AI billing ownership

A LINE group existing in AFTERTRACE and a user agreeing to pay/consume AI allowance for that group are separate concepts.

### Group existence

- FREE users may add AFTERTRACE Bot to groups.
- Group creation/onboarding must not require a paid plan.
- Group members may use the group's PWA manual record surface without paying for AI.
- There is no maximum group count on FREE/PRO/TEAM for manual collaboration.

### AI billing owner

`owner_user_id` / billing ownership is specifically the user whose authorized AI allowance grants may be consumed for LINE AI-assisted group recording.

- If no AI billing Owner is bound, manual group PWA functionality still works.
- Before a LINE AI-assisted group action spends quota, the system must have a current eligible billing Owner and at least one allowance grant that permits that group.
- `@AFTERTRACE 啟用` is the MVP action for a member to accept AI billing responsibility for that group when needed.
- A claim must not overwrite a different active billing Owner accidentally.
- If billing Owner leaves, new LINE AI activity pauses, but manual PWA group activity continues.
- While the previous billing Owner is absent, another active member may run `@AFTERTRACE 啟用` and become the new billing Owner.
- If nobody rebinds and the original billing Owner returns, the existing binding may resume.

Preferred no-billing-owner / absent-owner AI reply should explain that AI fast recording is paused while PWA manual records remain usable.

### AI billing owner transfer

The current AI billing Owner may explicitly transfer future group AI billing responsibility to another current group member.

Preferred LINE initiation form:

`@AFTERTRACE 擁有者轉移 @Ryan Hsu`

The transfer is a two-party approval flow:

1. only the current AI billing Owner may initiate while they still hold the role;
2. the target must be an active member of the same LINE group;
3. when LINE mention metadata includes a reliable target `userId`, bind the pending request to that exact user id rather than matching display-name text;
4. if LINE cannot provide a reliable mentioned-user id, do not guess by nickname; direct the current Owner to choose the target member in PWA instead;
5. AFTERTRACE replies that the transfer has been submitted and gives the target a PWA confirmation link;
6. the target must authenticate in PWA and explicitly accept before the billing Owner changes;
7. the request must be single-use and expire after a bounded window such as 24–72 hours; acceptance/rejection/cancellation/role change invalidates it;
8. until acceptance, the existing billing Owner remains authoritative and their permitted allowance grants continue to fund eligible AI usage;
9. after acceptance, future group AI usage may consume only the new billing Owner's own allowance grants that they have permitted for that group; the previous Owner returning/rejoining later does not reclaim the role automatically.

AI balances are personal and do not transfer with the role. The previous Owner keeps their own remaining included/top-up grants and allocation settings. The new Owner chooses which of their own grants, if any, may fund the group.

Transfer history must be auditable with initiator, target, group/source, status, timestamps and final accepter identity.

### Group AI billing

- Group AI usage is charged to the current bound billing Owner, never silently to the actor.
- Retain actor user id and charged/billing user id.
- A group AI request may consume only allowance grants owned by that billing Owner whose allocation policy permits the group and whose configured group cap is not exhausted.
- Group count itself is never an AI entitlement restriction.
- If no eligible permitted grant remains for the group, LINE AI recording stops while manual PWA work continues.

### Group AI visibility and history

The group PWA must show both the **current AI funding state** and the **historical AI usage ledger for that group**. It must not collapse history to only the current Billing Owner.

Current-state view for active group members should include:

- current AI billing Owner identity/display name;
- current Owner grant(s) that are permitted for this group, shown at an appropriate product level;
- AI units currently available to this group under those allocation policies/caps;
- AI units consumed from the currently eligible allocations;
- remaining amount available to this group.

Historical group AI view must remain queryable across Billing Owner transfers, plan renewals, FREE grants and individual top-up grants. At minimum it should support:

- time/date of AI usage;
- actor who triggered the AI record;
- charged AI billing Owner at the time;
- grant source/type used (`FREE`, subscription period, or individual top-up purchase/grant) without exposing unrelated personal financial details;
- AI units consumed by the group for that event;
- record reference/type where useful so members can relate usage to the created work record;
- cumulative/group-period totals so members can see how much the group has used over time;
- Billing Owner transfer history or clear period boundaries so historical usage remains understandable after responsibility changes.

The historical ledger is **group-scoped**. A member may see what this group consumed from an Owner's grant while that grant funded this group, including past usage even after the Owner changes. A member must not gain visibility into:

- the Owner's unrelated private AI usage;
- the Owner's total/global wallet beyond what was made available/consumed by this group;
- allocation or usage in other groups;
- private purchase/payment details that are not necessary to explain the group's AI allowance history.

Changing the current Billing Owner, changing allocation caps, plan renewal, plan expiry, or group AI being paused must never rewrite/delete historical usage rows. Historical group AI consumption is an append-only/auditable fact derived from durable usage/grant-allocation records.

### Member recording permission

Any Owner-level recording permission only governs spending the billing Owner's AI allowance through LINE AI-assisted recording. It must not block manual PWA read/create/edit for active group members.

## Data principles

Always preserve original user-provided content/reference. AI output is derived metadata and may be corrected/regenerated.

A record retains at least workspace/source, LINE ids where applicable, author, original raw input/attachment metadata, normalized summary, category, customer/project links, input type, creation/edit timestamps, and creation mode such as `LINE_AI` / `PWA_MANUAL`.

Amounts requiring arithmetic use deterministic numeric fields/tables; AI text is never accounting truth.

## Related records and current business state

Worklog records are event history. Later events should usually create new records and update deterministic current state through explicit relations instead of overwriting the earlier record.

Example:

```text
Day 1: 三重王先生 裝潢 30000 還沒給
Day 4: 三重王先生 裝潢 30000 已給
```

Preferred model:

- Day 1 remains its own record plus a typed `RECEIVABLE` transaction for 30,000;
- Day 4 remains its own record plus a typed `RECEIVED` transaction for 30,000;
- the later receipt is explicitly allocated/linked to the earlier receivable when the target is known;
- the earlier historical record is not rewritten to pretend the debt was always paid;
- PWA current finance state is derived from deterministic transactions/allocations and may show `應收 / 已收 / 未收 / 已結清`, while the timeline still shows both historical events.

The finance relation must support partial settlement, for example a 30,000 receivable followed by 10,000 and 20,000 receipts. Prefer a relation/allocation model capable of many-to-many partial allocation rather than assuming every receipt fully settles exactly one receivable.

### AI relation matching and ambiguity

AI may help identify candidate customer/project/issue/receivable relations, but it must not invent a high-impact relation merely because text looks similar.

Candidate matching may use deterministic facts such as:

- same PRIVATE/GROUP source/workspace boundary;
- customer identity;
- project identity;
- amount;
- unresolved/open state;
- event type;
- recency.

Rules:

- a unique, high-confidence match may be auto-linked according to the product's accepted confidence policy;
- if multiple plausible targets exist, important identifying data conflicts, or confidence is otherwise insufficient, **do not automatically mutate/settle/resolve the earlier item**;
- save the new user's record truthfully even when the relation is unresolved;
- mark/retain the relation as pending/unresolved where useful;
- tell the user clearly that AFTERTRACE currently cannot determine which previous item this refers to;
- provide a PWA deep link/action allowing the user to select the correct target and confirm the state change manually.

Preferred financial ambiguity reply:

```text
已記錄這筆收款資訊，但目前無法判斷是對應哪一筆未收款紀錄。
請到 AFTERTRACE 確認要結清／沖銷的項目：
https://<aftertrace-web>/records/{{recordId}}
```

For financial state, ambiguity must fail safe: an uncertain AI match never automatically changes an outstanding receivable to paid. The same principle applies to other stateful relations such as resolving an issue or attaching an update to one of several similarly named projects.

## Subscription plan model

Subscription configuration is data-driven.

### FREE

- price: NT$0
- billing type: `ONE_TIME`
- initial AI allowance: **500 units one time**
- allowance has no calendar expiry and never refreshes
- may add Bot to unlimited LINE groups
- manual PWA personal/group read/create/edit: free
- AI use is available while the user's one-time or purchased top-up grants permit the requested private/group scope and have remaining allowance
- `export = false` initially

### PRO

- price: **NT$99/month**
- billing type: `MONTHLY`
- AI allowance: **500 units per successful monthly period**
- unlimited LINE groups
- manual PWA read/create/edit: free baseline
- `export = true`

### TEAM

- price: **NT$299/month**
- billing type: `MONTHLY`
- AI allowance: **2500 units per successful monthly period**
- unlimited LINE groups
- manual PWA read/create/edit: free baseline
- `export = true`

Suggested ranks: FREE 0, PRO 10, TEAM 20.

Do not use `groupCollaboration` or `maxGroupCount` to prohibit FREE/manual group collaboration. If a capability remains for group AI use, name/define it explicitly as an AI-assisted billing capability rather than generic collaboration.

## AI allowance sources

AI allowance is **user-owned**, not group-owned. A group never becomes the legal/accounting owner of purchased AI units.

A user's AI balance is represented as separate allowance grants. Do not merge grants in a way that loses purchase/period identity or per-grant allocation settings.

### Included allowance grant

- FREE one-time initial grant or current paid MONTHLY period grant.
- Paid monthly included allowance refreshes only after confirmed successful renewal.
- Unused paid monthly included allowance does not roll over.
- The current included grant has its own allocation policy controlling where it may be spent.

### One-time AI top-up grants

Users on any plan, including FREE, may purchase one-time AI top-up packs.

- each purchase creates a **separate durable grant**;
- top-up is not a subscription plan;
- purchased units do not auto-refresh or expire at monthly renewal merely because the calendar changes;
- each top-up grant keeps its own purchase/payment identity and its own allocation policy;
- do not merge multiple top-up purchases into one anonymous balance if that would prevent the user from configuring them independently;
- pack sizes/prices remain configurable until Gemini cost measurements are finalized.

When AI balance is exhausted or no grant permits the requested scope, UX should offer free PWA manual recording plus AI top-up/paid-plan options.

## AI allowance allocation policy

Every allowance grant is owned by one user and may be independently configured for where it can be consumed.

This applies separately to:

- the current FREE/PRO/TEAM included allowance grant;
- each individual one-time top-up purchase grant.

A grant allocation policy may allow any combination of:

- PRIVATE: the owner's private OA/PWA AI-assisted use;
- selected GROUP source ids: one or more groups for which the user is the current AI billing Owner.

The user can therefore choose patterns such as:

- subscription allowance only for Group A and Group B, not private;
- subscription allowance for private + Group A;
- top-up purchase #1 only for Group C;
- top-up purchase #2 only for private;
- top-up purchase #3 for private + selected groups.

### Per-scope caps

For each grant, the owner may optionally set a maximum amount consumable by:

- PRIVATE scope;
- each permitted GROUP scope.

If no cap is configured for an allowed scope, that scope may consume from the grant until the grant itself is exhausted, subject to other concurrently allowed scopes also consuming it.

Caps are spending permissions/limits, not separate transferred wallets. Unused units still belong to the original grant owner.

Examples:

```text
PRO included grant = 500
PRIVATE allowed, cap 100
Group A allowed, cap 300
Group B allowed, no explicit cap
```

The same underlying 500 units remain user-owned. PRIVATE can consume at most 100 from that grant; Group A at most 300; Group B may consume while grant balance remains. Aggregate consumption across all scopes can never exceed the grant's real remaining units.

### Allocation defaults

Keep defaults simple rather than forcing configuration before first use.

Recommended default when a grant is created:

- PRIVATE allowed;
- no groups automatically allowed until the user explicitly binds/permits their AI billing responsibility for that group, or the onboarding flow explicitly asks and records consent;
- no per-scope cap unless the user sets one.

The UI should make it easy to change these settings later.

### Consumption selection

Before an AI provider call, resolve eligible grants owned by the charged user that:

1. are currently valid/unexpired according to their grant type;
2. allow the requested PRIVATE/GROUP scope;
3. have not exhausted the configured cap for that scope;
4. have real remaining units.

If more than one grant is eligible, consumption order must be deterministic and visible in the product/accounting rules. Recommended initial order:

1. current included plan-period/FREE grant;
2. one-time top-up grants oldest purchase first.

Reservation and settlement may span multiple grants if necessary, but must remain atomic/idempotent so one provider call cannot double-spend or exceed aggregate eligible allowance.

### Group dissolution / Owner change

Because allowance remains user-owned:

- a group becoming inactive or being permanently closed does not require refunding AI units to anyone; the units never left their owner's grant;
- the allocation entry for that group simply becomes unusable/disabled, leaving unused grant balance available to any other scopes the owner has permitted or later permits;
- when AI billing Owner changes, the old Owner's grants remain theirs and stop funding the group after transfer; the new Owner must use/configure their own grants.

### Platform responsibility boundary

AFTERTRACE enforces the grant owner's configured allocation/caps and transparently reports group-specific availability/usage. It does **not** attempt to police private agreements among group members about how the Owner should spend their own remaining allowance outside the group.

If an Owner permits PRIVATE use and privately consumes their own grant, that is not treated as platform misuse. Group members can see only the amount actually allocated/available to their group and the group's consumption, not the Owner's unrelated personal spending.

## Billing type and renewal

Initial billing types are `ONE_TIME` and `MONTHLY`.

- FREE initial grant is ONE_TIME and never resets automatically.
- Paid MONTHLY receives a fresh included allowance only after confirmed renewal success.
- Calendar passage alone creates no new paid quota.
- Purchased top-up grants are unaffected by monthly period rollover.
- Recurring provider webhooks/renewals must be idempotent and raw card data is never stored.

Payment provider remains undecided.

## AI quota and provider accounting

- Reservation is preflight only; real provider usage must be recorded even if actual exceeds estimate.
- Provider-success results must not be erased due to settlement delay/expiry/overage.
- Provider-dollar cost and customer-facing allowance units are distinct concepts.
- Thinking/modality usage is accounted exactly once.
- Balance accounting distinguishes included grants from individual one-time purchased top-up grants.
- Usage/reservation settlement must retain which grant(s) funded the call and the PRIVATE/GROUP scope used, so per-grant/per-scope caps and audit totals remain correct.
- Group usage history must remain reconstructible across Owner transfers and grant changes; usage events are immutable historical facts and must retain the charged Owner, source/group and funding-grant references necessary for group PWA history.

## AI runtime

Current production target remains the approved Gemini 3.5 model. Gemini 2.5 compatibility is not MVP work.

Use Gemini 3.x thinking controls, include reported thinking usage in accounting, and keep historical pricing snapshots immutable.

## Attachment/file scope

MVP input targets: text, image, audio, PDF, common text-like files, XLSX/Excel and DOCX/Word.

For DOCX/XLSX, prefer the simplest verified provider-native Files/File Search path supported by the selected Gemini API before building custom Office extraction. Enforce file/request-size limits, MIME allowlists, provider failure handling and real E2E verification.

## Export

Export is MVP and initially remains a paid capability. CSV first is acceptable. Export authorization is server-side and follows private/group data-access boundaries.

## Internal Admin

Admin supports users/groups, AI billing-owner visibility/transfer history, plans/billing cadence, individual AI grants/allocation policies/caps, top-up products/purchases, AI pricing, anomalies, feedback, manual subscription changes and audit.

Group detail should show the group's current AI billing Owner/current group-specific allocation state **and historical group AI usage across all prior Billing Owners/grants**, without exposing unrelated private or other-group balances.

Do not expose `maxGroupCount`, generic paid `groupCollaboration`, or record editing as plan capabilities. Any future group-related paid capability must correspond to a real paid cost/feature.

## Platform and deployment

MVP stack: TypeScript/Node ecosystem, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Internal Admin, PostgreSQL + Drizzle.

Deploy as three Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`. No new Cloudflare Pages work.

## Prelaunch database policy

Development/production databases are prelaunch and may be rebuilt while schema is finalized. Current repository migration history is authoritative. Once real production user data exists, switch to forward-only migrations.
