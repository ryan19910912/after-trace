# AFTERTRACE V1 Group Retention

## Product policy

Inactive LINE Groups retain recoverable product data according to `PRODUCT_V1.md`:

- never-paid Group: 30 days after `inactive_at`;
- Group that has paid: one calendar year after `inactive_at`.

Financial and audit rows required for reconciliation are not part of the destructive product-data purge.

## Purged product data

When an eligible Group is purged, the retention repository atomically removes Group-scoped recoverable/private state including:

- conversation messages and extraction batches;
- memories;
- memory candidate requests, work state, durable classifier results and candidate results;
- automatic request keys;
- Group membership snapshots;
- rewarded-ad policy counters;
- terminal (`CANCELLED` / `DELIVERED`) Reminder product rows.

A `GROUP_PRODUCT_DATA_PURGED` audit record is written with the inactivity timestamp, paid-history flag, policy and whether a minimal paid anchor was retained.

## Preserved reconciliation state

Retention intentionally preserves:

- audit logs;
- credit accounts, operations, reservations and transactions;
- AI usage events and global free-AI budget reconciliation;
- Welcome/Rewarded-Ad grant attribution/history used to explain credit grants.

This separation prevents retention cleanup from making historical charges or grants unreconcilable.

## PAID value safety

PAID value does not expire. Therefore a paid Group with non-zero PAID `available_cost_twd` or `reserved_cost_twd` keeps its minimal `line_groups` anchor even after private product data is purged. This preserves the stable mapping needed to recover the prepaid balance if the same LINE Group later rejoins.

If no non-zero PAID balance remains, the expired `line_groups` row itself may be deleted after its product data is purged. Numeric historical `group_id` references remain in financial/audit records.

## Unresolved Reminder safety

Destructive purge is blocked when any Reminder in the Group is unresolved:

- Reminder state is `SCHEDULED` or `DISPATCHING`; or
- its Reminder credit reservation is still `RESERVED`.

Retention does not guess whether such value should be released or consumed. The Reminder must first reach an explicit safe disposition.

## Rejoin / repeated retention

No extra schema marker is required. The durable marker is the `GROUP_PRODUCT_DATA_PURGED` audit row whose `created_at` is at or after the Group's current `inactive_at`.

If a paid-anchor Group later rejoins and leaves again, `inactive_at` advances beyond the old purge audit. The new inactivity period therefore becomes independently eligible for the normal 30-day / one-year policy.

## Runtime

The Cloudflare `scheduled` handler runs Reminder delivery and retention as separate tasks. Reminder delivery only claims ACTIVE Groups; retention only considers INACTIVE Groups, so the two jobs do not compete for the same Group eligibility state.

The repository still does not hard-code a Cron Trigger cadence because V1 requirements define retention durations but not scheduler resolution.
