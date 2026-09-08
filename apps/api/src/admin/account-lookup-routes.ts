import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';

export type AdminAccountLookupBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type Env = {
  Bindings: AdminAccountLookupBindings;
  Variables: { database: Database };
};

/**
 * Provider-neutral support lookup. This route intentionally does not expose or depend on
 * Google/LINE/Apple provider subjects, LINE OA friendship, or legacy GROUP AI responsibility.
 */
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
    c.set('database', createDatabase(c.env.DATABASE_URL));
    await next();
  });

  app.get('/', async (c) => {
    const query = boundedQuery(c.req.query('q'));
    if (!query) return c.json({ ok: false, error: 'ACCOUNT_QUERY_REQUIRED' }, 400);
    const limit = boundedLimit(c.req.query('limit'));
    const db = c.get('database');
    const result = await db.execute(sql`
      SELECT
        account.id::text AS id,
        public_account.public_account_id,
        account.display_name,
        COALESCE(subscription.plan_code, 'FREE') AS plan_code,
        CASE
          WHEN subscription.user_id IS NULL THEN NULL
          WHEN subscription.status <> 'ACTIVE' THEN subscription.status::text
          WHEN subscription.effective_at > NOW() THEN 'NOT_YET_EFFECTIVE'
          WHEN subscription.current_period_start > NOW() THEN 'PERIOD_NOT_STARTED'
          WHEN subscription.current_period_end IS NOT NULL AND subscription.current_period_end <= NOW() THEN 'PERIOD_EXPIRED'
          ELSE 'ACTIVE'
        END AS subscription_status,
        (SELECT COUNT(*) FROM worklog_source_members AS member
          INNER JOIN worklog_sources AS source ON source.id = member.source_id
          WHERE member.user_id = account.id
            AND member.is_active = TRUE
            AND source.type = 'GROUP'
            AND source.status = 'ACTIVE')::text AS member_group_count,
        (SELECT COUNT(*) FROM worklog_records AS record WHERE record.author_user_id = account.id AND record.input_type = 'TEXT')::text AS text_count,
        (SELECT COUNT(*) FROM worklog_records AS record WHERE record.author_user_id = account.id AND record.input_type = 'AUDIO')::text AS audio_count,
        (SELECT COUNT(*) FROM worklog_records AS record WHERE record.author_user_id = account.id AND record.input_type = 'IMAGE')::text AS image_count,
        (SELECT COUNT(*) FROM worklog_records AS record WHERE record.author_user_id = account.id AND record.input_type = 'FILE')::text AS file_count,
        account.created_at,
        account.updated_at
      FROM worklog_users AS account
      INNER JOIN worklog_user_public_accounts AS public_account ON public_account.user_id = account.id
      LEFT JOIN worklog_user_subscriptions AS subscription ON subscription.user_id = account.id
      WHERE upper(public_account.public_account_id) = upper(${query})
         OR COALESCE(account.display_name, '') ILIKE '%' || ${query} || '%'
      ORDER BY
        CASE WHEN upper(public_account.public_account_id) = upper(${query}) THEN 0 ELSE 1 END,
        account.updated_at DESC,
        account.id DESC
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
  const parsed = Number(value ?? 50);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 50;
}
