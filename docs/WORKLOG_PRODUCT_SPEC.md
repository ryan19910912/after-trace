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

The product should charge primarily for AI convenience and paid capabilities, not for access to a user's own historical data or for the number of LINE groups they choose to organize work in.

Baseline functions that remain available without AI quota:

- read existing authorized records;
- manually create records in PWA;
- manually edit authorized records in PWA;
- search/filter/browse historical authorized records.

AI-assisted ingestion consumes AI allowance. When allowance is exhausted, the user can continue using manual PWA recording/editing and may purchase additional one-time AI allowance.

## LINE interaction contract

### AI-assisted record commands

- `@AFTERTRACE <text>` records text and may use AI normalization according to current entitlement/quota.
- Reply to an image/audio/file and send `@AFTERTRACE` to record the quoted content.
- Ordinary group chat is not persisted as product records unless explicitly triggered.
- Ordinary private OA text without `@AFTERTRACE` remains human-support traffic.
- Group quoted TEXT is available only through the bounded temporary cache. If an old quoted TEXT can no longer be reconstructed, ask the user to re-enter the original text.
- If LINE attachment content has expired/unavailable, ask the user to resend it.

### Success reply after recording

Every successful LINE record flow must tell the user what AFTERTRACE actually recorded.

Preferred structure:

```text
已記錄：
{{AI 整理後摘要或實際保存內容}}

修改紀錄：
https://<aftertrace-web>/records/{{recordId}}
```

Rules:

- When AI normalization succeeds, show the normalized summary/category-relevant result in the reply rather than only replying `已記錄。`.
- When raw content is saved but AI is disabled/deferred/failed, clearly state that the original record was saved and show the saved/raw content or a safe concise fallback; do not fabricate an AI summary.
- The edit link is a durable PWA deep link containing the durable record id.
- PWA authentication/authorization remains authoritative. If the browser is not signed in, normal LINE Login/session flow occurs and the app returns to the requested record after authentication.
- Knowing or sharing a record id/URL never grants access by itself.

### Open records

- `@AFTERTRACE 查詢` returns a Web/PWA entry URL.
- Ordinary PWA routes use normal LINE Login/session authorization.
- LIFF is not required for MVP.

## PWA manual record creation and editing

Manual PWA recording/editing is a baseline product function for every plan, including FREE and users whose AI allowance is exhausted.

The purpose is twofold:

1. users must always be able to correct AI mistakes or continue working without AI;
2. manual use keeps their work history inside AFTERTRACE and creates a natural upgrade path when they later value faster AI-assisted capture.

Manual PWA create/edit must not consume AI allowance unless the user explicitly invokes a separate AI-assisted action.

### Private OA records

- Only the owning LINE/OA user may view, manually create into, and edit their private record scope.
- Losing AI quota or changing paid subscription state does not remove manual read/create/edit access to that private scope.

### Group records

- Any currently active member of that LINE group may view existing records, manually create new PWA records into that group, and manually edit records belonging to that group.
- Manual PWA creation/editing is collaborative and does not require the Owner to be present.
- Manual PWA creation/editing does not require an active paid subscription and does not consume AI quota.
- Owner presence / paid entitlement / AI quota are required only for LINE AI-assisted recording/provider work that charges the Owner.
- If the Owner leaves or the subscription expires, active group members retain historical read/edit access and may continue manual PWA record creation.

### Edit auditability

- Preserve original user-provided content/reference as immutable source-of-truth where practical.
- Store edited/normalized fields separately enough to diagnose original input versus AI/user changes.
- Record edits and manual creates should retain actor/editor identity and timestamp in audit/history where supported.

`pwaEditing` is not a plan capability and must not reappear in Admin plan capability differences.

## Query behavior

- No natural-language record search in V1.
- PWA search/filter starts with customer name, project name, time and record type/status where useful.
- Group users can access historical/manual records from groups in which they are currently active members, independent of the current Owner's paid/AI entitlement.
- OA users may see personal and accessible group records, clearly separated.

## LINE OA behavior

### Rich menu

Primary actions:

1. 使用教學
2. 查看紀錄
3. 付款訂閱
4. 意見回饋

The help flow must explain private/group AI recording, PWA manual recording, query links and record-edit links.

### OA friendship state

Track at least LINE user id, display name when resolvable, OA friend status, first-added timestamp when known, friendship lifecycle timestamp, last interaction timestamp and updated timestamp.

## Group ownership and AI billing

### Owner binding

- LINE Bot `join` webhooks do not reliably identify who invited the Bot.
- Current MVP uses explicit `@AFTERTRACE 啟用` to bind the group Owner/subscription payer.
- Persist stable `owner_user_id` and subscription billing ownership.
- A claim must never overwrite a different Owner who is still active in the group.

