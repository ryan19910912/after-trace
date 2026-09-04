import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAiPointLedgerRepository,
  WorklogAiPointReservationSnapshot,
} from './ai-point-ledger';
import type { WorklogAiUsageCommit } from './ai-provider-usage';

type ReservationRow = {
  id: string | number;
  token: string;
  charged_user_id: string | number;
  actor_user_id: string | number;
  source_id: string | number;
  points_reserved: string | number;
  points_committed: string | number;
  platform_subsidized_points: string | number;
  status: string;
  expires_at: Date | string;
};

/**
 * PostgreSQL single-statement reservation/settlement implementation.
 *
 * Reservation deducts grant.remaining_points immediately and increments the explicit
 * Source scope reserved_points hold. That makes concurrent requests safe without an
 * in-process mutex. Commit converts the hold into used_points and restores any unused
 * estimate; release/expiry restores the full hold. Customer balances never go below 0.
 */
export class DrizzleWorklogAiPointLedgerRepository implements WorklogAiPointLedgerRepository {
  constructor(private readonly db: Database) {}

  async expireStaleReservations(input: {
    chargedUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<number> {
    const result = await this.db.execute(sql`
      WITH expired AS (
        UPDATE worklog_ai_point_reservations
        SET status = 'EXPIRED', updated_at = ${input.at}
        WHERE charged_user_id = ${input.chargedUserId}
          AND source_id = ${input.sourceId}
          AND status = 'RESERVED'
          AND expires_at <= ${input.at}
        RETURNING id
      ), released AS MATERIALIZED (
        SELECT
          funding.grant_id,
          funding.grant_scope_id,
          SUM(funding.points_reserved)::int AS points_reserved
        FROM worklog_ai_point_reservation_funding funding
        INNER JOIN expired ON expired.id = funding.reservation_id
        GROUP BY funding.grant_id, funding.grant_scope_id
      ), grant_release AS (
        UPDATE worklog_ai_grants grant
        SET remaining_points = grant.remaining_points + released.points_reserved,
            status = CASE
              WHEN grant.status = 'EXHAUSTED' THEN 'ACTIVE'::worklog_ai_grant_status
              ELSE grant.status
            END,
            updated_at = ${input.at}
        FROM released
        WHERE grant.id = released.grant_id
        RETURNING grant.id
      ), scope_release AS (
        UPDATE worklog_ai_grant_scopes scope
        SET reserved_points = GREATEST(0, scope.reserved_points - released.points_reserved),
            updated_at = ${input.at}
        FROM released
        WHERE scope.id = released.grant_scope_id
        RETURNING scope.id
      )
      SELECT COUNT(*)::text AS count FROM expired
    `);
    return nonNegativeInteger((result.rows[0] as { count?: unknown } | undefined)?.count ?? 0, 'expired count');
  }

  async reservePointsAtomic(input: {
    token: string;
    chargedUserId: number;
    actorUserId: number;
    sourceId: number;
    requestedPoints: number;
    at: Date;
    expiresAt: Date;
  }): Promise<WorklogAiPointReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT
          grant.id AS grant_id,
          scope.id AS grant_scope_id,
          grant.remaining_points,
          scope.used_points,
          scope.reserved_points,
          scope.cap_points,
          grant.expires_at,
          grant.effective_at
        FROM worklog_ai_grants grant
        INNER JOIN worklog_ai_grant_scopes scope
          ON scope.grant_id = grant.id
         AND scope.source_id = ${input.sourceId}
         AND scope.enabled = TRUE
        WHERE grant.owner_user_id = ${input.chargedUserId}
          AND grant.status IN ('ACTIVE', 'EXHAUSTED')
          AND grant.remaining_points > 0
          AND grant.effective_at <= ${input.at}
          AND (grant.expires_at IS NULL OR grant.expires_at > ${input.at})
        ORDER BY grant.expires_at ASC NULLS LAST, grant.effective_at ASC, grant.id ASC
        FOR UPDATE OF grant, scope
      ), eligible AS MATERIALIZED (
        SELECT
          locked.*,
          LEAST(
            locked.remaining_points,
            CASE
              WHEN locked.cap_points IS NULL THEN locked.remaining_points
              ELSE GREATEST(0, locked.cap_points - locked.used_points - locked.reserved_points)
            END
          )::int AS usable_points
        FROM locked
      ), ordered AS MATERIALIZED (
        SELECT
          eligible.*,
          COALESCE(
            SUM(eligible.usable_points) OVER (
              ORDER BY eligible.expires_at ASC NULLS LAST, eligible.effective_at ASC, eligible.grant_id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          )::bigint AS points_before
        FROM eligible
        WHERE eligible.usable_points > 0
      ), allocation AS MATERIALIZED (
        SELECT
          ordered.grant_id,
          ordered.grant_scope_id,
          LEAST(
            ordered.usable_points,
            GREATEST(0, ${input.requestedPoints}::bigint - ordered.points_before)
          )::int AS points_reserved
        FROM ordered
        WHERE ordered.points_before < ${input.requestedPoints}
      ), nonzero AS MATERIALIZED (
        SELECT * FROM allocation WHERE points_reserved > 0
      ), total AS MATERIALIZED (
        SELECT COALESCE(SUM(points_reserved), 0)::int AS points_reserved FROM nonzero
      ), reservation AS (
        INSERT INTO worklog_ai_point_reservations (
          token,
          charged_user_id,
          actor_user_id,
          source_id,
          points_reserved,
          points_committed,
          platform_subsidized_points,
          status,
          expires_at,
          created_at,
          updated_at
        )
        SELECT
          ${input.token},
          ${input.chargedUserId},
          ${input.actorUserId},
          ${input.sourceId},
          total.points_reserved,
          0,
          0,
          'RESERVED',
          ${input.expiresAt},
          ${input.at},
          ${input.at}
        FROM total
        WHERE total.points_reserved > 0
        RETURNING *
      ), funding_insert AS (
        INSERT INTO worklog_ai_point_reservation_funding (
          reservation_id,
          grant_id,
          grant_scope_id,
          points_reserved,
          points_charged,
          created_at,
          updated_at
        )
        SELECT
          reservation.id,
          nonzero.grant_id,
          nonzero.grant_scope_id,
          nonzero.points_reserved,
          0,
          ${input.at},
          ${input.at}
        FROM reservation
        CROSS JOIN nonzero
        RETURNING id
      ), grant_hold AS (
        UPDATE worklog_ai_grants grant
        SET remaining_points = grant.remaining_points - nonzero.points_reserved,
            status = CASE
              WHEN grant.remaining_points - nonzero.points_reserved = 0
                THEN 'EXHAUSTED'::worklog_ai_grant_status
              ELSE 'ACTIVE'::worklog_ai_grant_status
            END,
            updated_at = ${input.at}
        FROM nonzero
        WHERE grant.id = nonzero.grant_id
          AND grant.remaining_points >= nonzero.points_reserved
        RETURNING grant.id
      ), scope_hold AS (
        UPDATE worklog_ai_grant_scopes scope
        SET reserved_points = scope.reserved_points + nonzero.points_reserved,
            updated_at = ${input.at}
        FROM nonzero
        WHERE scope.id = nonzero.grant_scope_id
        RETURNING scope.id
      )
      SELECT
        reservation.id::text AS id,
        reservation.token,
        reservation.charged_user_id::text AS charged_user_id,
        reservation.actor_user_id::text AS actor_user_id,
        reservation.source_id::text AS source_id,
        reservation.points_reserved,
        reservation.points_committed,
        reservation.platform_subsidized_points,
        reservation.status,
        reservation.expires_at
      FROM reservation
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? snapshot(row) : null;
  }

  async getReservation(token: string): Promise<WorklogAiPointReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        id::text AS id,
        token,
        charged_user_id::text AS charged_user_id,
        actor_user_id::text AS actor_user_id,
        source_id::text AS source_id,
        points_reserved,
        points_committed,
        platform_subsidized_points,
        status,
        expires_at
      FROM worklog_ai_point_reservations
      WHERE token = ${token}
      LIMIT 1
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? snapshot(row) : null;
  }

