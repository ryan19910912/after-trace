import { Hono } from 'hono';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { DrizzleTaskRepository } from './drizzle-tasks';
import { TaskService, type TaskRepository, type UpdateTaskInput } from './tasks';

export type TaskRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

export type TaskRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  verifySession?: (token: string, secret: string, now?: Date) => Promise<WebSessionClaims | null>;
  resolveSessionUserId?: (database: Database, session: WebSessionClaims) => Promise<number | null>;
  repositoryFactory?: (database: Database) => TaskRepository;
};

type TaskEnv = {
  Bindings: TaskRoutesBindings;
  Variables: { userId: number; database: Database };
};

export function createTaskRoutes(dependencies: TaskRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const repositoryFactory = dependencies.repositoryFactory
    ?? ((database: Database) => new DrizzleTaskRepository(database));
  const app = new Hono<TaskEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowedOrigin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = c.env.WEB_AUTH_SECRET?.trim() ?? '';
    if (secret.length < 32) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifySession(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = databaseFactory(c.env.DATABASE_URL);
    const userId = await resolveSessionUser(database, session);
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database);
    c.set('userId', userId);
    await next();
  });

  app.get('/', async (c) => c.json({
    ok: true,
    tasks: await serviceFor(c, repositoryFactory).listForUser(c.get('userId'), parseLimit(c.req.query('limit'))),
  }));

  app.post('/', async (c) => {
    const body = await jsonObject(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    try {
      const task = await serviceFor(c, repositoryFactory).create({
        userId: c.get('userId'),
        title: stringValue(body.title),
        body: nullableString(body.body),
        sourceId: optionalPositiveId(body.sourceId, 'INVALID_SOURCE_ID'),
        recordId: optionalPositiveId(body.recordId, 'INVALID_RECORD_ID'),
        dueAt: optionalDate(body.dueAt, 'INVALID_TASK_DUE_AT'),
        remindAt: optionalDate(body.remindAt, 'INVALID_TASK_REMIND_AT'),
      });
      return c.json({ ok: true, task }, 201);
    } catch (error) {
      const code = errorCode(error);
      return c.json({ ok: false, error: code }, code === 'TASK_SOURCE_NOT_AUTHORIZED' ? 403 : 400);
    }
  });

  app.patch('/:id', async (c) => {
    const taskId = positiveId(c.req.param('id'));
    if (!taskId) return c.json({ ok: false, error: 'INVALID_TASK_ID' }, 400);
    const body = await jsonObject(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    try {
      const update: UpdateTaskInput = {};
      if ('title' in body) update.title = stringValue(body.title);
      if ('body' in body) update.body = nullableString(body.body);
      if ('dueAt' in body) update.dueAt = optionalDate(body.dueAt, 'INVALID_TASK_DUE_AT');
      if ('remindAt' in body) update.remindAt = optionalDate(body.remindAt, 'INVALID_TASK_REMIND_AT');
      const task = await serviceFor(c, repositoryFactory).update(c.get('userId'), taskId, update);
      return task ? c.json({ ok: true, task }) : c.json({ ok: false, error: 'TASK_NOT_FOUND_OR_NOT_OPEN' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: errorCode(error) }, 400);
    }
  });

  app.post('/:id/complete', async (c) => mutateStatus(c, repositoryFactory, 'complete'));
  app.post('/:id/cancel', async (c) => mutateStatus(c, repositoryFactory, 'cancel'));

  return app;
}

async function mutateStatus(
  c: { req: { param(name: string): string }; get(key: 'database' | 'userId'): Database | number; json(value: unknown, status?: 200 | 400 | 404): Response },
  repositoryFactory: (database: Database) => TaskRepository,
  action: 'complete' | 'cancel',
): Promise<Response> {
  const taskId = positiveId(c.req.param('id'));
  if (!taskId) return c.json({ ok: false, error: 'INVALID_TASK_ID' }, 400);
  const database = c.get('database') as Database;
  const userId = c.get('userId') as number;
  const service = new TaskService(repositoryFactory(database));
  const task = action === 'complete'
    ? await service.complete(userId, taskId)
    : await service.cancel(userId, taskId);
  return task ? c.json({ ok: true, task }) : c.json({ ok: false, error: 'TASK_NOT_FOUND_OR_NOT_OPEN' }, 404);
}

function serviceFor(c: { get(key: 'database'): Database }, repositoryFactory: (database: Database) => TaskRepository): TaskService {
  return new TaskService(repositoryFactory(c.get('database')));
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalPositiveId(value: unknown, error: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(error);
  return parsed;
}

function optionalDate(value: unknown, error: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(error);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(error);
  return parsed;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 50;
}

async function jsonObject(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'TASK_REQUEST_FAILED';
}
