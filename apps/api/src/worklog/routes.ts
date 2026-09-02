import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyWebSessionToken } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { WorklogCollaborationService } from './collaboration';
import { DrizzleWorklogCollaborationRepository } from './drizzle-collaboration';
import { DrizzleWorklogRecordReadRepository } from './drizzle-records';
import { DrizzleWorklogUsageRepository } from './drizzle-usage';
import { WorklogRecordReadService } from './records';
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
  records: WorklogRecordReadService;
  usage: WorklogUsageService;
  collaboration: WorklogCollaborationService;
};

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
function safePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createWorklogRoutes() {
  const app = new Hono<WorklogEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.WEB_APP_ORIGIN?.trim();
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
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
    return c.json({ ok: true, userId: context.userId, surfaces: await context.records.surfaces(context.userId) });
  });
  app.get('/records/personal', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    return c.json({ ok: true, records: await context.records.personalRecords(context.userId, safePositiveInt(c.req.query('limit')) ?? 100) });
  });
  app.get('/records/group/:sourceId', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const result = await context.records.groupRecords(context.userId, sourceId, safePositiveInt(c.req.query('limit')) ?? 100);
    return result.status === 'FORBIDDEN' ? c.json({ ok: false, error: 'GROUP_SCOPE_FORBIDDEN' }, 403) : c.json({ ok: true, records: result.records });
  });
  app.get('/usage/me', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    return context ? c.json({ ok: true, usage: await context.usage.userUsage(context.userId) }) : c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
  });
  app.get('/groups/:sourceId/owner-view', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const result = await context.usage.groupOwnerUsage(context.userId, sourceId);
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
    if (result.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: 'OWNER_UNBOUND' }, 409);
    return c.json({ ok: true, ownerView: result.value });
  });
  app.patch('/groups/:sourceId/members/:memberUserId/recording', async (c) => {
    const sourceId = safePositiveInt(c.req.param('sourceId'));
    const memberUserId = safePositiveInt(c.req.param('memberUserId'));
    if (!sourceId || !memberUserId) return c.json({ ok: false, error: 'INVALID_MEMBER_TARGET' }, 400);
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    const body = await objectBody(c);
    if (!body || typeof body.enabled !== 'boolean') return c.json({ ok: false, error: 'ENABLED_BOOLEAN_REQUIRED' }, 400);
    const result = await context.collaboration.setMemberRecordingPermission({ sourceId, actorUserId: context.userId, memberUserId, enabled: body.enabled });
    if (result.status === 'FORBIDDEN') return c.json({ ok: false, error: 'OWNER_ONLY' }, 403);
    if (result.status === 'MEMBER_NOT_FOUND') return c.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, 404);
    if (result.status === 'OWNER_CANNOT_BE_DISABLED') return c.json({ ok: false, error: 'OWNER_CANNOT_BE_DISABLED' }, 409);
    if (result.status === 'OWNER_UNBOUND') return c.json({ ok: false, error: 'OWNER_UNBOUND' }, 409);
    return c.json({ ok: true, recordingEnabled: body.enabled });
  });

  // Workspace-owner management. These endpoints deliberately do not expose another
  // member's customer/project/finance data just because they share one LINE group.
  app.get('/customers', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const result = await owner.database.execute(sql`
      SELECT id::text AS id, name, phone, address, note, created_at, updated_at
      FROM worklog_customers WHERE workspace_id = ${owner.workspaceId}
      ORDER BY updated_at DESC, id DESC LIMIT 500
    `);
    return c.json({ ok: true, customers: result.rows });
  });
  app.post('/customers', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const name = requiredText(body.name, 255); if (!name) return c.json({ ok: false, error: 'CUSTOMER_NAME_REQUIRED' }, 400);
    const result = await owner.database.execute(sql`
      INSERT INTO worklog_customers (workspace_id, name, phone, address, note, created_at, updated_at)
      VALUES (${owner.workspaceId}, ${name}, ${optionalText(body.phone, 64)}, ${optionalText(body.address, 4000)}, ${optionalText(body.note, 10000)}, NOW(), NOW())
      RETURNING id::text AS id, name, phone, address, note, created_at, updated_at
    `);
    return c.json({ ok: true, customer: result.rows[0] }, 201);
  });
  app.patch('/customers/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const customerId = safePositiveInt(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403); if (!customerId) return c.json({ ok: false, error: 'INVALID_CUSTOMER_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const result = await owner.database.execute(sql`
      UPDATE worklog_customers SET
        name = COALESCE(${requiredText(body.name, 255)}, name),
        phone = CASE WHEN ${body.phone !== undefined} THEN ${optionalText(body.phone, 64)} ELSE phone END,
        address = CASE WHEN ${body.address !== undefined} THEN ${optionalText(body.address, 4000)} ELSE address END,
        note = CASE WHEN ${body.note !== undefined} THEN ${optionalText(body.note, 10000)} ELSE note END,
        updated_at = NOW()
      WHERE id = ${customerId} AND workspace_id = ${owner.workspaceId}
      RETURNING id::text AS id, name, phone, address, note, created_at, updated_at
    `);
    return result.rows[0] ? c.json({ ok: true, customer: result.rows[0] }) : c.json({ ok: false, error: 'CUSTOMER_NOT_FOUND' }, 404);
  });

  app.get('/projects', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const result = await owner.database.execute(sql`
      SELECT p.id::text AS id, p.customer_id::text AS customer_id, c.name AS customer_name, p.name, p.address, p.status, p.note, p.created_at, p.updated_at
      FROM worklog_projects p LEFT JOIN worklog_customers c ON c.id = p.customer_id
      WHERE p.workspace_id = ${owner.workspaceId} ORDER BY p.updated_at DESC, p.id DESC LIMIT 500
    `);
    return c.json({ ok: true, projects: result.rows });
  });
  app.post('/projects', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const name = requiredText(body.name, 255); if (!name) return c.json({ ok: false, error: 'PROJECT_NAME_REQUIRED' }, 400);
    const customerId = nullablePositiveId(body.customerId); if (customerId && !(await belongsToWorkspace(owner.database, 'worklog_customers', customerId, owner.workspaceId))) return c.json({ ok: false, error: 'CUSTOMER_NOT_FOUND' }, 404);
    const status = projectStatus(body.status) ?? 'ACTIVE';
    const result = await owner.database.execute(sql`
      INSERT INTO worklog_projects (workspace_id, customer_id, name, address, status, note, created_at, updated_at)
      VALUES (${owner.workspaceId}, ${customerId}, ${name}, ${optionalText(body.address, 4000)}, ${status}, ${optionalText(body.note, 10000)}, NOW(), NOW())
      RETURNING id::text AS id, customer_id::text AS customer_id, name, address, status, note, created_at, updated_at
    `);
    return c.json({ ok: true, project: result.rows[0] }, 201);
  });
  app.patch('/projects/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); const projectId = safePositiveInt(c.req.param('id'));
    if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403); if (!projectId) return c.json({ ok: false, error: 'INVALID_PROJECT_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const customerId = body.customerId === undefined ? undefined : nullablePositiveId(body.customerId);
    if (customerId && !(await belongsToWorkspace(owner.database, 'worklog_customers', customerId, owner.workspaceId))) return c.json({ ok: false, error: 'CUSTOMER_NOT_FOUND' }, 404);
    const status = body.status === undefined ? undefined : projectStatus(body.status); if (body.status !== undefined && !status) return c.json({ ok: false, error: 'INVALID_PROJECT_STATUS' }, 400);
    const result = await owner.database.execute(sql`
      UPDATE worklog_projects SET
        customer_id = CASE WHEN ${body.customerId !== undefined} THEN ${customerId ?? null} ELSE customer_id END,
        name = COALESCE(${requiredText(body.name, 255)}, name),
        address = CASE WHEN ${body.address !== undefined} THEN ${optionalText(body.address, 4000)} ELSE address END,
        status = COALESCE(${status ?? null}::worklog_project_status, status),
        note = CASE WHEN ${body.note !== undefined} THEN ${optionalText(body.note, 10000)} ELSE note END,
        updated_at = NOW()
      WHERE id = ${projectId} AND workspace_id = ${owner.workspaceId}
      RETURNING id::text AS id, customer_id::text AS customer_id, name, address, status, note, created_at, updated_at
    `);
    return result.rows[0] ? c.json({ ok: true, project: result.rows[0] }) : c.json({ ok: false, error: 'PROJECT_NOT_FOUND' }, 404);
  });

  app.patch('/records/:id', async (c) => {
    const context = await contextFor(c.env.DATABASE_URL, c.get('lineUserId')); const recordId = safePositiveInt(c.req.param('id'));
    if (!context) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404); if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const target = await editableRecord(context, recordId); if (!target) return c.json({ ok: false, error: 'RECORD_EDIT_FORBIDDEN' }, 403);
    const customerId = body.customerId === undefined ? undefined : nullablePositiveId(body.customerId);
    const projectId = body.projectId === undefined ? undefined : nullablePositiveId(body.projectId);
    if (customerId && !(await belongsToWorkspace(context.database, 'worklog_customers', customerId, target.workspaceId))) return c.json({ ok: false, error: 'CUSTOMER_NOT_FOUND' }, 404);
    if (projectId && !(await belongsToWorkspace(context.database, 'worklog_projects', projectId, target.workspaceId))) return c.json({ ok: false, error: 'PROJECT_NOT_FOUND' }, 404);
    const result = await context.database.execute(sql`
      UPDATE worklog_records SET
        customer_id = CASE WHEN ${body.customerId !== undefined} THEN ${customerId ?? null} ELSE customer_id END,
        project_id = CASE WHEN ${body.projectId !== undefined} THEN ${projectId ?? null} ELSE project_id END,
        raw_text = CASE WHEN ${body.rawText !== undefined} THEN ${optionalText(body.rawText, 50000)} ELSE raw_text END,
        edited_at = NOW(), updated_at = NOW()
      WHERE id = ${recordId}
      RETURNING id::text AS id, source_id::text AS source_id, customer_id::text AS customer_id, project_id::text AS project_id, raw_text, normalized_summary, edited_at, updated_at
    `);
    return c.json({ ok: true, record: result.rows[0] });
  });

  app.get('/transactions', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const result = await owner.database.execute(sql`
      SELECT t.id::text AS id, t.record_id::text AS record_id, t.customer_id::text AS customer_id, t.project_id::text AS project_id,
             t.type, t.amount_twd::text AS amount_twd, t.occurred_at, t.note, t.created_at, t.updated_at,
             c.name AS customer_name, p.name AS project_name
      FROM worklog_transactions t LEFT JOIN worklog_customers c ON c.id=t.customer_id LEFT JOIN worklog_projects p ON p.id=t.project_id
      WHERE t.workspace_id=${owner.workspaceId} ORDER BY t.occurred_at DESC, t.id DESC LIMIT 500
    `);
    return c.json({ ok: true, transactions: result.rows });
  });
  app.post('/transactions', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL, c.get('lineUserId')); if (!owner) return c.json({ ok: false, error: 'PERSONAL_WORKSPACE_REQUIRED' }, 403);
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const type = transactionType(body.type); const amount = amountTwd(body.amountTwd); const occurredAt = dateValue(body.occurredAt);
    if (!type || amount === null || !occurredAt) return c.json({ ok: false, error: 'INVALID_TRANSACTION' }, 400);
    const customerId = nullablePositiveId(body.customerId), projectId = nullablePositiveId(body.projectId), recordId = nullablePositiveId(body.recordId);
    if (customerId && !(await belongsToWorkspace(owner.database,'worklog_customers',customerId,owner.workspaceId))) return c.json({ok:false,error:'CUSTOMER_NOT_FOUND'},404);
    if (projectId && !(await belongsToWorkspace(owner.database,'worklog_projects',projectId,owner.workspaceId))) return c.json({ok:false,error:'PROJECT_NOT_FOUND'},404);
    if (recordId && !(await belongsToWorkspace(owner.database,'worklog_records',recordId,owner.workspaceId))) return c.json({ok:false,error:'RECORD_NOT_FOUND'},404);
    const result = await owner.database.execute(sql`
      INSERT INTO worklog_transactions (workspace_id, record_id, customer_id, project_id, type, amount_twd, occurred_at, note, created_at, updated_at)
      VALUES (${owner.workspaceId}, ${recordId}, ${customerId}, ${projectId}, ${type}, ${amount}, ${occurredAt}, ${optionalText(body.note,10000)}, NOW(), NOW())
      RETURNING id::text AS id, record_id::text AS record_id, customer_id::text AS customer_id, project_id::text AS project_id, type, amount_twd::text AS amount_twd, occurred_at, note, created_at, updated_at
    `);
    return c.json({ok:true,transaction:result.rows[0]},201);
  });
  app.delete('/transactions/:id', async (c) => {
    const owner = await ownerContext(c.env.DATABASE_URL,c.get('lineUserId')); const transactionId=safePositiveInt(c.req.param('id'));
    if(!owner)return c.json({ok:false,error:'PERSONAL_WORKSPACE_REQUIRED'},403); if(!transactionId)return c.json({ok:false,error:'INVALID_TRANSACTION_ID'},400);
    const result=await owner.database.execute(sql`DELETE FROM worklog_transactions WHERE id=${transactionId} AND workspace_id=${owner.workspaceId} RETURNING id`);
    return result.rows.length ? c.json({ok:true}) : c.json({ok:false,error:'TRANSACTION_NOT_FOUND'},404);
  });

  return app;
}

