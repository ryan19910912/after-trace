import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';

export type WorklogFundingRouteBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type Env = {
  Bindings: WorklogFundingRouteBindings;
  Variables: { lineUserId: string };
};

type UserContext = { userId: number; database: Database };

/**
 * Customer funding views are Source-scoped and backed only by user-owned Grants.
 *
 * PRIVATE exposes only the authenticated user's own Grant inventory as applied to the
 * personal Source. GROUP exposes group-scoped availability/history to active members;
 * only the current AI 額度負責人 may see/manage their Grant allocations for that GROUP.
 * No endpoint exposes another user's unrelated PRIVATE/other-GROUP balances.
 */
export function createWorklogFundingRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowedOrigin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifyWebSessionToken(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    c.set('lineUserId', session.lineUserId);
    await next();
  });

  app.get('/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const sourceId = await personalSourceId(context.database, context.userId);
    if (!sourceId) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    return c.json({ ok: true, funding: await personalFundingView(context.database, context.userId, sourceId) });
  });

  app.get('/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if (!(await activeGroupMember(context.database, context.userId, sourceId))) {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    return c.json({ ok: true, funding: await fundingView(context.database, context.userId, sourceId) });
  });

  app.put('/group/:sourceId/grants/:grantId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    const grantId = positiveId(c.req.param('grantId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    if (!grantId) return c.json({ ok: false, error: 'INVALID_GRANT_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if (!(await activeGroupMember(context.database, context.userId, sourceId))) {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }

    const responsibleUserId = await groupResponsibleUserId(context.database, sourceId);
    if (responsibleUserId === null) {
      return c.json({ ok: false, error: 'AI_RESPONSIBLE_USER_UNBOUND' }, 409);
    }
    if (responsibleUserId !== context.userId) {
      return c.json({ ok: false, error: 'AI_FUNDING_MANAGEMENT_FORBIDDEN' }, 403);
    }

    const body = await objectBody(c);
    if (!body || typeof body.enabled !== 'boolean') {
      return c.json({ ok: false, error: 'ENABLED_BOOLEAN_REQUIRED' }, 400);
    }
    const capPoints = capValue(body.capPoints);
    if (capPoints === 'INVALID') return c.json({ ok: false, error: 'INVALID_CAP_POINTS' }, 400);

    const result = await configureGrantScope(context.database, {
      ownerUserId: context.userId,
      sourceId,
      grantId,
      enabled: body.enabled,
      capPoints,
    });
    if (result === 'GRANT_NOT_FOUND') return c.json({ ok: false, error: result }, 404);
    if (result === 'ACTIVE_RESERVATION') return c.json({ ok: false, error: result }, 409);
    if (result === 'CAP_BELOW_USAGE') return c.json({ ok: false, error: result }, 409);

    return c.json({ ok: true, funding: await fundingView(context.database, context.userId, sourceId) });
  });

  return app;
}

async function personalFundingView(database: Database, userId: number, sourceId: number) {
  const [balances, usage, grants] = await Promise.all([
    database.execute(sql`
      SELECT
        COALESCE(SUM(
          LEAST(
            grant.remaining_points,
            CASE
              WHEN scope.cap_points IS NULL THEN grant.remaining_points
              ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
            END
          )
        ), 0)::bigint AS available_points,
        COALESCE(SUM(scope.reserved_points), 0)::bigint AS reserved_points
      FROM worklog_ai_grants grant
      INNER JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = grant.id
       AND scope.source_id = ${sourceId}
       AND scope.enabled = TRUE
      WHERE grant.owner_user_id = ${userId}
        AND grant.status = 'ACTIVE'
        AND grant.effective_at <= NOW()
        AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
    `),
    database.execute(sql`
      SELECT
        COALESCE(SUM(customer_points_charged), 0)::bigint AS used_points,
        COALESCE(SUM(platform_subsidized_points), 0)::bigint AS platform_subsidized_points
      FROM worklog_ai_usage_events
      WHERE source_id = ${sourceId}
    `),
    database.execute(sql`
      SELECT
        grant.id::text AS id,
        grant.type,
        grant.status,
        grant.original_points,
        grant.remaining_points,
        grant.effective_at,
        grant.expires_at,
        scope.cap_points,
        COALESCE(scope.used_points, 0) AS scope_used_points,
        COALESCE(scope.reserved_points, 0) AS scope_reserved_points,
        COALESCE(scope.enabled, FALSE) AS scope_enabled,
        CASE
          WHEN scope.id IS NULL OR scope.enabled = FALSE THEN 0
          ELSE LEAST(
            grant.remaining_points,
            CASE
              WHEN scope.cap_points IS NULL THEN grant.remaining_points
              ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
            END
          )
        END AS source_available_points
      FROM worklog_ai_grants grant
      LEFT JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = grant.id
       AND scope.source_id = ${sourceId}
      WHERE grant.owner_user_id = ${userId}
        AND grant.status <> 'REVOKED'
      ORDER BY grant.expires_at ASC NULLS LAST, grant.effective_at ASC, grant.id ASC
    `),
  ]);
  const balanceRow = balances.rows[0] as {
    available_points?: number | string | null;
    reserved_points?: number | string | null;
  } | undefined;
  const usageRow = usage.rows[0] as {
    used_points?: number | string | null;
    platform_subsidized_points?: number | string | null;
  } | undefined;
  return {
    sourceId,
    userId,
    availablePoints: nonNegativeInteger(balanceRow?.available_points),
    reservedPoints: nonNegativeInteger(balanceRow?.reserved_points),
    usedPoints: nonNegativeInteger(usageRow?.used_points),
    platformSubsidizedPoints: nonNegativeInteger(usageRow?.platform_subsidized_points),
    grants: grants.rows,
  };
}

