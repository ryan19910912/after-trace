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

AFTERTRACE charges for AI convenience and paid capabilities, not for access to a user's own data, manual record keeping, or the number of LINE groups used.

Baseline functions available without AI quota:

- add AFTERTRACE Bot to a LINE group;
- open that group's PWA record surface;
- read/search/filter authorized records;
- manually create records in PWA;
- manually edit authorized records in PWA.

AI-assisted ingestion consumes AI allowance. When allowance is exhausted, users may keep working manually for free or purchase additional one-time AI allowance.

## LINE interaction contract

### AI-assisted record commands

- `@AFTERTRACE <text>` is the fast AI-assisted recording path and requires spendable AI allowance plus any required AI allowance-responsible-user binding for that source.
- Reply to an image/audio/file and send `@AFTERTRACE` to use AI-assisted attachment ingestion.
- Ordinary group chat is not persisted as product records unless explicitly triggered.
- Ordinary private OA text without `@AFTERTRACE` remains human-support traffic.
- Group quoted TEXT is available only through the bounded temporary cache. If an old quoted TEXT can no longer be reconstructed, ask the user to re-enter the original text.
- If LINE attachment content has expired/unavailable, ask the user to resend it.

### Non-AI group actions

The Bot may exist in FREE groups even when no paid subscription or AI allowance responsible user is active.

Non-AI commands such as opening the PWA/group history must not require paid entitlement or AI allowance. The exact command copy may remain `@AFTERTRACE 查詢` or an equivalent entry action.

### Success reply after recording

Every successful LINE AI record flow must tell the user what AFTERTRACE actually recorded.

Preferred structure:

```text
已記錄：
{{AI 整理後摘要或實際保存內容}}

修改紀錄：
https://<aftertrace-web>/records/{{recordId}}
```

Rules:

- When AI normalization succeeds, show the normalized summary/category-relevant result rather than only `已記錄。`.
- When raw content is saved but AI is disabled/deferred/failed, state that truthfully and never fabricate an AI summary.
- The record URL is a durable PWA deep link containing the durable record id.
- PWA authentication/authorization remains authoritative; knowing a record id/URL never grants access by itself.
- If the new message appears to update/resolve an earlier business item but AFTERTRACE cannot determine the exact target confidently, the reply must say so explicitly instead of pretending the relationship is known.

## PWA manual record creation and editing

Manual PWA recording/editing is a baseline product function for every user, including FREE users and users whose AI allowance is exhausted.

Manual PWA create/edit must not consume AI allowance unless the user explicitly invokes an AI-assisted action.

### Private scope

- Only the owning LINE/OA user may view, manually create into, and edit their private record scope.
- Losing AI quota or paid subscription state never removes manual read/create/edit access to existing personal data.

### Group scope

- Any currently active member of a LINE group that has AFTERTRACE may view existing records, manually create PWA records into that group, and manually edit that group's records.
- Manual PWA group use is available on FREE and paid plans.
- Manual group use does not require an AI allowance responsible user to be present, an active paid subscription, or AI allowance.
- Group membership/source authorization still applies; unrelated users cannot access the group by guessing ids.
- If a previous AI allowance responsible user leaves or their subscription expires, active members may continue all manual PWA work.

### Record deletion / restore

Record deletion is reversible soft deletion, not physical deletion.

- Before deleting, PWA must show a clear confirmation asking whether the user really wants to delete the record.
- A confirmed deletion changes durable record state (for example `DELETED`) and records who deleted it and when; the row/raw history is not physically removed.
- Deleted records disappear from the normal active-record list but appear in a dedicated PWA `已刪除紀錄` / recycle-bin list.
- Authorized users may restore a deleted record at any time unless a later retention policy explicitly says otherwise.
- Restore/delete operations are auditable.
- If a record has deterministic downstream state such as finance allocations or other relations, deletion/restore must not silently corrupt those relations; the exact derived-state behavior is finalized with the related finance/domain implementation.

### Edit auditability

- Preserve original user-provided content/reference as source-of-truth where practical.
- Retain actor/editor identity and timestamps for manual create/edit.
- Keep enough audit history to distinguish original AI/raw input from later user corrections.

`pwaEditing` is not a plan capability.

## Data ownership by source

