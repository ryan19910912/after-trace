import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { WorklogRecordReadService, type WorklogPwaSurfaces } from './records';

export type WorklogRoutesBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
};

type WorklogEnv = {
  Bindings: WorklogRoutesBindings;
  Variables: { lineUserId: string };
};

type WorklogRouteContext = {
  userId: number;
  database: Database;
  records: WorklogRecordReadService;
};

type RecordFilter = {
  entityId: number | null;
  query: string | null;
  from: Date | null;
  to: Date | null;
  limit: number;
  offset: number;
};

type SourceAccess = 'PRIVATE' | 'GROUP';

type RecordSnapshot = {
  id: number;
  sourceId: number;
  entityId: number | null;
  rawText: string;
  occurredAt: Date;
  status: 'ACTIVE' | 'DELETED';
  version: number;
};

/**
 * Authenticated customer PWA API.
 *
 * Manual Record operations are free data operations. PRIVATE access is Source-owner
 * scoped; GROUP access is active membership scoped. No subscription, legacy Owner or
 * AI-point check is allowed on this route module unless an endpoint explicitly invokes
 * provider AI in a future batch.
 */
export function createWorklogRoutes() {
  const app = new Hono<WorklogEnv>();

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
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = authSecret(c.env);
    if (!secret) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifyWebSessionToken(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    c.set('lineUserId', session.lineUserId);
    await next();
  });

  app.get('/surfaces', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    return c.json({ ok: true, userId: context.userId, surfaces: await entitledSurfaces(context) });
  });

  app.get('/records/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const sourceId = await personalSourceId(context);
    if (!sourceId) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, sourceId, filter, 'ACTIVE')) });
  });

  app.get('/records/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if ((await sourceAccess(context.database, context.userId, sourceId)) !== 'GROUP') {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, sourceId, filter, 'ACTIVE')) });
  });

  app.get('/records/personal/deleted', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const sourceId = await personalSourceId(context);
    if (!sourceId) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, sourceId, filter, 'DELETED')) });
  });

  app.get('/records/group/:sourceId/deleted', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if ((await sourceAccess(context.database, context.userId, sourceId)) !== 'GROUP') {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, sourceId, filter, 'DELETED')) });
  });

  app.get('/entities/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const sourceId = await personalSourceId(context);
    if (!sourceId) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    return c.json({ ok: true, entities: await listEntities(context.database, sourceId, query(c.req.query('q'))) });
  });

  app.get('/entities/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if ((await sourceAccess(context.database, context.userId, sourceId)) !== 'GROUP') {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    return c.json({ ok: true, entities: await listEntities(context.database, sourceId, query(c.req.query('q'))) });
  });

  app.post('/records/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const sourceId = await personalSourceId(context);
    if (!sourceId) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    return createManualRecord(c, context, sourceId);
  });

  app.post('/records/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    if ((await sourceAccess(context.database, context.userId, sourceId)) !== 'GROUP') {
      return c.json({ ok: false, error: 'GROUP_ACCESS_FORBIDDEN' }, 403);
    }
    return createManualRecord(c, context, sourceId);
  });

  app.patch('/records/:recordId', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const current = await recordSnapshot(context.database, recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await sourceAccess(context.database, context.userId, current.sourceId))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    if (current.status !== 'ACTIVE') return c.json({ ok: false, error: 'RECORD_DELETED' }, 409);

    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const expectedVersion = positiveInteger(body.expectedVersion);
    if (!expectedVersion) return c.json({ ok: false, error: 'EXPECTED_VERSION_REQUIRED' }, 400);
    const nextText = body.rawText === undefined ? current.rawText : requiredText(body.rawText, 20000);
    if (!nextText) return c.json({ ok: false, error: 'RECORD_TEXT_REQUIRED' }, 400);
    const nextOccurredAt = body.occurredAt === undefined ? current.occurredAt : dateValue(body.occurredAt);
    if (!nextOccurredAt) return c.json({ ok: false, error: 'INVALID_OCCURRED_AT' }, 400);
    if (nextText === current.rawText && nextOccurredAt.getTime() === current.occurredAt.getTime()) {
      return c.json({ ok: true, record: await recordById(context.database, recordId) });
    }

    const updated = await mutateRecord(context.database, current, {
      expectedVersion,
      actorUserId: context.userId,
      channel: 'PWA_MANUAL',
      rawText: nextText,
      occurredAt: nextOccurredAt,
      entityId: current.entityId,
      status: 'ACTIVE',
      deletedAt: null,
      deletedByUserId: null,
    });
    if (!updated) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    return c.json({ ok: true, record: updated });
  });

  app.post('/records/:recordId/move', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const current = await recordSnapshot(context.database, recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await sourceAccess(context.database, context.userId, current.sourceId))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    if (current.status !== 'ACTIVE') return c.json({ ok: false, error: 'RECORD_DELETED' }, 409);
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const expectedVersion = positiveInteger(body.expectedVersion);
    if (!expectedVersion) return c.json({ ok: false, error: 'EXPECTED_VERSION_REQUIRED' }, 400);
    const entity = await resolveManualEntity(context.database, current.sourceId, context.userId, body);
    if ('error' in entity) return c.json({ ok: false, error: entity.error }, 400);
    if (current.entityId === entity.id) return c.json({ ok: true, record: await recordById(context.database, recordId) });

    const updated = await mutateRecord(context.database, current, {
      expectedVersion,
      actorUserId: context.userId,
      channel: 'PWA_MANUAL',
      rawText: current.rawText,
      occurredAt: current.occurredAt,
      entityId: entity.id,
      status: 'ACTIVE',
      deletedAt: null,
      deletedByUserId: null,
    });
    if (!updated) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    return c.json({ ok: true, record: updated });
  });

  app.post('/records/batch-move', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const body = await objectBody(c);
    if (!body || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > 100) {
      return c.json({ ok: false, error: 'RECORD_BATCH_REQUIRED' }, 400);
    }
    const requested = body.records.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      const id = positiveInteger(row.id);
      const expectedVersion = positiveInteger(row.expectedVersion);
      return id && expectedVersion ? { id, expectedVersion } : null;
    });
    if (requested.some((value) => value === null)) return c.json({ ok: false, error: 'INVALID_RECORD_BATCH' }, 400);
    const ids = requested.map((value) => value!.id);
    if (new Set(ids).size !== ids.length) return c.json({ ok: false, error: 'DUPLICATE_RECORD_ID' }, 400);

    const snapshots = await recordSnapshots(context.database, ids);
    if (snapshots.length !== ids.length) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    const sourceIds = new Set(snapshots.map((row) => row.sourceId));
    if (sourceIds.size !== 1) return c.json({ ok: false, error: 'BATCH_SOURCE_MISMATCH' }, 400);
    const sourceId = snapshots[0]!.sourceId;
    if (!(await sourceAccess(context.database, context.userId, sourceId))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    if (snapshots.some((row) => row.status !== 'ACTIVE')) return c.json({ ok: false, error: 'RECORD_DELETED' }, 409);
    const entity = await resolveManualEntity(context.database, sourceId, context.userId, body);
    if ('error' in entity) return c.json({ ok: false, error: entity.error }, 400);

    const expected = new Map(requested.map((row) => [row!.id, row!.expectedVersion]));
    if (snapshots.some((row) => expected.get(row.id) !== row.version)) {
      return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    }

    const result = await context.database.execute(sql`
      WITH target AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(requested)}::jsonb)
          AS item(id bigint, "expectedVersion" integer)
      ), eligible AS (
        SELECT r.*
        FROM worklog_records r
        INNER JOIN target t ON t.id = r.id AND t."expectedVersion" = r.version
        WHERE r.source_id = ${sourceId} AND r.status = 'ACTIVE'
      ), can_update AS (
        SELECT COUNT(*)::integer AS count FROM eligible
      ), updated AS (
        UPDATE worklog_records r
        SET entity_id = ${entity.id}, version = r.version + 1, updated_at = NOW()
        FROM target t, can_update c
        WHERE c.count = ${requested.length}
          AND r.id = t.id
          AND r.version = t."expectedVersion"
          AND r.source_id = ${sourceId}
          AND r.status = 'ACTIVE'
        RETURNING r.*
      ), revisions AS (
        INSERT INTO worklog_record_revisions (
          record_id, version, editor_user_id, channel,
          previous_raw_text, new_raw_text,
          previous_occurred_at, new_occurred_at,
          previous_entity_id, new_entity_id,
          previous_status, new_status, created_at
        )
        SELECT e.id, u.version, ${context.userId}, 'PWA_MANUAL',
               e.raw_text, u.raw_text, e.occurred_at, u.occurred_at,
               e.entity_id, u.entity_id, e.status, u.status, NOW()
        FROM eligible e INNER JOIN updated u ON u.id = e.id
        RETURNING record_id
      )
      SELECT COUNT(*)::text AS updated_count FROM updated
    `);
    const updatedCount = Number((result.rows[0] as { updated_count?: string } | undefined)?.updated_count ?? 0);
    if (updatedCount !== requested.length) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    return c.json({ ok: true, updatedCount });
  });

  app.delete('/records/:recordId', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const current = await recordSnapshot(context.database, recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await sourceAccess(context.database, context.userId, current.sourceId))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    if (current.status === 'DELETED') return c.json({ ok: true, record: await recordById(context.database, recordId) });
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const expectedVersion = positiveInteger(body.expectedVersion);
    if (!expectedVersion) return c.json({ ok: false, error: 'EXPECTED_VERSION_REQUIRED' }, 400);
    const deletedAt = new Date();
    const updated = await mutateRecord(context.database, current, {
      expectedVersion,
      actorUserId: context.userId,
      channel: 'PWA_DELETE',
      rawText: current.rawText,
      occurredAt: current.occurredAt,
      entityId: current.entityId,
      status: 'DELETED',
      deletedAt,
      deletedByUserId: context.userId,
    });
    if (!updated) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    return c.json({ ok: true, record: updated });
  });

  app.post('/records/:recordId/restore', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const current = await recordSnapshot(context.database, recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await sourceAccess(context.database, context.userId, current.sourceId))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    if (current.status === 'ACTIVE') return c.json({ ok: true, record: await recordById(context.database, recordId) });
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const expectedVersion = positiveInteger(body.expectedVersion);
    if (!expectedVersion) return c.json({ ok: false, error: 'EXPECTED_VERSION_REQUIRED' }, 400);
    const updated = await mutateRecord(context.database, current, {
      expectedVersion,
      actorUserId: context.userId,
      channel: 'PWA_RESTORE',
      rawText: current.rawText,
      occurredAt: current.occurredAt,
      entityId: current.entityId,
      status: 'ACTIVE',
      deletedAt: null,
      deletedByUserId: null,
    });
    if (!updated) return c.json({ ok: false, error: 'RECORD_VERSION_CONFLICT' }, 409);
    return c.json({ ok: true, record: updated });
  });

  app.get('/records/:recordId/revisions', async (c) => {
    const recordId = positiveId(c.req.param('recordId'));
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const current = await recordSnapshot(context.database, recordId);
    if (!current) return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    if (!(await sourceAccess(context.database, context.userId, current.sourceId))) {
      return c.json({ ok: false, error: 'RECORD_ACCESS_FORBIDDEN' }, 403);
    }
    const result = await context.database.execute(sql`
      SELECT revision.id::text AS id,
             revision.record_id::text AS record_id,
             revision.version,
             revision.editor_user_id::text AS editor_user_id,
             editor.display_name AS editor_display_name,
             revision.channel,
             revision.previous_raw_text,
             revision.new_raw_text,
             revision.previous_occurred_at,
             revision.new_occurred_at,
             revision.previous_entity_id::text AS previous_entity_id,
             previous_entity.name AS previous_title,
             revision.new_entity_id::text AS new_entity_id,
             new_entity.name AS new_title,
             revision.previous_status,
             revision.new_status,
             revision.created_at
      FROM worklog_record_revisions revision
      LEFT JOIN worklog_users editor ON editor.id = revision.editor_user_id
      LEFT JOIN worklog_entities previous_entity ON previous_entity.id = revision.previous_entity_id
      LEFT JOIN worklog_entities new_entity ON new_entity.id = revision.new_entity_id
      WHERE revision.record_id = ${recordId}
      ORDER BY revision.version DESC, revision.id DESC
      LIMIT 200
    `);
    return c.json({ ok: true, revisions: result.rows });
  });

  app.post('/feedback', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const text = requiredText(body.text, 5000);
    if (!text) return c.json({ ok: false, error: 'FEEDBACK_TEXT_REQUIRED' }, 400);
    const contextJson = safeFeedbackContext(body.context);
    const result = await context.database.execute(sql`
      INSERT INTO worklog_feedback (
        user_id, display_name_snapshot, channel, text, context, created_at
      )
      SELECT id, display_name, 'PWA', ${text}, ${JSON.stringify(contextJson)}::jsonb, NOW()
      FROM worklog_users WHERE id = ${context.userId}
      RETURNING id::text AS id, channel, created_at
    `);
    return c.json({ ok: true, feedback: result.rows[0] }, 201);
  });

  return app;
}

