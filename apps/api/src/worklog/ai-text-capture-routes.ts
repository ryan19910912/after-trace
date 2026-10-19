import { Hono, type Context } from 'hono';
import { allowedProductClientOrigin } from '../auth/product-client-origin';
import { resolveWebSessionUserId } from '../auth/session-user';
import { verifyWebSessionToken, type WebSessionClaims } from '../auth/token';
import { createDatabase, type Database } from '../db/client';
import { AiEntitlementService, type AiEntitlementRepository } from './ai-entitlement';
import {
  AiMediaCaptureService,
  type AiAudioInput,
  type AiFileInput,
  type AiImageInput,
  type AiMediaCaptureRepository,
  type AiMediaProvider,
} from './ai-media-capture';
import {
  AiNaturalSearchService,
  type AiNaturalSearchProvider,
  type AiNaturalSearchRepository,
  type AiNaturalSearchResult,
} from './ai-natural-search';
import {
  AiRecordRewriteService,
  type AiRecordRewriteRepository,
  type AiRecordRewriteResult,
  type AiRewriteProvider,
} from './ai-record-rewrite';
import {
  AiRelatedRecordsService,
  type AiRelatedRecordsRepository,
  type AiRelatedRecordsResult,
} from './ai-related-records';
import {
  AiTimeRangeSummaryService,
  type AiTimeRangeSummaryProvider,
  type AiTimeRangeSummaryRepository,
  type AiTimeRangeSummaryResult,
} from './ai-time-range-summary';
import { AiTextCaptureService, type AiTextCaptureRepository } from './ai-text-capture';
import { WorklogAiPointLedgerService, type WorklogAiPointLedgerRepository } from './ai-point-ledger';
import { DrizzleAiEntitlementRepository } from './drizzle-ai-entitlement';
import { DrizzleAiMediaCaptureRepository } from './drizzle-ai-media-capture';
import { DrizzleAiNaturalSearchRepository } from './drizzle-ai-natural-search';
import { DrizzleAiRecordRewriteRepository } from './drizzle-ai-record-rewrite';
import { DrizzleAiRelatedRecordsRepository } from './drizzle-ai-related-records';
import { DrizzleAiTimeRangeSummaryRepository } from './drizzle-ai-time-range-summary';
import { DrizzleAiTextCaptureRepository } from './drizzle-ai-text-capture';
import { DrizzleWorklogAiPointLedgerRepository } from './drizzle-ai-point-ledger';
import { DrizzleNotificationRepository } from './drizzle-notifications';
import { EntitledAiPointLedgerService } from './entitled-ai-point-ledger';
import { GeminiWorklogAttachmentNormalizer } from './gemini-attachment-normalizer';
import { GeminiNaturalSearchInterpreter } from './gemini-natural-search';
import { GeminiWorklogRecordRewriter } from './gemini-record-rewrite';
import { GeminiWorklogTimeRangeSummarizer } from './gemini-time-range-summary';
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
  searchRepositoryFactory?: (database: Database) => AiNaturalSearchRepository;
  relatedRepositoryFactory?: (database: Database) => AiRelatedRecordsRepository;
  summaryRepositoryFactory?: (database: Database) => AiTimeRangeSummaryRepository;
  rewriteRepositoryFactory?: (database: Database) => AiRecordRewriteRepository;
  ledgerRepositoryFactory?: (database: Database) => WorklogAiPointLedgerRepository;
  providerFactory?: (env: AiTextCaptureBindings) => WorklogTextNormalizationProvider;
  mediaProviderFactory?: (env: AiTextCaptureBindings) => AiMediaProvider;
  searchProviderFactory?: (env: AiTextCaptureBindings) => AiNaturalSearchProvider;
  summaryProviderFactory?: (env: AiTextCaptureBindings) => AiTimeRangeSummaryProvider;
  rewriteProviderFactory?: (env: AiTextCaptureBindings) => AiRewriteProvider;
};

type Env = { Bindings: AiTextCaptureBindings; Variables: { userId: number; database: Database } };
type CaptureRouteContext = Context<Env>;
type CaptureRouteResult =
  | { status: 'CREATED'; entitlementSource: 'FREE_TRIAL' | 'AI_PRO'; record: unknown }
  | { status: 'BLOCKED'; decision: { reason: string; periodEndsAt: string | null } }
  | { status: 'DEFERRED'; reason: string }
  | { status: 'FAILED'; reason: string };

