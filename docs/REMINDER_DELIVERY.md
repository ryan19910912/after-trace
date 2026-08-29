# Reminder Delivery Runtime

## Purpose

This document defines the V1 runtime boundary between a paid Reminder reservation and LINE Push delivery. It does not change Reminder pricing or credit policy.

## Due work ownership

- Only `SCHEDULED` reminders whose `scheduled_for <= now()` are claimable.
- The Group must still be ACTIVE and the corresponding PAID reservation must still be `RESERVED`.
- Claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`, an incrementing delivery attempt count and a short lease.
- A stable LINE retry key is assigned on the first claim and reused by later retries.
- The retry-key safety window is capped at 23 hours in application state so the runtime never intentionally retries after LINE's documented 24-hour retry-key management period.

## Cancellation race

Claiming does not prevent cancellation. Immediately before the external Push, the current claim must pass `authorizeDispatch` with the exact attempt fence, retry key, unexpired lease, active Group and current `SCHEDULED` state.

Authorization atomically moves `SCHEDULED -> DISPATCHING`.

Therefore cancellation may safely win any time before dispatch authorization. Once `DISPATCHING` is committed, the runtime has committed to the external delivery attempt and ordinary cancellation no longer mutates the reservation.

## Duplicate-send prevention

LINE Messaging API Push supports `X-Line-Retry-Key`. The same hexadecimal UUID is sent on the first request and every retry. LINE documents that a previously accepted retry key returns HTTP 409 instead of accepting the same operation twice.

The adapter therefore treats both a successful 2xx response and HTTP 409 for the stable retry key as accepted delivery for settlement purposes. Network errors, HTTP 429 and 5xx are retryable only while the same stored retry key remains inside its safety window.

The application never creates a fresh retry key for the same Reminder after an ambiguous failure.

## Settlement

PAID value is consumed only after LINE has accepted the Push. Runtime settlement requires:

- exact Reminder id / Group id;
- current `DISPATCHING` state;
- exact attempt count fence;
- exact stored retry key;
- `RESERVED` credit reservation.

Reminder `DELIVERED`, reservation `CONSUMED`, PAID reserved-balance decrement, credit operation/transaction and `REMINDER_DELIVERED` audit are committed in one PostgreSQL statement.

If LINE returns a retryable failure, the exact fenced `DISPATCHING` attempt may return to `SCHEDULED` while preserving the retry key. If a permanent or retry-window-expired failure occurs, the runtime deliberately does not guess whether reserved PAID should be released or consumed; the reminder remains unresolved for later operator/product policy.

## Cloudflare scheduled boundary

`apps/api/src/worker.ts` is the module entry and exposes both HTTP `fetch` and a Cloudflare `scheduled` handler. The scheduled handler creates the Neon repository and LINE adapter and runs due delivery.

The repository does not hard-code a cron cadence because V1 requirements do not define Reminder scheduling resolution. Deployment must configure the desired Cloudflare Cron Trigger separately.