PRIVATE and GROUP data scopes are independent data spaces. A group's customer/project data is group data; it must not become the private data of whichever user happens to fund AI for that group.

Rules:

- PRIVATE customer/project entities belong to that private source/scope.
- Each GROUP source owns/contains its own customer/project entities and relations.
- The same real-world person/project name may legitimately exist independently in PRIVATE, Group A and Group B.
- AI candidate matching for customers/projects/relations must never cross PRIVATE/GROUP source boundaries merely because names look similar.
- Changing the AI allowance responsible user does not transfer or re-own the group's customer/project/record data.

## Customer / project merge and restore

PWA should support reversible duplicate-entity merge for customers and projects.

Flow:

1. user selects the duplicate entity/entities;
2. user selects the canonical destination entity to merge into;
3. PWA shows a clear confirmation before executing;
4. related records/relations are repointed to the canonical entity as appropriate;
5. the merged source entity is retained durably with a `MERGED`-style status and a reference to the canonical target rather than being physically deleted;
6. merge history records the actor, source entity, target entity, time and enough previous-reference information to restore safely;
7. PWA allows an authorized user to undo/restore an accidental merge.

Customer/project merge is source-scoped; do not merge entities across unrelated PRIVATE/GROUP scopes as an accidental convenience feature.

## Concurrent PWA editing

Multiple group members may open the same record simultaneously. Lost updates must be prevented.

Implementation mechanism is still under design. Preferred direction is database-backed optimistic concurrency using a durable record version/revision (or an equivalent compare-and-update field) rather than an in-memory or single-instance lock. The final implementation should reject a stale save and ask the user to reload rather than silently overwrite a newer edit.

## Group identity versus AI allowance responsibility

A LINE group existing in AFTERTRACE and a user agreeing to fund AI for that group are separate concepts.

Customer-facing terminology should use **AI 額度負責人**. Existing code/database fields named `owner_user_id` / `subscription_owner_user_id` are legacy implementation names and should be separated/renamed during domain refactor so they are not confused with data ownership.

### Group existence

- FREE users may add AFTERTRACE Bot to groups.
- Group creation/onboarding must not require a paid plan.
- Group members may use the group's PWA manual record surface without paying for AI.
- There is no maximum group count on FREE/PRO/TEAM for manual collaboration.

### AI allowance responsible user

The AI allowance responsible user is specifically the user whose authorized AI allowance grants may be consumed for LINE AI-assisted group recording.

- If none is bound, manual group PWA functionality still works.
- Before a LINE AI-assisted group action spends quota, the system must have a current eligible responsible user and at least one allowance grant that permits that group.
- `@AFTERTRACE 啟用` is the MVP action for a member to accept AI allowance responsibility for that group when needed.
- A claim must not overwrite a different active responsible user accidentally.
- If the responsible user leaves, new LINE AI activity pauses, but manual PWA group activity continues.
- While the previous responsible user is absent, another active member may run `@AFTERTRACE 啟用` and become the new responsible user.
- If nobody rebinds and the original responsible user returns, the existing binding may resume.

### AI allowance responsible-user transfer

The current AI allowance responsible user may explicitly transfer future group AI funding responsibility to another current group member.

Preferred LINE initiation form:

`@AFTERTRACE 擁有者轉移 @Ryan Hsu`

The transfer is a two-party approval flow:

1. only the current AI allowance responsible user may initiate while they still hold the role;
2. the target must be an active member of the same LINE group;
3. when LINE mention metadata includes a reliable target `userId`, bind the pending request to that exact user id rather than matching display-name text;
4. if LINE cannot provide a reliable mentioned-user id, do not guess by nickname; direct the initiator to choose the target member in PWA instead;
5. AFTERTRACE replies that the transfer has been submitted and gives the target a PWA confirmation link;
6. the target must authenticate in PWA and explicitly accept before responsibility changes;
7. the request must be single-use and expire after a bounded window such as 24–72 hours; acceptance/rejection/cancellation/role change invalidates it;
8. until acceptance, the existing responsible user remains authoritative and their permitted allowance grants continue to fund eligible AI usage;
9. after acceptance, future group AI usage may consume only the new responsible user's own allowance grants that they permitted for that group.

AI balances are personal and do not transfer with the role.

### Group AI visibility and history

The group PWA must show both the current AI funding state and the historical AI usage ledger for that group.