### Owner leaves the group

Owner presence is required only for new LINE AI-assisted group recording/provider spend.

- `memberLeft` marks the Owner inactive when available.
- Owner absence does not remove historical/manual PWA access from other active group members.
- A new LINE AI-assisted recording attempt is suspended before quota/provider spend.
- Preferred reply:
  `目前群組 Owner 已不在此 LINE 群組，AFTERTRACE 已暫停 AI 快速紀錄。請要負責此群組訂閱的人輸入「@AFTERTRACE 啟用」完成帳號綁定；既有紀錄仍可在網頁查看、手動新增與修改。`
- While Owner is absent, an active member may run `@AFTERTRACE 啟用` and become the new Owner.
- After successful rebind, the old Owner returning later does not automatically regain ownership.
- If nobody rebinds and the original Owner later rejoins, the existing Owner binding remains theirs and LINE AI-assisted recording resumes when entitlement/quota permit.

### Group AI billing

- Group AI usage is charged to the current bound Owner/subscriber, never silently to the acting member.
- Retain actor user id and charged/billing user id.
- Owner presence, active paid group entitlement and available AI allowance are checked before provider calls.

### Group-count policy

There is **no paid-plan maximum group count** in the current product model.

Rationale:

- AI allowance already bounds variable AI cost;
- users may distribute that allowance across any number of groups;
- limiting group count adds product friction without materially protecting AI cost;
- manual PWA use remains free and should not be artificially constrained by group count.

Therefore:

- remove `maxGroupCount` from plan capabilities, Admin configuration, entitlement checks and customer-facing plan differences;
- paid group collaboration is an on/off capability only;
- any number of bound groups may use the Owner's shared AI allowance while the Owner/paid entitlement/quota checks pass;
- FREE remains personal-only unless the product later changes the FREE group-collaboration rule.

### Member recording permission

- Owner may enable/disable another member's ability to create new LINE AI-assisted records on behalf of that Owner.
- This permission does not block historical read/edit or manual PWA record creation by active group members.

## Data principles

### Source of truth

Always preserve original user-provided content/reference. AI output is derived metadata and may be corrected/regenerated.

### Customer

Keep fixed shape small: name/display name, optional phone/address and note.

### Project

Keep fixed shape small: customer, name, optional address, status and note.

### Record

Retain at least workspace/source, LINE message/quoted id when applicable, author user id, original raw input or attachment metadata/reference, normalized summary, category, customer/project links, input type, creation/edit timestamps and creation mode (`LINE_AI` / `PWA_MANUAL` or equivalent).

Input types must support at least TEXT, AUDIO, IMAGE and FILE.

### Finance

Amounts requiring arithmetic use deterministic numeric fields/tables; AI text is never accounting truth.

## Subscription plan model

Subscription configuration is data-driven.

### Initial launch plan matrix

#### FREE

- display name: `FREE`
- price: NT$0
- billing type: `ONE_TIME`
- AI allowance: **500 units one time**
- allowance has no calendar expiry and never refreshes; remaining units stay available until consumed
- `privateOaRecording = true`
- `groupCollaboration = false`
- `aiTextRecording = true`
- `aiMediaIngestion = true`
- `export = false`
- manual PWA read/create/edit: always available in authorized private scope

#### PRO

- display name: `PRO`
- price: **NT$99/month**
- billing type: `MONTHLY`
- AI allowance: **500 units per successful monthly period**
- `privateOaRecording = true`
- `groupCollaboration = true`
- no maximum group count
- `aiTextRecording = true`
- `aiMediaIngestion = true`
- `export = true`
- manual PWA read/create/edit: always available in authorized private/group scopes

#### TEAM

- display name: `TEAM`
- price: **NT$299/month**
- billing type: `MONTHLY`
- AI allowance: **2500 units per successful monthly period**
- `privateOaRecording = true`
- `groupCollaboration = true`
- no maximum group count
- `aiTextRecording = true`
- `aiMediaIngestion = true`
- `export = true`
- manual PWA read/create/edit: always available in authorized private/group scopes

Suggested ranks: FREE 0, PRO 10, TEAM 20.

These AI allowances are launch defaults and must be rechecked with real Gemini usage/cost before production pricing is frozen.

## AI allowance sources

A user's spendable AI balance may come from more than one source.

### Plan-period allowance

- FREE one-time initial grant or paid MONTHLY period allowance.
- Paid monthly allowance is refreshed only by confirmed successful renewal.
- Unused paid monthly plan allowance does not roll into the next paid period.

### One-time AI top-up

Users may purchase additional AI allowance as a separate one-time product.

