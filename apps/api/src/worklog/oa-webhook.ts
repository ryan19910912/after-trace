import type { ParsedOaWebhook } from '../line/events';
import {
  anomalyErrorCode,
  anomalyErrorSummary,
  recordAnomalySafely,
  type WorklogAnomalyPort,
} from './anomalies';
import { parseWorklogOaCommand } from './command';
import type { WorklogHistoryFilters } from './history-navigation';
import { formatHistoryReply, type WorklogHistoryQueryResult } from './history-query';
import type { WorklogOaRuntime, WorklogOaRuntimeResult } from './oa-runtime';
import type { WorklogBotReplyTargetPort, WorklogSentReply } from './group-webhook';

export interface WorklogOaReplyPort {
  reply(replyToken: string, text: string): Promise<void | WorklogSentReply>;
}
export type WorklogOaWebhookCounters = {
  oaLifecycleEvents: number;
  oaWorklogCommands: number;
  oaWorklogRecords: number;
  oaWorklogDuplicateRecords: number;
  oaWorklogRejected: number;
  oaWorklogQueries: number;
  oaHumanSupportMessages: number;
  oaErrors: number;
};
export interface WorklogPrivateQueryTarget {
  lineUserId: string;
  sourceId: number;
  userId: number;
  at: Date;
  filters: WorklogHistoryFilters;
}

function emptyCounters(): WorklogOaWebhookCounters {
  return { oaLifecycleEvents: 0, oaWorklogCommands: 0, oaWorklogRecords: 0, oaWorklogDuplicateRecords: 0, oaWorklogRejected: 0, oaWorklogQueries: 0, oaHumanSupportMessages: 0, oaErrors: 0 };
}
function logMessageFailure(message: { lineUserId: string; lineMessageId: string | null; webhookEventId: string | null }, event: string, error: unknown, extra?: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, lineUserId: message.lineUserId, ...(message.lineMessageId ? { lineMessageId: message.lineMessageId } : {}), webhookEventId: message.webhookEventId, ...extra, message: error instanceof Error ? error.message : 'unknown error' }));
}
async function replySafely(input: { reply: WorklogOaReplyPort; anomalies?: WorklogAnomalyPort; replyToken: string; text: string; lineUserId: string; lineMessageId: string | null; webhookEventId: string | null; counters: WorklogOaWebhookCounters }): Promise<WorklogSentReply | null> {
  try {
    const result = await input.reply.reply(input.replyToken, input.text);
    return result && Array.isArray(result.sentMessageIds) ? result : null;
  } catch (error) {
    input.counters.oaErrors += 1;
    logMessageFailure(input, 'worklog_oa_reply_failed', error);
    await recordAnomalySafely(input.anomalies, {
      category: 'LINE_OA_REPLY',
      errorCode: anomalyErrorCode(error, 'LINE_REPLY_FAILED'),
      summary: anomalyErrorSummary(error, 'LINE OA reply failed'),
      lineMessageId: input.lineMessageId,
      requestRef: input.webhookEventId,
      metadata: { lineUserId: input.lineUserId },
    });
    return null;
  }
}
async function rememberReplyTargetSafely(input: { target?: WorklogBotReplyTargetPort; recordId: number; sent: WorklogSentReply | null; lineUserId: string; lineMessageId: string; webhookEventId: string | null; anomalies?: WorklogAnomalyPort; counters: WorklogOaWebhookCounters }): Promise<void> {
  const botLineMessageId = input.sent?.sentMessageIds[0]?.trim();
  if (!input.target || !botLineMessageId) return;
  try { await input.target.rememberBotReplyTarget(input.recordId, botLineMessageId); }
  catch (error) {
    input.counters.oaErrors += 1;
    logMessageFailure(input, 'worklog_oa_reply_target_persist_failed', error, { recordId: input.recordId, botLineMessageId });
    await recordAnomalySafely(input.anomalies, {
      category: 'LINE_OA_REPLY_TARGET',
      errorCode: anomalyErrorCode(error, 'LINE_REPLY_TARGET_PERSIST_FAILED'),
      summary: anomalyErrorSummary(error, 'LINE OA bot Reply target persistence failed'),
      lineMessageId: input.lineMessageId,
      requestRef: input.webhookEventId,
      metadata: { recordId: input.recordId, botLineMessageId, lineUserId: input.lineUserId },
    });
  }
}