async function createManualRecord(
  c: { req: { json(): Promise<unknown> }; json(value: unknown, status?: number): Response },
  context: WorklogRouteContext,
  sourceId: number,
) {
  const body = await objectBody(c);
  if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
  const rawText = requiredText(body.rawText, 20000);
  if (!rawText) return c.json({ ok: false, error: 'RECORD_TEXT_REQUIRED' }, 400);
  const occurredAt = dateValue(body.occurredAt);
  if (!occurredAt) return c.json({ ok: false, error: 'INVALID_OCCURRED_AT' }, 400);
  const entity = await resolveManualEntity(context.database, sourceId, context.userId, body);
  if ('error' in entity) return c.json({ ok: false, error: entity.error }, 400);
  const result = await context.database.execute(sql`
    INSERT INTO worklog_records (
      source_id, entity_id, author_user_id, input_type, raw_text, occurred_at,
      status, version, created_at, updated_at
    ) VALUES (
      ${sourceId}, ${entity.id}, ${context.userId}, 'TEXT', ${rawText}, ${occurredAt},
      'ACTIVE', 1, NOW(), NOW()
    )
    RETURNING id::text AS id
  `);
  const id = Number((result.rows[0] as { id?: string } | undefined)?.id ?? 0);
  return c.json({ ok: true, record: await recordById(context.database, id) }, 201);
}

