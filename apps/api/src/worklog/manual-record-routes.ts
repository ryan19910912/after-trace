import { Hono, type Context } from 'hono';
import { allowedProductClientOrigin } from '../auth/product-client-origin';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { DrizzleManualRecordRouteRepository } from './drizzle-manual-record-routes';
import { parseRecordCaptureContext, type RecordCaptureContext } from './record-capture-context';
import type { WorklogPwaSurfaces } from './records';

export type ManualRecordRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

export type ManualRecordView = {
  id: number;
  sourceId: number;
  entityId: number | null;
  title: string | null;
  authorUserId: number | null;
  authorDisplayName: string | null;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
  rawText: string;
  captureContext: RecordCaptureContext | null;
  occurredAt: string | null;
  status: 'ACTIVE' | 'DELETED';
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualRecordRevisionView = {
  id: number;
  recordId: number;
  version: number;
  editorUserId: number | null;
  editorDisplayName: string | null;
  channel: string;
  previousRawText: string;
  newRawText: string;
  previousOccurredAt: string | null;
  newOccurredAt: string | null;
  previousEntityId: number | null;
  previousTitle: string | null;
  newEntityId: number | null;
  newTitle: string | null;
  previousStatus: 'ACTIVE' | 'DELETED';
  newStatus: 'ACTIVE' | 'DELETED';
  createdAt: string;
};

export type ManualRecordFilters = {
  query: string | null;
  from: Date | null;
  to: Date | null;
  limit: number;
  offset: number;
};

export type ManualRecordPage = {
  records: ManualRecordView[];
  page: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
};

export interface ManualRecordRouteRepository {
  surfaces(userId: number): Promise<WorklogPwaSurfaces>;
  personalSourceId(userId: number): Promise<number | null>;
  hasGroupAccess(userId: number, sourceId: number): Promise<boolean>;
  legacyEntity(sourceId: number, entityId: number): Promise<{ id: number; name: string } | null>;
  listRecords(input: {
    sourceId: number;
    status: 'ACTIVE' | 'DELETED';
    filters: ManualRecordFilters;
  }): Promise<ManualRecordPage>;
  record(recordId: number): Promise<ManualRecordView | null>;
  create(input: {
    sourceId: number;
    actorUserId: number;
    rawText: string;
    captureContext: RecordCaptureContext | null;
    occurredAt: Date | null;
    title: string | null;
    entityId: number | null;
  }): Promise<ManualRecordView>;
  mutate(input: {
    recordId: number;
    expectedVersion: number;
    actorUserId: number;
    channel: 'PWA_MANUAL' | 'PWA_DELETE' | 'PWA_RESTORE';
    rawText: string;
    occurredAt: Date | null;
    status: 'ACTIVE' | 'DELETED';
    deletedAt: Date | null;
    deletedByUserId: number | null;
  }): Promise<ManualRecordView | null>;
  revisions(recordId: number): Promise<ManualRecordRevisionView[]>;
}

export type ManualRecordRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  verifySession?: (token: string, secret: string, now?: Date) => Promise<WebSessionClaims | null>;
  resolveSessionUserId?: (database: Database, session: WebSessionClaims) => Promise<number | null>;
  repositoryFactory?: (database: Database) => ManualRecordRouteRepository;
};

type ManualRecordEnv = {
  Bindings: ManualRecordRoutesBindings;
  Variables: {
    userId: number;
    database: Database;
    repository: ManualRecordRouteRepository;
  };
};

type ManualRecordContext = Context<ManualRecordEnv>;

