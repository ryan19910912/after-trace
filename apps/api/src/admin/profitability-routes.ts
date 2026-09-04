import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import {
  bearerToken,
  verifyAdminSessionToken,
  type AdminAccessEnv,
} from './auth';
import {
  DrizzleAdminProfitabilityRepository,
  parseAdminProfitabilityPeriod,
} from './profitability';
import { presentAdminPayload } from './presentation';

export type AdminProfitabilityBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type ProfitabilityEnv = {
  Bindings: AdminProfitabilityBindings;
};

/**
 * Read-only factual AI economics endpoint mounted at /api/v1/admin/profitability.
 * It intentionally has no pricing/revenue mutation surface.
 */
export function createAdminProfitabilityRoutes() {
  const app = new Hono<ProfitabilityEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && !allowedOrigin) return c.json({ ok: false, error: 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    if (origin && origin !== allowedOrigin) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && origin === allowedOrigin) {
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
    c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try {
      identity = await verifyAdminSessionToken(token, c.env);
    } catch {
      return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503);
    }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    await next();
  });

  app.get('/', async (c) => {
    const period = parseAdminProfitabilityPeriod(c.req.query('period'));
    if (!period) return c.json({ ok: false, error: 'INVALID_PROFITABILITY_PERIOD' }, 400);
    const repository = new DrizzleAdminProfitabilityRepository(createDatabase(c.env.DATABASE_URL));
    return c.json({
      ok: true,
      report: presentAdminPayload(await repository.report(period, new Date())),
    });
  });

  return app;
}
