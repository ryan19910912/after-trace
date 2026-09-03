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

`owner_user_id` / billing ownership is specifically the user whose AI entitlement/balance is used for LINE AI-assisted group recording.

- If no AI billing Owner is bound, manual group PWA functionality still works.
- Before a LINE AI-assisted group action spends quota, the system must have a current eligible billing Owner and available AI balance.
- `@AFTERTRACE 啟用` is the MVP action for a member to accept AI billing responsibility for that group when needed.
- A claim must not overwrite a different active billing Owner accidentally.
- If billing Owner leaves, new LINE AI activity pauses, but manual PWA group activity continues.
- While the previous billing Owner is absent, another active member may run `@AFTERTRACE 啟用` and become the new billing Owner.
- If nobody rebinds and the original billing Owner returns, the existing binding may resume.

Preferred no-billing-owner / absent-owner AI reply should explain that AI fast recording is paused while PWA manual records remain usable.

### Group AI billing

- Group AI usage is charged to the current bound billing Owner/subscriber, never silently to the actor.
- Retain actor user id and charged/billing user id.
- AI capability/balance is checked before provider calls.
- Group count itself is never an AI entitlement restriction.

### Member recording permission

Any Owner-level recording permission only governs spending the billing Owner's AI allowance through LINE AI-assisted recording. It must not block manual PWA read/create/edit for active group members.

## Data principles

Always preserve original user-provided content/reference. AI output is derived metadata and may be corrected/regenerated.

A record retains at least workspace/source, LINE ids where applicable, author, original raw input/attachment metadata, normalized summary, category, customer/project links, input type, creation/edit timestamps, and creation mode such as `LINE_AI` / `PWA_MANUAL`.

Amounts requiring arithmetic use deterministic numeric fields/tables; AI text is never accounting truth.

## Subscription plan model

Subscription configuration is data-driven.

### FREE

- price: NT$0
- billing type: `ONE_TIME`
- initial AI allowance: **500 units one time**
- allowance has no calendar expiry and never refreshes
- may add Bot to unlimited LINE groups
- manual PWA personal/group read/create/edit: free
- AI use is available while the user's one-time or purchased top-up AI balance remains
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

A user's spendable AI balance may come from multiple sources.

### Included allowance

- FREE one-time initial grant or paid MONTHLY period allowance.
- Paid monthly included allowance refreshes only after confirmed successful renewal.
- Unused paid monthly included allowance does not roll over.

### One-time AI top-up

Users on any plan, including FREE, may purchase one-time AI top-up packs.

- top-up is not a subscription plan;
- purchased units do not auto-refresh or expire at monthly renewal merely because the calendar changes;
- top-up purchases are separately auditable;
- recommended spending order: current included allowance first, then oldest purchased top-up units;
- pack sizes/prices remain configurable until Gemini cost measurements are finalized.

When AI balance is exhausted, UX should offer both free PWA manual recording and AI top-up/paid-plan options.

## Billing type and renewal

Initial billing types are `ONE_TIME` and `MONTHLY`.

- FREE initial grant is ONE_TIME and never resets automatically.
- Paid MONTHLY receives a fresh included allowance only after confirmed renewal success.
- Calendar passage alone creates no new paid quota.
- Purchased top-up balance is unaffected by monthly period rollover.
- Recurring provider webhooks/renewals must be idempotent and raw card data is never stored.

Payment provider remains undecided.

## AI quota and provider accounting

- Reservation is preflight only; real provider usage must be recorded even if actual exceeds estimate.
- Provider-success results must not be erased due to settlement delay/expiry/overage.
- Provider-dollar cost and customer-facing allowance units are distinct concepts.
- Thinking/modality usage is accounted exactly once.
- Balance accounting distinguishes included grants from one-time purchased top-up grants.

## AI runtime

Current production target remains the approved Gemini 3.5 model. Gemini 2.5 compatibility is not MVP work.

Use Gemini 3.x thinking controls, include reported thinking usage in accounting, and keep historical pricing snapshots immutable.

## Attachment/file scope

MVP input targets: text, image, audio, PDF, common text-like files, XLSX/Excel and DOCX/Word.

For DOCX/XLSX, prefer the simplest verified provider-native Files/File Search path supported by the selected Gemini API before building custom Office extraction. Enforce file/request-size limits, MIME allowlists, provider failure handling and real E2E verification.

## Export

Export is MVP and initially remains a paid capability. CSV first is acceptable. Export authorization is server-side and follows private/group data-access boundaries.

## Internal Admin

Admin supports users/groups, AI billing-owner visibility, plans/billing cadence, included AI balance, top-up products/balances, AI pricing, anomalies, feedback, manual subscription changes and audit.

Do not expose `maxGroupCount`, generic paid `groupCollaboration`, or record editing as plan capabilities. Any future group-related paid capability must correspond to a real paid cost/feature.

## Platform and deployment

MVP stack: TypeScript/Node ecosystem, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Internal Admin, PostgreSQL + Drizzle.

Deploy as three Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`. No new Cloudflare Pages work.

## Prelaunch database policy

Development/production databases are prelaunch and may be rebuilt while schema is finalized. Current repository migration history is authoritative. Once real production user data exists, switch to forward-only migrations.
