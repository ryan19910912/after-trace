import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';

export type FeedbackRouteBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type Env = {
  Bindings: FeedbackRouteBindings;
  Variables: { userId: number; database: Database };
};

/** Provider-neutral in-product feedback. LINE OA remains a separate external support channel. */
export function createFeedbackRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowed === origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowed = c.env.WEB_APP_ORIGIN?.trim();
    if (!origin || !allowed || origin !== allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = c.env.WEB_AUTH_SECRET?.trim() ?? '';
    if (secret.length < 32) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const match = /^Bearer\s+(.+)$/i.exec((c.req.header('authorization') ?? '').trim());
    if (!match) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifyWebSessionToken(match[1], secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = createDatabase(c.env.DATABASE_URL);
    const userId = await resolveWebSessionUserId(database, session);
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database);
    c.set('userId', userId);
    await next();
  });

  app.post('/', async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 10_000) return c.json({ ok: false, error: 'FEEDBACK_TEXT_REQUIRED' }, 400);
    const context = boundedContext(body.context);
    if (body.context !== undefined && context === null) return c.json({ ok: false, error: 'INVALID_FEEDBACK_CONTEXT' }, 400);

    const database = c.get('database');
    const userId = c.get('userId');
    const result = await database.execute(sql`
      INSERT INTO worklog_feedback (
        user_id, display_name_snapshot, channel, text, context, created_at
      )
      SELECT
        u.id,
        u.display_name,
        'PWA',
        ${text},
        ${context === null ? null : JSON.stringify(context)}::jsonb,
        NOW()
      FROM worklog_users u
      WHERE u.id = ${userId}
      RETURNING id::text AS id, created_at
    `);
    const row = result.rows[0];
    if (!row) return c.json({ ok: false, error: 'FEEDBACK_CREATE_FAILED' }, 500);
    return c.json({ ok: true, feedback: row }, 201);
  });

  return app;
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function boundedContext(value: unknown): Record<string, string | number | boolean | null> | null {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(source)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return null;
    if (typeof item === 'string') result[key] = item.slice(0, 1000);
    else if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
    else if (typeof item === 'boolean' || item === null) result[key] = item;
    else return null;
    if (Object.keys(result).length > 32) return null;
  }
  return JSON.stringify(result).length <= 8_000 ? result : null;
}