  async commitReservationAtomic(input: {
    token: string;
    usage: WorklogAiUsageCommit;
    actualPoints: number;
    at: Date;
  }): Promise<WorklogAiPointReservationSnapshot | null> {
    const usage = normalizeUsage(input.usage);
    const operation = operationOf(input.usage);
    const result = await this.db.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT *
        FROM worklog_ai_point_reservations
        WHERE token = ${input.token}
        FOR UPDATE
      ), settlement AS MATERIALIZED (
        SELECT
          target.id,
          target.status AS previous_status,
          CASE
            WHEN target.status = 'RESERVED' THEN LEAST(${input.actualPoints}, target.points_reserved)
            ELSE 0
          END::int AS customer_points,
          CASE
            WHEN target.status = 'RESERVED' THEN GREATEST(0, ${input.actualPoints} - target.points_reserved)
            ELSE ${input.actualPoints}
          END::int AS subsidy_points
        FROM target
        WHERE target.status IN ('RESERVED', 'EXPIRED')
      ), transitioned AS (
        UPDATE worklog_ai_point_reservations reservation
        SET status = 'COMMITTED',
            points_committed = settlement.customer_points,
            platform_subsidized_points = settlement.subsidy_points,
            updated_at = ${input.at}
        FROM settlement
        WHERE reservation.id = settlement.id
          AND reservation.status = settlement.previous_status
        RETURNING reservation.*, settlement.previous_status
      ), funding_ordered AS MATERIALIZED (
        SELECT
          funding.id,
          funding.grant_id,
          funding.grant_scope_id,
          funding.points_reserved,
          transitioned.points_committed,
          COALESCE(
            SUM(funding.points_reserved) OVER (
              ORDER BY funding.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          )::bigint AS points_before
        FROM worklog_ai_point_reservation_funding funding
        INNER JOIN transitioned ON transitioned.id = funding.reservation_id
        WHERE transitioned.previous_status = 'RESERVED'
      ), funding_charge AS MATERIALIZED (
        SELECT
          funding_ordered.*,
          LEAST(
            funding_ordered.points_reserved,
            GREATEST(0, funding_ordered.points_committed::bigint - funding_ordered.points_before)
          )::int AS points_charged
        FROM funding_ordered
      ), funding_update AS (
        UPDATE worklog_ai_point_reservation_funding funding
        SET points_charged = funding_charge.points_charged,
            updated_at = ${input.at}
        FROM funding_charge
        WHERE funding.id = funding_charge.id
        RETURNING funding.id
      ), grant_restore_amount AS MATERIALIZED (
        SELECT
          grant_id,
          SUM(points_reserved - points_charged)::int AS points_to_restore
        FROM funding_charge
        GROUP BY grant_id
      ), grant_restore AS (
        UPDATE worklog_ai_grants grant
        SET remaining_points = grant.remaining_points + grant_restore_amount.points_to_restore,
            status = CASE
              WHEN grant.status = 'EXHAUSTED' AND grant_restore_amount.points_to_restore > 0
                THEN 'ACTIVE'::worklog_ai_grant_status
              ELSE grant.status
            END,
            updated_at = ${input.at}
        FROM grant_restore_amount
        WHERE grant.id = grant_restore_amount.grant_id
        RETURNING grant.id
      ), scope_settle_amount AS MATERIALIZED (
        SELECT
          grant_scope_id,
          SUM(points_reserved)::int AS reserved_to_release,
          SUM(points_charged)::int AS points_charged
        FROM funding_charge
        GROUP BY grant_scope_id
      ), scope_settle AS (
        UPDATE worklog_ai_grant_scopes scope
        SET reserved_points = GREATEST(0, scope.reserved_points - scope_settle_amount.reserved_to_release),
            used_points = scope.used_points + scope_settle_amount.points_charged,
            updated_at = ${input.at}
        FROM scope_settle_amount
        WHERE scope.id = scope_settle_amount.grant_scope_id
        RETURNING scope.id
      ), usage_insert AS (
        INSERT INTO worklog_ai_usage_events (
          reservation_token,
          actor_user_id,
          charged_user_id,
          workspace_id,
          source_id,
          record_id,
          operation,
          provider,
          model,
          input_tokens,
          output_tokens,
          audio_input_units,
          image_input_units,
          input_usd_per_million,
          output_usd_per_million,
          audio_usd_per_million,
          image_usd_per_million,
          usd_twd_rate,
          provider_cost_usd,
          provider_cost_twd,
          customer_points_charged,
          platform_subsidized_points,
          platform_subsidized_cost_usd,
          platform_subsidized_cost_twd,
          created_at
        )
        SELECT
          transitioned.token,
          transitioned.actor_user_id,
          transitioned.charged_user_id,
          ${usage.workspaceId},
          transitioned.source_id,
          ${usage.recordId},
          ${operation},
          ${usage.provider},
          ${usage.model},
          ${usage.inputTokens},
          ${usage.outputTokens},
          ${usage.audioInputUnits},
          ${usage.imageInputUnits},
          ${usage.inputUsdPerMillion},
          ${usage.outputUsdPerMillion},
          ${usage.audioUsdPerMillion},
          ${usage.imageUsdPerMillion},
          ${usage.usdTwdRate},
          ${usage.providerCostUsd},
          ${usage.providerCostTwd},
          transitioned.points_committed,
          transitioned.platform_subsidized_points,
          GREATEST(
            0,
            ${usage.providerCostUsd} - (
              transitioned.points_committed::numeric * ${usage.outputUsdPerMillion}::numeric / 1000000
            )
          ),
          CASE
            WHEN ${usage.providerCostTwd}::numeric IS NULL THEN NULL
            WHEN ${usage.providerCostUsd}::numeric <= 0 THEN 0
            ELSE ${usage.providerCostTwd}::numeric * (
              GREATEST(
                0,
                ${usage.providerCostUsd}::numeric - (
                  transitioned.points_committed::numeric * ${usage.outputUsdPerMillion}::numeric / 1000000
                )
              ) / ${usage.providerCostUsd}::numeric
            )
          END,
          ${input.at}
        FROM transitioned
        ON CONFLICT (reservation_token) DO NOTHING
        RETURNING id, reservation_token
      ), usage_funding AS (
        INSERT INTO worklog_ai_usage_funding (
          usage_event_id,
          grant_id,
          grant_scope_id,
          points_charged,
          created_at
        )
        SELECT
          usage_insert.id,
          funding_charge.grant_id,
          funding_charge.grant_scope_id,
          funding_charge.points_charged,
          ${input.at}
        FROM usage_insert
        INNER JOIN funding_charge ON funding_charge.points_charged > 0
        ON CONFLICT (usage_event_id, grant_id, grant_scope_id) DO NOTHING
        RETURNING id
      )
      SELECT
        transitioned.id::text AS id,
        transitioned.token,
        transitioned.charged_user_id::text AS charged_user_id,
        transitioned.actor_user_id::text AS actor_user_id,
        transitioned.source_id::text AS source_id,
        transitioned.points_reserved,
        transitioned.points_committed,
        transitioned.platform_subsidized_points,
        transitioned.status,
        transitioned.expires_at
      FROM transitioned
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? snapshot(row) : null;
  }

