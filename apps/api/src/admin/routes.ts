import { Hono } from 'hono';
import { createDatabase } from '../db/client';
import { DrizzleWorklogSubscriptionPeriodRepository } from '../worklog/drizzle-subscription-period';
import { WorklogSubscriptionPeriodService } from '../worklog/subscription-period';
import {
  adminAuthConfigured,
  authenticateAdminCredentials,
  bearerToken,
  issueAdminSessionToken,
  verifyAdminSessionToken,
  type AdminAccessEnv,
} from './auth';
import { ADMIN_CAPABILITY_DEFINITIONS, validateAdminCapabilities } from './capabilities';
import { DrizzleGrantAdminRepository } from './grant-repository';
import { presentAdminPayload } from './presentation';
import type {
  AdminAiRuntimeInput,
  AdminPlanInput,
  AdminUserQuery,
} from './repository';

export type AdminBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

type AdminEnv = {
  Bindings: AdminBindings;
  Variables: { adminUsername: string };
};

export function createAdminRoutes() {
  const app = new Hono<AdminEnv>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && !allowedOrigin) return c.json({ ok: false, error: 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, 503);
    if (origin && origin !== allowedOrigin) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && origin === allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowedOrigin = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.post('/login', async (c) => {
    if (!adminAuthConfigured(c.env)) return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    let identity;
    try {
      identity = await authenticateAdminCredentials(username, password, c.env);
    } catch {
      return c.json({ ok: false, error: 'ADMIN_LOGIN_INVALID' }, 401);
    }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_LOGIN_INVALID' }, 401);
    return c.json({
      ok: true,
      sessionToken: await issueAdminSessionToken({ username: identity.username, env: c.env }),
      username: identity.username,
    });
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try {
      identity = await verifyAdminSessionToken(token, c.env);
    } catch {
      return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503);
    }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username);
    await next();
  });

  app.get('/session', (c) => c.json({ ok: true, username: c.get('adminUsername') }));

  app.get('/overview', async (c) => {
    return c.json({ ok: true, overview: await repository(c).overview(new Date()) });
  });

  app.get('/users', async (c) => {
    const input: AdminUserQuery = {
      query: query(c.req.query('q')),
      planCode: optionalPlanCode(c.req.query('plan')),
      userType: userType(c.req.query('type')),
      sortUpdated: sort(c.req.query('sort')),
      limit: limit(c.req.query('limit')),
    };
    return c.json({ ok: true, users: presentAdminPayload(await repository(c).users(input)) });
  });

  app.get('/users/:id', async (c) => {
    const userId = positiveId(c.req.param('id'));
    if (!userId) return c.json({ ok: false, error: 'INVALID_USER_ID' }, 400);
    const detail = await repository(c).userDetail(userId);
    return detail ? c.json({ ok: true, detail: presentAdminPayload(detail) }) : c.json({ ok: false, error: 'USER_NOT_FOUND' }, 404);
  });

  app.put('/users/:id/subscription', async (c) => {
    const userId = positiveId(c.req.param('id'));
    if (!userId) return c.json({ ok: false, error: 'INVALID_USER_ID' }, 400);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);

    let planCode: string;
    let start: Date | null | undefined;
    let end: Date | null | undefined;
    try {
      planCode = requiredPlanCode(body.planCode);
      start = optionalDate(body.currentPeriodStart, 'INVALID_PERIOD_START');
      end = optionalDate(body.currentPeriodEnd, 'INVALID_PERIOD_END');
    } catch (error) {
      return c.json({ ok: false, error: safeError(error, 'INVALID_SUBSCRIPTION_INPUT') }, 400);
    }

    const database = createDatabase(c.env.DATABASE_URL);
    const adminRepository = new DrizzleGrantAdminRepository(database);
    if (!(await adminRepository.userDetail(userId))) return c.json({ ok: false, error: 'USER_NOT_FOUND' }, 404);
    const service = new WorklogSubscriptionPeriodService(new DrizzleWorklogSubscriptionPeriodRepository(database));
    try {
      const result = await service.assignPeriod({
        userId,
        planCode,
        source: 'ADMIN',
        actor: c.get('adminUsername'),
        currentPeriodStart: start ?? undefined,
        currentPeriodEnd: end,
        metadata: { source: 'AFTERTRACE_ADMIN' },
      });
      if (result.status === 'PLAN_NOT_AVAILABLE') return c.json({ ok: false, error: 'PLAN_NOT_AVAILABLE' }, 409);
      if (result.status === 'PRIVATE_SOURCE_NOT_FOUND') return c.json({ ok: false, error: 'PRIVATE_SOURCE_NOT_FOUND' }, 409);
      if (result.status === 'ACTIVE_PERIOD_EXISTS') {
        return c.json({ ok: false, error: 'ACTIVE_SUBSCRIPTION_PERIOD_EXISTS' }, 409);
      }
      if (result.status === 'ACTIVE_PERIOD_CHANGE_POLICY_UNDEFINED') {
        return c.json({ ok: false, error: 'SUBSCRIPTION_PERIOD_CHANGE_POLICY_UNDEFINED' }, 409);
      }
      return c.json({
        ok: true,
        subscription: presentAdminPayload(result.subscription),
        grant: presentAdminPayload(result.grant),
        idempotent: result.idempotent,
      });
    } catch (error) {
      return c.json({ ok: false, error: safeError(error, 'SUBSCRIPTION_UPDATE_FAILED') }, 400);
    }
  });

  app.get('/groups', async (c) => {
    return c.json({ ok: true, groups: presentAdminPayload(await repository(c).groups(query(c.req.query('q')), limit(c.req.query('limit')))) });
  });

  app.get('/groups/:id', async (c) => {
    const groupId = positiveId(c.req.param('id'));
    if (!groupId) return c.json({ ok: false, error: 'INVALID_GROUP_ID' }, 400);
    const detail = await repository(c).groupDetail(groupId);
    return detail ? c.json({ ok: true, detail: presentAdminPayload(detail) }) : c.json({ ok: false, error: 'GROUP_NOT_FOUND' }, 404);
  });

  app.get('/capabilities', (c) => c.json({ ok: true, capabilityDefinitions: ADMIN_CAPABILITY_DEFINITIONS }));

  app.get('/plans', async (c) => c.json({ ok: true, plans: presentAdminPayload(await repository(c).plans()) }));

  app.put('/plans/:code', async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    let input: AdminPlanInput;
    try {
      input = planInput(c.req.param('code'), body);
    } catch (error) {
      return c.json({ ok: false, error: safeError(error, 'INVALID_PLAN') }, 400);
    }
    try {
      const plan = await repository(c).upsertPlan(input, c.get('adminUsername'));
      return c.json({ ok: true, plan: presentAdminPayload(plan) });
    } catch (error) {
      return c.json({ ok: false, error: safeError(error, 'PLAN_UPDATE_FAILED') }, 400);
    }
  });

  app.get('/ai-runtime', async (c) => c.json({ ok: true, config: presentAdminPayload(await repository(c).aiRuntimeConfig()) }));

  app.put('/ai-runtime', async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    let input: AdminAiRuntimeInput;
    try {
      input = aiRuntimeInput(body);
    } catch (error) {
      return c.json({ ok: false, error: safeError(error, 'INVALID_AI_RUNTIME_CONFIG') }, 400);
    }
    try {
      const config = await repository(c).updateAiRuntimeConfig(input, c.get('adminUsername'));
      return c.json({ ok: true, config: presentAdminPayload(config) });
    } catch (error) {
      return c.json({ ok: false, error: safeError(error, 'AI_RUNTIME_UPDATE_FAILED') }, 400);
    }
  });

  app.get('/feedback', async (c) => c.json({ ok: true, feedback: presentAdminPayload(await repository(c).feedback(limit(c.req.query('limit')))) }));

  app.get('/anomalies', async (c) => c.json({ ok: true, anomalies: presentAdminPayload(await repository(c).anomalies(limit(c.req.query('limit')))) }));

  app.patch('/anomalies/:id', async (c) => {
    const anomalyId = positiveId(c.req.param('id'));
    if (!anomalyId) return c.json({ ok: false, error: 'INVALID_ANOMALY_ID' }, 400);
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const status = anomalyStatus(body.status);
    if (!status) return c.json({ ok: false, error: 'INVALID_ANOMALY_STATUS' }, 400);
    const result = await repository(c).setAnomalyStatus(anomalyId, status, c.get('adminUsername'));
    return result ? c.json({ ok: true, anomaly: presentAdminPayload(result) }) : c.json({ ok: false, error: 'ANOMALY_NOT_FOUND' }, 404);
  });

  app.get('/audit', async (c) => c.json({ ok: true, audit: presentAdminPayload(await repository(c).audit(limit(c.req.query('limit')))) }));

  return app;
}

