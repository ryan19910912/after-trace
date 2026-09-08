# AFTERTRACE

AFTERTRACE is a **Web + PWA-first work-memory product** with a compact Chrome extension for fast desktop capture.

Core promise:

> 快速留下工作發生過的事，需要時找得到。

Development for the current V1 rebuild is on `revive/line-worklog`.

## V1 product

- Web/PWA manual Record CRUD, timeline, deterministic search and date filtering.
- Provider-free browser/device speech-to-text for quick voice input where supported.
- PRIVATE Sources and AFTERTRACE-native GROUP Sources with invite links and server-side membership authorization.
- Google Login, LINE Login and Apple Login as provider-neutral authentication providers.
- Immutable opaque customer-facing `帳號 ID` for support lookup.
- FREE manual product plus one idempotent Admin-configured one-time AI trial allowance.
- AI Pro at **NT$99/month** with per-user entitlement, monthly resource limits, provider-cost hard cap and optional per-request cap.
- Provider-backed AI text, voice/audio, image, supported file/PDF input, natural-language search, Related Records, bounded time-range summaries, explicit rewrite proposals and AI Task proposals.
- Native Tasks/reminders, durable notification center, Web/PWA Push and Admin announcements.
- In-product Feedback with Admin workflow.
- NewebPay / 藍新信用卡定期定額 for AI Pro subscription transport.
- Chrome extension quick text, selected text, browser speech-to-text, optional page title/URL context and explicit visible-tab screenshot/image AI.

## LINE boundary

LINE is **not** a Record/group/AI product surface.

- LINE Login remains a supported login provider.
- The official LINE OA remains an external customer-support contact channel.
- LINE webhook product commands, bot GROUP authorization, `小跡`, GROUP AI funding/responsible-user flows, LINE Reply caches and LINE attachment ingestion are retired and must not be rebuilt without a new explicit product decision.

## Commercial model

V1 has exactly two customer plans:

- `FREE` — NT$0
- `AI_PRO` — NT$99/month

There is no ONE_TIME top-up and no third paid tier in V1.

FREE remains a complete manual product. New eligible FREE accounts may receive one configured AI trial grant. Trial points are not a TWD cash balance and do not refresh monthly.

## Deployment

AFTERTRACE uses Cloudflare Workers only:

- Dev: `after-trace-api-dev`, `after-trace-web-dev`, `after-trace-admin-dev`
- Prod: `after-trace-api-prod`, `after-trace-web-prod`, `after-trace-admin-prod`

Deployment is manual. PostgreSQL is the durable data store. The API Worker owns one shared approximately five-minute Cron for scheduled announcements, Task reminders and pending Push delivery.

The current prelaunch canonical `drizzle/0000` is known stale and must be regenerated from the current TypeScript schema before clean database rebuild/deployment. Existing prelaunch Dev/current Prod data are disposable until real customer data exists.

## Development contract

Read the current documents in the exact order defined by `docs/WORKLOG_DEVELOPMENT_POLICY.md`.

The authoritative product documents describe only the Web/PWA/Chrome V1 target. Historical LINE-first behavior is not a compatibility requirement.

Do not run or modify GitHub Actions unless the user explicitly requests it. Do not claim tests passed unless they were actually executed successfully.
