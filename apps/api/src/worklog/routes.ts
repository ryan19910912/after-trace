import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { WorklogCollaborationService } from './collaboration';
import { DrizzleWorklogCollaborationRepository } from './drizzle-collaboration';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { DrizzleWorklogUsageRepository } from './drizzle-usage';
import {
  DrizzleWorklogWorkspaceManagementRepository,
  type WorklogCustomerInput,
  type WorklogProjectInput,
  type WorklogRecordEditInput,
  type WorklogTransactionInput,
} from './drizzle-workspace-management';
import { WorklogRecordReadService, type WorklogPwaSurfaces } from './records';
import { WorklogUsageService } from './usage';

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
  recordRepository: DrizzleWorklogRecordReadRepository;
  records: WorklogRecordReadService;
  usage: WorklogUsageService;
  collaboration: WorklogCollaborationService;
  management: DrizzleWorklogWorkspaceManagementRepository;
};

type RecordFilter = {
  query: string | null;
  inputType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE' | null;
  category: WorklogRecordEditInput['category'] | null;
  customerId: number | null;
  projectId: number | null;
  from: Date | null;
  to: Date | null;
  limit: number;
  offset: number;
};

export function createWorklogRoutes() {
  const app = new Hono<WorklogEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
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
    const surfaces = await context.records.surfaces(context.userId);
    if (!surfaces.personal) return c.json({ ok: false, error: 'PERSONAL_SCOPE_FORBIDDEN' }, 403);
    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, surfaces.personal.sourceId, filter)) });
  });

  app.get('/records/group/:sourceId', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const access = await context.collaboration.authorizeGroupAccess({
      sourceId,
      actorUserId: context.userId,
    });
    if (access.status === 'GROUP_NOT_FOUND') return c.json({ ok: false, error: access.status }, 404);
    if (access.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: access.status }, 409);
    if (access.status !== 'OK') {
      return c.json({
        ok: false,
        error: access.status,
        ...('ownerPlanDisplayName' in access && access.ownerPlanDisplayName
          ? { ownerPlanDisplayName: access.ownerPlanDisplayName }
          : {}),
        ...('maxGroupCount' in access && access.maxGroupCount !== undefined
          ? { maxGroupCount: access.maxGroupCount }
          : {}),
      }, 403);
    }
    const filter = recordFilter(c.req.query());
    if ('error' in filter) return c.json({ ok: false, error: filter.error }, 400);
    return c.json({ ok: true, ...(await filteredRecords(context.database, sourceId, filter)) });
  });

  app.get('/usage/me', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    return context
      ? c.json({ ok: true, usage: await context.usage.userUsage(context.userId) })
      : c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
  });

  app.get('/groups/:sourceId/owner-view', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const result = await context.usage.groupOwnerUsage(context.userId, sourceId);
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
    if (result.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: 'OWNER_UNBOUND' }, 409);
    return c.json({ ok: true, ownerView: result.value });
  });

  app.patch('/groups/:sourceId/members/:memberUserId/recording', async (c) => {
    const sourceId = positiveId(c.req.param('sourceId'));
    const memberUserId = positiveId(c.req.param('memberUserId'));
    if (!sourceId || !memberUserId) return c.json({ ok: false, error: 'INVALID_MEMBER_TARGET' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const body = await objectBody(c);
    if (!body || typeof body.enabled !== 'boolean') return c.json({ ok: false, error: 'ENABLED_BOOLEAN_REQUIRED' }, 400);
    const result = await context.collaboration.setMemberRecordingPermission({
      sourceId,
      actorUserId: context.userId,
      memberUserId,
      enabled: body.enabled,
    });
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
    if (result.status === 'MEMBER_NOT_FOUND') return c.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, 404);
    if (result.status === 'OWNER_CANNOT_BE_DISABLED') return c.json({ ok: false, error: 'OWNER_CANNOT_BE_DISABLED' }, 409);
    if (result.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: 'OWNER_UNBOUND' }, 409);
    return c.json({ ok: true, recordingEnabled: body.enabled });
  });

  // Customer/project/finance management is intentionally restricted to the user's
  // own workspace. Group membership alone never grants access to another owner's CRM/finance data.
  app.get('/customers', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    return c.json({ ok: true, customers: await owner.context.management.listCustomers(owner.workspaceId, query(c.req.query('q')), listLimit(c.req.query('limit'), 200)) });
  });

  app.post('/customers', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = customerInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const customer = await owner.context.management.createCustomer(owner.workspaceId, owner.context.userId, input);
    return c.json({ ok: true, customer }, 201);
  });

  app.put('/customers/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const customerId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!customerId) return c.json({ ok: false, error: 'INVALID_CUSTOMER_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = customerInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const customer = await owner.context.management.updateCustomer(owner.workspaceId, owner.context.userId, customerId, input);
    return customer ? c.json({ ok: true, customer }) : c.json({ ok: false, error: 'CUSTOMER_NOT_FOUND' }, 404);
  });

  app.delete('/customers/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const customerId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!customerId) return c.json({ ok: false, error: 'INVALID_CUSTOMER_ID' }, 400);
    const result = await owner.context.management.deleteCustomer(owner.workspaceId, owner.context.userId, customerId);
    if (result === 'IN_USE') return c.json({ ok: false, error: 'CUSTOMER_IN_USE' }, 409);
    if (result === 'NOT_FOUND') return c.json({ ok: false, error: 'CUSTOMER_NOT_FOUND' }, 404);
    return c.json({ ok: true });
  });

  app.get('/projects', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const status = optionalProjectStatus(c.req.query('status'));
    if (c.req.query('status') && !status) return c.json({ ok: false, error: 'INVALID_PROJECT_STATUS' }, 400);
    return c.json({ ok: true, projects: await owner.context.management.listProjects(owner.workspaceId, query(c.req.query('q')), status, listLimit(c.req.query('limit'), 200)) });
  });

  app.post('/projects', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = projectInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const result = await owner.context.management.createProject(owner.workspaceId, owner.context.userId, input);
    return result.status === 'CUSTOMER_NOT_FOUND'
      ? c.json({ ok: false, error: result.status }, 404)
      : c.json({ ok: true, project: result.project }, 201);
  });

  app.put('/projects/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const projectId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!projectId) return c.json({ ok: false, error: 'INVALID_PROJECT_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = projectInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const result = await owner.context.management.updateProject(owner.workspaceId, owner.context.userId, projectId, input);
    if (result.status === 'CUSTOMER_NOT_FOUND') return c.json({ ok: false, error: result.status }, 404);
    if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: 'PROJECT_NOT_FOUND' }, 404);
    return c.json({ ok: true, project: result.project });
  });

  app.delete('/projects/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const projectId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!projectId) return c.json({ ok: false, error: 'INVALID_PROJECT_ID' }, 400);
    const result = await owner.context.management.deleteProject(owner.workspaceId, owner.context.userId, projectId);
    if (result === 'IN_USE') return c.json({ ok: false, error: 'PROJECT_IN_USE' }, 409);
    if (result === 'NOT_FOUND') return c.json({ ok: false, error: 'PROJECT_NOT_FOUND' }, 404);
    return c.json({ ok: true });
  });

  app.patch('/records/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const recordId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = recordEditInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const result = await owner.context.management.updateRecord(owner.workspaceId, owner.context.userId, recordId, input);
    if (result.status === 'CUSTOMER_NOT_FOUND' || result.status === 'PROJECT_NOT_FOUND') return c.json({ ok: false, error: result.status }, 404);
    if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: 'RECORD_NOT_FOUND' }, 404);
    return c.json({ ok: true, record: result.record });
  });

  app.get('/transactions', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const projectId = optionalPositiveId(c.req.query('projectId'));
    if (c.req.query('projectId') && projectId === null) return c.json({ ok: false, error: 'INVALID_PROJECT_ID' }, 400);
    return c.json({ ok: true, transactions: await owner.context.management.listTransactions(owner.workspaceId, projectId, listLimit(c.req.query('limit'), 200)) });
  });

  app.post('/transactions', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = transactionInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const result = await owner.context.management.createTransaction(owner.workspaceId, owner.context.userId, input);
    return transactionResult(c, result, 201);
  });

  app.put('/transactions/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const transactionId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!transactionId) return c.json({ ok: false, error: 'INVALID_TRANSACTION_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const input = transactionInput(body); if ('error' in input) return c.json({ ok: false, error: input.error }, 400);
    const result = await owner.context.management.updateTransaction(owner.workspaceId, owner.context.userId, transactionId, input);
    return transactionResult(c, result, 200);
  });

  app.delete('/transactions/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const transactionId = positiveId(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    if (!transactionId) return c.json({ ok: false, error: 'INVALID_TRANSACTION_ID' }, 400);
    return await owner.context.management.deleteTransaction(owner.workspaceId, owner.context.userId, transactionId)
      ? c.json({ ok: true })
      : c.json({ ok: false, error: 'TRANSACTION_NOT_FOUND' }, 404);
  });

  app.post('/feedback', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const text = requiredText(body.text, 5000); if (!text) return c.json({ ok: false, error: 'FEEDBACK_TEXT_REQUIRED' }, 400);
    const contextJson = safeFeedbackContext(body.context);
    const result = await context.database.execute(sql`
      INSERT INTO worklog_feedback (user_id, display_name_snapshot, channel, text, context, created_at)
      SELECT id, display_name, 'PWA', ${text}, ${JSON.stringify(contextJson)}::jsonb, NOW()
      FROM worklog_users WHERE id = ${context.userId}
      RETURNING id::text AS id, channel, created_at
    `);
    return c.json({ ok: true, feedback: result.rows[0] }, 201);
  });

  return app;
}

