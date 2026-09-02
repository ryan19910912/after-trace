import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage, GroupLifecycleEvent, ParsedLineWebhook } from '../line/events';
import type { WorklogAnomalyInput } from './anomalies';
import type { WorklogLineRuntimeResult } from './line-runtime';
import { processWorklogGroupWebhook } from './group-webhook';

function groupMessage(textContent: string, replyToken: string | null = 'reply-1'): BufferedGroupMessage {
  return {
    webhookEventId: 'event-1',
    replyToken,
    lineGroupId: 'C11111111111111111111111111111111',
    lineMessageId: 'message-1',
    quotedLineMessageId: null,
    lineUserId: 'U11111111111111111111111111111111',
    messageType: 'text',
    textContent,
    charCount: textContent.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-09-02T12:00:00+08:00'),
    metadata: null,
  };
}

class FakeRuntime {
  public next: WorklogLineRuntimeResult = { status: 'NOT_HANDLED' };
  public fail = false;
  async handle(_message: BufferedGroupMessage): Promise<WorklogLineRuntimeResult> {
    if (this.fail) throw new Error('boom');
    return this.next;
  }
}

class FakeBootstrap {
  public leaves: string[] = [];
  public members: Array<{ lineUserId: string; active: boolean }> = [];
  async handleGroupLeave(input: { lineGroupId: string }): Promise<void> { this.leaves.push(input.lineGroupId); }
  async setGroupMemberPresence(input: { lineGroupId: string; lineUserId: string; isActive: boolean }): Promise<void> {
    this.members.push({ lineUserId: input.lineUserId, active: input.isActive });
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

function parsedWithMessage(message: BufferedGroupMessage): ParsedLineWebhook {
  return { events: [{ kind: 'MESSAGE', message }] };
}

describe('processWorklogGroupWebhook', () => {
  it('terminates ordinary group traffic at the Worklog boundary without replying', async () => {
    const runtime = new FakeRuntime();
    const reply = new FakeReply();
    const result = await processWorklogGroupWebhook({
      parsed: parsedWithMessage(groupMessage('今天午餐吃什麼')),
      runtime,
      reply,
      bootstrap: new FakeBootstrap(),
    });
    expect(result).toMatchObject({ worklogOrdinaryMessages: 1, worklogCommands: 0, worklogErrors: 0 });
    expect(reply.calls).toHaveLength(0);
  });

  it('counts persisted commands and records a structured anomaly when LINE reply delivery fails', async () => {
    const runtime = new FakeRuntime();
    runtime.next = { status: 'RECORDED', recordId: 88, duplicate: false, replyText: '已記錄。' };
    const reply = new FakeReply();
    reply.fail = true;
    const anomalies = new FakeAnomalies();
    const result = await processWorklogGroupWebhook({
      parsed: parsedWithMessage(groupMessage('@AFTERTRACE 今天完成驗收')),
      runtime,
      reply,
      anomalies,
      bootstrap: new FakeBootstrap(),
    });
    expect(result).toMatchObject({ worklogCommands: 1, worklogRecords: 1, worklogRejected: 0, worklogErrors: 1 });
    expect(reply.calls).toHaveLength(1);
    expect(anomalies.calls).toHaveLength(1);
    expect(anomalies.calls[0]).toMatchObject({
      category: 'LINE_GROUP_REPLY',
      lineMessageId: 'message-1',
      requestRef: 'event-1',
    });
  });

  it('creates scoped query links from the exact group/user context', async () => {
    const runtime = new FakeRuntime();
    runtime.next = { status: 'QUERY', sourceId: 19, userId: 7 };
    const reply = new FakeReply();
    const targets: unknown[] = [];
    const result = await processWorklogGroupWebhook({
      parsed: parsedWithMessage(groupMessage('@AFTERTRACE 查詢')),
      runtime,
      reply,
      bootstrap: new FakeBootstrap(),
      createQueryUrl: async (target) => {
        targets.push(target);
        return 'https://app.example.test/?t=group-token';
      },
    });
    expect(result.worklogQueries).toBe(1);
    expect(targets).toEqual([{
      lineUserId: 'U11111111111111111111111111111111',
      lineGroupId: 'C11111111111111111111111111111111',
      sourceId: 19,
      userId: 7,
      at: new Date('2026-09-02T12:00:00+08:00'),
    }]);
    expect(reply.calls[0]?.text).toContain('https://app.example.test/?t=group-token');
  });

  it('records a structured anomaly without sending a product-error reply for ordinary group failures', async () => {
    const runtime = new FakeRuntime();
    runtime.fail = true;
    const reply = new FakeReply();
    const anomalies = new FakeAnomalies();
    const result = await processWorklogGroupWebhook({
      parsed: parsedWithMessage(groupMessage('一般群組聊天')),
      runtime,
      reply,
      anomalies,
      bootstrap: new FakeBootstrap(),
    });
    expect(result).toMatchObject({ worklogOrdinaryMessages: 1, worklogCommands: 0, worklogErrors: 1 });
    expect(reply.calls).toHaveLength(0);
    expect(anomalies.calls).toHaveLength(1);
    expect(anomalies.calls[0]).toMatchObject({
      category: 'LINE_GROUP_WEBHOOK',
      errorCode: 'GROUP_MESSAGE_FAILED',
      lineMessageId: 'message-1',
    });
  });

  it('returns a safe retry message and records the failure when an explicit command throws', async () => {
    const runtime = new FakeRuntime();
    runtime.fail = true;
    const reply = new FakeReply();
    const anomalies = new FakeAnomalies();
    const result = await processWorklogGroupWebhook({
      parsed: parsedWithMessage(groupMessage('@AFTERTRACE 工地 A 今天停工')),
      runtime,
      reply,
      anomalies,
      bootstrap: new FakeBootstrap(),
    });
    expect(result).toMatchObject({ worklogCommands: 1, worklogRejected: 1, worklogErrors: 1 });
    expect(reply.calls[0]?.text).toContain('沒有成功處理紀錄指令');
    expect(anomalies.calls[0]).toMatchObject({ category: 'LINE_GROUP_WEBHOOK' });
  });

  it('records query-entry failures with user/source context', async () => {
    const runtime = new FakeRuntime();
    runtime.next = { status: 'QUERY', sourceId: 19, userId: 7 };
    const anomalies = new FakeAnomalies();
    const result = await processWorklogGroupWebhook({
      parsed: parsedWithMessage(groupMessage('@AFTERTRACE 查詢')),
      runtime,
      reply: new FakeReply(),
      anomalies,
      bootstrap: new FakeBootstrap(),
      createQueryUrl: async () => { throw new Error('entry failed'); },
    });
    expect(result.worklogErrors).toBe(1);
    expect(anomalies.calls[0]).toMatchObject({
      category: 'LINE_GROUP_QUERY_ENTRY',
      userId: 7,
      sourceId: 19,
    });
  });

  it('updates Worklog member presence and leave state for lifecycle events', async () => {
    const bootstrap = new FakeBootstrap();
    const memberJoined: GroupLifecycleEvent = {
      webhookEventId: 'join-1',
      lineGroupId: 'C11111111111111111111111111111111',
      type: 'MEMBER_JOINED',
      lineUserIds: ['U22222222222222222222222222222222'],
      lineTimestamp: new Date('2026-09-02T11:00:00+08:00'),
    };
    const leave: GroupLifecycleEvent = {
      webhookEventId: 'leave-1',
      lineGroupId: 'C11111111111111111111111111111111',
      type: 'LEAVE',
      lineUserIds: [],
      lineTimestamp: new Date('2026-09-02T11:30:00+08:00'),
    };
    const parsed: ParsedLineWebhook = {
      events: [{ kind: 'LIFECYCLE', event: memberJoined }, { kind: 'LIFECYCLE', event: leave }],
    };
    const result = await processWorklogGroupWebhook({
      parsed,
      runtime: new FakeRuntime(),
      reply: new FakeReply(),
      bootstrap,
    });
    expect(result.lifecycleEvents).toBe(2);
    expect(bootstrap.members).toEqual([{ lineUserId: 'U22222222222222222222222222222222', active: true }]);
    expect(bootstrap.leaves).toEqual(['C11111111111111111111111111111111']);
  });
});
