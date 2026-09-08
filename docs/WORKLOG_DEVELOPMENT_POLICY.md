# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

Before substantive product/domain/schema/runtime work, read in this order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ACCOUNT_IDENTITY_POLICY.md`
3. `docs/WORKLOG_SUPPORT_POLICY.md`
4. `docs/WORKLOG_NOTIFICATION_POLICY.md`
5. `docs/WORKLOG_EXTENSION_POLICY.md`
6. `docs/WORKLOG_ENTITY_MODEL.md`
7. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
8. `docs/WORKLOG_AI_POINT_POLICY.md`
9. `docs/WORKLOG_SUBSCRIPTION_POLICY.md`
10. this file
11. `docs/WORKLOG_DEPLOYMENT.md`
12. `docs/WORKLOG_REBUILD_PROGRESS.md`

The latest documents above are the only product/development specification. Retired LINE-era policy files are intentionally deleted and must not be recreated or used as product authority.

## GitHub Actions / CI policy

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.**

Do not use Actions as validation. Tests may be authored but must not be claimed passed unless actually executed locally/runtime.

Every development commit on this branch must include `[skip ci]`.

## Current architecture direction

AFTERTRACE is **Web + PWA-first** with a committed Chrome extension fast-capture surface.

- LINE is not a Record/group/AI product surface;
- LINE Login remains one provider-neutral authentication provider;
- the official LINE OA remains only an external customer-support contact channel under `WORKLOG_SUPPORT_POLICY.md`;
- no LINE Messaging webhook/runtime is part of the product;
- PWA is capture-first with microphone as the primary action;
- Web is the full timeline/search/edit/group/subscription surface;
- Chrome extension reuses the same account/API/domain model and remains a compact capture surface;
- groups are created in AFTERTRACE and joined through invite links;
- free users get manual CRUD/search/date filtering and non-provider browser speech-to-text where available;
- paid AI entitlement is per user;
- no GROUP AI responsible-user/funding-owner concept exists;
- no automatic AI backfill when a free user subscribes later.

## Account / authentication boundary

Follow `WORKLOG_ACCOUNT_IDENTITY_POLICY.md`.

- Google Login, LINE Login and Apple Login are provider bindings to provider-neutral AFTERTRACE accounts;
- core AFTERTRACE users must not depend on provider ids/emails;
- never silently merge provider identities merely because email matches;
- every account has an immutable opaque public account id for support lookup;
- Admin user search supports exact public account id lookup;
- authenticated Web/PWA account UI exposes notification bell/unread count, display name, public `帳號 ID`, and copy action;
- do not restore LINE bot-entry exchange or LINE Messaging token-based account/session flows.

## Support / feedback boundary

- Web/PWA `意見回饋` uses durable AFTERTRACE feedback records manageable from Admin;
- Web/PWA `聯絡客服` opens the official LINE OA;
- LINE OA does not create/search/edit Records, manage groups, mutate AI entitlement, or synchronize support chats into Admin for MVP;
- no LINE webhook is needed for this support boundary;
- no general-purpose RAG support bot for V1.

## Notification boundary

Follow `WORKLOG_NOTIFICATION_POLICY.md`.

Current categories are exactly `ANNOUNCEMENT | SYSTEM | TASK`; channels are `IN_APP | PUSH`. Task reminders and scheduled announcements use one shared approximately five-minute Cloudflare Worker Cron with bounded idempotent scans. Do not create one Cron per task.

## Chrome extension boundary

Follow `WORKLOG_EXTENSION_POLICY.md`.

The extension reuses the same AFTERTRACE account, native Source/group authorization, Record APIs, AI entitlement and provider-cost accounting. V1 accepts quick text, quick voice, selected webpage text, optional active-page title/URL and explicit visible-page screenshot/image capture. Do not add automatic browsing-history/full-page capture, continuous microphone/screen capture, or a large extension-only sidebar/agent.

## Product behavior boundary

Free/manual Record:

- content;
- nullable user-entered event date/time;
- created timestamp;
- updated timestamp;
- no required AI title/keywords/entities.

Paid AI may add title, keywords/search terms, date interpretation and bounded retrieval metadata for new AI operations only. Do not silently call provider AI during manual CRUD.

## AI features currently accepted

- natural-language text capture;
- AI voice capture;
- image/file/PDF input;
- automatic title/keywords/date;
- bounded extraction metadata for retrieval;
- natural-language search;
- related Records;
- time-range summary;
- explicit AI rewrite;
- task extraction/proposal;
- later grounded Q&A when retrieval quality is sufficient.

## Subscription fair-use / hard-cap rule

Launch commercial shape is exactly FREE + AI_PRO NT$99/month for V1. No one-time AI top-up or additional paid tier exists.

FREE receives one idempotent one-time AI trial grant using Admin-configured initial AI trial points. AI Pro enforces monthly internal point/resource cap, monthly provider-cost hard cap in TWD, optional per-request/modality limits and capability toggles. Provider work fails closed once a hard cap is reached.

## Tasks / reminders

Native AFTERTRACE tasks/reminders + notification center/PWA push are the V1 path. AI may interpret a reminder phrase only as a proposal; persisted schedule/action is deterministic and user-confirmed.

## Retired product code policy

AFTERTRACE is prelaunch and current Dev/Prod data remain disposable. The user has explicitly directed that obsolete product versions be physically removed rather than kept as migration residue.

Therefore:

- do not retain or recreate LINE webhook, 小跡 command, LINE GROUP bot, LINE Reply/cache/attachment runtime, OA product runtime, GROUP AI responsible-user/funding-owner, bot-entry auth, legacy confirmation/title Entity workflow, or ONE_TIME/TOP_UP product code merely for compatibility;
- LINE Login and the external LINE OA support link are the only accepted LINE-related product integrations;
- target runtime, schema exports, tests, docs, env examples and deployment requirements must not depend on LINE Messaging Channel token/secret;
- obsolete tests must be deleted instead of changing expectations to preserve retired behavior;
- legacy schema must be removed from the next regenerated canonical baseline once source references are gone;
- current prelaunch database compatibility is not a reason to keep dead code.

## SQL / PostgreSQL safety rules

Raw SQL and Drizzle templates must avoid PostgreSQL reserved/command keywords as unquoted aliases/CTE names/identifiers. Never use `grant` as a SQL alias; apply the same discipline to `user`, `group`, `order`, `limit`, `offset`, `constraint`, `table`, `column`, etc.

## Database / code rebuild policy

AFTERTRACE is still in prelaunch testing. **Existing Dev and current Prod data are disposable unless the user explicitly changes this rule later.** Databases may be dropped/recreated from a clean canonical target baseline. Prefer the simplest correct target architecture over compatibility with disposable test data.

Safety boundary: once real users or durable production data exist, destructive Prod rebuilds require a new explicit user decision and this policy must be updated first.

The unrelated local untracked `apps/api/verify-admin-schema.mjs` must not be staged/committed unless separately reviewed/approved.

## Validation policy

Do not claim a test passed unless it actually executed and returned PASS. Distinguish `AUTHORED`, `NOT RUN`, `PASS`, `FAIL`, `RUNTIME VERIFIED`.

## Development handoff

Every substantial run updates `WORKLOG_REBUILD_PROGRESS.md` with completed work, commits/files changed, real validation status, remaining blockers, exact next batch and remaining estimate.

## Commit discipline

Prefer small coherent commits. Every normal development commit includes `[skip ci]`. Do not touch GitHub Actions unless the user explicitly asks.