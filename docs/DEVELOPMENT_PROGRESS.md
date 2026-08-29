# AFTERTRACE Development Progress

## Current status

**AFTERTRACE V1 is Feature Complete at the functional/product-code level.**

The implemented V1 now covers every behavior explicitly required by `docs/PRODUCT_V1.md`. Remaining work is release verification, generated migration review, deployment configuration and external provider/account setup; those are not missing V1 product features.

**V1 is not yet Release Verified / Production Ready.** GitHub Actions currently creates the `verify` job but does not assign a hosted runner (`runner_id=0`, empty runner name, zero steps, no job log). Therefore the repository has not yet executed the final typecheck/lint/test/build/Drizzle chain.

## V1 functional completion checklist

### LINE-first Group memory product

- LINE raw-body signature verification.
- Group-only conversation ingestion.
- Idempotent message buffering and extraction counters.
- Bot join/leave lifecycle.
- `memberJoined` / `memberLeft` membership lifecycle.
- Attachment binaries are not persisted; supported metadata/reference only.
- Previous extraction context support and retention-safe cleanup.

### Group Memory

- Automatic extraction requests.
- Explicit `@AI 記住` requests.
- Gemini structured classifier.
- NEW / DUPLICATE / UPDATE / CONTRADICT handling.
- Durable source attribution.
- LIFF list/search/edit/delete.
- Actor audit for edits/deletes.
- Background eligible-subject snapshot plus prompt/parser/DB persistence hard gates.

### Generic `@AI`

- Deterministic `@AI 額度 / 幫助 / 方案` without Gemini/Energy charge.
- General `@AI <question>` grounded in recent Group messages + ACTIVE memories.
- Caller-only User Energy funding.
- Full-request conservative Energy pre-hold before Gemini.
- Actual-use settlement and unused-hold release.
- Provider failure releases the hold.
- LINE redelivery reuses completed answer rather than double-charging.
- Raw LINE ids are pseudonymized before provider invocation.
- Successful billable chat records usage type, provider/model, tokens, latency, pricing/FX snapshot, USD/TWD provider cost and Energy charge; exact User lot allocation is preserved by the hold allocation/settlement ledger.

### User Energy wallet

- Same LINE User shares one wallet across Groups.
- Lifetime FREE once, non-expiring.
- SUBSCRIPTION cycle lots expire at real provider `period_end`, no rollover.
- Google Ad Manager Web Rewarded AD lots expire after seven days.
- SMALL/MEDIUM/LARGE PAID lots do not expire.
- Spend order: earliest expiring lots -> FREE -> PAID.
- Atomic grant/consume/reserve/release/reserved-consume with idempotent references and no-negative guarantees.
- Private LIFF wallet overview with usable/reserved bucket totals, lot expiry and subscription state.
- Group Energy replies expose availability only, never another User's numeric balance.

### Background AI charging and safety

- Eligible only when current extraction-batch textual contribution is positive and User Energy is positive at preflight.
- No eligible participant -> stop before automatic request/Gemini.
- Full Group context may be read while durable subjects remain eligible-only.
- Actual Energy allocated among eligible Users proportional to normalized current-batch text characters.
- Final per-User shortfall consumes that User to zero and becomes Platform Subsidy; never shifts to another member.
- Per-User allocation/subsidy audit persistence.
- Global `V1_FREE_AI` budget reconciliation.
- Pre-provider global budget reservation uses a PostgreSQL advisory lock in the same SQL transaction statement.
- Memory Gemini has explicit `GEMINI_MEMORY_MAX_OUTPUT_TOKENS`.
- The exact serialized Gemini Memory request body is used as a UTF-8-byte conservative input-token upper bound.
- Worst-case provider TWD cost is calculated from that full request-body bound plus configured max output tokens.
- Global budget reserves that computed worst-case provider cost before Gemini.
- `BACKGROUND_AI_MAX_SUBSIDY_COST_TWD` is an additional per-call safety ceiling; if computed risk exceeds it, Gemini is not invoked.
- Final settlement converts only actual shortfall into spent Platform Subsidy and releases unused reserved risk.

### Rewarded Ad

- Google Ad Manager Web Rewarded provider abstraction.
- LIFF-authenticated server nonce issuance.
- SHA-256 nonce persistence, ten-minute expiry and one-time use.
- Provider-event idempotency.
- User-level cooldown/daily limits.
- GPT browser rewarded flow.
- Server claim only after rewarded-granted browser event.
- Accepted reward mints seven-day AD Energy.
- Web Rewarded is not falsely described as mobile SSV/provider-cryptographic verification.

### Subscription / PAID commerce

