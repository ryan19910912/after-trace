import { Hono } from 'hono';

export type WorklogFundingRouteBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type Env = {
  Bindings: WorklogFundingRouteBindings;
};

/**
 * Retired product surface.
 *
 * V1 AI entitlement is per AFTERTRACE account and comes only from the one-time FREE trial
 * or an active AI_PRO subscription. GROUP membership authorizes Source data only; it does
 * not have an AI funding owner/responsible-user concept. Keep this route mounted as an
 * explicit tombstone during migration so stale clients fail closed instead of silently
 * reviving the legacy GROUP funding model.
 */
export function createWorklogFundingRoutes() {
  const app = new Hono<Env>();

  app.all('*', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: false,
      error: 'LEGACY_GROUP_FUNDING_DISABLED',
      subscriptionPath: '/api/v1/subscription',
    }, 410);
  });

  return app;
}