export async function processWorklogOaWebhook(input: {
  parsed: ParsedOaWebhook;
  runtime: Pick<WorklogOaRuntime, 'handleLifecycle' | 'handleMessage'>;
  reply: WorklogOaReplyPort;
  replyTargets?: WorklogBotReplyTargetPort;
  anomalies?: WorklogAnomalyPort;
  queryHistory?: (target: WorklogPrivateQueryTarget) => Promise<WorklogHistoryQueryResult>;
  createQueryUrl?: (target: WorklogPrivateQueryTarget) => Promise<string | null>;
}): Promise<WorklogOaWebhookCounters> {
  const counters = emptyCounters();

  for (const parsedEvent of input.parsed.events) {
    if (parsedEvent.kind === 'OA_LIFECYCLE') {
      try {
        await input.runtime.handleLifecycle(parsedEvent.event);
        counters.oaLifecycleEvents += 1;
      } catch (error) {
        counters.oaErrors += 1;
        console.error(JSON.stringify({ event: 'worklog_oa_lifecycle_failed', lifecycleType: parsedEvent.event.type, lineUserId: parsedEvent.event.lineUserId, webhookEventId: parsedEvent.event.webhookEventId, message: error instanceof Error ? error.message : 'unknown error' }));
        await recordAnomalySafely(input.anomalies, {
          category: 'LINE_OA_LIFECYCLE', errorCode: anomalyErrorCode(error, 'OA_LIFECYCLE_FAILED'), summary: anomalyErrorSummary(error, 'LINE OA lifecycle failed'), requestRef: parsedEvent.event.webhookEventId,
          metadata: { lineUserId: parsedEvent.event.lineUserId, lifecycleType: parsedEvent.event.type },
        });
      }
      continue;
    }

    // Rich Menu Postback record/query modes were intentionally retired before launch.
    // Unknown/legacy OA postbacks are ignored fail-closed.
    if (parsedEvent.kind === 'OA_POSTBACK') continue;

    const message = parsedEvent.message;
    const explicitCommand = parseWorklogOaCommand(message) !== null;
    let result: WorklogOaRuntimeResult;
    try {
      result = await input.runtime.handleMessage(message);
    } catch (error) {
      counters.oaErrors += 1;
      logMessageFailure(message, 'worklog_oa_message_failed', error, { explicitCommand });
      await recordAnomalySafely(input.anomalies, {
        category: 'LINE_OA_WEBHOOK', errorCode: anomalyErrorCode(error, 'OA_MESSAGE_FAILED'), summary: anomalyErrorSummary(error, 'LINE OA message failed'), lineMessageId: message.lineMessageId, requestRef: message.webhookEventId,
        metadata: { lineUserId: message.lineUserId, explicitCommand },
      });
      if (explicitCommand) {
        counters.oaWorklogCommands += 1;
        counters.oaWorklogRejected += 1;
        if (message.replyToken) {
          await replySafely({ reply: input.reply, anomalies: input.anomalies, replyToken: message.replyToken, text: '小跡這次沒有成功處理，請稍後再試。', lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, counters });
        }
      } else counters.oaHumanSupportMessages += 1;
      continue;
    }

    if (result.status === 'NOT_HANDLED') {
      counters.oaHumanSupportMessages += 1;
      continue;
    }

    counters.oaWorklogCommands += 1;
    if (result.status === 'RECORDED') {
      counters.oaWorklogRecords += 1;
      if (result.duplicate) counters.oaWorklogDuplicateRecords += 1;
    } else if (result.status === 'QUERY') counters.oaWorklogQueries += 1;
    else if (result.status === 'REJECTED' || result.status === 'QUOTED_NOT_READY') counters.oaWorklogRejected += 1;

    if (!message.replyToken) continue;
    if (result.status === 'QUERY') {
      const target: WorklogPrivateQueryTarget = { lineUserId: message.lineUserId, sourceId: result.sourceId, userId: result.userId, at: message.lineTimestamp, filters: result.filters };
      let history: WorklogHistoryQueryResult | null = null;
      if (input.queryHistory) {
        try { history = await input.queryHistory(target); target.filters = history.filters; }
        catch (error) {
          counters.oaErrors += 1;
          logMessageFailure(message, 'worklog_oa_query_read_failed', error);
          await recordAnomalySafely(input.anomalies, { category: 'LINE_OA_QUERY_READ', errorCode: anomalyErrorCode(error, 'OA_QUERY_READ_FAILED'), summary: anomalyErrorSummary(error, 'LINE OA history query failed'), userId: result.userId, sourceId: result.sourceId, lineMessageId: message.lineMessageId, requestRef: message.webhookEventId, metadata: { lineUserId: message.lineUserId, filters: result.filters } });
        }
      }
      let url: string | null = null;
      if (input.createQueryUrl) {
        try { url = await input.createQueryUrl(target); }
        catch (error) {
          counters.oaErrors += 1;
          logMessageFailure(message, 'worklog_oa_query_entry_failed', error);
          await recordAnomalySafely(input.anomalies, { category: 'LINE_OA_QUERY_ENTRY', errorCode: anomalyErrorCode(error, 'OA_QUERY_ENTRY_FAILED'), summary: anomalyErrorSummary(error, 'LINE OA query entry failed'), userId: result.userId, sourceId: result.sourceId, lineMessageId: message.lineMessageId, requestRef: message.webhookEventId, metadata: { lineUserId: message.lineUserId, filters: target.filters } });
        }
      }
      await replySafely({ reply: input.reply, anomalies: input.anomalies, replyToken: message.replyToken, text: history ? formatHistoryReply(history, url) : url ? `AFTERTRACE｜查看個人紀錄\n${url}` : 'AFTERTRACE 個人紀錄查詢目前暫時無法完成，既有紀錄不受影響。', lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, counters });
      continue;
    }

    const sent = await replySafely({ reply: input.reply, anomalies: input.anomalies, replyToken: message.replyToken, text: result.replyText, lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, counters });
    if (result.status === 'RECORDED' || result.status === 'EDITED') {
      await rememberReplyTargetSafely({ target: input.replyTargets, recordId: result.recordId, sent, lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, anomalies: input.anomalies, counters });
    }
  }
  return counters;
}
