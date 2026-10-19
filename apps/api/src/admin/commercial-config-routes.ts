import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';
import { createDatabase, type Database } from '../db/client';
import { CommercialConfigService, type CommercialConfigRepository } from '../worklog/commercial-config';
import { DrizzleCommercialConfigRepository } from '../worklog/drizzle-commercial-config';

export type AdminCommercialConfigBindings = AdminAccessEnv & { DATABASE_URL: string; ADMIN_WEB_ORIGIN?: string };
export type AdminCommercialConfigDependencies = { databaseFactory?: (databaseUrl: string) => Database; repositoryFactory?: (database: Database) => CommercialConfigRepository; verifySession?: typeof verifyAdminSessionToken };
type Env = { Bindings: AdminCommercialConfigBindings; Variables: { adminUsername: string; database: Database } };

const DEFAULT_LIMITS = { maxImagesPerRequest: 1, maxImageBytes: 5 * 1024 * 1024, maxAudioSeconds: 300, maxAudioBytes: 10 * 1024 * 1024, maxFileBytes: 10 * 1024 * 1024 };

export function createAdminCommercialConfigRoutes(dependencies: AdminCommercialConfigDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const repositoryFactory = dependencies.repositoryFactory ?? ((database: Database) => new DrizzleCommercialConfigRepository(database));
  const verifySession = dependencies.verifySession ?? verifyAdminSessionToken;
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin'); const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) return c.json({ ok: false, error: allowed ? 'ORIGIN_NOT_ALLOWED' : 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, allowed ? 403 : 503);
    await next(); c.header('Cache-Control', 'no-store');
    if (origin && allowed === origin) { c.header('Access-Control-Allow-Origin', origin); c.header('Vary', 'Origin'); }
  });
  app.options('*', (c) => {
    const origin = c.req.header('origin'); const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowed || origin !== allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin); c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type'); c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); c.header('Vary', 'Origin'); return c.body(null, 204);
  });
  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization')); if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity; try { identity = await verifySession(token, c.env); } catch { return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503); }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username); c.set('database', databaseFactory(c.env.DATABASE_URL)); await next();
  });

  app.get('/free-ai-trial', async (c) => {
    const config = await serviceFor(c, repositoryFactory).getFreeAiTrialConfig();
    return config ? c.json({ ok: true, config }) : c.json({ ok: false, error: 'FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED' }, 404);
  });
  app.put('/free-ai-trial', async (c) => {
    const body = await jsonBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const raw = body.freeInitialAiTrialPoints; const points = typeof raw === 'number' ? raw : Number(raw);
    try { return c.json({ ok: true, config: await serviceFor(c, repositoryFactory).setFreeAiTrialPoints(points, c.get('adminUsername')) }); }
    catch (error) { return c.json({ ok: false, error: errorCode(error, 'FREE_AI_TRIAL_CONFIG_UPDATE_FAILED') }, 400); }
  });

  app.get('/ai-pro', async (c) => {
    const config = await serviceFor(c, repositoryFactory).getAiProConfig();
    return config ? c.json({ ok: true, config }) : c.json({ ok: false, error: 'AI_PRO_CONFIG_NOT_INITIALIZED' }, 404);
  });
  app.put('/ai-pro', async (c) => {
    const body = await jsonBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const monthlyAiPointCap = Number(body.monthlyAiPointCap);
    const perRequestRaw = body.perRequestAiPointCap;
    const perRequestAiPointCap = perRequestRaw === null || perRequestRaw === undefined || perRequestRaw === '' ? null : Number(perRequestRaw);
    try {
      const config = await serviceFor(c, repositoryFactory).setAiProConfig({
        enabled: body.enabled !== false,
        aiMediaIngestion: body.aiMediaIngestion !== false,
        aiNaturalSearch: body.aiNaturalSearch !== false,
        aiRelatedRecords: body.aiRelatedRecords !== false,
        aiTimeRangeSummary: body.aiTimeRangeSummary !== false,
        aiRecordRewrite: body.aiRecordRewrite !== false,
        aiTaskProposal: body.aiTaskProposal !== false,
        monthlyAiPointCap,
        monthlyProviderCostCapTwd: text(body.monthlyProviderCostCapTwd),
        perRequestAiPointCap,
      }, c.get('adminUsername'));
      return c.json({ ok: true, config });
    } catch (error) { return c.json({ ok: false, error: errorCode(error, 'AI_PRO_CONFIG_UPDATE_FAILED') }, 400); }
  });

  app.get('/plans', async (c) => c.json({ ok: true, plans: await subscriptionPlans(c.get('database')) }));

  app.post('/plans', async (c) => {
    const body = await jsonBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const parsed = parsePlanInput(body, true); if ('error' in parsed) return c.json({ ok: false, error: parsed.error }, 400);
    const db = c.get('database'); const code = parsed.value.code || generatedPlanCode(parsed.value.priceTwd);
    const existing = await db.execute(sql`SELECT 1 FROM worklog_subscription_plans WHERE code = ${code} LIMIT 1`);
    if (existing.rows[0]) return c.json({ ok: false, error: 'PLAN_CODE_ALREADY_EXISTS' }, 409);
    await writePlan(db, code, parsed.value, c.get('adminUsername'), 'SUBSCRIPTION_PLAN_CREATED');
    return c.json({ ok: true, plan: await subscriptionPlan(db, code) }, 201);
  });

  app.put('/plans/:code', async (c) => {
    const code = planCode(c.req.param('code')); if (!code) return c.json({ ok: false, error: 'INVALID_PLAN_CODE' }, 400);
    const body = await jsonBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const parsed = parsePlanInput({ ...body, code }, false); if ('error' in parsed) return c.json({ ok: false, error: parsed.error }, 400);
    const db = c.get('database'); const exists = await db.execute(sql`SELECT 1 FROM worklog_subscription_plans WHERE code = ${code} AND plan_type = 'SUBSCRIPTION' LIMIT 1`);
    if (!exists.rows[0]) return c.json({ ok: false, error: 'PLAN_NOT_FOUND' }, 404);
    await writePlan(db, code, parsed.value, c.get('adminUsername'), 'SUBSCRIPTION_PLAN_UPDATED');
    return c.json({ ok: true, plan: await subscriptionPlan(db, code) });
  });

  return app;
}

