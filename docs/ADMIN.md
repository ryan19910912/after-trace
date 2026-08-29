# AFTERTRACE Internal Admin

The Admin is intentionally a single-operator internal ops console. It is not a customer-facing backoffice and does not implement roles, teams or a separate password system.

## What it includes

- Overview: User/Group counts, today's AI calls/cost, Platform Subsidy, failed AI work, active Reminder/Proactive counts.
- Users: search by numeric id or LINE user id; inspect private Energy lots, subscription, PAID purchases, Rewarded Ad claims, AI usage and Reminder history.
- Groups: search by numeric id or LINE group id; inspect current members, active memories, extraction batches, Reminder and Proactive state.
- Failures: failed Memory requests, explicit chat failures and Proactive failures.
- Audit: recent `audit_logs` rows.
- Mutations are intentionally narrow: retry a FAILED Memory request and cancel a still-SCHEDULED Proactive Push.

No Admin endpoint directly edits Energy lots, subscription state or payment status.

## Architecture

```text
Browser
  -> Cloudflare Access
  -> Admin Cloudflare Pages (apps/admin)
  -> same-origin Pages Function /api/v1/admin/*
  -> AFTERTRACE Worker /api/v1/admin/*
  -> verify Cloudflare Access JWT again
  -> Neon
```

The frontend contains no Admin secret. The Pages Function forwards the signed `Cf-Access-Jwt-Assertion` supplied by Cloudflare Access. The Worker validates:

- RS256 signature against the Cloudflare Access JWK set;
- issuer / team domain;
- Access application audience;
- expiration/not-before;
- exact `ADMIN_ALLOWED_EMAIL`.

## Cloudflare Pages setup

Create a separate Pages project pointing at this repository.

Recommended build configuration:

- Root directory: repository root
- Build command: `pnpm install --no-frozen-lockfile && pnpm --filter @aftertrace/admin build`
- Build output directory: `apps/admin/dist`

Pages runtime environment variable:

- `ADMIN_API_ORIGIN=https://<your-aftertrace-worker-host>`

`ADMIN_API_ORIGIN` is read only by the Pages Function and must use HTTPS.

## Cloudflare Access setup

Protect the Admin Pages custom hostname with a Cloudflare Access self-hosted application.

Policy: allow only the operator account/email intended for AFTERTRACE Admin.

Record the Access application AUD tag and configure the Worker:

- `CLOUDFLARE_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`
- `CLOUDFLARE_ACCESS_AUD=<Access application AUD tag>`
- `ADMIN_ALLOWED_EMAIL=<your admin email>`
- `ADMIN_WEB_ORIGIN=https://<admin-pages-host>`

The Worker Admin API remains cryptographically protected even if its route is called directly; the Pages proxy is for a simple same-origin browser experience, not the sole security boundary.

## Local development

The production Admin requires a real Cloudflare Access JWT, so local calls to the protected Worker Admin API are intentionally not bypassed by a development password.

For UI-only work, run:

```bash
pnpm dev:admin
```

For end-to-end Admin testing, use a non-production Pages/Access environment with its own Access application AUD and test operator email.

## Security rules

- Do not add a hard-coded Admin token to Vite environment variables; Vite variables are browser-visible.
- Do not expose Energy mutation or subscription/payment mutation endpoints just for convenience.
- Any future write action must use an existing domain service/ledger and leave an audit trail.
- Keep the Admin Pages hostname behind Access and `noindex`.
- Keep `ADMIN_API_ORIGIN` on HTTPS.
