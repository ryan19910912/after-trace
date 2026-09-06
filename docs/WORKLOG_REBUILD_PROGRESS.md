# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every substantive development run, in this exact order:

1. `docs/WORKLOG_PRODUCT_SPEC.md`
2. `docs/WORKLOG_ENTITY_MODEL.md`
3. `docs/WORKLOG_RECORD_EDIT_POLICY.md`
4. `docs/WORKLOG_AI_POINT_POLICY.md`
5. `docs/WORKLOG_DEVELOPMENT_POLICY.md`
6. `docs/WORKLOG_LINE_CONTENT_POLICY.md`
7. `docs/WORKLOG_DEPLOYMENT.md`
8. this file

The latest documents above are the only product/development specification. Pure UI-only styling tweaks do not require rereading the full set; product/schema/runtime changes do.

## Current checkpoint — 2026-09-06 deterministic LINE query + semantic retrieval + event-date rules

Cloudflare deployment remains manual with six explicit Workers:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`.
- Prod: corresponding `*-prod` Workers.

Environment inputs remain `.env.local` local-only, `.env.dev` Dev, `.env.prod` Prod. Do not use GitHub Actions. Every commit on this branch continues to require `[skip ci]`.

## Stable Dev state before this new batch

Already runtime-verified by the user before the current unvalidated changes:

- typed commercial plan forward migration on the existing Dev DB — PASS;
- regenerated canonical baseline/guard — PASS;
- AI runtime preserved as `GOOGLE / gemini-3.5-flash-lite` — PASS;
- Dev API `/health` and `/health/ready` — PASS;
- Admin Users/Groups reserved `grant` SQL alias bug fixed — PASS;
- Admin Users/Groups/Plans browser smoke — PASS;
- Dev Web Worker shell/routes — PASS;
- LINE Login callback registration/redirect stage — PASS.

Do not resurrect the obsolete instruction that Dev DB must be rebuilt. Existing Dev data is being preserved with reviewed idempotent forward compatibility unless a rebuild becomes genuinely unavoidable.

The stale Dashboard `* * * * *` Cron Trigger is unrelated to this work and should still be removed separately; do not add an empty `scheduled()` handler.

## Account onboarding — accepted and implemented, still needs runtime validation

Accepted behavior now in branch:

- LINE Login may create/update user + workspace + PRIVATE Source;
- first eligible account bootstrap issues `FREE_INITIAL` from Admin-configured FREE `grant_points`;
- LINE Login does not set `is_oa_friend=true`;
- real OA follow/unfollow owns friendship state;
- non-friend users can use Web/PWA manual PRIVATE CRUD normally;
- non-friend UI reminder is optional convenience messaging: users can add AFTERTRACE as a LINE friend to record faster inside LINE, but adding the OA is not required for Web use;
- reminder supports configured add-friend URL/QR and disappears for OA friends;
- later OA follow must not duplicate FREE_INITIAL.

## Web/PWA `AI 幫我記` — accepted architecture, implementation still pending

Web/PWA will provide preview-first AI Record creation while reusing the LINE AI core rather than forking business logic.

Required flow:

1. explicit `AI 幫我記` action;
2. positive eligible AI balance;
3. shared interpretation of title/event date/search metadata;
4. preview/confirmation;
5. explicit commit;
6. no Record on cancel;
7. provider usage already incurred during preview remains chargeable;
8. unchanged accepted preview commits without a second provider call.

## New accepted LINE history behavior — implementation started

History is now defined as **Query → Retrieve → Answer → Deep Link**.

Current product decision:

- no AI history summary in this MVP;
- after Source authorization, query PostgreSQL first;
- resolve an explicitly mentioned existing title/Entity/Alias within the same Source where possible;
- return up to the newest 5 matching Records directly in LINE;
- include total match count when available;
- include the secure filtered PWA link for deeper history;
- never invent project/payment/progress conclusions.

Example target behavior:

`晴空案目前收款進度如何`

may resolve to:

- title = `晴空案`
- semantic/fuzzy query = `收款`

and then return stored matching facts, not an AI-generated progress summary.

Branch work in this batch:

- added `WorklogHistoryQueryService`;
- group/OA query replies can now read recent DB matches before creating the deep link;
- added natural progress/status query detection to avoid saving questions such as `晴空案目前收款進度如何` as Records;
- history retrieval remains provider-free.

## Semantic search metadata — schema/provider work started

Accepted purpose: a Record should remain findable by common semantic wording even when the literal raw text differs.

Example:

`晴空案今天收3千清潔費`

may carry grounded retrieval terms such as:

- `收款`
- `款項`
- `清潔費`
- `3000`

so a later deterministic query for `收款` can match the Record.

Rules:

- `search_terms` is bounded retrieval metadata only;
- it must not become finance/project-specific universal schema;
- manual PWA CRUD remains free and does not silently call AI to populate terms;
- AI-assisted Record interpretation may generate terms as part of the same provider call used for title/date interpretation;
- no extra provider call is justified solely for search metadata.

Branch work in this batch:

- `worklog_records.search_terms` added to canonical TypeScript schema;
- idempotent forward compatibility adds `search_terms jsonb NOT NULL DEFAULT []` to an existing DB;
- Gemini text normalization structured output now includes bounded `search_terms`;
- deterministic history query checks Record search terms and persisted normalization result terms.

Because canonical schema changed, the checked-in Drizzle baseline/snapshot must be regenerated and guarded before the next deployment. Existing Dev DB should still use the forward-compatibility migration; do not rebuild it merely for this column.

## Event date and Reply/Replay source timestamp — accepted hard rule

MVP event semantics are day-precision. The existing physical `occurred_at` column is retained temporarily for compatibility, but application behavior must treat it as an Asia/Taipei calendar-day marker, not a meaningful clock time.

Hard rule for relative dates:

- direct LINE Record: reference = original LINE message timestamp;
- Reply/Replay of older content: reference = the quoted/original message timestamp;
- never use the later `@AFTERTRACE` command timestamp to interpret `今天/昨天/上週五` in quoted content;
- never silently substitute Worker current time when the original timestamp is required but unavailable.

Regression example:

- 9/3 original: `晴空案今天收3000清潔費`
- 9/5 Reply: `@AFTERTRACE 幫我記`
- event date must be 9/3; `created_at` may be 9/5.

Existing GROUP Reply-to-TEXT already passes cached `lineTimestamp` as `sourceTimestamp`, which matches the rule. Other delayed Reply paths, especially attachment paths where LINE content fetch does not itself provide the original message timestamp, must not continue fabricating the Reply command timestamp as source time. That remaining gap is explicitly open work.

## Current local validation for this batch

Executed by the user on Windows after pulling commit `48a5986eff7593457bccf97694313d7e377dd99c`:

- `pnpm --filter @aftertrace/api typecheck` — PASS.
- targeted Vitest — PASS, 3 files / 13 tests:
  - `src/worklog/gemini-text-normalizer.test.ts`
  - `src/worklog/text-normalization.test.ts`
  - `src/worklog/text-normalization-persistence.test.ts`

These runs validate the new `searchTerms` normalization contract and provider/persistence typing. They do not yet validate command/history-query/LINE Reply runtime behavior, baseline regeneration, existing Dev forward migration, or deployed Worker behavior.

## Durable docs updated

Current product/development contracts now include:

- optional/non-blocking OA friend convenience positioning;
- Web `AI 幫我記` shared pipeline;
- deterministic LINE top-5 history answer + deep link;
- no AI history summary for current MVP;
- semantic `search_terms` retrieval metadata;
- day-precision event semantics;
- original source-message timestamp requirement for Reply/Replay.

## Immediate next validation/development order

1. Regenerate canonical baseline with `pnpm db:baseline:regenerate --confirm-prelaunch-reset`.
2. Run `pnpm db:baseline:guard`.
3. Review generated baseline diff for `worklog_records.search_terms`; commit generated artifacts with `[skip ci]`.
4. Run targeted command/history/LINE Reply tests before runtime deployment.
5. Run existing Dev forward migration; verify `search_terms` exists and existing data remains intact.
6. Deploy Dev API and verify `/health` + `/health/ready`.
7. Real LINE test: create a semantic Record such as `晴空案今天收3千清潔費`, then query `晴空案目前收款進度如何`; expect DB facts + deep link, not AI summary.
8. Regression test delayed GROUP Reply-to-TEXT: original message date must remain the event date even when Reply occurs later.
9. Finish original-timestamp handling/fail-closed behavior for delayed attachment Reply paths before claiming all Reply types compliant.
10. Continue Web non-friend prompt smoke and Web `AI 幫我記` implementation.

No GitHub Actions workflow was run, dispatched, rerun, enabled, modified, triggered, or used as validation.

Current deployment status: **NEW SEARCH/QUERY/DATE CODE TYPECHECKS AND TARGETED NORMALIZATION TESTS PASS; BASELINE REGENERATION + QUERY/REPLY TESTS + DEV RUNTIME VALIDATION STILL PENDING.**
