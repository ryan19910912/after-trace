import { Hono } from 'hono';
import { listOperationalSettings, updateOperationalSetting } from '../config/operational-settings';
import { createDatabase } from '../db/client';
import { DrizzleMemoryRecoveryRepository } from '../memory/drizzle-recovery-repository';
import { MemoryRecoveryService } from '../memory/recovery';
import { verifyAdminAccess, type AdminAccessEnv } from './auth';
import { DrizzleAdminRepository } from './repository';

export type AdminBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type AdminEnv = { Bindings: AdminBindings };

export function createAdminRoutes() {
  const app = new Hono<AdminEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && !allowedOrigin) return c.json({ ok: false, error: 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    if (origin && origin !== allowedOrigin) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    if (c.req.method === 'OPTIONS') return next();

    let identity;
    try {
      identity = await verifyAdminAccess(c.req.header('cf-access-jwt-assertion'), c.env);
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin_access_verification_failed', message: error instanceof Error ? error.message : 'unknown error' }));
      return c.json({ ok: false, error: 'ADMIN_ACCESS_UNAVAILABLE' }, 503);
    }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401);
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.get('/overview', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, overview: await repository.overview(new Date()) });
  });

  app.get('/users', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, users: await repository.users(query(c.req.query('q')), limit(c.req.query('limit'))) });
  });

  app.get('/users/:id', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    const detail = await repository.userDetail(id(c.req.param('id')));
    return detail ? c.json({ ok: true, detail }) : c.json({ ok: false, error: 'USER_NOT_FOUND' }, 404);
  });

  app.get('/groups', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, groups: await repository.groups(query(c.req.query('q')), limit(c.req.query('limit'))) });
  });

  app.get('/groups/:id', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    const detail = await repository.groupDetail(id(c.req.param('id')));
    return detail ? c.json({ ok: true, detail }) : c.json({ ok: false, error: 'GROUP_NOT_FOUND' }, 404);
  });

  app.get('/failures', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, failures: await repository.failures(limit(c.req.query('limit'))) });
  });

  app.get('/settings', async (c) => {
    return c.json({ ok: true, settings: await listOperationalSettings(createDatabase(c.env.DATABASE_URL)) });
  });

  app.put('/settings/:key', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'INVALID_JSON' }, 400); }
    const value = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).value : undefined;
    try {
      const result = await updateOperationalSetting(
        createDatabase(c.env.DATABASE_URL),
        c.req.param('key'),
        value,
        c.env.ADMIN_ALLOWED_EMAIL?.trim() || 'admin',
      );
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'SETTING_UPDATE_FAILED' }, 400);
    }
  });

  app.get('/audit', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({ ok: true, audit: await repository.audit(limit(c.req.query('limit'))) });
  });

  app.post('/memory-requests/:id/retry', async (c) => {
    const database = createDatabase(c.env.DATABASE_URL);
    const repository = new DrizzleAdminRepository(database);
    const requestId = id(c.req.param('id'));
    const attempt = await repository.failedMemoryAttempt(requestId);
    if (attempt === null) return c.json({ ok: false, error: 'FAILED_MEMORY_REQUEST_NOT_FOUND' }, 404);
    const service = new MemoryRecoveryService(new DrizzleMemoryRecoveryRepository(database));
    const result = await service.requeueFailed({ requestId, expectedAttemptCount: attempt, operatorRef: c.env.ADMIN_ALLOWED_EMAIL?.trim() || 'admin', reason: 'Manual retry from AFTERTRACE Admin' });
    return result.status === 'REQUEUED' ? c.json({ ok: true, result }) : c.json({ ok: false, result }, 409);
  });

  app.post('/proactive/:id/cancel', async (c) => {
    const repository = new DrizzleAdminRepository(createDatabase(c.env.DATABASE_URL));
    const cancelled = await repository.cancelProactive(id(c.req.param('id')));
    return cancelled ? c.json({ ok: true }) : c.json({ ok: false, error: 'PROACTIVE_NOT_CANCELLABLE' }, 409);
  });

  return app;
}

function id(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('invalid id');
  return parsed;
}
function limit(value: string | undefined): number {
  if (!value) return 100;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 100;
}
function query(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized.slice(0, 200) : null;
}