type PlanInput = {
  code: string | null; displayName: string; priceTwd: string; enabled: boolean;
  aiMediaIngestion: boolean; aiNaturalSearch: boolean; aiRelatedRecords: boolean; aiTimeRangeSummary: boolean; aiRecordRewrite: boolean; aiTaskProposal: boolean;
  monthlyAiPointCap: number; monthlyProviderCostCapTwd: string; perRequestAiPointCap: number | null;
  maxImagesPerRequest: number; maxImageBytes: number; maxAudioSeconds: number; maxAudioBytes: number; maxFileBytes: number;
};

function parsePlanInput(body: Record<string, unknown>, allowGeneratedCode: boolean): { value: PlanInput } | { error: string } {
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const price = text(body.priceTwd); const monthlyPoints = Number(body.monthlyAiPointCap); const providerCap = text(body.monthlyProviderCostCapTwd);
  const requestRaw = body.perRequestAiPointCap; const requestCap = requestRaw == null || requestRaw === '' ? null : Number(requestRaw);
  const code = body.code == null || body.code === '' ? null : planCode(String(body.code));
  if (!displayName || displayName.length > 100) return { error: 'INVALID_PLAN_NAME' };
  if (!/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0 || Number(price) > 100000) return { error: 'INVALID_PLAN_PRICE' };
  if (!Number.isSafeInteger(monthlyPoints) || monthlyPoints <= 0) return { error: 'INVALID_MONTHLY_AI_POINT_CAP' };
  if (!/^\d+(?:\.\d{1,6})?$/.test(providerCap) || Number(providerCap) <= 0) return { error: 'INVALID_PROVIDER_COST_CAP' };
  if (requestCap !== null && (!Number.isSafeInteger(requestCap) || requestCap <= 0 || requestCap > monthlyPoints)) return { error: 'INVALID_PER_REQUEST_AI_POINT_CAP' };
  if (body.code && !code) return { error: 'INVALID_PLAN_CODE' };
  if (!allowGeneratedCode && !code) return { error: 'INVALID_PLAN_CODE' };
  const maxImagesPerRequest = boundedInt(body.maxImagesPerRequest, DEFAULT_LIMITS.maxImagesPerRequest, 1, 10);
  const maxImageBytes = boundedInt(body.maxImageBytes, DEFAULT_LIMITS.maxImageBytes, 1024, 20 * 1024 * 1024);
  const maxAudioSeconds = boundedInt(body.maxAudioSeconds, DEFAULT_LIMITS.maxAudioSeconds, 1, 3600);
  const maxAudioBytes = boundedInt(body.maxAudioBytes, DEFAULT_LIMITS.maxAudioBytes, 1024, 30 * 1024 * 1024);
  const maxFileBytes = boundedInt(body.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, 1024, 30 * 1024 * 1024);
  if ([maxImagesPerRequest,maxImageBytes,maxAudioSeconds,maxAudioBytes,maxFileBytes].some((v) => v === null)) return { error: 'INVALID_MEDIA_LIMIT' };
  return { value: {
    code, displayName, priceTwd: price, enabled: body.enabled !== false,
    aiMediaIngestion: body.aiMediaIngestion !== false, aiNaturalSearch: body.aiNaturalSearch !== false, aiRelatedRecords: body.aiRelatedRecords !== false,
    aiTimeRangeSummary: body.aiTimeRangeSummary !== false, aiRecordRewrite: body.aiRecordRewrite !== false, aiTaskProposal: body.aiTaskProposal !== false,
    monthlyAiPointCap: monthlyPoints, monthlyProviderCostCapTwd: providerCap, perRequestAiPointCap: requestCap,
    maxImagesPerRequest: maxImagesPerRequest!, maxImageBytes: maxImageBytes!, maxAudioSeconds: maxAudioSeconds!, maxAudioBytes: maxAudioBytes!, maxFileBytes: maxFileBytes!,
  } };
}

