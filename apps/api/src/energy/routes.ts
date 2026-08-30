import { Hono } from 'hono';
import { resolveCommerceCatalog } from '../commerce/catalog';
import {
  checkoutConfigured,
  createCheckoutService,
  type CheckoutEnv,
  type CommerceProductCode,
} from '../commerce/checkout';
import { resolveProductConfig } from '../config/product';
import { createDatabase } from '../db/client';
import { LineLiffUserSessionVerifier, LineWebUserSessionVerifier } from '../management/session';
import { DrizzlePrivateEnergyOverviewRepository, serializePrivateEnergyOverview } from './private-overview';
import { DrizzleUserEnergyRepository } from './drizzle-repository';
import { DrizzleUserRewardedAdRepository } from './drizzle-rewarded-ad';
import {
  GoogleAdManagerWebRewardedProvider,
  UserRewardedAdService,
} from './rewarded-ad';

export type EnergyRouteBindings = CheckoutEnv & {
  DATABASE_URL: string;
  LIFF_CHANNEL_ID: string;
  LIFF_WEB_ORIGIN?: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  GOOGLE_AD_MANAGER_NETWORK_CODE?: string;
  GOOGLE_AD_MANAGER_REWARDED_AD_UNIT_PATH?: string;
};

type AuthorizedUser = { lineUserId: string };

