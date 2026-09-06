import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase } from '../db/client';

type Bindings = { DATABASE_URL: string; WEB_AUTH_SECRET?: string; WEB_APP_ORIGIN?: string };
type Env = { Bindings: Bindings; Variables: { session: WebSessionClaims } };

const CHECKOUT_ENABLED = false;

type UserSubscriptionRow = {
  id: number;
  planCode: string;
  effectiveState: 'NO_SUBSCRIPTION' | 'SUBSCRIPTION_INACTIVE' | 'PLAN_DISABLED' | 'NOT_YET_EFFECTIVE' | 'PERIOD_NOT_STARTED' | 'PERIOD_EXPIRED' | 'ACTIVE';
};

export function createWorklogSubscriptionRoutes() {
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
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = c.env.WEB_AUTH_SECRET?.trim();
    if (!secret || secret.length < 32) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const match = /^Bearer\s+(.+)$/i.exec((c.req.header('authorization') ?? '').trim());
    if (!match) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifyWebSessionToken(match[1], secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    c.set('session', session);
    await next();
  });

  app.get('/plans', async (c) => {
    const db = createDatabase(c.env.DATABASE_URL);
    const userId = await resolveWebSessionUserId(db, c.get('session'));
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const user = await userRow(db, userId);
    if (!user) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);

    const result = await db.execute(sql`
      SELECT
        plan.code,
        plan.plan_type,
        plan.display_name,
        plan.price_twd::text AS price_twd,
        plan.rank,
        plan.grant_points,
        CASE WHEN plan.plan_type = 'SUBSCRIPTION' THEN plan.grant_points ELSE 0 END AS subscription_period_points,
        CASE WHEN plan.plan_type = 'FREE' THEN plan.grant_points ELSE 0 END AS one_time_initial_points,
        CASE WHEN plan.plan_type = 'ONE_TIME' THEN plan.grant_points ELSE 0 END AS one_time_purchase_points,
        ((COALESCE(plan.capabilities, '{}'::jsonb)
          - 'privateOaRecording'
          - 'aiTextRecording'
          - 'aiMediaIngestion'
          - 'export') || jsonb_build_object('export', FALSE)) AS capabilities,
        CASE
          WHEN plan.plan_type = 'ONE_TIME' THEN FALSE
          WHEN ${user.effectiveState} = 'ACTIVE' AND ${user.planCode} = plan.code THEN TRUE
          WHEN ${user.effectiveState} <> 'ACTIVE' AND plan.code = 'FREE' THEN TRUE
          ELSE FALSE
        END AS current
      FROM worklog_subscription_plans plan
      WHERE plan.enabled = TRUE
      ORDER BY CASE plan.plan_type WHEN 'FREE' THEN 0 WHEN 'SUBSCRIPTION' THEN 1 ELSE 2 END,
               plan.rank ASC, plan.price_twd ASC, plan.code ASC
    `);

    return c.json({
      ok: true,
      currentPlanCode: user.effectiveState === 'ACTIVE' ? user.planCode : 'FREE',
      currentSubscriptionState: user.effectiveState,
      checkoutEnabled: CHECKOUT_ENABLED,
      plans: result.rows,
    });
  });

  app.post('/checkout-intents', async (c) => {
    if (!CHECKOUT_ENABLED) return c.json({ ok: false, error: 'CHECKOUT_NOT_ENABLED' }, 503);

    const db = createDatabase(c.env.DATABASE_URL);
    const userId = await resolveWebSessionUserId(db, c.get('session'));
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const user = await userRow(db, userId);
    if (!user) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);

    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'INVALID_JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);

    const row = body as Record<string, unknown>;
    const planCode = typeof row.planCode === 'string' ? row.planCode.trim().toUpperCase() : '';
    const requestKey = typeof row.requestKey === 'string' ? row.requestKey.trim() : '';
    if (!/^[A-Z0-9_-]{1,64}$/.test(planCode)) return c.json({ ok: false, error: 'INVALID_PLAN_CODE' }, 400);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(requestKey)) return c.json({ ok: false, error: 'INVALID_REQUEST_KEY' }, 400);

    const planResult = await db.execute(sql`
      SELECT code, plan_type, display_name, price_twd::text AS price_twd, enabled
      FROM worklog_subscription_plans
      WHERE code = ${planCode}
      LIMIT 1
    `);
    const plan = planResult.rows[0] as { code?: string; plan_type?: string; display_name?: string; price_twd?: string; enabled?: boolean } | undefined;
    if (!plan?.code || !plan.enabled) return c.json({ ok: false, error: 'PLAN_NOT_AVAILABLE' }, 404);
    if (plan.plan_type === 'FREE') return c.json({ ok: false, error: 'FREE_PLAN_DOES_NOT_REQUIRE_CHECKOUT' }, 409);
    if (plan.plan_type !== 'SUBSCRIPTION' && plan.plan_type !== 'ONE_TIME') return c.json({ ok: false, error: 'PLAN_TYPE_NOT_PURCHASABLE' }, 409);
    if (Number(plan.price_twd ?? 0) <= 0) return c.json({ ok: false, error: 'PAID_PLAN_REQUIRES_POSITIVE_PRICE' }, 409);

    const inserted = await db.execute(sql`
      INSERT INTO worklog_checkout_intents (user_id, plan_code, request_key, status, created_at, updated_at)
      VALUES (${user.id}, ${planCode}, ${requestKey}, 'PENDING_PROVIDER', NOW(), NOW())
      ON CONFLICT (request_key) DO NOTHING
      RETURNING id::text AS id, user_id::text AS user_id, plan_code, status, checkout_url, created_at
    `);

    const resolved = inserted.rows[0] ?? (await db.execute(sql`
      SELECT id::text AS id, user_id::text AS user_id, plan_code, status, checkout_url, created_at
      FROM worklog_checkout_intents
      WHERE request_key = ${requestKey}
      LIMIT 1
    `)).rows[0];

    const intent = resolved as { id?: string; user_id?: string; plan_code?: string; status?: string; checkout_url?: string | null; created_at?: unknown } | undefined;
    if (!intent?.id) return c.json({ ok: false, error: 'CHECKOUT_INTENT_CREATE_FAILED' }, 500);
    if (Number(intent.user_id) !== user.id || intent.plan_code !== planCode) {
      return c.json({ ok: false, error: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }, 409);
    }

    return c.json({ ok: true, intent: { ...intent, checkoutEnabled: true, providerConfigured: true } }, inserted.rows.length > 0 ? 201 : 200);
  });

  return app;
}