  async releaseReservationAtomic(
    token: string,
    at: Date,
  ): Promise<WorklogAiPointReservationSnapshot | null> {
    const result = await this.db.execute(sql`
      WITH transitioned AS (
        UPDATE worklog_ai_point_reservations
        SET status = 'RELEASED', updated_at = ${at}
        WHERE token = ${token}
          AND status = 'RESERVED'
        RETURNING *
      ), released AS MATERIALIZED (
        SELECT
          funding.grant_id,
          funding.grant_scope_id,
          SUM(funding.points_reserved)::int AS points_reserved
        FROM worklog_ai_point_reservation_funding funding
        INNER JOIN transitioned ON transitioned.id = funding.reservation_id
        GROUP BY funding.grant_id, funding.grant_scope_id
      ), grant_release AS (
        UPDATE worklog_ai_grants grant
        SET remaining_points = grant.remaining_points + released.points_reserved,
            status = CASE
              WHEN grant.status = 'EXHAUSTED' THEN 'ACTIVE'::worklog_ai_grant_status
              ELSE grant.status
            END,
            updated_at = ${at}
        FROM released
        WHERE grant.id = released.grant_id
        RETURNING grant.id
      ), scope_release AS (
        UPDATE worklog_ai_grant_scopes scope
        SET reserved_points = GREATEST(0, scope.reserved_points - released.points_reserved),
            updated_at = ${at}
        FROM released
        WHERE scope.id = released.grant_scope_id
        RETURNING scope.id
      )
      SELECT
        transitioned.id::text AS id,
        transitioned.token,
        transitioned.charged_user_id::text AS charged_user_id,
        transitioned.actor_user_id::text AS actor_user_id,
        transitioned.source_id::text AS source_id,
        transitioned.points_reserved,
        transitioned.points_committed,
        transitioned.platform_subsidized_points,
        transitioned.status,
        transitioned.expires_at
      FROM transitioned
    `);
    const row = result.rows[0] as ReservationRow | undefined;
    return row ? snapshot(row) : null;
  }
}

