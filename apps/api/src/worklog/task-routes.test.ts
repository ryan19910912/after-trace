import { describe, expect, it } from 'vitest';
import { issueWebSessionToken } from '../auth/token';
import { createTaskRoutes } from './task-routes';
import type { TaskRepository, WorklogTask } from './tasks';

const env = {
  DATABASE_URL: 'postgresql://unused.invalid/aftertrace',
  WEB_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  WEB_APP_ORIGIN: 'https://web.example.test',
};

async function authorization(userId = 7) {
  const token = await issueWebSessionToken({ userId, secret: env.WEB_AUTH_SECRET, ttlSeconds: 3600 });
  return `Bearer ${token}`;
}

function headers(authorization: string, json = false) {
  return {
    authorization,
    origin: env.WEB_APP_ORIGIN,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

function task(id: number, userId: number, overrides: Partial<WorklogTask> = {}): WorklogTask {
  return {
    id,
    userId,
    sourceId: null,
    recordId: null,
    title: '跟進客戶',
    body: null,
    status: 'OPEN',
    dueAt: null,
    remindAt: null,
    reminderNotifiedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: '2026-09-07T08:00:00.000Z',
    updatedAt: '2026-09-07T08:00:00.000Z',
    ...overrides,
  };
}

function repository(overrides: Partial<TaskRepository> = {}): TaskRepository {
  return {
    async listForUser() { return []; },
    async create(input) { return task(1, input.userId); },
    async update(userId, taskId) { return task(taskId, userId); },
    async complete(userId, taskId) { return task(taskId, userId, { status: 'COMPLETED' }); },
    async cancel(userId, taskId) { return task(taskId, userId, { status: 'CANCELLED' }); },
    async dispatchDueReminderNotifications() { return { examined: 0, notified: 0, skipped: 0 }; },
    ...overrides,
  };
}

describe('native task routes', () => {
  it('uses the durable provider-neutral Web session user id', async () => {
    let requestedUserId = 0;
    const app = createTaskRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async listForUser(userId) {
          requestedUserId = userId;
          return [task(31, userId)];
        },
      }),
    });

    const response = await app.request('/', { headers: headers(await authorization(23)) }, env);

    expect(response.status).toBe(200);
    expect(requestedUserId).toBe(23);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tasks: [{ id: 31, userId: 23, title: '跟進客戶', status: 'OPEN' }],
    });
  });

  it('rejects malformed reminder timestamps as a 400 instead of leaking an unhandled error', async () => {
    let createCalls = 0;
    const app = createTaskRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async create(input) {
          createCalls += 1;
          return task(1, input.userId);
        },
      }),
    });

    const response = await app.request('/', {
      method: 'POST',
      headers: headers(await authorization(), true),
      body: JSON.stringify({ title: '提醒我', remindAt: 'not-a-date' }),
    }, env);

    expect(response.status).toBe(400);
    expect(createCalls).toBe(0);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_TASK_REMIND_AT' });
  });

  it('requires an explicit Source when linking a task to a Record', async () => {
    const app = createTaskRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository(),
    });

    const response = await app.request('/', {
      method: 'POST',
      headers: headers(await authorization(), true),
      body: JSON.stringify({ title: '從紀錄建立', recordId: 99 }),
    }, env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'TASK_SOURCE_REQUIRED_FOR_RECORD' });
  });

  it('fails closed when the authenticated user is not authorized for the requested Source', async () => {
    const app = createTaskRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async create() { throw new Error('TASK_SOURCE_NOT_AUTHORIZED'); },
      }),
    });

    const response = await app.request('/', {
      method: 'POST',
      headers: headers(await authorization(41), true),
      body: JSON.stringify({ title: '群組待辦', sourceId: 88 }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'TASK_SOURCE_NOT_AUTHORIZED' });
  });

  it('returns malformed PATCH dates as 400 before the repository is called', async () => {
    let updateCalls = 0;
    const app = createTaskRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async update(userId, taskId) {
          updateCalls += 1;
          return task(taskId, userId);
        },
      }),
    });

    const response = await app.request('/12', {
      method: 'PATCH',
      headers: headers(await authorization(), true),
      body: JSON.stringify({ dueAt: 'bad-date' }),
    }, env);

    expect(response.status).toBe(400);
    expect(updateCalls).toBe(0);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'INVALID_TASK_DUE_AT' });
  });

  it('scopes complete/cancel mutations to the authenticated account', async () => {
    const calls: string[] = [];
    const app = createTaskRoutes({
      databaseFactory: () => ({} as never),
      resolveSessionUserId: async (_database, session) => session.userId,
      repositoryFactory: () => repository({
        async complete(userId, taskId) {
          calls.push(`complete:${userId}:${taskId}`);
          return task(taskId, userId, { status: 'COMPLETED' });
        },
        async cancel(userId, taskId) {
          calls.push(`cancel:${userId}:${taskId}`);
          return task(taskId, userId, { status: 'CANCELLED' });
        },
      }),
    });
    const auth = await authorization(57);

    const complete = await app.request('/5/complete', { method: 'POST', headers: headers(auth) }, env);
    const cancel = await app.request('/6/cancel', { method: 'POST', headers: headers(auth) }, env);

    expect(complete.status).toBe(200);
    expect(cancel.status).toBe(200);
    expect(calls).toEqual(['complete:57:5', 'cancel:57:6']);
  });
});
