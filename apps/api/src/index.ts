import { Hono } from 'hono';
import { ExplicitAiChatService, explicitAiChatDisabledReason } from './ai/chat';
import { createCommerceRoutes } from './commerce/routes';
import { resolveProductConfig, type ProductConfigEnv } from './config/product';
import { DrizzleConversationRepository } from './conversation/drizzle-repository';
import { ConversationIngestionService } from './conversation/service';
import { createDatabase } from './db/client';
import { UserEnergyAccessService } from './energy/access';
import { backgroundPreflight } from './energy/background';
import { DrizzleUserEnergyAccessRepository } from './energy/drizzle-access';
import { DrizzleBackgroundEnergyRepository } from './energy/drizzle-background';
import { DrizzleUserEnergyRepository } from './energy/drizzle-repository';
import { createEnergyRoutes } from './energy/routes';
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
import { memoryAiRuntimeDisabledReason, UserEnergyMemoryAiRuntime } from './memory/runtime';
import { AutomaticMemoryRequestService } from './memory/work';

export type Bindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LIFF_CHANNEL_ID: string;
  LIFF_APP_URL?: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  GEMINI_INPUT_USD_PER_MILLION_TOKENS?: string;
  GEMINI_OUTPUT_USD_PER_MILLION_TOKENS?: string;
  GEMINI_CHAT_MAX_OUTPUT_TOKENS?: string;
  USD_TWD_RATE?: string;
  GLOBAL_FREE_AI_BUDGET_COST_TWD?: string;
  BACKGROUND_AI_MAX_SUBSIDY_COST_TWD?: string;
  ENERGY_UNITS_PER_TWD?: string;
  LIFF_WEB_ORIGIN?: string;
  REMINDER_RESERVATION_ENERGY?: string;
  GOOGLE_AD_MANAGER_NETWORK_CODE?: string;
  GOOGLE_AD_MANAGER_REWARDED_AD_UNIT_PATH?: string;
  COMMERCE_WEBHOOK_SECRET?: string;
  COMMERCE_PROVIDER?: string;
  PROACTIVE_INTERNAL_SECRET?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.route('/api/v1/management', createManagementRoutes());
app.route('/api/v1/energy', createEnergyRoutes());
app.route('/api/v1/internal/commerce', createCommerceRoutes());