async function contextFor(
  databaseUrl: string,
  lineUserId: string,
): Promise<WorklogRouteContext | null> {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`
    SELECT id::text AS id FROM worklog_users WHERE line_user_id = ${lineUserId} LIMIT 1
  `);
  const raw = (result.rows[0] as { id?: string } | undefined)?.id;
  const userId = raw ? Number(raw) : 0;
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const recordRepository = new DrizzleWorklogRecordReadRepository(database);
  return {
    userId,
    database,
    records: new WorklogRecordReadService(recordRepository),
  };
}

async function entitledSurfaces(context: WorklogRouteContext): Promise<WorklogPwaSurfaces> {
  return context.records.surfaces(context.userId);
}

async function personalSourceId(context: WorklogRouteContext): Promise<number | null> {
  const surfaces = await context.records.surfaces(context.userId);
  return surfaces.personal?.sourceId ?? null;
}

async function sourceAccess(database: Database, userId: number, sourceId: number): Promise<SourceAccess | null> {
  const result = await database.execute(sql`
    SELECT source.type,
           source.private_user_id::text AS private_user_id,
           EXISTS (
             SELECT 1 FROM worklog_source_members member
             WHERE member.source_id = source.id
               AND member.user_id = ${userId}
               AND member.is_active = TRUE
           ) AS active_member
    FROM worklog_sources source
    WHERE source.id = ${sourceId} AND source.status = 'ACTIVE'
    LIMIT 1
  `);
  const row = result.rows[0] as { type?: string; private_user_id?: string | null; active_member?: boolean } | undefined;
  if (!row) return null;
  if (row.type === 'PRIVATE' && Number(row.private_user_id) === userId) return 'PRIVATE';
  if (row.type === 'GROUP' && row.active_member) return 'GROUP';
  return null;
}