Current-state view includes current AI allowance responsible user, group-permitted grants at an appropriate product level, used amount and currently available/remaining group amount.

Historical group AI view remains queryable across responsible-user transfers, plan renewals, FREE grants and individual top-up grants. It includes time, actor, charged responsible user, grant source/type, units consumed, related record where useful, and group-period totals.

History is group-scoped and must not expose unrelated private AI usage, total/global wallet, other groups' allocations/usage or unnecessary payment details.

## Data principles

Always preserve original user-provided content/reference. AI output is derived metadata and may be corrected/regenerated.

A record retains at least source/scope, LINE ids where applicable, author, original raw input/attachment metadata, normalized summary, entity relations, creation/edit timestamps, and creation mode such as `LINE_AI` / `PWA_MANUAL`.

### PWA attachment scope

MVP PWA manual create/edit is text/structured-data only. It does not become a permanent file/photo storage product.

- Do not add persistent PWA image/file attachment storage merely because manual create/edit exists.
- LINE image/audio/file input continues to be read/normalized into durable textual/structured information according to the LINE content policy; original binary is not retained.

## Related records and current business state

Worklog records are event history. Later events should usually create new records and update deterministic current state through explicit relations instead of overwriting the earlier record.

Example:

```text
Day 1: 三重王先生 裝潢 30000 還沒給
Day 4: 三重王先生 裝潢 30000 已給
```

The exact structured-summary/finance representation is being refined below. Regardless of presentation format:

- Day 1 and Day 4 remain separate historical records;
- later events may link to earlier records/entities when the relation is known;
- uncertain AI relation matching fails safe and does not mutate earlier state;
- partial/continued events must be representable rather than assuming every update is a full overwrite.

### AI relation matching and ambiguity

AI candidate matching is hierarchical and source-scoped. It should resolve identity before stateful relations, for example:

1. same PRIVATE/GROUP scope;
2. customer/person identity;
3. project/context identity;
4. candidate open business item such as receivable/issue;
5. amount/event type/recency and other deterministic facts.

If any important level is ambiguous, do not confidently continue to later levels and mutate state.

Rules:

- a unique, high-confidence match may be auto-linked according to accepted confidence policy;
- if multiple plausible targets exist, identifying data conflicts, or confidence is insufficient, do not automatically settle/resolve/change the earlier item;
- save the new user's record truthfully even when relation is unresolved;
- tell the user clearly that AFTERTRACE currently cannot determine which previous item this refers to;
- provide a PWA deep link/action allowing the user to select the correct target manually.

## Raw record + AI summary model — design under discussion

The product direction under consideration is to separate every work record into at least two durable representations:

1. **original/raw record** — the user's original text or durable textual extraction from LINE image/audio/file input;
2. **AI summary/structured presentation** — AI-derived, editable presentation data used primarily by PWA.

The proposed summary should support ordered, dynamic display rather than forcing every industry/use case into one fixed form. For example, a summary may contain ordered key/value blocks such as person, project/building name, amount, status, note, location or other AI-identified facts when they exist.

Important constraint still under discussion: dynamic presentation must not make deterministic business state unreliable. If AFTERTRACE is expected to calculate outstanding money, reconcile partial payments, trigger future reminders, or perform exact state transitions, those operations need durable typed facts/relations somewhere even if the visible PWA summary is dynamic. Do not rely on free-form AI-generated labels alone as accounting truth.

Likewise, future AI-generated exports may choose report columns dynamically from raw records + summaries, but deterministic source data and audit history must remain available underneath.

## Subscription plan model

Subscription configuration is data-driven.

### FREE

- price: NT$0
- billing type: `ONE_TIME`
- initial AI allowance: **500 units one time**
- allowance has no calendar expiry and never refreshes
- may add Bot to unlimited LINE groups
- manual PWA personal/group read/create/edit: free
- AI use is available while an eligible user-owned grant permits the requested scope and has remaining allowance
- `export = false` initially

### PRO

- price: **NT$99/month**
- billing type: `MONTHLY`
- AI allowance: **500 units per successful monthly period**
- unlimited LINE groups
- manual PWA read/create/edit: free baseline
- `export = true`

### TEAM

- price: **NT$299/month**
- billing type: `MONTHLY`
- AI allowance: **2500 units per successful monthly period**
- unlimited LINE groups
- manual PWA read/create/edit: free baseline
- `export = true`