// Absolute transport ceilings. The active AI Pro plan can configure lower limits.
const HARD_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const HARD_MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 30 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AUDIO_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav']);
const FILE_MIME_TYPES = new Set(['application/pdf', 'application/json', 'application/xml', 'text/plain', 'text/markdown', 'text/csv', 'text/xml']);

export function createAiTextCaptureRoutes(dependencies: AiTextCaptureRouteDependencies = {}) {
  const databaseFactory = dependencies.databaseFactory ?? createDatabase;
  const verifySession = dependencies.verifySession ?? verifyWebSessionToken;
  const resolveSessionUser = dependencies.resolveSessionUserId ?? resolveWebSessionUserId;
  const entitlementRepositoryFactory = dependencies.entitlementRepositoryFactory ?? ((database: Database) => new DrizzleAiEntitlementRepository(database));
  const captureRepositoryFactory = dependencies.captureRepositoryFactory ?? ((database: Database) => new DrizzleAiTextCaptureRepository(database));
  const mediaRepositoryFactory = dependencies.mediaRepositoryFactory ?? ((database: Database) => new DrizzleAiMediaCaptureRepository(database));
  const searchRepositoryFactory = dependencies.searchRepositoryFactory ?? ((database: Database) => new DrizzleAiNaturalSearchRepository(database));
  const relatedRepositoryFactory = dependencies.relatedRepositoryFactory ?? ((database: Database) => new DrizzleAiRelatedRecordsRepository(database));
  const summaryRepositoryFactory = dependencies.summaryRepositoryFactory ?? ((database: Database) => new DrizzleAiTimeRangeSummaryRepository(database));
  const rewriteRepositoryFactory = dependencies.rewriteRepositoryFactory ?? ((database: Database) => new DrizzleAiRecordRewriteRepository(database));
  const ledgerRepositoryFactory = dependencies.ledgerRepositoryFactory ?? ((database: Database) => new DrizzleWorklogAiPointLedgerRepository(database));
  const providerFactory = dependencies.providerFactory ?? ((env: AiTextCaptureBindings) => new GeminiWorklogTextNormalizer({ apiKey: env.GEMINI_API_KEY }));
  const mediaProviderFactory = dependencies.mediaProviderFactory ?? ((env: AiTextCaptureBindings) => new GeminiWorklogAttachmentNormalizer({ apiKey: env.GEMINI_API_KEY }));
  const searchProviderFactory = dependencies.searchProviderFactory ?? ((env: AiTextCaptureBindings) => new GeminiNaturalSearchInterpreter({ apiKey: env.GEMINI_API_KEY }));
  const summaryProviderFactory = dependencies.summaryProviderFactory ?? ((env: AiTextCaptureBindings) => new GeminiWorklogTimeRangeSummarizer({ apiKey: env.GEMINI_API_KEY }));
  const rewriteProviderFactory = dependencies.rewriteProviderFactory ?? ((env: AiTextCaptureBindings) => new GeminiWorklogRecordRewriter({ apiKey: env.GEMINI_API_KEY }));
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin'); const allowed = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (origin && !allowed) return c.json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403);
    await next(); c.header('Cache-Control', 'no-store'); if (allowed) { c.header('Access-Control-Allow-Origin', allowed); c.header('Vary', 'Origin'); }
  });
  app.options('*', (c) => {
    const origin = c.req.header('origin'); const allowed = allowedProductClientOrigin(origin, c.env.WEB_APP_ORIGIN);
    if (!allowed) return c.body(null, 403);
    c.header('Access-Control-Allow-Origin', allowed); c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type'); c.header('Access-Control-Allow-Methods', 'POST, OPTIONS'); c.header('Access-Control-Max-Age', '600'); c.header('Vary', 'Origin'); return c.body(null, 204);
  });
  app.use('*', async (c, next) => {
    const secret = c.env.WEB_AUTH_SECRET?.trim() ?? ''; if (secret.length < 32) return c.json({ ok: false, error: 'WEB_AUTH_NOT_CONFIGURED' }, 503);
    const token = bearerToken(c.req.header('authorization')); if (!token) return c.json({ ok: false, error: 'WEB_SESSION_REQUIRED' }, 401);
    const session = await verifySession(token, secret); if (!session) return c.json({ ok: false, error: 'INVALID_WEB_SESSION' }, 401);
    const database = databaseFactory(c.env.DATABASE_URL); const userId = await resolveSessionUser(database, session); if (!userId) return c.json({ ok: false, error: 'WORKLOG_USER_NOT_FOUND' }, 404);
    c.set('database', database); c.set('userId', userId); await next();
  });

  app.post('/text', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const text = typeof body.text === 'string' ? body.text : typeof body.content === 'string' ? body.content : '';
    if (!text.trim() || text.trim().length > 20_000) return c.json({ ok: false, error: 'AI_CAPTURE_TEXT_REQUIRED' }, 400);
    const result = await textService(c, entitlementRepositoryFactory, captureRepositoryFactory, ledgerRepositoryFactory, providerFactory).capture({ userId: c.get('userId'), sourceId, text, referenceAt: new Date() });
    return captureResultResponse(c, c.get('database'), c.get('userId'), result);
  });

  app.post('/image', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const parsedImage = boundedMediaInput<AiImageInput>(body.image, { requiredError: 'AI_IMAGE_REQUIRED', typeError: 'AI_IMAGE_TYPE_UNSUPPORTED', base64Error: 'AI_IMAGE_BASE64_INVALID', sizeError: 'AI_IMAGE_TOO_LARGE', allowedMimeTypes: IMAGE_MIME_TYPES, maxBytes: HARD_MAX_IMAGE_BYTES });
    if ('error' in parsedImage) return c.json({ ok: false, error: parsedImage.error }, 400);
    const captureContext = parseRecordCaptureContext(body.captureContext, c.req.header('origin')); if (captureContext === 'INVALID') return c.json({ ok: false, error: 'INVALID_CAPTURE_CONTEXT' }, 400);
    const result = await mediaService(c, entitlementRepositoryFactory, mediaRepositoryFactory, ledgerRepositoryFactory, mediaProviderFactory).captureImage({ userId: c.get('userId'), sourceId, image: parsedImage.value, captureContext, instruction: boundedInstruction(body.instruction), referenceAt: new Date() });
    return captureResultResponse(c, c.get('database'), c.get('userId'), result);
  });

  app.post('/audio', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const durationSeconds = positiveDuration(body.durationSeconds); if (durationSeconds === null) return c.json({ ok: false, error: 'AI_AUDIO_DURATION_REQUIRED' }, 400);
    const parsedAudio = boundedMediaInput<AiAudioInput>(body.audio, { requiredError: 'AI_AUDIO_REQUIRED', typeError: 'AI_AUDIO_TYPE_UNSUPPORTED', base64Error: 'AI_AUDIO_BASE64_INVALID', sizeError: 'AI_AUDIO_TOO_LARGE', allowedMimeTypes: AUDIO_MIME_TYPES, maxBytes: HARD_MAX_AUDIO_BYTES });
    if ('error' in parsedAudio) return c.json({ ok: false, error: parsedAudio.error }, 400);
    const result = await mediaService(c, entitlementRepositoryFactory, mediaRepositoryFactory, ledgerRepositoryFactory, mediaProviderFactory).captureAudio({ userId: c.get('userId'), sourceId, audio: parsedAudio.value, durationSeconds, instruction: boundedInstruction(body.instruction), referenceAt: new Date() });
    return captureResultResponse(c, c.get('database'), c.get('userId'), result);
  });

  app.post('/file', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const parsedFile = boundedMediaInput<AiFileInput>(body.file, { requiredError: 'AI_FILE_REQUIRED', typeError: 'AI_FILE_TYPE_UNSUPPORTED', base64Error: 'AI_FILE_BASE64_INVALID', sizeError: 'AI_FILE_TOO_LARGE', allowedMimeTypes: FILE_MIME_TYPES, maxBytes: HARD_MAX_FILE_BYTES });
    if ('error' in parsedFile) return c.json({ ok: false, error: parsedFile.error }, 400);
    const result = await mediaService(c, entitlementRepositoryFactory, mediaRepositoryFactory, ledgerRepositoryFactory, mediaProviderFactory).captureFile({ userId: c.get('userId'), sourceId, file: parsedFile.value, instruction: boundedInstruction(body.instruction), referenceAt: new Date() });
    return captureResultResponse(c, c.get('database'), c.get('userId'), result);
  });

  app.post('/search', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const query = typeof body.query === 'string' ? body.query.trim() : ''; if (!query || query.length > 1000) return c.json({ ok: false, error: 'AI_SEARCH_QUERY_REQUIRED' }, 400);
    const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim() ? body.timeZone.trim() : 'Asia/Taipei'; if (!validTimeZone(timeZone)) return c.json({ ok: false, error: 'AI_SEARCH_TIMEZONE_INVALID' }, 400);
    const limit = body.limit === undefined ? 20 : positiveLimit(body.limit); if (!limit) return c.json({ ok: false, error: 'AI_SEARCH_LIMIT_INVALID' }, 400);
    const result = await searchService(c, entitlementRepositoryFactory, searchRepositoryFactory, ledgerRepositoryFactory, searchProviderFactory).search({ userId: c.get('userId'), sourceId, query, timeZone, limit, referenceAt: new Date() });
    return searchResultResponse(c, c.get('database'), c.get('userId'), result);
  });

  app.post('/related', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); const recordId = positiveId(body.recordId); const limit = body.limit === undefined ? 8 : relatedLimit(body.limit);
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400); if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400); if (!limit) return c.json({ ok: false, error: 'AI_RELATED_RECORDS_LIMIT_INVALID' }, 400);
    const result = await relatedService(c, entitlementRepositoryFactory, relatedRepositoryFactory).related({ userId: c.get('userId'), sourceId, recordId, limit, referenceAt: new Date() });
    return relatedResultResponse(c, result);
  });

  app.post('/summary', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400);
    const from = dateInput(body.from); const to = dateInput(body.to); if (!from) return c.json({ ok: false, error: 'AI_SUMMARY_FROM_INVALID' }, 400); if (!to) return c.json({ ok: false, error: 'AI_SUMMARY_TO_INVALID' }, 400);
    if (from.getTime() >= to.getTime()) return c.json({ ok: false, error: 'AI_SUMMARY_RANGE_INVALID' }, 400); if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60_000) return c.json({ ok: false, error: 'AI_SUMMARY_RANGE_TOO_LARGE' }, 400);
    const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim() ? body.timeZone.trim() : 'Asia/Taipei'; if (!validTimeZone(timeZone)) return c.json({ ok: false, error: 'AI_SUMMARY_TIMEZONE_INVALID' }, 400);
    const result = await summaryService(c, entitlementRepositoryFactory, summaryRepositoryFactory, ledgerRepositoryFactory, summaryProviderFactory).summarize({ userId: c.get('userId'), sourceId, from, to, timeZone, referenceAt: new Date() });
    return summaryResultResponse(c, c.get('database'), c.get('userId'), result);
  });

  app.post('/rewrite', async (c) => {
    const body = await objectBody(c); if (!body) return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
    const sourceId = positiveId(body.sourceId); const recordId = positiveId(body.recordId); const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!sourceId) return c.json({ ok: false, error: 'INVALID_SOURCE_ID' }, 400); if (!recordId) return c.json({ ok: false, error: 'INVALID_RECORD_ID' }, 400); if (!instruction || instruction.length > 1000) return c.json({ ok: false, error: 'AI_REWRITE_INSTRUCTION_REQUIRED' }, 400);
    const result = await rewriteService(c, entitlementRepositoryFactory, rewriteRepositoryFactory, ledgerRepositoryFactory, rewriteProviderFactory).propose({ userId: c.get('userId'), sourceId, recordId, instruction, referenceAt: new Date() });
    return rewriteResultResponse(c, c.get('database'), c.get('userId'), result);
  });
  return app;
}