function repository(c: { env: AdminBindings }) {
  return new DrizzleGrantAdminRepository(createDatabase(c.env.DATABASE_URL));
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function limit(value: string | undefined): number {
  if (!value) return 100;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 100;
}

function query(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized.slice(0, 200) : null;
}

function optionalPlanCode(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized && /^[A-Z0-9_-]{1,64}$/.test(normalized) ? normalized : null;
}

function requiredPlanCode(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_PLAN_CODE');
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) throw new Error('INVALID_PLAN_CODE');
  return normalized;
}

function userType(value: string | undefined): 'INDIVIDUAL' | 'GROUP_ENABLED' | null {
  return value === 'INDIVIDUAL' || value === 'GROUP_ENABLED' ? value : null;
}

function sort(value: string | undefined): 'ASC' | 'DESC' {
  return value?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

function planInput(codeRaw: string, body: Record<string, unknown>): AdminPlanInput {
  const code = requiredPlanCode(codeRaw);
  const displayName = requiredText(body.displayName, 'INVALID_DISPLAY_NAME', 255);
  const priceTwd = decimal(body.priceTwd, 'INVALID_PRICE_TWD');
  const rank = integer(body.rank, 'INVALID_PLAN_RANK', -100000, 100000);
  const enabled = boolean(body.enabled, 'INVALID_PLAN_ENABLED');
  const subscriptionPeriodPoints = integer(
    body.subscriptionPeriodPoints,
    'INVALID_SUBSCRIPTION_PERIOD_POINTS',
    0,
    2_000_000_000,
  );
  const capabilities = validateAdminCapabilities(body.capabilities);
  return { code, displayName, priceTwd, rank, enabled, subscriptionPeriodPoints, capabilities };
}

function aiRuntimeInput(body: Record<string, unknown>): AdminAiRuntimeInput {
  return {
    provider: requiredText(body.provider, 'INVALID_AI_PROVIDER', 128),
    model: requiredText(body.model, 'INVALID_AI_MODEL', 255),
    inputUsdPerMillion: decimal(body.inputUsdPerMillion, 'INVALID_AI_INPUT_PRICE'),
    outputUsdPerMillion: decimal(body.outputUsdPerMillion, 'INVALID_AI_OUTPUT_PRICE'),
    audioUsdPerMillion: nullableDecimal(body.audioUsdPerMillion, 'INVALID_AI_AUDIO_PRICE'),
    imageUsdPerMillion: nullableDecimal(body.imageUsdPerMillion, 'INVALID_AI_IMAGE_PRICE'),
    usdTwdRate: nullableDecimal(body.usdTwdRate, 'INVALID_USD_TWD_RATE'),
  };
}

function requiredText(value: unknown, error: string, max: number): string {
  if (typeof value !== 'string') throw new Error(error);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(error);
  return normalized;
}

function decimal(value: unknown, error: string): string {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error(error);
  return raw;
}

function nullableDecimal(value: unknown, error: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return decimal(value, error);
}

function integer(value: unknown, error: string, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(error);
  return parsed;
}

function boolean(value: unknown, error: string): boolean {
  if (typeof value !== 'boolean') throw new Error(error);
  return value;
}

function optionalDate(value: unknown, error: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(error);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(error);
  return date;
}

function anomalyStatus(value: unknown): 'OPEN' | 'RESOLVED' | 'IGNORED' | null {
  return value === 'OPEN' || value === 'RESOLVED' || value === 'IGNORED' ? value : null;
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.slice(0, 160) || fallback : fallback;
}
