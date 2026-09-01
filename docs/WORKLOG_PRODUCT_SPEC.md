# AFTERTRACE Worklog MVP

## Product direction

AFTERTRACE is a LINE-first work-record assistant for individual tradespeople and small crews.

The MVP deliberately separates responsibilities:

- LINE OA private chat: owner entry point for private records and later workspace-level management.
- LINE group bot: lightweight shared recording surface. A group may record anything useful: money, work performed, issues, materials, photos, voice notes, or general notes.
- Web/PWA: browsing, filtering, customer/project detail, editing, workspace settings, export/feedback later.
- AI: used at ingestion time to turn messy human input into a concise record and optional structured metadata. AI is not required for normal PWA search/filter in V1.

## Interaction contract

### Group recording

- `@AFTERTRACE <text>` records the text.
- Reply to an image/audio/file and send `@AFTERTRACE` to record the quoted content.
- If quoted LINE content can no longer be fetched, reply with a clear expired-content message and ask the user to resend.
- Do not ingest all ordinary group chat into permanent product records.

### Open records

- `@AFTERTRACE 查詢` returns a short-lived Web/PWA entry URL.
- The generated entry context should include the LINE group and caller LINE user so edits can be audited.
- The PWA is an ordinary web app; LIFF is not required for the MVP.

### Query behavior

- No natural-language record search in V1.
- PWA search/filter starts with customer name, project name, time, record type/status where useful.
- Group users can only see records originating from that group.
- Owner private management may later aggregate all groups in the workspace.

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

- workspace/group source
- LINE message id and quoted message id when applicable
- author LINE user id when available
- raw text or attachment reference/metadata
- normalized summary
- record category when confidently known
- linked customer/project when confidently resolved
- created/edited timestamps

Suggested record categories are intentionally broad: `NOTE`, `WORK`, `ISSUE`, `PAYMENT`, `EXPENSE`, `MATERIAL`, `PHOTO`, `AUDIO`, `OTHER`.

### Finance

Amounts that need arithmetic must not live only in free-form notes. When financial behavior is implemented, store transaction amount/date/type in fixed numeric fields/table and link it to customer/project/record.

Examples:

- received payment
- expense/material cost
- receivable/outstanding amount when project pricing is later enabled

Invoice integration is explicitly out of MVP. Existing businesses already have invoice workflows; validate demand before integrating Amego or another provider.

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

Do not implement final pricing before usage data. Current hypothesis:

- Personal: LINE OA private workflow
- Collaboration: LINE OA + group bot
- subscription tiers include bounded AI usage rather than unlimited usage

Early validation should optimize for retention and willingness to pay, not infrastructure optimization.

## Feedback

PWA should eventually expose a lightweight feedback entry for issues such as text too small, confusing flow, AI recorded incorrectly, missing feature, or general suggestions. Attach page/device context automatically when practical.
