import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import type { Bindings } from '../env';
import { AnonymousIdentityService, parseBearerToken } from './anonymous';

export function createIdentityRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.post('/anonymous', async (c) => {
    if (!c.env.DATABASE_URL?.trim()) {
      return c.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, 503);
    }

    const service = new AnonymousIdentityService(createDatabase(c.env.DATABASE_URL));
    const existingToken = parseBearerToken(c.req.header('authorization'));
    if (existingToken) {
      const userId = await service.resolve(existingToken);
      if (!userId) return c.json({ ok: false, error: 'INVALID_IDENTITY' }, 401);
      return c.json({ ok: true, token: existingToken, created: false });
    }

    const identity = await service.issue();
    return c.json({ ok: true, token: identity.token, created: true }, 201);
  });

  return app;
}