function textService(c: CaptureRouteContext, entitlementRepositoryFactory: (database: Database) => AiEntitlementRepository, captureRepositoryFactory: (database: Database) => AiTextCaptureRepository, ledgerRepositoryFactory: (database: Database) => WorklogAiPointLedgerRepository, providerFactory: (env: AiTextCaptureBindings) => WorklogTextNormalizationProvider) { const database = c.get('database'); const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database)); return new AiTextCaptureService(captureRepositoryFactory(database), entitlement, new EntitledAiPointLedgerService(entitlement, new WorklogAiPointLedgerService(ledgerRepositoryFactory(database))), providerFactory(c.env)); }
function mediaService(c: CaptureRouteContext, entitlementRepositoryFactory: (database: Database) => AiEntitlementRepository, mediaRepositoryFactory: (database: Database) => AiMediaCaptureRepository, ledgerRepositoryFactory: (database: Database) => WorklogAiPointLedgerRepository, mediaProviderFactory: (env: AiTextCaptureBindings) => AiMediaProvider) { const database = c.get('database'); const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database)); return new AiMediaCaptureService(mediaRepositoryFactory(database), entitlement, new EntitledAiPointLedgerService(entitlement, new WorklogAiPointLedgerService(ledgerRepositoryFactory(database))), mediaProviderFactory(c.env)); }
function searchService(c: CaptureRouteContext, entitlementRepositoryFactory: (database: Database) => AiEntitlementRepository, searchRepositoryFactory: (database: Database) => AiNaturalSearchRepository, ledgerRepositoryFactory: (database: Database) => WorklogAiPointLedgerRepository, searchProviderFactory: (env: AiTextCaptureBindings) => AiNaturalSearchProvider) { const database = c.get('database'); const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database)); return new AiNaturalSearchService(searchRepositoryFactory(database), entitlement, new EntitledAiPointLedgerService(entitlement, new WorklogAiPointLedgerService(ledgerRepositoryFactory(database))), searchProviderFactory(c.env)); }
function relatedService(c: CaptureRouteContext, entitlementRepositoryFactory: (database: Database) => AiEntitlementRepository, relatedRepositoryFactory: (database: Database) => AiRelatedRecordsRepository) { const database = c.get('database'); return new AiRelatedRecordsService(relatedRepositoryFactory(database), new AiEntitlementService(entitlementRepositoryFactory(database))); }
function summaryService(c: CaptureRouteContext, entitlementRepositoryFactory: (database: Database) => AiEntitlementRepository, summaryRepositoryFactory: (database: Database) => AiTimeRangeSummaryRepository, ledgerRepositoryFactory: (database: Database) => WorklogAiPointLedgerRepository, summaryProviderFactory: (env: AiTextCaptureBindings) => AiTimeRangeSummaryProvider) { const database = c.get('database'); const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database)); return new AiTimeRangeSummaryService(summaryRepositoryFactory(database), entitlement, new EntitledAiPointLedgerService(entitlement, new WorklogAiPointLedgerService(ledgerRepositoryFactory(database))), summaryProviderFactory(c.env)); }
function rewriteService(c: CaptureRouteContext, entitlementRepositoryFactory: (database: Database) => AiEntitlementRepository, rewriteRepositoryFactory: (database: Database) => AiRecordRewriteRepository, ledgerRepositoryFactory: (database: Database) => WorklogAiPointLedgerRepository, rewriteProviderFactory: (env: AiTextCaptureBindings) => AiRewriteProvider) { const database = c.get('database'); const entitlement = new AiEntitlementService(entitlementRepositoryFactory(database)); return new AiRecordRewriteService(rewriteRepositoryFactory(database), entitlement, new EntitledAiPointLedgerService(entitlement, new WorklogAiPointLedgerService(ledgerRepositoryFactory(database))), rewriteProviderFactory(c.env)); }

