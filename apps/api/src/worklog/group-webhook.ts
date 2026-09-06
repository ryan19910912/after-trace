import type { GroupLifecycleEvent, ParsedLineWebhook } from '../line/events';
import {
  anomalyErrorCode,
  anomalyErrorDetail,
  anomalyErrorSummary,
  recordAnomalySafely,
  type WorklogAnomalyPort,
} from './anomalies';
import { parseWorklogCommand } from './command';
import type { WorklogHistoryFilters } from './history-navigation';
import { formatHistoryReply, type WorklogHistoryQueryResult } from './history-query';
import type { WorklogLineRuntime, WorklogLineRuntimeResult } from './line-runtime';

export interface WorklogGroupLifecyclePort {
  handleGroupLeave(input: { lineGroupId: string; at?: Date }): Promise<void>;
  setGroupMemberPresence(input: { lineGroupId: string; lineUserId: string; isActive: boolean; at?: Date }): Promise<void>;
}
export type WorklogSentReply = { sentMessageIds: string[] };
export interface WorklogGroupReplyPort {
  reply(replyToken: string, text: string): Promise<void | WorklogSentReply>;
  replyUserMention?(replyToken: string, text: string, lineUserId: string): Promise<void | WorklogSentReply>;
}
export interface WorklogBotReplyTargetPort { rememberBotReplyTarget(recordId: number, botLineMessageId: string): Promise<void>; }
export type WorklogGroupWebhookCounters = {
  lifecycleEvents: number;
  worklogCommands: number;
  worklogRecords: number;
  worklogDuplicateRecords: number;
  worklogRejected: number;
  worklogQueries: number;
  worklogAiResponsibilityClaims: number;
  worklogOrdinaryMessages: number;
  worklogErrors: number;
};
export type WorklogGroupQueryTarget = { lineUserId: string; lineGroupId: string; sourceId: number; userId: number; at: Date; filters: WorklogHistoryFilters };