async function writePlan(db: Database, code: string, input: PlanInput, actor: string, action: string) {
  const capabilities = JSON.stringify({
    aiMediaIngestion: input.aiMediaIngestion, aiNaturalSearch: input.aiNaturalSearch, aiRelatedRecords: input.aiRelatedRecords,
    aiTimeRangeSummary: input.aiTimeRangeSummary, aiRecordRewrite: input.aiRecordRewrite, aiTaskProposal: input.aiTaskProposal,
    maxImagesPerRequest: input.maxImagesPerRequest, maxImageBytes: input.maxImageBytes, maxAudioSeconds: input.maxAudioSeconds,
    maxAudioBytes: input.maxAudioBytes, maxFileBytes: input.maxFileBytes,
  });
  const before = await subscriptionPlan(db, code);
  await db.execute(sql`
    WITH changed AS (
      INSERT INTO worklog_subscription_plans (
        code, plan_type, display_name, price_twd, rank, enabled, grant_points, ai_enabled,
        monthly_ai_point_cap, monthly_provider_cost_cap_twd, per_request_ai_point_cap,
        capabilities, created_at, updated_at
      ) VALUES (
        ${code}, 'SUBSCRIPTION', ${input.displayName}, ${input.priceTwd}, 100, ${input.enabled}, ${input.monthlyAiPointCap}, TRUE,
        ${input.monthlyAiPointCap}, ${input.monthlyProviderCostCapTwd}, ${input.perRequestAiPointCap}, ${capabilities}::jsonb, NOW(), NOW()
      ) ON CONFLICT (code) DO UPDATE SET
        display_name=EXCLUDED.display_name, price_twd=EXCLUDED.price_twd, enabled=EXCLUDED.enabled,
        grant_points=EXCLUDED.grant_points, ai_enabled=TRUE, monthly_ai_point_cap=EXCLUDED.monthly_ai_point_cap,
        monthly_provider_cost_cap_twd=EXCLUDED.monthly_provider_cost_cap_twd,
        per_request_ai_point_cap=EXCLUDED.per_request_ai_point_cap, capabilities=EXCLUDED.capabilities, updated_at=NOW()
      RETURNING *
    ), audit AS (
      INSERT INTO worklog_audit_logs (actor_admin, action, target_type, target_id, before_value, after_value, created_at)
      SELECT ${actor}, ${action}, 'PLAN', ${code}, ${JSON.stringify(before)}::jsonb, to_jsonb(changed), NOW() FROM changed RETURNING id
    ) SELECT changed.code FROM changed WHERE EXISTS (SELECT 1 FROM audit)
  `);
}

