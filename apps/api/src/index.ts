import { Hono } from 'hono';
import { DrizzleWebAuthRepository } from './auth/repository';
import { createWebAuthRoutes } from './auth/routes';
import { WebAuthService } from './auth/service';
import { createDatabase } from './db/client';
import { parseLineWebhook, parseOaWebhook } from './line/events';
import { LineMessagingReplyClient } from './line/reply';
import { verifyLineSignature } from './line/signature';
import { WorklogBootstrapService } from './worklog/bootstrap';
import { WorklogCollaborationService } from './worklog/collaboration';
import { DrizzleWorklogBootstrapRepository } from './worklog/drizzle-bootstrap';
import { DrizzleWorklogCollaborationRepository } from './worklog/drizzle-collaboration';
import { DrizzleWorklogRecordWriteRepository } from './worklog/drizzle-records';
import { DrizzleWorklogSubscriptionRepository } from './worklog/drizzle-subscription';
import { DrizzleWorklogTextNormalizationRepository } from './worklog/drizzle-text-normalization';
import { GeminiWorklogTextNormalizer } from './worklog/gemini-text-normalizer';
import { processWorklogGroupWebhook } from './worklog/group-webhook';
import { WorklogLineRuntime } from './worklog/line-runtime';
import { WorklogOaRuntime } from './worklog/oa-runtime';
import { processWorklogOaWebhook } from './worklog/oa-webhook';
import { WorklogRecordWriteService } from './worklog/records';
import { WorklogSubscriptionService } from './worklog/subscription';
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
  const worklogBootstrapService = new WorklogBootstrapService(new DrizzleWorklogBootstrapRepository(database));
  const worklogRecordWriteService = new WorklogRecordWriteService(new DrizzleWorklogRecordWriteRepository(database));
  const worklogTextNormalizationService = new WorklogTextNormalizationService(
    new DrizzleWorklogTextNormalizationRepository(database),
    new WorklogSubscriptionService(new DrizzleWorklogSubscriptionRepository(database)),
    new GeminiWorklogTextNormalizer({ apiKey: c.env.GEMINI_API_KEY }),
  );
  const worklogLineRuntime = new WorklogLineRuntime(
    worklogBootstrapService,
    new WorklogCollaborationService(new DrizzleWorklogCollaborationRepository(database)),
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
      createQueryUrl: webAuthService && webAppUrl
        ? (target) => webAuthService.createBotEntry({
            webAppUrl,
            lineUserId: target.lineUserId,
            lineGroupId: target.lineGroupId,
            at: target.at,
          })
        : undefined,
    }),
    processWorklogOaWebhook({
      parsed: parsedOa,
      runtime: worklogOaRuntime,
      reply: lineReplyClient,
      createQueryUrl: webAuthService && webAppUrl
        ? (target) => webAuthService.createPrivateBotEntry({
            webAppUrl,
            lineUserId: target.lineUserId,
            userId: target.userId,
            sourceId: target.sourceId,
            at: target.at,
          })
        : undefined,
    }),
  ]);

  return c.json({ ok: true, ...groupCounters, ...oaCounters });
});

export default app;
