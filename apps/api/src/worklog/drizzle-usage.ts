import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  SourceAiFundingSnapshot,
  SourceAiPointBalance,
  SourceAiUsageAggregate,
  WorklogUsageRepository,
} from './usage';

export class DrizzleWorklogUsageRepository implements WorklogUsageRepository {
  constructor(private readonly db: Database) {}

  async getPrivateSourceId(userId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT id::text AS id
      FROM worklog_sources
      WHERE type = 'PRIVATE'
        AND status = 'ACTIVE'
        AND private_user_id = ${userId}
      LIMIT 1
    `);
    return positiveIntegerOrNull((result.rows[0] as { id?: string } | undefined)?.id ?? null);
  }

  async getGroupAiFunding(sourceId: number): Promise<SourceAiFundingSnapshot> {
    const result = await this.db.execute(sql`
      SELECT
        responsibility.responsible_user_id::text AS responsible_user_id,
        profile.display_name AS responsible_display_name
      FROM worklog_sources source
      LEFT JOIN worklog_source_ai_responsibility responsibility
        ON responsibility.source_id = source.id
      LEFT JOIN worklog_users profile
        ON profile.id = responsibility.responsible_user_id
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
        AND source.status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as {
      responsible_user_id?: string | null;
      responsible_display_name?: string | null;
    } | undefined;
    const responsibleUserId = positiveIntegerOrNull(row?.responsible_user_id ?? null);
    return {
      responsibleUserId,
      responsibleDisplayName: responsibleUserId ? row?.responsible_display_name ?? null : null,
    };
  }

  async getSourcePointBalance(input: {
    ownerUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<SourceAiPointBalance> {
    const result = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(
          LEAST(
            g.remaining_points,
            CASE
              WHEN scope.cap_points IS NULL THEN g.remaining_points
              ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
            END
          )
        ), 0)::bigint AS available_points,
        COALESCE(SUM(scope.reserved_points), 0)::bigint AS reserved_points
      FROM worklog_ai_grants g
      INNER JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = g.id
       AND scope.source_id = ${input.sourceId}
       AND scope.enabled = TRUE
      WHERE g.owner_user_id = ${input.ownerUserId}
        AND g.status = 'ACTIVE'
        AND g.effective_at <= ${input.at}
        AND (g.expires_at IS NULL OR g.expires_at > ${input.at})
    `);
    const row = result.rows[0] as {
      available_points?: number | string | null;
      reserved_points?: number | string | null;
    } | undefined;
    return {
      availablePoints: nonNegativeInteger(row?.available_points),
      reservedPoints: nonNegativeInteger(row?.reserved_points),
    };
  }

  async sumSourceAiUsage(sourceId: number): Promise<SourceAiUsageAggregate> {
    const result = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(customer_points_charged), 0)::bigint AS customer_points_charged,
        COALESCE(SUM(platform_subsidized_points), 0)::bigint AS platform_subsidized_points
      FROM worklog_ai_usage_events
      WHERE source_id = ${sourceId}
    `);
    const row = result.rows[0] as {
      customer_points_charged?: number | string | null;
      platform_subsidized_points?: number | string | null;
    } | undefined;
    return {
      customerPointsCharged: nonNegativeInteger(row?.customer_points_charged),
      platformSubsidizedPoints: nonNegativeInteger(row?.platform_subsidized_points),
    };
  }
}

function positiveIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}
