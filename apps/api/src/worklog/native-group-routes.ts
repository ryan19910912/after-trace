import { Hono } from 'hono';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { resolveWebSessionUserId } from '../auth/session-user';
import { createDatabase, type Database } from '../db/client';
import { DrizzleNativeGroupRepository } from './drizzle-native-groups';
import { NativeGroupService, type NativeGroupSummary } from './native-groups';

export type NativeGroupRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type NativeGroupRouteService = {
  listGroups(actorUserId: number): Promise<NativeGroupSummary[]>;
  createGroup(input: { creatorUserId: number; name: string }): ReturnType<NativeGroupService['createGroup']>;
  createInvite(input: {
    sourceId: number;
    actorUserId: number;
    expiresAt?: Date | null;
    maxUses?: number | null;
    now?: Date;
  }): ReturnType<NativeGroupService['createInvite']>;
  revokeInvite(input: {
    sourceId: number;
    inviteId: number;
    actorUserId: number;
  }): ReturnType<NativeGroupService['revokeInvite']>;
  join(input: { actorUserId: number; token: string }): ReturnType<NativeGroupService['join']>;
};

export type NativeGroupRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  verifySession?: (token: string, secret: string, now?: Date) => Promise<WebSessionClaims | null>;
  resolveSessionUserId?: (database: Database, session: WebSessionClaims) => Promise<number | null>;
  serviceFactory?: (database: Database) => NativeGroupRouteService;
};

type NativeGroupEnv = {
  Bindings: NativeGroupRoutesBindings;
  Variables: { userId: number; database: Database };
};

export function createNativeGroupRoutes(dependencies: NativeGroupRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const serviceFactory = dependencies.serviceFactory
    ?? ((database: Database) => new NativeGroupService(new DrizzleNativeGroupRepository(database)));
  const app = new Hono<NativeGroupEnv>();

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
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifySession(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = databaseFactory(c.env.DATABASE_URL);
    const userId = await resolveSessionUser(database, session);
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database);
    c.set('userId', userId);
    await next();
  });

  app.get('/', async (c) => {
    const groups = await serviceFactory(c.get('database')).listGroups(c.get('userId'));
    return c.json({ ok: true, groups });
  });

  app.post('/', async (c) => {
    const body = await objectBody(c);
    if (!body || typeof body.name !== 'string') return c.json({ ok: false, error: 'GROUP_NAME_REQUIRED' }, 400);
    try {
      const result = await serviceFactory(c.get('database')).createGroup({
        creatorUserId: c.get('userId'),
        name: body.name,
      });
      if (result.status === 'USER_NOT_READY') return c.json({ ok: false, error: result.status }, 409);
      return c.json({ ok: true, group: result.group }, 201);
    } catch (error) {
      return c.json({ ok: false, error: requestError(error) }, 400);
    }
  });

  app.post('/join', async (c) => {
    const body = await objectBody(c);
    if (!body || typeof body.token !== 'string') return c.json({ ok: false, error: 'INVITE_TOKEN_REQUIRED' }, 400);
    try {
      const result = await serviceFactory(c.get('database')).join({
        actorUserId: c.get('userId'),
        token: body.token,
      });
      if (result.status === 'INVALID_INVITE') return c.json({ ok: false, error: result.status }, 404);
      return c.json({ ok: true, status: result.status, group: result.group });
    } catch (error) {
      return c.json({ ok: false, error: requestError(error) }, 400);
    }
  });

  app.post('/:sourceId/invites', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const expiresAt = optionalDate(body.expiresAt);
    if (expiresAt === 'INVALID') return c.json({ ok: false, error: 'INVALID_EXPIRES_AT' }, 400);
    const maxUses = optionalPositiveInteger(body.maxUses);
    if (maxUses === 'INVALID') return c.json({ ok: false, error: 'INVALID_MAX_USES' }, 400);
    try {
      const result = await serviceFactory(c.get('database')).createInvite({
        sourceId,
        actorUserId: c.get('userId'),
        expiresAt,
        maxUses,
      });
      if (result.status === 'FORBIDDEN_OR_UNAVAILABLE') {
        return c.json({ ok: false, error: result.status }, 403);
      }
      if (result.status === 'TOKEN_CONFLICT') return c.json({ ok: false, error: result.status }, 409);
      return c.json({
        ok: true,
        invite: result.invite,
        inviteToken: result.token,
      }, 201);
    } catch (error) {
      return c.json({ ok: false, error: requestError(error) }, 400);
    }
  });

  app.delete('/:sourceId/invites/:inviteId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    const inviteId = positiveId(c.req.param('inviteId'));
    if (!sourceId || !inviteId) return c.json({ ok: false, error: 'INVALID_INVITE_ID' }, 400);
    const result = await serviceFactory(c.get('database')).revokeInvite({
      sourceId,
      inviteId,
      actorUserId: c.get('userId'),
    });
    if (result.status === 'FORBIDDEN_OR_NOT_FOUND') {
      return c.json({ ok: false, error: result.status }, 404);
    }
    return c.json({ ok: true, inviteId: result.inviteId });
  });

  return app;
}

function authSecret(env: NativeGroupRoutesBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

async function objectBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function positiveId(raw: string): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalDate(value: unknown): Date | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'INVALID';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : 'INVALID';
}

function optionalPositiveInteger(value: unknown): number | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return 'INVALID';
  return value;
}

function requestError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'INVALID_REQUEST';
}