async function contextFor(databaseUrl: string, lineUserId: string): Promise<WorklogRouteContext | null> {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`SELECT id::text AS id FROM worklog_users WHERE line_user_id = ${lineUserId} LIMIT 1`);
  const raw = (result.rows[0] as { id?: string } | undefined)?.id;
  const userId = raw ? Number(raw) : 0;
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const recordRepository = new DrizzleWorklogRecordReadRepository(database);
  return {
    userId,
    database,
    recordRepository,
    records: new WorklogRecordReadService(recordRepository),
    usage: new WorklogUsageService(new DrizzleWorklogUsageRepository(database)),
    collaboration: new WorklogCollaborationService(new DrizzleWorklogCollaborationRepository(database)),
    management: new DrizzleWorklogWorkspaceManagementRepository(database),
  };
}

async function entitledSurfaces(context: WorklogRouteContext): Promise<WorklogPwaSurfaces> {
  const surfaces = await context.records.surfaces(context.userId);
  const checked = await Promise.all(surfaces.groups.map(async (group) => ({
    group,
    access: await context.collaboration.authorizeGroupAccess({
      sourceId: group.sourceId,
      actorUserId: context.userId,
    }),
  })));
  return {
    personal: surfaces.personal,
    groups: checked.filter((item) => item.access.status === 'OK').map((item) => item.group),
  };
}

