import { Hono } from 'hono';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';
import { createDatabase, type Database } from '../db/client';
import { DrizzleNotificationRepository } from '../worklog/drizzle-notifications';
import {
  NotificationService,
  type AdminAnnouncementInput,
  type NotificationAudience,
  type NotificationRepository,
} from '../worklog/notifications';

export type AdminNotificationBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

export type AdminNotificationRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  repositoryFactory?: (database: Database) => NotificationRepository;
  verifySession?: typeof verifyAdminSessionToken;
};

type AdminNotificationEnv = {
  Bindings: AdminNotificationBindings;
  Variables: { adminUsername: string; database: Database };
};

type DispatchMode = 'DRAFT' | 'SEND_NOW' | 'SCHEDULED';

export function createAdminNotificationRoutes(dependencies: AdminNotificationRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const repositoryFactory = dependencies.repositoryFactory
    ?? ((database: Database) => new DrizzleNotificationRepository(database));
  const verifySession = dependencies.verifySession ?? verifyAdminSessionToken;
  const app = new Hono<AdminNotificationEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return c.json({ ok: false, error: allowedOrigin ? 'ORIGIN_NOT_ALLOWED' : 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, allowedOrigin ? 403 : 503);
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
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try {
      identity = await verifySession(token, c.env);
    } catch {
      return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503);
    }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username);
    c.set('database', databaseFactory(c.env.DATABASE_URL));
    await next();
  });

  app.get('/announcements', async (c) => {
    const service = serviceFor(c, repositoryFactory);
    return c.json({ ok: true, announcements: await service.listAnnouncements(limit(c.req.query('limit'))) });
  });

  app.get('/announcements/:id', async (c) => {
    const id = positiveId(c.req.param('id'));
    if (!id) return c.json({ ok: false, error: 'INVALID_NOTIFICATION_ID' }, 400);
    const detail = await serviceFor(c, repositoryFactory).announcementDetail(id);
    return detail
      ? c.json({ ok: true, announcement: detail })
      : c.json({ ok: false, error: 'ANNOUNCEMENT_NOT_FOUND' }, 404);
  });

  app.post('/announcements/preview', async (c) => {
    const parsed = await parseAnnouncement(c, c.get('adminUsername'));
    if ('error' in parsed) return c.json({ ok: false, error: parsed.error }, 400);
    try {
      validateAnnouncement(parsed.input, repositoryFactory, c.get('database'));
    } catch (error) {
      return c.json({ ok: false, error: errorCode(error, 'INVALID_ANNOUNCEMENT') }, 400);
    }
    return c.json({
      ok: true,
      preview: {
        title: parsed.input.title.trim(),
        body: parsed.input.body.trim(),
        audience: parsed.input.audience,
        specificUserIds: parsed.input.specificUserIds,
        inAppEnabled: parsed.input.inAppEnabled,
        pushEnabled: parsed.input.pushEnabled,
        deepLink: parsed.input.deepLink ?? null,
        mode: parsed.mode,
        scheduledAt: parsed.input.scheduledAt?.toISOString() ?? null,
      },
    });
  });

  app.post('/announcements', async (c) => {
    const parsed = await parseAnnouncement(c, c.get('adminUsername'));
    if ('error' in parsed) return c.json({ ok: false, error: parsed.error }, 400);
    const service = serviceFor(c, repositoryFactory);
    let created;
    try {
      created = await service.createAnnouncement(parsed.input);
    } catch (error) {
      return c.json({ ok: false, error: errorCode(error, 'ANNOUNCEMENT_CREATE_FAILED') }, 400);
    }
    if (parsed.mode !== 'SEND_NOW') return c.json({ ok: true, announcement: created.announcement }, 201);
    const dispatched = await service.dispatchAnnouncement(created.announcement.id);
    if (!('announcement' in dispatched)) {
      return c.json({ ok: false, error: 'ANNOUNCEMENT_DISPATCH_FAILED' }, 409);
    }
    return c.json({ ok: true, announcement: dispatched.announcement }, 201);
  });

  app.post('/announcements/:id/send', async (c) => {
    const id = positiveId(c.req.param('id'));
    if (!id) return c.json({ ok: false, error: 'INVALID_NOTIFICATION_ID' }, 400);
    const result = await serviceFor(c, repositoryFactory).dispatchAnnouncement(id);
    if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: 'ANNOUNCEMENT_NOT_FOUND' }, 404);
    if (result.status === 'NOT_DISPATCHABLE') return c.json({ ok: false, error: 'ANNOUNCEMENT_NOT_DISPATCHABLE' }, 409);
    if (!('announcement' in result)) return c.json({ ok: false, error: 'ANNOUNCEMENT_DISPATCH_FAILED' }, 409);
    return c.json({ ok: true, announcement: result.announcement });
  });

  app.delete('/announcements/:id', async (c) => {
    const id = positiveId(c.req.param('id'));
    if (!id) return c.json({ ok: false, error: 'INVALID_NOTIFICATION_ID' }, 400);
    const result = await serviceFor(c, repositoryFactory).cancelAnnouncement(id, c.get('adminUsername'));
    if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: 'ANNOUNCEMENT_NOT_FOUND' }, 404);
    if (result.status === 'NOT_CANCELLABLE') return c.json({ ok: false, error: 'ANNOUNCEMENT_NOT_CANCELLABLE' }, 409);
    if (!('announcement' in result)) return c.json({ ok: false, error: 'ANNOUNCEMENT_CANCEL_FAILED' }, 409);
    return c.json({ ok: true, announcement: result.announcement });
  });

  return app;
}

