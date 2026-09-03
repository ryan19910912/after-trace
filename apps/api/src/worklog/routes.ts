import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { WorklogCollaborationService } from './collaboration';
import { DrizzleWorklogCollaborationRepository } from './drizzle-collaboration';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { DrizzleWorklogUsageRepository } from './drizzle-usage';
import { WorklogRecordReadService, type WorklogPwaSurfaces } from './records';
import { WorklogUsageService } from './usage';

export type WorklogRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type WorklogEnv = {
  Bindings: WorklogRoutesBindings;
  Variables: { lineUserId: string };
};

type WorklogRouteContext = {
  userId: number;
  database: Database;
  records: WorklogRecordReadService;
  usage: WorklogUsageService;
  collaboration: WorklogCollaborationService;
};

type RecordFilter = {
  query: string | null;
  from: Date | null;
  to: Date | null;
  limit: number;
  offset: number;
};

/**
 * Authenticated customer PWA API.
 *
 * This route module deliberately exposes only the surviving general-purpose Worklog
 * surfaces. Legacy Customer/Project/Transaction and Owner/member-recording endpoints
 * were removed from the customer API because they are not part of the accepted MVP
 * domain. Manual create/edit/delete/title operations are added back against the new
 * single-title Record schema in the next core-record batch.
 */
export function createWorklogRoutes() {
  const app = new Hono<WorklogEnv>();

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
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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

  app.get('/surfaces', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    return c.json({ ok: true, userId: context.userId, surfaces: await entitledSurfaces(context) });
  });

  app.get('/records/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);

    const surfaces = await context.records.surfaces(context.userId);
    if (!surfaces.personal) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);

    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({
      ok: true,
      ...(await filteredRecords(context.database, surfaces.personal.sourceId, filter)),
    });
  });

  app.get('/records/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);

    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);

    const access = await context.collaboration.authorizeGroupAccess({
      sourceId,
      actorUserId: context.userId,
    });
    if (access.status === 'GROUP_NOT_FOUND') {
      return c.json({ ok: false, error: access.status }, 404);
    }
    if (access.status !== 'OK') {
      return c.json({ ok: false, error: access.status }, 403);
    }

    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, sourceId, filter)) });
  });

  // Transitional aggregate usage endpoint. Customer point/grant display will replace
  // this shape when the grant ledger lands; keeping it here avoids mixing that larger
  // accounting migration into the Record-domain cleanup.
  app.get('/usage/me', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    return context
      ? c.json({ ok: true, usage: await context.usage.userUsage(context.userId) })
      : c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
  });

  app.post('/feedback', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);

    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const text = requiredText(body.text, 5000);
    if (!text) return c.json({ ok: false, error: 'FEEDBACK_TEXT_REQUIRED' }, 400);
    const contextJson = safeFeedbackContext(body.context);

    const result = await context.database.execute(sql`
      INSERT INTO worklog_feedback (
        user_id,
        display_name_snapshot,
        channel,
        text,
        context,
        created_at
      )
      SELECT
        id,
        display_name,
        'PWA',
        ${text},
        ${JSON.stringify(contextJson)}::jsonb,
        NOW()
      FROM worklog_users
      WHERE id = ${context.userId}
      RETURNING id::text AS id, channel, created_at
    `);
    return c.json({ ok: true, feedback: result.rows[0] }, 201);
  });

  return app;
}

async function contextFor(
  databaseUrl: string,
  lineUserId: string,
): Promise<WorklogRouteContext | null> {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`
    SELECT id::text AS id
    FROM worklog_users
    WHERE line_user_id = ${lineUserId}
    LIMIT 1
  `);
  const raw = (result.rows[0] as { id?: string } | undefined)?.id;
  const userId = raw ? Number(raw) : 0;
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  const recordRepository = new DrizzleWorklogRecordReadRepository(database);
  return {
    userId,
    database,
    records: new WorklogRecordReadService(recordRepository),
    usage: new WorklogUsageService(new DrizzleWorklogUsageRepository(database)),
    collaboration: new WorklogCollaborationService(
      new DrizzleWorklogCollaborationRepository(database),
    ),
  };
}

async function entitledSurfaces(context: WorklogRouteContext): Promise<WorklogPwaSurfaces> {
  const surfaces = await context.records.surfaces(context.userId);
  const checked = await Promise.all(surfaces.groups.map(async (group) => ({
    group,
    access: await context.collaboration.authorizeGroupAccess({
      sourceId: group.sourceId,
      actorUserId: context.userId,
    }),
  })));
  return {
    personal: surfaces.personal,
    groups: checked
      .filter((item) => item.access.status === 'OK')
      .map((item) => item.group),
  };
}

/**
 * Transitional read against the legacy Record row.
 *
 * Query semantics are already narrowed to raw durable content + time only. The next
 * schema batch changes this to title/alias/raw-content fuzzy search and occurred_at,
 * and excludes soft-deleted rows.
 */
async function filteredRecords(database: Database, sourceId: number, filter: RecordFilter) {
  const result = await database.execute(sql`
    SELECT
      record.id::text AS id,
      record.source_id::text AS source_id,
      record.author_user_id::text AS author_user_id,
      record.input_type,
      record.raw_text,
      record.source_timestamp,
      record.edited_at,
      record.created_at,
      record.updated_at
    FROM worklog_records AS record
    WHERE record.source_id = ${sourceId}
      AND (
        ${filter.query}::text IS NULL
        OR COALESCE(record.raw_text, '') ILIKE '%' || ${filter.query} || '%'
      )
      AND (
        ${filter.from}::timestamptz IS NULL
        OR COALESCE(record.source_timestamp, record.created_at) >= ${filter.from}
      )
      AND (
        ${filter.to}::timestamptz IS NULL
        OR COALESCE(record.source_timestamp, record.created_at) < ${filter.to}
      )
    ORDER BY COALESCE(record.source_timestamp, record.created_at) DESC, record.id DESC
    LIMIT ${filter.limit + 1}
    OFFSET ${filter.offset}
  `);

  const rows = result.rows;
  const hasMore = rows.length > filter.limit;
  const records = hasMore ? rows.slice(0, filter.limit) : rows;
  return {
    records,
    page: {
      limit: filter.limit,
      offset: filter.offset,
      hasMore,
      nextOffset: hasMore ? filter.offset + filter.limit : null,
    },
  };
}

function recordFilter(params: Record<string, string>): RecordFilter | { error: string } {
  const from = params.from ? dateValue(params.from) : null;
  if (params.from && !from) return { error: 'INVALID_FROM_DATE' };
  const to = params.to ? dateValue(params.to) : null;
  if (params.to && !to) return { error: 'INVALID_TO_DATE' };
  if (from && to && from >= to) return { error: 'INVALID_DATE_RANGE' };

  return {
    query: query(params.q),
    from,
    to,
    limit: listLimit(params.limit, 50),
    offset: offsetValue(params.offset),
  };
}

function authSecret(env: WorklogRoutesBindings): string | null {
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

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function query(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized.slice(0, 300) : null;
}

function listLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : fallback;
}

function offsetValue(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : 0;
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeFeedbackContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['page', 'viewport', 'userAgent', 'appVersion', 'scopeType', 'sourceId']) {
    const item = raw[key];
    if (typeof item === 'string' && item.length <= 500) result[key] = item;
    if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
  }
  return result;
}
