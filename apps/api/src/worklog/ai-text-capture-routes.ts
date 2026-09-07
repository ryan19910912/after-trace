import { Hono, type Context } from 'hono';
import { allowedProductClientOrigin } from '../auth/product-client-origin';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { AiEntitlementService, type AiEntitlementRepository } from './ai-entitlement';
import { AiMediaCaptureService, type AiMediaCaptureRepository } from './ai-media-capture';
import { AiTextCaptureService, type AiTextCaptureRepository } from './ai-text-capture';
import { WorklogAiPointLedgerService, type WorklogAiPointLedgerRepository } from './ai-point-ledger';
import type { WorklogAttachmentProvider } from './attachment-ingestion';
import { DrizzleAiEntitlementRepository } from './drizzle-ai-entitlement';
import { DrizzleAiMediaCaptureRepository } from './drizzle-ai-media-capture';
import { DrizzleAiTextCaptureRepository } from './drizzle-ai-text-capture';
import { DrizzleWorklogAiPointLedgerRepository } from './drizzle-ai-point-ledger';
import { DrizzleNotificationRepository } from './drizzle-notifications';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';
import { GeminiWorklogAttachmentNormalizer } from './gemini-attachment-normalizer';
import { GeminiWorklogTextNormalizer } from './gemini-text-normalizer';
import { NotificationService } from './notifications';
import { parseRecordCaptureContext } from './record-capture-context';
import { notifySubscriptionEvent } from './system-notification-events';
import type { WorklogTextNormalizationProvider } from './text-normalization';

export type AiTextCaptureBindings = {
  DATABASE_URL: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  GEMINI_API_KEY: string;
};

export type AiTextCaptureRouteDependencies = {
  databaseFactory?: (databaseUrl: string) => Database;
  verifySession?: (token: string, secret: string, now?: Date) => Promise<WebSessionClaims | null>;
  resolveSessionUserId?: (database: Database, session: WebSessionClaims) => Promise<number | null>;
  entitlementRepositoryFactory?: (database: Database) => AiEntitlementRepository;
  captureRepositoryFactory?: (database: Database) => AiTextCaptureRepository;
  mediaRepositoryFactory?: (database: Database) => AiMediaCaptureRepository;
  ledgerRepositoryFactory?: (database: Database) => WorklogAiPointLedgerRepository;
  providerFactory?: (env: AiTextCaptureBindings) => WorklogTextNormalizationProvider;
  mediaProviderFactory?: (env: AiTextCaptureBindings) => WorklogAttachmentProvider;
};

type Env = {
  Bindings: AiTextCaptureBindings;
  Variables: { userId: number; database: Database };
};

type CaptureRouteContext = Context<Env>;

