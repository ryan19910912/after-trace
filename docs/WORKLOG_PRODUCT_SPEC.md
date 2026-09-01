# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a LINE-first work-record assistant for individual tradespeople and small crews.

The MVP deliberately separates responsibilities:

- LINE OA private chat: owner entry point for private records, subscription, feedback, and later workspace-level management.
- LINE group bot: lightweight shared recording surface. A group may record anything useful: money, work performed, issues, materials, photos, voice notes, or general notes.
- Web/PWA: browsing, filtering, customer/project detail, editing, workspace settings, personal/group record views, subscription UI, usage/permission management, and feedback.
- Internal admin: lightweight operator console for system health, user feedback, subscription plans/permissions/AI quotas, AI model pricing, user lookup, usage analytics, and manual subscription changes.
- AI: used at ingestion time to turn messy human input into a concise record and optional structured metadata. AI is not required for normal PWA search/filter in V1.

## Interaction contract

### Group recording

- `@AFTERTRACE <text>` records the text.
- Reply to an image/audio/file and send `@AFTERTRACE` to record the quoted content.
- If quoted LINE content can no longer be fetched, reply with a clear expired-content message and ask the user to resend.
- Do not ingest all ordinary group chat into permanent product records.
- Group members can record whatever they want. AFTERTRACE does not impose a domain restriction on group-record content.
- Recording permission is controlled by the group owner. A group member explicitly disabled by the owner must not be allowed to create new records or consume AI quota for that group.

### Open records

- `@AFTERTRACE 查詢` returns a short-lived Web/PWA entry URL.
- The generated entry context should include the LINE group and caller LINE user so edits can be audited.
- The PWA is an ordinary web app; LIFF is not required for the MVP.

### Query behavior

- No natural-language record search in V1.
- PWA search/filter starts with customer name, project name, time, record type/status where useful.
- Group users can only see records originating from that group.
- A user who is also a LINE OA friend may see both personal and group records in the PWA, with clearly separated sections/tabs.
- If a user enters from a group link and is also linked as an OA friend, the PWA should still expose both that user's personal records and the accessible group records.
- Owner/private OA may aggregate all groups in the workspace and expose settings/subscription actions.

## LINE OA behavior

### Rich menu / bottom menu

The LINE OA private chat should expose a simple button menu with these primary actions:

1. 使用教學
2. 查看紀錄
3. 付款訂閱
4. 意見回饋

Behavior:

- 使用教學: explain how to record in private OA and group, how Reply + `@AFTERTRACE` works for audio/image, and how `@AFTERTRACE 查詢` opens the PWA.
- 查看紀錄: open the Web/PWA for the current user.
- 付款訂閱: open subscription UI. Implement UI and backend plan/checkout intent first; payment provider is intentionally undecided.
- 意見回饋: open feedback UI or accept a structured feedback flow.

### Human-support fallback

- `@AFTERTRACE ...` is reserved for product commands / AI-assisted recording.
- Ordinary private LINE OA text without the `@AFTERTRACE` trigger should not be auto-treated as an AI record command.
- Ordinary OA text is intended for human customer service/manual operator response.
- The system should preserve enough context to distinguish automated product interactions from human-support conversations.

### OA friendship state

The database must track whether a LINE user has added the LINE OA / is currently considered an OA friend when LINE events make that state available.

At minimum keep:

- LINE user id
- display name when resolvable
- OA friend status
- first-added / linked timestamp when known
- last interaction timestamp
- updated timestamp

This state is important because OA-friend users get a personal record surface in addition to any group record surfaces they can access.

## Group ownership and AI billing

### Group owner

- The LINE user who causes/initiates the Bot being added to a group becomes the AFTERTRACE owner for that group when the LINE event/context allows the actor to be identified reliably.
- Persist a stable `owner_user_id` relationship on the group/source context; do not recompute ownership from whichever member happens to interact most recently.
- If LINE does not expose the actor for a join/add event in a reliable way, use an explicit owner-claim/binding flow rather than guessing.
- Owner transfer can be added later if real users need it; the data model should not make transfer impossible.

### AI quota charging for groups

- Group AI usage is charged against the group's owner/subscriber AI allowance, not against the member who typed the record.
- Every group AI usage event must retain both:
  - actor user id: the member who triggered the AI work
  - charged user id / billing owner id: the group owner whose AI allowance is consumed
- Quota preflight must check the charged owner before calling the provider.
- If the owner's AI allowance is exhausted, group AI recording should fail cleanly without silently charging another member.
- Admin and owner usage views must be able to distinguish personal AI usage from group AI usage and attribute group usage to individual actors.

### Member recording permission

- The group owner can enable/disable whether each other group member may create AFTERTRACE records.
- Default policy for active group members may be allowed, but owner must be able to block unrelated/noisy participants explicitly.
- Persist per-group-member recording permission, e.g. `can_record`/`recording_enabled`.
- A blocked member may still be shown in member usage/history if they have historical activity, but new `@AFTERTRACE` record commands must be rejected before AI/provider usage.
- Group owner always retains recording/configuration permission unless the group subscription itself is inactive/blocked.