function serviceFor(
  c: { get(key: 'database'): Database },
  repositoryFactory: (database: Database) => NotificationRepository,
): NotificationService {
  return new NotificationService(repositoryFactory(c.get('database')));
}

function validateAnnouncement(
  input: AdminAnnouncementInput,
  repositoryFactory: (database: Database) => NotificationRepository,
  database: Database,
): void {
  const service = new NotificationService(repositoryFactory(database));
  void service;
  if (!input.title.trim() || input.title.trim().length > 255) throw new Error('INVALID_NOTIFICATION_TITLE');
  if (!input.body.trim() || input.body.trim().length > 10_000) throw new Error('INVALID_NOTIFICATION_BODY');
  if (!input.inAppEnabled && !input.pushEnabled) throw new Error('NOTIFICATION_CHANNEL_REQUIRED');
  if (input.audience === 'SPECIFIC_USERS' && input.specificUserIds.length === 0) throw new Error('SPECIFIC_USERS_REQUIRED');
  if (input.audience !== 'SPECIFIC_USERS' && input.specificUserIds.length > 0) throw new Error('SPECIFIC_USERS_NOT_ALLOWED');
}

async function parseAnnouncement(
  c: { req: { json(): Promise<unknown> } },
  actor: string,
): Promise<{ mode: DispatchMode; input: AdminAnnouncementInput } | { error: string }> {
  let body: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'INVALID_JSON' };
    body = raw as Record<string, unknown>;
  } catch {
    return { error: 'INVALID_JSON' };
  }
  const mode = dispatchMode(body.mode);
  if (!mode) return { error: 'INVALID_ANNOUNCEMENT_MODE' };
  const audience = audienceValue(body.audience);
  if (!audience) return { error: 'INVALID_ANNOUNCEMENT_AUDIENCE' };
  const scheduledAt = mode === 'SCHEDULED' ? dateValue(body.scheduledAt) : null;
  if (mode === 'SCHEDULED' && !scheduledAt) return { error: 'INVALID_SCHEDULED_AT' };
  if (scheduledAt && scheduledAt.getTime() <= Date.now()) return { error: 'SCHEDULED_AT_MUST_BE_FUTURE' };
  const specificUserIds = userIds(body.specificUserIds);
  if (!specificUserIds) return { error: 'INVALID_SPECIFIC_USER_IDS' };
  return {
    mode,
    input: {
      title: typeof body.title === 'string' ? body.title : '',
      body: typeof body.body === 'string' ? body.body : '',
      audience,
      specificUserIds,
      inAppEnabled: body.inAppEnabled !== false,
      pushEnabled: body.pushEnabled === true,
      deepLink: typeof body.deepLink === 'string' ? body.deepLink : null,
      scheduledAt,
      createdByActor: actor,
    },
  };
}

function dispatchMode(value: unknown): DispatchMode | null {
  return value === 'DRAFT' || value === 'SEND_NOW' || value === 'SCHEDULED' ? value : null;
}

function audienceValue(value: unknown): NotificationAudience | null {
  return value === 'ALL_USERS' || value === 'FREE_USERS' || value === 'AI_SUBSCRIBERS' || value === 'SPECIFIC_USERS'
    ? value
    : null;
}

function userIds(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = new Set<number>();
  for (const item of value) {
    const parsed = Number(item);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
    ids.add(parsed);
  }
  return [...ids];
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function limit(value: string | undefined): number {
  if (!value) return 100;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 100;
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : fallback;
}