import { Hono } from 'hono';
import type { ProductConfigEnv } from '../config/product';
import { createDatabase } from '../db/client';
import { LineLiffUserSessionVerifier } from '../management/session';
import { DrizzlePrivateEnergyOverviewRepository, serializePrivateEnergyOverview } from './private-overview';

export type EnergyRouteBindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LIFF_CHANNEL_ID: string;
  LIFF_WEB_ORIGIN?: string;
};

export function createEnergyRoutes() {
  const app = new Hono<{ Bindings: EnergyRouteBindings }>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.LIFF_WEB_ORIGIN?.trim();
    if (origin && !allowedOrigin) {
      return c.json({ ok: false, error: 'LIFF_WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    }
    if (origin && origin !== allowedOrigin) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    if (origin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.LIFF_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.get('/me', async (c) => {
    const verifier = new LineLiffUserSessionVerifier(c.env.LIFF_CHANNEL_ID);
    const session = await verifier.verify(c.req.header('authorization'));
    if (session.status !== 'AUTHORIZED') {
      const status = session.status === 'LINE_VERIFICATION_UNAVAILABLE' ? 503 : 401;
      return c.json({ ok: false, error: session.status }, status);
    }

    const repository = new DrizzlePrivateEnergyOverviewRepository(
      createDatabase(c.env.DATABASE_URL),
    );
    const overview = await repository.load(session.session.lineUserId, new Date());
    if (!overview) {
      return c.json({ ok: false, error: 'ENERGY_USER_NOT_FOUND' }, 404);
    }
    return c.json({ ok: true, energy: serializePrivateEnergyOverview(overview) });
  });

  return app;
}
