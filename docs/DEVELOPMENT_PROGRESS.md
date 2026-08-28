# AFTERTRACE Development Progress

## Current status

Round 3 adds the safety foundation required before any Gemini memory extraction is enabled: database-owned extraction batches with leases, sender/group-member persistence, exact credit-allocation primitives, AI pricing/FX snapshots, and explicit reply/@AI `記住` detection.

GitHub Actions is still an environment blocker: the latest checked run for `0611c2e` completed with a failed `verify` job before any workflow step executed (`steps` absent / no logs). Therefore repository-wide install/typecheck/lint/test/build is still not proven by Actions.

## Confirmed V1 baseline

- TypeScript monorepo with pnpm.
- API: Hono on Cloudflare Workers.
- LIFF Web: React + Vite + TypeScript on Cloudflare Pages.
- Database: PostgreSQL on Neon, accessed through Drizzle ORM.
- AI: Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis and no object storage.
- LINE messages are buffered short-term; memories are group-scoped long-term data.
- Memory extraction is event-driven, but Gemini may only run after a database claim owns a concrete batch.
- Automatic and explicit @AI memories share dedup/update/contradiction handling.
- All group members may manage memories; no Owner/Admin role is introduced.
- Memory source metadata is retained when LINE provides it.
- Credit model is prepaid, not subscription-based. Welcome/ad value is consumed before paid value; paid credit does not expire.
- First activated group per LINE user defaults to NT$1 internal welcome allowance; later groups default to NT$0.5.
- Reward defaults: NT$0.01 internal allowance, max 5/group/day, 15-minute cooldown.
- Reminder is paid-only and reserves paid value when created.
- Inactive never-paid groups retain recoverable product data for 30 days; paid groups for 1 year.

## Round 1 — completed

Repository/product/architecture bootstrap, Hono Worker, LIFF shell, Neon/Drizzle foundation, initial schema, CI, env template and README.

## Round 2 — completed

LINE signature verification and ordered event parsing, supported group-message normalization, attachment metadata-only handling, idempotent conversation ingestion, group lifecycle protection, pending counters, configurable thresholds, source traceability, unit tests, ESLint configuration, and CI wiring.

## Round 3 — completed

### Extraction ownership / retry safety

- Added configurable `CONVERSATION_EXTRACTION_LEASE_SECONDS` with a 120-second default.
- Added `conversation_extraction_batches` and `conversation_messages.extraction_batch_id`.
- Only one open extraction claim is allowed per group through `(group_id, active_claim_key)` where completed rows set the nullable key back to `NULL`.
- Added a database-backed claim adapter using one PostgreSQL CTE to: select all currently unassigned conversation rows, verify thresholds, create a batch, assign the exact candidate rows, and decrement pending counters by the exact assigned totals.
- Concurrent duplicate claims are suppressed with `ON CONFLICT DO NOTHING`.
- Claims use a lease. An expired claim is reclaimed with `FOR UPDATE SKIP LOCKED`, increments `attempt_count`, and keeps the same immutable message batch.
- Failure is deferred by moving the lease/retry time and recording a normalized error code; success marks the batch `SUCCEEDED` and releases the open claim key.
- Added a repository-agnostic `ConversationExtractionCoordinator` and unit tests for threshold forwarding, lease calculation, and failure-code normalization.

### Group-member persistence

- Added `group_members` plus `line_users.updated_at`.
- Active message senders are now upserted into `line_users` and a per-group member snapshot before message persistence.
- `last_seen_at` only moves forward, making redelivery harmless.
- Inactive group messages remain ignored before sender/member mutation.
- Updated conversation service tests to verify sender capture and inactive protection.

### Credit primitives

- Added exact 8-decimal TWD cost-unit helpers using bigint, avoiding floating-point ledger allocation.
- Added deterministic consumption allocation in the required order: `WELCOME -> AD -> PAID`.
- Added paid-only reservation allocation for Reminder.
- Allocation reports shortfall instead of silently overdrawing.
- Added reference-level uniqueness foundation to `credit_transactions` so later atomic ledger retries can be idempotent.
- Added unit tests for order, shortfall, paid-only reservation, and decimal round-trip behavior.

