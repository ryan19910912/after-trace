import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';
import { createDatabase, type Database } from '../db/client';

export type AdminAccountLookupBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type Env = {
  Bindings: AdminAccountLookupBindings;
  Variables: { adminUsername: string; database: Database };
};

export function createAdminAccountLookupRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) {
      return c.json({ ok: false, error: allowed ? 'ORIGIN_NOT_ALLOWED' : 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, allowed ? 403 : 503);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowed === origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowed || origin !== allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try { identity = await verifyAdminSessionToken(token, c.env); }
    catch { return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503); }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username);
    c.set('database', createDatabase(c.env.DATABASE_URL));
    await next();
  });

  app.get('/', async (c) => {
    const query = boundedQuery(c.req.query('q'));
    if (!query) return c.json({ ok: false, error: 'ACCOUNT_QUERY_REQUIRED' }, 400);
    const limit = boundedLimit(c.req.query('limit'));
    const result = await c.get('database').execute(sql`
      SELECT
        u.id::text AS id,
        public_account.public_account_id,
        u.display_name,
        COALESCE(subscription.plan_code, 'FREE') AS plan_code,
        subscription.status AS subscription_status,
        subscription.current_period_start,
        subscription.current_period_end,
        (SELECT COUNT(*) FROM worklog_source_members member
          INNER JOIN worklog_sources source ON source.id = member.source_id
          WHERE member.user_id = u.id
            AND member.is_active = TRUE
            AND source.type = 'GROUP'
            AND source.status = 'ACTIVE')::text AS member_group_count,
        (SELECT COUNT(*) FROM worklog_records record
          WHERE record.author_user_id = u.id AND record.status = 'ACTIVE')::text AS record_count,
        u.created_at,
        u.updated_at
      FROM worklog_users u
      INNER JOIN worklog_user_public_accounts public_account ON public_account.user_id = u.id
      LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
      WHERE public_account.public_account_id = UPPER(${query}::text)
         OR COALESCE(u.display_name, '') ILIKE '%' || ${query}::text || '%'
      ORDER BY
        CASE WHEN public_account.public_account_id = UPPER(${query}::text) THEN 0 ELSE 1 END,
        u.updated_at DESC,
        u.id DESC
      LIMIT ${limit}
    `);
    return c.json({ ok: true, accounts: result.rows });
  });

  return app;
}

function boundedQuery(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized && normalized.length <= 255 ? normalized : null;
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number(value ?? 25);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 25;
}
