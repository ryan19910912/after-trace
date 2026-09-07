import { Hono } from 'hono';
import { bearerToken, verifyAdminSessionToken, type AdminAccessEnv } from './auth';
import { createDatabase, type Database } from '../db/client';
import { CommercialConfigService, type CommercialConfigRepository } from '../worklog/commercial-config';
import { DrizzleCommercialConfigRepository } from '../worklog/drizzle-commercial-config';

export type AdminCommercialConfigBindings = AdminAccessEnv & {
  DATABASE_URL: string;
  ADMIN_WEB_ORIGIN?: string;
};

export type AdminCommercialConfigDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  repositoryFactory?: (database: Database) => CommercialConfigRepository;
  verifySession?: typeof verifyAdminSessionToken;
};

type Env = {
  Bindings: AdminCommercialConfigBindings;
  Variables: { adminUsername: string; database: Database };
};

export function createAdminCommercialConfigRoutes(dependencies: AdminCommercialConfigDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const repositoryFactory = dependencies.repositoryFactory
    ?? ((database: Database) => new DrizzleCommercialConfigRepository(database));
  const verifySession = dependencies.verifySession ?? verifyAdminSessionToken;
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (origin && (!allowed || origin !== allowed)) {
      return c.json({ ok: false, error: allowed ? 'ORIGIN_NOT_ALLOWED' : 'ADMIN_WEB_ORIGIN_NOT_CONFIGURED' }, allowed ? 403 : 503);
    }
    await next();
    c.header('Cache-Control', 'no-store');
    if (origin && allowed === origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowed = c.env.ADMIN_WEB_ORIGIN?.trim();
    if (!origin || !allowed || origin !== allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' }, 401);
    let identity;
    try {
      identity = await verifySession(token, c.env);
    } catch {
      return c.json({ ok: false, error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 503);
    }
    if (!identity) return c.json({ ok: false, error: 'ADMIN_SESSION_INVALID' }, 401);
    c.set('adminUsername', identity.username);
    c.set('database', databaseFactory(c.env.DATABASE_URL));
    await next();
  });

  app.get('/free-ai-trial', async (c) => {
    const config = await serviceFor(c, repositoryFactory).getFreeAiTrialConfig();
    return config
      ? c.json({ ok: true, config })
      : c.json({ ok: false, error: 'FREE_AI_TRIAL_CONFIG_NOT_INITIALIZED' }, 404);
  });

  app.put('/free-ai-trial', async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const raw = body.freeInitialAiTrialPoints;
    const points = typeof raw === 'number' ? raw : Number(raw);
    try {
      const config = await serviceFor(c, repositoryFactory).setFreeAiTrialPoints(points, c.get('adminUsername'));
      return c.json({ ok: true, config });
    } catch (error) {
      return c.json({ ok: false, error: errorCode(error, 'FREE_AI_TRIAL_CONFIG_UPDATE_FAILED') }, 400);
    }
  });

  app.get('/ai-pro', async (c) => {
    const config = await serviceFor(c, repositoryFactory).getAiProConfig();
    return config
      ? c.json({ ok: true, config })
      : c.json({ ok: false, error: 'AI_PRO_CONFIG_NOT_INITIALIZED' }, 404);
  });

  app.put('/ai-pro', async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const monthlyAiPointCap = Number(body.monthlyAiPointCap);
    const perRequestRaw = body.perRequestAiPointCap;
    const perRequestAiPointCap = perRequestRaw === null || perRequestRaw === undefined || perRequestRaw === ''
      ? null
      : Number(perRequestRaw);
    try {
      const config = await serviceFor(c, repositoryFactory).setAiProConfig({
        enabled: body.enabled !== false,
        aiMediaIngestion: body.aiMediaIngestion !== false,
        monthlyAiPointCap,
        monthlyProviderCostCapTwd: typeof body.monthlyProviderCostCapTwd === 'string'
          ? body.monthlyProviderCostCapTwd
          : String(body.monthlyProviderCostCapTwd ?? ''),
        perRequestAiPointCap,
      }, c.get('adminUsername'));
      return c.json({ ok: true, config });
    } catch (error) {
      return c.json({ ok: false, error: errorCode(error, 'AI_PRO_CONFIG_UPDATE_FAILED') }, 400);
    }
  });

  return app;
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function serviceFor(
  c: { get(key: 'database'): Database },
  repositoryFactory: (database: Database) => CommercialConfigRepository,
): CommercialConfigService {
  return new CommercialConfigService(repositoryFactory(c.get('database')));
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : fallback;
}
