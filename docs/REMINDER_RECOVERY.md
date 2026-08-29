# AFTERTRACE V1 Reminder Recovery

## Purpose

Round 12 deliberately leaves a Reminder unresolved when LINE delivery cannot be confirmed safely. The PAID reservation remains intact rather than guessing refund/consume semantics.

Round 13 adds a narrow internal recovery primitive for the subset that can be retried without weakening duplicate-send protection.

## Safe requeue conditions

`ReminderRecoveryService.requeueUnresolved` requires all of the following:

- exact `groupId` and `reminderId`;
- exact expected delivery attempt count;
- exact existing LINE retry key;
- current Reminder state is `DISPATCHING`;
- delivery lease is already expired (or absent), so a live Worker cannot still be inside the external call boundary;
- stored LINE retry-key expiry is still in the future;
- explicit `operatorRef` and human-readable `reason`.

If every fence matches, the Reminder returns to `SCHEDULED` while preserving the same retry key and attempt history. A `REMINDER_DELIVERY_REQUEUED` audit event records operator reference, reason, attempt and retry key.

## What recovery refuses to do

The recovery primitive does not:

- invent a new retry key after the old key expires;
- silently release the PAID reservation;
- silently consume the PAID reservation without confirmed delivery;
- requeue while the prior dispatch lease is still active;
- reopen CANCELLED/DELIVERED reminders;
- accept a stale attempt count or different retry key.

Those cases require a separately defined product/operator disposition with adequate evidence.

## Exposure boundary

This is an internal domain/repository capability only. No HTTP route is exposed in V1 yet because an authenticated operator/admin authorization boundary is still not defined. Adding an unauthenticated recovery endpoint is explicitly prohibited.
