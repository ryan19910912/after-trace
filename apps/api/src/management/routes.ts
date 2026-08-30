import { Hono, type Context } from 'hono';
import type { ProductConfigEnv } from '../config/product';
import { createDatabase } from '../db/client';
import { DrizzleUserReminderRepository } from '../reminders/drizzle-user-repository';
import { UserReminderService } from '../reminders/user-service';
import { DrizzleManagementRepository } from './drizzle-repository';
import { verifyGroupContextToken } from './group-context';
import {
  LineLiffGroupSessionVerifier,
  LineWebGroupSessionVerifier,
  type GroupSession,
  type GroupSessionResult,
} from './session';
import { ManagementService } from './service';

export type ManagementBindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LIFF_CHANNEL_ID?: string;
  LIFF_WEB_ORIGIN?: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  REMINDER_RESERVATION_ENERGY?: string;
};

type ManagementEnv = { Bindings: ManagementBindings };
type ManagementContext = Context<ManagementEnv>;

function configuredReminderEnergy(value: string | undefined): bigint | null {
  if (!value?.trim()) return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error('REMINDER_RESERVATION_ENERGY must be a positive integer');
  }
  const units = BigInt(value.trim());
  if (units <= 0n) throw new Error('REMINDER_RESERVATION_ENERGY must be greater than zero');
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

function allowedWebOrigin(c: ManagementContext): string | null {
  return c.env.WEB_APP_ORIGIN?.trim() || c.env.LIFF_WEB_ORIGIN?.trim() || null;
}

async function verifySession(c: ManagementContext, lineGroupId: string): Promise<GroupSessionResult> {
  const db = createDatabase(c.env.DATABASE_URL);
  const webSecret = c.env.WEB_AUTH_SECRET?.trim();
  let webResult: GroupSessionResult | null = null;
  if (webSecret) {
    webResult = await new LineWebGroupSessionVerifier(
      db,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      webSecret,
    ).verify(c.req.header('authorization'), lineGroupId);
    if (webResult.status === 'AUTHORIZED') return webResult;
  }

  const liffChannelId = c.env.LIFF_CHANNEL_ID?.trim();
  if (liffChannelId) {
    return new LineLiffGroupSessionVerifier(
      db,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      liffChannelId,
    ).verify(c.req.header('authorization'), lineGroupId);
  }
  return webResult ?? { status: 'INVALID_USER_TOKEN' };
}

async function sessionFor(c: ManagementContext): Promise<GroupSession | Response> {
  const groupContextToken = c.req.header('x-line-group-context');
  if (!groupContextToken) return c.json({ ok: false, error: 'LINE_GROUP_CONTEXT_REQUIRED' }, 400);
  const lineGroupId = await verifyGroupContextToken(groupContextToken, c.env.LINE_CHANNEL_SECRET);
  if (!lineGroupId) return c.json({ ok: false, error: 'INVALID_LINE_GROUP_CONTEXT' }, 401);

  const result = await verifySession(c, lineGroupId);
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
  if (result.status === 'NOT_GROUP_MEMBER') return c.json({ ok: false, error: result.status }, 403);
  if (result.status === 'GROUP_NOT_FOUND') return c.json({ ok: false, error: result.status }, 404);
  return c.json({ ok: false, error: result.status }, 409);
}

function isResponse(value: GroupSession | Response): value is Response {
  return value instanceof Response;
}

export function createManagementRoutes() {
  const app = new Hono<ManagementEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = allowedWebOrigin(c);
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
    const allowedOrigin = allowedWebOrigin(c);
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Line-Group-Context');
    c.header('Access-Control-Allow-Methods', 'GET, PATCH, POST, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.get('/memories', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const service = new ManagementService(new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)));
    return c.json({ ok: true, memories: await service.listMemories(session.groupId, c.req.query('q') ?? null) });
  });

  app.patch('/memories/:id', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    try {
      const body = jsonBody(await c.req.json());
      const service = new ManagementService(new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)));
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
      return result === 'UPDATED'
        ? c.json({ ok: true })
        : c.json({ ok: false, error: 'MEMORY_NOT_FOUND' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  app.delete('/memories/:id', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    try {
      const service = new ManagementService(new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)));
      const result = await service.deleteMemory(
        session.groupId,
        positivePathId(c.req.param('id')),
        session.lineUserId,
      );
      return result === 'DELETED'
        ? c.json({ ok: true })
        : c.json({ ok: false, error: 'MEMORY_NOT_FOUND' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  app.get('/reminders', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const service = new ManagementService(new DrizzleManagementRepository(createDatabase(c.env.DATABASE_URL)));
    return c.json({ ok: true, reminders: await service.listReminders(session.groupId) });
  });

  app.post('/reminders', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    const units = configuredReminderEnergy(c.env.REMINDER_RESERVATION_ENERGY);
    if (units === null) return c.json({ ok: false, error: 'REMINDER_ENERGY_NOT_CONFIGURED' }, 503);
    try {
      const body = jsonBody(await c.req.json());
      const service = new UserReminderService(
        new DrizzleUserReminderRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const result = await service.create({
        groupId: session.groupId,
        ownerLineUserId: session.lineUserId,
        requestKey: stringField(body, 'requestKey'),
        message: stringField(body, 'message'),
        scheduledFor: new Date(stringField(body, 'scheduledFor')),
        reservationUnits: units,
      });
      if (result.status === 'INSUFFICIENT_PROACTIVE_ENERGY') return c.json({ ok: false, result }, 402);
      if (result.status === 'OWNER_NOT_GROUP_MEMBER') return c.json({ ok: false, result }, 403);
      if (result.status === 'REFERENCE_CONFLICT') return c.json({ ok: false, result }, 409);
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  app.delete('/reminders/:id', async (c) => {
    const session = await sessionFor(c);
    if (isResponse(session)) return session;
    try {
      const service = new UserReminderService(
        new DrizzleUserReminderRepository(createDatabase(c.env.DATABASE_URL)),
      );
      const reminderId = positivePathId(c.req.param('id'));
      const result = await service.cancel({
        groupId: session.groupId,
        reminderId,
        ownerLineUserId: session.lineUserId,
        mutationKey: `web:${reminderId}:${session.lineUserId}`,
      });
      if (result.status === 'NOT_FOUND') return c.json({ ok: false, result }, 404);
      if (result.status === 'NOT_OWNER') return c.json({ ok: false, result }, 403);
      if (result.status === 'REFERENCE_CONFLICT') return c.json({ ok: false, result }, 409);
      return c.json({ ok: true, result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_REQUEST' }, 400);
    }
  });

  return app;
}