async function captureResultResponse(c: CaptureRouteContext, database: Database, userId: number, result: CaptureRouteResult) { if (result.status === 'CREATED') return c.json({ ok: true, ...result }, 201); if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503); if (result.status === 'FAILED') return c.json({ ok: false, error: result.reason }, ['AI_MEDIA_DISABLED','AI_PRO_REQUIRED','AI_PRO_MEDIA_REQUIRED','AI_AUDIO_DURATION_TOO_LONG','AI_IMAGE_TOO_LARGE','AI_AUDIO_TOO_LARGE','AI_FILE_TOO_LARGE'].includes(result.reason) ? 409 : 502); if (isDurableAiProLimit(result.decision.reason)) await notifyAiLimitSafely(database, userId, result.decision.reason, result.decision.periodEndsAt); const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409; return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status); }
async function searchResultResponse(c: CaptureRouteContext, database: Database, userId: number, result: AiNaturalSearchResult) { if (result.status === 'RESULTS') return c.json({ ok: true, ...result }, 200); if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503); if (result.status === 'FAILED') return c.json({ ok: false, error: result.reason }, result.reason === 'AI_NATURAL_SEARCH_DISABLED' ? 409 : 502); if (isDurableAiProLimit(result.decision.reason)) await notifyAiLimitSafely(database, userId, result.decision.reason, result.decision.periodEndsAt); const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409; return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status); }
function relatedResultResponse(c: CaptureRouteContext, result: AiRelatedRecordsResult) { if (result.status === 'RESULTS') return c.json({ ok: true, ...result }, 200); if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: result.reason }, 404); if (result.status === 'FAILED') return c.json({ ok: false, error: result.reason }, ['AI_RELATED_RECORDS_DISABLED','AI_PRO_REQUIRED'].includes(result.reason) ? 409 : 500); const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409; return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status); }
async function summaryResultResponse(c: CaptureRouteContext, database: Database, userId: number, result: AiTimeRangeSummaryResult) { if (result.status === 'SUMMARY' || result.status === 'NO_RECORDS') return c.json({ ok: true, ...result }, 200); if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503); if (result.status === 'FAILED') return c.json({ ok: false, error: result.reason }, result.reason === 'AI_TIME_RANGE_SUMMARY_DISABLED' ? 409 : 502); if (isDurableAiProLimit(result.decision.reason)) await notifyAiLimitSafely(database, userId, result.decision.reason, result.decision.periodEndsAt); const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409; return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status); }
async function rewriteResultResponse(c: CaptureRouteContext, database: Database, userId: number, result: AiRecordRewriteResult) { if (result.status === 'PROPOSAL') return c.json({ ok: true, ...result }, 200); if (result.status === 'NOT_FOUND') return c.json({ ok: false, error: result.reason }, 404); if (result.status === 'DEFERRED') return c.json({ ok: false, error: result.reason }, 503); if (result.status === 'FAILED') return c.json({ ok: false, error: result.reason }, result.reason === 'AI_REWRITE_DISABLED' ? 409 : 502); if (isDurableAiProLimit(result.decision.reason)) await notifyAiLimitSafely(database, userId, result.decision.reason, result.decision.periodEndsAt); const status = result.decision.reason === 'SOURCE_NOT_AUTHORIZED' ? 403 : 409; return c.json({ ok: false, error: result.decision.reason, entitlement: result.decision }, status); }