- One configured subscription product and three configured PAID packs.
- Private LIFF catalog.
- Provider-neutral checkout intent persistence and idempotency.
- Generic trusted HTTP payment-adapter contract using the same `requestKey` as provider-side idempotency key.
- Only HTTPS checkout/return URLs are accepted from the trusted adapter boundary.
- LIFF Subscription/PAID buttons call the provider-neutral checkout API when adapter + price configuration is present.
- Verified normalized provider-event boundary supports:
  - `SUBSCRIPTION_CYCLE_PAID`
  - `SUBSCRIPTION_CANCELLED`
  - `PAID_PACK_PURCHASED`
- Provider event idempotency ledger.
- Subscription cycle grants expire exactly at provider `period_end`.
- Cancellation does not remove already-paid current-cycle Energy before expiry.
- PAID purchase grants are permanent until consumed.
- Core code does not guess Stripe/ECPay/other provider choice or production prices.

### Reminder

- User owner/payer, Group destination.
- Owner must be a current Group member.
- Only valid SUBSCRIPTION/PAID can fund Reminder.
- Subscription lot expiry must safely cover scheduled delivery.
- Exact originating lots are reserved.
- Owner-only cancellation releases exact lots.
- Delivery rechecks Group activity + owner membership.
- Owner-left -> no Push + cancel + release.
- Successful LINE acceptance -> exact reservation consume.
- Retry key / delivery lease safety.

### Proactive Push

- User-owned Proactive capability requires usable SUBSCRIPTION or PAID Energy.
- Approved trigger-producer contract; product modules cannot write queue rows directly.
- Trusted internal enqueue boundary.
- Queue idempotency by User/request/source.
- Enqueue checks Group membership + current capability.
- Delivery rechecks Group membership + current capability.
- Lost capability/membership -> cancel rather than Push.
- LINE retry keys and dispatch leases.
- Worker cron delivery.
- V1 does not invent business trigger rules that are absent from `PRODUCT_V1.md`.

### Retention / privacy / reconciliation

- Group cleanup never deletes User wallet/subscription/purchase/Energy transaction value.
- Active Reminder/Proactive work blocks purge.
- Settled financial AI identity remains reconcilable while private prompt/content is redacted where appropriate.
- User-owned Reminder financial identity is preserved while terminal private text can be redacted.
- Minimal Group anchor remains while User-owned financial history references the Group.
- Legacy 30/365-day Group timing remains compatibility configuration pending an explicit replacement product rule.

### Legacy Group Credit quarantine

- Active LIFF/management product surface no longer queries legacy Group Credit overview.
- New V1 AI/Rewarded/Reminder/Proactive/Subscription/PAID paths use User Energy only.
- `apps/api/src/credits` is explicitly documented as legacy history/migration/reconciliation code.
- Legacy tables/modules remain readable until production migration policy permits removal.

## External deployment configuration — not feature gaps

Production still requires operator-approved values/accounts for:

- LINE / LIFF secrets and URLs.
- Neon production database and backup policy.
- Gemini key, current official token pricing and FX process.
- `ENERGY_UNITS_PER_TWD` product economics.
- `GEMINI_CHAT_MAX_OUTPUT_TOKENS` and `GEMINI_MEMORY_MAX_OUTPUT_TOKENS`.
- global/per-call AI safety budgets.
- FREE/SUBSCRIPTION/AD/PAID Energy amounts and prices.
- Google Ad Manager network/ad-unit configuration.
- one deployed payment adapter and its provider credentials.
- approved Proactive business trigger producers.
- Reminder Energy price.

See `docs/PRODUCTION_CHECKLIST.md`.

## Final verification status

The final verification workflow is now defined as:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm build`
5. `pnpm db:schema:check` (`drizzle-kit export` across `schema*.ts` without production DB credentials)
6. generated Drizzle migration review
7. GitHub Actions CI
8. non-production smoke test across LINE webhook, generic `@AI`, `@AI 記住`, background memory, LIFF wallet, Rewarded Ad, payment adapter, Reminder and Proactive Push

### Current blocker

GitHub Actions is creating runs and the `verify` job, but GitHub-hosted runner allocation fails before repository execution:

- `runner_id = 0`
- runner name is empty
- `steps = []`
- job logs are unavailable
- the same result occurs after manually rerunning failed jobs

The check-run reports one annotation, but the available connector does not expose the annotation endpoint. The exact account/platform reason therefore cannot be stated safely from repository data alone.

This is an external GitHub Actions runner/account allocation blocker, not a known repository test failure. Do not claim tests/build/Drizzle are green until a runner (or another dependency-complete execution environment) actually runs them.

## Next phase

**Do not add new V1 feature scope unless a product requirement changes.**

When runner execution is available, enter release-verification-only mode: run the complete verification chain, fix actual repository failures until green, generate/review migrations, perform smoke tests, then mark V1 Release Verified / Production Ready.