async function listEntities(database: Database, sourceId: number, q: string | null) {
  const result = await database.execute(sql`
    SELECT entity.id::text AS id,
           entity.name,
           entity.entity_type,
           entity.status,
           entity.updated_at,
           COALESCE((
             SELECT jsonb_agg(alias.alias ORDER BY alias.alias)
             FROM worklog_entity_aliases alias
             WHERE alias.entity_id = entity.id
           ), '[]'::jsonb) AS aliases
    FROM worklog_entities entity
    WHERE entity.source_id = ${sourceId}
      AND entity.status = 'ACTIVE'
      AND (
        ${q}::text IS NULL
        OR entity.name ILIKE '%' || ${q} || '%'
        OR EXISTS (
          SELECT 1 FROM worklog_entity_aliases alias
          WHERE alias.entity_id = entity.id AND alias.alias ILIKE '%' || ${q} || '%'
        )
      )
    ORDER BY CASE WHEN ${q}::text IS NOT NULL AND entity.name ILIKE ${q} THEN 0 ELSE 1 END,
             entity.name ASC
    LIMIT 50
  `);
  return result.rows;
}

async function resolveManualEntity(
  database: Database,
  sourceId: number,
  actorUserId: number,
  body: Record<string, unknown>,
): Promise<{ id: number; name: string } | { error: string }> {
  const suppliedId = positiveInteger(body.entityId);
  if (suppliedId) {
    const result = await database.execute(sql`
      SELECT id::text AS id, name
      FROM worklog_entities
      WHERE id = ${suppliedId} AND source_id = ${sourceId} AND status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as { id?: string; name?: string } | undefined;
    return row?.id && row.name ? { id: Number(row.id), name: row.name } : { error: 'ENTITY_NOT_FOUND' };
  }

  const title = requiredText(body.title, 255);
  if (!title) return { error: 'RECORD_TITLE_REQUIRED' };
  const existing = await database.execute(sql`
    SELECT entity.id::text AS id, entity.name, 0 AS priority
    FROM worklog_entities entity
    WHERE entity.source_id = ${sourceId} AND entity.status = 'ACTIVE' AND lower(entity.name) = lower(${title})
    UNION ALL
    SELECT entity.id::text AS id, entity.name, 1 AS priority
    FROM worklog_entity_aliases alias
    INNER JOIN worklog_entities entity ON entity.id = alias.entity_id
    WHERE alias.source_id = ${sourceId} AND entity.status = 'ACTIVE' AND lower(alias.alias) = lower(${title})
    ORDER BY priority ASC
    LIMIT 1
  `);
  const found = existing.rows[0] as { id?: string; name?: string } | undefined;
  if (found?.id && found.name) return { id: Number(found.id), name: found.name };

  const inserted = await database.execute(sql`
    INSERT INTO worklog_entities (source_id, name, status, created_at, updated_at)
    VALUES (${sourceId}, ${title}, 'ACTIVE', NOW(), NOW())
    ON CONFLICT (source_id, name) DO UPDATE SET updated_at = worklog_entities.updated_at
    RETURNING id::text AS id, name
  `);
  const row = inserted.rows[0] as { id?: string; name?: string } | undefined;
  if (!row?.id || !row.name) return { error: 'ENTITY_CREATE_FAILED' };

  // Keep the actor in the function signature intentionally: manual title creation is
  // user-driven and later audit/entity-created-by expansion can use this without
  // changing the API contract. No AI inference is invoked here.
  void actorUserId;
  return { id: Number(row.id), name: row.name };
}

async function filteredRecords(
  database: Database,
  sourceId: number,
  filter: RecordFilter,
  status: 'ACTIVE' | 'DELETED',
) {
  const result = await database.execute(sql`
    SELECT record.id::text AS id,
           record.source_id::text AS source_id,
           record.entity_id::text AS entity_id,
           entity.name AS title,
           record.author_user_id::text AS author_user_id,
           author.display_name AS author_display_name,
           record.input_type,
           record.raw_text,
           record.occurred_at,
           record.status,
           record.version,
           record.deleted_at,
           record.deleted_by_user_id::text AS deleted_by_user_id,
           record.created_at,
           record.updated_at
    FROM worklog_records record
    LEFT JOIN worklog_entities entity ON entity.id = record.entity_id
    LEFT JOIN worklog_users author ON author.id = record.author_user_id
    WHERE record.source_id = ${sourceId}
      AND record.status = ${status}
      AND (${filter.entityId}::bigint IS NULL OR record.entity_id = ${filter.entityId})
      AND (
        ${filter.query}::text IS NULL
        OR COALESCE(record.raw_text, '') ILIKE '%' || ${filter.query} || '%'
        OR COALESCE(entity.name, '') ILIKE '%' || ${filter.query} || '%'
        OR EXISTS (
          SELECT 1 FROM worklog_entity_aliases alias
          WHERE alias.entity_id = record.entity_id
            AND alias.alias ILIKE '%' || ${filter.query} || '%'
        )
      )
      AND (${filter.from}::timestamptz IS NULL OR record.occurred_at >= ${filter.from})
      AND (${filter.to}::timestamptz IS NULL OR record.occurred_at < ${filter.to})
    ORDER BY record.occurred_at DESC, record.id DESC
    LIMIT ${filter.limit + 1}
    OFFSET ${filter.offset}
  `);
  const rows = result.rows;
  const hasMore = rows.length > filter.limit;
  const records = hasMore ? rows.slice(0, filter.limit) : rows;
  return {
    records,
    page: {
      limit: filter.limit,
      offset: filter.offset,
      hasMore,
      nextOffset: hasMore ? filter.offset + filter.limit : null,
    },
  };
}

async function recordSnapshot(database: Database, recordId: number): Promise<RecordSnapshot | null> {
  const rows = await recordSnapshots(database, [recordId]);
  return rows[0] ?? null;
}

async function recordSnapshots(database: Database, ids: number[]): Promise<RecordSnapshot[]> {
  const result = await database.execute(sql`
    SELECT id::text AS id, source_id::text AS source_id, entity_id::text AS entity_id,
           raw_text, occurred_at, status, version
    FROM worklog_records
    WHERE id = ANY(${ids}::bigint[])
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    sourceId: Number(row.source_id),
    entityId: row.entity_id == null ? null : Number(row.entity_id),
    rawText: String(row.raw_text),
    occurredAt: new Date(String(row.occurred_at)),
    status: String(row.status) as 'ACTIVE' | 'DELETED',
    version: Number(row.version),
  }));
}