## PWA record surfaces

### Personal OA view

A LINE OA friend can view personal/private records created through the OA.

### Group view

A group entry can view only records created from that group.

### Combined user view

If the current user is both an OA friend and a member/participant of one or more subscribed groups, the PWA should clearly separate:

- 個人紀錄
- 群組紀錄

Do not merge these into one ambiguous timeline by default.

### Group owner usage/settings view

For each owned/subscribed group, the owner PWA must show:

- current owner AI allowance/quota applicable to the group
- current-cycle AI usage
- remaining AI allowance
- group AI usage/cost summary where practical
- per-member record counts:
  - TEXT
  - AUDIO
  - IMAGE
  - FILE
- per-member AI usage attributable to that member's actions
- member recording permission status
- control to enable/disable each member's ability to create records

The group owner view is operational/usage management, not a complex HR/role system.

## Data principles

### Source of truth

Always preserve the original user-provided content/reference. AI output is derived metadata and can be regenerated.

### Customer

Keep the fixed shape intentionally small:

- name / display name
- phone (optional)
- address (optional)
- note (free text)

### Project

Keep the fixed shape intentionally small:

- customer
- name
- address (optional)
- status
- note (free text)

Do not add industry-specific custom-field machinery in the MVP. Free-form notes cover non-computational metadata until repeated real-world demand proves a fixed field is necessary.

### Record

A work record should retain at least:

- workspace/group/private source
- LINE message id and quoted message id when applicable
- author LINE user id when available
- raw text or attachment reference/metadata
- normalized summary
- record category when confidently known
- linked customer/project when confidently resolved
- record media/input type
- created/edited timestamps

Suggested record categories are intentionally broad: `NOTE`, `WORK`, `ISSUE`, `PAYMENT`, `EXPENSE`, `MATERIAL`, `PHOTO`, `AUDIO`, `OTHER`.

Track a normalized record/input-type value so usage can be aggregated at least as:

- TEXT
- AUDIO
- IMAGE
- FILE

### Finance

Amounts that need arithmetic must not live only in free-form notes. When financial behavior is implemented, store transaction amount/date/type in fixed numeric fields/table and link it to customer/project/record.

Examples:

- received payment
- expense/material cost
- receivable/outstanding amount when project pricing is later enabled

Invoice integration is explicitly out of MVP. Existing businesses already have invoice workflows; validate demand before integrating Amego or another provider.

## Subscription and permission model

Subscription must be data-driven, not hard-coded into frontend conditionals.

### Plan levels

Support operator-defined plan codes such as:

- FREE
- SUB1
- SUB2
- future additional levels

Admin can configure for each level:

- display name
- monthly/subscription price
- enabled/disabled status
- ordered rank/level
- AI quota / allowance
- feature permissions/capabilities

Examples of permissions/capabilities that may be toggled per plan:

- private OA recording
- group collaboration
- max group count
- AI text recording
- audio/image AI ingestion
- record history retention level
- PWA editing
- export
- other future paid features

Do not assume the final permission matrix yet; model it flexibly enough to add capability flags without a schema rewrite for every new plan feature.

### AI quota semantics

Each plan must have an operator-editable AI allowance. Do not hard-code a specific unit definition into the product spec yet; the implementation may use AI units/credits derived from provider cost and input type.

At minimum the system must support:

- configured AI allowance per plan/billing cycle
- current user AI usage for the active cycle
- remaining AI allowance
- group usage charged to owner/subscriber while retaining the triggering actor
- usage events that retain enough provider/model/token information to recalculate or audit cost later
- admin override/adjustment when needed later

Do not offer unlimited AI usage by default.

### User subscription state

Admin must be able to manually change a subscribed user's plan level.

Track at least:

- current plan code
- subscription status
- effective/start time
- end/renewal time when known
- source of assignment (`PAYMENT`, `ADMIN`, `FREE`, etc.)
- updated time

Payment provider is intentionally undecided. Build the subscription domain, plan configuration, UI, and checkout-intent boundary first.

### Free versus collaboration

Current product rule:

- FREE users are personal-only.
- Group/collaboration use requires a paid plan that enables group capability.

## AI runtime configuration

AI provider/model economics must be operator-configurable so model migrations and pricing changes do not require a code deploy.

Admin settings must allow editing at least:

- active model/provider identifier
- input token price per 1M tokens
- output token price per 1M tokens
- audio/image pricing fields if the selected provider bills them separately
- optional exchange rate / cost conversion inputs if user-facing quota logic depends on TWD
- effective/update timestamp

The runtime should read current AI configuration from DB-backed settings (with safe deployment defaults/fallbacks if needed), not scatter model names/prices across code.

Each AI usage event should record enough immutable snapshot data to understand historical cost even after admin changes the current price/model, such as:

- model/provider used
- input tokens/units
- output tokens/units
- media/audio input units when applicable
- pricing snapshot or computed provider cost at execution time
- actor user id
- charged/billing-owner user id
- group/workspace/source where relevant
- created time

