import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAiAllowanceStatus,
  WorklogGroupSystemState,
  WorklogLineSystemQueryRepository,
} from './line-system-query';

export class DrizzleWorklogLineSystemQueryRepository implements WorklogLineSystemQueryRepository {
  constructor(private readonly db: Database) {}

  async groupState(sourceId: number): Promise<WorklogGroupSystemState | null> {
    const result = await this.db.execute(sql`
      SELECT source.id::text AS source_id,
             responsibility.responsible_user_id::text AS responsible_user_id,
             user_row.display_name AS responsible_display_name,
             user_row.line_user_id AS responsible_line_user_id
      FROM worklog_sources source
      LEFT JOIN worklog_source_ai_responsibility responsibility ON responsibility.source_id = source.id
      LEFT JOIN worklog_users user_row ON user_row.id = responsibility.responsible_user_id
      WHERE source.id = ${sourceId}
        AND source.type = 'GROUP'
        AND source.status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as {
      source_id?: string;
      responsible_user_id?: string | null;
      responsible_display_name?: string | null;
      responsible_line_user_id?: string | null;
    } | undefined;
    if (!row?.source_id) return null;
    return {
      responsibleUserId: row.responsible_user_id ? Number(row.responsible_user_id) : null,
      responsibleDisplayName: row.responsible_display_name ?? null,
      responsibleLineUserId: row.responsible_line_user_id ?? null,
    };
  }

  async userDisplayName(userId: number): Promise<string | null> {
    const result = await this.db.execute(sql`
      SELECT display_name
      FROM worklog_users
      WHERE id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as { display_name?: string | null } | undefined;
    return row?.display_name?.trim() || null;
  }

  async allowance(ownerUserId: number, sourceId: number, _at: Date): Promise<WorklogAiAllowanceStatus> {
    // This is a current-status query. Use the database clock instead of binding a JS Date
    // through the Workers/Neon driver. Also avoid reserved SQL keywords as aliases.
    const result = await this.db.execute(sql`
      SELECT
        g.original_points,
        g.remaining_points,
        scope.cap_points,
        scope.used_points,
        scope.reserved_points
      FROM worklog_ai_grants g
      INNER JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = g.id
       AND scope.source_id = ${sourceId}
       AND scope.enabled = TRUE
      WHERE g.owner_user_id = ${ownerUserId}
        AND g.status IN ('ACTIVE', 'EXHAUSTED')
        AND g.effective_at <= NOW()
        AND (g.expires_at IS NULL OR g.expires_at > NOW())
      ORDER BY g.effective_at ASC, g.id ASC
    `);

    let totalPoints = 0;
    let remainingPoints = 0;
    for (const raw of result.rows) {
      const row = raw as Record<string, unknown>;
      const original = nonNegativeSafeInteger(row.original_points);
      const remaining = nonNegativeSafeInteger(row.remaining_points);
      const cap = nullableNonNegativeSafeInteger(row.cap_points);
      const used = nonNegativeSafeInteger(row.used_points);
      const reserved = nonNegativeSafeInteger(row.reserved_points);

      const scopedTotal = cap === null ? original : Math.min(original, cap);
      const scopeRemaining = cap === null ? remaining : Math.max(0, cap - used - reserved);
      const scopedRemaining = Math.min(remaining, scopeRemaining);

      totalPoints = safeAdd(totalPoints, scopedTotal);
      remainingPoints = safeAdd(remainingPoints, scopedRemaining);
    }

    return { totalPoints, remainingPoints };
  }
}

function nullableNonNegativeSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeSafeInteger(value);
}

function nonNegativeSafeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid AI allowance point value');
  return parsed;
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('AI allowance exceeds safe integer range');
  return value;
}
