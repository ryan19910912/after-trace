import { Hono } from 'hono';
import { resolveProductConfig, type ProductConfigEnv } from './config/product';
import { DrizzleConversationRepository } from './conversation/drizzle-repository';
import { ConversationIngestionService } from './conversation/service';
import { createDatabase } from './db/client';
import { DrizzleUserEnergyAccessRepository } from './energy/drizzle-access';
import { DrizzleUserEnergyRepository } from './energy/drizzle-repository';
import { UserEnergyAccessService } from './energy/access';
import { DrizzleExtractionClaimRepository } from './extraction/drizzle-repository';
import { ConversationExtractionCoordinator } from './extraction/service';
import {
  detectDeterministicAiCommand,
  detectExplicitMemoryCommand,
  isAiMention,
} from './line/commands';
import { parseLineWebhook } from './line/events';
import { LineMessagingReplyClient } from './line/reply';
import { verifyLineSignature } from './line/signature';
import { createManagementRoutes } from './management/routes';
import { DrizzleMemoryRequestRepository } from './memory/drizzle-request-repository';
import { ExplicitMemoryRequestService } from './memory/requests';
import { AutomaticMemoryRequestService } from './memory/work';

export type Bindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LIFF_CHANNEL_ID: string;
  LIFF_APP_URL?: string;
  GEMINI_API_KEY: string;
  LIFF_WEB_ORIGIN?: string;
  REMINDER_RESERVATION_COST_TWD?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.route('/api/v1/management', createManagementRoutes());

