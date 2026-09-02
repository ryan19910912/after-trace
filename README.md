# AFTERTRACE

AFTERTRACE is a LINE-first work-record product. LINE is the capture surface; the Web/PWA is the place to browse, organize and manage records.

Development for the current rebuild is on `revive/line-worklog`.

## MVP product

- Record text with `@AFTERTRACE <text>`.
- Reply to quoted LINE TEXT/AUDIO/IMAGE/FILE with `@AFTERTRACE` to create a work record.
- Open scoped personal/group PWA views through query links; no LIFF.
- Keep personal and group sources isolated.
- FREE is personal-only; group collaboration is paid/capability-driven and group AI usage is charged to the stable Owner.
- Manage records, customers, projects and typed finance (`RECEIVED`, `EXPENSE`, `RECEIVABLE`) in the PWA.
- Manage users/groups/plans/quota/AI runtime pricing/anomalies/feedback in Worklog Admin.

## LINE content policy

- Only ordinary group TEXT may be temporarily cached: PostgreSQL only, 5 days, max 1000 messages per group.
- Redis is not used for LINE content caching.
- AUDIO/IMAGE/FILE are never cached; Reply ingestion fetches them directly from LINE's content API.
- Binary content is processed in memory and never persisted.
- Expired/unavailable media asks the user to resend.
- Reply-created records preserve both the command LINE message id and quoted LINE message id.

## Deployment topology

AFTERTRACE uses three independent Cloudflare Workers, not Pages:

- `aftertrace-api` — Hono/TypeScript API, LINE webhooks, Worklog runtime, auth, PWA/Admin APIs, PostgreSQL/Drizzle and AI orchestration.
- `aftertrace-web` — React/Vite customer PWA via Workers Static Assets.
- `aftertrace-admin` — React/Vite internal Admin via Workers Static Assets.

PostgreSQL is the durable store. Gemini runtime model/pricing is DB/Admin controlled; `GEMINI_API_KEY` remains an API Worker secret.

## Development contract

Read these before changing the Worklog rebuild:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`

The old Memory/Energy/conversation/commerce/reminder product runtime is retired. Do not restore those modules as compatibility behavior. Historical migration `0000` remains for migration history; active Drizzle schema declarations are Worklog-only, and destructive legacy-table cleanup is a post-cutover step documented in `docs/WORKLOG_DEPLOYMENT.md`.
