# AFTERTRACE Internal Admin

The Admin is intentionally a single-operator internal ops console. It is not a customer-facing backoffice and does not implement roles, teams or a separate password system.

## What it includes

- Overview: User/Group counts, today's AI calls/cost, Platform Subsidy, failed AI work, active Reminder/Proactive counts.
- Users: inspect private Energy lots, subscription, PAID purchases, Rewarded Ad claims, AI usage and Reminder history.
- Groups: inspect members, active memories, extraction batches, Reminder and Proactive state.
- Failures: failed Memory requests, explicit chat failures and Proactive failures.
- Settings: edit mutable operational product configuration stored in Neon.
- Audit: recent domain audit rows. Setting changes additionally persist immutable before/after history in `operational_setting_changes`.

Settings covers AI model/pricing/token bounds, FX, Energy conversion and FREE amount, subscription/PAID amounts and prices, Rewarded Ad amount/limits, AI safety budgets and retention timing. Updates are validated server-side and become authoritative for subsequent Worker requests without a deployment.

Infrastructure and credentials are intentionally NOT editable from Admin: `DATABASE_URL`, LINE secrets/tokens, `GEMINI_API_KEY`, payment/webhook secrets, Cloudflare Access configuration, provider endpoint URLs and other trust-boundary values remain Cloudflare variables/secrets.

Completed purchase/cycle/AI usage records continue to keep their transaction/pricing snapshots; changing current Settings never rewrites historical financial records.

## Architecture

```text
Browser
  -> Cloudflare Access
  -> Admin Cloudflare Pages (apps/admin)
  -> same-origin Pages Function /api/v1/admin/*
  -> AFTERTRACE Worker /api/v1/admin/*
  -> verify Cloudflare Access JWT again
  -> Neon operational_settings + product data
```

The frontend contains no Admin secret. The Pages Function forwards the signed `Cf-Access-Jwt-Assertion` supplied by Cloudflare Access. The Worker validates RS256 signature, issuer/team domain, Access application audience, time validity and exact `ADMIN_ALLOWED_EMAIL`.

## Cloudflare Pages setup

Create a separate Pages project pointing at this repository.

- Root directory: repository root
- Build command: `pnpm install --no-frozen-lockfile && pnpm --filter @aftertrace/admin build`
- Build output directory: `apps/admin/dist`
- Pages runtime variable: `ADMIN_API_ORIGIN=https://<your-aftertrace-worker-host>`

`ADMIN_API_ORIGIN` is read only by the Pages Function and must use HTTPS.

## Cloudflare Access setup

Protect the Admin Pages hostname with a Cloudflare Access self-hosted application. Allow only the intended operator account/email, then configure Worker:

- `CLOUDFLARE_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`
- `CLOUDFLARE_ACCESS_AUD=<Access application AUD tag>`
- `ADMIN_ALLOWED_EMAIL=<your admin email>`
- `ADMIN_WEB_ORIGIN=https://<admin-pages-host>`

The Worker Admin API remains cryptographically protected even if its route is called directly.

## Local development

For UI-only work run `pnpm dev:admin`. Production Admin requires a real Cloudflare Access JWT; there is intentionally no development password bypass.

## Security rules

- Never put Admin secrets in Vite variables.
- Settings may change product economics but cannot directly mutate User Energy lots, subscription state or payment status.
- Every Settings write records before/after value and operator identity.
- Keep Admin Pages behind Access and `noindex`.
- Keep `ADMIN_API_ORIGIN` on HTTPS.
