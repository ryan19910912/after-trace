# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

This file is part of the Worklog handoff contract and must be read by scheduled development runs together with the product/spec/progress/content-policy/deployment documents.

## GitHub Actions / CI policy

**Do not run GitHub Actions for AFTERTRACE development unless the user explicitly asks for it.**

Scheduled or interactive development work must not:

- manually run, dispatch, rerun, enable, or otherwise trigger GitHub Actions workflows;
- add/modify workflow files merely to obtain verification;
- rely on GitHub Actions as a build/test/typecheck/migration workaround;
- make CI-only commits just to trigger workflows;
- wait for GitHub Actions before continuing source development.

Existing workflow files stay untouched unless the user explicitly requests CI/workflow changes.

## Product-decision documentation policy

Product decisions agreed with the user are durable development contract and must not live only in chat history.

During scheduled or interactive development work:

- update `docs/WORKLOG_PRODUCT_SPEC.md` in the same batch when product/subscription/entitlement/LINE/billing/copy/data-access/architecture rules are agreed;
- update `docs/WORKLOG_REBUILD_PROGRESS.md` when the decision changes implementation status, debt, validation scope or next work;
- update deployment/content/development docs when the decision changes those operating contracts;
- read durable documents first on every future run;
- surface code/doc mismatches instead of silently redefining product behavior to match code;
- document both desired behavior and pending implementation when a decision requires migration/payment/provider/background work.

This explicitly includes pricing/cadence, quota refresh/rollover, Owner lifecycle, record edit authorization, LINE success replies/edit links, export scope, supported attachment types and AI-model policy.

## Current implementation target decisions

Treat these as durable until the user changes them:

- Current production AI target is stable Gemini 3.5 Flash (`gemini-3.5-flash`). Gemini 2.5 compatibility is not an MVP requirement.
- Gemini 3.5 uses Gemini-3 thinking controls and thinking-token accounting; do not retain old low-temperature overrides merely for legacy compatibility.
- FREE is `ONE_TIME`, personal-only, gets 500 AI units once, does not expire by calendar and does not refresh.
- PRO is NT$99/month, `MONTHLY`, 500 AI units per successful paid period, max 3 groups.
- TEAM is NT$299/month, `MONTHLY`, 2500 AI units per successful paid period, max 20 groups.
- Paid monthly quota refresh occurs only after confirmed renewal success; unused allowance does not roll over.
- Group use requires the bound Owner to remain an active member. Owner absence suspends new group query/record/provider work.
- While Owner is absent, an active member may run `@AFTERTRACE 啟用` to take Owner/billing responsibility. Successful rebind remains authoritative even if old Owner later returns; if nobody rebinds and old Owner rejoins, original binding resumes.
- `export` is MVP and must be truthful/server-enforced before being advertised.
- XLSX and DOCX are MVP attachment targets; add bounded extraction rather than forwarding unsupported Office binary MIME blindly to Gemini.
- Initial plan matrix is FREE / PRO / TEAM and remains DB/Admin-driven.

## Baseline record-editing rule

Work-record correction is a **basic product safety function**, not a paid feature. AI can be wrong, therefore:

- remove/ignore `pwaEditing` as a plan capability;
- every plan may edit records the current user is authorized to edit;
- private OA records are editable only by their owning user;
- group records are collaboratively editable by currently authorized members of that group;
- group edit authorization remains subject to current group access rules (active membership, Owner presence, entitlement/maxGroupCount as applicable);
- preserve original input/reference and retain editor/time auditability where supported;
- successful LINE record flows should reply with what AFTERTRACE actually saved/AI-normalized and include a short-lived scoped edit link to that exact record;
- if AI fails/is disabled but the raw record is safely stored, say so truthfully and still provide an edit link rather than inventing an AI result.

Do not reintroduce record editing as a subscription differentiator.

## Prelaunch database/schema policy

AFTERTRACE is not live yet. The user has confirmed both development and production databases may be destructively rebuilt while schema/product work continues.

During this prelaunch phase:

- current repository migration/schema is authoritative;
- do not preserve obsolete migration-history compatibility solely for empty/non-live databases;
- if an environment has stale migration history, rebuild it from the current journal/baseline;
- new migrations/schema changes may proceed without a legacy-history reconciliation design for disposable databases;
- confirm no real user/business data needs preservation before destructive reset;
- once real production data exists, destructive-reset freedom ends immediately and normal forward-only migration discipline becomes mandatory.

## AI provider accounting / settlement invariant

Provider usage is a real external cost and must remain auditable even when quota estimation, Worker lifetime, persistence timing or provider response size differs from expectations.

For all AFTERTRACE AI paths:

- quota reservation is a **preflight hold**, not permission to erase a provider call that completed;
- before provider success, a failed/cancelled attempt may release only when no usable provider result/cost exists;
- after usable provider success, **never release merely because actual usage exceeded estimate, settlement was delayed, reservation expired, or later persistence failed**;
- durable/resumable settlement should preserve successful provider output and exact metering/pricing snapshot whenever architecture permits;
- actual usage above reservation must still be recorded;
- expiry/recovery must avoid double-decrement/double-charge;
- resume after provider success is idempotent and must not call Gemini again;
- provider-dollar cost and customer allowance units remain distinct concepts;
- thinking/reasoning and modality-specific usage are captured exactly once;
- do not claim provider-cost/quota correctness until executable overage/expiry/concurrency/persistence cases run.

## Development validation policy

During accelerated MVP implementation:

- prefer static consistency review/source contract checking/authored tests;
- record authored but unexecuted tests as **not executed**;
- never claim typecheck/test/migration/schema/browser/Worker/LINE/Gemini/E2E success without actual logs;
- do not repeatedly spend scheduled runs attempting unavailable local execution;
- keep concentrated executable validation separate until major MVP paths are complete and the user wants it.

The concentrated pass should include install/build/typecheck/test/schema/migration/browser/Worker/LINE/Gemini checks locally/runtime, not through GitHub Actions.

## Scheduled-run handoff requirement

Before finishing each scheduled or interactive development run, update `docs/WORKLOG_REBUILD_PROGRESS.md` with:

- completed changes;
- static validation performed;
- tests authored/updated but not executed;
- known risks;
- next large batch;
- confirmation GitHub Actions were not run/triggered.

End-of-run reports should include estimated MVP completion, production readiness, remaining code/static work versus external/payment/config work, remaining large batches and time to concentrated validation/post-validation fixes. These are planning estimates, not test results.