### AI cost metering foundation

- Added a pure token-cost calculator that requires an explicit input/output token price snapshot and USD/TWD rate.
- Expanded `ai_usage_events` to retain input/output USD-per-million-token rates, USD/TWD rate, actual USD/TWD cost, and charged TWD cost alongside model/tokens/latency.
- No Gemini token price or FX rate was invented or silently hard-coded into the memory domain.
- Added calculator tests including invalid negative usage rejection.

### Explicit memory command boundary

- Added detection for tagged commands such as `@AI 記住 Amy 不吃香菜`.
- Added reply-mode `記住` detection that carries `quotedLineMessageId` as the intended source.
- Ordinary untagged group text such as `記住明天要下雨` is deliberately not treated as a command.
- Detection does not persist memory directly; it is ready to route into the same future candidate/dedup pipeline.
- Added unit tests for tagged, quoted, and ordinary-chat cases.

### Architecture / configuration

- Updated architecture documentation for claim leases, sender snapshots, exact credit accounting, AI pricing snapshots, and explicit-memory boundaries.
- Updated `.env.example` with the extraction lease override.
- No migrations have been generated or executed yet because dependency-aware build validation is still unavailable and the near-term ledger/memory schema is not fully stabilized.

## Round 3 validation

### Static/design verification completed

- Reviewed all Round 3 changes against `PRODUCT_V1.md`, `ARCHITECTURE.md`, Round 2 handoff, and current source interfaces before writing.
- Extraction claim SQL is a single-statement CTE for batch creation/assignment/counter decrement; this avoids a non-transactional multi-query claim on Neon HTTP.
- Credit allocation core is dependency-free and uses bigint fixed-point units.
- No external credentials, production identifiers, AI prices, FX values, or payment assumptions were guessed.

### Full workspace blocker remains

- Latest inspected GitHub Actions run for the prior head `0611c2e` still failed before a workflow step was assigned/executed and has no job logs.
- The automation runtime still cannot prove `pnpm install`, dependency-aware TypeScript, ESLint, Vitest, Wrangler dry-run, or Vite build until a runner actually executes CI or an install-capable checkout runtime becomes available.
- Treat any Drizzle driver typing/runtime issue discovered by a real CI runner as highest-priority Round 4 work before adding Gemini.

## Round 4 — highest priority

1. Re-check GitHub Actions for the Round 3 commit. If steps execute, fix every real install/typecheck/lint/test/build problem first.
2. Connect extraction claiming to the webhook threshold result so `extractionDue` schedules/executes only after `claimDueBatch` returns a real batch; do not call Gemini yet if credit/metering mutation is not atomic.
3. Implement the atomic Drizzle/PostgreSQL credit-ledger repository: idempotent GRANT/CONSUME/RESERVE/RELEASE, bucket balance checks, `WELCOME -> AD -> PAID` debit, PAID-only reservation, and reconciliation-safe references.
4. Implement AI usage persistence coupled to a credit charge reference so a retry cannot double-charge a Gemini response.
5. Add Rewarded Ad grant policy state (daily count + cooldown) and Welcome-credit attribution using observed LINE users without inventing an Owner role.
6. Route detected explicit-memory commands to a pending memory-candidate request that resolves the quoted source row and enters the same future dedup pipeline.
7. After credit/metering atomicity is tested, add Gemini structured extraction and candidate persistence for `NEW / DUPLICATE / UPDATE / CONTRADICT`.
8. Add Reminder schema/service only after the paid-credit reservation repository exists; reservation must happen at creation and release on cancellation.
9. Generate the initial Drizzle migration only after dependency-aware type/build validation is available and the schema for ingestion + extraction + credits has stabilized.

## Process note

Prefer one logical batched commit per round when possible. Round 3 uses the Git data blob/tree/commit path so all source changes land together and avoid the CI-run churn seen during Round 2.
