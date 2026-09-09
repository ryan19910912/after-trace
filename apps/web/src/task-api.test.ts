import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskApi, taskFromApi, taskStatusLabel } from './task-api';

const api = new TaskApi('https://api.example.test');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TaskApi Web/PWA contract', () => {
  it('maps nullable task reminder fields without inventing values', () => {
    const task = taskFromApi({
      id: 10,
      userId: 3,
      sourceId: null,
      recordId: null,
      title: '回覆客戶',
      body: null,
      status: 'OPEN',
      dueAt: null,
      remindAt: null,
      reminderNotifiedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: '2026-09-07T08:00:00.000Z',
      updatedAt: '2026-09-07T08:00:00.000Z',
    });

    expect(task.dueAt).toBeNull();
    expect(task.remindAt).toBeNull();
    expect(task.sourceId).toBeNull();
    expect(taskStatusLabel(task.status)).toBe('待處理');
  });

  it('uses the authenticated shared AFTERTRACE session and durable task API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      task: taskPayload({ id: 11, title: '準備報價' }),
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await api.create('shared-session', {
      title: '準備報價',
      body: null,
      dueAt: '2026-09-08T02:00:00.000Z',
      remindAt: '2026-09-08T01:30:00.000Z',
    });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.example.test/api/v1/tasks');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer shared-session');
    expect(JSON.parse(String(init?.body))).toEqual({
      title: '準備報價',
      body: null,
      dueAt: '2026-09-08T02:00:00.000Z',
      remindAt: '2026-09-08T01:30:00.000Z',
    });
  });

  it('uses explicit complete/cancel lifecycle endpoints instead of local-only state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const action = String(input).endsWith('/complete') ? 'COMPLETED' : 'CANCELLED';
      return jsonResponse({ task: taskPayload({ status: action }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const completed = await api.complete('session', 9);
    const cancelled = await api.cancel('session', 10);

    expect(completed.status).toBe('COMPLETED');
    expect(cancelled.status).toBe('CANCELLED');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/api/v1/tasks/9/complete');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://api.example.test/api/v1/tasks/10/cancel');
  });

  it('surfaces backend validation codes to the UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, error: 'INVALID_TASK_REMIND_AT' }, 400)));

    await expect(api.create('session', { title: '提醒', remindAt: 'bad' })).rejects.toThrow('INVALID_TASK_REMIND_AT');
  });
});

function taskPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 3,
    sourceId: null,
    recordId: null,
    title: '待辦',
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