app.get('/health', (c) =>
  c.json({
    service: 'after-trace-api',
    status: 'ok',
  }),
);

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

  const parsed = parseLineWebhook(payload);
  if (parsed.events.length === 0) {
    return c.json({
      ok: true,
      lifecycleEvents: 0,
      storedMessages: 0,
      duplicateMessages: 0,
      ignoredInactiveMessages: 0,
      lifetimeFreeGrants: 0,
      deterministicReplies: 0,
      energyBlockedAiRequests: 0,
      explicitMemoryRequests: 0,
      blockedMemoryRequests: 0,
      automaticMemoryRequests: 0,
      extractionCandidates: 0,
      extractionClaims: 0,
    });
  }

  const config = resolveProductConfig(c.env);
  const database = createDatabase(c.env.DATABASE_URL);
  const conversationRepository = new DrizzleConversationRepository(database);
  const conversationService = new ConversationIngestionService(conversationRepository, config);
  const extractionRepository = new DrizzleExtractionClaimRepository(database);
  const extractionCoordinator = new ConversationExtractionCoordinator(extractionRepository, config);
  const energyRepository = new DrizzleUserEnergyRepository(database);
  const energyAccessService = c.env.LIFF_APP_URL?.trim()
    ? new UserEnergyAccessService(
        new DrizzleUserEnergyAccessRepository(database),
        c.env.LIFF_APP_URL,
      )
    : null;
  const lineReplyClient = new LineMessagingReplyClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const memoryRequestRepository = new DrizzleMemoryRequestRepository(database);
  const explicitMemoryRequestService = new ExplicitMemoryRequestService(memoryRequestRepository);
  const automaticMemoryRequestService = new AutomaticMemoryRequestService(memoryRequestRepository);

  let lifecycleEvents = 0;
  let storedMessages = 0;
  let duplicateMessages = 0;
  let ignoredInactiveMessages = 0;
  let lifetimeFreeGrants = 0;
  let deterministicReplies = 0;
  let energyBlockedAiRequests = 0;
  let explicitMemoryRequests = 0;
  let blockedMemoryRequests = 0;
  let automaticMemoryRequests = 0;
  let extractionCandidates = 0;
  let extractionClaims = 0;

  for (const parsedEvent of parsed.events) {
    if (parsedEvent.kind === 'LIFECYCLE') {
      const event = parsedEvent.event;
      await conversationService.handleLifecycle(event.lineGroupId, event.type, event.lineTimestamp);
      lifecycleEvents += 1;
      continue;
    }

    const message = parsedEvent.message;
    const result = await conversationService.ingest(message);
    if (result.status === 'IGNORED_INACTIVE') {
      ignoredInactiveMessages += 1;
      continue;
    }

    if (result.status === 'DUPLICATE') duplicateMessages += 1;
    else storedMessages += 1;

    if (message.lineUserId) {
      const free = await energyRepository.ensureLifetimeFreeForLineUser(
        message.lineUserId,
        config.energy.freeInitialUnits,
      );
      if (free.status === 'GRANTED') lifetimeFreeGrants += 1;
      if (free.status === 'REFERENCE_CONFLICT') {
        throw new Error('lifetime FREE Energy consistency failure');
      }
    }

    const deterministicCommand = detectDeterministicAiCommand(message);
    if (
      deterministicCommand &&
      message.lineUserId &&
      message.replyToken &&
      energyAccessService
    ) {
      let reply: string;
      if (deterministicCommand.kind === 'ENERGY_STATUS') {
        reply = await energyAccessService.energyStatus({
          groupId: result.groupId,
          callerLineUserId: message.lineUserId,
          at: message.lineTimestamp,
        });
      } else if (deterministicCommand.kind === 'HELP') {
        reply = [
          'AFTERTRACE｜幫助',
          '',
          '@AI 額度：查看群組成員是否還可使用 Energy（不顯示他人數字）',
          '@AI 記住 ...：明確要求 AFTERTRACE 記住資訊',
          '@AI 方案：查看目前 V1 Energy 取得方式',
        ].join('\n');
      } else {
        reply = [
          'AFTERTRACE｜V1 Energy',
          '',
          'FREE：每位使用者一生一次',
          'SUBSCRIPTION：每個 billing cycle 發放，到 period_end 過期',
          'AD：Rewarded Ad，取得後 7 天過期',
          'PAID：一次性 Energy Pack，不過期',
          '',
          '實際 Energy 數量與價格以 AFTERTRACE LIFF 顯示為準。',
          c.env.LIFF_APP_URL,
        ].join('\n');
      }
      await lineReplyClient.reply(message.replyToken, reply);
      deterministicReplies += 1;
      continue;
    }

    if (
      isAiMention(message) &&
      message.lineUserId &&
      message.replyToken &&
      energyAccessService
    ) {
      const preflight = await energyAccessService.preflightExplicitAi({
        groupId: result.groupId,
        callerLineUserId: message.lineUserId,
        at: message.lineTimestamp,
      });
      if (preflight.status !== 'READY') {
        await lineReplyClient.reply(message.replyToken, preflight.reply);
        energyBlockedAiRequests += 1;
        continue;
      }
    }

    const explicitMemoryCommand = detectExplicitMemoryCommand(message);
    if (explicitMemoryCommand) {
      const request = await explicitMemoryRequestService.enqueue(
        result.groupId,
        message,
        explicitMemoryCommand,
      );
      if (request.status === 'PENDING') explicitMemoryRequests += 1;
      else blockedMemoryRequests += 1;
    }

    if (result.threshold.extractionDue) {
      extractionCandidates += 1;
    }

    const claim = await extractionCoordinator.claimDueBatch(result.groupId);
    if (claim) {
      extractionClaims += 1;
      const automaticRequest = await automaticMemoryRequestService.ensureForExtractionBatch(
        result.groupId,
        claim.id,
        message.lineTimestamp,
      );
      if (automaticRequest.created) automaticMemoryRequests += 1;

      console.log(
        JSON.stringify({
          event: 'conversation_extraction_claimed',
          extractionBatchId: claim.id,
          memoryRequestId: automaticRequest.id,
          memoryRequestCreated: automaticRequest.created,
          messageCount: claim.messageCount,
          charCount: claim.charCount,
          attemptCount: claim.attemptCount,
        }),
      );
    }
  }

  return c.json({
    ok: true,
    lifecycleEvents,
    storedMessages,
    duplicateMessages,
    ignoredInactiveMessages,
    lifetimeFreeGrants,
    deterministicReplies,
    energyBlockedAiRequests,
    explicitMemoryRequests,
    blockedMemoryRequests,
    automaticMemoryRequests,
    extractionCandidates,
    extractionClaims,
  });
});

export default app;
