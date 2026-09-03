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

This includes subscription/pricing decisions. Current subscription design discussions must be persisted as they are agreed, including billing type, renewal behavior, quota refresh behavior, rollover rules, and payment-provider requirements.

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
