import { Hono, type Context } from 'hono';
import type { ProductConfigEnv } from '../config/product';
import { resolveProductConfig } from '../config/product';
import { parseTwdCostUnits } from '../credits/allocation';
import { rewardedAdPolicyDay } from '../credits/rewarded-ad';
import { createDatabase } from '../db/client';
import { DrizzleReminderRepository } from '../reminders/drizzle-repository';
import { ReminderService } from '../reminders/service';
import { DrizzleManagementRepository } from './drizzle-repository';
import { LineLiffGroupSessionVerifier, type LiffGroupSession } from './session';
import { ManagementService } from './service';

export type ManagementBindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LIFF_CHANNEL_ID: string;
  LIFF_WEB_ORIGIN?: string;
  REMINDER_RESERVATION_COST_TWD?: string;
};

type ManagementEnv = { Bindings: ManagementBindings };
type ManagementContext = Context<ManagementEnv>;

function configuredReminderUnits(value: string | undefined): bigint | null {
  if (!value?.trim()) return null;
  const units = parseTwdCostUnits(value);
  if (units <= 0n) throw new Error('REMINDER_RESERVATION_COST_TWD must be greater than zero');
  return units;
}

function jsonBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be an object');
  }
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

function optionalStringField(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${name} must be a string or null`);
  return value;
}

function positivePathId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('invalid resource id');
  return parsed;
}

async function sessionFor(c: ManagementContext): Promise<LiffGroupSession | Response> {
  const lineGroupId = c.req.header('x-line-group-id');
  if (!lineGroupId) return c.json({ ok: false, error: 'LINE_GROUP_CONTEXT_REQUIRED' }, 400);

  const db = createDatabase(c.env.DATABASE_URL);
  const verifier = new LineLiffGroupSessionVerifier(
    db,
    c.env.LINE_CHANNEL_ACCESS_TOKEN,
    c.env.LIFF_CHANNEL_ID,
  );
  const result = await verifier.verify(c.req.header('authorization'), lineGroupId);
  if (result.status === 'AUTHORIZED') return result.session;

  if (result.status === 'LINE_VERIFICATION_UNAVAILABLE') {
    return c.json({ ok: false, error: result.status }, 503);
  }
  if (
    result.status === 'MISSING_BEARER_TOKEN' ||
    result.status === 'INVALID_USER_TOKEN' ||
    result.status === 'WRONG_LIFF_CHANNEL'
  ) {
    return c.json({ ok: false, error: result.status }, 401);
  }
  if (result.status === 'NOT_GROUP_MEMBER') {
    return c.json({ ok: false, error: result.status }, 403);
  }
  if (result.status === 'GROUP_NOT_FOUND') {
    return c.json({ ok: false, error: result.status }, 404);
  }
  return c.json({ ok: false, error: result.status }, 409);
}

function isResponse(value: LiffGroupSession | Response): value is Response {
  return value instanceof Response;
}

export function createManagementRoutes() {
  const app = new Hono<ManagementEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.LIFF_WEB_ORIGIN?.trim();
    if (origin && !allowedOrigin) {
      return c.json({ ok: false, error: 'LIFF_WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    }
    if (origin && origin !== allowedOrigin) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    if (origin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.LIFF_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) {
      return c.body(null, 403);
    }
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Line-Group-Id');
    c.header('Access-Control-Allow-Methods', 'GET, PATCH, POST, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.get('/overview', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const db = createDatabase(c.env.DATABASE_URL);
    const service = new ManagementService(new DrizzleManagementRepository(db));
    const config = resolveProductConfig(c.env);
    const overview = await service.overview(session.groupId, rewardedAdPolicyDay(new Date()));
    return c.json({
      ok: true,
      overview,
      capabilities: {
        rewardedAdClaimEnabled: false,
        rewardedAdDailyLimit: config.credits.rewardedAdDailyLimit,
        rewardedAdCooldownMinutes: config.credits.rewardedAdCooldownMinutes,
        reminderCreationEnabled: configuredReminderUnits(c.env.REMINDER_RESERVATION_COST_TWD) !== null,
      },
    });
  });

  app.get('/memories', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const service = new ManagementService(
      new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)),
    );
    const memories = await service.listMemories(session.groupId, c.req.query('q') ?? null);
    return c.json({ ok: true, memories });
  });

  app.patch('/memories/:id', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    try {
      const body = jsonBody(await c.req.json());
      const service = new ManagementService(
        new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const result = await service.updateMemory(
        session.groupId,
        positivePathId(c.req.param('id')),
        session.lineUserId,
        {
          category: stringField(body, 'category'),
          subject: optionalStringField(body, 'subject'),
          content: stringField(body, 'content'),
        },
      );
      if (result === 'UPDATED') return c.json({ ok: true });
      return c.json({ ok: false, error: 'MEMORY_NOT_FOUND' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  app.delete('/memories/:id', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    try {
      const service = new ManagementService(
        new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const result = await service.deleteMemory(
        session.groupId,
        positivePathId(c.req.param('id')),
        session.lineUserId,
      );
      if (result === 'DELETED') return c.json({ ok: true });
      return c.json({ ok: false, error: 'MEMORY_NOT_FOUND' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  app.get('/reminders', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const service = new ManagementService(
      new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)),
    );
    return c.json({ ok: true, reminders: await service.listReminders(session.groupId) });
  });

  app.post('/reminders', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const units = configuredReminderUnits(c.env.REMINDER_RESERVATION_COST_TWD);
    if (units === null) {
      return c.json({ ok: false, error: 'REMINDER_PRICING_NOT_CONFIGURED' }, 503);
    }
    try {
      const body = jsonBody(await c.req.json());
      const scheduledFor = new Date(stringField(body, 'scheduledFor'));
      const service = new ReminderService(
        new DrizzleReminderRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const result = await service.create({
        groupId: session.groupId,
        requestKey: stringField(body, 'requestKey'),
        message: stringField(body, 'message'),
        scheduledFor,
        reservedCostUnits: units,
        actorLineUserId: session.lineUserId,
      });
      if (result.status === 'INSUFFICIENT_PAID') {
        return c.json({ ok: false, result }, 402);
      }
      if (result.status === 'REFERENCE_CONFLICT') {
        return c.json({ ok: false, result }, 409);
      }
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  app.delete('/reminders/:id', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    try {
      const service = new ReminderService(
        new DrizzleReminderRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const result = await service.cancel(
        session.groupId,
        positivePathId(c.req.param('id')),
        session.lineUserId,
      );
      if (result.status === 'NOT_FOUND') {
        return c.json({ ok: false, result }, 404);
      }
      if (result.status === 'REFERENCE_CONFLICT') {
        return c.json({ ok: false, result }, 409);
      }
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  return app;
}
