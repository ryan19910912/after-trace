# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for scheduled development on branch `revive/line-worklog`.

Every development run must:
1. Read this file and `docs/WORKLOG_PRODUCT_SPEC.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing with completed work, validation performed, blockers, and the next prioritized batch.
5. When the MVP feature list is substantially complete, switch to bug audit, edge cases, data consistency, LINE webhook behavior, error recovery, PWA UX, and tests.

## Baseline

- Branch created from commit `bfa722166f44661c06af9fd338d8217217e5dbd7`, the last full LINE-first AI assistant state before the sports-availability rebuild.
- Existing reusable LINE foundations include webhook signature verification, group event parsing, `quotedMessageId`, reply/push clients, attachment content fetch, `@AFTERTRACE` mention parsing, group identity, web auth/entry URLs, PostgreSQL/Drizzle, React/Vite web app, and tests.
- Do not merge sports availability/radar product logic from current `main` into this branch unless a generic utility is clearly reusable.

## Product decisions locked for MVP

- LINE records; Web/PWA browses/manages.
- Group trigger is `@AFTERTRACE`.
- `@AFTERTRACE <text>` = record text.
- Reply attachment/audio/image + `@AFTERTRACE` = record quoted content.
- If quoted attachment content expired at LINE, return a simple expired-content response; do not permanently buffer every group message just to support old replies.
- `@AFTERTRACE 查詢` = generate PWA entry link for current group + caller.
- No natural-language PWA search for MVP.
- PWA filters primarily by customer/project and basic metadata.
- Group users may browse only records originating from that group.
- Owner/private OA later gets workspace-level management/settings/export.
- Customer/project schemas stay minimal; industry-specific information goes in free-text notes.
- No custom-field builder in MVP.
- Finance requiring calculations uses fixed typed fields/tables, not note text.
- Electronic invoice/Amego integration is postponed until real users ask for it.
- Keep TypeScript + Hono Workers + React/Vite Pages + PostgreSQL/Drizzle.
- AI is ingestion assistance, not accounting/query truth.

## Completed

### 2026-09-02 initial revival

- Created `revive/line-worklog` from legacy LINE Bot commit `bfa7221`.
- Confirmed old branch contains the useful LINE foundations instead of rebuilding them from sports `main`.
- Added `docs/WORKLOG_PRODUCT_SPEC.md` with the current MVP contract and scope.

## Next prioritized implementation batch

1. Introduce a new worklog command parser independent from legacy Energy/Memory intents:
   - QUERY (`查詢`)
   - RECORD_TEXT
   - RECORD_QUOTED
   - HELP only if needed
2. Add worklog domain/schema for workspace, source group/private context, customer, project, record, transaction, edit/audit metadata.
3. Add Drizzle migration(s) without deleting legacy tables until the new runtime is proven.
4. Add repository/service tests for source scoping: group reads only its own records; owner workspace can aggregate later.
5. Wire webhook path incrementally so new commands bypass legacy Energy/Memory flow.
6. Reuse LINE content fetch for quoted audio/image; return expired-content UX on fetch failure.
7. Add `@AFTERTRACE 查詢` entry-token/redirect path without LIFF dependency.
8. Replace/reshape PWA around records, customers, projects, mobile/desktop responsive browsing.

## Later MVP batch

- AI record normalization and multimodal ingestion behind a narrow structured contract.
- Customer/project fuzzy association with confirmation when ambiguous.
- Fixed financial transactions and simple received/expense views.
- Owner private OA flow and workspace-level settings.
- Feedback/report-problem entry in PWA.
- Subscription/usage counters only after core behavior works; do not revive old Energy complexity by default.

## Bug-audit phase checklist

After core features are complete, repeatedly audit:
- duplicate LINE webhook delivery/idempotency
- quoted content expiration and wrong content type
- group leave/rejoin and inactive contexts
- user/group token leakage or cross-group record access
- ambiguous customer/project association
- concurrent edits and audit trail
- AI parse failures/fallback to raw record
- transaction consistency and duplicate financial records
- mobile WebView usability, font/button size, old Android browsers
- desktop responsive layout
- error recovery and user-visible error messages
- migration safety and fresh database bootstrap
