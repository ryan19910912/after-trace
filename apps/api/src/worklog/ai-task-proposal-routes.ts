import { Hono } from 'hono';
import { allowedProductClientOrigin } from '../auth/product-client-origin';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { AiEntitlementService } from './ai-entitlement';
import { AiTaskProposalService } from './ai-task-proposal';
import { WorklogAiPointLedgerService } from './ai-point-ledger';
import { DrizzleAiEntitlementRepository } from './drizzle-ai-entitlement';
import { DrizzleAiTaskProposalRepository } from './drizzle-ai-task-proposal';
import { DrizzleWorklogAiPointLedgerRepository } from './drizzle-ai-point-ledger';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';
import { GeminiWorklogTaskProposer } from './gemini-task-proposal';

export type AiTaskProposalBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  GEMINI_API_KEY: string;
};

type Env = { Bindings: AiTaskProposalBindings; Variables: { userId: number; database: Database } };

export function createAiTaskProposalRoutes() {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (origin && !allowed) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next();
    c.header('Cache-Control', 'no-store');
    if (allowed) { c.header('Access-Control-Allow-Origin', allowed); c.header('Vary', 'Origin'); }
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
    const session = await verifyWebSessionToken(token, secret);
    if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = createDatabase(c.env.DATABASE_URL);
    const userId = await resolveWebSessionUserId(database, session as WebSessionClaims);
    if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database); c.set('userId', userId);
    await next();
  });

  app.post('/', async (c) => {
    const body = await jsonObject(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId);
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const recordId = body.recordId == null ? null : positiveId(body.recordId);
    if (body.recordId != null && !recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 5000) return c.json({ ok: false, error: 'AI_TASK_TEXT_REQUIRED' }, 400);
    const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim() ? body.timeZone.trim() : 'Asia/Taipei';

    const database = c.get('database');
    const entitlement = new AiEntitlementService(new DrizzleAiEntitlementRepository(database));
    const service = new AiTaskProposalService(
      new DrizzleAiTaskProposalRepository(database),
      entitlement,
      new EntitledAiPointLedgerService(entitlement, new WorklogAiPointLedgerService(new DrizzleWorklogAiPointLedgerRepository(database))),
      new GeminiWorklogTaskProposer({ apiKey: c.env.GEMINI_API_KEY }),
    );
    let result;
    try {
      result = await service.propose({ userId: c.get('userId'), sourceId, recordId, text, timeZone, referenceAt: new Date() });
    } catch (error) {
      const code = errorCode(error, 'AI_TASK_PROPOSAL_FAILED');
      return c.json({ ok: false, error: code }, code === 'AI_TASK_TIMEZONE_INVALID' ? 400 : 500);
    }
    if (result.status === 'PROPOSAL') return c.json({ ok: true, ...result });
    if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: result.reason }, 404);
    if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503);
    if (result.status === 'FAILED') return c.json({ ok: false, error: result.reason }, result.reason === 'AI_TASK_PROPOSAL_DISABLED' ? 409 : 502);
    return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409);
  });

  return app;
}

function bearerToken(header: string | undefined) { if (!header) return null; const match = /^Bearer\s+(.+)$/i.exec(header.trim()); return match?.[1]?.trim() || null; }
function positiveId(value: unknown) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
async function jsonObject(c: { req: { json(): Promise<unknown> } }) { try { const body = await c.req.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; } catch { return null; } }
function errorCode(error: unknown, fallback: string) { if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message; return fallback; }
