import { describe, expect, it, vi } from 'vitest';
import { evaluateRuntimeReadiness } from './readiness';

const PUBLIC_KEY = 'BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU';
const PRIVATE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE';

const readyEnv = {
  DATABASE_URL: 'postgresql://example.test/aftertrace',
  WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
  WEB_PUSH_VAPID_PRIVATE_KEY: PRIVATE_KEY,
  WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.test',
};

describe('runtime readiness', () => {
  it('does not probe the database when DATABASE_URL is missing', async () => {
    const databaseProbe = vi.fn(async () => undefined);
    const result = await evaluateRuntimeReadiness(
      {
        DATABASE_URL: '',
        WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
        WEB_PUSH_VAPID_PRIVATE_KEY: PRIVATE_KEY,
        WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.test',
      },
      databaseProbe,
    );

    expect(databaseProbe).not.toHaveBeenCalled();
    expect(result.status).toBe('not_ready');
    expect(result.checks.database).toEqual({
      status: 'missing',
      errorCode: 'DATABASE_NOT_CONFIGURED',
    });
    expect(result.checks.webPush.status).toBe('ok');
  });

  it('treats missing VAPID configuration as not ready', async () => {
    const result = await evaluateRuntimeReadiness(
      { DATABASE_URL: readyEnv.DATABASE_URL },
      async () => undefined,
    );

    expect(result.status).toBe('not_ready');
    expect(result.checks.database.status).toBe('ok');
    expect(result.checks.webPush).toEqual({
      status: 'missing',
      errorCode: 'WEB_PUSH_NOT_CONFIGURED',
    });
  });

  it('reports invalid VAPID configuration without exposing secret material', async () => {
    const result = await evaluateRuntimeReadiness(
      { ...readyEnv, WEB_PUSH_VAPID_PRIVATE_KEY: 'invalid' },
      async () => undefined,
    );

    expect(result.status).toBe('not_ready');
    expect(result.checks.webPush).toEqual({
      status: 'invalid',
      errorCode: 'INVALID_VAPID_PRIVATE_KEY',
    });
  });

  it('reports a database probe failure as not ready', async () => {
    const result = await evaluateRuntimeReadiness(readyEnv, async () => {
      throw new Error('connection details must not escape');
    });

    expect(result.status).toBe('not_ready');
    expect(result.checks.database).toEqual({
      status: 'error',
      errorCode: 'DATABASE_PROBE_FAILED',
    });
    expect(result.checks.webPush.status).toBe('ok');
  });

  it('is ready only when the database probe and full VAPID configuration are valid', async () => {
    const result = await evaluateRuntimeReadiness(readyEnv, async () => undefined);

    expect(result).toEqual({
      status: 'ready',
      checks: {
        database: { status: 'ok' },
        webPush: { status: 'ok' },
      },
    });
  });
});
