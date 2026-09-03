import type { GroupLifecycleEvent, ParsedLineWebhook } from '../line/events';
import {
  anomalyErrorCode,
  anomalyErrorSummary,
  recordAnomalySafely,
  type WorklogAnomalyPort,
} from './anomalies';
import { parseWorklogCommand } from './command';
import type { WorklogHistoryFilters } from './history-navigation';
import type { WorklogLineRuntime, WorklogLineRuntimeResult } from './line-runtime';

export interface WorklogGroupLifecyclePort {
  handleGroupLeave(input: { lineGroupId: string; at?: Date }): Promise<void>;
  setGroupMemberPresence(input: {
    lineGroupId: string;
    lineUserId: string;
    isActive: boolean;
    at?: Date;
  }): Promise<void>;
}

export interface WorklogGroupReplyPort {
  reply(replyToken: string, text: string): Promise<void>;
}

export type WorklogGroupWebhookCounters = {
  lifecycleEvents: number;
  worklogCommands: number;
  worklogRecords: number;
  worklogDuplicateRecords: number;
  worklogRejected: number;
  worklogQueries: number;
  worklogOwnerClaims: number;
  worklogOrdinaryMessages: number;
  worklogErrors: number;
};

export type WorklogGroupQueryTarget = {
  lineUserId: string;
  lineGroupId: string;
  sourceId: number;
  userId: number;
  at: Date;
  filters: WorklogHistoryFilters;
};

function emptyCounters(): WorklogGroupWebhookCounters {
  return {
    lifecycleEvents: 0,
    worklogCommands: 0,
    worklogRecords: 0,
    worklogDuplicateRecords: 0,
    worklogRejected: 0,
    worklogQueries: 0,
    worklogOwnerClaims: 0,
    worklogOrdinaryMessages: 0,
    worklogErrors: 0,
  };
}

function logFailure(input: {
  event: string;
  lineGroupId: string;
  lineMessageId?: string | null;
  webhookEventId?: string | null;
  error: unknown;
  extra?: Record<string, unknown>;
}): void {
  console.error(JSON.stringify({
    event: input.event,
    lineGroupId: input.lineGroupId,
    ...(input.lineMessageId ? { lineMessageId: input.lineMessageId } : {}),
    ...(input.webhookEventId ? { webhookEventId: input.webhookEventId } : {}),
    ...input.extra,
    message: input.error instanceof Error ? input.error.message : 'unknown error',
  }));
}

async function replySafely(input: {
  reply: WorklogGroupReplyPort;
  anomalies?: WorklogAnomalyPort;
  replyToken: string;
  text: string;
  lineGroupId: string;
  lineUserId?: string | null;
  lineMessageId: string;
  webhookEventId: string | null;
  counters: WorklogGroupWebhookCounters;
}): Promise<void> {
  try {
    await input.reply.reply(input.replyToken, input.text);
  } catch (error) {
    input.counters.worklogErrors += 1;
    logFailure({
      event: 'worklog_group_reply_failed',
      lineGroupId: input.lineGroupId,
      lineMessageId: input.lineMessageId,
      webhookEventId: input.webhookEventId,
      error,
    });
    await recordAnomalySafely(input.anomalies, {
      category: 'LINE_GROUP_REPLY',
      errorCode: anomalyErrorCode(error, 'LINE_REPLY_FAILED'),
      summary: anomalyErrorSummary(error, 'LINE group reply failed'),
      lineMessageId: input.lineMessageId,
      requestRef: input.webhookEventId,
      metadata: {
        lineGroupId: input.lineGroupId,
        ...(input.lineUserId ? { lineUserId: input.lineUserId } : {}),
      },
    });
  }
}

async function handleLifecycle(
  event: GroupLifecycleEvent,
  bootstrap: WorklogGroupLifecyclePort,
): Promise<void> {
  if (event.type === 'JOIN') return;
  if (event.type === 'LEAVE') {
    await bootstrap.handleGroupLeave({ lineGroupId: event.lineGroupId, at: event.lineTimestamp });
    return;
  }
  if (event.type !== 'MEMBER_JOINED' && event.type !== 'MEMBER_LEFT') return;
  const isActive = event.type === 'MEMBER_JOINED';
  for (const lineUserId of event.lineUserIds) {
    await bootstrap.setGroupMemberPresence({
      lineGroupId: event.lineGroupId,
      lineUserId,
      isActive,
      at: event.lineTimestamp,
    });
  }
}