export function createEnergyRoutes() {
  const app = new Hono<{ Bindings: EnergyRouteBindings }>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim() || c.env.LIFF_WEB_ORIGIN?.trim();
    if (origin && !allowedOrigin) return c.json({ ok: false, error: 'WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    if (origin && origin !== allowedOrigin) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    if (origin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim() || c.env.LIFF_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.get('/me', async (c) => {
    const user = await authorizeUser(c.env, c.req.header('authorization'));
    if ('error' in user) return c.json({ ok: false, error: user.error }, user.status);
    const overview = await new DrizzlePrivateEnergyOverviewRepository(
      createDatabase(c.env.DATABASE_URL),
    ).load(user.lineUserId, new Date());
    if (!overview) return c.json({ ok: false, error: 'ENERGY_USER_NOT_FOUND' }, 404);
    return c.json({ ok: true, energy: serializePrivateEnergyOverview(overview) });
  });

  app.get('/catalog', async (c) => {
    const user = await authorizeUser(c.env, c.req.header('authorization'));
    if ('error' in user) return c.json({ ok: false, error: user.error }, user.status);
    const catalog = resolveCommerceCatalog(c.env);
    const product = resolveProductConfig(c.env);
    return c.json({
      ok: true,
      catalog: {
        ...catalog,
        checkoutEnabled: checkoutConfigured(c.env),
      },
      rewardedAd: {
        enabled: rewardedAdService(c.env) !== null,
        energyUnits: product.energy.rewardedAdUnits?.toString() ?? null,
        dailyLimit: product.credits.rewardedAdDailyLimit,
        cooldownMinutes: product.credits.rewardedAdCooldownMinutes,
      },
    });
  });

  app.post('/checkout', async (c) => {
    const user = await authorizeUser(c.env, c.req.header('authorization'));
    if ('error' in user) return c.json({ ok: false, error: user.error }, user.status);
    const service = createCheckoutService(createDatabase(c.env.DATABASE_URL), c.env);
    if (!service) return c.json({ ok: false, error: 'CHECKOUT_NOT_CONFIGURED' }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    }
    const record = body as Record<string, unknown>;
    if (typeof record.requestKey !== 'string' || typeof record.productCode !== 'string') {
      return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    }
    const productCode = commerceProductCode(record.productCode);
    if (!productCode) return c.json({ ok: false, error: 'INVALID_PRODUCT_CODE' }, 400);

    const result = await service.create({
      lineUserId: user.lineUserId,
      requestKey: record.requestKey,
      productCode,
    });
    if (result.status === 'USER_NOT_FOUND') return c.json({ ok: false, result }, 404);
    if (result.status === 'PRODUCT_NOT_CONFIGURED' || result.status === 'CHECKOUT_NOT_CONFIGURED') {
      return c.json({ ok: false, result }, 503);
    }
    if (result.status === 'PROVIDER_UNAVAILABLE') return c.json({ ok: false, result }, 502);
    if (result.status === 'REFERENCE_CONFLICT') return c.json({ ok: false, result }, 409);
    return c.json({ ok: true, checkout: result });
  });

  app.post('/rewarded-ad/nonce', async (c) => {
    const user = await authorizeUser(c.env, c.req.header('authorization'));
    if ('error' in user) return c.json({ ok: false, error: user.error }, user.status);
    const service = rewardedAdService(c.env);
    if (!service) return c.json({ ok: false, error: 'REWARDED_AD_NOT_CONFIGURED' }, 503);
    const issued = await service.issueNonce(user.lineUserId, new Date());
    if (!issued) return c.json({ ok: false, error: 'ENERGY_USER_NOT_FOUND' }, 404);
    return c.json({
      ok: true,
      nonce: issued.nonce,
      expiresAt: issued.expiresAt.toISOString(),
      client: issued.client,
    });
  });

  app.post('/rewarded-ad/claim', async (c) => {
    const user = await authorizeUser(c.env, c.req.header('authorization'));
    if ('error' in user) return c.json({ ok: false, error: user.error }, user.status);
    const service = rewardedAdService(c.env);
    if (!service) return c.json({ ok: false, error: 'REWARDED_AD_NOT_CONFIGURED' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    const record = body as Record<string, unknown>;
    if (typeof record.nonce !== 'string' || typeof record.providerEventId !== 'string') {
      return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    }
    const result = await service.claim({
      lineUserId: user.lineUserId,
      nonce: record.nonce,
      providerEventId: record.providerEventId,
      at: new Date(),
    });
    if (result.status === 'NONCE_INVALID') return c.json({ ok: false, result }, 409);
    if (result.status === 'POLICY_REJECTED') return c.json({ ok: false, result }, 429);
    if (result.status === 'REFERENCE_CONFLICT') return c.json({ ok: false, result }, 409);
    if (result.status === 'USER_NOT_FOUND') return c.json({ ok: false, result }, 404);
    if ('units' in result) {
      return c.json({ ok: true, result: { ...result, units: result.units.toString() } });
    }
    return c.json({ ok: false, error: 'UNEXPECTED_REWARDED_AD_RESULT' }, 500);
  });

  return app;
}

function rewardedAdService(env: EnergyRouteBindings): UserRewardedAdService | null {
  const config = resolveProductConfig(env);
  const units = config.energy.rewardedAdUnits;
  const networkCode = env.GOOGLE_AD_MANAGER_NETWORK_CODE?.trim();
  const adUnitPath = env.GOOGLE_AD_MANAGER_REWARDED_AD_UNIT_PATH?.trim();
  if (units === null || !networkCode || !adUnitPath) return null;
  const db = createDatabase(env.DATABASE_URL);
  return new UserRewardedAdService(
    new DrizzleUserRewardedAdRepository(db),
    new DrizzleUserEnergyRepository(db),
    new GoogleAdManagerWebRewardedProvider(networkCode, adUnitPath),
    units,
    config.credits.rewardedAdDailyLimit,
    config.credits.rewardedAdCooldownMinutes,
  );
}

async function authorizeUser(
  env: EnergyRouteBindings,
  authorizationHeader: string | undefined,
): Promise<AuthorizedUser | { error: string; status: 401 | 503 }> {
  const webSecret = env.WEB_AUTH_SECRET?.trim();
  if (webSecret) {
    const webSession = await new LineWebUserSessionVerifier(webSecret).verify(authorizationHeader);
    if (webSession.status === 'AUTHORIZED') return { lineUserId: webSession.session.lineUserId };
  }

  const liffSession = await new LineLiffUserSessionVerifier(env.LIFF_CHANNEL_ID).verify(authorizationHeader);
  if (liffSession.status === 'AUTHORIZED') return { lineUserId: liffSession.session.lineUserId };
  return {
    error: liffSession.status,
    status: liffSession.status === 'LINE_VERIFICATION_UNAVAILABLE' ? 503 : 401,
  };
}

function commerceProductCode(value: string): CommerceProductCode | null {
  return value === 'SUBSCRIPTION_V1'
    || value === 'PAID_SMALL'
    || value === 'PAID_MEDIUM'
    || value === 'PAID_LARGE'
    ? value
    : null;
}