type CaptureRouteResult =
  | { status: 'CREATED'; entitlementSource: 'FREE_TRIAL' | 'AI_PRO'; record: unknown }
  | { status: 'BLOCKED'; decision: { reason: string; periodEndsAt: string | null } }
  | { status: 'DEFERRED'; reason: string }
  | { status: 'FAILED'; reason: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function createAiTextCaptureRoutes(dependencies: AiTextCaptureRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const entitlementRepositoryFactory = dependencies.entitlementRepositoryFactory
    ?? ((database: Database) => new DrizzleAiEntitlementRepository(database));
  const captureRepositoryFactory = dependencies.captureRepositoryFactory
    ?? ((database: Database) => new DrizzleAiTextCaptureRepository(database));
  const mediaRepositoryFactory = dependencies.mediaRepositoryFactory
    ?? ((database: Database) => new DrizzleAiMediaCaptureRepository(database));
  const ledgerRepositoryFactory = dependencies.ledgerRepositoryFactory
    ?? ((database: Database) => new DrizzleWorklogAiPointLedgerRepository(database));
  const providerFactory = dependencies.providerFactory
    ?? ((env: AiTextCaptureBindings) => new GeminiWorklogTextNormalizer({ apiKey: env.GEMINI_API_KEY }));
  const mediaProviderFactory = dependencies.mediaProviderFactory
    ?? ((env: AiTextCaptureBindings) => new GeminiWorklogAttachmentNormalizer({ apiKey: env.GEMINI_API_KEY }));
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

  app.post('/text', async (c) => {
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId);
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const text = typeof body.text === 'string' ? body.text : typeof body.content === 'string' ? body.content : '';
    if (!text.trim() || text.trim().length > 20_000) return c.json({ ok: false, error: 'AI_CAPTURE_TEXT_REQUIRED' }, 400);

    const database = c.get('database');
    const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database));
    const rawLedger = new WorklogAiPointLedgerService(ledgerRepositoryFactory(database));
    const service = new AiTextCaptureService(
      captureRepositoryFactory(database),
      entitlement,
      new EntitledAiPointLedgerService(entitlement, rawLedger),
      providerFactory(c.env),
    );

    const result = await service.capture({
      userId: c.get('userId'),
      sourceId,
      text,
      referenceAt: new Date(),
    });
    return captureResultResponse(c, database, c.get('userId'), result);
  });

  app.post('/image', async (c) => {
    const body = await objectBody(c);
    if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId);
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);

    const parsedImage = imageInput(body.image);
    if ('error' in parsedImage) return c.json({ ok: false, error: parsedImage.error }, 400);
    const captureContext = parseRecordCaptureContext(body.captureContext, c.req.header('origin'));
    if (captureContext === 'INVALID') return c.json({ ok: false, error: 'INVALID_CAPTURE_CONTEXT' }, 400);
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 1000) : null;

    const database = c.get('database');
    const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database));
    const rawLedger = new WorklogAiPointLedgerService(ledgerRepositoryFactory(database));
    const service = new AiMediaCaptureService(
      mediaRepositoryFactory(database),
      entitlement,
      new EntitledAiPointLedgerService(entitlement, rawLedger),
      mediaProviderFactory(c.env),
    );

    const result = await service.captureImage({
      userId: c.get('userId'),
      sourceId,
      image: parsedImage.value,
      captureContext,
      instruction,
      referenceAt: new Date(),
    });
    return captureResultResponse(c, database, c.get('userId'), result);
  });

  return app;
}

async function captureResultResponse(
  c: CaptureRouteContext,
  database: Database,
  userId: number,
  result: CaptureRouteResult,
) {
  if (result.status === 'CREATED') return c.json({ ok: true, ...result }, 201);
  if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503);
  if (result.status === 'FAILED') {
    return c.json({ ok: false, error: result.reason }, result.reason === 'AI_MEDIA_DISABLED' ? 409 : 502);
  }

  if (isDurableAiProLimit(result.decision.reason)) {
    await notifyAiLimitSafely(database, userId, result.decision.reason, result.decision.periodEndsAt);
  }
  const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409;
  return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status);
}

function imageInput(value: unknown): { value: { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; byteLength: number; dataBase64: string } } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'AI_IMAGE_REQUIRED' };
  const image = value as Record<string, unknown>;
  const mimeType = typeof image.mimeType === 'string' ? image.mimeType.trim().toLowerCase() : '';
  if (!IMAGE_MIME_TYPES.has(mimeType)) return { error: 'AI_IMAGE_TYPE_UNSUPPORTED' };
  const dataBase64 = typeof image.dataBase64 === 'string' ? image.dataBase64.trim() : '';
  if (!dataBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) return { error: 'AI_IMAGE_BASE64_INVALID' };
  const byteLength = decodedBase64Length(dataBase64);
  if (!byteLength || byteLength > MAX_IMAGE_BYTES) return { error: 'AI_IMAGE_TOO_LARGE' };
  return { value: { mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp', byteLength, dataBase64 } };
}

function decodedBase64Length(value: string): number {
  if (value.length % 4 !== 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = (value.length / 4) * 3 - padding;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
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
      {
        type: 'AI_LIMIT_REACHED',
        periodKey: `${periodEndsAt ?? 'unknown-period'}:${reason}`,
      },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: 'ai_limit_system_notification_failed',
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

async function objectBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