Suggested ranks: FREE 0, PRO 10, TEAM 20.

## AI allowance sources and allocation

AI allowance is user-owned, not group-owned. Every FREE initial grant, subscription-period grant and each top-up purchase remains an independently identifiable grant.

Each grant independently configures:

- PRIVATE allowed/not allowed;
- selected GROUP sources allowed/not allowed;
- optional PRIVATE cap;
- optional per-GROUP cap.

Multiple top-up purchases are not merged if doing so would lose independent settings.

If no cap is configured for an allowed scope, that scope may consume until the grant itself is exhausted. Aggregate use across scopes can never exceed the real grant amount.

Recommended grant selection order is current included grant first, then top-up grants oldest first.

### Subscription expiry with top-up grants

Subscription activity is not itself required for AI use if another eligible grant remains.

- When a monthly subscription expires, the expired period grant stops being eligible according to its period rules.
- A separate top-up grant remains usable after subscription expiry if that exact grant permits the requested PRIVATE/GROUP scope.
- Authorization does not automatically fall through to an unrelated top-up grant. Example: if the expired subscription grant allowed Group A but top-up #2 permits only PRIVATE, Group A cannot consume top-up #2.

### Provider usage above the user's remaining grant — proposed policy

The user has proposed that when an eligible request ultimately costs more AI units than the user's available amount, AFTERTRACE may absorb the shortfall instead of creating a negative customer balance. Customer balance floors at zero and Admin records how much provider usage/cost was subsidized by the platform.

The safety boundary for when such subsidy is allowed is still under design. It must not accidentally turn a near-zero balance into an unlimited provider-cost loophole. Admin must be able to report subsidized units and actual provider cost separately from customer-charged usage.

## AI runtime

Current production target remains the approved Gemini 3.5 model. Gemini 2.5 compatibility is not MVP work.

Use Gemini 3.x thinking controls, include reported thinking usage in accounting, and keep historical pricing snapshots immutable.

## Attachment/file scope

MVP AI input targets: text, image, audio, PDF, common text-like files, XLSX/Excel and DOCX/Word.

For DOCX/XLSX, prefer the simplest verified provider-native Files/File Search path supported by the selected Gemini API before building custom Office extraction. Enforce file/request-size limits, MIME allowlists, provider failure handling and real E2E verification.

## Export

Export is MVP and initially remains a paid capability.

The exact export format is under refinement together with the dynamic AI summary model. A future export may provide a standard raw/audit export and/or an AI-generated report whose columns are selected from the chosen record set. AI-generated report structure must not replace durable source data or auditability.

## Internal Admin

Admin supports users/groups, AI allowance responsible-user visibility/transfer history, plans/billing cadence, individual AI grants/allocation policies/caps, top-up products/purchases, AI pricing, anomalies, feedback, manual subscription changes and audit.

Group detail shows current group-specific allocation state and historical group AI usage across all prior responsible users/grants without exposing unrelated private or other-group balances.

Admin also needs visibility into platform-subsidized AI overage if that proposed policy is adopted.

## Future discussion backlog — not MVP decisions yet

The following product directions are intentionally captured for later discussion rather than implemented implicitly now:

- **Invoice integration** — whether/how to connect invoice providers and what accounting boundary AFTERTRACE should own.
- **AI natural-language search across full history** — asking questions over historical work records rather than only current structured filters.
- **Automatic reminders / follow-up** — for example detecting and reminding that `王先生還沒付款`; requires explicit reminder consent, state confidence and notification policy.
- **Engineering scheduling / project schedule** — dates, milestones, dependencies, overdue work and possibly timeline/Gantt-style views.

Do not expand the current MVP into these areas until separately discussed and approved.

## Platform and deployment

MVP stack: TypeScript/Node ecosystem, Hono on Cloudflare Workers API, React/Vite Web/PWA, React/Vite Internal Admin, PostgreSQL + Drizzle.

Deploy as three Workers: `aftertrace-api`, `aftertrace-web`, `aftertrace-admin`. No new Cloudflare Pages work.

## Prelaunch database policy

Development/production databases are prelaunch and may be rebuilt while schema is finalized. Current repository migration history is authoritative. Once real production user data exists, switch to forward-only migrations.
