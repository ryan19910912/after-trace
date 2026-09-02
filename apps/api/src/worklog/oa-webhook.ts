import type { ParsedOaWebhook } from '../line/events';
import { parseWorklogCommand } from './command';
import type { WorklogOaRuntime } from './oa-runtime';

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

/**
 * Processes only LINE OA one-to-one events. This boundary intentionally does not
 * know about the legacy group conversation/Energy/Memory runtime, so ordinary OA
 * support messages can never accidentally fall through into legacy group logic.
 */
export async function processWorklogOaWebhook(input: {
  parsed: ParsedOaWebhook;
  runtime: Pick<WorklogOaRuntime, 'handleLifecycle' | 'handleMessage'>;
  reply: WorklogOaReplyPort;
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
      }
      continue;
    }

    const message = parsedEvent.message;
    const explicitCommand = parseWorklogCommand(message) !== null;
    try {
      const result = await input.runtime.handleMessage(message);
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
        const url = input.createQueryUrl
          ? await input.createQueryUrl({
              lineUserId: message.lineUserId,
              sourceId: result.sourceId,
              userId: result.userId,
              at: message.lineTimestamp,
            })
          : null;
        await input.reply.reply(
          message.replyToken,
          url
            ? `AFTERTRACE｜查看個人紀錄\n${url}`
            : 'AFTERTRACE 個人紀錄頁的安全登入正在接線中，既有紀錄不受影響。',
        );
        continue;
      }

      await input.reply.reply(message.replyToken, result.replyText);
    } catch (error) {
      counters.oaErrors += 1;
      console.error(JSON.stringify({
        event: 'worklog_oa_message_failed',
        lineUserId: message.lineUserId,
        lineMessageId: message.lineMessageId,
        webhookEventId: message.webhookEventId,
        explicitCommand,
        message: error instanceof Error ? error.message : 'unknown error',
      }));

      if (explicitCommand) {
        counters.oaWorklogCommands += 1;
        counters.oaWorklogRejected += 1;
        if (message.replyToken) {
          try {
            await input.reply.reply(
              message.replyToken,
              'AFTERTRACE 這次沒有成功處理個人紀錄指令，請稍後再試。',
            );
          } catch (replyError) {
            console.error(JSON.stringify({
              event: 'worklog_oa_error_reply_failed',
              lineUserId: message.lineUserId,
              lineMessageId: message.lineMessageId,
              message: replyError instanceof Error ? replyError.message : 'unknown error',
            }));
          }
        }
      } else {
        // Ordinary private OA text is human support traffic. A persistence/touch
        // failure must not produce an automated product-error reply to the customer.
        counters.oaHumanSupportMessages += 1;
      }
    }
  }

  return counters;
}
