import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from './db/client';
import { webPushRuntimeConfigured } from './worklog/push-runtime';

export type TargetReadinessBindings = {
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  WEB_AUTH_SECRET?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GOOGLE_LOGIN_CLIENT_ID?: string;
  GOOGLE_LOGIN_CLIENT_SECRET?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_WEB_ORIGIN?: string;
  WEB_PUSH_PUBLIC_KEY?: string;
  WEB_PUSH_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
};

/** V1 target readiness. Retired LINE webhook/group/funding schema is intentionally not required. */
export async function targetReadinessResponse(env: TargetReadinessBindings): Promise<Response> {
  const missing = targetConfigErrors(env);
  if (missing.length > 0) {
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'RUNTIME_CONFIG_INCOMPLETE', missing }, { status: 503 });
  }

  let database: Database;
  try {
    database = createDatabase(env.DATABASE_URL);
    await database.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM worklog_users WHERE FALSE) AS users_probe,
        (SELECT COUNT(*) FROM worklog_auth_identities WHERE FALSE) AS identities_probe,
        (SELECT COUNT(*) FROM worklog_user_public_accounts WHERE FALSE) AS public_accounts_probe,
        (SELECT COUNT(*) FROM worklog_source_invites WHERE FALSE) AS invites_probe,
        (SELECT COUNT(*) FROM worklog_source_members WHERE FALSE) AS members_probe,
        (SELECT COUNT(occurred_at) FROM worklog_records WHERE FALSE) AS records_probe,
        (SELECT COUNT(*) FROM worklog_record_revisions WHERE FALSE) AS revisions_probe,
        (SELECT COUNT(*) FROM worklog_commercial_config WHERE FALSE) AS commercial_config_probe,
        (SELECT COUNT(provider_cost_committed_twd) FROM worklog_ai_grants WHERE FALSE) AS grant_cost_probe,
        (SELECT COUNT(provider_cost_hold_twd) FROM worklog_ai_point_reservations WHERE FALSE) AS reservation_cost_probe,
        (SELECT COUNT(*) FROM worklog_notifications WHERE FALSE) AS notifications_probe,
        (SELECT COUNT(*) FROM worklog_notification_recipients WHERE FALSE) AS recipients_probe,
        (SELECT COUNT(*) FROM worklog_push_subscriptions WHERE FALSE) AS push_probe,
        (SELECT COUNT(*) FROM worklog_notification_preferences WHERE FALSE) AS notification_preferences_probe,
        (SELECT COUNT(*) FROM worklog_tasks WHERE FALSE) AS tasks_probe,
        (SELECT COUNT(*) FROM worklog_checkout_intents WHERE FALSE) AS checkout_probe,
        (SELECT COUNT(*) FROM worklog_subscription_lifecycle_events WHERE FALSE) AS lifecycle_probe,
        (SELECT COUNT(*) FROM worklog_feedback WHERE FALSE) AS feedback_probe,
        (SELECT COUNT(*) FROM worklog_feedback_management WHERE FALSE) AS feedback_management_probe,
        (SELECT COUNT(*) FROM worklog_newebpay_subscriptions WHERE FALSE) AS newebpay_probe
    `);
  } catch (error) {
    console.error('WORKLOG_TARGET_READINESS_SCHEMA_PROBE_FAILED', error);
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'WORKLOG_TARGET_SCHEMA_UNAVAILABLE' }, { status: 503 });
  }

  try {
    const runtime = await database.execute(sql`
      SELECT provider, model, output_usd_per_million, usd_twd_rate
      FROM worklog_ai_runtime_config WHERE id = 1 LIMIT 1
    `);
    const row = runtime.rows[0] as Record<string, unknown> | undefined;
    const provider = typeof row?.provider === 'string' ? row.provider.trim().toUpperCase() : '';
    const model = typeof row?.model === 'string' ? row.model.trim() : '';
    const outputPrice = Number(row?.output_usd_per_million ?? 0);
    const fx = Number(row?.usd_twd_rate ?? 0);
    if (provider !== 'GOOGLE' || !model || !Number.isFinite(outputPrice) || outputPrice <= 0 || !Number.isFinite(fx) || fx <= 0) {
      return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'AI_RUNTIME_CONFIG_NOT_INITIALIZED' }, { status: 503 });
    }
  } catch {
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'AI_RUNTIME_CONFIG_NOT_INITIALIZED' }, { status: 503 });
  }

  try {
    const result = await database.execute(sql`
      SELECT code, plan_type, price_twd, enabled, ai_enabled,
             monthly_ai_point_cap, monthly_provider_cost_cap_twd
      FROM worklog_subscription_plans
      WHERE code IN ('FREE','AI_PRO')
    `);
    const rows = result.rows as Record<string, unknown>[];
    const free = rows.find((row) => row.code === 'FREE');
    const pro = rows.find((row) => row.code === 'AI_PRO');
    if (!free || free.plan_type !== 'FREE' || Number(free.price_twd) !== 0 || free.enabled !== true) {
      return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'FREE_PLAN_NOT_INITIALIZED' }, { status: 503 });
    }
    if (!pro || pro.plan_type !== 'SUBSCRIPTION' || Number(pro.price_twd) !== 99 || pro.enabled !== true || pro.ai_enabled !== true
      || Number(pro.monthly_ai_point_cap) <= 0 || Number(pro.monthly_provider_cost_cap_twd) <= 0) {
      return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'AI_PRO_PLAN_NOT_INITIALIZED' }, { status: 503 });
    }
    const trial = await database.execute(sql`SELECT free_initial_ai_trial_points FROM worklog_commercial_config WHERE id = 1 LIMIT 1`);
    if (Number((trial.rows[0] as Record<string, unknown> | undefined)?.free_initial_ai_trial_points ?? 0) <= 0) {
      return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED' }, { status: 503 });
    }
  } catch {
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'COMMERCIAL_CONFIG_NOT_INITIALIZED' }, { status: 503 });
  }

  if (!webPushRuntimeConfigured(env)) {
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'WEB_PUSH_CONFIG_INVALID' }, { status: 503 });
  }

  return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'ready' });
}

function targetConfigErrors(env: TargetReadinessBindings): string[] {
  const missing: string[] = [];
  if (!required(env.DATABASE_URL)) missing.push('DATABASE_URL');
  if (!required(env.GEMINI_API_KEY)) missing.push('GEMINI_API_KEY');
  const webUrl = exactOrigin(env.WEB_APP_URL);
  const webOrigin = exactOrigin(env.WEB_APP_ORIGIN);
  if (!webUrl) missing.push('WEB_APP_URL');
  if (!webOrigin) missing.push('WEB_APP_ORIGIN');
  if (webUrl && webOrigin && webUrl !== webOrigin) missing.push('WEB_APP_URL', 'WEB_APP_ORIGIN');
  if (!secret(env.WEB_AUTH_SECRET)) missing.push('WEB_AUTH_SECRET');
  if (!required(env.LINE_LOGIN_CHANNEL_ID)) missing.push('LINE_LOGIN_CHANNEL_ID');
  if (!required(env.LINE_LOGIN_CHANNEL_SECRET)) missing.push('LINE_LOGIN_CHANNEL_SECRET');
  if (!required(env.GOOGLE_LOGIN_CLIENT_ID)) missing.push('GOOGLE_LOGIN_CLIENT_ID');
  if (!required(env.GOOGLE_LOGIN_CLIENT_SECRET)) missing.push('GOOGLE_LOGIN_CLIENT_SECRET');
  if (!required(env.ADMIN_USERNAME)) missing.push('ADMIN_USERNAME');
  if (!adminPassword(env.ADMIN_PASSWORD)) missing.push('ADMIN_PASSWORD');
  if (!secret(env.ADMIN_SESSION_SECRET)) missing.push('ADMIN_SESSION_SECRET');
  if (!exactOrigin(env.ADMIN_WEB_ORIGIN)) missing.push('ADMIN_WEB_ORIGIN');
  if (!required(env.WEB_PUSH_PUBLIC_KEY)) missing.push('WEB_PUSH_PUBLIC_KEY');
  if (!required(env.WEB_PUSH_PRIVATE_KEY)) missing.push('WEB_PUSH_PRIVATE_KEY');
  if (!required(env.WEB_PUSH_SUBJECT)) missing.push('WEB_PUSH_SUBJECT');
  return [...new Set(missing)];
}

function required(value: string | undefined): boolean { return Boolean(value?.trim()); }
function secret(value: string | undefined): boolean { return Boolean(value?.trim() && value.trim().length >= 32); }
function adminPassword(value: string | undefined): boolean { return Boolean(value && value.length >= 8 && value.length <= 512); }
function exactOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!url.host || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const loopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) return null;
    return url.origin;
  } catch { return null; }
}
