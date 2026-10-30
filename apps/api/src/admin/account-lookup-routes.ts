import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { isPublicAccountId } from '../auth/public-account-id';
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

/** Provider-neutral support lookup. */
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
    const accountIdLookup = isPublicAccountId(query);
    const limit = boundedLimit(c.req.query('limit'));
    const db = c.get('database');
    const predicate = accountIdLookup ? sql`public_account.public_account_id = ${query.toUpperCase()}` : sql`COALESCE(account.display_name, '') ILIKE ${'%' + query + '%'}`;
    const result = await db.execute(sql`
      WITH matched_accounts AS (
        SELECT account.*, public_account.public_account_id
        FROM worklog_users AS account
        INNER JOIN worklog_user_public_accounts AS public_account ON public_account.user_id = account.id
        WHERE ${predicate}
        ORDER BY account.updated_at DESC, account.id DESC LIMIT ${limit}
      )
      SELECT
        account.id::text AS id,
        account.public_account_id,
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
            AND source.status = 'ACTIVE'
            AND source.name IS NOT NULL
            AND length(btrim(source.name)) > 0)::text AS member_group_count,
        counts.text_count::text AS text_count, counts.audio_count::text AS audio_count,
        counts.image_count::text AS image_count, counts.file_count::text AS file_count,
        counts.record_count::text AS record_count,
        account.created_at,
        account.updated_at
      FROM matched_accounts AS account
      LEFT JOIN worklog_user_subscriptions AS subscription ON subscription.user_id = account.id
      LEFT JOIN LATERAL (SELECT
        COUNT(*) FILTER (WHERE record.input_type = 'TEXT') AS text_count,
        COUNT(*) FILTER (WHERE record.input_type = 'AUDIO') AS audio_count,
        COUNT(*) FILTER (WHERE record.input_type = 'IMAGE') AS image_count,
        COUNT(*) FILTER (WHERE record.input_type = 'FILE') AS file_count,
        COUNT(*) AS record_count
        FROM worklog_records AS record WHERE record.author_user_id = account.id AND record.status = 'ACTIVE'
      ) AS counts ON TRUE
      ORDER BY account.updated_at DESC, account.id DESC
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