function snapshot(row: ReservationRow): WorklogAiPointReservationSnapshot {
  const status = reservationStatus(row.status);
  return {
    id: positiveInteger(row.id, 'reservation id'),
    token: requiredText(row.token, 'reservation token'),
    chargedUserId: positiveInteger(row.charged_user_id, 'charged user id'),
    actorUserId: positiveInteger(row.actor_user_id, 'actor user id'),
    sourceId: positiveInteger(row.source_id, 'source id'),
    pointsReserved: nonNegativeInteger(row.points_reserved, 'points reserved'),
    pointsCommitted: nonNegativeInteger(row.points_committed, 'points committed'),
    platformSubsidizedPoints: nonNegativeInteger(row.platform_subsidized_points, 'platform subsidized points'),
    status,
    expiresAt: dateValue(row.expires_at, 'expires at'),
  };
}

function normalizeUsage(value: WorklogAiUsageCommit) {
  return {
    workspaceId: value.workspaceId == null ? null : positiveInteger(value.workspaceId, 'workspace id'),
    recordId: value.recordId == null ? null : positiveInteger(value.recordId, 'record id'),
    provider: requiredText(value.provider, 'provider'),
    model: requiredText(value.model, 'model'),
    inputTokens: nonNegativeInteger(value.inputTokens, 'input tokens'),
    outputTokens: nonNegativeInteger(value.outputTokens, 'output tokens'),
    audioInputUnits: nonNegativeInteger(value.audioInputUnits ?? 0, 'audio input units'),
    imageInputUnits: nonNegativeInteger(value.imageInputUnits ?? 0, 'image input units'),
    inputUsdPerMillion: nonNegativeFinite(value.inputUsdPerMillion, 'input USD per million'),
    outputUsdPerMillion: positiveFinite(value.outputUsdPerMillion, 'output USD per million'),
    audioUsdPerMillion: optionalNonNegativeFinite(value.audioUsdPerMillion, 'audio USD per million'),
    imageUsdPerMillion: optionalNonNegativeFinite(value.imageUsdPerMillion, 'image USD per million'),
    usdTwdRate: optionalNonNegativeFinite(value.usdTwdRate, 'USD/TWD rate'),
    providerCostUsd: nonNegativeFinite(value.providerCostUsd, 'provider cost USD'),
    providerCostTwd: optionalNonNegativeFinite(value.providerCostTwd, 'provider cost TWD'),
  };
}

function operationOf(value: WorklogAiUsageCommit): string {
  const operation = (value as WorklogAiUsageCommit & { operation?: unknown }).operation;
  if (operation === undefined || operation === null) return 'UNKNOWN';
  if (typeof operation !== 'string') throw new Error('invalid AI operation');
  const normalized = operation.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  if (!normalized) return 'UNKNOWN';
  return normalized.slice(0, 64);
}

function reservationStatus(value: string): WorklogAiPointReservationSnapshot['status'] {
  if (value !== 'RESERVED' && value !== 'COMMITTED' && value !== 'RELEASED' && value !== 'EXPIRED') {
    throw new Error('invalid AI point reservation status');
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function nonNegativeFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function positiveFinite(value: unknown, label: string): number {
  const parsed = numeric(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}`);
  return parsed;
}

function optionalNonNegativeFinite(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : nonNegativeFinite(value, label);
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function dateValue(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid ${label}`);
  return parsed;
}
