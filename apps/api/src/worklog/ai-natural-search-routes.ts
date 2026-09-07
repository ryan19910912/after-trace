import { Hono, type Context } from 'hono';
import { allowedProductClientOrigin } from '../auth/product-client-origin';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { AiEntitlementService, type AiEntitlementRepository } from './ai-entitlement';
import {
  AiNaturalSearchService,
  type AiNaturalSearchProvider,
  type AiNaturalSearchRepository,
  type AiNaturalSearchResult,
} from './ai-natural-search';
import { WorklogAiPointLedgerService, type WorklogAiPointLedgerRepository } from './ai-point-ledger';
import { DrizzleAiEntitlementRepository } from './drizzle-ai-entitlement';
import { DrizzleAiNaturalSearchRepository } from './drizzle-ai-natural-search';
import { DrizzleWorklogAiPointLedgerRepository } from './drizzle-ai-point-ledger';
import { DrizzleNotificationRepository } from './drizzle-notifications';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';
import { GeminiNaturalSearchInterpreter } from './gemini-natural-search';
import { NotificationService } from './notifications';
import { notifySubscriptionEvent } from './system-notification-events';

export type AiNaturalSearchBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  GEMINI_API_KEY: string;
};

export type AiNaturalSearchRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  verifySession?: (token: string, secret: string, now?: Date) => Promise<WebSessionClaims | null>;
  resolveSessionUserId?: (database: Database, session: WebSessionClaims) => Promise<number | null>;
  entitlementRepositoryFactory?: (database: Database) => AiEntitlementRepository;
  searchRepositoryFactory?: (database: Database) => AiNaturalSearchRepository;
  ledgerRepositoryFactory?: (database: Database) => WorklogAiPointLedgerRepository;
  providerFactory?: (env: AiNaturalSearchBindings) => AiNaturalSearchProvider;
};

type Env = {
  Bindings: AiNaturalSearchBindings;
  Variables: { userId: number; database: Database };
};

type SearchContext = Context<Env>;

export function createAiNaturalSearchRoutes(dependencies: AiNaturalSearchRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const entitlementRepositoryFactory = dependencies.entitlementRepositoryFactory
    ?? ((database: Database) => new DrizzleAiEntitlementRepository(database));
  const searchRepositoryFactory = dependencies.searchRepositoryFactory
    ?? ((database: Database) => new DrizzleAiNaturalSearchRepository(database));
  const ledgerRepositoryFactory = dependencies.ledgerRepositoryFactory
    ?? ((database: Database) => new DrizzleWorklogAiPointLedgerRepository(database));
  const providerFactory = dependencies.providerFactory
    ?? ((env: AiNaturalSearchBindings) => new GeminiNaturalSearchInterpreter({ apiKey: env.GEMINI_API_KEY }));
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (origin && !allowed) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    c.header('Cache-Control', 'no-store');
    if (allowed) {
      c.header('Access-Control-Allow-Origin', allowed);
      c.header('Vary', 'Origin');
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('origin');
    const allowed = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (!allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin');
    return c.body(null, 204);
  });

  app.use('*', async (c, next) => {
    const secret = c.env.WEB_AUTH_SECRET?.trim() ?? '';
    if (secret.length < 32) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifySession(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = databaseFactory(c.env.DATABASE_URL);
    const userId = await resolveSessionUser(database, session);
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database);
    c.set('userId', userId);
    await next();
  });

  app.post('/', async (c) => {
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId);
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query || query.length > 1000) return c.json({ ok: false, error: 'AI_SEARCH_QUERY_REQUIRED' }, 400);
    const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim()
      ? body.timeZone.trim()
      : 'Asia/Taipei';
    if (!validTimeZone(timeZone)) return c.json({ ok: false, error: 'AI_SEARCH_TIMEZONE_INVALID' }, 400);
    const limit = body.limit === undefined ? 20 : positiveLimit(body.limit);
    if (!limit) return c.json({ ok: false, error: 'AI_SEARCH_LIMIT_INVALID' }, 400);

    const database = c.get('database');
    const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database));
    const service = new AiNaturalSearchService(
      searchRepositoryFactory(database),
      entitlement,
      new EntitledAiPointLedgerService(
        entitlement,
        new WorklogAiPointLedgerService(ledgerRepositoryFactory(database)),
      ),
      providerFactory(c.env),
    );
    const result = await service.search({
      userId: c.get('userId'),
      sourceId,
      query,
      timeZone,
      limit,
      referenceAt: new Date(),
    });
    return searchResultResponse(c, database, c.get('userId'), result);
  });

  return app;
}

async function searchResultResponse(
  c: SearchContext,
  database: Database,
  userId: number,
  result: AiNaturalSearchResult,
) {
  if (result.status === 'RESULTS') return c.json({ ok: true, ...result }, 200);
  if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503);
  if (result.status === 'FAILED') {
    const status = result.reason === 'AI_NATURAL_SEARCH_DISABLED' ? 409 : 502;
    return c.json({ ok: false, error: result.reason }, status);
  }

  if (isDurableAiProLimit(result.decision.reason)) {
    await notifyAiLimitSafely(database, userId, result.decision.reason, result.decision.periodEndsAt);
  }
  const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409;
  return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status);
}

async function notifyAiLimitSafely(
  database: Database,
  userId: number,
  reason: string,
  periodEndsAt: string | null,
): Promise<void> {
  try {
    await notifySubscriptionEvent(
      new NotificationService(new DrizzleNotificationRepository(database)),
      userId,
      { type: 'AI_LIMIT_REACHED', periodKey: `${periodEndsAt ?? 'unknown-period'}:${reason}` },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: 'ai_search_limit_system_notification_failed',
      userId,
      reason,
      message: error instanceof Error ? error.message : 'unknown error',
    }));
  }
}

function isDurableAiProLimit(reason: string): boolean {
  return reason === 'MONTHLY_POINT_CAP_REACHED'
    || reason === 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED'
    || reason === 'MONTHLY_PROVIDER_COST_CAP_REACHED';
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveLimit(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null;
}

function validTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
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
