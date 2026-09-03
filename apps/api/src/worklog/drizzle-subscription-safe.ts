import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { DrizzleWorklogSubscriptionRepository } from './drizzle-subscription';
import type {
  WorklogAiReservationSnapshot,
  WorklogAiUsageCommit,
  WorklogSubscriptionRepository,
} from './subscription';

type ReservationRow = {
  token: string;
  charged_user_id: string | number;
  actor_user_id: string | number;
  source_id: string | number | null;
  units_reserved: number | string;
  units_committed: number | string;
  status: WorklogAiReservationSnapshot['status'];
  period_start: Date | string;
  period_end: Date | string | null;
  expires_at: Date | string;
};

/**
 * Runtime repository with settlement guards that lock both the reservation and
 * its matching quota-cycle balance before changing either row. This closes the
 * data-modifying-CTE edge where a reservation could otherwise change state while
 * the matching balance update matched no row or raced another settlement.
 */
export class SafeDrizzleWorklogSubscriptionRepository extends DrizzleWorklogSubscriptionRepository {
  constructor(db: Database) {
    super(db);
    this.database = db;
  }

  private readonly database: Database;

  override async commitAiReservationAtomic(
    token: string,
    usage: WorklogAiUsageCommit,
    at: Date,
  ): Promise<WorklogAiReservationSnapshot | null> {
    const result = await this.database.execute(sql`
      WITH locked AS (
        SELECT
          reservation.token,
          reservation.charged_user_id,
          reservation.actor_user_id,
          reservation.source_id,
          reservation.units_reserved,
          reservation.period_start,
          reservation.period_end,
          reservation.expires_at,
          reservation.status AS previous_status
        FROM worklog_ai_quota_reservations AS reservation
        INNER JOIN worklog_ai_quota_balances AS balance
          ON balance.user_id = reservation.charged_user_id
         AND balance.period_start = reservation.period_start
        WHERE reservation.token = ${token}
          AND reservation.status IN ('RESERVED', 'EXPIRED')
          AND (
            reservation.status = 'EXPIRED'
            OR balance.reserved_units >= reservation.units_reserved
          )
        FOR UPDATE OF reservation, balance
      ),
      claimed AS (
        UPDATE worklog_ai_quota_reservations AS reservation
        SET status = 'COMMITTED',
            units_committed = ${usage.actualUnits},
            updated_at = NOW()
        FROM locked
        WHERE reservation.token = locked.token
          AND reservation.status = locked.previous_status
        RETURNING reservation.*, locked.previous_status
      ),
      adjusted AS (
        UPDATE worklog_ai_quota_balances AS balance
        SET reserved_units = balance.reserved_units - CASE
              WHEN claimed.previous_status = 'RESERVED' THEN claimed.units_reserved
              ELSE 0
            END,
            used_units = balance.used_units + claimed.units_committed,
            updated_at = NOW()
        FROM claimed
        WHERE balance.user_id = claimed.charged_user_id
          AND balance.period_start = claimed.period_start
        RETURNING balance.id
      ),
      usage_event AS (
        INSERT INTO worklog_ai_usage_events (
          actor_user_id, charged_user_id, workspace_id, source_id, record_id,
          provider, model, input_tokens, output_tokens, audio_input_units,
          image_input_units, input_usd_per_million, output_usd_per_million,
          audio_usd_per_million, image_usd_per_million, usd_twd_rate,
          provider_cost_usd, provider_cost_twd, ai_units_consumed, created_at
        )
        SELECT
          claimed.actor_user_id,
          claimed.charged_user_id,
          ${usage.workspaceId ?? null},
          claimed.source_id,
          ${usage.recordId ?? null},
          ${usage.provider},
          ${usage.model},
          ${usage.inputTokens},
          ${usage.outputTokens},
          ${usage.audioInputUnits ?? 0},
          ${usage.imageInputUnits ?? 0},
          ${usage.inputUsdPerMillion},
          ${usage.outputUsdPerMillion},
          ${usage.audioUsdPerMillion ?? null},
          ${usage.imageUsdPerMillion ?? null},
          ${usage.usdTwdRate ?? null},
          ${usage.providerCostUsd},
          ${usage.providerCostTwd ?? null},
          claimed.units_committed,
          ${at}
        FROM claimed
        WHERE EXISTS (SELECT 1 FROM adjusted)
        RETURNING id
      )
      SELECT
        claimed.token,
        claimed.charged_user_id::text AS charged_user_id,
        claimed.actor_user_id::text AS actor_user_id,
        claimed.source_id::text AS source_id,
        claimed.units_reserved,
        claimed.units_committed,
        claimed.status,
        claimed.period_start,
        claimed.period_end,
        claimed.expires_at
      FROM claimed
      WHERE EXISTS (SELECT 1 FROM adjusted)
        AND EXISTS (SELECT 1 FROM usage_event)
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? reservationFromRow(row) : null;
  }

  override async releaseAiReservationAtomic(
    token: string,
    at: Date,
  ): Promise<WorklogAiReservationSnapshot | null> {
    const result = await this.database.execute(sql`
      WITH locked AS (
        SELECT
          reservation.token,
          reservation.charged_user_id,
          reservation.actor_user_id,
          reservation.source_id,
          reservation.units_reserved,
          reservation.units_committed,
          reservation.period_start,
          reservation.period_end,
          reservation.expires_at
        FROM worklog_ai_quota_reservations AS reservation
        INNER JOIN worklog_ai_quota_balances AS balance
          ON balance.user_id = reservation.charged_user_id
         AND balance.period_start = reservation.period_start
        WHERE reservation.token = ${token}
          AND reservation.status = 'RESERVED'
          AND balance.reserved_units >= reservation.units_reserved
        FOR UPDATE OF reservation, balance
      ),
      released AS (
        UPDATE worklog_ai_quota_reservations AS reservation
        SET status = 'RELEASED', updated_at = ${at}
        FROM locked
        WHERE reservation.token = locked.token
          AND reservation.status = 'RESERVED'
        RETURNING reservation.*
      ),
      adjusted AS (
        UPDATE worklog_ai_quota_balances AS balance
        SET reserved_units = balance.reserved_units - released.units_reserved,
            updated_at = NOW()
        FROM released
        WHERE balance.user_id = released.charged_user_id
          AND balance.period_start = released.period_start
        RETURNING balance.id
      )
      SELECT
        released.token,
        released.charged_user_id::text AS charged_user_id,
        released.actor_user_id::text AS actor_user_id,
        released.source_id::text AS source_id,
        released.units_reserved,
        released.units_committed,
        released.status,
        released.period_start,
        released.period_end,
        released.expires_at
      FROM released
      WHERE EXISTS (SELECT 1 FROM adjusted)
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? reservationFromRow(row) : null;
  }
}

// Compile-time contract check: the runtime wrapper remains a drop-in repository.
const _repositoryContract: new (db: Database) => WorklogSubscriptionRepository = SafeDrizzleWorklogSubscriptionRepository;
void _repositoryContract;

function reservationFromRow(row: ReservationRow): WorklogAiReservationSnapshot {
  return {
    token: row.token,
    chargedUserId: numeric(row.charged_user_id),
    actorUserId: numeric(row.actor_user_id),
    sourceId: row.source_id === null ? null : numeric(row.source_id),
    unitsReserved: numeric(row.units_reserved),
    unitsCommitted: numeric(row.units_committed),
    status: row.status,
    periodStart: dateValue(row.period_start),
    periodEnd: row.period_end === null ? null : dateValue(row.period_end),
    expiresAt: dateValue(row.expires_at),
  };
}

function numeric(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('invalid numeric database value');
  return parsed;
}

function dateValue(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid date database value');
  return parsed;
}
