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

  async getFreeInitialTrialPoints(): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT free_initial_ai_trial_points
      FROM worklog_commercial_config
      WHERE id = 1
      LIMIT 1
    `);
    const value = (result.rows[0] as { free_initial_ai_trial_points?: unknown } | undefined)?.free_initial_ai_trial_points;
    // A fresh environment may already have the commercial-config row while the
    // FREE AI trial amount is still NULL. Treat that the same as "not configured"
    // so post-login onboarding can continue and report CONFIG_PENDING instead of
    // failing the OAuth callback with an unhandled 500.
    if (value === undefined || value === null) return null;
    return nonNegativeInteger(value, 'FREE initial AI trial points');
  }

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
        reserved_points,
        enabled,
        created_at,
        updated_at
      )
      VALUES (
        ${input.grantId},
        ${input.sourceId},
        ${input.capPoints},
        0,
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
        g.id::text AS grant_id,
        scope.id::text AS grant_scope_id,
        g.remaining_points,
        CASE
          WHEN scope.cap_points IS NULL THEN g.remaining_points
          ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
        END AS scope_remaining_points,
        LEAST(
          g.remaining_points,
          CASE
            WHEN scope.cap_points IS NULL THEN g.remaining_points
            ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
          END
        ) AS usable_points,
        g.expires_at
      FROM worklog_ai_grants g
      INNER JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = g.id
       AND scope.source_id = ${input.sourceId}
       AND scope.enabled = TRUE
      WHERE g.owner_user_id = ${input.ownerUserId}
        AND g.status = 'ACTIVE'
        AND g.remaining_points > 0
        AND g.effective_at <= ${input.at}
        AND (g.expires_at IS NULL OR g.expires_at > ${input.at})
      ORDER BY g.expires_at ASC NULLS LAST, g.effective_at ASC, g.id ASC
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
    const totalRemainingPoints = grants.reduce((sum, g) => safeAdd(sum, g.usablePoints), 0);
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
  if (value !== 'FREE_INITIAL' && value !== 'SUBSCRIPTION_PERIOD' && value !== 'ADMIN') {
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
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
}

function dateValue(value: Date | string, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid ${label}`);
  return parsed;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${label}`);
  return value.trim();
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('AI grant point total overflow');
  return result;
}