async function ownerContext(databaseUrl: string, lineUserId: string) {
  const context = await contextFor(databaseUrl, lineUserId);
  if (!context) return null;
  const surfaces = await context.records.surfaces(context.userId);
  if (!surfaces.personal) return null;
  const workspaceId = await context.management.ownedWorkspaceId(context.userId);
  return workspaceId ? { context, workspaceId } : null;
}

async function filteredRecords(database: Database, sourceId: number, filter: RecordFilter) {
  const result = await database.execute(sql`
    SELECT record.id::text AS id, record.source_id::text AS source_id, record.author_user_id::text AS author_user_id,
           record.input_type, record.category, record.raw_text, record.normalized_summary,
           record.customer_id::text AS customer_id, customer.name AS customer_name,
           record.project_id::text AS project_id, project.name AS project_name,
           record.source_timestamp, record.edited_at, record.created_at, record.updated_at
    FROM worklog_records record
    LEFT JOIN worklog_customers customer ON customer.id = record.customer_id
    LEFT JOIN worklog_projects project ON project.id = record.project_id
    WHERE record.source_id = ${sourceId}
      AND (${filter.query}::text IS NULL OR COALESCE(record.normalized_summary, '') ILIKE '%' || ${filter.query} || '%' OR COALESCE(record.raw_text, '') ILIKE '%' || ${filter.query} || '%' OR COALESCE(customer.name, '') ILIKE '%' || ${filter.query} || '%' OR COALESCE(project.name, '') ILIKE '%' || ${filter.query} || '%')
      AND (${filter.inputType}::text IS NULL OR record.input_type::text = ${filter.inputType})
      AND (${filter.category}::text IS NULL OR record.category::text = ${filter.category})
      AND (${filter.customerId}::bigint IS NULL OR record.customer_id = ${filter.customerId})
      AND (${filter.projectId}::bigint IS NULL OR record.project_id = ${filter.projectId})
      AND (${filter.from}::timestamptz IS NULL OR COALESCE(record.source_timestamp, record.created_at) >= ${filter.from})
      AND (${filter.to}::timestamptz IS NULL OR COALESCE(record.source_timestamp, record.created_at) < ${filter.to})
    ORDER BY COALESCE(record.source_timestamp, record.created_at) DESC, record.id DESC
    LIMIT ${filter.limit + 1} OFFSET ${filter.offset}
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

function recordFilter(params: Record<string, string>): RecordFilter | { error: string } {
  const inputType = params.type ? inputTypeValue(params.type) : null;
  if (params.type && !inputType) return { error: 'INVALID_INPUT_TYPE' };
  const category = params.category ? categoryValue(params.category) : null;
  if (params.category && !category) return { error: 'INVALID_RECORD_CATEGORY' };
  const customerId = params.customerId ? positiveId(params.customerId) : null;
  if (params.customerId && !customerId) return { error: 'INVALID_CUSTOMER_ID' };
  const projectId = params.projectId ? positiveId(params.projectId) : null;
  if (params.projectId && !projectId) return { error: 'INVALID_PROJECT_ID' };
  const from = params.from ? dateValue(params.from) : null;
  if (params.from && !from) return { error: 'INVALID_FROM_DATE' };
  const to = params.to ? dateValue(params.to) : null;
  if (params.to && !to) return { error: 'INVALID_TO_DATE' };
  if (from && to && from >= to) return { error: 'INVALID_DATE_RANGE' };
  return {
    query: query(params.q),
    inputType,
    category,
    customerId,
    projectId,
    from,
    to,
    limit: listLimit(params.limit, 50),
    offset: offsetValue(params.offset),
  };
}

function customerInput(body: Record<string, unknown>): WorklogCustomerInput | { error: string } {
  const name = requiredText(body.name, 255); if (!name) return { error: 'CUSTOMER_NAME_REQUIRED' };
  return { name, phone: optionalText(body.phone, 64), address: optionalText(body.address, 4000), note: optionalText(body.note, 10000) };
}

function projectInput(body: Record<string, unknown>): WorklogProjectInput | { error: string } {
  const name = requiredText(body.name, 255); if (!name) return { error: 'PROJECT_NAME_REQUIRED' };
  const customerId = nullablePositiveId(body.customerId); if (body.customerId != null && !customerId) return { error: 'INVALID_CUSTOMER_ID' };
  const status = optionalProjectStatus(typeof body.status === 'string' ? body.status : undefined) ?? 'ACTIVE';
  if (body.status !== undefined && !optionalProjectStatus(String(body.status))) return { error: 'INVALID_PROJECT_STATUS' };
  return { customerId, name, address: optionalText(body.address, 4000), status, note: optionalText(body.note, 10000) };
}

function recordEditInput(body: Record<string, unknown>): WorklogRecordEditInput | { error: string } {
  const category = categoryValue(body.category);
  if (!category) return { error: 'INVALID_RECORD_CATEGORY' };
  const customerId = nullablePositiveId(body.customerId); if (body.customerId != null && !customerId) return { error: 'INVALID_CUSTOMER_ID' };
  const projectId = nullablePositiveId(body.projectId); if (body.projectId != null && !projectId) return { error: 'INVALID_PROJECT_ID' };
  const summary = body.normalizedSummary == null ? null : requiredText(body.normalizedSummary, 20000);
  if (body.normalizedSummary != null && !summary) return { error: 'INVALID_RECORD_SUMMARY' };
  return { normalizedSummary: summary, category, customerId, projectId };
}

function transactionInput(body: Record<string, unknown>): WorklogTransactionInput | { error: string } {
  const type = transactionType(body.type); if (!type) return { error: 'INVALID_TRANSACTION_TYPE' };
  const amountTwd = money(body.amountTwd); if (!amountTwd) return { error: 'INVALID_TRANSACTION_AMOUNT' };
  const occurredAt = dateValue(body.occurredAt); if (!occurredAt) return { error: 'INVALID_TRANSACTION_DATE' };
  const recordId = nullablePositiveId(body.recordId); if (body.recordId != null && !recordId) return { error: 'INVALID_RECORD_ID' };
  const customerId = nullablePositiveId(body.customerId); if (body.customerId != null && !customerId) return { error: 'INVALID_CUSTOMER_ID' };
  const projectId = nullablePositiveId(body.projectId); if (body.projectId != null && !projectId) return { error: 'INVALID_PROJECT_ID' };
  return { recordId, customerId, projectId, type, amountTwd, occurredAt, note: optionalText(body.note, 10000) };
}

function transactionResult(c: any, result: any, successStatus: 200 | 201) {
  if (result.status === 'RECORD_NOT_FOUND' || result.status === 'CUSTOMER_NOT_FOUND' || result.status === 'PROJECT_NOT_FOUND') {
    return c.json({ ok: false, error: result.status }, 404);
  }
  if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: 'TRANSACTION_NOT_FOUND' }, 404);
  return c.json({ ok: true, transaction: result.transaction }, successStatus);
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
  try { const value = await c.req.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
function positiveId(value: string): number | null { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function nullablePositiveId(value: unknown): number | null { if (value == null || value === '') return null; const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function optionalPositiveId(value: string | undefined): number | null { return value ? positiveId(value) : null; }
function query(value: string | undefined): string | null { const normalized = value?.trim() ?? ''; return normalized ? normalized.slice(0, 300) : null; }
function listLimit(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : fallback; }
function offsetValue(value: string | undefined): number { const parsed = Number(value ?? 0); return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : 0; }
function requiredText(value: unknown, max: number): string | null { if (typeof value !== 'string') return null; const normalized = value.trim(); return normalized && normalized.length <= max ? normalized : null; }
function optionalText(value: unknown, max: number): string | null { if (value == null || value === '') return null; return requiredText(value, max); }
function dateValue(value: unknown): Date | null { if (typeof value !== 'string') return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function money(value: unknown): string | null { const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''; return /^\d{1,12}(?:\.\d{1,2})?$/.test(raw) && Number(raw) > 0 ? raw : null; }
function inputTypeValue(value: unknown): RecordFilter['inputType'] { return value === 'TEXT' || value === 'AUDIO' || value === 'IMAGE' || value === 'FILE' ? value : null; }
function categoryValue(value: unknown): WorklogRecordEditInput['category'] | null { return value === 'NOTE' || value === 'WORK' || value === 'ISSUE' || value === 'PAYMENT' || value === 'EXPENSE' || value === 'MATERIAL' || value === 'PHOTO' || value === 'AUDIO' || value === 'OTHER' ? value : null; }
function optionalProjectStatus(value: string | undefined): WorklogProjectInput['status'] | null { return value === 'ACTIVE' || value === 'COMPLETED' || value === 'ARCHIVED' ? value : null; }
function transactionType(value: unknown): WorklogTransactionInput['type'] | null { return value === 'RECEIVED' || value === 'EXPENSE' || value === 'RECEIVABLE' ? value : null; }
function safeFeedbackContext(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; const raw = value as Record<string, unknown>; const result: Record<string, unknown> = {}; for (const key of ['page','viewport','userAgent','appVersion','scopeType','sourceId']) { const item = raw[key]; if (typeof item === 'string' && item.length <= 500) result[key] = item; if (typeof item === 'number' && Number.isFinite(item)) result[key] = item; } return result; }
