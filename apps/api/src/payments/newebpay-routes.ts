import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { DrizzleSubscriptionLifecycleRepository } from '../worklog/drizzle-subscription-lifecycle';
import { SubscriptionLifecycleService } from '../worklog/subscription-lifecycle';
import { SubscriptionLifecycleNotificationAdapter } from '../worklog/subscription-lifecycle-notifications';
import {
  buildAlterStatusRequest,
  buildPeriodicCheckout,
  callbackSuccess,
  nextMonthlyPeriod,
  parseAlterStatusResponse,
  parseNewebPayTaipeiDate,
  parsePeriodicCallback,
  providerString,
  validatePeriodicConfig,
  type NewebPayPeriodicConfig,
} from './newebpay-periodic';

export type NewebPayBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  NEWEBPAY_MERCHANT_ID?: string;
  NEWEBPAY_HASH_KEY?: string;
  NEWEBPAY_HASH_IV?: string;
  NEWEBPAY_MODE?: string;
  NEWEBPAY_PERIOD_VERSION?: string;
  NEWEBPAY_PERIOD_TIMES?: string;
  NEWEBPAY_NOTIFY_URL?: string;
  NEWEBPAY_RETURN_URL?: string;
};

type Env = { Bindings: NewebPayBindings; Variables: { userId: number; database: Database } };
type AdapterRow = {
  user_id?: unknown;
  status?: unknown;
  period_no?: unknown;
  merchant_order_no?: unknown;
  current_period_start?: unknown;
  current_period_end?: unknown;
  checkout_intent_id?: unknown;
};

