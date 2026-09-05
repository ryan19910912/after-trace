# AFTERTRACE

AFTERTRACE is a LINE-first general-purpose work-record product. LINE is the fast capture/edit/navigation surface; the Web/PWA is the authoritative place to browse, search, organize and manually manage records.

Development for the current rebuild is on `revive/line-worklog`.

## MVP product

- Record text with `@AFTERTRACE <text>` in the LINE OA/private chat or a group containing the bot.
- GROUP Reply-to-TEXT can use the temporary 5-day group text cache; PRIVATE ordinary text is not cached and must be re-entered later.
- Reply to LINE AUDIO/IMAGE/supported FILE content with `@AFTERTRACE` to create durable textual records without permanently storing the original binary.
- LINE HISTORY requests navigate to deterministic filtered PWA views rather than using an open-ended historical-answer agent.
- PRIVATE and GROUP Sources are isolated data spaces.
- Each Record belongs to one Source-scoped Entity / user-facing `紀錄標題`; aliases are alternate names for that title.
- PWA manual browse/search/filter/create/edit/delete/restore/title move/batch move/revision history is free.
- GROUP manual collaboration is authorized by active membership only. There is no paid collaboration gate and no maximum group count.
- AI allowance is user-owned Grant-based. GROUP AI additionally requires a current `AI 額度負責人` and an explicitly enabled Grant scope for that group.
- FREE launch grant is 400,000 AI points once per eligible new user; it does not refresh or expire by calendar.
- Customer AI points use the frozen `1 AI point = 1 output-price-equivalent token` accounting rule, while actual provider usage/cost remains auditable separately.
- Admin manages users/groups/plans/Grants/scopes/AI runtime pricing/subsidy/profitability/anomalies/feedback/audit.

The universal Worklog model does **not** use Customer/Project/Finance/Transaction/category/normalized-summary as core schema.

## LINE content policy

- Only ordinary GROUP TEXT may be temporarily cached: PostgreSQL only, default 5 days, max 1000 messages per group.
- Redis is not used for LINE content caching.
- PRIVATE ordinary support text is not cached.
- AUDIO/IMAGE/FILE binaries are never cached or permanently stored; Reply ingestion fetches them directly from LINE's content API.
- LINE `202` means content is not ready and must never be passed to Gemini as attachment bytes.
- Missing `Content-Length` does not disable attachment size limits; the resolver uses bounded streaming.
- Expired/unavailable media asks the user to resend.
- Reply-created records preserve both the command LINE message id and quoted LINE message id.

## Deployment topology

AFTERTRACE uses three independent Cloudflare Workers, not Pages:

- `after-trace-api` — Hono/TypeScript API, LINE webhooks, Worklog runtime, auth, PWA/Admin APIs, PostgreSQL/Drizzle and AI orchestration.
- `after-trace-web` — React/Vite customer PWA via Workers Static Assets.
- `after-trace-admin` — React/Vite internal Admin via Workers Static Assets.

PostgreSQL is the durable store. Production Workers use Cloudflare Variables/Secrets; repository `.env.local` is local/tooling input only.

Current Worklog AI runtime supports the validated Google Gemini model configured by Admin; provider/model/pricing must match the runtime contract before `/health/ready` is considered green.

## Prelaunch database policy

The project is still prelaunch. The checked-in `drizzle/0000_worklog_baseline.sql` / snapshot are known stale until regenerated from the current TypeScript schema and **must not be applied as-is**.

Use the documented destructive prelaunch regeneration flow only while there is no production data that must be preserved. Once real production data exists, switch immediately to forward-only migrations.

## Development contract

Read these before changing the Worklog rebuild, in order:

- `docs/WORKLOG_PRODUCT_SPEC.md`
- `docs/WORKLOG_ENTITY_MODEL.md`
- `docs/WORKLOG_RECORD_EDIT_POLICY.md`
- `docs/WORKLOG_AI_POINT_POLICY.md`
- `docs/WORKLOG_DEVELOPMENT_POLICY.md`
- `docs/WORKLOG_LINE_CONTENT_POLICY.md`
- `docs/WORKLOG_DEPLOYMENT.md`
- `docs/WORKLOG_REBUILD_PROGRESS.md`

The latest documents above are the only product/development specification. Do not revive old Customer/Project/Finance/Owner/aggregate-quota assumptions from legacy code, migrations or historical docs.

GitHub Actions must not be executed, dispatched, rerun, enabled, modified or used as validation unless explicitly requested by the user.
