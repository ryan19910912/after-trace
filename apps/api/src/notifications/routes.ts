import { Hono } from 'hono';
import { AnonymousIdentityService, parseBearerToken } from '../auth/anonymous';
import { createDatabase } from '../db/client';
import type { Bindings } from '../env';
import { DrizzlePendingDeliveryReconciler } from './reconciler';
import { DrizzleNotificationRepository } from './repository';
import { pushEndpointSchema, pushSubscriptionSchema } from './validation';
import { resolveVapidConfig } from './vapid';

function parseDeliveryId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createNotificationRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', async (c, next) => {
    // The browser needs the public VAPID key before it can create a PushSubscription.
    // No database identity is required for this single read-only endpoint.
    if (c.req.method === 'GET' && c.req.path.endsWith('/config')) {
      await next();
      return;
    }

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

    const database = c.get('database');
    const userId = c.get('userId');
    const repository = new DrizzleNotificationRepository(database);
    const notification = await repository.claimPresentation(userId, parsed.data.endpoint);
    if (!notification) return c.json({ ok: true, notification: null });

    // Push-service acceptance and browser wake-up can race with a newer source
    // transition or a watch edit/pause. Recheck the exact delivery after claim;
    // a successful null response means the wake-up is stale and must stay silent.
    const actionable = await new DrizzlePendingDeliveryReconciler(database)
      .isDeliveryActionable(userId, notification.deliveryId);
    if (!actionable) return c.json({ ok: true, notification: null });

    // Keep provider-machine booking references inside synchronization storage.
    // Browser presentation only receives the search deep-link and display data;
    // the normal availability API supplies the verified human booking URL.
    return c.json({
      ok: true,
      notification: {
        deliveryId: notification.deliveryId,
        title: notification.title,
        body: notification.body,
        tag: notification.tag,
        deepLink: notification.deepLink,
        venueName: notification.venueName,
        district: notification.district,
        courtName: notification.courtName,
      },
    });
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
