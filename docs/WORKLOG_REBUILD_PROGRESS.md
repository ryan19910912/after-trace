# AFTERTRACE Worklog Rebuild Progress

This file is the durable handoff for continued development on branch `revive/line-worklog`.

Every development run must:
1. Read this file, `docs/WORKLOG_PRODUCT_SPEC.md`, `docs/WORKLOG_LINE_CONTENT_POLICY.md`, and `docs/WORKLOG_DEPLOYMENT.md` first.
2. Inspect the latest branch HEAD before editing.
3. Do a meaningful batch of implementation/testing rather than one tiny cosmetic change.
4. Update this file before finishing.
5. Once core MVP functionality is substantially complete, switch to repeated bug audit/repair.

## Current product baseline

- LINE records; Web/PWA browses/manages.
- `@AFTERTRACE <text>` creates a work record.
- Reply TEXT/AUDIO/IMAGE/FILE + `@AFTERTRACE` records quoted content when recoverable.
- `@AFTERTRACE 查詢` opens scoped PWA without LIFF.
- OA ordinary private text remains human-support traffic unless explicitly prefixed with `@AFTERTRACE`.
- OA friends have personal records; group records are exact-source scoped; personal/group surfaces stay separate.
- FREE is personal-only; group collaboration is a paid capability.
- Group AI usage charges the stable group owner while preserving triggering member attribution.
- Deployment is three independent Cloudflare Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`; Web/Admin use Workers Static Assets, not Pages.
- PostgreSQL/Drizzle remains the database stack. No Redis for MVP.
- Only ordinary group TEXT is temporarily cached for delayed Reply recovery: 5-day TTL, max 1000 per group.
- AUDIO/IMAGE/FILE are never cached; Reply must fetch them directly from LINE by `quotedMessageId`.
- Original attachment binaries are not persisted.

## Completed foundations

### Domain / data / entitlement
- Worklog users/OA friendship, workspace, PRIVATE/GROUP sources, memberships, minimal customers/projects, records, typed finance transactions, plans/capabilities, subscriptions/history, AI runtime pricing, usage/cost snapshots, feedback, anomalies and audit models exist.
- Stable group owner/binding and per-member `recording_enabled` exist.
- Race-safe AI quota reservation/commit/release exists.
- Pending groups prevent guessing an owner; explicit `@AFTERTRACE 啟用` binds the owner write-once.

### LINE runtimes
- Group `@AFTERTRACE <text>` is cut over to the new Worklog runtime before legacy Energy/Memory.
- OA FOLLOW/UNFOLLOW/private messages are cut over to the new OA Worklog runtime.
- Direct TEXT is durably written before AI normalization.
- LINE message-id redelivery is idempotent; conflicting same-id content is rejected instead of overwritten.
- Group record authorization checks active membership, recording permission, group entitlement and owner quota context.
- Group query access is independent from record-creation permission.

### Secure Web entry
- GROUP one-time Web entry exists and re-verifies group membership.
- PRIVATE one-time Web entry exists separately; it binds LINE user + user id + private source and never invents a group id.
- Private exchange rechecks OA friendship and exact active private-source ownership.

### TEXT AI normalization
- Post-persistence Worklog normalization exists with durable state machine and idempotent recovery.
- Provider/model/pricing are DB-backed.
- GROUP charges owner, PRIVATE charges personal user, while actor attribution is retained.
- Gemini output is constrained to grounded summary/category/customer/project hints; hints are not blindly written as foreign keys.
- Provider failure/quota failure never erases raw records.

### Deployment
- Three independent Workers deployment baseline is documented and partially wired.
- Web/Admin use Workers Static Assets with SPA fallback.
- Old Pages deploy helper / Admin Pages proxy were removed.

## 2026-09-02 latest batch: delayed Reply-to-TEXT cache implemented

Starting point was the post-TEXT-normalization branch state.

Implemented the complete group TEXT cache path rather than only documenting it:

1. Added `worklog_line_text_cache` schema and migration `0007_worklog_line_text_cache.sql`.
2. Registered the schema with Drizzle and journaled migration 0007.
3. Added `WorklogLineTextCacheService` with MVP constants:
   - TTL = 5 days
   - max = 1000 cached TEXT messages per group
4. Added PostgreSQL repository behavior:
   - global LINE message-id identity
   - exact `line_group_id + quotedMessageId` lookup
   - expired rows are not returned
   - deterministic newest-1000 retention per group
   - expired rows are cleaned during cache writes
5. Ordinary group TEXT that is not an AFTERTRACE command is cached best-effort without bootstrapping the Worklog group or creating a permanent record.
6. IMAGE/AUDIO/FILE/non-text messages never enter this cache.
7. Reply `@AFTERTRACE` now attempts TEXT cache resolution first.
8. Cache hit creates a real TEXT work record with:
   - command `line_message_id`
   - original `quoted_line_message_id`
   - original cached text
   - original quoted message timestamp as source timestamp
9. Reply-TEXT write reuses the normal record idempotency path and post-persistence AI normalization.
10. Cross-group cache access is prevented by group-scoped lookup.
11. Cache failure on ordinary chat is logged best-effort and does not block legacy processing or send a product-error reply.
12. Added/updated tests for ordinary TEXT cache, non-text exclusion, group isolation, expiry behavior, delayed Reply-TEXT creation, quoted-id idempotency identity and duplicate handling.

Latest commit produced by this batch before this progress update: `335922a4a7a00fe5b2d0156a26bb5e88ab34dfe6`.

## Important current limitation in quoted-content resolver

A Reply command gives us `quotedMessageId`, but not the original quoted message type. The runtime now follows the intended resolver order:

1. Try exact group TEXT cache.
2. If cache misses, treat it as potentially AUDIO/IMAGE/FILE and hand it to the direct LINE content-fetch path once that path is implemented.

Therefore a cache miss is not yet reported as definitely expired, because it may be a valid attachment still retrievable from LINE. The next attachment batch must complete that second resolver stage and only then return the final expired/resend message when LINE content is unavailable.

## Validation status

- Source and tests were statically updated for the new cache path.
- No Redis was introduced.
- No AUDIO/IMAGE/FILE cache was introduced.
- `line_message_id` + `quoted_line_message_id` are part of Reply-TEXT durable identity.
- **No local build/typecheck/test/migration execution was possible in the connector-only environment.** Do not claim these tests/migrations passed until run in a real checkout/CI environment.

Before production run at minimum:
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:schema:check`
- migrations 0001-0007 on a disposable Neon/PostgreSQL database
- specifically validate 0005 private auth, 0006 normalization races and 0007 TTL/cap pruning

