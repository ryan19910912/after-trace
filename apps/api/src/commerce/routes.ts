import { Hono } from 'hono';
import { resolveProductConfig, type ProductConfigEnv } from '../config/product';
import { createDatabase } from '../db/client';
import { DrizzleUserEnergyRepository } from '../energy/drizzle-repository';
import { DrizzleCommerceRepository } from './drizzle-repository';
import { CommerceEventService, type CommerceEvent } from './service';

export type CommerceRouteBindings = ProductConfigEnv & {
  DATABASE_URL: string;
  COMMERCE_WEBHOOK_SECRET?: string;
};

export function createCommerceRoutes() {
  const app = new Hono<{ Bindings: CommerceRouteBindings }>();

  app.post('/events', async (c) => {
    const configuredSecret = c.env.COMMERCE_WEBHOOK_SECRET?.trim();
    if (!configuredSecret) return c.json({ ok: false, error: 'COMMERCE_WEBHOOK_NOT_CONFIGURED' }, 503);
    const supplied = c.req.header('x-aftertrace-commerce-secret')?.trim();
    if (!supplied || !safeEqual(supplied, configuredSecret)) {
      return c.json({ ok: false, error: 'INVALID_COMMERCE_WEBHOOK_SECRET' }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }

    try {
      const event = parseCommerceEvent(body);
      const db = createDatabase(c.env.DATABASE_URL);
      const service = new CommerceEventService(
        new DrizzleCommerceRepository(db),
        new DrizzleUserEnergyRepository(db),
        resolveProductConfig(c.env),
      );
      const result = await service.apply(event, new Date());
      if (result.status === 'USER_NOT_FOUND') return c.json({ ok: false, result }, 404);
      if (result.status === 'PRODUCT_NOT_CONFIGURED') return c.json({ ok: false, result }, 503);
      if (result.status === 'REFERENCE_CONFLICT') return c.json({ ok: false, result }, 409);
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({
        ok: false,
        error: error instanceof Error ? error.message : 'INVALID_COMMERCE_EVENT',
      }, 400);
    }
  });

  return app;
}

function parseCommerceEvent(value: unknown): CommerceEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('commerce event body must be an object');
  }
  const body = value as Record<string, unknown>;
  const type = requiredString(body, 'type');
  const provider = requiredString(body, 'provider');
  const providerEventId = requiredString(body, 'providerEventId');
  const lineUserId = requiredString(body, 'lineUserId');

  if (type === 'SUBSCRIPTION_CYCLE_PAID') {
    return {
      type,
      provider,
      providerEventId,
      lineUserId,
      providerSubscriptionId: requiredString(body, 'providerSubscriptionId'),
      cycleId: requiredString(body, 'cycleId'),
      periodStart: requiredDate(body, 'periodStart'),
      periodEnd: requiredDate(body, 'periodEnd'),
    };
  }
  if (type === 'SUBSCRIPTION_CANCELLED') {
    return {
      type,
      provider,
      providerEventId,
      lineUserId,
      providerSubscriptionId: requiredString(body, 'providerSubscriptionId'),
      currentPeriodEnd: optionalDate(body, 'currentPeriodEnd'),
      cancelAtPeriodEnd: Boolean(body.cancelAtPeriodEnd),
    };
  }
  if (type === 'PAID_PACK_PURCHASED') {
    const packCode = requiredString(body, 'packCode');
    if (packCode !== 'SMALL' && packCode !== 'MEDIUM' && packCode !== 'LARGE') {
      throw new Error('packCode must be SMALL, MEDIUM or LARGE');
    }
    return {
      type,
      provider,
      providerEventId,
      lineUserId,
      providerPurchaseId: requiredString(body, 'providerPurchaseId'),
      packCode,
    };
  }
  throw new Error('unsupported commerce event type');
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function requiredDate(body: Record<string, unknown>, field: string): Date {
  const date = new Date(requiredString(body, field));
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date`);
  return date;
}

function optionalDate(body: Record<string, unknown>, field: string): Date | null {
  if (body[field] === null || body[field] === undefined || body[field] === '') return null;
  return requiredDate(body, field);
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
