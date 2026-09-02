import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase } from '../db/client';
import { WorklogCollaborationService } from './collaboration';
import { DrizzleWorklogCollaborationRepository } from './drizzle-collaboration';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { DrizzleWorklogUsageRepository } from './drizzle-usage';
import { WorklogRecordReadService } from './records';
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
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
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
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
    return c.json({ ok: true, userId: context.userId, surfaces: await context.records.surfaces(context.userId) });
  });

  app.get('/records/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const limit = safePositiveInt(c.req.query('limit')) ?? 100;
    return c.json({ ok: true, records: await context.records.personalRecords(context.userId, limit) });
  });

  app.get('/records/group/:sourceId', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const limit = safePositiveInt(c.req.query('limit')) ?? 100;
    const result = await context.records.groupRecords(context.userId, sourceId, limit);
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'GROUP_SCOPE_FORBIDDEN' }, 403);
    return c.json({ ok: true, records: result.records });
  });

  app.get('/usage/me', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    return c.json({ ok: true, usage: await context.usage.userUsage(context.userId) });
  });

  app.get('/groups/:sourceId/owner-view', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const result = await context.usage.groupOwnerUsage(context.userId, sourceId);
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
    if (result.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: 'OWNER_UNBOUND' }, 409);
    return c.json({ ok: true, ownerView: result.value });
  });

  app.patch('/groups/:sourceId/members/:memberUserId/recording', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    const memberUserId = safePositiveInt(c.req.param('memberUserId'));
    if (!sourceId || !memberUserId) return c.json({ ok: false, error: 'INVALID_MEMBER_TARGET' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'INVALID_JSON' }, 400); }
    const enabled = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).enabled : undefined;
    if (typeof enabled !== 'boolean') return c.json({ ok: false, error: 'ENABLED_BOOLEAN_REQUIRED' }, 400);
    const result = await context.collaboration.setMemberRecordingPermission({
      sourceId, actorUserId: context.userId, memberUserId, enabled,
    });
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
    if (result.status === 'MEMBER_NOT_FOUND') return c.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, 404);
    if (result.status === 'OWNER_CANNOT_BE_DISABLED') return c.json({ ok: false, error: 'OWNER_CANNOT_BE_DISABLED' }, 409);
    if (result.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: 'OWNER_UNBOUND' }, 409);
    return c.json({ ok: true, recordingEnabled: enabled });
  });

  return app;
}

async function contextFor(databaseUrl: string, lineUserId: string) {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`
    SELECT id::text AS id FROM worklog_users WHERE line_user_id = ${lineUserId} LIMIT 1
  `);
  const id = (result.rows[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return {
    userId,
    records: new WorklogRecordReadService(new DrizzleWorklogRecordReadRepository(database)),
    usage: new WorklogUsageService(new DrizzleWorklogUsageRepository(database)),
    collaboration: new WorklogCollaborationService(new DrizzleWorklogCollaborationRepository(database)),
  };
}
