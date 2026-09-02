import { Hono } from 'hono';
import { ExplicitAiChatService, explicitAiChatDisabledReason } from './ai/chat';
import { createAiIntentRouter } from './ai/intent-router';
import { DrizzleWebAuthRepository } from './auth/repository';
import { createWebAuthRoutes } from './auth/routes';
import { WebAuthService } from './auth/service';
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
import { aiMentionText, detectDeterministicAiCommand, isAiMention } from './line/commands';
import { parseLineWebhook, parseOaWebhook } from './line/events';
import { LineMessagingReplyClient } from './line/reply';
import { verifyLineSignature } from './line/signature';
import { createManagementRoutes } from './management/routes';
import { DrizzleMemoryRequestRepository } from './memory/drizzle-request-repository';
import { ExplicitMemoryRequestService } from './memory/requests';
import { memoryAiRuntimeDisabledReason, UserEnergyMemoryAiRuntime } from './memory/runtime';
import { AutomaticMemoryRequestService } from './memory/work';
import { WorklogBootstrapService } from './worklog/bootstrap';
import { WorklogCollaborationService } from './worklog/collaboration';
import { DrizzleWorklogBootstrapRepository } from './worklog/drizzle-bootstrap';
import { DrizzleWorklogCollaborationRepository } from './worklog/drizzle-collaboration';
import { DrizzleWorklogRecordWriteRepository } from './worklog/drizzle-records';
import { DrizzleWorklogSubscriptionRepository } from './worklog/drizzle-subscription';
import { DrizzleWorklogTextNormalizationRepository } from './worklog/drizzle-text-normalization';
import { GeminiWorklogTextNormalizer } from './worklog/gemini-text-normalizer';
import { WorklogLineRuntime } from './worklog/line-runtime';
import { WorklogOaRuntime } from './worklog/oa-runtime';
import { processWorklogOaWebhook } from './worklog/oa-webhook';
import { WorklogRecordWriteService } from './worklog/records';
import { WorklogSubscriptionService } from './worklog/subscription';
import { WorklogTextNormalizationService } from './worklog/text-normalization';

