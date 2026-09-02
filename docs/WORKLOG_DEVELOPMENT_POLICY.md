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
