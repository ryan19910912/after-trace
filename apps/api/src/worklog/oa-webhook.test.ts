import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage, OaLifecycleEvent, OaPostbackEvent, ParsedOaWebhook } from '../line/events';
import type { WorklogAnomalyInput } from './anomalies';
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

function oaPostback(data: string): OaPostbackEvent {
  return {
    webhookEventId: 'postback-event-1',
    replyToken: 'postback-reply-1',
    lineUserId: 'U11111111111111111111111111111111',
    data,
    lineTimestamp: new Date('2026-09-02T08:29:00+08:00'),
  };
}

class FakeRuntime {
  public nextMessage: WorklogOaRuntimeResult = { status: 'NOT_HANDLED' };
  public nextPostback: WorklogOaRuntimeResult = { status: 'NOT_HANDLED' };
  public failMessage = false;
  public failPostback = false;
  public lifecycleCalls = 0;
  public postbackCalls = 0;

  async handleLifecycle(_event: OaLifecycleEvent): Promise<WorklogOaLifecycleResult> {
    this.lifecycleCalls += 1;
    return { status: 'FOLLOWED', userId: 7, sourceId: 9 };
  }

  async handlePostback(_event: OaPostbackEvent): Promise<WorklogOaRuntimeResult> {
    this.postbackCalls += 1;
    if (this.failPostback) throw new Error('postback boom');
    return this.nextPostback;
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

class FakeAnomalies {
  public calls: WorklogAnomalyInput[] = [];
  async record(input: WorklogAnomalyInput): Promise<void> {
    this.calls.push(input);
  }
}

function parsedWithMessage(message: BufferedPrivateMessage): ParsedOaWebhook {
  return { events: [{ kind: 'PRIVATE_MESSAGE', message }] };
}

function parsedWithPostback(event: OaPostbackEvent): ParsedOaWebhook {
  return { events: [{ kind: 'OA_POSTBACK', event }] };
}

describe('processWorklogOaWebhook', () => {
  it('routes Rich Menu postback to the OA runtime and replies with the mode prompt', async () => {
    const runtime = new FakeRuntime();
    runtime.nextPostback = {
      status: 'MODE_SELECTED',
      action: 'RECORD',
      replyText: '請輸入你要記錄的事情。',
    };
    const reply = new FakeReply();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithPostback(oaPostback('aftertrace:record')),
      runtime,
      reply,
    });

    expect(runtime.postbackCalls).toBe(1);
    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 0, oaErrors: 0 });
    expect(reply.calls).toEqual([{ token: 'postback-reply-1', text: '請輸入你要記錄的事情。' }]);
  });

  it('routes cancel postback without counting it as rejection', async () => {
    const runtime = new FakeRuntime();
    runtime.nextPostback = { status: 'MODE_CANCELED', replyText: '已取消這次操作。' };
    const reply = new FakeReply();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithPostback(oaPostback('aftertrace:cancel')),
      runtime,
      reply,
    });

    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 0 });
    expect(reply.calls[0]).toEqual({ token: 'postback-reply-1', text: '已取消這次操作。' });
  });

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

  it('keeps a successful record result and writes a structured anomaly when LINE reply fails', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = {
      status: 'RECORDED',
      recordId: 101,
      duplicate: false,
      replyText: '已記錄到你的個人 AFTERTRACE。',
    };
    const reply = new FakeReply();
    reply.fail = true;
    const anomalies = new FakeAnomalies();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 今天完成維修')),
      runtime,
      reply,
      anomalies,
    });

    expect(result).toMatchObject({
      oaWorklogCommands: 1,
      oaWorklogRecords: 1,
      oaWorklogRejected: 0,
      oaErrors: 1,
    });
    expect(reply.calls).toHaveLength(1);
    expect(anomalies.calls[0]).toMatchObject({
      category: 'LINE_OA_REPLY',
      lineMessageId: 'message-1',
      requestRef: 'event-1',
    });
  });

  it('uses a private query URL callback with deterministic filters and no invented group id', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = {
      status: 'QUERY',
      sourceId: 9,
      userId: 7,
      filters: { query: '王大明', from: '2026-08-30T16:00:00.000Z', to: '2026-09-06T16:00:00.000Z' },
    };
    const reply = new FakeReply();
    const targets: unknown[] = [];

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 王大明這週做了什麼')),
      runtime,
      reply,
      createQueryUrl: async (target) => {
        targets.push(target);
        return 'https://app.example.test/?t=private-token&q=%E7%8E%8B%E5%A4%A7%E6%98%8E';
      },
    });

    expect(result.oaWorklogQueries).toBe(1);
    expect(targets).toEqual([
      {
        lineUserId: 'U11111111111111111111111111111111',
        sourceId: 9,
        userId: 7,
        at: new Date('2026-09-02T08:30:00+08:00'),
        filters: { query: '王大明', from: '2026-08-30T16:00:00.000Z', to: '2026-09-06T16:00:00.000Z' },
      },
    ]);
    expect(reply.calls[0]?.text).toContain('https://app.example.test/?t=private-token');
  });

  it('records a structured anomaly without sending automated product-error replies for ordinary support failures', async () => {
    const runtime = new FakeRuntime();
    runtime.failMessage = true;
    const reply = new FakeReply();
    const anomalies = new FakeAnomalies();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('真人客服您好')),
      runtime,
      reply,
      anomalies,
    });

    expect(result).toMatchObject({ oaHumanSupportMessages: 1, oaErrors: 1, oaWorklogRejected: 0 });
    expect(reply.calls).toHaveLength(0);
    expect(anomalies.calls[0]).toMatchObject({
      category: 'LINE_OA_WEBHOOK',
      errorCode: 'OA_MESSAGE_FAILED',
      lineMessageId: 'message-1',
    });
  });

  it('replies safely and records an anomaly when an explicit product command throws', async () => {
    const runtime = new FakeRuntime();
    runtime.failMessage = true;
    const reply = new FakeReply();
    const anomalies = new FakeAnomalies();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 今天完成維修')),
      runtime,
      reply,
      anomalies,
    });

    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 1, oaErrors: 1 });
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]?.text).toContain('沒有成功處理個人紀錄指令');
    expect(anomalies.calls[0]).toMatchObject({ category: 'LINE_OA_WEBHOOK' });
  });

  it('records query-entry failures with private user/source/filter context', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'QUERY', sourceId: 9, userId: 7, filters: { query: '晴空案' } };
    const anomalies = new FakeAnomalies();

    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('@AFTERTRACE 查詢 晴空案')),
      runtime,
      reply: new FakeReply(),
      anomalies,
      createQueryUrl: async () => { throw new Error('entry failed'); },
    });

    expect(result.oaErrors).toBe(1);
    expect(anomalies.calls[0]).toMatchObject({
      category: 'LINE_OA_QUERY_ENTRY',
      userId: 7,
      sourceId: 9,
      metadata: { filters: { query: '晴空案' } },
    });
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
