import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import { DrizzleWebAuthRepository } from './repository';
import { WebAuthService } from './service';
import { verifyWebSessionToken } from './token';

export type WebAuthBindings = {
  DATABASE_URL: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  WEB_AUTH_SECRET?: string;
  WEB_WEB_ORIGIN?: string;
};

type AuthEnv = { Bindings: WebAuthBindings };

function authSecret(env: WebAuthBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? '';
  return token && token.length <= 8192 ? token : null;
}

export function createWebAuthRoutes() {
  const app = new Hono<AuthEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_WEB_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    if (origin && allowedOrigin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.post('/entry/exchange', async (c) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { token?: unknown }).token !== 'string') {
      return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    }
    const service = new WebAuthService(
      new DrizzleWebAuthRepository(createDatabase(c.env.DATABASE_URL)),
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      secret,
    );
    const result = await service.exchangeBotEntry((body as { token: string }).token);
    if (result.status === 'INVALID_OR_EXPIRED' || result.status === 'ALREADY_USED') {
      return c.json({ ok: false, error: result.status }, 401);
    }
    if (result.status === 'NOT_GROUP_MEMBER') return c.json({ ok: false, error: result.status }, 403);
    if (result.status === 'LINE_UNAVAILABLE') return c.json({ ok: false, error: result.status }, 503);
    return c.json({
      ok: true,
      sessionToken: result.sessionToken,
      lineUserId: result.lineUserId,
      lineGroupId: result.lineGroupId,
    });
  });

  app.get('/groups', async (c) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifyWebSessionToken(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    try {
      const service = new WebAuthService(
        new DrizzleWebAuthRepository(createDatabase(c.env.DATABASE_URL)),
        c.env.LINE_CHANNEL_ACCESS_TOKEN,
        secret,
      );
      return c.json({ ok: true, groups: await service.listGroups(session.lineUserId) });
    } catch (error) {
      if (error instanceof Error && error.message === 'LINE_GROUP_SUMMARY_UNAVAILABLE') {
        return c.json({ ok: false, error: error.message }, 503);
      }
      throw error;
    }
  });

  return app;
}