export function createManualRecordRoutes(dependencies: ManualRecordRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const repositoryFactory = dependencies.repositoryFactory
    ?? ((database: Database) => new DrizzleManualRecordRouteRepository(database));
  const app = new Hono<ManualRecordEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (origin && !allowedOrigin) {
      return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (allowedOrigin) {
      c.header('Access-Control-Allow-Origin', allowedOrigin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (!allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifySession(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = databaseFactory(c.env.DATABASE_URL);
    const userId = await resolveSessionUser(database, session);
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database);
    c.set('userId', userId);
    c.set('repository', repositoryFactory(database));
    await next();
  });

  app.get('/surfaces', async (c) => {
    return c.json({ ok: true, userId: c.get('userId'), surfaces: await c.get('repository').surfaces(c.get('userId')) });
  });

  app.get('/records/personal', async (c) => listScopedRecords(c, 'PERSONAL', 'ACTIVE'));
  app.get('/records/personal/deleted', async (c) => listScopedRecords(c, 'PERSONAL', 'DELETED'));
  app.get('/records/group/:sourceId', async (c) => listScopedRecords(c, 'GROUP', 'ACTIVE'));
  app.get('/records/group/:sourceId/deleted', async (c) => listScopedRecords(c, 'GROUP', 'DELETED'));

  app.post('/records/personal', async (c) => createScopedRecord(c, 'PERSONAL'));
  app.post('/records/group/:sourceId', async (c) => createScopedRecord(c, 'GROUP'));

  app.patch('/records/:recordId', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const repository = c.get('repository');
    const current = await repository.record(recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await canAccessRecord(repository, c.get('userId'), current))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    if (current.status !== 'ACTIVE') return c.json({ ok: false, error: 'RECORD_DELETED' }, 409);

    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    if (Object.hasOwn(body, 'captureContext')) {
      return c.json({ ok: false, error: 'CAPTURE_CONTEXT_IMMUTABLE' }, 400);
    }
    const expectedVersion = positiveInteger(body.expectedVersion);
    if (!expectedVersion) return c.json({ ok: false, error: 'EXPECTED_VERSION_REQUIRED' }, 400);
    if (expectedVersion !== current.version) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);

    const rawValue = Object.hasOwn(body, 'rawText') ? body.rawText : body.content;
    const nextRawText = rawValue === undefined ? current.rawText : requiredText(rawValue, 20000);
    if (!nextRawText) return c.json({ ok: false, error: 'RECORD_TEXT_REQUIRED' }, 400);
    const occurredValue = Object.hasOwn(body, 'occurredAt') ? body.occurredAt : undefined;
    const occurredAt = occurredValue === undefined ? dateFromStored(current.occurredAt) : optionalDate(occurredValue);
    if (occurredAt === 'INVALID') return c.json({ ok: false, error: 'INVALID_OCCURRED_AT' }, 400);

    if (nextRawText === current.rawText && sameDate(occurredAt, dateFromStored(current.occurredAt))) {
      return c.json({ ok: true, record: current });
    }

    const updated = await repository.mutate({
      recordId,
      expectedVersion,
      actorUserId: c.get('userId'),
      channel: 'PWA_MANUAL',
      rawText: nextRawText,
      occurredAt,
      status: 'ACTIVE',
      deletedAt: null,
      deletedByUserId: null,
    });
    if (!updated) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    return c.json({ ok: true, record: updated });
  });

  app.delete('/records/:recordId', async (c) => mutateStatus(c, 'DELETED'));
  app.post('/records/:recordId/restore', async (c) => mutateStatus(c, 'ACTIVE'));

  app.get('/records/:recordId/revisions', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const repository = c.get('repository');
    const current = await repository.record(recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await canAccessRecord(repository, c.get('userId'), current))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    return c.json({ ok: true, revisions: await repository.revisions(recordId) });
  });

  return app;
}

async function listScopedRecords(
  c: ManualRecordContext,
  scope: 'PERSONAL' | 'GROUP',
  status: 'ACTIVE' | 'DELETED',
) {
  const repository = c.get('repository');
  const userId = c.get('userId');
  const sourceId = await scopedSourceId(c, repository, userId, scope);
  if ('response' in sourceId) return sourceId.response;
  const filters = recordFilters(c.req.query());
  if ('error' in filters) return c.json({ ok: false, error: filters.error }, 400);
  return c.json({ ok: true, ...(await repository.listRecords({ sourceId: sourceId.value, status, filters })) });
}

async function createScopedRecord(c: ManualRecordContext, scope: 'PERSONAL' | 'GROUP') {
  const repository = c.get('repository');
  const userId = c.get('userId');
  const sourceId = await scopedSourceId(c, repository, userId, scope);
  if ('response' in sourceId) return sourceId.response;
  const body = await objectBody(c);
  if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
  const rawText = requiredText(body.rawText ?? body.content, 20000);
  if (!rawText) return c.json({ ok: false, error: 'RECORD_TEXT_REQUIRED' }, 400);
  const occurredAt = optionalDate(body.occurredAt);
  if (occurredAt === 'INVALID') return c.json({ ok: false, error: 'INVALID_OCCURRED_AT' }, 400);
  const captureContext = parseRecordCaptureContext(body.captureContext, c.req.header('origin'));
  if (captureContext === 'INVALID') return c.json({ ok: false, error: 'INVALID_CAPTURE_CONTEXT' }, 400);
  const explicitTitle = optionalText(body.title, 255);
  if (explicitTitle === 'INVALID') return c.json({ ok: false, error: 'INVALID_TITLE' }, 400);
  const entityId = optionalPositiveInteger(body.entityId);
  if (entityId === 'INVALID') return c.json({ ok: false, error: 'INVALID_ENTITY_ID' }, 400);
  let title = explicitTitle;
  if (entityId !== null) {
    const entity = await repository.legacyEntity(sourceId.value, entityId);
    if (!entity) return c.json({ ok: false, error: 'ENTITY_NOT_FOUND' }, 400);
    if (!title) title = entity.name;
  }
  const record = await repository.create({
    sourceId: sourceId.value,
    actorUserId: userId,
    rawText,
    captureContext,
    occurredAt,
    title,
    entityId,
  });
  return c.json({ ok: true, record }, 201);
}

