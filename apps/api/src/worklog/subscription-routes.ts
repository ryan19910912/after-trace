import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase } from '../db/client';
import { FREE_INITIAL_GRANT_ORIGIN_KEY } from './ai-points';

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

    const [plansResult, trialResult] = await Promise.all([
      db.execute(sql`
        SELECT
          plan.code,
          plan.plan_type,
          plan.display_name,
          plan.price_twd::text AS price_twd,
          plan.rank,
          CASE WHEN plan.code = 'AI_PRO' THEN plan.monthly_ai_point_cap ELSE NULL END AS monthly_ai_point_cap,
          CASE WHEN plan.code = 'AI_PRO' THEN plan.monthly_provider_cost_cap_twd::text ELSE NULL END AS monthly_provider_cost_cap_twd,
          CASE WHEN plan.code = 'AI_PRO' THEN plan.per_request_ai_point_cap ELSE NULL END AS per_request_ai_point_cap,
          COALESCE(plan.capabilities, '{}'::jsonb) AS capabilities,
          CASE
            WHEN ${user.effectiveState} = 'ACTIVE' AND ${user.planCode} = 'AI_PRO' AND plan.code = 'AI_PRO' THEN TRUE
            WHEN NOT (${user.effectiveState} = 'ACTIVE' AND ${user.planCode} = 'AI_PRO') AND plan.code = 'FREE' THEN TRUE
            ELSE FALSE
          END AS current
        FROM worklog_subscription_plans AS plan
        WHERE plan.enabled = TRUE
          AND (
            (plan.code = 'FREE' AND plan.plan_type = 'FREE' AND plan.price_twd = 0)
            OR
            (plan.code = 'AI_PRO' AND plan.plan_type = 'SUBSCRIPTION' AND plan.price_twd = 99 AND plan.ai_enabled = TRUE)
          )
        ORDER BY CASE plan.code WHEN 'FREE' THEN 0 ELSE 1 END
      `),
      db.execute(sql`
        SELECT g.original_points, g.remaining_points, g.status
        FROM worklog_ai_grants AS g
        WHERE g.owner_user_id = ${userId}
          AND g.type = 'FREE_INITIAL'
          AND g.origin_key = ${FREE_INITIAL_GRANT_ORIGIN_KEY}
        ORDER BY g.id ASC
        LIMIT 1
      `),
    ]);
    const trial = trialResult.rows[0] as { original_points?: unknown; remaining_points?: unknown; status?: unknown } | undefined;
    const trialRemaining = Number(trial?.remaining_points ?? 0);

    return c.json({
      ok: true,
      currentPlanCode: user.effectiveState === 'ACTIVE' && user.planCode === 'AI_PRO' ? 'AI_PRO' : 'FREE',
      currentSubscriptionState: user.effectiveState,
      checkoutEnabled: CHECKOUT_ENABLED,
      freeAiTrial: trial
        ? {
            status: trialRemaining > 0 ? 'AVAILABLE' : 'EXHAUSTED',
            originalPoints: Number(trial.original_points ?? 0),
            remainingPoints: Math.max(0, trialRemaining),
          }
        : { status: 'NOT_ISSUED', originalPoints: 0, remainingPoints: 0 },
      plans: plansResult.rows,
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
    if (planCode !== 'AI_PRO') return c.json({ ok: false, error: 'V1_ONLY_AI_PRO_IS_PURCHASABLE' }, 409);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(requestKey)) return c.json({ ok: false, error: 'INVALID_REQUEST_KEY' }, 400);

    const planResult = await db.execute(sql`
      SELECT code, plan_type, display_name, price_twd::text AS price_twd, enabled, ai_enabled
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO'
        AND plan_type = 'SUBSCRIPTION'
        AND price_twd = 99
      LIMIT 1
    `);
    const plan = planResult.rows[0] as { code?: string; plan_type?: string; display_name?: string; price_twd?: string; enabled?: boolean; ai_enabled?: boolean } | undefined;
    if (!plan?.code || !plan.enabled || !plan.ai_enabled) return c.json({ ok: false, error: 'PLAN_NOT_AVAILABLE' }, 404);

    const inserted = await db.execute(sql`
      INSERT INTO worklog_checkout_intents (user_id, plan_code, request_key, status, created_at, updated_at)
      VALUES (${user.id}, 'AI_PRO', ${requestKey}, 'PENDING_PROVIDER', NOW(), NOW())
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
    if (Number(intent.user_id) !== user.id || intent.plan_code !== 'AI_PRO') {
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
    FROM worklog_users AS u
    LEFT JOIN worklog_user_subscriptions AS subscription ON subscription.user_id = u.id
    LEFT JOIN worklog_subscription_plans AS plan ON plan.code = subscription.plan_code
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
