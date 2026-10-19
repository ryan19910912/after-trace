import { describe, expect, it } from 'vitest';
import {
  TaskService,
  type CreateTaskInput,
  type DueTaskNotificationResult,
  type TaskRepository,
  type UpdateTaskInput,
  type WorklogTask,
} from './tasks';

class FakeTaskRepository implements TaskRepository {
  created: CreateTaskInput | null = null;
  updated: UpdateTaskInput | null = null;
  dispatchedLimit: number | null = null;

  async listForUser(): Promise<WorklogTask[]> {
    return [];
  }

  async create(input: CreateTaskInput): Promise<WorklogTask> {
    this.created = input;
    return task({
      userId: input.userId,
      title: input.title,
      body: input.body ?? null,
      sourceId: input.sourceId ?? null,
      recordId: input.recordId ?? null,
      dueAt: input.dueAt?.toISOString() ?? null,
      remindAt: input.remindAt?.toISOString() ?? null,
    });
  }

  async update(_userId: number, _taskId: number, input: UpdateTaskInput): Promise<WorklogTask | null> {
    this.updated = input;
    return task();
  }

  async complete(): Promise<WorklogTask | null> {
    return task({ status: 'COMPLETED', completedAt: '2026-09-07T08:00:00.000Z' });
  }

  async cancel(): Promise<WorklogTask | null> {
    return task({ status: 'CANCELLED', cancelledAt: '2026-09-07T08:00:00.000Z' });
  }

  async dispatchDueReminderNotifications(limit: number): Promise<DueTaskNotificationResult> {
    this.dispatchedLimit = limit;
    return { examined: 2, notified: 2, skipped: 0 };
  }
}

describe('TaskService', () => {
  it('creates only explicit user-confirmed durable task data and preserves nullable reminder time', async () => {
    const repository = new FakeTaskRepository();
    const service = new TaskService(repository);

    const created = await service.create({
      userId: 7,
      title: '  回覆客戶  ',
      body: '  確認報價內容  ',
      dueAt: new Date('2026-09-08T02:00:00.000Z'),
      remindAt: null,
    });

    expect(created.title).toBe('回覆客戶');
    expect(repository.created).toMatchObject({
      userId: 7,
      title: '回覆客戶',
      body: '確認報價內容',
      sourceId: null,
      recordId: null,
      remindAt: null,
    });
  });

  it('requires a Source when a Task references a Record', async () => {
    const service = new TaskService(new FakeTaskRepository());

    expect(() => service.create({
      userId: 7,
      title: '跟進紀錄',
      recordId: 99,
    })).toThrow('TASK_SOURCE_REQUIRED_FOR_RECORD');
  });

  it('rejects an empty update instead of silently touching durable state', () => {
    const service = new TaskService(new FakeTaskRepository());

    expect(() => service.update(7, 9, {})).toThrow('TASK_UPDATE_REQUIRED');
  });

  it('bounds the shared scheduler due-task batch', async () => {
    const repository = new FakeTaskRepository();
    const service = new TaskService(repository);

    const result = await service.dispatchDueReminderNotifications(999);

    expect(result).toEqual({ examined: 2, notified: 2, skipped: 0 });
    expect(repository.dispatchedLimit).toBe(50);
  });
});

function task(overrides: Partial<WorklogTask> = {}): WorklogTask {
  return {
    id: 1,
    userId: 1,
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
    createdAt: '2026-09-07T07:00:00.000Z',
    updatedAt: '2026-09-07T07:00:00.000Z',
    ...overrides,
  };
}