export type Bindings = ProductConfigEnv & {
  DATABASE_URL: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  WEB_APP_URL?: string;
  WEB_AUTH_SECRET?: string;
  WEB_APP_ORIGIN?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  GEMINI_INPUT_USD_PER_MILLION_TOKENS?: string;
  GEMINI_OUTPUT_USD_PER_MILLION_TOKENS?: string;
  GEMINI_MEMORY_MAX_OUTPUT_TOKENS?: string;
  USD_TWD_RATE?: string;
  GLOBAL_FREE_AI_BUDGET_COST_TWD?: string;
  BACKGROUND_AI_MAX_SUBSIDY_COST_TWD?: string;
  ENERGY_UNITS_PER_TWD?: string;
  REMINDER_RESERVATION_ENERGY?: string;
  GOOGLE_AD_MANAGER_NETWORK_CODE?: string;
  GOOGLE_AD_MANAGER_REWARDED_AD_UNIT_PATH?: string;
  COMMERCE_WEBHOOK_SECRET?: string;
  COMMERCE_PROVIDER?: string;
  PROACTIVE_INTERNAL_SECRET?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.route('/api/v1/auth', createWebAuthRoutes());
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
  const parsedOa = parseOaWebhook(payload);
  if (parsed.events.length === 0 && parsedOa.events.length === 0) {
    return c.json({
      ok: true,
      lifecycleEvents: 0,
      worklogCommands: 0,
      worklogRecords: 0,
      worklogDuplicateRecords: 0,
      worklogRejected: 0,
      worklogQueries: 0,
      worklogOwnerClaims: 0,
      oaLifecycleEvents: 0,
      oaWorklogCommands: 0,
      oaWorklogRecords: 0,
      oaWorklogDuplicateRecords: 0,
      oaWorklogRejected: 0,
      oaWorklogQueries: 0,
      oaHumanSupportMessages: 0,
      oaErrors: 0,
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
  const conversationService = new ConversationIngestionService(new DrizzleConversationRepository(database), config);
  const extractionCoordinator = new ConversationExtractionCoordinator(new DrizzleExtractionClaimRepository(database), config);
  const energyRepository = new DrizzleUserEnergyRepository(database);
  const backgroundEnergyRepository = new DrizzleBackgroundEnergyRepository(database);
  const webAppUrl = c.env.WEB_APP_URL?.trim();
  const managementAppConfigured = Boolean(webAppUrl);
  const energyAccessRepository = managementAppConfigured
    ? new DrizzleUserEnergyAccessRepository(database, c.env.LINE_CHANNEL_ACCESS_TOKEN)
    : null;
  const webAuthService = webAppUrl && c.env.WEB_AUTH_SECRET?.trim()
    ? new WebAuthService(
        new DrizzleWebAuthRepository(database),
        c.env.LINE_CHANNEL_ACCESS_TOKEN,
        c.env.WEB_AUTH_SECRET,
      )
    : null;
  const lineReplyClient = new LineMessagingReplyClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
  const worklogBootstrapService = new WorklogBootstrapService(new DrizzleWorklogBootstrapRepository(database));
  const worklogCollaborationService = new WorklogCollaborationService(
    new DrizzleWorklogCollaborationRepository(database),
  );
  const worklogRecordWriteService = new WorklogRecordWriteService(
    new DrizzleWorklogRecordWriteRepository(database),
  );
  const worklogTextNormalizationService = new WorklogTextNormalizationService(
    new DrizzleWorklogTextNormalizationRepository(database),
    new WorklogSubscriptionService(new DrizzleWorklogSubscriptionRepository(database)),
    new GeminiWorklogTextNormalizer({ apiKey: c.env.GEMINI_API_KEY }),
  );
  const worklogLineRuntime = new WorklogLineRuntime(
    worklogBootstrapService,
    worklogCollaborationService,
    worklogRecordWriteService,
    worklogTextNormalizationService,
  );
  const worklogOaRuntime = new WorklogOaRuntime(
    worklogBootstrapService,
    worklogRecordWriteService,
    worklogTextNormalizationService,
  );
  const memoryRequestRepository = new DrizzleMemoryRequestRepository(database);
  const explicitMemoryRequestService = new ExplicitMemoryRequestService(memoryRequestRepository);
  const automaticMemoryRequestService = new AutomaticMemoryRequestService(memoryRequestRepository);
  const aiIntentRouter = createAiIntentRouter(c.env);
  const aiDisabledReason = memoryAiRuntimeDisabledReason(c.env);
  const aiRuntime = aiDisabledReason ? null : new UserEnergyMemoryAiRuntime(database, c.env);
  const chatDisabledReason = explicitAiChatDisabledReason(c.env);
  const chatService = chatDisabledReason ? null : new ExplicitAiChatService(database, c.env);
  const groupsWithAiWork = new Set<number>();
  const explicitRequestTargets = new Map<number, string>();

  const oaCounters = await processWorklogOaWebhook({
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
  });

  let lifecycleEvents = 0;
  let worklogCommands = 0;
  let worklogRecords = 0;
  let worklogDuplicateRecords = 0;
  let worklogRejected = 0;
  let worklogQueries = 0;
  let worklogOwnerClaims = 0;
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
      const event = parsedEvent.event;
      if (event.type === 'LEAVE') {
        await worklogBootstrapService.handleGroupLeave({
          lineGroupId: event.lineGroupId,
          at: event.lineTimestamp,
        });
      } else if (event.type === 'MEMBER_JOINED' || event.type === 'MEMBER_LEFT') {
        const isActive = event.type === 'MEMBER_JOINED';
        for (const lineUserId of event.lineUserIds) {
          await worklogBootstrapService.setGroupMemberPresence({
            lineGroupId: event.lineGroupId,
            lineUserId,
            isActive,
            at: event.lineTimestamp,
          });
        }
      }
      await conversationService.handleLifecycle(event);
      lifecycleEvents += 1;
      continue;
    }

    const message = parsedEvent.message;
    let worklogResult: Awaited<ReturnType<WorklogLineRuntime['handle']>>;
    try {
      worklogResult = await worklogLineRuntime.handle(message);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'worklog_line_runtime_failed',
        lineGroupId: message.lineGroupId,
        lineMessageId: message.lineMessageId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
      worklogRejected += 1;
      if (message.replyToken) {
        await lineReplyClient.reply(message.replyToken, 'AFTERTRACE 這次沒有成功寫入紀錄，請稍後再試。');
      }
      continue;
    }

    if (worklogResult.status !== 'NOT_HANDLED') {
      worklogCommands += 1;
      if (worklogResult.status === 'RECORDED') {
        worklogRecords += 1;
        if (worklogResult.duplicate) worklogDuplicateRecords += 1;
      } else if (worklogResult.status === 'QUERY') {
        worklogQueries += 1;
      } else if (worklogResult.status === 'OWNER_BOUND') {
        worklogOwnerClaims += 1;
      } else {
        worklogRejected += 1;
      }

      if (message.replyToken) {
        if (worklogResult.status === 'QUERY') {
          const url = message.lineUserId && webAuthService && webAppUrl
            ? await webAuthService.createBotEntry({
                webAppUrl,
                lineUserId: message.lineUserId,
                lineGroupId: message.lineGroupId,
                at: message.lineTimestamp,
              })
            : null;
          await lineReplyClient.reply(
            message.replyToken,
            url
              ? `AFTERTRACE｜查看紀錄\n${url}`
              : 'AFTERTRACE 紀錄頁目前尚未設定完成，紀錄本身不受影響。',
          );
        } else {
          await lineReplyClient.reply(message.replyToken, worklogResult.replyText);
        }
      }
      continue;
    }

    const result = await conversationService.ingest(message);
    if (result.status === 'IGNORED_INACTIVE') {
      ignoredInactiveMessages += 1;
      continue;
    }
    if (result.status === 'DUPLICATE') duplicateMessages += 1;
    else storedMessages += 1;

    if (message.lineUserId) {
      const free = await energyRepository.ensureLifetimeFreeForLineUser(message.lineUserId, config.energy.freeInitialUnits);
      if (free.status === 'GRANTED') lifetimeFreeGrants += 1;
      if (free.status === 'REFERENCE_CONFLICT') throw new Error('lifetime FREE Energy consistency failure');
    }

    const deterministicCommand = detectDeterministicAiCommand(message);
    const mentioned = isAiMention(message);
    let routedIntent: Awaited<ReturnType<NonNullable<typeof aiIntentRouter>['route']>> | null = null;
    if (!deterministicCommand && mentioned) {
      if (!aiIntentRouter) {
        if (message.replyToken) {
          await lineReplyClient.reply(message.replyToken, 'AFTERTRACE AI 目前尚未啟用，暫時無法理解這個指令。');
        }
        continue;
      }
      try {
        routedIntent = await aiIntentRouter.route(message);
      } catch (error) {
        console.error(JSON.stringify({
          event: 'ai_intent_router_failed',
          lineGroupId: message.lineGroupId,
          lineMessageId: message.lineMessageId,
          message: error instanceof Error ? error.message : 'unknown error',
        }));
        if (message.replyToken) {
          await lineReplyClient.reply(message.replyToken, 'AFTERTRACE 暫時無法理解這個指令，請稍後再試。');
        }
        continue;
      }
    }

    let groupManagementUrl: string | null = null;
    if ((deterministicCommand || mentioned) && message.lineUserId && webAuthService && webAppUrl) {
      groupManagementUrl = await webAuthService.createBotEntry({
        webAppUrl,
        lineUserId: message.lineUserId,
        lineGroupId: message.lineGroupId,
        at: message.lineTimestamp,
      });
    }
    const energyAccessService = groupManagementUrl && energyAccessRepository
      ? new UserEnergyAccessService(energyAccessRepository, groupManagementUrl)
      : null;

    if (deterministicCommand && message.lineUserId && message.replyToken) {
      let reply: string;
      if (deterministicCommand.kind === 'ENERGY_STATUS') {
        reply = energyAccessService
          ? await energyAccessService.energyStatus({
              groupId: result.groupId,
              callerLineUserId: message.lineUserId,
              at: message.lineTimestamp,
            })
          : 'AFTERTRACE｜群組 Energy\n\n詳細 Energy 查詢會在管理中心啟用後開放。';
      } else if (deterministicCommand.kind === 'HELP') {
        reply = [
          'AFTERTRACE｜幫助', '',
          '@AFTERTRACE <問題>：用群組近期對話與記憶回答',
          '@AFTERTRACE 額度：查看群組成員是否還可使用 Energy（不顯示他人數字）',
          '@AFTERTRACE 幫我記住／記錄：用自然語言要求 AFTERTRACE 記住資訊',
          '@AFTERTRACE 方案：查看目前 V1 Energy 取得方式',
        ].join('\n');
      } else {
        reply = [
          'AFTERTRACE｜V1 Energy', '',
          'FREE：每位使用者一生一次',
          'SUBSCRIPTION：每個 billing cycle 發放，到 period_end 過期',
          'AD：Rewarded Ad，取得後 7 天過期',
          'PAID：一次性 Energy Pack，不過期',
          ...(groupManagementUrl
            ? ['', '實際 Energy 數量與價格以 AFTERTRACE 管理中心顯示為準。', groupManagementUrl]
            : ['', '詳細 Energy 與購買頁面會在管理中心啟用後開放。']),
        ].join('\n');
      }
      await lineReplyClient.reply(message.replyToken, reply);
      deterministicReplies += 1;
      continue;
    }

    if (routedIntent?.intent === 'REMEMBER') {
      if (!aiRuntime) {
        console.error(JSON.stringify({
          event: 'explicit_memory_runtime_disabled',
          lineGroupId: message.lineGroupId,
          lineMessageId: message.lineMessageId,
          reason: aiDisabledReason,
        }));
        if (message.replyToken) {
          await lineReplyClient.reply(
            message.replyToken,
            '我知道你要我記住這則內容，但記憶 AI 目前尚未啟用，這次沒有寫入記憶。',
          );
        }
        continue;
      }

      const request = await explicitMemoryRequestService.enqueue(result.groupId, message, {
        quotedLineMessageId: message.quotedLineMessageId,
        instruction: aiMentionText(message),
        preferRecentImage: routedIntent.preferRecentImage,
      });
      if (request.status === 'PENDING') {
        explicitMemoryRequests += 1;
        groupsWithAiWork.add(result.groupId);
        explicitRequestTargets.set(request.id, message.lineGroupId);
        if (message.replyToken) {
          await lineReplyClient.reply(message.replyToken, '收到，我正在幫你整理並記錄。');
        }
      } else {
        blockedMemoryRequests += 1;
        if (message.replyToken) {
          await lineReplyClient.reply(message.replyToken, '我找不到你要我記住的來源內容，請回覆那則訊息後再試一次。');
        }
      }
      continue;
    }

    if (routedIntent?.intent === 'REMINDER') {
      if (message.replyToken) {
        await lineReplyClient.reply(
          message.replyToken,
          groupManagementUrl
            ? `我知道你想建立提醒。目前請先到 AFTERTRACE 管理中心設定時間與內容：\n${groupManagementUrl}`
            : '我知道你想建立提醒。目前提醒需要到 AFTERTRACE 管理中心設定時間與內容。',
        );
      }
      continue;
    }

    if (routedIntent?.intent === 'UNKNOWN') {
      if (message.replyToken) {
        await lineReplyClient.reply(message.replyToken, '我還不確定你要我記住、回答問題，還是建立提醒，可以再說完整一點嗎？');
      }
      continue;
    }

    if (routedIntent?.intent === 'ASK' && message.lineUserId && message.replyToken) {
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
        await lineReplyClient.reply(message.replyToken, `AFTERTRACE AI 目前尚未啟用。${groupManagementUrl ? `\n${groupManagementUrl}` : ''}`);
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
            `你的 Energy 不足以安全完成這次 AI 請求。${groupManagementUrl ? `\n可到 AFTERTRACE 查看或補充 Energy：\n${groupManagementUrl}` : ''}`,
          );
          energyBlockedAiRequests += 1;
        } else {
          await lineReplyClient.reply(message.replyToken, 'AFTERTRACE AI 暫時無法完成這次請求，請稍後再試。');
        }
      }
      continue;
    }

    if (result.threshold.extractionDue) extractionCandidates += 1;
    const claim = await extractionCoordinator.claimDueBatch(result.groupId, message.lineTimestamp);
    if (!claim) continue;

    extractionClaims += 1;
    const participants = await backgroundEnergyRepository.listBatchParticipants(result.groupId, claim.id, message.lineTimestamp);
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

          if ('requestId' in aiResult) {
            const target = explicitRequestTargets.get(aiResult.requestId);
            if (target) {
              if (aiResult.status === 'SUCCEEDED') {
                await lineReplyClient.push(
                  target,
                  aiResult.candidateCount > 0
                    ? '已完成記錄，你可以到 AFTERTRACE 管理中心查看。'
                    : '我看過這則內容了，但沒有找到足夠明確、適合保存的資訊。',
                );
                explicitRequestTargets.delete(aiResult.requestId);
              } else if (aiResult.status === 'FAILED') {
                await lineReplyClient.push(target, '這次記錄沒有成功，請稍後再試一次。');
                explicitRequestTargets.delete(aiResult.requestId);
              } else if (aiResult.status === 'WAITING_FOR_CREDIT') {
                await lineReplyClient.push(target, '這次記錄暫時無法完成，因為你的 Energy 不足。');
                explicitRequestTargets.delete(aiResult.requestId);
              } else if (aiResult.status === 'WAITING_FOR_FREE_BUDGET') {
                await lineReplyClient.push(target, '這次記錄暫時無法完成，請稍後再試一次。');
                explicitRequestTargets.delete(aiResult.requestId);
              }
            }
          }

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
    worklogCommands,
    worklogRecords,
    worklogDuplicateRecords,
    worklogRejected,
    worklogQueries,
    worklogOwnerClaims,
    ...oaCounters,
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