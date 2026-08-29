# AFTERTRACE V1 LIFF Management

## Purpose

LIFF is the authenticated management/search surface for a single LINE Group. It does not create a cross-group user account or merge memories between Groups.

## Authentication boundary

The browser sends only:

- the LIFF access token returned by `liff.getAccessToken()`;
- the LINE Group id returned by `liff.getContext()`.

The API does **not** trust a user id supplied by the browser.

For every management request the Worker:

1. verifies the LIFF access token through LINE `GET /oauth2/v2.1/verify`;
2. requires the returned `client_id` to equal configured `LIFF_CHANNEL_ID` and the token to still be valid;
3. resolves the user from LINE `GET /v2/profile`;
4. looks up the requested LINE Group in AFTERTRACE and requires it to be ACTIVE;
5. verifies that user is currently a member through Messaging API `GET /v2/bot/group/{groupId}/member/{userId}`.

LINE 429/5xx failures are treated as verification-unavailable, not as proof that the caller left the Group. No management data is returned while verification is unavailable.

Cross-origin browser requests additionally require exact `LIFF_WEB_ORIGIN`. No wildcard management CORS origin is used.

## Management API

Mounted under `/api/v1/management`:

- `GET /overview` — bucket availability/reservation state, AI usage call count, Rewarded Ad policy state and feature capabilities.
- `GET /memories?q=` — ACTIVE Group memories only, including source metadata when available.
- `PATCH /memories/:id` — edit category/subject/content and append actor-attributed `MEMORY_EDITED` audit.
- `DELETE /memories/:id` — remove the product memory and append a full before-snapshot `MEMORY_DELETED` audit. Deletion is not a permanent blacklist; future conversation may establish the fact again.
- `GET /reminders` — Group Reminder management list.
- `POST /reminders` — create a paid-only Reminder only when `REMINDER_RESERVATION_COST_TWD` is explicitly configured server-side.
- `DELETE /reminders/:id` — cancel a normal `SCHEDULED` Reminder through the existing atomic PAID release lifecycle.

The LIFF client never supplies the Reminder reservation amount. This prevents a caller from reserving an arbitrary cheaper amount. When pricing is absent, creation returns `REMINDER_PRICING_NOT_CONFIGURED`; existing Reminder list/cancel remains available.

## Energy / cost exposure

V1 confirms that user-facing UI must use product Energy/Credit concepts rather than raw Gemini cost. A conversion ratio has not been confirmed.

Therefore the current management API intentionally exposes bucket state (`hasAvailable` / `hasReserved`) and AI usage count, not raw internal TWD/Gemini cost values. Do not relabel internal cost as Energy until the product conversion rule is explicitly defined.

## Rewarded Ad boundary

The existing backend `RewardedAdService.grantVerifiedReward()` assumes the upstream reward event has already been verified. It is **not** exposed directly to LIFF, because doing so would let a browser invent a reward event id and mint AD credit.

The LIFF currently exposes Rewarded Ad daily policy/status but keeps `rewardedAdClaimEnabled=false`. Enabling the button requires choosing a Web-capable rewarded-ad provider and implementing its trustworthy completion verification boundary first.

## Frontend behavior

`apps/web` now:

- initializes LIFF from `VITE_LIFF_ID`;
- requires a Group LIFF context;
- sends the LIFF access token and Group id to the API;
- provides memory search/edit/delete;
- provides safe Energy/Credit state without raw internal cost;
- provides Reminder list/create/cancel with pricing capability gating;
- displays Rewarded Ad policy/status while keeping reward minting disabled until provider verification exists.

## Required external configuration

Backend:

- `DATABASE_URL`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_CHANNEL_ID`
- `LIFF_WEB_ORIGIN` for Pages -> Worker browser calls
- `REMINDER_RESERVATION_COST_TWD` only when Reminder creation should be enabled

Frontend:

- `VITE_LIFF_ID`
- `VITE_API_BASE_URL`

These values are deployment inputs. No repository code should guess production ids, secrets, origins or Reminder prices.
