import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage, OaLifecycleEvent, ParsedOaWebhook } from '../line/events';
import type { WorklogAnomalyInput } from './anomalies';
import type { WorklogOaLifecycleResult, WorklogOaRuntimeResult } from './oa-runtime';
import { processWorklogOaWebhook } from './oa-webhook';

function privateMessage(textContent: string, replyToken: string | null = 'reply-1'): BufferedPrivateMessage {
  return { webhookEventId: 'event-1', replyToken, lineUserId: 'U11111111111111111111111111111111', lineMessageId: 'message-1', quotedLineMessageId: null, messageType: 'text', textContent, charCount: textContent.length, quoteToken: null, lineTimestamp: new Date('2026-09-02T08:30:00+08:00'), metadata: null };
}
class FakeRuntime {
  nextMessage: WorklogOaRuntimeResult = { status: 'NOT_HANDLED' };
  failMessage = false;
  lifecycleCalls = 0;
  async handleLifecycle(_event: OaLifecycleEvent): Promise<WorklogOaLifecycleResult> { this.lifecycleCalls += 1; return { status: 'FOLLOWED', userId: 7, sourceId: 9 }; }
  async handleMessage(_message: BufferedPrivateMessage): Promise<WorklogOaRuntimeResult> { if (this.failMessage) throw new Error('boom'); return this.nextMessage; }
}
class FakeReply {
  calls: Array<{ token: string; text: string }> = [];
  mentionCalls: Array<{ token: string; text: string; lineUserId: string }> = [];
  fail = false;
  failMention = false;
  async reply(token: string, text: string): Promise<void> { this.calls.push({ token, text }); if (this.fail) throw new Error('reply unavailable'); }
  async replyUserMention(token: string, text: string, lineUserId: string): Promise<void> { this.mentionCalls.push({ token, text, lineUserId }); if (this.failMention) throw new Error('mention unavailable'); }
}
class FakeAnomalies {
  calls: WorklogAnomalyInput[] = [];
  async record(input: WorklogAnomalyInput) { this.calls.push(input); }
}
function parsedWithMessage(message: BufferedPrivateMessage): ParsedOaWebhook {
  return { events: [{ kind: 'PRIVATE_MESSAGE', message }] };
}