async function mutateStatus(c: ManualRecordContext, nextStatus: 'ACTIVE' | 'DELETED') {
  const recordId = positiveId(c.req.param('recordId'));
  if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
  const repository = c.get('repository');
  const userId = c.get('userId');
  const current = await repository.record(recordId);
  if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
  if (!(await canAccessRecord(repository, userId, current))) {
    return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
  }
  if (current.status === nextStatus) return c.json({ ok: true, record: current });
  const body = await objectBody(c);
  if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
  const expectedVersion = positiveInteger(body.expectedVersion);
  if (!expectedVersion) return c.json({ ok: false, error: 'EXPECTED_VERSION_REQUIRED' }, 400);
  const occurredAt = dateFromStored(current.occurredAt);
  const updated = await repository.mutate({
    recordId,
    expectedVersion,
    actorUserId: userId,
    channel: nextStatus === 'DELETED' ? 'PWA_DELETE' : 'PWA_RESTORE',
    rawText: current.rawText,
    occurredAt,
    status: nextStatus,
    deletedAt: nextStatus === 'DELETED' ? new Date() : null,
    deletedByUserId: nextStatus === 'DELETED' ? userId : null,
  });
  if (!updated) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
  return c.json({ ok: true, record: updated });
}

async function scopedSourceId(
  c: ManualRecordContext,
  repository: ManualRecordRouteRepository,
  userId: number,
  scope: 'PERSONAL' | 'GROUP',
): Promise<{ value: number } | { response: Response }> {
  if (scope === 'PERSONAL') {
    const sourceId = await repository.personalSourceId(userId);
    return sourceId ? { value: sourceId } : { response: c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403) };
  }
  const sourceId = positiveId(c.req.param('sourceId'));
  if (!sourceId) return { response: c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400) };
  if (!(await repository.hasGroupAccess(userId, sourceId))) {
    return { response: c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403) };
  }
  return { value: sourceId };
}

async function canAccessRecord(
  repository: ManualRecordRouteRepository,
  userId: number,
  record: ManualRecordView,
): Promise<boolean> {
  const personal = await repository.personalSourceId(userId);
  if (personal === record.sourceId) return true;
  return repository.hasGroupAccess(userId, record.sourceId);
}

function recordFilters(params: Record<string, string>): ManualRecordFilters | { error: string } {
  const from = params.from ? parseDate(params.from) : null;
  if (params.from && !from) return { error: 'INVALID_FROM_DATE' };
  const to = params.to ? parseDate(params.to) : null;
  if (params.to && !to) return { error: 'INVALID_TO_DATE' };
  if (from && to && from >= to) return { error: 'INVALID_DATE_RANGE' };
  return {
    query: searchQuery(params.q),
    from,
    to,
    limit: listLimit(params.limit, 50),
    offset: offsetValue(params.offset),
  };
}

function authSecret(env: ManualRecordRoutesBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const value = match?.[1]?.trim() ?? '';
  return value && value.length <= 8192 ? value : null;
}

async function objectBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalPositiveInteger(value: unknown): number | null | 'INVALID' {
  if (value == null || value === '') return null;
  return positiveInteger(value) ?? 'INVALID';
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function optionalText(value: unknown, max: number): string | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'INVALID';
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : 'INVALID';
}

function optionalDate(value: unknown): Date | null | 'INVALID' {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'INVALID';
  return parseDate(value) ?? 'INVALID';
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFromStored(value: string | null): Date | null {
  if (!value) return null;
  return parseDate(value);
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function searchQuery(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized.slice(0, 300) : null;
}

function listLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : fallback;
}

function offsetValue(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : 0;
}
