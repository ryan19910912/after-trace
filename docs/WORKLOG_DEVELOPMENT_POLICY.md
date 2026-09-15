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

Latest docs are authoritative. When an older document conflicts with a later explicit user decision, update the documents and follow the latest user decision.

## GitHub Actions / CI

**Do not run, dispatch, rerun, enable, modify, or otherwise trigger GitHub Actions unless the user explicitly asks.** Every normal development commit includes `[skip ci]`. Do not claim tests or runtime validation passed unless they were actually executed.

## Current product architecture

- Web + PWA first;
- `/` remains the Record home page;
- Search stays separate;
- Chrome extension is a compact capture surface;
- LINE is only LINE Login + external LINE OA support contact;
- groups are native AFTERTRACE groups joined by invite link;
- AI entitlement is per user;
- no automatic historical AI backfill.

## Record contract

Manual Record fields are optional user-entered title, required content/raw_text, optional occurred_at, and system timestamps. CRUD supports create/edit/delete-to-recycle-bin/restore and preserves revision history. Home shows latest 10; full browsing/filtering remains on Search.

## FREE / AI boundary

FREE is a complete manual product: Record CRUD, deterministic search, groups, tasks/reminders, notifications and provider-free browser/device speech-to-text.

Each eligible account receives one Admin-configured one-time FREE AI allowance. While points remain, the same shared balance may be used across supported AI capabilities:

- AI text organization;
- natural-language AI Search;
- image/audio/file/PDF AI;
- related Records;
- time-range summaries;
- rewrite;
- task proposals;
- Chrome screenshot AI.

The one-time FREE allowance does not refresh monthly. Backend services, not UI-only checks, enforce point admission/reservation/settlement. When FREE points are exhausted, normal FREE/manual features remain available.

## Paid subscription architecture

The commercial paid catalog is backend-driven.

- Do not hard-code a purchasable plan code such as `AI_PRO` in customer plan filtering, checkout selection, subscription lifecycle, grant creation or paid entitlement SQL.
- Do not hard-code a paid plan price such as NT$99 in checkout/callback validation.
- Admin-created enabled `SUBSCRIPTION` plans are customer-visible automatically when commercially valid.
- Customer checkout sends the selected `planCode`; the API resolves display name, price and limits from PostgreSQL.
- Checkout intent durably stores the selected plan code.
- Provider callback recovers the plan from the checkout intent and validates the charged amount against the selected plan price.
- Lifecycle/history/subscription-period Grants preserve the actual plan code.
- Paid entitlement and provider-cost admission read limits from the user's active paid plan.
- Only one active paid subscription is allowed per user at a time.
- Cancellation stops future renewal but keeps the already-paid period until its end. Re-subscription uses a new checkout after expiry.

NewebPay periodic billing currently requires a positive integer TWD monthly amount. Customer checkout must fail closed / stay disabled for provider-incompatible prices rather than silently rounding.

Internal compatibility names such as entitlement source `AI_PRO` or reason `AI_PRO_GRANT_NOT_READY` may remain to mean “active paid AI entitlement”; they must never be used as a commercial catalog filter by exact plan code.

Do not implement one-time AI top-ups unless the user explicitly changes direction.

## AI media boundary

Recommended default limits are 1 image/request, 5 MB/image, 300 seconds/audio, 10 MB/audio and 10 MB/file. Plan limits live in application plan capabilities, not DB CHECK constraints. Runtime transport ceilings may be higher so plan limits remain authoritative below those ceilings.

Audio duration must traverse Web → API → service and be validated before provider work. Chrome screenshot capture is explicit user action and uses the same FREE/paid entitlement path as Web media AI.

## Customer copy policy

Customer-facing text uses clear Traditional Chinese. Avoid exposing implementation vocabulary such as Source, Grant, runtime, ledger, metadata, optimistic locking or provider-cost internals. Customer plan names/prices come from backend plan definitions.

Admin is internal but still prefers plain Chinese; technical accounting labels remain only where necessary.

## Account/authentication

Follow `WORKLOG_ACCOUNT_IDENTITY_POLICY.md`:

- provider-neutral AFTERTRACE account;
- Google + LINE launch priority;
- Apple when operationally enabled;
- no silent email merge;
- immutable opaque customer 帳號 ID;
- expired/missing database-user sessions clear local state;
- OAuth callback `#session` is consumed/removed so logout cannot rehydrate the old session.

Login onboarding must not fail solely because a non-critical welcome/system notification cannot be created. Notification defects still require fixing; this tolerance is not a substitute for notification correctness.

## Database/schema policy

AFTERTRACE remains prelaunch; Dev data is disposable until production-data policy explicitly changes.

Canonical target is one `drizzle/0000_worklog_baseline.sql` with aligned Drizzle schema/metadata.

Required rules:

- every persistent table/column has PostgreSQL COMMENT metadata;
- no PostgreSQL ENUM for application-domain/status values;
- no business/domain CHECK constraints;
- no stale `::application_enum_type` casts in handwritten SQL after enum removal;
- legal statuses/categories/price rules/cross-field rules live in TypeScript/application services;
- structural PK/FK/UNIQUE/NOT NULL/INDEX/DEFAULT remain in PostgreSQL.

## SQL safety

Avoid PostgreSQL reserved/command words as unquoted aliases/CTE names/identifiers. Never use `grant` as a SQL alias. Apply the same care to `user`, `group`, `order`, `limit`, `offset`, `constraint`, `table`, `column`, etc.

## Notifications/tasks/support

- internal notification categories remain ANNOUNCEMENT / SYSTEM / TASK;
- customer labels are 公告通知 / 系統通知 / 待辦通知;
- in-app notification remains durable even when push fails;
- one shared scheduled worker handles reminders/announcements;
- AI task extraction is suggestion-first and consumes FREE trial or paid entitlement;
- feedback is stored in AFTERTRACE and manageable from Admin;
- LINE OA is support contact only.

## Retired code

Do not restore retired LINE webhook/bot runtime, LINE group command flow, bot-entry auth, GROUP AI funding/responsible-user concepts, legacy Entity confirmation workflow, ONE_TIME/TOP_UP, or obsolete compatibility behavior.

## Validation

Use explicit status words: AUTHORED, NOT RUN, PASS, FAIL, RUNTIME VERIFIED. No validation claim without execution evidence.

Every substantial run updates `WORKLOG_REBUILD_PROGRESS.md` with current decisions, changed code/docs, commit references, validation status and remaining runtime checks/blockers.

## Commit discipline

Prefer coherent commits and include `[skip ci]` in every normal development commit. Do not touch GitHub Actions unless the user explicitly asks.
