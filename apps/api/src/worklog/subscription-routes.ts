import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase } from '../db/client';
import { FREE_INITIAL_GRANT_ORIGIN_KEY } from './ai-points';

type Bindings = { DATABASE_URL: string; WEB_AUTH_SECRET?: string; WEB_APP_ORIGIN?: string };
type Env = { Bindings: Bindings; Variables: { session: WebSessionClaims } };

type UserSubscriptionRow = {
  id: number;
  planCode: string;
  currentPeriodEnd: string | null;
  effectiveState: 'NO_SUBSCRIPTION' | 'SUBSCRIPTION_INACTIVE' | 'PLAN_DISABLED' | 'NOT_YET_EFFECTIVE' | 'PERIOD_NOT_STARTED' | 'PERIOD_EXPIRED' | 'ACTIVE';
};

type NewebPayRenewalState = 'ACTIVE' | 'TERMINATED' | 'PENDING' | 'FAILED' | 'NONE';

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

    const activePlanCode = user.effectiveState === 'ACTIVE' ? user.planCode : 'FREE';
    const [plansResult, trialResult, paymentStateResult] = await Promise.all([
      db.execute(sql`
        SELECT
          plan.code,
          plan.plan_type,
          plan.display_name,
          plan.price_twd::text AS price_twd,
          plan.rank,
          plan.monthly_ai_point_cap,
          plan.monthly_provider_cost_cap_twd::text AS monthly_provider_cost_cap_twd,
          plan.per_request_ai_point_cap,
          COALESCE(plan.capabilities, '{}'::jsonb) AS capabilities,
          CASE WHEN plan.code = ${activePlanCode} THEN TRUE ELSE FALSE END AS current
        FROM worklog_subscription_plans AS plan
        WHERE plan.enabled = TRUE
          AND (
            (plan.plan_type = 'FREE' AND plan.code = 'FREE' AND plan.price_twd = 0)
            OR
            (plan.plan_type = 'SUBSCRIPTION' AND plan.price_twd > 0 AND plan.ai_enabled = TRUE)
          )
        ORDER BY CASE WHEN plan.plan_type = 'FREE' THEN 0 ELSE 1 END, plan.rank, plan.price_twd, plan.code
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
      db.execute(sql`
        SELECT status
        FROM worklog_newebpay_subscriptions
        WHERE user_id = ${userId}
        LIMIT 1
      `),
    ]);

    const trial = trialResult.rows[0] as { original_points?: unknown; remaining_points?: unknown; status?: unknown } | undefined;
    const trialRemaining = Number(trial?.remaining_points ?? 0);
    const paymentStatusRaw = String((paymentStateResult.rows[0] as { status?: unknown } | undefined)?.status ?? '').toUpperCase();
    const paymentRenewalState: NewebPayRenewalState = isNewebPayRenewalState(paymentStatusRaw) ? paymentStatusRaw : 'NONE';

    return c.json({
      ok: true,
      currentPlanCode: activePlanCode,
      currentSubscriptionState: user.effectiveState,
      currentPeriodEnd: user.currentPeriodEnd,
      paymentRenewalState,
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

  return app;
}

async function userRow(db: ReturnType<typeof createDatabase>, userId: number): Promise<UserSubscriptionRow | null> {
  const result = await db.execute(sql`
    SELECT
      u.id::text AS id,
      COALESCE(subscription.plan_code, 'FREE') AS plan_code,
      subscription.current_period_end,
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
  const row = result.rows[0] as { id?: string; plan_code?: string; current_period_end?: Date | string | null; effective_state?: UserSubscriptionRow['effectiveState'] } | undefined;
  if (!row?.id) return null;
  return {
    id: Number(row.id),
    planCode: row.plan_code ?? 'FREE',
    currentPeriodEnd: isoDateOrNull(row.current_period_end),
    effectiveState: row.effective_state ?? 'NO_SUBSCRIPTION',
  };
}

function isoDateOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isNewebPayRenewalState(value: string): value is Exclude<NewebPayRenewalState, 'NONE'> {
  return value === 'ACTIVE' || value === 'TERMINATED' || value === 'PENDING' || value === 'FAILED';
}