export function createNewebPayRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.path === '/notify' || c.req.path === '/return') { await next(); return; }
    const origin = c.req.header('origin');
    const allowed = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    if (origin && allowed === origin) { c.header('Access-Control-Allow-Origin', origin); c.header('Vary', 'Origin'); }
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

  app.get('/availability', (c) => c.json({ ok: true, provider: 'NEWEBPAY', available: Boolean(configOrNull(c.env)) }));
  app.post('/return', (c) => paymentReturnRedirect(c.env));
  app.get('/return', (c) => paymentReturnRedirect(c.env));

  app.post('/checkout', async (c) => {
    const auth = await authenticatedContext(c.env, c.req.header('authorization'));
    if ('error' in auth) return c.json({ ok: false, error: auth.error }, auth.status);
    const config = configOrNull(c.env);
    if (!config) return c.json({ ok: false, error: 'NEWEBPAY_NOT_CONFIGURED' }, 503);

    const plan = await auth.database.execute(sql`
      SELECT 1
      FROM worklog_subscription_plans
      WHERE code = 'AI_PRO'
        AND plan_type = 'SUBSCRIPTION'
        AND price_twd = 99
        AND enabled = TRUE
        AND ai_enabled = TRUE
        AND monthly_ai_point_cap IS NOT NULL
        AND monthly_ai_point_cap > 0
        AND monthly_provider_cost_cap_twd IS NOT NULL
        AND monthly_provider_cost_cap_twd > 0
      LIMIT 1
    `);
    if (!plan.rows[0]) return c.json({ ok: false, error: 'AI_PRO_PLAN_NOT_AVAILABLE' }, 409);

    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const requestKey = typeof body.requestKey === 'string' ? body.requestKey.trim() : '';
    const payerEmail = typeof body.payerEmail === 'string' ? body.payerEmail.trim() : '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(requestKey)) return c.json({ ok: false, error: 'INVALID_REQUEST_KEY' }, 400);

    const active = await auth.database.execute(sql`
      SELECT 1 FROM worklog_user_subscriptions
      WHERE user_id = ${auth.userId} AND plan_code = 'AI_PRO' AND status = 'ACTIVE'
        AND current_period_start <= NOW() AND current_period_end > NOW()
      LIMIT 1
    `);
    if (active.rows[0]) return c.json({ ok: false, error: 'AI_PRO_ALREADY_ACTIVE' }, 409);

    const expiredResult = await auth.database.execute(sql`
      SELECT n.merchant_order_no, n.checkout_intent_id::text AS checkout_intent_id
      FROM worklog_newebpay_subscriptions AS n
      INNER JOIN worklog_checkout_intents AS i ON i.id = n.checkout_intent_id
      WHERE n.user_id = ${auth.userId}
        AND n.status = 'PENDING'
        AND i.status = 'READY'
        AND i.expires_at IS NOT NULL
        AND i.expires_at <= NOW()
      LIMIT 1
    `);
    const expired = expiredResult.rows[0] as { merchant_order_no?: unknown; checkout_intent_id?: unknown } | undefined;
    if (expired && typeof expired.merchant_order_no === 'string') {
      await auth.database.execute(sql`
        UPDATE worklog_checkout_intents SET status='FAILED', updated_at=NOW()
        WHERE id=${Number(expired.checkout_intent_id)} AND status='READY'
      `);
      await auth.database.execute(sql`
        UPDATE worklog_newebpay_subscription_history SET status='FAILED', updated_at=NOW()
        WHERE merchant_order_no=${expired.merchant_order_no} AND status='PENDING'
      `);
      await auth.database.execute(sql`
        UPDATE worklog_newebpay_subscriptions SET status='FAILED', updated_at=NOW()
        WHERE user_id=${auth.userId} AND merchant_order_no=${expired.merchant_order_no} AND status='PENDING'
      `);
    }

    const pendingResult = await auth.database.execute(sql`
      SELECT i.request_key, i.provider_checkout_id, i.id::text AS checkout_intent_id
      FROM worklog_newebpay_subscriptions AS n
      INNER JOIN worklog_checkout_intents AS i ON i.id = n.checkout_intent_id
      WHERE n.user_id = ${auth.userId}
        AND n.status = 'PENDING'
        AND i.status = 'READY'
        AND i.expires_at > NOW()
      LIMIT 1
    `);
    let pending = pendingResult.rows[0] as { request_key?: unknown; provider_checkout_id?: unknown; checkout_intent_id?: unknown } | undefined;
    if (pending && pending.request_key !== requestKey && typeof pending.provider_checkout_id === 'string') {
      await auth.database.execute(sql`
        UPDATE worklog_checkout_intents SET status='FAILED', updated_at=NOW()
        WHERE id=${Number(pending.checkout_intent_id)} AND status='READY'
      `);
      await auth.database.execute(sql`
        UPDATE worklog_newebpay_subscription_history SET status='SUPERSEDED', updated_at=NOW()
        WHERE merchant_order_no=${pending.provider_checkout_id} AND status='PENDING'
      `);
      await auth.database.execute(sql`
        UPDATE worklog_newebpay_subscriptions SET status='FAILED', updated_at=NOW()
        WHERE user_id=${auth.userId} AND merchant_order_no=${pending.provider_checkout_id} AND status='PENDING'
      `);
      pending = undefined;
    }

    const merchantOrderNo = await merchantOrderNumber(requestKey);
    if (pending && pending.provider_checkout_id !== merchantOrderNo) {
      return c.json({ ok: false, error: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }, 409);
    }

    let checkout;
    try { checkout = await buildPeriodicCheckout({ config, merchantOrderNo, payerEmail }); }
    catch (error) { return c.json({ ok: false, error: errorCode(error, 'NEWEBPAY_CHECKOUT_INVALID') }, 400); }

    const inserted = await auth.database.execute(sql`
      INSERT INTO worklog_checkout_intents (
        user_id, plan_code, payer_email, request_key, status, provider, provider_checkout_id, checkout_url, expires_at, created_at, updated_at
      ) VALUES (
        ${auth.userId}, 'AI_PRO', ${payerEmail || null}, ${requestKey}, 'READY', 'NEWEBPAY', ${merchantOrderNo}, ${checkout.action},
        NOW() + INTERVAL '30 minutes', NOW(), NOW()
      )
      ON CONFLICT (request_key) DO NOTHING
      RETURNING id::text AS id, user_id::text AS user_id, provider_checkout_id, status
    `);
    const intent = inserted.rows[0] ?? (await auth.database.execute(sql`
      SELECT id::text AS id, user_id::text AS user_id, provider_checkout_id, status
      FROM worklog_checkout_intents WHERE request_key = ${requestKey} LIMIT 1
    `)).rows[0] as Record<string, unknown> | undefined;
    if (!intent || Number(intent.user_id) !== auth.userId || intent.provider_checkout_id !== merchantOrderNo) {
      return c.json({ ok: false, error: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }, 409);
    }

    const historyWrite = await auth.database.execute(sql`
      INSERT INTO worklog_newebpay_subscription_history (
        user_id, checkout_intent_id, merchant_order_no, status, metadata, created_at, updated_at
      ) VALUES (
        ${auth.userId}, ${Number(intent.id)}, ${merchantOrderNo}, 'PENDING', ${JSON.stringify({ requestKey })}::jsonb, NOW(), NOW()
      )
      ON CONFLICT (merchant_order_no) DO UPDATE
      SET checkout_intent_id=EXCLUDED.checkout_intent_id, updated_at=NOW()
      WHERE worklog_newebpay_subscription_history.user_id=EXCLUDED.user_id
      RETURNING user_id
    `);
    if (!historyWrite.rows[0]) return c.json({ ok: false, error: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }, 409);

    const adapterWrite = await auth.database.execute(sql`
      INSERT INTO worklog_newebpay_subscriptions (
        user_id, checkout_intent_id, merchant_order_no, status, metadata, created_at, updated_at
      ) VALUES (
        ${auth.userId}, ${Number(intent.id)}, ${merchantOrderNo}, 'PENDING', ${JSON.stringify({ requestKey })}::jsonb, NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET checkout_intent_id=EXCLUDED.checkout_intent_id,
          merchant_order_no=EXCLUDED.merchant_order_no,
          period_no=NULL,
          status='PENDING',
          current_period_start=NULL,
          current_period_end=NULL,
          last_provider_event_key=NULL,
          metadata=EXCLUDED.metadata,
          updated_at=NOW()
      WHERE worklog_newebpay_subscriptions.status IN ('FAILED','TERMINATED')
         OR (worklog_newebpay_subscriptions.status='PENDING' AND worklog_newebpay_subscriptions.merchant_order_no=EXCLUDED.merchant_order_no)
      RETURNING user_id
    `);
    if (!adapterWrite.rows[0]) return c.json({ ok: false, error: 'NEWEBPAY_ADAPTER_STATE_CONFLICT' }, 409);

    return c.json({ ok: true, provider: 'NEWEBPAY', form: checkout, amountTwd: 99, planCode: 'AI_PRO' }, inserted.rows[0] ? 201 : 200);
  });

  app.post('/notify', async (c) => {
    let rawBody: string;
    try { rawBody = await c.req.text(); }
    catch { return c.text('INVALID', 400); }
    const config = configOrNull(c.env);
    if (!config) return c.text('CONFIG_ERROR', 503);
    const encrypted = periodPayloadFromRaw(rawBody, c.req.header('content-type') ?? '');
    if (!encrypted) return c.text('INVALID', 400);

    let callback;
    try { callback = await parsePeriodicCallback({ encryptedPeriod: encrypted, config }); }
    catch { return c.text('INVALID', 400); }

    const result = callback.result;
    const merchantOrderNo = providerString(result, 'MerchantOrderNo', 'MerOrderNo');
    if (!merchantOrderNo) return c.text('INVALID', 400);

    const database = createDatabase(c.env.DATABASE_URL);
    const currentByOrderResult = await database.execute(sql`
      SELECT user_id::text AS user_id, status, period_no, merchant_order_no,
             current_period_start, current_period_end, checkout_intent_id::text AS checkout_intent_id
      FROM worklog_newebpay_subscriptions WHERE merchant_order_no=${merchantOrderNo} LIMIT 1
    `);
    const currentByOrder = currentByOrderResult.rows[0] as AdapterRow | undefined;
    const historyResult = await database.execute(sql`
      SELECT user_id::text AS user_id, status, period_no, merchant_order_no,
             current_period_start, current_period_end, checkout_intent_id::text AS checkout_intent_id
      FROM worklog_newebpay_subscription_history WHERE merchant_order_no=${merchantOrderNo} LIMIT 1
    `);
    let history = historyResult.rows[0] as AdapterRow | undefined;

    if (!history && currentByOrder) {
      await database.execute(sql`
        INSERT INTO worklog_newebpay_subscription_history (
          user_id, checkout_intent_id, merchant_order_no, period_no, status,
          current_period_start, current_period_end, metadata, created_at, updated_at
        ) VALUES (
          ${Number(currentByOrder.user_id)}, ${Number(currentByOrder.checkout_intent_id)}, ${merchantOrderNo},
          ${typeof currentByOrder.period_no === 'string' ? currentByOrder.period_no : null},
          ${String(currentByOrder.status ?? 'PENDING')}, ${dateValue(currentByOrder.current_period_start)},
          ${dateValue(currentByOrder.current_period_end)}, '{}'::jsonb, NOW(), NOW()
        ) ON CONFLICT (merchant_order_no) DO NOTHING
      `);
      history = currentByOrder;
    }
    if (!history) return c.text('OK');

    const userId = Number(history.user_id);
    const checkoutIntentId = Number(history.checkout_intent_id);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(checkoutIntentId) || checkoutIntentId <= 0) return c.text('OK');

    const respondCode = providerString(result, 'RespondCode', 'respondCode');
    if (!callbackSuccess(callback) || respondCode !== '00') {
      await database.execute(sql`
        UPDATE worklog_checkout_intents SET status=CASE WHEN status='COMPLETED' THEN status ELSE 'FAILED' END, updated_at=NOW()
        WHERE id=${checkoutIntentId}
      `);
      await database.execute(sql`
        UPDATE worklog_newebpay_subscription_history
        SET status='FAILED', provider_status=${callback.status}, respond_code=${respondCode}, updated_at=NOW()
        WHERE merchant_order_no=${merchantOrderNo} AND status <> 'ACTIVE'
      `);
      await database.execute(sql`
        UPDATE worklog_newebpay_subscriptions SET status='FAILED', updated_at=NOW()
        WHERE user_id=${userId} AND merchant_order_no=${merchantOrderNo} AND status='PENDING'
      `);
      return c.text('OK');
    }

    const periodNo = providerString(result, 'PeriodNo');
    const authDateRaw = providerString(result, 'AuthDate', 'AuthTime');
    const periodStart = parseNewebPayTaipeiDate(authDateRaw);
    const tradeNo = providerString(result, 'TradeNo', 'OrderNo');
    const authAmount = providerInteger(result, 'AuthAmt', 'PeriodAmt');
    const totalTimes = providerInteger(result, 'TotalTimes');
    const alreadyTimes = providerInteger(result, 'AlreadyTimes', 'AuthTimes');
    const nextAuthRaw = providerString(result, 'NextAuthDate');
    const nextAuth = parseNewebPayTaipeiDate(nextAuthRaw);

    const commercialMismatch = authAmount !== 99
      || (totalTimes !== null && totalTimes !== config.periodTimes)
      || (alreadyTimes !== null && (alreadyTimes < 1 || (totalTimes !== null && alreadyTimes > totalTimes)));
    if (!periodNo || !periodStart || !tradeNo || commercialMismatch) {
      await database.execute(sql`
        UPDATE worklog_newebpay_subscription_history
        SET status='PAID_CONFLICT', period_no=${periodNo}, provider_status=${callback.status}, respond_code=${respondCode},
            auth_amount=${authAmount}, total_times=${totalTimes}, already_times=${alreadyTimes}, trade_no=${tradeNo},
            auth_date=${periodStart}, next_auth_date=${nextAuth}, updated_at=NOW()
        WHERE merchant_order_no=${merchantOrderNo}
      `);
      await database.execute(sql`UPDATE worklog_checkout_intents SET status='COMPLETED', updated_at=NOW() WHERE id=${checkoutIntentId}`);
      return c.text('OK');
    }

    const periodEnd = nextAuth && nextAuth.getTime() > periodStart.getTime() ? nextAuth : nextMonthlyPeriod(periodStart);
    const externalEventKey = `period:${periodNo}:${tradeNo}`.slice(0, 255);

    const currentResult = await database.execute(sql`
      SELECT user_id::text AS user_id, merchant_order_no, status, checkout_intent_id::text AS checkout_intent_id,
             current_period_start, current_period_end
      FROM worklog_newebpay_subscriptions WHERE user_id=${userId} LIMIT 1
    `);
    const current = currentResult.rows[0] as AdapterRow | undefined;
    if (current?.status === 'ACTIVE' && current.merchant_order_no !== merchantOrderNo) {
      await database.execute(sql`
        UPDATE worklog_newebpay_subscription_history
        SET status='PAID_CONFLICT', period_no=${periodNo}, provider_status=${callback.status}, respond_code=${respondCode},
            auth_amount=${authAmount}, total_times=${totalTimes}, already_times=${alreadyTimes}, trade_no=${tradeNo},
            auth_date=${periodStart}, next_auth_date=${nextAuth}, current_period_start=${periodStart}, current_period_end=${periodEnd},
            last_provider_event_key=${externalEventKey}, updated_at=NOW()
        WHERE merchant_order_no=${merchantOrderNo}
      `);
      await database.execute(sql`UPDATE worklog_checkout_intents SET status='COMPLETED', updated_at=NOW() WHERE id=${checkoutIntentId}`);
      return c.text('OK');
    }

    if (current?.status === 'PENDING' && current.merchant_order_no !== merchantOrderNo) {
      const currentCheckoutId = Number(current.checkout_intent_id);
      if (Number.isSafeInteger(currentCheckoutId) && currentCheckoutId > 0) {
        await database.execute(sql`UPDATE worklog_checkout_intents SET status='FAILED', updated_at=NOW() WHERE id=${currentCheckoutId} AND status='READY'`);
      }
      if (typeof current.merchant_order_no === 'string') {
        await database.execute(sql`
          UPDATE worklog_newebpay_subscription_history SET status='SUPERSEDED', updated_at=NOW()
          WHERE merchant_order_no=${current.merchant_order_no} AND status='PENDING'
        `);
      }
    }

    const coreActive = await database.execute(sql`
      SELECT 1 FROM worklog_user_subscriptions
      WHERE user_id=${userId} AND plan_code='AI_PRO' AND status='ACTIVE'
        AND current_period_start <= NOW() AND current_period_end > NOW()
      LIMIT 1
    `);
    const lifecycle = new SubscriptionLifecycleService(
      new DrizzleSubscriptionLifecycleRepository(database),
      new SubscriptionLifecycleNotificationAdapter(database),
    );
    let lifecycleResult: Awaited<ReturnType<SubscriptionLifecycleService['apply']>>;
    try {
      lifecycleResult = await lifecycle.apply({
        provider: 'NEWEBPAY', externalEventKey,
        type: coreActive.rows[0] ? 'RENEW' : 'ACTIVATE',
        userId, planCode: 'AI_PRO', occurredAt: periodStart, periodStart, periodEnd,
        metadata: boundedMetadata({ merchantOrderNo, periodNo, tradeNo, authAmount, totalTimes, alreadyTimes, status: callback.status }),
      });
    } catch {
      return c.text('RETRY', 500);
    }

    if (lifecycleResult.status === 'IGNORED_STALE' || (lifecycleResult.status === 'DUPLICATE' && !lifecycleResult.applied)) return c.text('OK');

    await database.execute(sql`
      INSERT INTO worklog_newebpay_subscriptions (
        user_id, checkout_intent_id, merchant_order_no, period_no, status,
        current_period_start, current_period_end, last_provider_event_key, metadata, created_at, updated_at
      ) VALUES (
        ${userId}, ${checkoutIntentId}, ${merchantOrderNo}, ${periodNo}, 'ACTIVE',
        ${periodStart}, ${periodEnd}, ${externalEventKey},
        ${JSON.stringify(boundedMetadata({ merchantOrderNo, periodNo, tradeNo, authAmount, totalTimes, alreadyTimes }))}::jsonb,
        NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET checkout_intent_id=EXCLUDED.checkout_intent_id,
          merchant_order_no=EXCLUDED.merchant_order_no,
          period_no=EXCLUDED.period_no,
          status='ACTIVE',
          current_period_start=EXCLUDED.current_period_start,
          current_period_end=EXCLUDED.current_period_end,
          last_provider_event_key=EXCLUDED.last_provider_event_key,
          metadata=EXCLUDED.metadata,
          updated_at=NOW()
    `);
    await database.execute(sql`
      UPDATE worklog_newebpay_subscription_history
      SET status='ACTIVE', period_no=${periodNo}, provider_status=${callback.status}, respond_code=${respondCode},
          auth_amount=${authAmount}, total_times=${totalTimes}, already_times=${alreadyTimes}, trade_no=${tradeNo},
          auth_date=${periodStart}, next_auth_date=${nextAuth}, current_period_start=${periodStart}, current_period_end=${periodEnd},
          last_provider_event_key=${externalEventKey},
          metadata=${JSON.stringify(boundedMetadata({ merchantOrderNo, periodNo, tradeNo, authAmount, totalTimes, alreadyTimes }))}::jsonb,
          updated_at=NOW()
      WHERE merchant_order_no=${merchantOrderNo}
    `);
    await database.execute(sql`UPDATE worklog_checkout_intents SET status='COMPLETED', updated_at=NOW() WHERE id=${checkoutIntentId}`);
    return c.text('OK');
  });

  app.post('/cancel', async (c) => {
    const auth = await authenticatedContext(c.env, c.req.header('authorization'));
    if ('error' in auth) return c.json({ ok: false, error: auth.error }, auth.status);
    const config = configOrNull(c.env);
    if (!config) return c.json({ ok: false, error: 'NEWEBPAY_NOT_CONFIGURED' }, 503);
    const result = await auth.database.execute(sql`
      SELECT merchant_order_no, period_no, status, current_period_start, current_period_end
      FROM worklog_newebpay_subscriptions WHERE user_id=${auth.userId} LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row.status !== 'ACTIVE' || typeof row.period_no !== 'string' || typeof row.merchant_order_no !== 'string') {
      return c.json({ ok: false, error: 'NEWEBPAY_ACTIVE_PERIOD_NOT_FOUND' }, 404);
    }

    const request = await buildAlterStatusRequest({ config, merchantOrderNo: row.merchant_order_no, periodNo: row.period_no, alterType: 'terminate' });
    let providerResponse: Response;
    try {
      providerResponse = await fetch(request.action, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(request.fields),
      });
    } catch { return c.json({ ok: false, error: 'NEWEBPAY_CANCEL_NETWORK_ERROR' }, 502); }
    const responseText = await providerResponse.text();
    if (!providerResponse.ok) return c.json({ ok: false, error: 'NEWEBPAY_CANCEL_FAILED' }, 502);
    let parsed;
    try { parsed = await parseAlterStatusResponse({ responseText, config }); }
    catch { return c.json({ ok: false, error: 'NEWEBPAY_CANCEL_RESPONSE_INVALID' }, 502); }
    if (!callbackSuccess(parsed)) return c.json({ ok: false, error: 'NEWEBPAY_CANCEL_REJECTED', message: parsed.message }, 409);

    const periodStart = dateValue(row.current_period_start);
    const periodEnd = dateValue(row.current_period_end);
    if (!periodStart || !periodEnd) return c.json({ ok: false, error: 'NEWEBPAY_PERIOD_STATE_INVALID' }, 409);
    const lifecycle = new SubscriptionLifecycleService(
      new DrizzleSubscriptionLifecycleRepository(auth.database),
      new SubscriptionLifecycleNotificationAdapter(auth.database),
    );
    await lifecycle.apply({
      provider: 'NEWEBPAY', externalEventKey: `terminate:${row.period_no}:${periodEnd.toISOString()}`,
      type: 'CANCEL', userId: auth.userId, planCode: 'AI_PRO', occurredAt: new Date(), periodStart, periodEnd,
      metadata: { merchantOrderNo: row.merchant_order_no, periodNo: row.period_no, providerStatus: parsed.status },
    });
    await auth.database.execute(sql`UPDATE worklog_newebpay_subscriptions SET status='TERMINATED', updated_at=NOW() WHERE user_id=${auth.userId}`);
    await auth.database.execute(sql`
      UPDATE worklog_newebpay_subscription_history SET status='TERMINATED', provider_status=${parsed.status}, updated_at=NOW()
      WHERE merchant_order_no=${row.merchant_order_no}
    `);
    return c.json({ ok: true, status: 'CANCELLED_AT_PERIOD_END', periodEnd: periodEnd.toISOString() });
  });

  return app;
}

function paymentReturnRedirect(env: NewebPayBindings): Response {
  const raw = env.WEB_APP_URL?.trim() || env.WEB_APP_ORIGIN?.trim();
  if (!raw) return Response.json({ ok: false, error: 'WEB_APP_URL_NOT_CONFIGURED' }, { status: 503 });
  try { return Response.redirect(`${new URL(raw).origin}/subscription?payment=returned`, 303); }
  catch { return Response.json({ ok: false, error: 'WEB_APP_URL_INVALID' }, { status: 503 }); }
}

function configOrNull(env: NewebPayBindings): NewebPayPeriodicConfig | null {
  const merchantId = env.NEWEBPAY_MERCHANT_ID?.trim();
  const hashKey = env.NEWEBPAY_HASH_KEY;
  const hashIv = env.NEWEBPAY_HASH_IV;
  const notifyUrl = env.NEWEBPAY_NOTIFY_URL?.trim();
  const returnUrl = env.NEWEBPAY_RETURN_URL?.trim();
  if (!merchantId || !hashKey || !hashIv || !notifyUrl || !returnUrl) return null;
  const rawMode = env.NEWEBPAY_MODE?.trim().toUpperCase() || 'TEST';
  if (rawMode !== 'TEST' && rawMode !== 'PROD') return null;
  const candidate: NewebPayPeriodicConfig = {
    merchantId, hashKey, hashIv, mode: rawMode,
    version: env.NEWEBPAY_PERIOD_VERSION?.trim() || '1.5',
    periodTimes: Number(env.NEWEBPAY_PERIOD_TIMES ?? '99'), notifyUrl, returnUrl,
  };
  try { return validatePeriodicConfig(candidate); } catch { return null; }
}

async function authenticatedContext(env: NewebPayBindings, header: string | undefined): Promise<{ userId: number; database: Database } | { error: string; status: 401 | 404 | 503 }> {
  const secret = env.WEB_AUTH_SECRET?.trim() ?? '';
  if (secret.length < 32) return { error: 'WEB_AUTH_NOT_CONFIGURED', status: 503 };
  const match = /^Bearer\s+(.+)$/i.exec((header ?? '').trim());
  if (!match) return { error: 'WEB_SESSION_REQUIRED', status: 401 };
  const session = await verifyWebSessionToken(match[1], secret);
  if (!session) return { error: 'INVALID_WEB_SESSION', status: 401 };
  const database = createDatabase(env.DATABASE_URL);
  const userId = await resolveWebSessionUserId(database, session);
  if (!userId) return { error: 'WORKLOG_USER_NOT_FOUND', status: 404 };
  return { userId, database };
}

async function merchantOrderNumber(requestKey: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestKey)));
  return `AT${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 28)}`;
}
async function jsonBody(c: { req: { json(): Promise<unknown> } }) {
  try { const value = await c.req.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}
function errorCode(error: unknown, fallback: string) { return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : fallback; }
function periodPayloadFromRaw(rawBody: string, contentType: string): string {
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? '';
    if (!boundary) return '';
    for (const part of rawBody.split(`--${boundary}`)) {
      if (!/name="(?:Period|period)"/i.test(part)) continue;
      const separator = part.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
      const bodyIndex = part.indexOf(separator);
      if (bodyIndex < 0) continue;
      const value = part.slice(bodyIndex + separator.length).replace(/\r?\n--?\s*$/, '').trim();
      if (/^[0-9a-f]+$/i.test(value)) return value;
    }
    return '';
  }
  const form = new URLSearchParams(rawBody);
  return form.get('Period')?.trim() ?? form.get('period')?.trim() ?? '';
}
function providerInteger(result: Record<string, unknown>, ...names: string[]): number | null {
  const raw = providerString(result, ...names);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
function dateValue(value: unknown) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
function boundedMetadata(value: Record<string, unknown>) {
  const encoded = JSON.stringify(value);
  return encoded.length <= 8000 ? value : { truncated: true };
}
