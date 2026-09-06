import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { DrizzleWebAuthRepository } from './auth/repository';
import { createWebAuthRoutes } from './auth/routes';
import { WebAuthService } from './auth/service';
import { createDatabase } from './db/client';
import { parseLineWebhook, parseOaWebhook } from './line/events';
import { LineGroupSummaryClient } from './line/group-summary';
import { LineMessagingReplyClient } from './line/reply';
import { verifyLineSignature } from './line/signature';
import { WorklogAiGrantService } from './worklog/ai-grants';
import { WorklogAiPointLedgerService } from './worklog/ai-point-ledger';
import { WorklogAiResponsibilityService } from './worklog/ai-responsibility';
import { DrizzleWorklogAnomalyRepository } from './worklog/anomalies';
import { WorklogBootstrapService } from './worklog/bootstrap';
import { WorklogCollaborationService } from './worklog/collaboration';
import { DrizzleWorklogAiGrantRepository } from './worklog/drizzle-ai-grants';
import { DrizzleWorklogAiPointLedgerRepository } from './worklog/drizzle-ai-point-ledger';
import { DrizzleWorklogAiResponsibilityRepository } from './worklog/drizzle-ai-responsibility';
import { DrizzleWorklogBootstrapRepository } from './worklog/drizzle-bootstrap';
import { DrizzleWorklogCollaborationRepository } from './worklog/drizzle-collaboration';
import { DrizzleWorklogGroupProfileRepository } from './worklog/drizzle-group-profile';
import { DrizzleWorklogInterpretedEditStageRepository } from './worklog/drizzle-interpreted-edit';
import { DrizzleWorklogInterpretedRecordRepository } from './worklog/drizzle-interpreted-record';
import { DrizzleWorklogLineRecordActionRepository } from './worklog/drizzle-line-record-actions';
import { DrizzleWorklogLineRecordEditRepository } from './worklog/drizzle-line-record-edit';
import { DrizzleWorklogLineSystemQueryRepository } from './worklog/drizzle-line-system-query';
import { DrizzleWorklogRecordWriteRepository } from './worklog/drizzle-records';
import { DrizzleWorklogTextNormalizationRepository } from './worklog/drizzle-text-normalization';
import { GeminiWorklogLineNaturalInterpreter } from './worklog/gemini-line-natural-interpreter';
import { WorklogGrantBackedCollaboration } from './worklog/grant-collaboration';
import { WorklogGroupProfileService } from './worklog/group-profile';
import type { WorklogHistoryFilters } from './worklog/history-navigation';
import { WorklogHistoryQueryService } from './worklog/history-query';
import { processWorklogGroupWebhook } from './worklog/group-webhook';
import { WorklogInterpretedEditService } from './worklog/interpreted-edit';
import { WorklogInterpretedRecordService } from './worklog/interpreted-record';
import { WorklogLineNaturalInterpreterService } from './worklog/line-natural-interpreter';
import { WorklogLineNaturalRuntime } from './worklog/line-natural-runtime';
import { WorklogLineRecordActionService } from './worklog/line-record-actions';
import { WorklogLineSystemQueryService } from './worklog/line-system-query';
import { WorklogOaNaturalRuntime } from './worklog/oa-natural-runtime';
import { processWorklogOaWebhook } from './worklog/oa-webhook';
import { WorklogRecordWriteService } from './worklog/records';

export type Bindings = {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  WEB_APP_URL?: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GEMINI_API_KEY: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_WEB_ORIGIN?: string;
};

const SUPPORTED_AI_PROVIDER = 'GOOGLE';
const app = new Hono<{ Bindings: Bindings }>();
app.route('/api/v1/auth', createWebAuthRoutes());

app.get('/health', (c) => c.json({ service: 'after-trace-api', product: 'worklog', status: 'ok' }));