function emptyCounters(): WorklogGroupWebhookCounters {
  return { lifecycleEvents: 0, worklogCommands: 0, worklogRecords: 0, worklogDuplicateRecords: 0, worklogRejected: 0, worklogQueries: 0, worklogAiResponsibilityClaims: 0, worklogOrdinaryMessages: 0, worklogErrors: 0 };
}
function logFailure(input: { event: string; lineGroupId: string; lineMessageId?: string | null; webhookEventId?: string | null; error: unknown; extra?: Record<string, unknown> }): void {
  console.error(JSON.stringify({ event: input.event, lineGroupId: input.lineGroupId, ...(input.lineMessageId ? { lineMessageId: input.lineMessageId } : {}), ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}), ...input.extra, error: anomalyErrorDetail(input.error) }));
}
async function replySafely(input: { reply: WorklogGroupReplyPort; anomalies?: WorklogAnomalyPort; replyToken: string; text: string; lineGroupId: string; lineUserId?: string | null; lineMessageId: string; webhookEventId: string | null; counters: WorklogGroupWebhookCounters }): Promise<WorklogSentReply | null> {
  try {
    const result = await input.reply.reply(input.replyToken, input.text);
    return result && Array.isArray(result.sentMessageIds) ? result : null;
  } catch (error) {
    input.counters.worklogErrors += 1;
    logFailure({ event: 'worklog_group_reply_failed', lineGroupId: input.lineGroupId, lineMessageId: input.lineMessageId, webhookEventId: input.webhookEventId, error });
    await recordAnomalySafely(input.anomalies, { category: 'LINE_GROUP_REPLY', errorCode: anomalyErrorCode(error, 'LINE_REPLY_FAILED'), summary: anomalyErrorSummary(error, 'LINE group reply failed'), lineMessageId: input.lineMessageId, requestRef: input.webhookEventId, metadata: { lineGroupId: input.lineGroupId, ...(input.lineUserId ? { lineUserId: input.lineUserId } : {}), error: anomalyErrorDetail(error) } });
    return null;
  }
}
async function replyResponsibilityMentionSafely(input: {
  reply: WorklogGroupReplyPort;
  anomalies?: WorklogAnomalyPort;
  replyToken: string;
  fallbackText: string;
  mentionText: string;
  responsibleLineUserId: string;
  lineGroupId: string;
  lineMessageId: string;
  webhookEventId: string | null;
  counters: WorklogGroupWebhookCounters;
}): Promise<WorklogSentReply | null> {
  if (!input.reply.replyUserMention) {
    return replySafely({
      reply: input.reply,
      anomalies: input.anomalies,
      replyToken: input.replyToken,
      text: input.fallbackText,
      lineGroupId: input.lineGroupId,
      lineUserId: input.responsibleLineUserId,
      lineMessageId: input.lineMessageId,
      webhookEventId: input.webhookEventId,
      counters: input.counters,
    });
  }

  try {
    const result = await input.reply.replyUserMention(
      input.replyToken,
      input.mentionText,
      input.responsibleLineUserId,
    );
    return result && Array.isArray(result.sentMessageIds) ? result : null;
  } catch (error) {
    input.counters.worklogErrors += 1;
    logFailure({
      event: 'worklog_group_responsibility_mention_failed',
      lineGroupId: input.lineGroupId,
      lineMessageId: input.lineMessageId,
      webhookEventId: input.webhookEventId,
      error,
    });
    await recordAnomalySafely(input.anomalies, {
      category: 'LINE_GROUP_RESPONSIBILITY_MENTION',
      errorCode: anomalyErrorCode(error, 'GROUP_RESPONSIBILITY_MENTION_FAILED'),
      summary: anomalyErrorSummary(error, 'LINE group responsibility mention failed'),
      lineMessageId: input.lineMessageId,
      requestRef: input.webhookEventId,
      metadata: {
        lineGroupId: input.lineGroupId,
        responsibleLineUserId: input.responsibleLineUserId,
        error: anomalyErrorDetail(error),
      },
    });
    return replySafely({
      reply: input.reply,
      anomalies: input.anomalies,
      replyToken: input.replyToken,
      text: input.fallbackText,
      lineGroupId: input.lineGroupId,
      lineUserId: input.responsibleLineUserId,
      lineMessageId: input.lineMessageId,
      webhookEventId: input.webhookEventId,
      counters: input.counters,
    });
  }
}
async function rememberReplyTargetSafely(input: { target?: WorklogBotReplyTargetPort; recordId: number; sent: WorklogSentReply | null; lineGroupId: string; lineUserId?: string | null; lineMessageId: string; webhookEventId: string | null; anomalies?: WorklogAnomalyPort; counters: WorklogGroupWebhookCounters }): Promise<void> {
  const botLineMessageId = input.sent?.sentMessageIds[0]?.trim();
  if (!input.target || !botLineMessageId) return;
  try { await input.target.rememberBotReplyTarget(input.recordId, botLineMessageId); }
  catch (error) {
    input.counters.worklogErrors += 1;
    logFailure({ event: 'worklog_group_reply_target_persist_failed', lineGroupId: input.lineGroupId, lineMessageId: input.lineMessageId, webhookEventId: input.webhookEventId, error, extra: { recordId: input.recordId, botLineMessageId } });
    await recordAnomalySafely(input.anomalies, { category: 'LINE_GROUP_REPLY_TARGET', errorCode: anomalyErrorCode(error, 'LINE_REPLY_TARGET_PERSIST_FAILED'), summary: anomalyErrorSummary(error, 'LINE group bot Reply target persistence failed'), sourceId: null, lineMessageId: input.lineMessageId, requestRef: input.webhookEventId, metadata: { recordId: input.recordId, botLineMessageId, lineGroupId: input.lineGroupId, ...(input.lineUserId ? { lineUserId: input.lineUserId } : {}), error: anomalyErrorDetail(error) } });
  }
}
async function handleLifecycle(event: GroupLifecycleEvent, bootstrap: WorklogGroupLifecyclePort): Promise<void> {
  if (event.type === 'JOIN') return;
  if (event.type === 'LEAVE') {
    await bootstrap.handleGroupLeave({ lineGroupId: event.lineGroupId, at: event.lineTimestamp });
    return;
  }
  if (event.type !== 'MEMBER_JOINED' && event.type !== 'MEMBER_LEFT') return;
  const isActive = event.type === 'MEMBER_JOINED';
  for (const lineUserId of event.lineUserIds) {
    await bootstrap.setGroupMemberPresence({ lineGroupId: event.lineGroupId, lineUserId, isActive, at: event.lineTimestamp });
  }
}