Rules:

- a top-up is not a subscription plan and does not change FREE/PRO/TEAM plan identity;
- purchased top-up units do not auto-refresh;
- purchased top-up units should not disappear merely because a monthly billing period ends;
- top-up purchases must be separately auditable by purchase/payment id;
- provider-success usage settlement may consume from the user's aggregate available AI balance according to a deterministic bucket order;
- recommended bucket order is **current plan-period allowance first, then purchased top-up allowance**, so paid top-up units are preserved until needed;
- top-up pricing/pack sizes remain configurable and should be finalized after real Gemini cost measurement.

When a monthly subscriber exhausts their included AI allowance, product UX should offer both:

- continue manually in PWA for free;
- buy a one-time AI top-up to resume fast LINE AI recording immediately.

## Billing type and renewal

Initial billing types:

- `ONE_TIME`: grant/purchase once; no calendar refresh.
- `MONTHLY`: each confirmed successful renewal starts a new billing/quota period.

Plan billing cadence is separate from one-time AI top-up products.

Paid MONTHLY rules:

- successful renewal creates exactly one next plan-period allowance;
- reaching a calendar boundary alone creates no new paid quota;
- unused monthly plan allowance does not roll over;
- top-up balance is not erased by monthly period rollover;
- plan-template changes do not mutate existing quota snapshots.

### Recurring payment requirement

Paid MONTHLY plans require provider-supported recurring authorization/token/mandate/MIT equivalent. Renewals/webhooks must be idempotent; failed renewal creates no new plan-period quota; cancellation stops future charges without deleting historical usage or purchased top-up balance. Never store raw card data.

Payment provider remains undecided.

## AI quota and provider accounting

- Quota reservation is preflight only; real provider usage must be recorded even when actual usage exceeds estimate.
- Provider-success result must never be released merely because settlement is delayed/expired/over estimate.
- Provider-dollar cost and customer-facing allowance units are distinct concepts.
- Prompt modality subsets must not be double-counted.
- Thinking/reasoning tokens must be included when billed by provider.
- Usage events retain provider/model/pricing snapshot, actor, charged user, source/workspace/record references and timestamp.
- Balance accounting must distinguish plan-period grants from one-time top-up grants so rollover/expiry semantics remain correct.

## AI runtime

Current production target remains the approved Gemini 3.5 model configured for AFTERTRACE. Do not add Gemini 2.5 compatibility branches unless a future model migration explicitly requires them.

- Use Gemini 3.x thinking controls with a cost-conscious level suitable for structured extraction.
- Include `usageMetadata.thoughtsTokenCount` in output/provider cost and quota accounting.
- Reservation estimates should account for thinking policy while exact settlement remains authoritative.

Admin AI pricing supports input, output/thinking, optional modality-specific prices and FX conversion. Historical usage cost is immutable.

## Attachment/file scope

MVP input targets: text, image, audio, PDF, common text-like files, XLSX/Excel and DOCX/Word.

For DOCX/XLSX, prefer the simplest verified provider-native Files/File Search path supported by the selected Gemini model/API. Do not build custom ZIP/XML extraction unless provider-native ingestion fails the required one-shot LINE workflow or loses necessary information.

At minimum enforce file-size/request-size limits, allowed MIME/extension checks, correct MIME, provider upload/import failure handling, no permanent raw Office binary storage unless approved, and real Gemini E2E verification.

## Export

Export is MVP.

- `export` remains a paid capability.
- MVP may start with CSV usable by Excel/Google Sheets.
- Export authorization is server-side.
- Private export only includes the user's private scope.
- Group export visibility follows group historical-access rules.

## Internal Admin

Admin supports username/password + HMAC session, anomalies, feedback, users/groups/plans/quota, AI pricing, manual subscription changes and audit.

Plan capabilities currently intended for Admin:

- private OA AI-assisted recording
- group AI-assisted collaboration
- AI text recording
- AI media ingestion
- export
- future real paid features only

Do not re-add `maxGroupCount` or record editing as plan capabilities.

Admin also needs management/reporting for one-time AI top-up products and purchased top-up balances.

## Platform and deployment

MVP stack: TypeScript/Node ecosystem, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Internal Admin, PostgreSQL + Drizzle.

Deploy as three Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`. No new Cloudflare Pages work.

## Prelaunch database policy

The product is not live yet and development/production databases may be destructively rebuilt while schema is finalized. Current repository schema/migration history is authoritative. Once real production user data exists, destructive resets stop and forward-only migration discipline becomes mandatory.

## Feedback

PWA exposes lightweight feedback for confusing flow, AI mistakes, missing features or general suggestions and should attach useful context when practical.
