import { Hono } from 'hono';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { DrizzleNotificationRepository } from './drizzle-notifications';
import { NotificationService, type NotificationRepository } from './notifications';

export type NotificationRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

export type NotificationRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  verifySession?: (token: string, secret: string, now?: Date) => Promise<WebSessionClaims | null>;
  resolveSessionUserId?: (database: Database, session: WebSessionClaims) => Promise<number | null>;
  repositoryFactory?: (database: Database) => NotificationRepository;
};

type NotificationEnv = {
  Bindings: NotificationRoutesBindings;
  Variables: { userId: number; database: Database };
};

export function createNotificationRoutes(dependencies: NotificationRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const repositoryFactory = dependencies.repositoryFactory
    ?? ((database: Database) => new DrizzleNotificationRepository(database));
  const app = new Hono<NotificationEnv>();

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
    c.header('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
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
    const service = new NotificationService(repositoryFactory(c.get('database')));
    const center = await service.notificationCenter(c.get('userId'), limit(c.req.query('limit')));
    return c.json({ ok: true, ...center });
  });

  app.patch('/:id/read', async (c) => {
    const notificationId = positiveId(c.req.param('id'));
    if (!notificationId) return c.json({ ok: false, error: 'INVALID_NOTIFICATION_ID' }, 400);
    const service = new NotificationService(repositoryFactory(c.get('database')));
    const readAt = await service.markRead(c.get('userId'), notificationId);
    return readAt
      ? c.json({ ok: true, notificationId, readAt })
      : c.json({ ok: false, error: 'NOTIFICATION_NOT_FOUND' }, 404);
  });

  app.post('/read-all', async (c) => {
    const service = new NotificationService(repositoryFactory(c.get('database')));
    const updatedCount = await service.markAllRead(c.get('userId'));
    return c.json({ ok: true, updatedCount });
  });

  return app;
}

function authSecret(env: NotificationRoutesBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function limit(value: string | undefined): number {
  if (!value) return 50;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 50;
}
