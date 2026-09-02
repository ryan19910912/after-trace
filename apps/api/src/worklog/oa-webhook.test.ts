import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage, OaLifecycleEvent, ParsedOaWebhook } from '../line/events';
import type { WorklogOaRuntimeResult, WorklogOaLifecycleResult } from './oa-runtime';
import { processWorklogOaWebhook } from './oa-webhook';

function privateMessage(textContent: string, replyToken: string | null = 'reply-1'): BufferedPrivateMessage {
  return {
    webhookEventId: 'event-1',
    replyToken,
    lineUserId: 'U11111111111111111111111111111111',
    lineMessageId: 'message-1',
    quotedLineMessageId: null,
    messageType: 'text',
    textContent,
    charCount: textContent.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-09-02T08:30:00+08:00'),
    metadata: null,
  };
}

class FakeRuntime {
  public nextMessage: WorklogOaRuntimeResult = { status: 'NOT_HANDLED' };
  public failMessage = false;
  public lifecycleCalls = 0;

  async handleLifecycle(_event: OaLifecycleEvent): Promise<WorklogOaLifecycleResult> {
    this.lifecycleCalls += 1;
    return { status: 'FOLLOWED', userId: 7, sourceId: 9 };
  }

  async handleMessage(_message: BufferedPrivateMessage): Promise<WorklogOaRuntimeResult> {
    if (this.failMessage) throw new Error('boom');
    return this.nextMessage;
  }
}

class FakeReply {
  public calls: Array<{ token: string; text: string }> = [];
  public fail = false;

  async reply(token: string, text: string): Promise<void> {
    this.calls.push({ token, text });
    if (this.fail) throw new Error('reply unavailable');
  }
}

function parsedWithMessage(message: BufferedPrivateMessage): ParsedOaWebhook {
  return { events: [{ kind: 'PRIVATE_MESSAGE', message }] };
}

describe('processWorklogOaWebhook', () => {
  it('counts ordinary OA text as human support and never auto-replies', async () => {
    const runtime = new FakeRuntime();
    const reply = new FakeReply();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('我想問一下方案')),
      runtime,
      reply,
    });

    expect(result).toMatchObject({
      oaHumanSupportMessages: 1,
      oaWorklogCommands: 0,
      oaErrors: 0,
    });
    expect(reply.calls).toHaveLength(0);
  });

  it('replies for explicit private record results and tracks duplicates', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = {
      status: 'RECORDED',
      recordId: 101,
      duplicate: true,
      replyText: '這則訊息已經記錄過了。',
    };
    const reply = new FakeReply();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 王先生今天收五千')),
      runtime,
      reply,
    });

    expect(result).toMatchObject({
      oaWorklogCommands: 1,
      oaWorklogRecords: 1,
      oaWorklogDuplicateRecords: 1,
      oaWorklogRejected: 0,
    });
    expect(reply.calls).toEqual([{ token: 'reply-1', text: '這則訊息已經記錄過了。' }]);
  });

  it('keeps a successful record result when LINE reply delivery fails', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = {
      status: 'RECORDED',
      recordId: 101,
      duplicate: false,
      replyText: '已記錄到你的個人 AFTERTRACE。',
    };
    const reply = new FakeReply();
    reply.fail = true;

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 今天完成維修')),
      runtime,
      reply,
    });

    expect(result).toMatchObject({
      oaWorklogCommands: 1,
      oaWorklogRecords: 1,
      oaWorklogRejected: 0,
      oaErrors: 1,
    });
    expect(reply.calls).toHaveLength(1);
  });

  it('uses a private query URL callback without inventing a group id', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'QUERY', sourceId: 9, userId: 7 };
    const reply = new FakeReply();
    const targets: unknown[] = [];

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 查詢')),
      runtime,
      reply,
      createQueryUrl: async (target) => {
        targets.push(target);
        return 'https://app.example.test/?t=private-token';
      },
    });

    expect(result.oaWorklogQueries).toBe(1);
    expect(targets).toEqual([
      {
        lineUserId: 'U11111111111111111111111111111111',
        sourceId: 9,
        userId: 7,
        at: new Date('2026-09-02T08:30:00+08:00'),
      },
    ]);
    expect(reply.calls[0]?.text).toContain('https://app.example.test/?t=private-token');
  });

  it('does not send automated product-error replies for ordinary support failures', async () => {
    const runtime = new FakeRuntime();
    runtime.failMessage = true;
    const reply = new FakeReply();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('真人客服您好')),
      runtime,
      reply,
    });

    expect(result).toMatchObject({ oaHumanSupportMessages: 1, oaErrors: 1, oaWorklogRejected: 0 });
    expect(reply.calls).toHaveLength(0);
  });

  it('replies safely when an explicit product command throws', async () => {
    const runtime = new FakeRuntime();
    runtime.failMessage = true;
    const reply = new FakeReply();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 今天完成維修')),
      runtime,
      reply,
    });

    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 1, oaErrors: 1 });
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]?.text).toContain('沒有成功處理個人紀錄指令');
  });

  it('processes OA lifecycle events independently from messages', async () => {
    const runtime = new FakeRuntime();
    const reply = new FakeReply();
    const parsed: ParsedOaWebhook = {
      events: [{
        kind: 'OA_LIFECYCLE',
        event: {
          webhookEventId: 'follow-1',
          lineUserId: 'U11111111111111111111111111111111',
          type: 'FOLLOW',
          lineTimestamp: new Date('2026-09-02T08:00:00+08:00'),
        },
      }],
    };

    const result = await processWorklogOaWebhook({ parsed, runtime, reply });

    expect(result.oaLifecycleEvents).toBe(1);
    expect(runtime.lifecycleCalls).toBe(1);
    expect(reply.calls).toHaveLength(0);
  });
});