async function userRow(db: ReturnType<typeof createDatabase>, userId: number): Promise<UserSubscriptionRow | null> {
  const result = await db.execute(sql`
    SELECT
      u.id::text AS id,
      COALESCE(subscription.plan_code, 'FREE') AS plan_code,
      CASE
        WHEN subscription.user_id IS NULL THEN 'NO_SUBSCRIPTION'
        WHEN subscription.status <> 'ACTIVE' THEN 'SUBSCRIPTION_INACTIVE'
        WHEN COALESCE(plan.enabled, FALSE) = FALSE THEN 'PLAN_DISABLED'
        WHEN subscription.effective_at > NOW() THEN 'NOT_YET_EFFECTIVE'
        WHEN subscription.current_period_start > NOW() THEN 'PERIOD_NOT_STARTED'
        WHEN subscription.current_period_end IS NOT NULL AND NOW() >= subscription.current_period_end THEN 'PERIOD_EXPIRED'
        ELSE 'ACTIVE'
      END AS effective_state
    FROM worklog_users u
    LEFT JOIN worklog_user_subscriptions subscription ON subscription.user_id = u.id
    LEFT JOIN worklog_subscription_plans plan ON plan.code = subscription.plan_code
    WHERE u.id = ${userId}
    LIMIT 1
  `);
  const row = result.rows[0] as { id?: string; plan_code?: string; effective_state?: UserSubscriptionRow['effectiveState'] } | undefined;
  if (!row?.id) return null;
  return {
    id: Number(row.id),
    planCode: row.plan_code ?? 'FREE',
    effectiveState: row.effective_state ?? 'NO_SUBSCRIPTION',
  };
}