async function mutateRecord(
  database: Database,
  current: RecordSnapshot,
  next: {
    expectedVersion: number;
    actorUserId: number;
    channel: 'PWA_MANUAL' | 'PWA_DELETE' | 'PWA_RESTORE';
    rawText: string;
    occurredAt: Date;
    entityId: number | null;
    status: 'ACTIVE' | 'DELETED';
    deletedAt: Date | null;
    deletedByUserId: number | null;
  },
) {
  const result = await database.execute(sql`
    WITH previous AS (
      SELECT * FROM worklog_records
      WHERE id = ${current.id} AND version = ${next.expectedVersion}
      LIMIT 1
    ), updated AS (
      UPDATE worklog_records record
      SET raw_text = ${next.rawText},
          occurred_at = ${next.occurredAt},
          entity_id = ${next.entityId},
          status = ${next.status},
          deleted_at = ${next.deletedAt},
          deleted_by_user_id = ${next.deletedByUserId},
          version = record.version + 1,
          updated_at = NOW()
      FROM previous
      WHERE record.id = previous.id
        AND record.version = ${next.expectedVersion}
      RETURNING record.*
    ), revision AS (
      INSERT INTO worklog_record_revisions (
        record_id, version, editor_user_id, channel,
        previous_raw_text, new_raw_text,
        previous_occurred_at, new_occurred_at,
        previous_entity_id, new_entity_id,
        previous_status, new_status, created_at
      )
      SELECT previous.id, updated.version, ${next.actorUserId}, ${next.channel},
             previous.raw_text, updated.raw_text,
             previous.occurred_at, updated.occurred_at,
             previous.entity_id, updated.entity_id,
             previous.status, updated.status, NOW()
      FROM previous INNER JOIN updated ON updated.id = previous.id
      RETURNING record_id
    )
    SELECT updated.id::text AS id FROM updated
  `);
  const id = (result.rows[0] as { id?: string } | undefined)?.id;
  return id ? recordById(database, Number(id)) : null;
}

