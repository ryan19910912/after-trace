import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type {
  WorklogAiEligibleBalance,
  WorklogAiGrantRepository,
  WorklogAiGrantSnapshot,
  WorklogAiGrantType,
} from './ai-grants';

type GrantRow = {
  id: string | number;
  owner_user_id: string | number;
  type: string;
  status: string;
  original_points: string | number;
  remaining_points: string | number;
  effective_at: Date | string;
  expires_at: Date | string | null;
  origin_key: string;
};

export class DrizzleWorklogAiGrantRepository implements WorklogAiGrantRepository {
  constructor(private readonly db: Database) {}

  async ensureGrant(input: {
    ownerUserId: number;
    type: WorklogAiGrantType;
    originalPoints: number;
    effectiveAt: Date;
    expiresAt: Date | null;
    originKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<WorklogAiGrantSnapshot> {
    const metadata = JSON.stringify(input.metadata ?? {});
    const result = await this.db.execute(sql`
      INSERT INTO worklog_ai_grants (
        owner_user_id,
        type,
        status,
        original_points,
        remaining_points,
        effective_at,
        expires_at,
        origin_key,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        ${input.ownerUserId},
        ${input.type},
        'ACTIVE',
        ${input.originalPoints},
        ${input.originalPoints},
        ${input.effectiveAt},
        ${input.expiresAt},
        ${input.originKey},
        ${metadata}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (owner_user_id, origin_key)
      DO UPDATE SET updated_at = worklog_ai_grants.updated_at
      RETURNING
        id::text AS id,
        owner_user_id::text AS owner_user_id,
        type,
        status,
        original_points,
        remaining_points,
        effective_at,
        expires_at,
        origin_key
    `);
    const row = result.rows[0] as GrantRow | undefined;
    if (!row) throw new Error('AI grant provisioning returned no row');
    return grantSnapshot(row);
  }

  async ensureScope(input: {
    grantId: number;
    sourceId: number;
    capPoints: number | null;
    at: Date;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO worklog_ai_grant_scopes (
        grant_id,
        source_id,
        cap_points,
        used_points,
        enabled,
        created_at,
        updated_at
      )
      VALUES (
        ${input.grantId},
        ${input.sourceId},
        ${input.capPoints},
        0,
        TRUE,
        ${input.at},
        ${input.at}
      )
      ON CONFLICT (grant_id, source_id)
      DO UPDATE SET updated_at = worklog_ai_grant_scopes.updated_at
    `);
  }

  async eligibleBalance(input: {
    ownerUserId: number;
    sourceId: number;
    at: Date;
  }): Promise<WorklogAiEligibleBalance> {
    const result = await this.db.execute(sql`
      SELECT
        grant.id::text AS grant_id,
        scope.id::text AS grant_scope_id,
        grant.remaining_points,
        CASE
          WHEN scope.cap_points IS NULL THEN grant.remaining_points
          ELSE GREATEST(0, scope.cap_points - scope.used_points)
        END AS scope_remaining_points,
        LEAST(
          grant.remaining_points,
          CASE
            WHEN scope.cap_points IS NULL THEN grant.remaining_points
            ELSE GREATEST(0, scope.cap_points - scope.used_points)
          END
        ) AS usable_points,
        grant.expires_at
      FROM worklog_ai_grants grant
      INNER JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = grant.id
       AND scope.source_id = ${input.sourceId}
       AND scope.enabled = TRUE
      WHERE grant.owner_user_id = ${input.ownerUserId}
        AND grant.status = 'ACTIVE'
        AND grant.remaining_points > 0
        AND grant.effective_at <= ${input.at}
        AND (grant.expires_at IS NULL OR grant.expires_at > ${input.at})
      ORDER BY grant.expires_at ASC NULLS LAST, grant.effective_at ASC, grant.id ASC
    `);

    const grants = result.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        grantId: positiveInteger(row.grant_id, 'grant id'),
        grantScopeId: positiveInteger(row.grant_scope_id, 'grant scope id'),
        remainingPoints: nonNegativeInteger(row.remaining_points, 'remaining points'),
        scopeRemainingPoints: nonNegativeInteger(row.scope_remaining_points, 'scope remaining points'),
        usablePoints: nonNegativeInteger(row.usable_points, 'usable points'),
        expiresAt: row.expires_at === null || row.expires_at === undefined
          ? null
          : dateValue(row.expires_at, 'expires at'),
      };
    });
    const totalRemainingPoints = grants.reduce((sum, grant) => safeAdd(sum, grant.usablePoints), 0);
    return {
      ownerUserId: input.ownerUserId,
      sourceId: input.sourceId,
      totalRemainingPoints,
      grants,
    };
  }
}

function grantSnapshot(row: GrantRow): WorklogAiGrantSnapshot {
  const type = grantType(row.type);
  const status = row.status;
  if (status !== 'ACTIVE' && status !== 'EXHAUSTED' && status !== 'REVOKED') {
    throw new Error('invalid AI grant status');
  }
  return {
    id: positiveInteger(row.id, 'grant id'),
    ownerUserId: positiveInteger(row.owner_user_id, 'owner user id'),
    type,
    status,
    originalPoints: nonNegativeInteger(row.original_points, 'original points'),
    remainingPoints: nonNegativeInteger(row.remaining_points, 'remaining points'),
    effectiveAt: dateValue(row.effective_at, 'effective at'),
    expiresAt: row.expires_at === null ? null : dateValue(row.expires_at, 'expires at'),
    originKey: requiredText(row.origin_key, 'origin key'),
  };
}

function grantType(value: string): WorklogAiGrantType {
  if (value !== 'FREE_INITIAL' && value !== 'SUBSCRIPTION_PERIOD' && value !== 'TOP_UP' && value !== 'ADMIN') {
    throw new Error('invalid AI grant type');
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

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
}

function dateValue(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid ${label}`);
  return parsed;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('AI point balance exceeds safe integer range');
  return value;
}