Drizzle worklog migrations remain hand-authored/journaled; snapshot/schema drift must be checked before production.

## Next prioritized implementation batches

1. **Quoted AUDIO/IMAGE/FILE direct LINE ingestion**
   - use `quotedMessageId` with LINE message-content API
   - never cache binaries
   - if LINE has content, process immediately and persist textual/structured result + both LINE ids
   - if LINE content is unavailable/expired, return clear resend UX
   - support audio transcription/multimodal understanding, image understanding and safe file text extraction
   - handle unsupported/oversized files and partial failures deterministically

2. **Actual Worklog PWA APIs + UI**
   - expose scoped record-read endpoints for PRIVATE/GROUP
   - private entry page shows real personal worklog records instead of placeholder
   - group UI migrates away from legacy Memory
   - clear personal/group navigation
   - basic customer/project/time/type filters, no natural-language search

3. **Owner PWA management**
   - group members
   - recording enable/disable
   - owner quota used/reserved/remaining
   - group/member AI usage
   - TEXT/AUDIO/IMAGE/FILE counts

4. **Internal Admin conversion**
   - worklog user/group list/detail
   - plans/capabilities/AI quota
   - AI runtime model/pricing
   - anomalies + feedback
   - simple configured username/password boundary replacing interim legacy Access verifier

5. **Finance/customer/project management**
   - deterministic typed amount/date/type data where arithmetic is required
   - customer/project create/edit/link flows
   - do not add invoice/Amego until real demand

6. **Bug audit / production hardening**
   - webhook redelivery/idempotency
   - cache pruning races
   - cross-source isolation
   - attachment expiry/partial failure
   - AI retry/fallback
   - concurrent PWA edits
   - transaction duplication
   - Workers Static Assets routing, SPA deep links, API origin/CORS/custom domains
   - migration/bootstrap reliability

## Current rough completion estimate

- Backend/data/LINE core: ~75%
- PWA customer surface: ~35%
- Owner management: ~25%
- Admin conversion: ~20%
- Production validation/bug audit: ~20%
- Overall MVP readiness: roughly 60-65% after this batch.
