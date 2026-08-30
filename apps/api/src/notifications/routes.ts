import { Hono } from 'hono';
import { AnonymousIdentityService, parseBearerToken } from '../auth/anonymous';
import { createDatabase } from '../db/client';
import type { Bindings } from '../env';
import { DrizzleNotificationRepository } from './repository';
import { pushEndpointSchema, pushSubscriptionSchema } from './validation';
import { resolveVapidConfig } from './vapid';

function parseDeliveryId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createNotificationRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.get('/config', (c) => {
    try {
      const config = resolveVapidConfig(c.env);
      return c.json({
        ok: true,
        configured: Boolean(config),
        applicationServerKey: config?.publicKey ?? null,
      });
    } catch {
      return c.json({ ok: true, configured: false, applicationServerKey: null });
    }
  });

  app.use('*', async (c, next) => {
    if (!c.env.DATABASE_URL?.trim()) {
      return c.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, 503);
    }
    const token = parseBearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    const database = createDatabase(c.env.DATABASE_URL);
    const userId = await new AnonymousIdentityService(database).resolve(token);
    if (!userId) return c.json({ ok: false, error: 'INVALID_IDENTITY' }, 401);
    c.set('database', database);
    c.set('userId', userId);
    await next();
  });

  app.post('/subscription', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    const parsed = pushSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'INVALID_PUSH_SUBSCRIPTION', details: parsed.error.flatten() }, 400);
    }

    const repository = new DrizzleNotificationRepository(c.get('database'));
    const subscription = await repository.upsertWebPushSubscription(c.get('userId'), parsed.data);
    return c.json({ ok: true, subscription }, 201);
  });

  app.delete('/subscription', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    const parsed = pushEndpointSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'INVALID_PUSH_ENDPOINT' }, 400);

    const repository = new DrizzleNotificationRepository(c.get('database'));
    await repository.deactivateWebPushSubscription(c.get('userId'), parsed.data.endpoint);
    return c.json({ ok: true });
  });

  // Bare Web Push wakes the Service Worker without an encrypted payload.
  // The worker presents exactly one accepted delivery by authenticating here
  // with its browser identity and current PushSubscription endpoint.
  app.post('/presentation', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    const parsed = pushEndpointSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'INVALID_PUSH_ENDPOINT' }, 400);

    const repository = new DrizzleNotificationRepository(c.get('database'));
    const notification = await repository.claimPresentation(c.get('userId'), parsed.data.endpoint);
    return c.json({ ok: true, notification });
  });

  app.post('/deliveries/:deliveryId/opened', async (c) => {
    const deliveryId = parseDeliveryId(c.req.param('deliveryId'));
    if (!deliveryId) return c.json({ ok: false, error: 'INVALID_DELIVERY_ID' }, 400);

    const repository = new DrizzleNotificationRepository(c.get('database'));
    const opened = await repository.markOpened(c.get('userId'), deliveryId);
    if (!opened) return c.json({ ok: false, error: 'DELIVERY_NOT_FOUND' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
