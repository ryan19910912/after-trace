import type { Bindings } from './env';
import { resolveVapidConfig } from './notifications/vapid';

export type ReadinessCheckStatus = 'ok' | 'missing' | 'invalid' | 'error';

export type RuntimeReadiness = {
  status: 'ready' | 'not_ready';
  checks: {
    database: {
      status: ReadinessCheckStatus;
      errorCode?: string;
    };
    webPush: {
      status: ReadinessCheckStatus;
      errorCode?: string;
    };
  };
};

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return fallback;
}

export async function evaluateRuntimeReadiness(
  env: Bindings,
  databaseProbe: () => Promise<void>,
): Promise<RuntimeReadiness> {
  const databaseConfigured = Boolean(env.DATABASE_URL?.trim());
  const database: RuntimeReadiness['checks']['database'] = databaseConfigured
    ? { status: 'ok' }
    : { status: 'missing', errorCode: 'DATABASE_NOT_CONFIGURED' };

  if (databaseConfigured) {
    try {
      await databaseProbe();
    } catch {
      database.status = 'error';
      database.errorCode = 'DATABASE_PROBE_FAILED';
    }
  }

  let webPush: RuntimeReadiness['checks']['webPush'];
  try {
    const config = resolveVapidConfig(env);
    webPush = config
      ? { status: 'ok' }
      : { status: 'missing', errorCode: 'WEB_PUSH_NOT_CONFIGURED' };
  } catch (error) {
    webPush = {
      status: 'invalid',
      errorCode: errorCode(error, 'INVALID_WEB_PUSH_CONFIGURATION'),
    };
  }

  return {
    status: database.status === 'ok' && webPush.status === 'ok' ? 'ready' : 'not_ready',
    checks: { database, webPush },
  };
}
