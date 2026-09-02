import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase } from '../db/client';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { WorklogRecordReadService } from './records';

export type WorklogRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type WorklogEnv = { Bindings: WorklogRoutesBindings };

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

function safePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createWorklogRoutes() {
  const app = new Hono<WorklogEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
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
    c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
    c.set('lineUserId' as never, session.lineUserId as never);
    await next();
  });

  app.get('/surfaces', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId' as never) as string);
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    return c.json({ ok: true, userId: context.userId, surfaces: await context.records.surfaces(context.userId) });
  });

  app.get('/records/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId' as never) as string);
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const limit = safePositiveInt(c.req.query('limit')) ?? 100;
    return c.json({ ok: true, records: await context.records.personalRecords(context.userId, limit) });
  });

  app.get('/records/group/:sourceId', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId' as never) as string);
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const limit = safePositiveInt(c.req.query('limit')) ?? 100;
    const result = await context.records.groupRecords(context.userId, sourceId, limit);
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'GROUP_SCOPE_FORBIDDEN' }, 403);
    return c.json({ ok: true, records: result.records });
  });

  return app;
}

async function contextFor(databaseUrl: string, lineUserId: string) {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`
    SELECT id::text AS id
    FROM worklog_users
    WHERE line_user_id = ${lineUserId}
    LIMIT 1
  `);
  const id = (result.rows[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return {
    userId,
    records: new WorklogRecordReadService(new DrizzleWorklogRecordReadRepository(database)),
  };
}