app.get('/health', (c) => c.json({ service: 'after-trace-api', status: 'ok' }));

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
      explicitAiReplies: 0,
      energyBlockedAiRequests: 0,
      explicitMemoryRequests: 0,
      blockedMemoryRequests: 0,
      automaticMemoryRequests: 0,
      extractionCandidates: 0,
      extractionClaims: 0,
      extractionNoEligibleSkips: 0,
      aiRuntime: 'NO_WORK',
    });
  }

  const config = resolveProductConfig(c.env);
  const database = createDatabase(c.env.DATABASE_URL);
  const conversationService = new ConversationIngestionService(
    new DrizzleConversationRepository(database),
    config,
  );
  const extractionCoordinator = new ConversationExtractionCoordinator(
    new DrizzleExtractionClaimRepository(database),
    config,
  );
  const energyRepository = new DrizzleUserEnergyRepository(database);
  const backgroundEnergyRepository = new DrizzleBackgroundEnergyRepository(database);
  const energyAccessService = c.env.LIFF_APP_URL?.trim()
    ? new UserEnergyAccessService(
        new DrizzleUserEnergyAccessRepository(database, c.env.LINE_CHANNEL_ACCESS_TOKEN),
        c.env.LIFF_APP_URL,
      )
    : null;
  const lineReplyClient = new LineMessagingReplyClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const memoryRequestRepository = new DrizzleMemoryRequestRepository(database);
  const explicitMemoryRequestService = new ExplicitMemoryRequestService(memoryRequestRepository);
  const automaticMemoryRequestService = new AutomaticMemoryRequestService(memoryRequestRepository);
  const aiDisabledReason = memoryAiRuntimeDisabledReason(c.env);
  const aiRuntime = aiDisabledReason ? null : new UserEnergyMemoryAiRuntime(database, c.env);
  const chatDisabledReason = explicitAiChatDisabledReason(c.env);
  const chatService = chatDisabledReason ? null : new ExplicitAiChatService(database, c.env);
  const groupsWithAiWork = new Set<number>();

  let lifecycleEvents = 0;
  let storedMessages = 0;
  let duplicateMessages = 0;
  let ignoredInactiveMessages = 0;
  let lifetimeFreeGrants = 0;
  let deterministicReplies = 0;
  let explicitAiReplies = 0;
  let energyBlockedAiRequests = 0;
  let explicitMemoryRequests = 0;
  let blockedMemoryRequests = 0;
  let automaticMemoryRequests = 0;
  let extractionCandidates = 0;
  let extractionClaims = 0;
  let extractionNoEligibleSkips = 0;

  for (const parsedEvent of parsed.events) {
    if (parsedEvent.kind === 'LIFECYCLE') {
      await conversationService.handleLifecycle(parsedEvent.event);
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
      if (free.status === 'REFERENCE_CONFLICT') throw new Error('lifetime FREE Energy consistency failure');
    }

    const deterministicCommand = detectDeterministicAiCommand(message);
    const explicitMemoryCommand = detectExplicitMemoryCommand(message);

    if (deterministicCommand && message.lineUserId && message.replyToken) {
      let reply: string;
      if (deterministicCommand.kind === 'ENERGY_STATUS') {
        reply = energyAccessService
          ? await energyAccessService.energyStatus({
              groupId: result.groupId,
              callerLineUserId: message.lineUserId,
              at: message.lineTimestamp,
            })
          : 'AFTERTRACE｜群組 Energy\n\n詳細 Energy 查詢會在 LIFF 啟用後開放。';
      } else if (deterministicCommand.kind === 'HELP') {
        reply = [
          'AFTERTRACE｜幫助', '',
          '@AFTERTRACE <問題>：用群組近期對話與記憶回答',
          '@AFTERTRACE 額度：查看群組成員是否還可使用 Energy（不顯示他人數字）',
          '@AFTERTRACE 記住 ...：明確要求 AFTERTRACE 記住資訊',
          '@AFTERTRACE 方案：查看目前 V1 Energy 取得方式',
        ].join('\n');
      } else {
        reply = [
          'AFTERTRACE｜V1 Energy', '',
          'FREE：每位使用者一生一次',
          'SUBSCRIPTION：每個 billing cycle 發放，到 period_end 過期',
          'AD：Rewarded Ad，取得後 7 天過期',
          'PAID：一次性 Energy Pack，不過期',
          ...(c.env.LIFF_APP_URL?.trim()
            ? ['', '實際 Energy 數量與價格以 AFTERTRACE LIFF 顯示為準。', c.env.LIFF_APP_URL]
            : ['', '詳細 Energy 與購買頁面會在 LIFF 啟用後開放。']),
        ].join('\n');
      }
      await lineReplyClient.reply(message.replyToken, reply);
      deterministicReplies += 1;
      continue;
    }

    const genericAiQuestion = isAiMention(message) && !explicitMemoryCommand;
    if (genericAiQuestion && message.lineUserId && message.replyToken) {
      if (energyAccessService) {
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

      if (!chatService) {
        await lineReplyClient.reply(
          message.replyToken,
          `AFTERTRACE AI 目前尚未啟用。${c.env.LIFF_APP_URL ? `\n${c.env.LIFF_APP_URL}` : ''}`,
        );
      } else {
        const chat = await chatService.answer({
          groupId: result.groupId,
          lineUserId: message.lineUserId,
          lineMessageId: message.lineMessageId,
          text: message.textContent ?? '',
          at: message.lineTimestamp,
        });
        if (chat.status === 'ANSWERED' || chat.status === 'ALREADY_ANSWERED') {
          await lineReplyClient.reply(message.replyToken, chat.text);
          explicitAiReplies += 1;
        } else if (chat.status === 'INSUFFICIENT_ENERGY') {
          await lineReplyClient.reply(
            message.replyToken,
            `你的 Energy 不足以安全完成這次 AI 請求。${c.env.LIFF_APP_URL ? `\n可到 AFTERTRACE 查看或補充 Energy：\n${c.env.LIFF_APP_URL}` : ''}`,
          );
          energyBlockedAiRequests += 1;
        } else {
          await lineReplyClient.reply(message.replyToken, 'AFTERTRACE AI 暫時無法完成這次請求，請稍後再試。');
        }
      }
      continue;
    }

    if (explicitMemoryCommand) {
      const request = await explicitMemoryRequestService.enqueue(result.groupId, message, explicitMemoryCommand);
      if (request.status === 'PENDING') {
        explicitMemoryRequests += 1;
        groupsWithAiWork.add(result.groupId);
      } else blockedMemoryRequests += 1;
    }

    if (result.threshold.extractionDue) extractionCandidates += 1;
    const claim = await extractionCoordinator.claimDueBatch(result.groupId, message.lineTimestamp);
    if (!claim) continue;

    extractionClaims += 1;
    const participants = await backgroundEnergyRepository.listBatchParticipants(
      result.groupId,
      claim.id,
      message.lineTimestamp,
    );
    const preflight = backgroundPreflight(participants);
    if (preflight.status === 'SKIP_NO_ELIGIBLE_PARTICIPANT') {
      const closed = await extractionCoordinator.markNoEligibleParticipant(claim.id, message.lineTimestamp);
      if (!closed) throw new Error('Failed to terminally close no-eligible extraction batch');
      extractionNoEligibleSkips += 1;
      continue;
    }

    const eligibleByLineId = new Map(
      participants
        .filter((participant) => participant.availableEnergyUnits > 0n && participant.normalizedCharCount > 0)
        .map((participant) => [participant.lineUserId, participant]),
    );
    const eligibleSubjects = preflight.participants.map((participant) => {
      const snapshot = eligibleByLineId.get(participant.lineUserId);
      if (!snapshot) throw new Error('eligible background participant snapshot disappeared');
      return {
        userId: snapshot.userId,
        lineUserId: snapshot.lineUserId,
        normalizedCharCount: snapshot.normalizedCharCount,
        preflightAvailableUnits: snapshot.availableEnergyUnits,
      };
    });

    const automaticRequest = await automaticMemoryRequestService.ensureForExtractionBatch(
      result.groupId,
      claim.id,
      eligibleSubjects,
      message.lineTimestamp,
    );
    if (automaticRequest.created) automaticMemoryRequests += 1;
    groupsWithAiWork.add(result.groupId);
  }

  if (aiRuntime) {
    for (const groupId of groupsWithAiWork) {
      c.executionCtx.waitUntil((async () => {
        for (let i = 0; i < 5; i += 1) {
          const aiResult = await aiRuntime.runNextForGroup(groupId);
          console.log(JSON.stringify({ event: 'memory_ai_runtime', groupId, ...aiResult }));
          if (
            aiResult.status === 'NO_WORK' ||
            aiResult.status === 'WAITING_FOR_CREDIT' ||
            aiResult.status === 'WAITING_FOR_FREE_BUDGET'
          ) break;
        }
      })().catch((error) => {
        console.error(JSON.stringify({
          event: 'memory_ai_runtime_crash',
          groupId,
          message: error instanceof Error ? error.message : 'unknown error',
        }));
      }));
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
    explicitAiReplies,
    energyBlockedAiRequests,
    explicitMemoryRequests,
    blockedMemoryRequests,
    automaticMemoryRequests,
    extractionCandidates,
    extractionClaims,
    extractionNoEligibleSkips,
    aiRuntime: aiRuntime ? 'SCHEDULED' : `DISABLED: ${aiDisabledReason}`,
  });
});

export default app;
