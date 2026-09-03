# AFTERTRACE Worklog Rebuild Progress

Durable handoff for branch `revive/line-worklog`.

Read first every run:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- this file
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`

## Current stable product contract

- Product/domain is general-purpose work recording, not a construction/finance-specific schema.
- Core model is Source + Entity + Alias + Record + RecordEntity + Revision + Pending AI Confirmation.
- PRIVATE and GROUP Sources are isolated data spaces.
- PWA manual read/create/edit/delete/restore is free baseline functionality.
- Active GROUP members may collaboratively use group records without paid plan, AI balance, AI responsible user or group-count restriction.
- Customer-facing role name is `AI 額度負責人`.
- AI allowance is user-owned and represented by separate FREE/subscription/top-up grants with independent PRIVATE/GROUP allocation/caps.
- Subscription expiry does not disable separately eligible top-up grants.
- AI request starts only when eligible balance > 0. If real provider usage exceeds remaining eligible units after start, user balance floors at zero and platform subsidy is durably recorded by user/source/group/responsible-user/request/provider cost.
- Group PWA shows current group-specific AI availability plus complete historical group AI usage across responsible-user/grant changes without exposing unrelated private balances.
- Responsible-user transfer uses two-party approval and does not transfer balances.

## Entity model decisions

- Every concrete reusable lookup subject is an Entity: person, project/context, place, equipment/item, etc.
- Entity metadata stays minimal and general-purpose.
- `PRIMARY` and `RELATED` are roles of an Entity in one Record, not permanent Entity types.
- One Record has at most one PRIMARY Entity and zero/many RELATED Entities.
- The Record exists once and must be discoverable through every attached Entity.
- Example: `王大明跟陳師傅今天去三重晴空案換冷氣` -> PRIMARY `晴空案`; RELATED `王大明`, `陳師傅`.
- Do not extract every noun into an Entity; only meaningful future lookup targets.
- Alias means another genuine name for the same Entity. Context phrases such as `王大明的晴空案` are not automatically aliases.
- Possible alias/entity ambiguity must ask user confirmation rather than silently create duplicates or attach uncertain aliases.
- Pending confirmation is durable, supporting at least `ALIAS_MATCH`, `PRIMARY_ENTITY`, `ENTITY_MATCH`.
- Merge is reversible; undo moves associations that originally belonged to source Entity back even if Record text changed after merge.
- Generic Record-to-Record relation is not required for MVP solely for chronological progression; Entity + occurred_at + on-demand AI is sufficient until a concrete deterministic feature requires relations.

## Record / time / edit decisions

- Durable truth is raw Record text or durable textual extraction plus Entity associations and audit history.
- No persistent per-record AI summary. AI summaries/queries are generated on demand and are ephemeral.
- Record time distinguishes `created_at`, `occurred_at`, `updated_at`.
- `occurred_at` defaults to message/create time when unspecified; AI can parse relative time such as yesterday/last Friday.
- Every content edit creates immutable revision history.
- PWA shows `已編輯` and lets authorized users inspect history.
- Record editing uses DB integer `version` optimistic concurrency; no Redis/memory lock for normal edit concurrency.
- PWA manual edit does not call AI and does not automatically reassign Entity associations.
- Record delete is soft delete; RecordEntity/revision data remains stored, normal queries ignore deleted rows, recycle-bin view can restore them.

## LINE AI edit decisions

- LINE natural-language editing requires positive eligible AI balance.
- Record target should be deterministic through Reply to the exact prior Record/AFTERTRACE success context.
- If no reliable Reply target exists, do not guess; tell user to Reply to the Record or edit in PWA.
- After target record id is fixed, AI interprets requested change.
- AI may update text and, when user clearly changes subject, update PRIMARY/RELATED Entity associations.
- Unknown/ambiguous new subject uses normal Entity/Alias/Pending Confirmation flow.
- Backend performs authorization + version check + revision + update atomically; AI never receives arbitrary SQL mutation authority.

## Current code/schema mismatch requiring refactor

Legacy code/schema still reflects earlier workspace/customer/project/finance/Owner/capability assumptions and must not be treated as product truth.

Major cleanup/refactor areas:

1. remove `maxGroupCount`, `GROUP_LIMIT_REACHED` and any group ordinal enforcement;
2. remove/redefine generic paid `groupCollaboration` gating;
3. separate GROUP existence/data ownership from AI allowance responsibility;
4. split free manual/history authorization from AI entitlement/balance gates;
5. replace workspace-owner-centric group edit/read with Source/member authorization;
6. refactor fixed Customer/Project-centric core toward generic Entity/Alias/RecordEntity model;
7. add `occurred_at`, record status/delete audit, integer `version`, revision history;
8. add durable Entity merge history/undo and pending AI confirmations;
9. remove dependence on persistent per-record normalized summary as product truth;
10. implement user-owned AI grant/allocation/cap ledger and separate top-up purchases;
11. implement platform-subsidy accounting for overage after a positive-balance AI request begins;
12. implement AI 額度負責人 transfer and group AI history;
13. implement LINE Reply AI edit with deterministic target and Entity reclassification when requested;
14. implement on-demand AI query/summary retrieval after remaining query semantics are finalized;
15. preserve LINE attachment policy and verify XLSX/DOCX provider-native ingestion.

## Product discussions still open

Core model is close to freeze. Remaining high-value discussions:

- exact charging semantics for AI-assisted Record creation/entity parsing;
- exact AI create output beyond PRIMARY/RELATED/Alias candidate/occurred_at, if anything;
- AI Query retrieval scope/UX: single Entity, whole Source/group, date ranges, questions without explicit Entity, and candidate retrieval strategy;
- PWA manual flow for explicitly changing a Record's PRIMARY/RELATED Entity without AI;
- final export/report behavior under the on-demand AI model;
- final product/brand name and go-to-market positioning.

Future backlog, not approved MVP work yet:

- invoice integration;
- full-history natural-language search expansion;
- automatic reminders/follow-up;
- project/engineering scheduling.

## Validation status

Schema/runtime implementation has not yet been refactored to this newly finalized Entity-first contract. Existing authored tests do not validate the new model yet.

Concentrated typecheck/test/build/schema/browser/Worker/LINE/Gemini validation remains pending.

**GitHub Actions were not run, dispatched, rerun, enabled or modified.**

## Planning note

The recent product decisions are a meaningful domain refactor, so older percentage estimates are no longer useful until the Entity/grant/edit schema is implemented. Next implementation should prioritize coherent schema/domain migration rather than incremental patching of the legacy Customer/Project/Owner model.

Do not use GitHub Actions as validation.