export async function processWorklogGroupWebhook(input: {
  parsed: ParsedLineWebhook;
  bootstrap: WorklogGroupLifecyclePort;
  runtime: Pick<WorklogLineRuntime, 'handle'>;
  reply: WorklogGroupReplyPort;
  anomalies?: WorklogAnomalyPort;
  createQueryUrl?: (target: WorklogGroupQueryTarget) => Promise<string | null>;
}): Promise<WorklogGroupWebhookCounters> {
  const counters = emptyCounters();

  for (const parsedEvent of input.parsed.events) {
    if (parsedEvent.kind === 'LIFECYCLE') {
      try {
        await handleLifecycle(parsedEvent.event, input.bootstrap);
        counters.lifecycleEvents += 1;
      } catch (error) {
        counters.worklogErrors += 1;
        logFailure({
          event: 'worklog_group_lifecycle_failed',
          lineGroupId: parsedEvent.event.lineGroupId,
          webhookEventId: parsedEvent.event.webhookEventId,
          error,
          extra: { lifecycleType: parsedEvent.event.type },
        });
        await recordAnomalySafely(input.anomalies, {
          category: 'LINE_GROUP_LIFECYCLE',
          errorCode: anomalyErrorCode(error, 'GROUP_LIFECYCLE_FAILED'),
          summary: anomalyErrorSummary(error, 'LINE group lifecycle failed'),
          requestRef: parsedEvent.event.webhookEventId,
          metadata: {
            lineGroupId: parsedEvent.event.lineGroupId,
            lifecycleType: parsedEvent.event.type,
          },
        });
      }
      continue;
    }

    const message = parsedEvent.message;
    const explicitCommand = parseWorklogCommand(message) !== null;
    let result: WorklogLineRuntimeResult;
    try {
      result = await input.runtime.handle(message);
    } catch (error) {
      counters.worklogErrors += 1;
      logFailure({
        event: 'worklog_group_message_failed',
        lineGroupId: message.lineGroupId,
        lineMessageId: message.lineMessageId,
        webhookEventId: message.webhookEventId,
        error,
        extra: { explicitCommand },
      });
      await recordAnomalySafely(input.anomalies, {
        category: 'LINE_GROUP_WEBHOOK',
        errorCode: anomalyErrorCode(error, 'GROUP_MESSAGE_FAILED'),
        summary: anomalyErrorSummary(error, 'LINE group message failed'),
        lineMessageId: message.lineMessageId,
        requestRef: message.webhookEventId,
        metadata: {
          lineGroupId: message.lineGroupId,
          ...(message.lineUserId ? { lineUserId: message.lineUserId } : {}),
          explicitCommand,
        },
      });
      if (!explicitCommand) {
        counters.worklogOrdinaryMessages += 1;
        continue;
      }
      counters.worklogCommands += 1;
      counters.worklogRejected += 1;
      if (message.replyToken) {
        await replySafely({
          reply: input.reply,
          anomalies: input.anomalies,
          replyToken: message.replyToken,
          text: 'AFTERTRACE 這次沒有成功處理紀錄指令，請稍後再試。',
          lineGroupId: message.lineGroupId,
          lineUserId: message.lineUserId,
          lineMessageId: message.lineMessageId,
          webhookEventId: message.webhookEventId,
          counters,
        });
      }
      continue;
    }

    if (result.status === 'NOT_HANDLED') {
      counters.worklogOrdinaryMessages += 1;
      continue;
    }

    counters.worklogCommands += 1;
    if (result.status === 'RECORDED') {
      counters.worklogRecords += 1;
      if (result.duplicate) counters.worklogDuplicateRecords += 1;
    } else if (result.status === 'QUERY') {
      counters.worklogQueries += 1;
    } else if (result.status === 'OWNER_BOUND') {
      counters.worklogOwnerClaims += 1;
    } else {
      counters.worklogRejected += 1;
    }

    if (!message.replyToken) continue;
    if (result.status === 'QUERY') {
      let url: string | null = null;
      if (message.lineUserId && input.createQueryUrl) {
        try {
          url = await input.createQueryUrl({
            lineUserId: message.lineUserId,
            lineGroupId: message.lineGroupId,
            sourceId: result.sourceId,
            userId: result.userId,
            at: message.lineTimestamp,
            filters: result.filters,
          });
        } catch (error) {
          counters.worklogErrors += 1;
          logFailure({
            event: 'worklog_group_query_entry_failed',
            lineGroupId: message.lineGroupId,
            lineMessageId: message.lineMessageId,
            webhookEventId: message.webhookEventId,
            error,
          });
          await recordAnomalySafely(input.anomalies, {
            category: 'LINE_GROUP_QUERY_ENTRY',
            errorCode: anomalyErrorCode(error, 'GROUP_QUERY_ENTRY_FAILED'),
            summary: anomalyErrorSummary(error, 'LINE group query entry failed'),
            userId: result.userId,
            sourceId: result.sourceId,
            lineMessageId: message.lineMessageId,
            requestRef: message.webhookEventId,
            metadata: {
              lineGroupId: message.lineGroupId,
              lineUserId: message.lineUserId,
              filters: result.filters,
            },
          });
        }
      }
      await replySafely({
        reply: input.reply,
        anomalies: input.anomalies,
        replyToken: message.replyToken,
        text: url
          ? `AFTERTRACE｜查看紀錄\n${url}`
          : 'AFTERTRACE 紀錄頁目前尚未設定完成，紀錄本身不受影響。',
        lineGroupId: message.lineGroupId,
        lineUserId: message.lineUserId,
        lineMessageId: message.lineMessageId,
        webhookEventId: message.webhookEventId,
        counters,
      });
      continue;
    }

    await replySafely({
      reply: input.reply,
      anomalies: input.anomalies,
      replyToken: message.replyToken,
      text: result.replyText,
      lineGroupId: message.lineGroupId,
      lineUserId: message.lineUserId,
      lineMessageId: message.lineMessageId,
      webhookEventId: message.webhookEventId,
      counters,
    });
  }

  return counters;
}
