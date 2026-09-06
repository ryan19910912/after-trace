import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage, GroupLifecycleEvent, ParsedLineWebhook } from '../line/events';
import type { WorklogAnomalyInput } from './anomalies';
import type { WorklogLineRuntimeResult } from './line-runtime';
import { processWorklogGroupWebhook } from './group-webhook';

function groupMessage(textContent: string, replyToken: string | null = 'reply-1'): BufferedGroupMessage {
  return { webhookEventId: 'event-1', replyToken, lineGroupId: 'C11111111111111111111111111111111', lineMessageId: 'message-1', quotedLineMessageId: null, lineUserId: 'U11111111111111111111111111111111', messageType: 'text', textContent, charCount: textContent.length, quoteToken: null, lineTimestamp: new Date('2026-09-02T12:00:00+08:00'), metadata: null };
}
class FakeRuntime {
  next: WorklogLineRuntimeResult = { status: 'NOT_HANDLED' };
  fail = false;
  async handle(_message: BufferedGroupMessage): Promise<WorklogLineRuntimeResult> { if (this.fail) throw new Error('boom'); return this.next; }
}
class FakeBootstrap {
  lifecycle: Array<{ lineGroupId: string; lineUserId?: string; isActive?: boolean; at?: Date }> = [];
  async handleGroupLeave(input: { lineGroupId: string; at?: Date }) { this.lifecycle.push(input); }
  async setGroupMemberPresence(input: { lineGroupId: string; lineUserId: string; isActive: boolean; at?: Date }) { this.lifecycle.push(input); }
}
class FakeReply {
  calls: Array<{ token: string; text: string }> = [];
  fail = false;
  async reply(token: string, text: string) { this.calls.push({ token, text }); if (this.fail) throw new Error('reply unavailable'); }
}
class FakeAnomalies {
  calls: WorklogAnomalyInput[] = [];
  async record(input: WorklogAnomalyInput) { this.calls.push(input); }
}
function parsed(message: BufferedGroupMessage): ParsedLineWebhook { return { events: [{ kind: 'MESSAGE', message }] }; }

describe('processWorklogGroupWebhook 小跡', () => {
  it('counts ordinary group chat without replying', async () => {
    const runtime = new FakeRuntime(); const reply = new FakeReply();
    const result = await processWorklogGroupWebhook({ parsed: parsed(groupMessage('大家明天九點集合')), bootstrap: new FakeBootstrap(), runtime, reply });
    expect(result).toMatchObject({ worklogOrdinaryMessages: 1, worklogCommands: 0 });
    expect(reply.calls).toHaveLength(0);
  });

  it('replies for recorded 小跡 command', async () => {
    const runtime = new FakeRuntime(); runtime.next = { status: 'RECORDED', recordId: 99, duplicate: false, replyText: '已記錄。' };
    const reply = new FakeReply();
    const result = await processWorklogGroupWebhook({ parsed: parsed(groupMessage('小跡 晴空案今天收三千')), bootstrap: new FakeBootstrap(), runtime, reply });
    expect(result).toMatchObject({ worklogCommands: 1, worklogRecords: 1, worklogRejected: 0 });
    expect(reply.calls).toEqual([{ token: 'reply-1', text: '已記錄。' }]);
  });

  it('replies to help without rejection', async () => {
    const runtime = new FakeRuntime(); runtime.next = { status: 'HELP', replyText: '小跡 使用方式' };
    const reply = new FakeReply();
    const result = await processWorklogGroupWebhook({ parsed: parsed(groupMessage('小跡 幫助')), bootstrap: new FakeBootstrap(), runtime, reply });
    expect(result).toMatchObject({ worklogCommands: 1, worklogRejected: 0 });
    expect(reply.calls[0]?.text).toContain('小跡');
  });

  it('routes deterministic query and deep link', async () => {
    const runtime = new FakeRuntime(); runtime.next = { status: 'QUERY', sourceId: 20, userId: 7, filters: { query: '晴空案收款' } };
    const reply = new FakeReply(); const targets: unknown[] = [];
    const result = await processWorklogGroupWebhook({
      parsed: parsed(groupMessage('小跡 查 晴空案收款')),
      bootstrap: new FakeBootstrap(),
      runtime,
      reply,
      queryHistory: async (target) => {
        targets.push(target);
        return { filters: target.filters, total: 0, records: [], title: null, query: target.filters.query ?? null };
      },
      createQueryUrl: async () => 'https://app.example.test/?group=1&q=x',
    });
    expect(result.worklogQueries).toBe(1); expect(targets).toHaveLength(1); expect(reply.calls[0]?.text).toContain('https://app.example.test');
  });

  it('tracks AI responsibility claim separately', async () => {
    const runtime = new FakeRuntime(); runtime.next = { status: 'AI_RESPONSIBILITY_BOUND', sourceId: 20, replyText: '已完成設定。' };
    const result = await processWorklogGroupWebhook({ parsed: parsed(groupMessage('小跡 啟用')), bootstrap: new FakeBootstrap(), runtime, reply: new FakeReply() });
    expect(result).toMatchObject({ worklogAiResponsibilityClaims: 1, worklogRejected: 0 });
  });

  it('writes anomaly and product error reply when explicit command throws', async () => {
    const runtime = new FakeRuntime(); runtime.fail = true;
    const reply = new FakeReply(); const anomalies = new FakeAnomalies();
    const result = await processWorklogGroupWebhook({ parsed: parsed(groupMessage('小跡 今天完成維修')), bootstrap: new FakeBootstrap(), runtime, reply, anomalies });
    expect(result).toMatchObject({ worklogCommands: 1, worklogRejected: 1, worklogErrors: 1 });
    expect(reply.calls[0]?.text).toContain('小跡');
    expect(anomalies.calls[0]).toMatchObject({ category: 'LINE_GROUP_WEBHOOK' });
  });

  it('does not send product error reply when ordinary chat processing throws', async () => {
    const runtime = new FakeRuntime(); runtime.fail = true;
    const reply = new FakeReply();
    const result = await processWorklogGroupWebhook({ parsed: parsed(groupMessage('普通聊天')), bootstrap: new FakeBootstrap(), runtime, reply });
    expect(result).toMatchObject({ worklogOrdinaryMessages: 1, worklogErrors: 1 });
    expect(reply.calls).toHaveLength(0);
  });

  it('processes member-left lifecycle as immediate inactive membership evidence', async () => {
    const bootstrap = new FakeBootstrap();
    const at = new Date('2026-09-02T12:00:00Z');
    const lifecycle: GroupLifecycleEvent = { webhookEventId: 'member-left-1', lineGroupId: 'group-1', type: 'MEMBER_LEFT', lineUserIds: ['user-1'], lineTimestamp: at };
    const parsedLifecycle: ParsedLineWebhook = { events: [{ kind: 'LIFECYCLE', event: lifecycle }] };
    const result = await processWorklogGroupWebhook({ parsed: parsedLifecycle, bootstrap, runtime: new FakeRuntime(), reply: new FakeReply() });
    expect(result.lifecycleEvents).toBe(1);
    expect(bootstrap.lifecycle).toEqual([{ lineGroupId: 'group-1', lineUserId: 'user-1', isActive: false, at }]);
  });
});
