import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from './db/client';
import { webPushRuntimeConfigured } from './worklog/push-runtime';

export type TargetReadinessBindings = {
  DATABASE_URL: string;
  GEMINI_API_KEY?: string;
  WEB_APP_URL?: string;
  WEB_APP_ORIGIN?: string;
  WEB_AUTH_SECRET?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GOOGLE_LOGIN_CLIENT_ID?: string;
  GOOGLE_LOGIN_CLIENT_SECRET?: string;
  ADMIN_PASSWORD_PEPPER?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_WEB_ORIGIN?: string;
  WEB_PUSH_PUBLIC_KEY?: string;
  WEB_PUSH_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
};

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
        (SELECT COUNT(*) FROM worklog_notifications WHERE FALSE) AS notifications_probe,
        (SELECT COUNT(*) FROM worklog_notification_recipients WHERE FALSE) AS recipients_probe,
        (SELECT COUNT(*) FROM worklog_push_subscriptions WHERE FALSE) AS push_probe,
        (SELECT COUNT(*) FROM worklog_notification_preferences WHERE FALSE) AS notification_preferences_probe,
        (SELECT COUNT(*) FROM worklog_tasks WHERE FALSE) AS tasks_probe,
        (SELECT COUNT(*) FROM worklog_feedback WHERE FALSE) AS feedback_probe,
        (SELECT COUNT(*) FROM worklog_feedback_management WHERE FALSE) AS feedback_management_probe,
        (SELECT COUNT(published_version) FROM worklog_local_ai_prompts WHERE FALSE) AS local_prompts_probe,
        (SELECT COUNT(version) FROM worklog_local_ai_prompt_revisions WHERE FALSE) AS local_prompt_history_probe,
        (SELECT COUNT(*) FROM worklog_admin_accounts WHERE FALSE) AS admin_accounts_probe,
        (SELECT COUNT(*) FROM worklog_admin_roles WHERE FALSE) AS admin_roles_probe,
        (SELECT COUNT(*) FROM worklog_local_ai_models WHERE FALSE) AS local_models_probe
    `);
  } catch (error) {
    console.error('WORKLOG_TARGET_READINESS_SCHEMA_PROBE_FAILED', error);
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'WORKLOG_TARGET_SCHEMA_UNAVAILABLE' }, { status: 503 });
  }

  if (!webPushRuntimeConfigured(env)) {
    return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'WEB_PUSH_CONFIG_INVALID' }, { status: 503 });
  }

  return Response.json({ service: 'after-trace-api', product: 'worklog', status: 'ready' });
}

function targetConfigErrors(env: TargetReadinessBindings): string[] {
  const missing: string[] = [];
  if (!required(env.DATABASE_URL)) missing.push('DATABASE_URL');
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
  if (!secret(env.ADMIN_PASSWORD_PEPPER)) missing.push('ADMIN_PASSWORD_PEPPER');

  if (!secret(env.ADMIN_SESSION_SECRET)) missing.push('ADMIN_SESSION_SECRET');
  if (!exactOrigin(env.ADMIN_WEB_ORIGIN)) missing.push('ADMIN_WEB_ORIGIN');
  if (!required(env.WEB_PUSH_PUBLIC_KEY)) missing.push('WEB_PUSH_PUBLIC_KEY');
  if (!required(env.WEB_PUSH_PRIVATE_KEY)) missing.push('WEB_PUSH_PRIVATE_KEY');
  if (!required(env.WEB_PUSH_SUBJECT)) missing.push('WEB_PUSH_SUBJECT');
  return [...new Set(missing)];
}

function required(value: string | undefined): boolean { return Boolean(value?.trim()); }
function secret(value: string | undefined): boolean { return Boolean(value?.trim() && value.trim().length >= 32); }


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