function boundedMediaInput<T extends { mimeType: string; byteLength: number; dataBase64: string }>(value: unknown, rule: { requiredError: string; typeError: string; base64Error: string; sizeError: string; allowedMimeTypes: Set<string>; maxBytes: number }): { value: T } | { error: string } { if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: rule.requiredError }; const media = value as Record<string, unknown>; const mimeType = typeof media.mimeType === 'string' ? media.mimeType.trim().toLowerCase() : ''; if (!rule.allowedMimeTypes.has(mimeType)) return { error: rule.typeError }; const dataBase64 = typeof media.dataBase64 === 'string' ? media.dataBase64.trim() : ''; if (!dataBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) return { error: rule.base64Error }; const byteLength = decodedBase64Length(dataBase64); if (!byteLength || byteLength > rule.maxBytes) return { error: rule.sizeError }; return { value: { mimeType, byteLength, dataBase64 } as T }; }
function decodedBase64Length(value: string): number { if (value.length % 4 !== 0) return 0; const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0; const bytes = (value.length / 4) * 3 - padding; return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0; }
function boundedInstruction(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null; }
async function notifyAiLimitSafely(database: Database, userId: number, reason: string, periodEndsAt: string | null): Promise<void> { try { await notifySubscriptionEvent(new NotificationService(new DrizzleNotificationRepository(database)), userId, { type: 'AI_LIMIT_REACHED', periodKey: `${periodEndsAt ?? 'unknown-period'}:${reason}` }); } catch (error) { console.error(JSON.stringify({ event: 'ai_limit_system_notification_failed', userId, reason, message: error instanceof Error ? error.message : 'unknown error' })); } }
function isDurableAiProLimit(reason: string): boolean { return reason === 'MONTHLY_POINT_CAP_REACHED' || reason === 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED' || reason === 'MONTHLY_PROVIDER_COST_CAP_REACHED'; }
function bearerToken(header: string | undefined): string | null { if (!header) return null; const match = /^Bearer\s+(.+)$/i.exec(header.trim()); return match?.[1]?.trim() || null; }
function positiveId(value: unknown): number | null { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function positiveDuration(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 && parsed <= 24 * 60 * 60 ? parsed : null; }
function positiveLimit(value: unknown): number | null { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null; }
function relatedLimit(value: unknown): number | null { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : null; }
function dateInput(value: unknown): Date | null { if (typeof value !== 'string' || !value.trim()) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function validTimeZone(value: string): boolean { if (!value || value.length > 64) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0)); return true; } catch { return false; } }
async function objectBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown> | null> { try { const value = await c.req.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } }
