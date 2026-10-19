export type TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export type TaskItem = {
  id: number;
  userId: number;
  sourceId: number | null;
  recordId: number | null;
  title: string;
  body: string | null;
  status: TaskStatus;
  dueAt: string | null;
  remindAt: string | null;
  reminderNotifiedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskRequest = {
  title: string;
  body?: string | null;
  sourceId?: number | null;
  recordId?: number | null;
  dueAt?: string | null;
  remindAt?: string | null;
};

export type UpdateTaskRequest = {
  title?: string;
  body?: string | null;
  dueAt?: string | null;
  remindAt?: string | null;
};

export class TaskApi {
  constructor(private readonly baseUrl: string) {}

  async list(sessionToken: string, limit = 100): Promise<TaskItem[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 100 ? limit : 100;
    const body = await this.requestJson<{ tasks?: unknown }>(sessionToken, `/api/v1/tasks?limit=${safeLimit}`);
    return Array.isArray(body.tasks) ? body.tasks.map(taskFromApi) : [];
  }

  async create(sessionToken: string, input: CreateTaskRequest): Promise<TaskItem> {
    const body = await this.requestJson<{ task?: unknown }>(sessionToken, '/api/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return taskFromApi(body.task);
  }

  async update(sessionToken: string, taskId: number, input: UpdateTaskRequest): Promise<TaskItem> {
    const body = await this.requestJson<{ task?: unknown }>(sessionToken, `/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return taskFromApi(body.task);
  }

  async complete(sessionToken: string, taskId: number): Promise<TaskItem> {
    return this.mutateStatus(sessionToken, taskId, 'complete');
  }

  async cancel(sessionToken: string, taskId: number): Promise<TaskItem> {
    return this.mutateStatus(sessionToken, taskId, 'cancel');
  }

  private async mutateStatus(sessionToken: string, taskId: number, action: 'complete' | 'cancel'): Promise<TaskItem> {
    const body = await this.requestJson<{ task?: unknown }>(sessionToken, `/api/v1/tasks/${taskId}/${action}`, { method: 'POST' });
    return taskFromApi(body.task);
  }

  private async requestJson<T>(sessionToken: string, path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${sessionToken}`);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      throw new Error('INVALID_TASK_RESPONSE');
    }
    if (!response.ok) {
      const error = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP_${response.status}`;
      throw new Error(error);
    }
    return body as T;
  }
}

export function taskFromApi(raw: unknown): TaskItem {
  if (!raw || typeof raw !== 'object') throw new Error('INVALID_TASK_RESPONSE');
  const value = raw as Record<string, unknown>;
  const id = positiveInteger(value.id);
  const userId = positiveInteger(value.userId);
  const status = String(value.status) as TaskStatus;
  const title = requiredString(value.title);
  const createdAt = requiredString(value.createdAt);
  const updatedAt = requiredString(value.updatedAt);
  if (!id || !userId || !isTaskStatus(status) || !title || !createdAt || !updatedAt) {
    throw new Error('INVALID_TASK_RESPONSE');
  }
  return {
    id,
    userId,
    sourceId: nullablePositiveInteger(value.sourceId),
    recordId: nullablePositiveInteger(value.recordId),
    title,
    body: nullableString(value.body),
    status,
    dueAt: nullableString(value.dueAt),
    remindAt: nullableString(value.remindAt),
    reminderNotifiedAt: nullableString(value.reminderNotifiedAt),
    completedAt: nullableString(value.completedAt),
    cancelledAt: nullableString(value.cancelledAt),
    createdAt,
    updatedAt,
  };
}

export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'OPEN': return '待處理';
    case 'COMPLETED': return '已完成';
    case 'CANCELLED': return '已取消';
  }
}

function isTaskStatus(value: string): value is TaskStatus {
  return value === 'OPEN' || value === 'COMPLETED' || value === 'CANCELLED';
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  return positiveInteger(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
