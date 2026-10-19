export type WorklogTaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export type WorklogTask = {
  id: number;
  userId: number;
  sourceId: number | null;
  recordId: number | null;
  title: string;
  body: string | null;
  status: WorklogTaskStatus;
  dueAt: string | null;
  remindAt: string | null;
  reminderNotifiedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskInput = {
  userId: number;
  title: string;
  body?: string | null;
  sourceId?: number | null;
  recordId?: number | null;
  dueAt?: Date | null;
  remindAt?: Date | null;
};

export type UpdateTaskInput = {
  title?: string;
  body?: string | null;
  dueAt?: Date | null;
  remindAt?: Date | null;
};

export type DueTaskNotificationResult = {
  examined: number;
  notified: number;
  skipped: number;
};

export interface TaskRepository {
  listForUser(userId: number, limit: number): Promise<WorklogTask[]>;
  create(input: CreateTaskInput): Promise<WorklogTask>;
  update(userId: number, taskId: number, input: UpdateTaskInput): Promise<WorklogTask | null>;
  complete(userId: number, taskId: number): Promise<WorklogTask | null>;
  cancel(userId: number, taskId: number): Promise<WorklogTask | null>;
  dispatchDueReminderNotifications(limit: number): Promise<DueTaskNotificationResult>;
}

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  listForUser(userId: number, limit = 50): Promise<WorklogTask[]> {
    return this.repository.listForUser(validUserId(userId), boundedLimit(limit));
  }

  create(input: CreateTaskInput): Promise<WorklogTask> {
    const normalized = normalizeCreate(input);
    return this.repository.create(normalized);
  }

  update(userId: number, taskId: number, input: UpdateTaskInput): Promise<WorklogTask | null> {
    const normalized: UpdateTaskInput = {};
    if ('title' in input) normalized.title = requiredText(input.title ?? '', 255, 'INVALID_TASK_TITLE');
    if ('body' in input) normalized.body = optionalText(input.body, 10_000);
    if ('dueAt' in input) normalized.dueAt = validOptionalDate(input.dueAt, 'INVALID_TASK_DUE_AT');
    if ('remindAt' in input) normalized.remindAt = validOptionalDate(input.remindAt, 'INVALID_TASK_REMIND_AT');
    if (Object.keys(normalized).length === 0) throw new Error('TASK_UPDATE_REQUIRED');
    return this.repository.update(validUserId(userId), validId(taskId, 'INVALID_TASK_ID'), normalized);
  }

  complete(userId: number, taskId: number): Promise<WorklogTask | null> {
    return this.repository.complete(validUserId(userId), validId(taskId, 'INVALID_TASK_ID'));
  }

  cancel(userId: number, taskId: number): Promise<WorklogTask | null> {
    return this.repository.cancel(validUserId(userId), validId(taskId, 'INVALID_TASK_ID'));
  }

  dispatchDueReminderNotifications(limit = 50): Promise<DueTaskNotificationResult> {
    return this.repository.dispatchDueReminderNotifications(boundedLimit(limit, 100));
  }
}

function normalizeCreate(input: CreateTaskInput): CreateTaskInput {
  const sourceId = validOptionalId(input.sourceId, 'INVALID_SOURCE_ID');
  const recordId = validOptionalId(input.recordId, 'INVALID_RECORD_ID');
  if (recordId !== null && sourceId === null) throw new Error('TASK_SOURCE_REQUIRED_FOR_RECORD');
  return {
    userId: validUserId(input.userId),
    title: requiredText(input.title, 255, 'INVALID_TASK_TITLE'),
    body: optionalText(input.body, 10_000),
    sourceId,
    recordId,
    dueAt: validOptionalDate(input.dueAt, 'INVALID_TASK_DUE_AT'),
    remindAt: validOptionalDate(input.remindAt, 'INVALID_TASK_REMIND_AT'),
  };
}

function validUserId(value: number): number {
  return validId(value, 'INVALID_USER_ID');
}

function validId(value: number, error: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(error);
  return value;
}

function validOptionalId(value: number | null | undefined, error: string): number | null {
  if (value === undefined || value === null) return null;
  return validId(value, error);
}

function validOptionalDate(value: Date | null | undefined, error: string): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(error);
  return value;
}

function requiredText(value: string, max: number, error: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > max) throw new Error('INVALID_TASK_BODY');
  return normalized;
}

function boundedLimit(value: number, max = 100): number {
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : Math.min(50, max);
}