export async function processWorklogGroupWebhook(input: {
  parsed: ParsedLineWebhook;
  bootstrap: WorklogGroupLifecyclePort;
  runtime: Pick<WorklogLineRuntime, 'handle'>;
  reply: WorklogGroupReplyPort;
  replyTargets?: WorklogBotReplyTargetPort;
  anomalies?: WorklogAnomalyPort;
  queryHistory?: (target: WorklogGroupQueryTarget) => Promise<WorklogHistoryQueryResult>;
  createQueryUrl?: (target: WorklogGroupQueryTarget) => Promise<string | null>;
  refreshGroupProfile?: (lineGroupId: string, at: Date) => Promise<unknown>;
}): Promise<WorklogGroupWebhookCounters> {
  const counters = emptyCounters();

  for (const parsedEvent of input.parsed.events) {
    if (parsedEvent.kind === 'LIFECYCLE') {
      try { await handleLifecycle(parsedEvent.event, input.bootstrap); counters.lifecycleEvents += 1; }
      catch (error) {
        counters.worklogErrors += 1;
        logFailure({ event: 'worklog_group_lifecycle_failed', lineGroupId: parsedEvent.event.lineGroupId, webhookEventId: parsedEvent.event.webhookEventId, error, extra: { lifecycleType: parsedEvent.event.type } });
        await recordAnomalySafely(input.anomalies, { category: 'LINE_GROUP_LIFECYCLE', errorCode: anomalyErrorCode(error, 'GROUP_LIFECYCLE_FAILED'), summary: anomalyErrorSummary(error, 'LINE group lifecycle failed'), requestRef: parsedEvent.event.webhookEventId, metadata: { lineGroupId: parsedEvent.event.lineGroupId, lifecycleType: parsedEvent.event.type, error: anomalyErrorDetail(error) } });
      }
      continue;
    }

    const message = parsedEvent.message;
    const explicitCommand = parseWorklogCommand(message) !== null;
    let result: WorklogLineRuntimeResult;
    try { result = await input.runtime.handle(message); }
    catch (error) {
      counters.worklogErrors += 1;
      logFailure({ event: 'worklog_group_message_failed', lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, error, extra: { explicitCommand } });
      await recordAnomalySafely(input.anomalies, { category: 'LINE_GROUP_WEBHOOK', errorCode: anomalyErrorCode(error, 'GROUP_MESSAGE_FAILED'), summary: anomalyErrorSummary(error, 'LINE group message failed'), lineMessageId: message.lineMessageId, requestRef: message.webhookEventId, metadata: { lineGroupId: message.lineGroupId, ...(message.lineUserId ? { lineUserId: message.lineUserId } : {}), explicitCommand, error: anomalyErrorDetail(error) } });
      if (!explicitCommand) { counters.worklogOrdinaryMessages += 1; continue; }
      counters.worklogCommands += 1;
      counters.worklogRejected += 1;
      if (message.replyToken) await replySafely({ reply: input.reply, anomalies: input.anomalies, replyToken: message.replyToken, text: '小跡這次沒有成功處理，請稍後再試。', lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, counters });
      continue;
    }

    if (result.status === 'NOT_HANDLED') { counters.worklogOrdinaryMessages += 1; continue; }

    if (explicitCommand && input.refreshGroupProfile) {
      try {
        await input.refreshGroupProfile(message.lineGroupId, message.lineTimestamp);
      } catch (error) {
        counters.worklogErrors += 1;
        logFailure({ event: 'worklog_group_profile_refresh_failed', lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, error });
        await recordAnomalySafely(input.anomalies, {
          category: 'LINE_GROUP_PROFILE_REFRESH',
          errorCode: anomalyErrorCode(error, 'GROUP_PROFILE_REFRESH_FAILED'),
          summary: anomalyErrorSummary(error, 'LINE group profile refresh failed'),
          lineMessageId: message.lineMessageId,
          requestRef: message.webhookEventId,
          metadata: { lineGroupId: message.lineGroupId, error: anomalyErrorDetail(error) },
        });
      }
    }

    counters.worklogCommands += 1;
    if (result.status === 'RECORDED') {
      counters.worklogRecords += 1;
      if (result.duplicate) counters.worklogDuplicateRecords += 1;
    } else if (result.status === 'QUERY') counters.worklogQueries += 1;
    else if (result.status === 'AI_RESPONSIBILITY_BOUND') counters.worklogAiResponsibilityClaims += 1;
    else if (result.status === 'REJECTED' || result.status === 'QUOTED_NOT_READY') counters.worklogRejected += 1;

    if (!message.replyToken) continue;
    if (result.status === 'QUERY') {
      const target: WorklogGroupQueryTarget = { lineUserId: message.lineUserId ?? '', lineGroupId: message.lineGroupId, sourceId: result.sourceId, userId: result.userId, at: message.lineTimestamp, filters: result.filters };
      let history: WorklogHistoryQueryResult | null = null;
      if (message.lineUserId && input.queryHistory) {
        try { history = await input.queryHistory(target); target.filters = history.filters; }
        catch (error) {
          counters.worklogErrors += 1;
          logFailure({ event: 'worklog_group_query_read_failed', lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, error });
          await recordAnomalySafely(input.anomalies, { category: 'LINE_GROUP_QUERY_READ', errorCode: anomalyErrorCode(error, 'GROUP_QUERY_READ_FAILED'), summary: anomalyErrorSummary(error, 'LINE group history query failed'), userId: result.userId, sourceId: result.sourceId, lineMessageId: message.lineMessageId, requestRef: message.webhookEventId, metadata: { lineGroupId: message.lineGroupId, filters: result.filters, error: anomalyErrorDetail(error) } });
        }
      }
      let url: string | null = null;
      if (message.lineUserId && input.createQueryUrl) {
        try { url = await input.createQueryUrl(target); }
        catch (error) {
          counters.worklogErrors += 1;
          logFailure({ event: 'worklog_group_query_entry_failed', lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, error });
          await recordAnomalySafely(input.anomalies, { category: 'LINE_GROUP_QUERY_ENTRY', errorCode: anomalyErrorCode(error, 'GROUP_QUERY_ENTRY_FAILED'), summary: anomalyErrorSummary(error, 'LINE group query entry failed'), userId: result.userId, sourceId: result.sourceId, lineMessageId: message.lineMessageId, requestRef: message.webhookEventId, metadata: { lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, filters: target.filters, error: anomalyErrorDetail(error) } });
        }
      }
      await replySafely({ reply: input.reply, anomalies: input.anomalies, replyToken: message.replyToken, text: history ? formatHistoryReply(history, url) : url ? `AFTERTRACE｜查看紀錄\n${url}` : 'AFTERTRACE 紀錄查詢目前暫時無法完成，既有紀錄不受影響。', lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, counters });
      continue;
    }

    if (result.status === 'AI_RESPONSIBILITY_BOUND' && message.lineUserId) {
      await replyResponsibilityMentionSafely({
        reply: input.reply,
        anomalies: input.anomalies,
        replyToken: message.replyToken,
        fallbackText: `${result.replyText}\n\nAI 額度負責人：你`,
        mentionText: `${result.replyText}\n\nAI 額度負責人：{responsible}`,
        responsibleLineUserId: message.lineUserId,
        lineGroupId: message.lineGroupId,
        lineMessageId: message.lineMessageId,
        webhookEventId: message.webhookEventId,
        counters,
      });
      continue;
    }

    const sent = await replySafely({ reply: input.reply, anomalies: input.anomalies, replyToken: message.replyToken, text: result.replyText, lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, counters });
    if (result.status === 'RECORDED' || result.status === 'EDITED') {
      await rememberReplyTargetSafely({ target: input.replyTargets, recordId: result.recordId, sent, lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, lineMessageId: message.lineMessageId, webhookEventId: message.webhookEventId, anomalies: input.anomalies, counters });
    }
  }
  return counters;
}