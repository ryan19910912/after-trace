# AFTERTRACE Development Progress

## Current status

Round 2 completed the first real vertical slice: verified LINE group webhook events can be normalized into an idempotent, group-scoped conversation-ingestion domain flow with pending counters and extraction-threshold decisions. Gemini is intentionally not connected yet; extraction claiming and cost/credit safety must exist first.

The main remaining verification blocker is the GitHub Actions runner environment: recent CI jobs have been created but several completed before any step ran, with no runner assigned. This is recorded as an environment blocker rather than a code-test failure.

## Confirmed V1 baseline

- TypeScript monorepo with pnpm.
- API: Hono on Cloudflare Workers.
- LIFF Web: React + Vite + TypeScript on Cloudflare Pages.
- Database: PostgreSQL on Neon, accessed through Drizzle ORM.
- AI: Gemini 2.5 Flash-Lite Standard.
- V1 has no Redis and no object storage.
- LINE messages are buffered short-term; memories are group-scoped long-term data.
- Memory extraction is event-driven based on message/character thresholds, not periodic DB polling.
- Automatic and explicit @AI memories share dedup/update/contradiction handling.
- All group members may manage memories; mutations/deletions must be auditable.
- Memory source metadata is retained when LINE provides it.
- Credit model is prepaid, not subscription-based. Welcome/ad value is consumed before paid value; paid credit does not expire.
- First activated group per LINE user defaults to NT$1 internal welcome allowance; later groups default to NT$0.5.
- Reward defaults: NT$0.01 internal allowance, max 5/group/day, 15-minute cooldown; values are configuration, not business-code constants.
- Reminder is paid-only and reserves paid value when created.
- Inactive never-paid groups retain recoverable product data for 30 days; paid groups for 1 year.

## Round 1 — completed

- Product/architecture/progress docs established.
- pnpm workspace with API, LIFF Web, and shared package bootstrapped.
- Hono Worker, React/Vite LIFF shell, Neon/Drizzle client, initial schema, CI, env template, and README added.

## Round 2 — completed

### Product configuration

- Added a single `ProductConfig` source for conversation thresholds, welcome/ad defaults, and retention defaults.
- Confirmed defaults remain 30 messages / 5,000 chars / 2,000-char large-message marker; NT$1 first welcome / NT$0.5 later welcome; NT$0.01 ad reward / 5 per day / 15-minute cooldown; 30/365-day inactive retention.
- All values can be overridden by deployment environment variables and invalid values fail fast.

### LINE webhook boundary

- Added Web Crypto HMAC-SHA256 verification of the raw LINE webhook body before JSON parsing.
- Added safe parsing for supported LINE group message types: text, image, video, audio, file, location, sticker.
- Direct-user events are excluded from group memory ingestion.
- Preserved `webhookEventId`, LINE message id, sender id, LINE timestamp, `quoteToken`, and `quotedMessageId`; attachments keep metadata only, never binary content.
- Parser preserves original webhook event order so message/leave/join sequencing remains meaningful.
- `join` activates a group; `leave` marks it inactive. Messages received while inactive are ignored until another `join`, preventing delayed webhook redelivery from accidentally reactivating a retained group.

### Conversation ingestion

- Added a repository-agnostic `ConversationIngestionService` and Drizzle/Neon adapter.
- New group messages are idempotent via unique LINE message id.
- Only successfully inserted messages increment pending message/character counters.
- Counter increments use database-side arithmetic to avoid lost updates from concurrent webhook requests.
- Ingestion returns an extraction-threshold decision but does not call Gemini.
- API exposes `POST /webhooks/line` and reports stored/duplicate/inactive-ignored counts without logging private conversation text or raw LINE group ids.

### Schema and source traceability

- Conversation rows now keep webhook id, quoted LINE message id, LINE timestamp, quote token, and normalized metadata.
- Memory schema now has its own source LINE timestamp in addition to source message id, quote token, and source user id so source attribution survives short-lived conversation-buffer cleanup.

### Tests and quality tooling

- Added tests for product-config defaults/overrides/invalid values.
- Added a fixed known-vector test for LINE HMAC signature verification.
- Added parser tests for group isolation, reply metadata, attachment/location metadata, and event ordering.
- Added threshold tests for message/character triggers and large-message marker.
- Added ingestion tests for threshold crossing, duplicate delivery, inactive-group rejection, and join reactivation.
- Added TypeScript ESLint flat config and included lint in CI.

## Round 2 validation

### Passed locally in the automation runtime

- Global TypeScript 5.8.3 strict typecheck passed for the dependency-free product config, LINE parser/signature, threshold, and ingestion service modules.
- Node 22 runtime checks passed for the known HMAC vector, LINE event normalization/order, config validation, threshold behavior, idempotent ingestion behavior, and inactive-group protection.

### CI / full workspace blocker

- GitHub Actions workflow dispatches on pushes, but multiple recent `verify` jobs completed before any workflow step ran; observed failed jobs had `steps: []`, `runner_id: 0`, and no downloadable job log. A later run was still queued with no runner assigned when checked.
- Therefore `pnpm install`, repository-wide TypeScript, ESLint, Vitest, Worker dry-run build, and Vite build have **not yet been proven by GitHub Actions**. Do not describe CI as green until a runner actually executes the steps.
- The local runtime could not reach the npm registry to install pnpm/dependencies, so full dependency-aware verification was not possible there either.
- No Neon, LINE, Cloudflare, LIFF, or Gemini production credentials were guessed or committed.

## Round 3 — highest priority

1. Re-check the latest GitHub Actions run first. If a runner executes steps, fix every real install/typecheck/lint/test/build failure before adding more features. If it still fails before step 1 with no runner, keep it documented as an environment blocker and continue static/unit-safe work.
2. Add database-backed conversation extraction batch/claim state so crossing a threshold can be claimed exactly once; do not call Gemini merely because counters remain above threshold.
3. Add group-member/sender persistence needed for LIFF membership checks, audit actors, and later welcome-credit attribution. Do not invent an Owner/Admin role; all group members remain managers.
4. Build credit-ledger service primitives for WELCOME -> AD -> PAID consumption and reservation/release semantics. Do not make billable Gemini calls until usage metering and credit charging can be coupled safely.
5. Define AI usage cost conversion/storage needed to reconcile USD provider cost with TWD internal credit. Keep pricing/configuration explicit rather than hard-coded in business services.
6. Add reply/@AI command detection using `quotedLineMessageId` and route explicit `記住` requests toward the same future memory pipeline as automatic extraction, without bypassing dedup logic.
7. Only after claim + credit/metering foundations are safe, add Gemini structured memory-candidate extraction and NEW/DUPLICATE/UPDATE/CONTRADICT persistence.
8. Generate the initial Drizzle migration only after dependency-aware type/build validation is available and the near-term ingestion/credit schema has stabilized; no migrations have been executed yet.

## Process note for later rounds

Prefer one logical batched commit per verified work package when the GitHub tree/commit API is available. The Round 2 connector wrote many small main-branch commits, which caused unnecessary CI run churn.
