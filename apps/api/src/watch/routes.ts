import { Hono } from 'hono';
import { AnonymousIdentityService, parseBearerToken } from '../auth/anonymous';
import { createDatabase } from '../db/client';
import type { Bindings } from '../env';
import { DrizzleWatchRuleRepository, WatchRuleError } from './repository';
import {
  createWatchRuleSchema,
  fingerprintWatchCreate,
  parseIdempotencyKey,
  updateWatchRuleSchema,
} from './rules';

function parseWatchRuleId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createWatchRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', async (c, next) => {
    if (!c.env.DATABASE_URL?.trim()) {
      return c.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, 503);
    }
    const token = parseBearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    const database = createDatabase(c.env.DATABASE_URL);
    const userId = await new AnonymousIdentityService(database).resolve(token);
    if (!userId) return c.json({ ok: false, error: 'INVALID_IDENTITY' }, 401);
    c.set('database', database);
    c.set('userId', userId);
    await next();
  });

  app.get('/', async (c) => {
    const repository = new DrizzleWatchRuleRepository(c.get('database'));
    return c.json({ ok: true, watchRules: await repository.list(c.get('userId')) });
  });

  app.post('/', async (c) => {
    const idempotencyKey = parseIdempotencyKey(c.req.header('idempotency-key'));
    if (!idempotencyKey) {
      return c.json({ ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    const parsed = createWatchRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'INVALID_WATCH_RULE', details: parsed.error.flatten() }, 400);
    }

    try {
      const repository = new DrizzleWatchRuleRepository(c.get('database'));
      const watchRule = await repository.create({
        userId: c.get('userId'),
        clientKey: idempotencyKey,
        payloadHash: await fingerprintWatchCreate(parsed.data),
        rule: parsed.data,
      });
      return c.json({ ok: true, watchRule }, 201);
    } catch (error) {
      if (error instanceof WatchRuleError) return c.json({ ok: false, error: error.code }, 409);
      throw error;
    }
  });

  app.patch('/:watchRuleId', async (c) => {
    const watchRuleId = parseWatchRuleId(c.req.param('watchRuleId'));
    if (!watchRuleId) return c.json({ ok: false, error: 'INVALID_WATCH_RULE_ID' }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    }
    const parsed = updateWatchRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'INVALID_WATCH_RULE', details: parsed.error.flatten() }, 400);
    }

    try {
      const repository = new DrizzleWatchRuleRepository(c.get('database'));
      const watchRule = await repository.update(c.get('userId'), watchRuleId, parsed.data);
      if (!watchRule) return c.json({ ok: false, error: 'WATCH_RULE_NOT_FOUND' }, 404);
      return c.json({ ok: true, watchRule });
    } catch (error) {
      if (error instanceof WatchRuleError) return c.json({ ok: false, error: error.code }, 409);
      throw error;
    }
  });

  app.delete('/:watchRuleId', async (c) => {
    const watchRuleId = parseWatchRuleId(c.req.param('watchRuleId'));
    if (!watchRuleId) return c.json({ ok: false, error: 'INVALID_WATCH_RULE_ID' }, 400);
    const repository = new DrizzleWatchRuleRepository(c.get('database'));
    const deleted = await repository.delete(c.get('userId'), watchRuleId);
    if (!deleted) return c.json({ ok: false, error: 'WATCH_RULE_NOT_FOUND' }, 404);
    return c.json({ ok: true });
  });

  return app;
}

declare module 'hono' {
  interface ContextVariableMap {
    database: ReturnType<typeof createDatabase>;
    userId: number;
  }
}
