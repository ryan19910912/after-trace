import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import { DrizzleProactiveRepository } from './drizzle-repository';
import { ProactivePushService } from './service';

export type ProactiveRouteBindings = {
  DATABASE_URL: string;
  PROACTIVE_INTERNAL_SECRET?: string;
};

export function createProactiveRoutes() {
  const app = new Hono<{ Bindings: ProactiveRouteBindings }>();

  app.post('/', async (c) => {
    const configured = c.env.PROACTIVE_INTERNAL_SECRET?.trim();
    if (!configured) return c.json({ ok: false, error: 'PROACTIVE_INTERNAL_NOT_CONFIGURED' }, 503);
    const supplied = c.req.header('x-aftertrace-proactive-secret')?.trim();
    if (!supplied || !safeEqual(supplied, configured)) {
      return c.json({ ok: false, error: 'INVALID_PROACTIVE_SECRET' }, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ ok: false, error: 'INVALID_REQUEST' }, 400);
    }
    const value = body as Record<string, unknown>;
    try {
      const service = new ProactivePushService(
        new DrizzleProactiveRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const result = await service.enqueue({
        ownerLineUserId: stringField(value, 'ownerLineUserId'),
        lineGroupId: stringField(value, 'lineGroupId'),
        requestKey: stringField(value, 'requestKey'),
        sourceType: stringField(value, 'sourceType'),
        sourceId: stringField(value, 'sourceId'),
        message: stringField(value, 'message'),
        scheduledFor: dateField(value, 'scheduledFor'),
      });
      if (result.status === 'PROACTIVE_NOT_AVAILABLE') return c.json({ ok: false, result }, 402);
      if (result.status === 'OWNER_NOT_GROUP_MEMBER') return c.json({ ok: false, result }, 403);
      if (result.status === 'OWNER_NOT_FOUND' || result.status === 'GROUP_NOT_FOUND') return c.json({ ok: false, result }, 404);
      if (result.status === 'GROUP_INACTIVE' || result.status === 'REFERENCE_CONFLICT') return c.json({ ok: false, result }, 409);
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({
        ok: false,
        error: error instanceof Error ? error.message : 'INVALID_PROACTIVE_REQUEST',
      }, 400);
    }
  });

  return app;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function dateField(body: Record<string, unknown>, name: string): Date {
  const value = new Date(stringField(body, name));
  if (Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid date`);
  return value;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
