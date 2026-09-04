import { Hono } from 'hono';
import { DrizzleWebAuthRepository } from './auth/repository';
import { createWebAuthRoutes } from './auth/routes';
import { WebAuthService } from './auth/service';
import { createDatabase } from './db/client';
import { parseLineWebhook, parseOaWebhook } from './line/events';
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
import { DrizzleWorklogRecordWriteRepository } from './worklog/drizzle-records';
import { DrizzleWorklogTextNormalizationRepository } from './worklog/drizzle-text-normalization';
import { GeminiWorklogTextNormalizer } from './worklog/gemini-text-normalizer';
import { WorklogGrantBackedCollaboration } from './worklog/grant-collaboration';
import type { WorklogHistoryFilters } from './worklog/history-navigation';
import { processWorklogGroupWebhook } from './worklog/group-webhook';
import { WorklogLineRuntime } from './worklog/line-runtime';
import { WorklogOaRuntime } from './worklog/oa-runtime';
import { processWorklogOaWebhook } from './worklog/oa-webhook';
import { WorklogRecordWriteService } from './worklog/records';
import { WorklogTextNormalizationService } from './worklog/text-normalization';

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

const app = new Hono<{ Bindings: Bindings }>();
app.route('/api/v1/auth', createWebAuthRoutes());

app.get('/health', (c) => c.json({ service: 'after-trace-api', product: 'worklog', status: 'ok' }));

app.post('/webhooks/line', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-line-signature');
  if (!signature || !(await verifyLineSignature(rawBody, signature, c.env.LINE_CHANNEL_SECRET))) {
    return c.json({ ok: false, error: 'INVALID_LINE_SIGNATURE' }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return c.json({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  const parsedGroup = parseLineWebhook(payload);
  const parsedOa = parseOaWebhook(payload);
  if (parsedGroup.events.length === 0 && parsedOa.events.length === 0) {
    return c.json({
      ok: true,
      lifecycleEvents: 0,
      worklogCommands: 0,
      worklogRecords: 0,
      worklogDuplicateRecords: 0,
      worklogRejected: 0,
      worklogQueries: 0,
      worklogOwnerClaims: 0,
      worklogOrdinaryMessages: 0,
      worklogErrors: 0,
      oaLifecycleEvents: 0,
      oaWorklogCommands: 0,
      oaWorklogRecords: 0,
      oaWorklogDuplicateRecords: 0,
      oaWorklogRejected: 0,
      oaWorklogQueries: 0,
      oaHumanSupportMessages: 0,
      oaErrors: 0,
    });
  }

  const database = createDatabase(c.env.DATABASE_URL);
  const webAppUrl = c.env.WEB_APP_URL?.trim();
  const webAuthSecret = c.env.WEB_AUTH_SECRET?.trim();
  const webAuthService = webAppUrl && webAuthSecret
    ? new WebAuthService(
        new DrizzleWebAuthRepository(database),
        c.env.LINE_CHANNEL_ACCESS_TOKEN,
        webAuthSecret,
      )
    : null;
  const lineReplyClient = new LineMessagingReplyClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const worklogAnomalies = new DrizzleWorklogAnomalyRepository(database);
  const worklogAiGrants = new WorklogAiGrantService(new DrizzleWorklogAiGrantRepository(database));
  const worklogAiPoints = new WorklogAiPointLedgerService(new DrizzleWorklogAiPointLedgerRepository(database));
  const worklogAiResponsibility = new WorklogAiResponsibilityService(
    new DrizzleWorklogAiResponsibilityRepository(database),
    worklogAiGrants,
  );
  const worklogBootstrapService = new WorklogBootstrapService(
    new DrizzleWorklogBootstrapRepository(database),
    worklogAiGrants,
    worklogAiResponsibility,
  );
  const worklogRecordWriteService = new WorklogRecordWriteService(new DrizzleWorklogRecordWriteRepository(database));
  const worklogTextNormalizationService = new WorklogTextNormalizationService(
    new DrizzleWorklogTextNormalizationRepository(database),
    worklogAiPoints,
    new GeminiWorklogTextNormalizer({ apiKey: c.env.GEMINI_API_KEY }),
  );
  const worklogManualCollaboration = new WorklogCollaborationService(new DrizzleWorklogCollaborationRepository(database));
  const worklogLineRuntime = new WorklogLineRuntime(
    worklogBootstrapService,
    new WorklogGrantBackedCollaboration(worklogManualCollaboration, worklogAiResponsibility),
    worklogRecordWriteService,
    worklogTextNormalizationService,
  );
  const worklogOaRuntime = new WorklogOaRuntime(
    worklogBootstrapService,
    worklogRecordWriteService,
    worklogTextNormalizationService,
  );

  const [groupCounters, oaCounters] = await Promise.all([
    processWorklogGroupWebhook({
      parsed: parsedGroup,
      bootstrap: worklogBootstrapService,
      runtime: worklogLineRuntime,
      reply: lineReplyClient,
      replyTargets: worklogRecordWriteService,
      anomalies: worklogAnomalies,
      createQueryUrl: webAuthService && webAppUrl
        ? async (target) => appendHistoryFilters(
            await webAuthService.createBotEntry({
              webAppUrl,
              lineUserId: target.lineUserId,
              lineGroupId: target.lineGroupId,
              at: target.at,
            }),
            target.filters,
          )
        : undefined,
    }),
    processWorklogOaWebhook({
      parsed: parsedOa,
      runtime: worklogOaRuntime,
      reply: lineReplyClient,
      replyTargets: worklogRecordWriteService,
      anomalies: worklogAnomalies,
      createQueryUrl: webAuthService && webAppUrl
        ? async (target) => appendHistoryFilters(
            await webAuthService.createPrivateBotEntry({
              webAppUrl,
              lineUserId: target.lineUserId,
              userId: target.userId,
              sourceId: target.sourceId,
              at: target.at,
            }),
            target.filters,
          )
        : undefined,
    }),
  ]);

  return c.json({ ok: true, ...groupCounters, ...oaCounters });
});

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