async function fundingView(database: Database, viewerUserId: number, sourceId: number) {
  const responsibility = await database.execute(sql`
    SELECT responsibility.responsible_user_id::text AS responsible_user_id,
           profile.display_name AS responsible_display_name,
           COALESCE(member.is_active, FALSE) AS responsible_is_active
    FROM worklog_sources source
    LEFT JOIN worklog_source_ai_responsibility responsibility
      ON responsibility.source_id = source.id
    LEFT JOIN worklog_users profile
      ON profile.id = responsibility.responsible_user_id
    LEFT JOIN worklog_source_members member
      ON member.source_id = source.id
     AND member.user_id = responsibility.responsible_user_id
    WHERE source.id = ${sourceId}
      AND source.type = 'GROUP'
      AND source.status = 'ACTIVE'
    LIMIT 1
  `);
  const row = responsibility.rows[0] as {
    responsible_user_id?: string | null;
    responsible_display_name?: string | null;
    responsible_is_active?: boolean;
  } | undefined;
  const responsibleUserId = positiveNumber(row?.responsible_user_id ?? null);

  const usage = await database.execute(sql`
    SELECT
      COALESCE(SUM(customer_points_charged), 0)::bigint AS used_points,
      COALESCE(SUM(platform_subsidized_points), 0)::bigint AS platform_subsidized_points
    FROM worklog_ai_usage_events
    WHERE source_id = ${sourceId}
  `);
  const usageRow = usage.rows[0] as {
    used_points?: number | string | null;
    platform_subsidized_points?: number | string | null;
  } | undefined;

  if (responsibleUserId === null) {
    return {
      sourceId,
      responsibleUser: null,
      responsibleUserActive: false,
      availablePoints: 0,
      reservedPoints: 0,
      usedPoints: nonNegativeInteger(usageRow?.used_points),
      platformSubsidizedPoints: nonNegativeInteger(usageRow?.platform_subsidized_points),
      canManage: false,
      grants: [],
    };
  }

  const balances = await database.execute(sql`
    SELECT
      COALESCE(SUM(
        LEAST(
          grant.remaining_points,
          CASE
            WHEN scope.cap_points IS NULL THEN grant.remaining_points
            ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
          END
        )
      ), 0)::bigint AS available_points,
      COALESCE(SUM(scope.reserved_points), 0)::bigint AS reserved_points
    FROM worklog_ai_grants grant
    INNER JOIN worklog_ai_grant_scopes scope
      ON scope.grant_id = grant.id
     AND scope.source_id = ${sourceId}
     AND scope.enabled = TRUE
    WHERE grant.owner_user_id = ${responsibleUserId}
      AND grant.status = 'ACTIVE'
      AND grant.effective_at <= NOW()
      AND (grant.expires_at IS NULL OR grant.expires_at > NOW())
  `);
  const balanceRow = balances.rows[0] as {
    available_points?: number | string | null;
    reserved_points?: number | string | null;
  } | undefined;

  const canManage = responsibleUserId === viewerUserId;
  let grants: unknown[] = [];
  if (canManage) {
    const result = await database.execute(sql`
      SELECT
        grant.id::text AS id,
        grant.type,
        grant.status,
        grant.original_points,
        grant.remaining_points,
        grant.effective_at,
        grant.expires_at,
        scope.cap_points,
        COALESCE(scope.used_points, 0) AS scope_used_points,
        COALESCE(scope.reserved_points, 0) AS scope_reserved_points,
        COALESCE(scope.enabled, FALSE) AS scope_enabled,
        CASE
          WHEN scope.id IS NULL OR scope.enabled = FALSE THEN 0
          ELSE LEAST(
            grant.remaining_points,
            CASE
              WHEN scope.cap_points IS NULL THEN grant.remaining_points
              ELSE GREATEST(0, scope.cap_points - scope.used_points - scope.reserved_points)
            END
          )
        END AS source_available_points
      FROM worklog_ai_grants grant
      LEFT JOIN worklog_ai_grant_scopes scope
        ON scope.grant_id = grant.id
       AND scope.source_id = ${sourceId}
      WHERE grant.owner_user_id = ${viewerUserId}
        AND grant.status <> 'REVOKED'
      ORDER BY grant.expires_at ASC NULLS LAST, grant.effective_at ASC, grant.id ASC
    `);
    grants = result.rows;
  }

  return {
    sourceId,
    responsibleUser: {
      id: responsibleUserId,
      displayName: row?.responsible_display_name ?? null,
    },
    responsibleUserActive: Boolean(row?.responsible_is_active),
    availablePoints: nonNegativeInteger(balanceRow?.available_points),
    reservedPoints: nonNegativeInteger(balanceRow?.reserved_points),
    usedPoints: nonNegativeInteger(usageRow?.used_points),
    platformSubsidizedPoints: nonNegativeInteger(usageRow?.platform_subsidized_points),
    canManage,
    grants,
  };
}

