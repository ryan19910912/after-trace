# AFTERTRACE Worklog Local Validation

Branch: `revive/line-worklog`

This file records checks that were actually executed locally by the user. It is not a substitute for the durable development policy and does not authorize GitHub Actions.

## 2026-09-02

Completed successfully on Windows local development environment:

- `pnpm install` — passed; install output clean after dependency alignment.
- `pnpm typecheck` — passed across API, Web, Admin and the still-present legacy `packages/shared` workspace.
- `pnpm test` — passed.
  - Admin: 4/4 tests passed.
  - API: 27/27 test files passed, 167/167 tests passed.
  - Web: no test files; `--passWithNoTests` exited successfully.
  - `packages/shared`: no test files; `--passWithNoTests` exited successfully.
- `pnpm db:schema:check` — completed successfully and generated `aftertrace-schema.sql`.

Bugs/test defects found and fixed during this validation pass:

- Worklog usage route discriminated-union typing.
- TEXT normalization persistence test mock literal typing.
- Bootstrap fake repository incorrectly treated first owner bind as a conflict.
- Reply TEXT regression assertion was too strict after legitimate source/author/timestamp fields were added.
- TEXT normalization cost test used exact floating-point equality rather than tolerance.

## Next validation gates

1. Run journaled PostgreSQL migrations `0000`–`0014` on a disposable PostgreSQL/Neon database.
2. Check the generated/live schema for expected objects and drift.
3. Exercise CRM delete/link concurrency because the foundation schema currently relies mainly on application validation rather than foreign keys.
4. Run post-cutover `drizzle/post-cutover/9000_worklog_legacy_cleanup.sql` only on disposable DB after normal migrations succeed.
5. Local browser smoke for Web and Admin.
6. API/Web/Admin Worker local build/smoke.
7. Real LINE lifecycle/TEXT/Reply/media E2E.
8. Real Gemini TEXT/image/audio/PDF usage and cost snapshot checks.

## Still deferred

- Remove retired `packages/shared` workspace and regenerate lockfile after the active Worklog validation gates are stable.
- Payment provider remains intentionally unconnected.
- GitHub Actions remain disabled/not used unless explicitly requested by the user.
