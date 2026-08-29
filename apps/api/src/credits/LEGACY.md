# Legacy Group Credit Modules

The files in this directory represent the pre-User-Energy Group-owned WELCOME/AD/PAID accounting model.

They are retained only for historical rows, migration/reconciliation reference and legacy-focused tests. New AFTERTRACE V1 product/runtime code must not import these modules to fund AI, Rewarded Ad, Reminder, Proactive Push, Subscription or PAID purchases.

Current V1 financial source of truth is under `apps/api/src/energy`, with User-owned lots/operations/transactions/reservations and Round 16-18 persistence.

Do not delete the legacy schema/tables until production migration/reconciliation requirements explicitly permit it. Do not add new product behavior here.