async function configureGrantScope(
  database: Database,
  input: {
    ownerUserId: number;
    sourceId: number;
    grantId: number;
    enabled: boolean;
    capPoints: number | null;
  },
): Promise<'UPDATED' | 'GRANT_NOT_FOUND' | 'ACTIVE_RESERVATION' | 'CAP_BELOW_USAGE'> {
  const result = await database.execute(sql`
    WITH owned_grant AS (
      SELECT id
      FROM worklog_ai_grants
      WHERE id = ${input.grantId}
        AND owner_user_id = ${input.ownerUserId}
        AND status <> 'REVOKED'
      FOR UPDATE
    ), current_scope AS (
      SELECT scope.used_points, scope.reserved_points
      FROM worklog_ai_grant_scopes scope
      INNER JOIN owned_grant grant ON grant.id = scope.grant_id
      WHERE scope.source_id = ${input.sourceId}
      FOR UPDATE
    ), state AS (
      SELECT
        EXISTS (SELECT 1 FROM owned_grant) AS grant_exists,
        COALESCE((SELECT used_points FROM current_scope), 0)::integer AS used_points,
        COALESCE((SELECT reserved_points FROM current_scope), 0)::integer AS reserved_points
    ), upserted AS (
      INSERT INTO worklog_ai_grant_scopes (
        grant_id, source_id, cap_points, used_points, reserved_points, enabled, created_at, updated_at
      )
      SELECT
        ${input.grantId}, ${input.sourceId}, ${input.capPoints},
        state.used_points, state.reserved_points, ${input.enabled}, NOW(), NOW()
      FROM state
      WHERE state.grant_exists = TRUE
        AND NOT (${input.enabled} = FALSE AND state.reserved_points > 0)
        AND (${input.capPoints}::integer IS NULL OR ${input.capPoints} >= state.used_points + state.reserved_points)
      ON CONFLICT (grant_id, source_id)
      DO UPDATE SET
        cap_points = EXCLUDED.cap_points,
        enabled = EXCLUDED.enabled,
        updated_at = NOW()
      RETURNING id
    )
    SELECT state.grant_exists,
           state.used_points,
           state.reserved_points,
           EXISTS (SELECT 1 FROM upserted) AS updated
    FROM state
  `);
  const row = result.rows[0] as {
    grant_exists?: boolean;
    used_points?: number | string;
    reserved_points?: number | string;
    updated?: boolean;
  } | undefined;
  if (!row?.grant_exists) return 'GRANT_NOT_FOUND';
  if (row.updated) return 'UPDATED';
  if (!input.enabled && nonNegativeInteger(row.reserved_points) > 0) return 'ACTIVE_RESERVATION';
  return 'CAP_BELOW_USAGE';
}

async function contextFor(databaseUrl: string, lineUserId: string): Promise<UserContext | null> {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`
    SELECT id::text AS id FROM worklog_users WHERE line_user_id = ${lineUserId} LIMIT 1
  `);
  const userId = positiveNumber((result.rows[0] as { id?: string } | undefined)?.id ?? null);
  return userId ? { userId, database } : null;
}

async function personalSourceId(database: Database, userId: number): Promise<number | null> {
  const result = await database.execute(sql`
    SELECT id::text AS id
    FROM worklog_sources
    WHERE type = 'PRIVATE'
      AND status = 'ACTIVE'
      AND private_user_id = ${userId}
    LIMIT 1
  `);
  return positiveNumber((result.rows[0] as { id?: string } | undefined)?.id ?? null);
}

async function activeGroupMember(database: Database, userId: number, sourceId: number): Promise<boolean> {
  const result = await database.execute(sql`
    SELECT 1
    FROM worklog_sources source
    INNER JOIN worklog_source_members member
      ON member.source_id = source.id
     AND member.user_id = ${userId}
     AND member.is_active = TRUE
    WHERE source.id = ${sourceId}
      AND source.type = 'GROUP'
      AND source.status = 'ACTIVE'
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function groupResponsibleUserId(database: Database, sourceId: number): Promise<number | null> {
  const result = await database.execute(sql`
    SELECT responsible_user_id::text AS responsible_user_id
    FROM worklog_source_ai_responsibility
    WHERE source_id = ${sourceId}
    LIMIT 1
  `);
  return positiveNumber((result.rows[0] as { responsible_user_id?: string } | undefined)?.responsible_user_id ?? null);
}

function authSecret(env: WorklogFundingRouteBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const value = match[1]?.trim() ?? '';
  return value && value.length <= 8192 ? value : null;
}

function positiveId(value: string): number | null {
  return positiveNumber(value);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function capValue(value: unknown): number | null | 'INVALID' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 'INVALID';
  return value;
}

async function objectBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
