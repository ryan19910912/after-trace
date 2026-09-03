# AFTERTRACE Worklog Development Policy

Durable development rules for branch `revive/line-worklog`.

This file is part of the Worklog handoff contract and must be read by scheduled development runs together with the product/spec/progress/content-policy/deployment documents.

## GitHub Actions / CI policy

**Do not run GitHub Actions for AFTERTRACE development unless the user explicitly asks for it.**

Scheduled or interactive development work must not:

- manually run, dispatch, rerun, enable, or otherwise trigger GitHub Actions workflows;
- add or modify workflow files merely to obtain verification;
- rely on GitHub Actions as a build/test/typecheck/migration verification workaround;
- make empty, CI-only, or otherwise unnecessary commits just to trigger workflows;
- wait for GitHub Actions before continuing source-level development.

If existing workflow files are present, leave them untouched unless the user explicitly requests a workflow/CI change.

Commits and pushes are for preserving actual source/documentation progress, not for requesting CI execution.

## Product-decision documentation policy

Product decisions agreed with the user are part of the durable development contract and must not live only in chat history.

During scheduled or interactive development work:

- when a product rule, subscription rule, entitlement rule, LINE behavior, billing rule, user-facing copy contract, or architecture decision is agreed, update `docs/WORKLOG_PRODUCT_SPEC.md` in the same development batch;
- when the decision changes current implementation status, known debt, validation scope, or next work, also update `docs/WORKLOG_REBUILD_PROGRESS.md`;
- implementation-specific operating rules belong in the relevant development/content/deployment document as well when applicable;
- future runs must read the durable documents first and must not replace an existing documented decision with assumptions reconstructed from chat memory;
- if code and durable product documentation disagree, explicitly surface the mismatch. Do not silently redefine the product contract to match existing code unless the user has approved that behavior;
- if a newly agreed decision requires a migration, payment-provider behavior, background renewal process, or other work that is not implemented yet, document both the desired contract and the fact that implementation is still pending.

This includes subscription/pricing decisions. Current subscription design discussions must be persisted as they are agreed, including billing type, renewal behavior, quota refresh behavior, rollover rules, payment-provider requirements, default plan matrix, Owner lifecycle, supported attachment types, export scope, and active AI model policy.

## Current implementation target decisions

These decisions are current product/development targets and must be treated as durable until the user explicitly changes them:

- Current production AI target is stable Gemini 3.5 Flash (`gemini-3.5-flash`). Do not spend implementation effort preserving Gemini 2.5 thinking compatibility now. A later model migration should be handled as a deliberate compatibility/pricing change.
- Gemini 3.5 work-record normalization should use Gemini 3-style thinking controls and account thinking tokens in provider cost/quota. Sampling overrides such as the old hard-coded low temperature should not be retained merely for legacy compatibility.
- FREE is a `ONE_TIME` personal entitlement. It receives a one-time AI allowance equal to the current NT$99 PRO monthly allowance, does not expire merely because a month passes, does not auto-refresh, and remains usable until its granted AI allowance is exhausted.
- Paid PRO/TEAM are `MONTHLY` plans. A new monthly allowance is granted only after confirmed successful renewal; unused prior-period allowance does not roll over.
- Group use requires the bound Owner to remain an active member of that LINE group. If the Owner leaves, new group query/record/provider work is suspended before quota/provider usage.
- While the bound Owner is absent, an active group member may explicitly run `@AFTERTRACE 啟用` to take over Owner/billing responsibility. After a successful rebind, the previous Owner returning later must not reclaim ownership automatically. If nobody rebinds and the previous Owner rejoins, the original binding remains and group usage resumes.
- `export` is part of the MVP and should be implemented truthfully before advertising that capability to customers.
- DOCX and XLSX are part of the MVP attachment target. Do not fake support by forwarding unsupported raw Office MIME bytes to Gemini; add an explicit extraction/conversion path appropriate for Cloudflare Workers, then feed extracted content into the normal record pipeline.
- The initial recommended plan matrix is FREE / PRO / TEAM. Keep plan behavior data-driven in DB/Admin rather than scattering plan-code conditionals through frontend/runtime beyond the explicit FREE personal-only safety rule.

## AI provider accounting / settlement invariant

Provider usage is a real external cost and must remain auditable even when quota estimation, Worker lifetime, persistence timing, or provider response size differs from expectations.

For all AFTERTRACE AI paths:

- a quota reservation is a **preflight hold**, not permission to erase a provider call that actually completed;
- before the provider returns successfully, a failed/cancelled provider attempt may release its reservation when the code can establish that no usable provider result/cost exists;
- after a provider call returns a usable success response, **never call reservation release merely because actual usage exceeded the estimate, settlement was delayed, or a later persistence step failed**;
- successful provider output and its exact metering/pricing snapshot must be made durable before or as part of resumable settlement whenever the architecture permits;
- unexpected actual usage above the reserved estimate must still be represented in the provider-usage/cost ledger. Preflight quota remains the gate for starting a call; it is not a hard cap that justifies dropping real cost after the fact;
- a reservation expiring before a durable provider-success result is settled must not make the provider cost disappear. Settlement/recovery must distinguish already-released reservation capacity from unrecorded provider usage and avoid double-decrement or double-charge;
- retry/resume after provider success must be idempotent and must not issue a second provider call just because quota or DB settlement is uncertain;
- provider-dollar cost and customer-facing AI allowance are related but distinct concepts. Do not assume every future provider/model/modality uses one identical token unit or pricing shape;
- when a provider exposes separately billable usage such as thinking/reasoning tokens or modality-specific input, capture/account it exactly once and preserve enough immutable data to audit historical cost;
- do not claim provider cost/quota settlement is verified until executable concurrency, expiry, over-reservation and provider-success persistence cases have actually been run.

If a proposed local fix would satisfy only one symptom while leaving a provider-success cost-loss path elsewhere, record the broader defect in `docs/WORKLOG_REBUILD_PROGRESS.md` and fix the invariant as one coherent settlement design instead of adding contradictory branches.

## Development validation policy

During the accelerated MVP implementation phase:

- prefer static consistency review, source-level contract checking, and authored/updated tests;
- record tests that were authored but not executed as **not executed**;
- never claim typecheck, test, migration, schema, browser, Worker, LINE, Gemini, or E2E validation passed without actual local/runtime logs;
- do not repeatedly spend hourly scheduled runs attempting unavailable local execution;
- keep the concentrated executable validation pass deferred until major MVP paths are implemented and the user explicitly wants that run.

The concentrated local pass should eventually include the relevant install/build/typecheck/test/schema/migration/browser/Worker smoke checks, but it is a separate explicit validation phase and is not a reason to use GitHub Actions.

## Scheduled-run handoff requirement

Before finishing each scheduled or interactive development run, update `docs/WORKLOG_REBUILD_PROGRESS.md` with:

- completed changes;
- static validation performed;
- tests authored/updated but not executed;
- known risks;
- next large batch;
- explicit confirmation that GitHub Actions were not run or triggered during the run.

Every end-of-run user report must also include:

- an estimated MVP feature-completion percentage;
- an estimated production-readiness percentage that accounts for deferred executable validation;
- the concrete remaining work, separating code/static-audit work from external configuration/payment-provider work;
- the estimated number of remaining large development batches;
- a practical time estimate for reaching the concentrated local validation phase and, separately, for finishing fixes after that validation.

These percentages and time estimates are planning estimates, not test results. Adjust them downward if a later static audit or local validation discovers material defects.