async function subscriptionPlans(db: Database) {
  const result = await db.execute(sql`
    SELECT code, display_name, price_twd::text AS price_twd, enabled, ai_enabled,
           monthly_ai_point_cap, monthly_provider_cost_cap_twd::text AS monthly_provider_cost_cap_twd,
           per_request_ai_point_cap, COALESCE(capabilities,'{}'::jsonb) AS capabilities, updated_at
    FROM worklog_subscription_plans WHERE plan_type='SUBSCRIPTION' ORDER BY rank, price_twd, code
  `);
  return result.rows.map(mapPlanRow);
}
async function subscriptionPlan(db: Database, code: string) {
  const result = await db.execute(sql`
    SELECT code, display_name, price_twd::text AS price_twd, enabled, ai_enabled,
           monthly_ai_point_cap, monthly_provider_cost_cap_twd::text AS monthly_provider_cost_cap_twd,
           per_request_ai_point_cap, COALESCE(capabilities,'{}'::jsonb) AS capabilities, updated_at
    FROM worklog_subscription_plans WHERE code=${code} AND plan_type='SUBSCRIPTION' LIMIT 1
  `);
  return result.rows[0] ? mapPlanRow(result.rows[0] as Record<string,unknown>) : null;
}
function mapPlanRow(row: Record<string,unknown>) { const cap = row.capabilities && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities) ? row.capabilities as Record<string,unknown> : {}; return {
  code:String(row.code), displayName:String(row.display_name), priceTwd:String(row.price_twd), enabled:Boolean(row.enabled), aiEnabled:Boolean(row.ai_enabled),
  aiMediaIngestion:cap.aiMediaIngestion!==false, aiNaturalSearch:cap.aiNaturalSearch!==false, aiRelatedRecords:cap.aiRelatedRecords!==false,
  aiTimeRangeSummary:cap.aiTimeRangeSummary!==false, aiRecordRewrite:cap.aiRecordRewrite!==false, aiTaskProposal:cap.aiTaskProposal!==false,
  monthlyAiPointCap:Number(row.monthly_ai_point_cap), monthlyProviderCostCapTwd:String(row.monthly_provider_cost_cap_twd),
  perRequestAiPointCap:row.per_request_ai_point_cap==null?null:Number(row.per_request_ai_point_cap),
  maxImagesPerRequest:Number(cap.maxImagesPerRequest??DEFAULT_LIMITS.maxImagesPerRequest), maxImageBytes:Number(cap.maxImageBytes??DEFAULT_LIMITS.maxImageBytes),
  maxAudioSeconds:Number(cap.maxAudioSeconds??DEFAULT_LIMITS.maxAudioSeconds), maxAudioBytes:Number(cap.maxAudioBytes??DEFAULT_LIMITS.maxAudioBytes),
  maxFileBytes:Number(cap.maxFileBytes??DEFAULT_LIMITS.maxFileBytes), updatedAt:new Date(String(row.updated_at)).toISOString(),
}; }
function generatedPlanCode(priceTwd: string) { return `AI_PRO_${String(Math.round(Number(priceTwd))).replace(/\D/g,'')}`.slice(0,64); }
function planCode(value: string) { const normalized=value.trim().toUpperCase(); return /^[A-Z][A-Z0-9_]{2,63}$/.test(normalized)?normalized:null; }
function boundedInt(value: unknown, fallback:number,min:number,max:number) { if(value==null||value==='') return fallback; const parsed=Number(value); return Number.isSafeInteger(parsed)&&parsed>=min&&parsed<=max?parsed:null; }
async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> { try { const body=await c.req.json(); return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:null; } catch { return null; } }
function serviceFor(c: { get(key: 'database'): Database }, repositoryFactory: (database: Database) => CommercialConfigRepository) { return new CommercialConfigService(repositoryFactory(c.get('database'))); }
function errorCode(error: unknown, fallback: string) { return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : fallback; }
function text(value: unknown) { return typeof value==='string'?value.trim():String(value??'').trim(); }
