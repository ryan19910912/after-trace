# AFTERTRACE AI Safety and Billing Boundaries

This document records the V1 runtime safety rules that must remain true when Gemini memory extraction is enabled.

## Durable result before settlement

A successful provider response is not immediately allowed to mutate memories. The response must first pass the strict structured-output and Group/source grounding checks and then be persisted in `memory_classifier_results` under the current request attempt fence.

Later retries reuse the first durable validated result. They must not intentionally call Gemini again merely because billing, candidate persistence or final request settlement was interrupted.

## Global free-AI budget

V1 requires a global hard safety boundary for free/subsidized AI usage. The operator must explicitly configure `GLOBAL_FREE_AI_BUDGET_COST_TWD`; the code intentionally has no guessed default and no invented daily/monthly reset cadence.

The budget measures cumulative actual AI cost funded from `WELCOME` and `AD` buckets. It does not block users from spending `PAID` credit.

For a guarded AI consume operation:

1. Allocate `WELCOME`, then `AD`, but never above the remaining global free-AI allowance.
2. Allocate any remaining amount from `PAID`.
3. If the Group has enough raw credit only because additional free subsidy would be required, reject with `FREE_BUDGET_EXHAUSTED` rather than overspending the global allowance.
4. If `PAID` can replace exhausted subsidy, the operation proceeds using the smaller free allocation plus paid value.

`global_free_ai_budget_operations` is keyed by the logical credit operation id. The global budget state and per-operation free amount are updated under one transaction-scoped advisory lock, so retrying the same logical AI charge cannot count the subsidy twice.

Reminder reservations are PAID-only and do not consume the free-AI budget.

## Pre-invocation funding eligibility

Before the first provider call for a request, the runtime may run an advisory funding check. It reads the Group's current WELCOME/AD/PAID available balances together with the current global free-AI spend.

- If the Group has neither usable free allowance nor PAID balance, the request is deferred before loading private conversation context or calling Gemini.
- If only WELCOME/AD balance exists but the global free-AI allowance is already exhausted, the request is deferred as `AI_FREE_BUDGET_EXHAUSTED`.
- A positive PAID balance keeps the request eligible even after the free subsidy is exhausted.
- A request that already has a durable classifier result skips this advisory check. The provider cost is already sunk and the system must continue toward exact idempotent settlement rather than strand the reusable result.

This preflight is deliberately non-locking and cannot know the exact provider cost before the model responds. It is only an avoid-obviously-unfunded-call optimization. The atomic post-call credit/global-budget transaction remains authoritative and can still defer a request if balances changed or the actual cost is larger than available value.

## Claim fencing is not retry counting

`memory_request_work_states.attempt_count` is a fencing token. It changes whenever ownership is reclaimed and must never be interpreted as the number of provider failures; credit waits and Worker recovery can legitimately increase it.

`transient_failure_count` separately tracks retryable AI execution failures. Credit waits and global-budget waits use the ordinary deferred path and do not consume the transient retry allowance.

## Provider error classification

Permanent failures are terminal for the current memory request and must not retry forever. Examples include invalid/missing runtime configuration, rejected credentials/authorization, invalid request shape and missing model/endpoint.

Transient failures use bounded exponential retry. Network failures, timeouts, rate limiting and upstream 5xx failures are retryable. Invalid/malformed provider responses are also retryable only within the bounded policy.

The default V1 code policy allows three transient failures, starting at a 60-second delay and capping the delay at 15 minutes. Terminal transitions remain attempt-fenced.

A terminal AUTOMATIC memory request also terminally closes its extraction batch and releases the active claim key.

## Explicit terminal recovery

Terminal work never resumes automatically. Recovery is an explicit operator action after the cause has been corrected.

`MemoryRecoveryService` requires the failed request id, the exact current `attempt_count`, an operator reference and a reason. The database mutation locks the failed request/work rows and only requeues when the expected fence still matches. It resets the transient-failure counter and terminal work timestamps/errors, returns the request to `PENDING`, and writes `MEMORY_REQUEST_REQUEUED` audit context containing the operator reference and reason.

For an AUTOMATIC request, the associated failed extraction batch is reopened in the same transaction. It is set back to `CLAIMED` without an `OPEN` active-claim key. This preserves the original assigned message set while avoiding a uniqueness conflict with any newer extraction batch already active for the Group. Completion/failure remains owned by the recovered memory request.

Recovery does not delete `memory_classifier_results`. If a validated result already exists, the normal orchestration path must reuse it and continue billing/candidate settlement without another Gemini call.

No unauthenticated HTTP recovery endpoint should be exposed. A future operator/admin surface must provide its own authenticated authorization boundary before invoking this service.

## Runtime activation rule

Real Gemini invocation must remain disconnected from the LINE webhook until dependency-aware verification is available and all of the following are explicitly configured:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (defaults only to the confirmed model name)
- `GEMINI_INPUT_USD_PER_MILLION_TOKENS`
- `GEMINI_OUTPUT_USD_PER_MILLION_TOKENS`
- `USD_TWD_RATE`
- `GLOBAL_FREE_AI_BUDGET_COST_TWD`

Provider prices, FX and the operator's free-AI budget ceiling are operational inputs, not product-domain constants.