Changing the configured model or token pricing should affect future calls/estimates, not rewrite historical usage costs.

## Internal admin console

The admin is an internal operational tool, not a public customer surface.

### Authentication

- Keep security intentionally lightweight for MVP.
- Use one configured/default username + password login.
- No multi-admin roles, SSO, OAuth, MFA, or complex permission model initially.
- Do not expose admin routes publicly without at least this login boundary.

### System monitoring / anomalies

Admin should provide an operational overview for unusual system behavior, including at minimum surfaces for:

- failed LINE webhook handling
- LINE reply/content-fetch failures
- AI provider/parse failures
- DB/API errors captured by the application
- failed or expired quoted-content retrieval
- repeated/duplicate processing anomalies when detected
- other actionable runtime error records

Prefer storing structured application error/incident events so the admin can browse recent failures instead of relying only on Cloudflare logs.

Useful fields:

- type/category
- severity
- user id when known
- group id when known
- request/message reference when safe
- summary/error code
- created time
- resolved/ignored status later if useful

### User feedback admin

Feedback list must show:

- user id
- LINE display name
- channel: `LINE_OA` or `PWA` (the user called it RWA; use PWA internally unless the product intentionally renames it)
- feedback text
- timestamp
- optional page/device/context metadata

PWA feedback should automatically attach useful context when practical, such as page, viewport/device, app version, and current source context.

### User list

Primary list scope: users who have added / linked the LINE OA.

Filters:

- plan level
- user id
- LINE nickname/display name
- type: individual or group-enabled/collaboration

Current rule: FREE should only be individual/personal.

Columns:

- user id
- LINE nickname/display name
- current plan level
- group id(s) if subscribed for group/collaboration
- current AI quota/allowance
- current-cycle AI usage
- remaining AI allowance
- text record count
- audio record count
- image record count
- file record count
- last input/interaction time
- updated time
- detail action

Behavior:

- allow sorting by updated time, at minimum ascending/descending.
- user detail opens a related-user/group view.
- usage/count columns should come from reliable stored counters or aggregates and must remain consistent with source records/usage events.

### User detail / related group users

When opening a user's detail:

- show the user's subscription/profile summary
- show current AI quota/usage/remaining allowance
- show record counts by TEXT/AUDIO/IMAGE/FILE
- show the group(s) linked to that user's collaboration subscription when applicable
- identify whether this user owns each group
- show all other users in the selected/related group, excluding the current user

Related-user list should show the same core columns as the main user list where applicable:

- user id
- nickname
- plan level when applicable
- group id
- AI usage attributable to that member's actions
- TEXT/AUDIO/IMAGE/FILE record counts
- recording-enabled/disabled status
- last input time
- updated time
- detail if useful

No filters are required inside this related-user list for MVP.

### Group ownership in admin

Admin must be able to see:

- group id
- group owner user id / display name
- how ownership was established/bound
- owner current AI quota/usage/remaining
- group-level AI usage charged to that owner
- member-level AI usage attribution
- member record counts and recording permission status

This is important for diagnosing unexpected quota burn or unauthorized/noisy recording.

### Subscription plan management

Admin must support:

- create/edit plan levels/codes such as FREE, SUB1, SUB2
- edit displayed subscription price
- edit AI quota/allowance per plan
- enable/disable permissions/capabilities for each plan
- view plan assignment on users
- manually change a user's plan level

Changes should be auditable with a lightweight admin audit log if practical.

### AI model/pricing management

Admin must support editing the active AI runtime economics without deploying code:

- active model/provider name/id
- input price
- output price
- separate audio/image/media price fields if needed by provider
- optional FX/cost-conversion settings used for plan/quota design

The admin should also surface enough recent/global AI usage and cost data to help decide whether FREE/SUB1/SUB2 AI quotas are sustainable.

## AI scope

Use AI only where it removes input friction:

- normalize short natural-language work records
- extract broad category, customer/project hint, amount/date when relevant
- summarize long field reports
- understand audio/image input directly with a multimodal model

Do not make AI the source of accounting truth. Database queries and calculations remain deterministic.

## Platform

Keep the existing stack for MVP:

- TypeScript / Node ecosystem
- Hono on Cloudflare Workers
- React + Vite on Cloudflare Pages
- PostgreSQL + Drizzle

Re-evaluate infrastructure only after real paid usage demonstrates a concrete limitation.

## Subscription hypothesis

Do not lock final pricing before usage data. Current product shape is:

- FREE: personal-only baseline
- SUB1 / SUB2 / future levels: configured by admin
- collaboration/group access is a paid capability
- every plan has a bounded, operator-editable AI allowance rather than unlimited usage
- group usage burns the owning subscriber's allowance

Early validation should optimize for retention and willingness to pay, not infrastructure optimization.

## Feedback

PWA must expose a lightweight feedback entry for issues such as text too small, confusing flow, AI recorded incorrectly, missing feature, or general suggestions. Attach page/device/context automatically when practical.
