import type { ParsedOaWebhook } from '../line/events';
import {
  anomalyErrorCode,
  anomalyErrorSummary,
  recordAnomalySafely,
  type WorklogAnomalyPort,
} from './anomalies';
import { parseWorklogCommand } from './command';
import type { WorklogOaRuntime, WorklogOaRuntimeResult } from './oa-runtime';

export interface WorklogOaReplyPort {
  reply(replyToken: string, text: string): Promise<void>;
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
}

function emptyCounters(): WorklogOaWebhookCounters {
  return {
    oaLifecycleEvents: 0,
    oaWorklogCommands: 0,
    oaWorklogRecords: 0,
    oaWorklogDuplicateRecords: 0,
    oaWorklogRejected: 0,
    oaWorklogQueries: 0,
    oaHumanSupportMessages: 0,
    oaErrors: 0,
  };
}

function logMessageFailure(message: {
  lineUserId: string;
  lineMessageId: string;
  webhookEventId: string | null;
}, event: string, error: unknown, extra?: Record<string, unknown>): void {
  console.error(JSON.stringify({
    event,
    lineUserId: message.lineUserId,
    lineMessageId: message.lineMessageId,
    webhookEventId: message.webhookEventId,
    ...extra,
    message: error instanceof Error ? error.message : 'unknown error',
  }));
}

async function replySafely(input: {
  reply: WorklogOaReplyPort;
  anomalies?: WorklogAnomalyPort;
  replyToken: string;
  text: string;
  lineUserId: string;
  lineMessageId: string;
  webhookEventId: string | null;
  counters: WorklogOaWebhookCounters;
}): Promise<void> {
  try {
    await input.reply.reply(input.replyToken, input.text);
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
  }
}

/**
 * Processes only LINE OA one-to-one events. This boundary intentionally does not
 * know about the legacy group conversation/Energy/Memory runtime, so ordinary OA
 * support messages can never accidentally fall through into legacy group logic.
 */
export async function processWorklogOaWebhook(input: {
  parsed: ParsedOaWebhook;
  runtime: Pick<WorklogOaRuntime, 'handleLifecycle' | 'handleMessage'>;
  reply: WorklogOaReplyPort;
  anomalies?: WorklogAnomalyPort;
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
        console.error(JSON.stringify({
          event: 'worklog_oa_lifecycle_failed',
          lifecycleType: parsedEvent.event.type,
          lineUserId: parsedEvent.event.lineUserId,
          webhookEventId: parsedEvent.event.webhookEventId,
          message: error instanceof Error ? error.message : 'unknown error',
        }));
        await recordAnomalySafely(input.anomalies, {
          category: 'LINE_OA_LIFECYCLE',
          errorCode: anomalyErrorCode(error, 'OA_LIFECYCLE_FAILED'),
          summary: anomalyErrorSummary(error, 'LINE OA lifecycle failed'),
          requestRef: parsedEvent.event.webhookEventId,
          metadata: {
            lineUserId: parsedEvent.event.lineUserId,
            lifecycleType: parsedEvent.event.type,
          },
        });
      }
      continue;
    }

    const message = parsedEvent.message;
    const explicitCommand = parseWorklogCommand(message) !== null;
    let result: WorklogOaRuntimeResult;
    try {
      result = await input.runtime.handleMessage(message);
    } catch (error) {
      counters.oaErrors += 1;
      logMessageFailure(message, 'worklog_oa_message_failed', error, { explicitCommand });
      await recordAnomalySafely(input.anomalies, {
        category: 'LINE_OA_WEBHOOK',
        errorCode: anomalyErrorCode(error, 'OA_MESSAGE_FAILED'),
        summary: anomalyErrorSummary(error, 'LINE OA message failed'),
        lineMessageId: message.lineMessageId,
        requestRef: message.webhookEventId,
        metadata: {
          lineUserId: message.lineUserId,
          explicitCommand,
        },
      });

      if (explicitCommand) {
        counters.oaWorklogCommands += 1;
        counters.oaWorklogRejected += 1;
        if (message.replyToken) {
          await replySafely({
            reply: input.reply,
            anomalies: input.anomalies,
            replyToken: message.replyToken,
            text: 'AFTERTRACE 這次沒有成功處理個人紀錄指令，請稍後再試。',
            lineUserId: message.lineUserId,
            lineMessageId: message.lineMessageId,
            webhookEventId: message.webhookEventId,
            counters,
          });
        }
      } else {
        // Ordinary private OA text is human support traffic. A persistence/touch
        // failure must not produce an automated product-error reply to the customer.
        counters.oaHumanSupportMessages += 1;
      }
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
    } else if (result.status === 'QUERY') {
      counters.oaWorklogQueries += 1;
    } else {
      counters.oaWorklogRejected += 1;
    }

    if (!message.replyToken) continue;
    if (result.status === 'QUERY') {
      let url: string | null = null;
      if (input.createQueryUrl) {
        try {
          url = await input.createQueryUrl({
            lineUserId: message.lineUserId,
            sourceId: result.sourceId,
            userId: result.userId,
            at: message.lineTimestamp,
          });
        } catch (error) {
          counters.oaErrors += 1;
          logMessageFailure(message, 'worklog_oa_query_entry_failed', error);
          await recordAnomalySafely(input.anomalies, {
            category: 'LINE_OA_QUERY_ENTRY',
            errorCode: anomalyErrorCode(error, 'OA_QUERY_ENTRY_FAILED'),
            summary: anomalyErrorSummary(error, 'LINE OA query entry failed'),
            userId: result.userId,
            sourceId: result.sourceId,
            lineMessageId: message.lineMessageId,
            requestRef: message.webhookEventId,
            metadata: { lineUserId: message.lineUserId },
          });
        }
      }
      await replySafely({
        reply: input.reply,
        anomalies: input.anomalies,
        replyToken: message.replyToken,
        text: url
          ? `AFTERTRACE｜查看個人紀錄\n${url}`
          : 'AFTERTRACE 個人紀錄頁的安全登入正在接線中，既有紀錄不受影響。',
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
      lineUserId: message.lineUserId,
      lineMessageId: message.lineMessageId,
      webhookEventId: message.webhookEventId,
      counters,
    });
  }

  return counters;
}