async function contextFor(databaseUrl: string, lineUserId: string): Promise<WorklogRouteContext | null> {
  const database = createDatabase(databaseUrl);
  const result = await database.execute(sql`SELECT id::text AS id FROM worklog_users WHERE line_user_id=${lineUserId} LIMIT 1`);
  const raw=(result.rows[0] as {id?:string}|undefined)?.id; const userId=raw?Number(raw):0;
  if(!Number.isSafeInteger(userId)||userId<=0)return null;
  return { userId, database, records:new WorklogRecordReadService(new DrizzleWorklogRecordReadRepository(database)), usage:new WorklogUsageService(new DrizzleWorklogUsageRepository(database)), collaboration:new WorklogCollaborationService(new DrizzleWorklogCollaborationRepository(database)) };
}
async function ownerContext(databaseUrl:string,lineUserId:string){
  const context=await contextFor(databaseUrl,lineUserId); if(!context)return null;
  const result=await context.database.execute(sql`SELECT w.id::text AS workspace_id FROM worklog_workspaces w INNER JOIN worklog_users u ON u.id=w.owner_user_id WHERE w.owner_user_id=${context.userId} AND u.is_oa_friend=TRUE LIMIT 1`);
  const raw=(result.rows[0] as {workspace_id?:string}|undefined)?.workspace_id; const workspaceId=raw?Number(raw):0;
  return Number.isSafeInteger(workspaceId)&&workspaceId>0 ? {...context,workspaceId} : null;
}
async function editableRecord(context:WorklogRouteContext,recordId:number){
  const result=await context.database.execute(sql`
    SELECT r.workspace_id::text AS workspace_id, r.author_user_id::text AS author_user_id,
           EXISTS(SELECT 1 FROM worklog_workspaces w WHERE w.id=r.workspace_id AND w.owner_user_id=${context.userId}) AS workspace_owner,
           EXISTS(SELECT 1 FROM worklog_source_members m WHERE m.source_id=r.source_id AND m.user_id=${context.userId} AND m.is_active=TRUE) AS active_member
    FROM worklog_records r WHERE r.id=${recordId} LIMIT 1
  `);
  const row=result.rows[0] as {workspace_id?:string;author_user_id?:string|null;workspace_owner?:boolean;active_member?:boolean}|undefined;
  if(!row?.workspace_id)return null; const author=row.author_user_id?Number(row.author_user_id):null;
  if(!row.workspace_owner && author!==context.userId)return null;
  return {workspaceId:Number(row.workspace_id)};
}
async function belongsToWorkspace(database:Database,table:'worklog_customers'|'worklog_projects'|'worklog_records',id:number,workspaceId:number){
  const result = table==='worklog_customers' ? await database.execute(sql`SELECT 1 FROM worklog_customers WHERE id=${id} AND workspace_id=${workspaceId}`)
    : table==='worklog_projects' ? await database.execute(sql`SELECT 1 FROM worklog_projects WHERE id=${id} AND workspace_id=${workspaceId}`)
    : await database.execute(sql`SELECT 1 FROM worklog_records WHERE id=${id} AND workspace_id=${workspaceId}`);
  return result.rows.length>0;
}
async function objectBody(c:{req:{json():Promise<unknown>}}){try{const v=await c.req.json();return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}}
function requiredText(value:unknown,max:number){if(value===undefined)return null;if(typeof value!=='string')return null;const v=value.trim();return v&&v.length<=max?v:null;}
function optionalText(value:unknown,max:number){if(value===null||value===undefined)return null;if(typeof value!=='string')return null;const v=value.trim();return v?v.slice(0,max):null;}
function nullablePositiveId(value:unknown){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function projectStatus(value:unknown){return value==='ACTIVE'||value==='COMPLETED'||value==='ARCHIVED'?value:null;}
function transactionType(value:unknown){return value==='RECEIVED'||value==='EXPENSE'||value==='RECEIVABLE'?value:null;}
function amountTwd(value:unknown){const n=typeof value==='number'?value:Number(value);return Number.isFinite(n)&&n>=0&&n<=999999999999?n.toFixed(2):null;}
function dateValue(value:unknown){if(typeof value!=='string')return null;const d=new Date(value);return Number.isNaN(d.getTime())?null:d;}
