import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { WorklogConfirmationService, type WorklogConfirmationDecision } from './confirmations';
import { DrizzleWorklogConfirmationRepository } from './drizzle-confirmations-safe';

export type WorklogConfirmationRouteBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type Env = {
  Bindings: WorklogConfirmationRouteBindings;
  Variables: { lineUserId: string };
};

type UserContext = { userId: number; database: Database; service: WorklogConfirmationService };

/**
 * PWA surface for resolving already-durable AI title ambiguity.
 *
 * These endpoints never call provider AI and never consume additional points. They
 * only apply/reject the stored decision while the original Record version is still
 * current. PRIVATE/GROUP authorization follows ordinary manual PWA access.
 */
export function createWorklogConfirmationRoutes() {
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
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    return c.json({
      ok: true,
      confirmations: serializeConfirmations(await context.service.listPending(context.userId, sourceId)),
    });
  });

  app.get('/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if (!(await activeGroupMember(context.database, context.userId, sourceId))) {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    return c.json({
      ok: true,
      confirmations: serializeConfirmations(await context.service.listPending(context.userId, sourceId)),
    });
  });

  app.post('/personal/:confirmationId/resolve', async (c) => {
    const confirmationId = positiveId(c.req.param('confirmationId'));
    if (!confirmationId) return c.json({ ok: false, error: 'INVALID_CONFIRMATION_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const sourceId = await personalSourceId(context.database, context.userId);
    if (!sourceId) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    return resolveRequest(c, context, sourceId, confirmationId);
  });

  app.post('/group/:sourceId/:confirmationId/resolve', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    const confirmationId = positiveId(c.req.param('confirmationId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    if (!confirmationId) return c.json({ ok: false, error: 'INVALID_CONFIRMATION_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if (!(await activeGroupMember(context.database, context.userId, sourceId))) {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    return resolveRequest(c, context, sourceId, confirmationId);
  });

  return app;
}

async function resolveRequest(
  c: { req: { json(): Promise<unknown> }; json(value: unknown, status?: number): Response },
  context: UserContext,
  sourceId: number,
  confirmationId: number,
) {
  const body = await objectBody(c);
  if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
  const decision = confirmationDecision(body);
  if ('error' in decision) return c.json({ ok: false, error: decision.error }, 400);

  const result = await context.service.resolve({
    confirmationId,
    requestedUserId: context.userId,
    sourceId,
    decision,
  });

  if (result.status === 'CONFIRMED' || result.status === 'REJECTED') {
    return c.json({ ok: true, resolution: result });
  }
  if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: 'CONFIRMATION_NOT_FOUND' }, 404);
  if (result.status === 'TITLE_REQUIRED') return c.json({ ok: false, error: result.status }, 400);
  if (result.status === 'ENTITY_NOT_ALLOWED') return c.json({ ok: false, error: result.status }, 400);
  return c.json({ ok: false, error: result.status }, 409);
}

async function contextFor(databaseUrl: string, lineUserId: string): Promise<UserContext | null> {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`
    SELECT id::text AS id FROM worklog_users WHERE line_user_id = ${lineUserId} LIMIT 1
  `);
  const id = Number((result.rows[0] as { id?: string } | undefined)?.id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    userId: id,
    database,
    service: new WorklogConfirmationService(new DrizzleWorklogConfirmationRepository(database)),
  };
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
  const id = Number((result.rows[0] as { id?: string } | undefined)?.id ?? 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

function confirmationDecision(body: Record<string, unknown>): WorklogConfirmationDecision | { error: string } {
  const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (action === 'REJECT') return { kind: 'REJECT' };
  if (action === 'USE_EXISTING') {
    const entityId = typeof body.entityId === 'number' && Number.isSafeInteger(body.entityId) && body.entityId > 0
      ? body.entityId
      : null;
    return entityId ? { kind: 'USE_EXISTING', entityId } : { error: 'ENTITY_ID_REQUIRED' };
  }
  if (action === 'CREATE_TITLE') {
    if (body.title !== undefined && typeof body.title !== 'string') return { error: 'INVALID_TITLE' };
    const title = typeof body.title === 'string' ? body.title.trim() : null;
    if (title && title.length > 255) return { error: 'INVALID_TITLE' };
    return { kind: 'CREATE_TITLE', title };
  }
  return { error: 'INVALID_CONFIRMATION_ACTION' };
}

function serializeConfirmations(values: Awaited<ReturnType<WorklogConfirmationService['listPending']>>) {
  return values.map((value) => ({
    id: value.id,
    sourceId: value.sourceId,
    recordId: value.recordId,
    confirmationType: value.confirmationType,
    candidateEntityId: value.candidateEntityId,
    candidateTitle: value.candidateTitle,
    proposedName: value.proposedName,
    reason: value.reason,
    operation: value.operation,
    proposedRawText: value.proposedRawText,
    occurredAt: value.occurredAt.toISOString(),
    recordOccurredAt: value.recordOccurredAt.toISOString(),
    expectedRecordVersion: value.expectedRecordVersion,
    candidates: value.candidates,
    recordRawText: value.recordRawText,
    expiresAt: value.expiresAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
  }));
}

function authSecret(env: WorklogConfirmationRouteBindings): string | null {
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
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