async function recordById(database: Database, recordId: number) {
  const result = await database.execute(sql`
    SELECT record.id::text AS id,
           record.source_id::text AS source_id,
           record.entity_id::text AS entity_id,
           entity.name AS title,
           record.author_user_id::text AS author_user_id,
           author.display_name AS author_display_name,
           record.input_type,
           record.raw_text,
           record.occurred_at,
           record.status,
           record.version,
           record.deleted_at,
           record.deleted_by_user_id::text AS deleted_by_user_id,
           record.created_at,
           record.updated_at
    FROM worklog_records record
    LEFT JOIN worklog_entities entity ON entity.id = record.entity_id
    LEFT JOIN worklog_users author ON author.id = record.author_user_id
    WHERE record.id = ${recordId}
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

function recordFilter(params: Record<string, string>): RecordFilter | { error: string } {
  const entityId = params.entityId ? positiveId(params.entityId) : null;
  if (params.entityId && !entityId) return { error: 'INVALID_ENTITY_ID' };
  const from = params.from ? dateValue(params.from) : null;
  if (params.from && !from) return { error: 'INVALID_FROM_DATE' };
  const to = params.to ? dateValue(params.to) : null;
  if (params.to && !to) return { error: 'INVALID_TO_DATE' };
  if (from && to && from >= to) return { error: 'INVALID_DATE_RANGE' };
  return {
    entityId,
    query: query(params.q),
    from,
    to,
    limit: listLimit(params.limit, 50),
    offset: offsetValue(params.offset),
  };
}

function authSecret(env: WorklogRoutesBindings): string | null {
  const value = env.WEB_AUTH_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const value = match[1]?.trim() ?? '';
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

function query(value: string | undefined): string | null {
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

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeFeedbackContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['page', 'viewport', 'userAgent', 'appVersion', 'scopeType', 'sourceId']) {
    const item = raw[key];
    if (typeof item === 'string' && item.length <= 500) result[key] = item;
    if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
  }
  return result;
}