describe('processWorklogOaWebhook 小跡', () => {
  it('counts ordinary OA text as support and does not auto-reply', async () => {
    const runtime = new FakeRuntime(); const reply = new FakeReply();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('我想問一下方案')), runtime, reply });
    expect(result).toMatchObject({ oaHumanSupportMessages: 1, oaWorklogCommands: 0, oaErrors: 0 });
    expect(reply.calls).toHaveLength(0);
  });

  it('replies for a recorded 小跡 command and tracks duplicates', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'RECORDED', recordId: 101, duplicate: true, replyText: '這則訊息已經記錄過了。' };
    const reply = new FakeReply();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('小跡 王先生今天收五千')), runtime, reply });
    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRecords: 1, oaWorklogDuplicateRecords: 1, oaWorklogRejected: 0 });
    expect(reply.calls).toEqual([{ token: 'reply-1', text: '這則訊息已經記錄過了。' }]);
  });

  it('replies to help without counting it as rejected', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'HELP', replyText: '小跡 使用方式' };
    const reply = new FakeReply();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('小跡 幫助')), runtime, reply });
    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 0 });
    expect(reply.calls[0]?.text).toContain('小跡');
  });

  it('renders personal status with a real LINE user mention instead of 你', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'HELP', replyText: 'AFTERTRACE 個人狀態\n\nAI 負責人：你\nAI 點數：400,000 / 400,000\n目前額度使用率：0%\nAI 功能：可使用' };
    const reply = new FakeReply();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('小跡 狀態')), runtime, reply });
    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 0, oaErrors: 0 });
    expect(reply.mentionCalls).toEqual([{
      token: 'reply-1',
      text: 'AFTERTRACE 個人狀態\n\nAI 負責人：{responsible}\nAI 點數：400,000 / 400,000\n目前額度使用率：0%\nAI 功能：可使用',
      lineUserId: 'U11111111111111111111111111111111',
    }]);
    expect(reply.calls).toHaveLength(0);
  });

  it('falls back safely if personal-status LINE mention fails', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'HELP', replyText: 'AFTERTRACE 個人狀態\n\nAI 負責人：你\nAI 點數：400,000 / 400,000\n目前額度使用率：0%\nAI 功能：可使用' };
    const reply = new FakeReply(); reply.failMention = true;
    const anomalies = new FakeAnomalies();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('小跡 狀態')), runtime, reply, anomalies });
    expect(result).toMatchObject({ oaWorklogCommands: 1, oaErrors: 1 });
    expect(reply.calls).toEqual([{ token: 'reply-1', text: runtime.nextMessage.replyText }]);
    expect(anomalies.calls[0]).toMatchObject({ category: 'LINE_OA_STATUS_MENTION' });
  });

  it('uses a private query callback with deterministic filters', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'QUERY', sourceId: 9, userId: 7, filters: { query: '晴空案收款' } };
    const targets: unknown[] = []; const reply = new FakeReply();
    const result = await processWorklogOaWebhook({
      parsed: parsedWithMessage(privateMessage('小跡 查 晴空案收款')),
      runtime,
      reply,
      queryHistory: async (target) => {
        targets.push(target);
        return { filters: target.filters, total: 0, records: [], title: null, query: target.filters.query ?? null };
      },
      createQueryUrl: async () => 'https://app.example.test/?t=private-token&q=x',
    });
    expect(result.oaWorklogQueries).toBe(1);
    expect(targets).toHaveLength(1);
    expect(reply.calls[0]?.text).toContain('https://app.example.test');
  });

  it('records a reply anomaly without losing a successful Record result', async () => {
    const runtime = new FakeRuntime();
    runtime.nextMessage = { status: 'RECORDED', recordId: 101, duplicate: false, replyText: '已記錄。' };
    const reply = new FakeReply(); reply.fail = true;
    const anomalies = new FakeAnomalies();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('小跡 今天完成維修')), runtime, reply, anomalies });
    expect(result).toMatchObject({ oaWorklogRecords: 1, oaErrors: 1 });
    expect(anomalies.calls[0]).toMatchObject({ category: 'LINE_OA_REPLY', lineMessageId: 'message-1' });
  });

  it('does not send product error reply for ordinary support failure', async () => {
    const runtime = new FakeRuntime(); runtime.failMessage = true;
    const reply = new FakeReply(); const anomalies = new FakeAnomalies();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('真人客服您好')), runtime, reply, anomalies });
    expect(result).toMatchObject({ oaHumanSupportMessages: 1, oaErrors: 1, oaWorklogRejected: 0 });
    expect(reply.calls).toHaveLength(0);
  });

  it('replies safely when an explicit 小跡 command throws', async () => {
    const runtime = new FakeRuntime(); runtime.failMessage = true;
    const reply = new FakeReply(); const anomalies = new FakeAnomalies();
    const result = await processWorklogOaWebhook({ parsed: parsedWithMessage(privateMessage('小跡 今天完成維修')), runtime, reply, anomalies });
    expect(result).toMatchObject({ oaWorklogCommands: 1, oaWorklogRejected: 1, oaErrors: 1 });
    expect(reply.calls[0]?.text).toContain('小跡');
  });

  it('processes OA lifecycle independently', async () => {
    const runtime = new FakeRuntime(); const reply = new FakeReply();
    const parsed: ParsedOaWebhook = { events: [{ kind: 'OA_LIFECYCLE', event: { webhookEventId: 'follow-1', lineUserId: 'U11111111111111111111111111111111', type: 'FOLLOW', lineTimestamp: new Date('2026-09-02T08:00:00+08:00') } }] };
    const result = await processWorklogOaWebhook({ parsed, runtime, reply });
    expect(result.oaLifecycleEvents).toBe(1);
    expect(runtime.lifecycleCalls).toBe(1);
    expect(reply.calls).toHaveLength(0);
  });
});