app.get('/health/ready', async (c) => {
  const missing = launchConfigErrors(c.env);
  if (missing.length > 0) return c.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'RUNTIME_CONFIG_INCOMPLETE', missing }, 503);
  const database = createDatabase(c.env.DATABASE_URL);
  try {
    await database.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM worklog_users WHERE FALSE) AS users_probe,
        (SELECT COUNT(*) FROM worklog_source_members WHERE FALSE) AS members_probe,
        (SELECT COUNT(*) FROM worklog_source_line_profiles WHERE FALSE) AS group_profiles_probe,
        (SELECT COUNT(*) FROM worklog_user_subscriptions WHERE FALSE) AS subscriptions_probe,
        (SELECT COUNT(plan_type) FROM worklog_subscription_plans WHERE FALSE) AS plan_type_probe,
        (SELECT COUNT(grant_points) FROM worklog_subscription_plans WHERE FALSE) AS plan_points_probe,
        (SELECT COUNT(search_terms) FROM worklog_records WHERE FALSE) AS record_search_terms_probe,
        (SELECT COUNT(*) FROM worklog_entities WHERE FALSE) AS entities_probe,
        (SELECT COUNT(*) FROM worklog_entity_aliases WHERE FALSE) AS aliases_probe,
        (SELECT COUNT(*) FROM worklog_record_revisions WHERE FALSE) AS revisions_probe,
        (SELECT COUNT(*) FROM worklog_ai_confirmations WHERE FALSE) AS confirmations_probe,
        (SELECT COUNT(*) FROM worklog_ai_grants WHERE FALSE) AS grants_probe,
        (SELECT COUNT(*) FROM worklog_ai_grant_scopes WHERE FALSE) AS grant_scopes_probe,
        (SELECT COUNT(*) FROM worklog_ai_point_reservations WHERE FALSE) AS reservations_probe,
        (SELECT COUNT(customer_points_charged) FROM worklog_ai_usage_events WHERE FALSE) AS charged_points_probe,
        (SELECT COUNT(platform_subsidized_points) FROM worklog_ai_usage_events WHERE FALSE) AS subsidy_points_probe,
        (SELECT COUNT(*) FROM worklog_source_ai_responsibility WHERE FALSE) AS responsibility_probe
    `);
  } catch (error) {
    console.error('WORKLOG_READINESS_SCHEMA_PROBE_FAILED', error);
    return c.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'WORKLOG_DATABASE_OR_SCHEMA_UNAVAILABLE' }, 503);
  }
  try {
    const runtime = await database.execute(sql`SELECT provider, model, output_usd_per_million FROM worklog_ai_runtime_config WHERE id = 1 LIMIT 1`);
    const row = runtime.rows[0] as { provider?: unknown; model?: unknown; output_usd_per_million?: unknown } | undefined;
    const outputPrice = Number(row?.output_usd_per_million ?? 0);
    const provider = typeof row?.provider === 'string' ? row.provider.trim().toUpperCase() : '';
    const model = typeof row?.model === 'string' ? row.model.trim() : '';
    if (provider !== SUPPORTED_AI_PROVIDER || !model || !Number.isFinite(outputPrice) || outputPrice <= 0) return c.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'AI_RUNTIME_CONFIG_NOT_INITIALIZED' }, 503);
  } catch {
    return c.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'AI_RUNTIME_CONFIG_NOT_INITIALIZED' }, 503);
  }
  try {
    const free = await database.execute(sql`SELECT plan_type, price_twd, grant_points, enabled FROM worklog_subscription_plans WHERE code = 'FREE' LIMIT 1`);
    const row = free.rows[0] as { plan_type?: unknown; price_twd?: unknown; grant_points?: unknown; enabled?: unknown } | undefined;
    const grantPoints = Number(row?.grant_points ?? -1);
    if (row?.enabled !== true || row.plan_type !== 'FREE' || Number(row.price_twd ?? -1) !== 0 || !Number.isSafeInteger(grantPoints) || grantPoints < 0) return c.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'FREE_PLAN_NOT_INITIALIZED' }, 503);
  } catch {
    return c.json({ service: 'after-trace-api', product: 'worklog', status: 'not_ready', error: 'FREE_PLAN_NOT_INITIALIZED' }, 503);
  }
  return c.json({ service: 'after-trace-api', product: 'worklog', status: 'ready' });
});

app.post('/webhooks/line', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-line-signature');
  if (!signature || !(await verifyLineSignature(rawBody, signature, c.env.LINE_CHANNEL_SECRET))) return c.json({ ok: false, error: 'INVALID_LINE_SIGNATURE' }, 401);
  let payload: unknown;
  try { payload = JSON.parse(rawBody) as unknown; } catch { return c.json({ ok: false, error: 'INVALID_JSON' }, 400); }
  const parsedGroup = parseLineWebhook(payload);
  const parsedOa = parseOaWebhook(payload);
  if (parsedGroup.events.length === 0 && parsedOa.events.length === 0) {
    return c.json({ ok: true, lifecycleEvents: 0, worklogCommands: 0, worklogRecords: 0, worklogDuplicateRecords: 0, worklogRejected: 0, worklogQueries: 0, worklogAiResponsibilityClaims: 0, worklogOrdinaryMessages: 0, worklogErrors: 0, oaLifecycleEvents: 0, oaWorklogCommands: 0, oaWorklogRecords: 0, oaWorklogDuplicateRecords: 0, oaWorklogRejected: 0, oaWorklogQueries: 0, oaHumanSupportMessages: 0, oaErrors: 0 });
  }

  const database = createDatabase(c.env.DATABASE_URL);
  const webAppUrl = c.env.WEB_APP_URL?.trim();
  const webAuthSecret = c.env.WEB_AUTH_SECRET?.trim();
  const webAuthService = webAppUrl && webAuthSecret ? new WebAuthService(new DrizzleWebAuthRepository(database), c.env.LINE_CHANNEL_ACCESS_TOKEN, webAuthSecret) : null;
  const lineReplyClient = new LineMessagingReplyClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const lineGroupSummaryClient = new LineGroupSummaryClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const worklogAnomalies = new DrizzleWorklogAnomalyRepository(database);
  const worklogHistory = new WorklogHistoryQueryService(database);
  const worklogGroupProfiles = new WorklogGroupProfileService(new DrizzleWorklogGroupProfileRepository(database), lineGroupSummaryClient);
  const worklogAiGrants = new WorklogAiGrantService(new DrizzleWorklogAiGrantRepository(database));
  const worklogAiPoints = new WorklogAiPointLedgerService(new DrizzleWorklogAiPointLedgerRepository(database));
  const worklogAiResponsibility = new WorklogAiResponsibilityService(new DrizzleWorklogAiResponsibilityRepository(database), worklogAiGrants);
  const worklogBootstrapService = new WorklogBootstrapService(new DrizzleWorklogBootstrapRepository(database), worklogAiGrants, worklogAiResponsibility);
  const worklogRecordWriteService = new WorklogRecordWriteService(new DrizzleWorklogRecordWriteRepository(database));
  const normalizationRepository = new DrizzleWorklogTextNormalizationRepository(database);
  const lineEditRepository = new DrizzleWorklogLineRecordEditRepository(database);
  const worklogNaturalInterpreter = new WorklogLineNaturalInterpreterService(normalizationRepository, worklogAiPoints, new GeminiWorklogLineNaturalInterpreter({ apiKey: c.env.GEMINI_API_KEY }));
  const worklogInterpretedRecords = new WorklogInterpretedRecordService(new DrizzleWorklogInterpretedRecordRepository(database));
  const worklogInterpretedEdits = new WorklogInterpretedEditService(lineEditRepository, new DrizzleWorklogInterpretedEditStageRepository(database));
  const worklogRecordActions = new WorklogLineRecordActionService(new DrizzleWorklogLineRecordActionRepository(database));
  const worklogSystemQueries = new WorklogLineSystemQueryService(new DrizzleWorklogLineSystemQueryRepository(database), worklogAiGrants);
  const worklogManualCollaboration = new WorklogCollaborationService(new DrizzleWorklogCollaborationRepository(database));
  const worklogCollaboration = new WorklogGrantBackedCollaboration(worklogManualCollaboration, worklogAiResponsibility);
  const worklogLineRuntime = new WorklogLineNaturalRuntime(worklogBootstrapService, worklogCollaboration, worklogRecordWriteService, worklogNaturalInterpreter, worklogInterpretedRecords, worklogInterpretedEdits, worklogRecordActions, worklogSystemQueries);
  const worklogOaRuntime = new WorklogOaNaturalRuntime(worklogBootstrapService, worklogRecordWriteService, worklogNaturalInterpreter, worklogInterpretedRecords, worklogInterpretedEdits, worklogRecordActions, worklogSystemQueries, worklogAiGrants);

  const [groupCounters, oaCounters] = await Promise.all([
    processWorklogGroupWebhook({
      parsed: parsedGroup,
      bootstrap: worklogBootstrapService,
      runtime: worklogLineRuntime,
      reply: lineReplyClient,
      replyTargets: worklogRecordWriteService,
      anomalies: worklogAnomalies,
      refreshGroupProfile: async (lineGroupId, at) => worklogGroupProfiles.refreshIfStale({ lineGroupId, at }),
      queryHistory: async (target) => worklogHistory.query(target.sourceId, target.filters),
      createQueryUrl: webAuthService && webAppUrl ? async (target) => appendHistoryFilters(await webAuthService.createBotEntry({ webAppUrl, lineUserId: target.lineUserId, lineGroupId: target.lineGroupId, at: target.at }), target.filters) : undefined,
    }),
    processWorklogOaWebhook({
      parsed: parsedOa,
      runtime: worklogOaRuntime,
      reply: lineReplyClient,
      replyTargets: worklogRecordWriteService,
      anomalies: worklogAnomalies,
      queryHistory: async (target) => worklogHistory.query(target.sourceId, target.filters),
      createQueryUrl: webAuthService && webAppUrl ? async (target) => appendHistoryFilters(await webAuthService.createPrivateBotEntry({ webAppUrl, lineUserId: target.lineUserId, userId: target.userId, sourceId: target.sourceId, at: target.at }), target.filters) : undefined,
    }),
  ]);
  return c.json({ ok: true, ...groupCounters, ...oaCounters });
});

function launchConfigErrors(env: Bindings): string[] {
  const missing: string[] = [];
  if (!required(env.DATABASE_URL)) missing.push('DATABASE_URL');
  if (!required(env.LINE_CHANNEL_SECRET)) missing.push('LINE_CHANNEL_SECRET');
  if (!required(env.LINE_CHANNEL_ACCESS_TOKEN)) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!required(env.GEMINI_API_KEY)) missing.push('GEMINI_API_KEY');
  const webAppUrl = exactAppOrigin(env.WEB_APP_URL);
  const webAppOrigin = exactAppOrigin(env.WEB_APP_ORIGIN);
  if (!webAppUrl) missing.push('WEB_APP_URL');
  if (!webAppOrigin) missing.push('WEB_APP_ORIGIN');
  if (webAppUrl && webAppOrigin && webAppUrl !== webAppOrigin) missing.push('WEB_APP_URL', 'WEB_APP_ORIGIN');
  if (!secret(env.WEB_AUTH_SECRET)) missing.push('WEB_AUTH_SECRET');
  if (!required(env.LINE_LOGIN_CHANNEL_ID)) missing.push('LINE_LOGIN_CHANNEL_ID');
  if (!required(env.LINE_LOGIN_CHANNEL_SECRET)) missing.push('LINE_LOGIN_CHANNEL_SECRET');
  if (!required(env.ADMIN_USERNAME)) missing.push('ADMIN_USERNAME');
  if (!adminPassword(env.ADMIN_PASSWORD)) missing.push('ADMIN_PASSWORD');
  if (!secret(env.ADMIN_SESSION_SECRET)) missing.push('ADMIN_SESSION_SECRET');
  if (!exactAppOrigin(env.ADMIN_WEB_ORIGIN)) missing.push('ADMIN_WEB_ORIGIN');
  return [...new Set(missing)];
}

function required(value: string | undefined): boolean { return Boolean(value?.trim()); }
function adminPassword(value: string | undefined): boolean { return Boolean(value && value.length >= 8 && value.length <= 512); }
function secret(value: string | undefined): boolean { return Boolean(value?.trim() && value.trim().length >= 32); }
function exactAppOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!url.host || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const loopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) return null;
    return url.origin;
  } catch { return null; }
}
function appendHistoryFilters(url: string | null, filters: WorklogHistoryFilters): string | null {
  if (!url) return null;
  const value = new URL(url);
  if (filters.entityId) value.searchParams.set('entityId', String(filters.entityId));
  if (filters.query?.trim()) value.searchParams.set('q', filters.query.trim());
  if (filters.from) value.searchParams.set('from', filters.from);
  if (filters.to) value.searchParams.set('to', filters.to);
  return value.toString();
}

export default app;
