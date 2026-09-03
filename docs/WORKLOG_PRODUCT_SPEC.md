# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a LINE-first work-record assistant for individual tradespeople and small crews.

Primary surfaces:

- LINE OA private chat: personal/private work records, subscription entry, feedback, help.
- LINE group bot: shared work-record surface for crews/projects.
- Web/PWA: browse, filter, edit, organize and export records; manage customers/projects/finance; owner usage/member controls.
- Internal Admin: users/groups/plans/quota, AI pricing, anomalies, feedback and audit.
- AI: Gemini 3.5 normalizes human input into concise work records. AI output is derived and must remain editable by users.

## LINE interaction contract

### Record commands

- `@AFTERTRACE <text>` records text.
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
- The edit link is a durable PWA deep link containing the durable record id. It does **not** need to be a short-lived signed entry URL merely because it came from LINE.
- PWA authentication/authorization remains authoritative. If the browser is not signed in, normal LINE Login/session flow occurs and the app returns to the requested record after authentication.
- Knowing or sharing a record id/URL never grants access by itself. The record API must re-check the authenticated user's private/group access every time.
- LINE replies should stay concise enough for mobile use.

### Open records

- `@AFTERTRACE 查詢` returns a Web/PWA entry URL.
- Ordinary PWA routes use normal LINE Login/session authorization; a record deep link may simply carry the record id and does not require one-time expiry semantics.
- LIFF is not required for MVP.

## PWA record visibility and editing

Record correction is a **baseline product function**, not a paid capability. AI can misunderstand field input, therefore every plan including FREE must allow authorized users to correct existing records.

Historical read/edit authorization is deliberately separated from the entitlement required to create **new** records or spend AI quota.

### Private OA records

- Only the owning LINE/OA user may view/edit their private records.
- Other group members, unrelated users, and other subscribers must never gain edit access to another user's private records.
- Losing AI quota or changing paid subscription state does not remove the owner's ability to read/edit existing private records.

### Group records

- Any currently active member of that LINE group may view and edit existing records belonging to that group.
- Editing a group record is collaborative; it is not Owner-only and does not consume AI quota.
- Member recording permission controls creating **new** records, not reading/editing existing group history.
- Owner presence is **not** required to read or manually edit existing records.
- Paid-plan validity is **not** required to read or manually edit existing records.
- `groupCollaboration` / `maxGroupCount` limits are creation/active-recording entitlements; expiry/downgrade/over-limit state must not hide or lock historical records from active group members.
- If the Owner leaves, members retain historical read/edit access while new recording/AI work is suspended until an eligible Owner returns or is rebound.

### Edit auditability

- Preserve original user-provided content/reference as immutable source-of-truth where practical.
- Store edited/normalized fields separately enough to diagnose what the user originally submitted versus what AI/user later changed.
- Record edits should retain editor identity and edit timestamp in audit/history where supported.

`pwaEditing` is therefore **not a plan capability** and must not appear in Admin plan capability configuration or subscription benefit differences.

## Query behavior

- No natural-language record search in V1.
- PWA search/filter starts with customer name, project name, time and record type/status where useful.
- Group users can access historical records from groups in which they are currently active members, independent of the current Owner's paid/AI entitlement.
- OA users may see personal and accessible group records, clearly separated rather than merged into an ambiguous timeline.

## LINE OA behavior

### Rich menu

Primary actions:

1. 使用教學
2. 查看紀錄
3. 付款訂閱
4. 意見回饋

The help flow must explain private/group recording, Reply + `@AFTERTRACE`, query links and record-edit links.

### OA friendship state

Track at least:

- LINE user id
- display name when resolvable
- OA friend status
- first-added timestamp when known
- OA friendship lifecycle timestamp
- last interaction timestamp
- updated timestamp

## Group ownership and billing

### Owner binding

- LINE Bot `join` webhooks do not reliably identify who invited the Bot. Do not guess the inviter from the first speaker or synthetic `source.userId`.
- Current MVP uses explicit `@AFTERTRACE 啟用` to bind the group Owner/subscription payer.
- Persist stable `owner_user_id` and subscription billing ownership.
- A claim must never overwrite a different Owner who is still active in the group.

### Owner leaves the group

- Owner membership presence is required for **new group recording and any new AI/provider spend**, not for historical read/manual edit.
- LINE `memberLeft` is used to mark the Owner inactive when that event is received; LINE group member APIs may be used for defensive verification/E2E where needed.
- Once the bound Owner is absent, suspend new record creation/AI work before quota/provider spend. Keep historical group records readable/editable by active members.
- Preferred reply when a member tries to create a new record while Owner is absent:
  `目前群組 Owner 已不在此 LINE 群組，AFTERTRACE 已暫停新增紀錄。請要負責此群組訂閱的人輸入「@AFTERTRACE 啟用」完成帳號綁定。`
- While the Owner is absent, an active member may run `@AFTERTRACE 啟用` and become the new Owner.
- After successful rebind, the old Owner returning later does not automatically regain ownership.
- If nobody rebinds and the original Owner later rejoins, the existing stable Owner binding remains theirs and new group recording resumes when their membership is active again.

### Group AI billing

- Group AI usage is charged to the current bound Owner/subscriber, never silently to the acting member.
- Retain both actor user id and charged/billing user id on AI usage.
- Paid entitlement, max-group entitlement, Owner presence and quota are checked before any new AI/provider call.

### Member recording permission

- Owner may enable/disable another member's ability to create new records.
- Owner cannot disable their own record-creation permission while they remain Owner.
- Historical records/usage remain visible/editable according to access rules even after future-recording permission is disabled.

## Group collaboration and max group count

- `groupCollaboration` controls whether a plan may create/use new LINE group recording activity.
- `maxGroupCount` limits groups that may perform new record creation/AI activity; it is not a historical-data visibility limit.
- FREE is personal-only and has `maxGroupCount = 0`.
- Paid Owner groups are ordered by stable ownership/binding time with deterministic tie-breaker; only the first `maxGroupCount` active groups may create new records while that entitlement is current.
- Over-limit groups reject **new record/AI activity** before provider work, but active members keep read/manual-edit access to existing history.
- Missing/malformed group limit fails closed for new recording/provider activity, not for historical access.
- Web/PWA write/read APIs must keep this distinction explicit so future endpoints do not accidentally use paid-entitlement checks as a historical-data lock.

Preferred no-capability message for new recording:
`目前 {{方案顯示名稱}} 方案沒有開啟群組紀錄功能，升級方案後即可在 LINE 群組新增紀錄。`

Preferred over-limit message for new recording:
`目前 {{方案顯示名稱}} 方案最多可使用 {{maxGroupCount}} 個 LINE 群組新增紀錄，已超過方案上限。請停用其他群組或升級方案。`

## Data principles

### Source of truth

Always preserve the original user-provided content/reference. AI output is derived metadata and may be corrected/regenerated.

### Customer

Keep fixed shape small:

- name/display name
- phone optional
- address optional
- note

### Project

Keep fixed shape small:

- customer
- name
- address optional
- status
- note

### Record

Retain at least:

- workspace/source
- LINE message / quoted message id where applicable
- author user id
- original raw text or attachment metadata/reference
- normalized summary
- category
- customer/project links when confidently resolved
- input type
- created/edited timestamps

Input types must support at least TEXT, AUDIO, IMAGE and FILE.

### Finance

Amounts requiring arithmetic use deterministic numeric fields/tables; do not rely on free-form AI text as accounting truth.

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
- `maxGroupCount = 0`
- `aiTextRecording = true`
- `aiMediaIngestion = true`
- `export = false`
- record editing: always available to the authorized private user

#### PRO

- display name: `PRO`
- price: **NT$99/month**
- billing type: `MONTHLY`
- AI allowance: **500 units per successful monthly period**
- `privateOaRecording = true`
- `groupCollaboration = true`
- `maxGroupCount = 3`
- `aiTextRecording = true`
- `aiMediaIngestion = true`
- `export = true`
- record editing: always available to authorized private/group users

#### TEAM

- display name: `TEAM`
- price: **NT$299/month**
- billing type: `MONTHLY`
- AI allowance: **2500 units per successful monthly period**
- `privateOaRecording = true`
- `groupCollaboration = true`
- `maxGroupCount = 20`
- `aiTextRecording = true`
- `aiMediaIngestion = true`
- `export = true`
- record editing: always available to authorized private/group users

Suggested ranks: FREE 0, PRO 10, TEAM 20.

These AI allowances are launch defaults and must be rechecked with real Gemini 3.5 usage/cost before production pricing is frozen.

## Billing type and renewal

Initial billing types:

- `ONE_TIME`: grant once; no calendar refresh.
- `MONTHLY`: each confirmed successful renewal starts a new billing/quota period.

Rules:

- billing cadence is a first-class plan field, not capability JSON.
- Admin exposes billing type explicitly.
- FREE is ONE_TIME and never resets automatically.
- Paid MONTHLY gets new allowance only after confirmed renewal success.
- Reaching the date boundary alone must not create paid quota.
- Unused monthly allowance does not roll over.
- Plan-template changes do not mutate already-created current-period quota snapshots.
- Future QUARTERLY/YEARLY types are added only when actually offered.

### Recurring payment requirement

Paid MONTHLY plans require provider-supported recurring authorization/token/mandate/MIT equivalent.

- initial checkout obtains provider-approved recurring authorization;
- renewals are idempotent;
- successful renewal creates exactly one next subscription/quota period;
- failed renewal creates no new quota and moves to an appropriate state such as PAST_DUE;
- duplicate provider events cannot duplicate quota periods;
- cancellation stops future renewal without deleting history;
- never store raw card data.

Payment provider remains undecided.

## AI quota and provider accounting

- Quota reservation is preflight only; real provider usage must be recorded even when actual usage exceeds the estimate.
- Provider-success result must never be released merely because settlement is delayed/expired/over estimate.
- Provider-dollar cost and customer-facing allowance units are related but distinct concepts.
- Prompt modality subsets must not be double-counted.
- Thinking/reasoning tokens must be included when billed by provider.
- Usage events retain provider/model/pricing snapshot, actor, charged user, source/workspace/record references and timestamp.

## AI runtime

Current production target remains the approved Gemini 3.5 model configured for AFTERTRACE. Do not add Gemini 2.5 compatibility branches unless a future model migration explicitly requires them.

- Use Gemini 3.x thinking controls with a cost-conscious level suitable for structured extraction.
- Current runtime should not keep legacy hard-coded low temperature overrides when model defaults are preferred.
- Include `usageMetadata.thoughtsTokenCount` in output/provider cost and quota accounting.
- Reservation estimates should account for the configured thinking policy while exact settlement remains authoritative.

Admin AI pricing supports input, output/thinking, optional modality-specific prices and FX conversion. Historical usage cost is immutable.

## Attachment/file scope

MVP input targets:

- text
- image
- audio
- PDF
- common text-like files (TXT/CSV/JSON/XML/Markdown where practical)
- XLSX / Excel
- DOCX / Word

### DOCX / XLSX provider-path rule

Do not assume that “Gemini 3.5 Flash-Lite supports File Search for DOCX/XLSX” means raw Office MIME bytes are accepted by the current direct `generateContent`/`inlineData` path.

Current Google API documentation distinguishes these paths:

- Gemini 3.5 Flash-Lite supports File Search, and File Search lists DOCX/XLSX MIME types as supported ingestion formats.
- The Gemini 3.5 Flash-Lite model input card lists native inputs as text, image, video, audio and PDF.
- Direct GenerateContent/file-input support is narrower and may reject Office MIME types.

Therefore AFTERTRACE should prefer the simplest provider-native path that is actually verified for the selected model/API. If DOCX/XLSX can be uploaded/imported through the supported Files/File Search flow and then consumed reliably, **do not build a custom ZIP/XML parser unnecessarily**.

At minimum enforce:

- file-size/request-size limits;
- explicit allowed MIME/extension checks;
- correct Office MIME type supplied to Google;
- provider upload/import failure handling;
- no permanent raw Office binary storage unless later approved;
- real Gemini E2E verification for representative XLSX/DOCX before claiming production support.

Only add a custom Office extraction/conversion layer if the provider-native path does not support the required one-shot LINE attachment flow or loses information needed by the product.

## Export

Export is MVP.

- `export` remains a paid-plan capability.
- MVP may start with CSV, usable by Excel/Google Sheets.
- Export authorization must be enforced server-side.
- Private exports only include the user's private scope.
- Group export visibility follows the historical group-access rule; current paid entitlement must not silently erase access to records the active member is otherwise allowed to see.
- Rich XLSX export formatting can be added later; XLSX input support is separate.

## Internal Admin

Admin supports:

- username/password + HMAC session
- overview/operational anomalies
- user/group lookup
- plan price/billing type/quota/capabilities
- AI model/pricing
- manual subscription changes
- feedback
- audit log

Plan capabilities currently intended for Admin are:

- private OA recording
- group collaboration
- max group count
- AI text recording
- AI media ingestion
- export
- future real paid features only

Do not re-add record editing as a plan capability.

Admin current quota presentation must reflect real effective subscription state rather than stale plan templates/expired rows.

## Platform and deployment

MVP stack:

- TypeScript/Node ecosystem
- Hono on Cloudflare Workers API
- React/Vite Web/PWA
- React/Vite Internal Admin
- PostgreSQL + Drizzle

Deploy as three Workers:

1. `aftertrace-api`
2. `aftertrace-web`
3. `aftertrace-admin`

No new Cloudflare Pages work.

## Prelaunch database policy

The product is not live yet and both development and production databases may be rebuilt/destructively reset while the schema is still being finalized.

Therefore:

- current repository schema/migration history is authoritative;
- do not preserve obsolete migration compatibility merely for empty/non-live databases;
- when a clean reset is useful, rebuild dev/prod from the current migration baseline rather than maintaining legacy history reconciliation code;
- once real production user data exists, destructive-reset freedom ends and normal forward-only migration discipline becomes mandatory.

## Feedback

PWA exposes lightweight feedback for confusing flow, AI mistakes, missing features or general suggestions and should attach useful page/device/source context when practical.
