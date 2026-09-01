import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  emptyRecordTypeCounts,
  type ActiveUsageWindow,
  type AiUsageAggregate,
  type GroupMemberUsage,
  type RecordTypeCounts,
  type WorklogUsageRepository,
} from './usage';

type AiAggregateRow = {
  ai_units: number | string | null;
  provider_cost_usd: number | string | null;
  provider_cost_twd: number | string | null;
};

type RecordCountRow = {
  text_count: number | string | null;
  audio_count: number | string | null;
  image_count: number | string | null;
  file_count: number | string | null;
};

type MemberUsageRow = RecordCountRow & AiAggregateRow & {
  user_id: string;
  display_name: string | null;
  recording_enabled: boolean;
  last_interaction_at: Date | string | null;
  updated_at: Date | string;
};

const EARLIEST_USAGE = new Date('1970-01-01T00:00:00.000Z');
const LATEST_USAGE = new Date('9999-12-31T23:59:59.999Z');

export class DrizzleWorklogUsageRepository implements WorklogUsageRepository {
  constructor(private readonly db: Database) {}

  async getActiveUsageWindow(userId: number): Promise<ActiveUsageWindow | null> {
    const result = await this.db.execute(sql`
      SELECT
        subscription.plan_code,
        COALESCE(balance.allowance_units, plan.ai_allowance_units, 0) AS allowance_units,
        COALESCE(balance.reserved_units, 0) AS reserved_units,
        subscription.current_period_start,
        subscription.current_period_end
      FROM worklog_user_subscriptions AS subscription
      LEFT JOIN worklog_subscription_plans AS plan ON plan.code = subscription.plan_code
      LEFT JOIN worklog_ai_quota_balances AS balance
        ON balance.user_id = subscription.user_id
       AND balance.period_start = subscription.current_period_start
      WHERE subscription.user_id = ${userId}
        AND subscription.status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as {
      plan_code?: string;
      allowance_units?: number | string | null;
      reserved_units?: number | string | null;
      current_period_start?: Date | string | null;
      current_period_end?: Date | string | null;
    } | undefined;
    if (!row?.plan_code) return null;
    return {
      planCode: row.plan_code,
      allowanceUnits: numeric(row.allowance_units ?? 0),
      reservedUnits: numeric(row.reserved_units ?? 0),
      periodStart: nullableDate(row.current_period_start ?? null),
      periodEnd: nullableDate(row.current_period_end ?? null),
    };
  }

  async sumChargedAiUsage(
    chargedUserId: number,
    periodStart: Date | null,
    periodEnd: Date | null,
    sourceId?: number,
  ): Promise<AiUsageAggregate> {
    const start = periodStart ?? EARLIEST_USAGE;
    const end = periodEnd ?? LATEST_USAGE;
    const result = sourceId === undefined
      ? await this.db.execute(sql`
          SELECT
            COALESCE(SUM(ai_units_consumed), 0)::bigint AS ai_units,
            COALESCE(SUM(provider_cost_usd), 0) AS provider_cost_usd,
            COALESCE(SUM(provider_cost_twd), 0) AS provider_cost_twd
          FROM worklog_ai_usage_events
          WHERE charged_user_id = ${chargedUserId}
            AND created_at >= ${start}
            AND created_at < ${end}
        `)
      : await this.db.execute(sql`
          SELECT
            COALESCE(SUM(ai_units_consumed), 0)::bigint AS ai_units,
            COALESCE(SUM(provider_cost_usd), 0) AS provider_cost_usd,
            COALESCE(SUM(provider_cost_twd), 0) AS provider_cost_twd
          FROM worklog_ai_usage_events
          WHERE charged_user_id = ${chargedUserId}
            AND source_id = ${sourceId}
            AND created_at >= ${start}
            AND created_at < ${end}
        `);
    return aiAggregate(result.rows[0] as AiAggregateRow | undefined);
  }

  async countRecordsByAuthor(userId: number, sourceId?: number): Promise<RecordTypeCounts> {
    const result = sourceId === undefined
      ? await this.db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE input_type = 'TEXT')::bigint AS text_count,
            COUNT(*) FILTER (WHERE input_type = 'AUDIO')::bigint AS audio_count,
            COUNT(*) FILTER (WHERE input_type = 'IMAGE')::bigint AS image_count,
            COUNT(*) FILTER (WHERE input_type = 'FILE')::bigint AS file_count
          FROM worklog_records
          WHERE author_user_id = ${userId}
        `)
      : await this.db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE input_type = 'TEXT')::bigint AS text_count,
            COUNT(*) FILTER (WHERE input_type = 'AUDIO')::bigint AS audio_count,
            COUNT(*) FILTER (WHERE input_type = 'IMAGE')::bigint AS image_count,
            COUNT(*) FILTER (WHERE input_type = 'FILE')::bigint AS file_count
          FROM worklog_records
          WHERE author_user_id = ${userId}
            AND source_id = ${sourceId}
        `);
    return recordCounts(result.rows[0] as RecordCountRow | undefined);
  }

  async getGroupOwnerUserId(sourceId: number): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT owner_user_id::text AS owner_user_id
      FROM worklog_sources
      WHERE id = ${sourceId}
        AND type = 'GROUP'
        AND status = 'ACTIVE'
      LIMIT 1
    `);
    const value = (result.rows[0] as { owner_user_id?: string | null } | undefined)?.owner_user_id;
    return value ? Number(value) : null;
  }

  async listGroupMemberUsage(
    sourceId: number,
    periodStart: Date | null,
    periodEnd: Date | null,
  ): Promise<GroupMemberUsage[]> {
    const start = periodStart ?? EARLIEST_USAGE;
    const end = periodEnd ?? LATEST_USAGE;
    const result = await this.db.execute(sql`
      WITH record_usage AS (
        SELECT
          author_user_id,
          COUNT(*) FILTER (WHERE input_type = 'TEXT')::bigint AS text_count,
          COUNT(*) FILTER (WHERE input_type = 'AUDIO')::bigint AS audio_count,
          COUNT(*) FILTER (WHERE input_type = 'IMAGE')::bigint AS image_count,
          COUNT(*) FILTER (WHERE input_type = 'FILE')::bigint AS file_count
        FROM worklog_records
        WHERE source_id = ${sourceId}
          AND author_user_id IS NOT NULL
        GROUP BY author_user_id
      ),
      ai_usage AS (
        SELECT
          actor_user_id,
          COALESCE(SUM(ai_units_consumed), 0)::bigint AS ai_units,
          COALESCE(SUM(provider_cost_usd), 0) AS provider_cost_usd,
          COALESCE(SUM(provider_cost_twd), 0) AS provider_cost_twd
        FROM worklog_ai_usage_events
        WHERE source_id = ${sourceId}
          AND created_at >= ${start}
          AND created_at < ${end}
        GROUP BY actor_user_id
      )
      SELECT
        member.user_id::text AS user_id,
        profile.display_name,
        member.recording_enabled,
        COALESCE(ai.ai_units, 0) AS ai_units,
        COALESCE(ai.provider_cost_usd, 0) AS provider_cost_usd,
        COALESCE(ai.provider_cost_twd, 0) AS provider_cost_twd,
        COALESCE(records.text_count, 0) AS text_count,
        COALESCE(records.audio_count, 0) AS audio_count,
        COALESCE(records.image_count, 0) AS image_count,
        COALESCE(records.file_count, 0) AS file_count,
        profile.last_interaction_at,
        GREATEST(member.updated_at, profile.updated_at) AS updated_at
      FROM worklog_source_members AS member
      INNER JOIN worklog_users AS profile ON profile.id = member.user_id
      LEFT JOIN record_usage AS records ON records.author_user_id = member.user_id
      LEFT JOIN ai_usage AS ai ON ai.actor_user_id = member.user_id
      WHERE member.source_id = ${sourceId}
        AND member.is_active = TRUE
      ORDER BY profile.display_name ASC NULLS LAST, member.user_id ASC
    `);

    return (result.rows as MemberUsageRow[]).map((row) => ({
      userId: Number(row.user_id),
      displayName: row.display_name,
      recordingEnabled: row.recording_enabled,
      aiUsedUnits: numeric(row.ai_units),
      providerCostUsd: numeric(row.provider_cost_usd),
      providerCostTwd: numeric(row.provider_cost_twd),
      records: recordCounts(row),
      lastInteractionAt: nullableIso(row.last_interaction_at),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
}

function aiAggregate(row: AiAggregateRow | undefined): AiUsageAggregate {
  return {
    aiUnits: numeric(row?.ai_units ?? 0),
    providerCostUsd: numeric(row?.provider_cost_usd ?? 0),
    providerCostTwd: numeric(row?.provider_cost_twd ?? 0),
  };
}

function recordCounts(row: RecordCountRow | undefined): RecordTypeCounts {
  if (!row) return emptyRecordTypeCounts();
  return {
    TEXT: numeric(row.text_count),
    AUDIO: numeric(row.audio_count),
    IMAGE: numeric(row.image_count),
    FILE: numeric(row.file_count),
  };
}

function numeric(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
