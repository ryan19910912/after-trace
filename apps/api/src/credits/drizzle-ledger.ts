import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { formatTwdCostUnits, type CreditBucket } from './allocation';
import type {
  CreditLedgerMutation,
  CreditLedgerMutationStatus,
  CreditLedgerRepository,
  CreditOperationType,
  CreditReference,
} from './ledger';

type MutationRow = {
  status: CreditLedgerMutationStatus;
  operation_id: string | null;
};

type OperationRow = {
  id: string;
  requested_amount_cost_twd: string;
  scope_bucket: CreditBucket | null;
};

function mutationFromRow(row: MutationRow | undefined): CreditLedgerMutation {
  if (!row) throw new Error('credit ledger mutation returned no result');
  return {
    status: row.status,
    operationId: row.operation_id === null ? null : Number(row.operation_id),
  };
}

export class DrizzleCreditLedgerRepository implements CreditLedgerRepository {
  constructor(private readonly db: Database) {}

  private async findOperation(
    groupId: number,
    type: CreditOperationType,
    reference: CreditReference,
  ): Promise<OperationRow | null> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        requested_amount_cost_twd::text AS requested_amount_cost_twd,
        scope_bucket
      FROM credit_operations
      WHERE group_id = ${groupId}
        AND type = ${type}
        AND reference_type = ${reference.type}
        AND reference_id = ${reference.id}
      LIMIT 1
    `);
    return (result.rows[0] as OperationRow | undefined) ?? null;
  }

  private async resolveConcurrentOperation(
    mutation: CreditLedgerMutation,
    groupId: number,
    type: CreditOperationType,
    reference: CreditReference,
    amountUnits?: bigint,
    scopeBucket?: CreditBucket | null,
  ): Promise<CreditLedgerMutation> {
    if (mutation.operationId !== null || mutation.status !== 'ALREADY_APPLIED') return mutation;

    const existing = await this.findOperation(groupId, type, reference);
    if (!existing) return mutation;

    if (amountUnits !== undefined && existing.requested_amount_cost_twd !== formatTwdCostUnits(amountUnits)) {
      return { status: 'REFERENCE_CONFLICT', operationId: Number(existing.id) };
    }
    if (scopeBucket !== undefined && existing.scope_bucket !== scopeBucket) {
      return { status: 'REFERENCE_CONFLICT', operationId: Number(existing.id) };
    }
    return { status: 'ALREADY_APPLIED', operationId: Number(existing.id) };
  }

  async grant(
    groupId: number,
    bucket: CreditBucket,
    amountUnits: bigint,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation> {
    const amount = formatTwdCostUnits(amountUnits);
    const result = await this.db.execute(sql`
      WITH existing_operation AS MATERIALIZED (
        SELECT id, requested_amount_cost_twd, scope_bucket
        FROM credit_operations
        WHERE group_id = ${groupId}
          AND type = 'GRANT'
          AND reference_type = ${reference.type}
          AND reference_id = ${reference.id}
        LIMIT 1
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id, type, scope_bucket, requested_amount_cost_twd,
          reference_type, reference_id, created_at
        )
        SELECT
          ${groupId}, 'GRANT', CAST(${bucket} AS credit_bucket), CAST(${amount} AS numeric),
          ${reference.type}, ${reference.id}, ${at}
        WHERE NOT EXISTS (SELECT 1 FROM existing_operation)
        ON CONFLICT DO NOTHING
        RETURNING id, requested_amount_cost_twd, scope_bucket
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id, group_id, bucket, type, amount_cost_twd, created_at
        )
        SELECT id, ${groupId}, CAST(${bucket} AS credit_bucket), 'GRANT', CAST(${amount} AS numeric), ${at}
        FROM new_operation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, bucket, amount_cost_twd
      ),
      account_mutation AS (
        INSERT INTO credit_accounts (
          group_id, bucket, available_cost_twd, reserved_cost_twd, updated_at
        )
        SELECT ${groupId}, bucket, amount_cost_twd, 0, ${at}
        FROM ledger
        ON CONFLICT (group_id, bucket) DO UPDATE
        SET available_cost_twd = credit_accounts.available_cost_twd + EXCLUDED.available_cost_twd,
            updated_at = EXCLUDED.updated_at
        RETURNING id
      ),
      paid_marker AS (
        UPDATE line_groups
        SET has_paid = TRUE, updated_at = ${at}
        WHERE id = ${groupId}
          AND CAST(${bucket} AS credit_bucket) = 'PAID'
          AND EXISTS (SELECT 1 FROM ledger)
        RETURNING id
      )
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1 FROM existing_operation
            WHERE requested_amount_cost_twd <> CAST(${amount} AS numeric)
               OR scope_bucket IS DISTINCT FROM CAST(${bucket} AS credit_bucket)
          ) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing_operation) THEN 'ALREADY_APPLIED'
          WHEN EXISTS (SELECT 1 FROM ledger) THEN 'APPLIED'
          ELSE 'ALREADY_APPLIED'
        END AS status,
        COALESCE(
          (SELECT id::text FROM new_operation LIMIT 1),
          (SELECT id::text FROM existing_operation LIMIT 1)
        ) AS operation_id
    `);

    return this.resolveConcurrentOperation(
      mutationFromRow(result.rows[0] as MutationRow | undefined),
      groupId,
      'GRANT',
      reference,
      amountUnits,
      bucket,
    );
  }

  async consume(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation> {
    const amount = formatTwdCostUnits(amountUnits);
    const result = await this.db.execute(sql`
      WITH existing_operation AS MATERIALIZED (
        SELECT id, requested_amount_cost_twd, scope_bucket
        FROM credit_operations
        WHERE group_id = ${groupId}
          AND type = 'CONSUME'
          AND reference_type = ${reference.type}
          AND reference_id = ${reference.id}
        LIMIT 1
      ),
      locked_accounts AS MATERIALIZED (
        SELECT bucket, available_cost_twd
        FROM credit_accounts
        WHERE group_id = ${groupId}
          AND bucket IN ('WELCOME', 'AD', 'PAID')
          AND (expires_at IS NULL OR expires_at > ${at})
        ORDER BY bucket
        FOR UPDATE
      ),
      balances AS (
        SELECT
          COALESCE(MAX(available_cost_twd) FILTER (WHERE bucket = 'WELCOME'), 0)::numeric AS welcome,
          COALESCE(MAX(available_cost_twd) FILTER (WHERE bucket = 'AD'), 0)::numeric AS ad,
          COALESCE(MAX(available_cost_twd) FILTER (WHERE bucket = 'PAID'), 0)::numeric AS paid
        FROM locked_accounts
      ),
      calculated AS (
        SELECT
          LEAST(welcome, CAST(${amount} AS numeric)) AS welcome_amount,
          LEAST(ad, GREATEST(CAST(${amount} AS numeric) - LEAST(welcome, CAST(${amount} AS numeric)), 0)) AS ad_amount,
          LEAST(
            paid,
            GREATEST(
              CAST(${amount} AS numeric)
              - LEAST(welcome, CAST(${amount} AS numeric))
              - LEAST(ad, GREATEST(CAST(${amount} AS numeric) - LEAST(welcome, CAST(${amount} AS numeric)), 0)),
              0
            )
          ) AS paid_amount,
          welcome + ad + paid >= CAST(${amount} AS numeric) AS covered
        FROM balances
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id, type, scope_bucket, requested_amount_cost_twd,
          reference_type, reference_id, created_at
        )
        SELECT
          ${groupId}, 'CONSUME', NULL, CAST(${amount} AS numeric),
          ${reference.type}, ${reference.id}, ${at}
        FROM calculated
        WHERE covered
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        ON CONFLICT DO NOTHING
        RETURNING id
      ),
      allocations AS (
        SELECT 'WELCOME'::credit_bucket AS bucket, welcome_amount AS amount FROM calculated
        UNION ALL
        SELECT 'AD'::credit_bucket, ad_amount FROM calculated
        UNION ALL
        SELECT 'PAID'::credit_bucket, paid_amount FROM calculated
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id, group_id, bucket, type, amount_cost_twd, created_at
        )
        SELECT operation.id, ${groupId}, allocation.bucket, 'CONSUME', allocation.amount, ${at}
        FROM new_operation AS operation
        CROSS JOIN allocations AS allocation
        WHERE allocation.amount > 0
        ON CONFLICT DO NOTHING
        RETURNING operation_id, bucket, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET available_cost_twd = account.available_cost_twd - ledger.amount_cost_twd,
            updated_at = ${at}
        FROM ledger
        WHERE account.group_id = ${groupId}
          AND account.bucket = ledger.bucket
        RETURNING account.id
      )
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1 FROM existing_operation
            WHERE requested_amount_cost_twd <> CAST(${amount} AS numeric)
               OR scope_bucket IS NOT NULL
          ) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing_operation) THEN 'ALREADY_APPLIED'
          WHEN EXISTS (SELECT 1 FROM new_operation) THEN 'APPLIED'
          WHEN (SELECT covered FROM calculated) THEN 'ALREADY_APPLIED'
          ELSE 'INSUFFICIENT'
        END AS status,
        COALESCE(
          (SELECT id::text FROM new_operation LIMIT 1),
          (SELECT id::text FROM existing_operation LIMIT 1)
        ) AS operation_id
    `);

    return this.resolveConcurrentOperation(
      mutationFromRow(result.rows[0] as MutationRow | undefined),
      groupId,
      'CONSUME',
      reference,
      amountUnits,
      null,
    );
  }

  async reservePaid(
    groupId: number,
    amountUnits: bigint,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation> {
    const amount = formatTwdCostUnits(amountUnits);
    const result = await this.db.execute(sql`
      WITH existing_operation AS MATERIALIZED (
        SELECT id, requested_amount_cost_twd, scope_bucket
        FROM credit_operations
        WHERE group_id = ${groupId}
          AND type = 'RESERVE'
          AND reference_type = ${reference.type}
          AND reference_id = ${reference.id}
        LIMIT 1
      ),
      locked_paid AS MATERIALIZED (
        SELECT available_cost_twd
        FROM credit_accounts
        WHERE group_id = ${groupId}
          AND bucket = 'PAID'
          AND (expires_at IS NULL OR expires_at > ${at})
        FOR UPDATE
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id, type, scope_bucket, requested_amount_cost_twd,
          reference_type, reference_id, created_at
        )
        SELECT
          ${groupId}, 'RESERVE', 'PAID', CAST(${amount} AS numeric),
          ${reference.type}, ${reference.id}, ${at}
        WHERE COALESCE((SELECT available_cost_twd FROM locked_paid LIMIT 1), 0) >= CAST(${amount} AS numeric)
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        ON CONFLICT DO NOTHING
        RETURNING id
      ),
      reservation AS (
        INSERT INTO credit_reservations (
          group_id, reserve_operation_id, reference_type, reference_id,
          amount_cost_twd, status, created_at, updated_at
        )
        SELECT
          ${groupId}, id, ${reference.type}, ${reference.id},
          CAST(${amount} AS numeric), 'RESERVED', ${at}, ${at}
        FROM new_operation
        ON CONFLICT DO NOTHING
        RETURNING reserve_operation_id, amount_cost_twd
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id, group_id, bucket, type, amount_cost_twd, created_at
        )
        SELECT reserve_operation_id, ${groupId}, 'PAID', 'RESERVE', amount_cost_twd, ${at}
        FROM reservation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET available_cost_twd = account.available_cost_twd - ledger.amount_cost_twd,
            reserved_cost_twd = account.reserved_cost_twd + ledger.amount_cost_twd,
            updated_at = ${at}
        FROM ledger
        WHERE account.group_id = ${groupId}
          AND account.bucket = 'PAID'
        RETURNING account.id
      )
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1 FROM existing_operation
            WHERE requested_amount_cost_twd <> CAST(${amount} AS numeric)
               OR scope_bucket IS DISTINCT FROM 'PAID'::credit_bucket
          ) THEN 'REFERENCE_CONFLICT'
          WHEN EXISTS (SELECT 1 FROM existing_operation) THEN 'ALREADY_APPLIED'
          WHEN EXISTS (SELECT 1 FROM ledger) THEN 'APPLIED'
          WHEN COALESCE((SELECT available_cost_twd FROM locked_paid LIMIT 1), 0) >= CAST(${amount} AS numeric)
            THEN 'ALREADY_APPLIED'
          ELSE 'INSUFFICIENT'
        END AS status,
        COALESCE(
          (SELECT id::text FROM new_operation LIMIT 1),
          (SELECT id::text FROM existing_operation LIMIT 1)
        ) AS operation_id
    `);

    return this.resolveConcurrentOperation(
      mutationFromRow(result.rows[0] as MutationRow | undefined),
      groupId,
      'RESERVE',
      reference,
      amountUnits,
      'PAID',
    );
  }

  async releasePaidReservation(
    groupId: number,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation> {
    return this.settleReservation(groupId, reference, at, 'RELEASE');
  }

  async consumePaidReservation(
    groupId: number,
    reference: CreditReference,
    at: Date,
  ): Promise<CreditLedgerMutation> {
    return this.settleReservation(groupId, reference, at, 'CONSUME');
  }

  private async settleReservation(
    groupId: number,
    reference: CreditReference,
    at: Date,
    settlementType: 'RELEASE' | 'CONSUME',
  ): Promise<CreditLedgerMutation> {
    const targetStatus = settlementType === 'RELEASE' ? 'RELEASED' : 'CONSUMED';
    const result = await this.db.execute(sql`
      WITH existing_operation AS MATERIALIZED (
        SELECT id, requested_amount_cost_twd, scope_bucket
        FROM credit_operations
        WHERE group_id = ${groupId}
          AND type = ${settlementType}
          AND reference_type = ${reference.type}
          AND reference_id = ${reference.id}
        LIMIT 1
      ),
      locked_reservation AS MATERIALIZED (
        SELECT id, amount_cost_twd, status
        FROM credit_reservations
        WHERE group_id = ${groupId}
          AND reference_type = ${reference.type}
          AND reference_id = ${reference.id}
        FOR UPDATE
      ),
      transitioned AS (
        UPDATE credit_reservations AS reservation
        SET status = CAST(${targetStatus} AS credit_reservation_status),
            updated_at = ${at}
        FROM locked_reservation
        WHERE reservation.id = locked_reservation.id
          AND locked_reservation.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM existing_operation)
        RETURNING reservation.amount_cost_twd
      ),
      new_operation AS (
        INSERT INTO credit_operations (
          group_id, type, scope_bucket, requested_amount_cost_twd,
          reference_type, reference_id, created_at
        )
        SELECT
          ${groupId}, CAST(${settlementType} AS credit_transaction_type), 'PAID',
          amount_cost_twd, ${reference.type}, ${reference.id}, ${at}
        FROM transitioned
        ON CONFLICT DO NOTHING
        RETURNING id, requested_amount_cost_twd
      ),
      ledger AS (
        INSERT INTO credit_transactions (
          operation_id, group_id, bucket, type, amount_cost_twd, created_at
        )
        SELECT id, ${groupId}, 'PAID', CAST(${settlementType} AS credit_transaction_type), requested_amount_cost_twd, ${at}
        FROM new_operation
        ON CONFLICT DO NOTHING
        RETURNING operation_id, amount_cost_twd
      ),
      account_mutation AS (
        UPDATE credit_accounts AS account
        SET available_cost_twd = CASE
              WHEN ${settlementType} = 'RELEASE'
                THEN account.available_cost_twd + ledger.amount_cost_twd
              ELSE account.available_cost_twd
            END,
            reserved_cost_twd = account.reserved_cost_twd - ledger.amount_cost_twd,
            updated_at = ${at}
        FROM ledger
        WHERE account.group_id = ${groupId}
          AND account.bucket = 'PAID'
          AND account.reserved_cost_twd >= ledger.amount_cost_twd
        RETURNING account.id
      )
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM existing_operation) THEN 'ALREADY_APPLIED'
          WHEN EXISTS (SELECT 1 FROM ledger) THEN 'APPLIED'
          WHEN NOT EXISTS (SELECT 1 FROM locked_reservation) THEN 'NOT_FOUND'
          WHEN EXISTS (
            SELECT 1 FROM locked_reservation
            WHERE status <> 'RESERVED'
          ) THEN 'ALREADY_SETTLED'
          ELSE 'ALREADY_APPLIED'
        END AS status,
        COALESCE(
          (SELECT id::text FROM new_operation LIMIT 1),
          (SELECT id::text FROM existing_operation LIMIT 1)
        ) AS operation_id
    `);

    const mutation = mutationFromRow(result.rows[0] as MutationRow | undefined);
    if (mutation.operationId !== null || mutation.status !== 'ALREADY_APPLIED') return mutation;

    const existing = await this.findOperation(groupId, settlementType, reference);
    return existing
      ? { status: 'ALREADY_APPLIED', operationId: Number(existing.id) }
      : mutation;
  }
}
