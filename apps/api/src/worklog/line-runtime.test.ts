import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import type { GroupBootstrapResult, GroupOwnerBindResult } from './bootstrap';
import type { GroupRecordAuthorizationResult } from './collaboration';
import { WorklogLineRuntime } from './line-runtime';
import type { WorklogTextRecordWriteResult } from './records';

function message(textContent: string, overrides: Partial<BufferedGroupMessage> = {}): BufferedGroupMessage {
  return {
    webhookEventId: 'event-1',
    replyToken: 'reply-1',
    lineGroupId: 'group-1',
    lineMessageId: 'message-1',
    quotedLineMessageId: null,
    lineUserId: 'line-user-1',
    messageType: 'text',
    textContent,
    charCount: textContent.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-09-02T00:00:00Z'),
    metadata: null,
    ...overrides,
  };
}

class FakeBootstrap {
  group: GroupBootstrapResult = { status: 'BOUND', userId: 7, sourceId: 20, ownerUserId: 7 };
  bind: GroupOwnerBindResult = { status: 'BOUND', sourceId: 20, ownerUserId: 7 };
  bootstrapCalls = 0;
  bindCalls = 0;

  async bootstrapGroupInteraction() {
    this.bootstrapCalls += 1;
    return this.group;
  }

  async bindGroupOwner() {
    this.bindCalls += 1;
    return this.bind;
  }
}

class FakeCollaboration {
  result: GroupRecordAuthorizationResult = {
    status: 'OK',
    actorUserId: 7,
    chargedUserId: 7,
    ownerPlanCode: 'SUB1',
    ownerCapabilities: { groupCollaboration: true },
    remainingAiUnits: 100,
  };
  calls = 0;
  requestedAiUnits: number[] = [];

  async authorizeGroupRecord(input: { requestedAiUnits?: number }) {
    this.calls += 1;
    this.requestedAiUnits.push(input.requestedAiUnits ?? -1);
    return this.result;
  }
}

class FakeRecords {
  result: WorklogTextRecordWriteResult = { status: 'CREATED', recordId: 99 };
  calls = 0;

  async recordText() {
    this.calls += 1;
    return this.result;
  }
}

describe('WorklogLineRuntime', () => {
  it('does not touch worklog dependencies for ordinary group chat', async () => {
    const bootstrap = new FakeBootstrap();
    const collaboration = new FakeCollaboration();
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(bootstrap, collaboration, records);

    await expect(runtime.handle(message('王先生今天收五千'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(bootstrap.bootstrapCalls).toBe(0);
    expect(collaboration.calls).toBe(0);
    expect(records.calls).toBe(0);
  });

  it('keeps an unowned group pending and tells the subscriber to claim it explicitly', async () => {
    const bootstrap = new FakeBootstrap();
    bootstrap.group = { status: 'PENDING_OWNER', userId: 7, pendingGroupId: 3 };
    const collaboration = new FakeCollaboration();
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(bootstrap, collaboration, records);

    const result = await runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'));
    expect(result.status).toBe('REJECTED');
    if (result.status === 'REJECTED') expect(result.reason).toBe('PENDING_OWNER');
    expect(collaboration.calls).toBe(0);
    expect(records.calls).toBe(0);
  });

  it('supports explicit owner claim without guessing from normal speaker activity', async () => {
    const bootstrap = new FakeBootstrap();
    const runtime = new WorklogLineRuntime(bootstrap, new FakeCollaboration(), new FakeRecords());

    const result = await runtime.handle(message('@AFTERTRACE 啟用'));
    expect(result.status).toBe('OWNER_BOUND');
    expect(bootstrap.bootstrapCalls).toBe(1);
    expect(bootstrap.bindCalls).toBe(1);
  });

  it('blocks a member before record persistence when owner disabled recording', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.result = { status: 'RECORDING_DISABLED' };
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records);

    const result = await runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'));
    expect(result.status).toBe('REJECTED');
    if (result.status === 'REJECTED') expect(result.reason).toBe('RECORDING_DISABLED');
    expect(records.calls).toBe(0);
  });

  it('persists raw TEXT without consuming AI units before normalization exists', async () => {
    const collaboration = new FakeCollaboration();
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records);

    await expect(runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 99,
      duplicate: false,
    });
    expect(collaboration.requestedAiUnits).toEqual([0]);
    expect(records.calls).toBe(1);
  });

  it('treats LINE redelivery of the same record as a successful duplicate', async () => {
    const records = new FakeRecords();
    records.result = { status: 'ALREADY_RECORDED', recordId: 99 };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);

    await expect(runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 99,
      duplicate: true,
    });
  });

  it('returns a scoped query action for a bound group member', async () => {
    const collaboration = new FakeCollaboration();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());
    await expect(runtime.handle(message('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 20,
      userId: 7,
    });
    expect(collaboration.calls).toBe(0);
  });

  it('does not let recording permission remove historical query access', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.result = { status: 'RECORDING_DISABLED' };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());

    await expect(runtime.handle(message('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 20,
      userId: 7,
    });
    expect(collaboration.calls).toBe(0);
  });

  it('intercepts quoted recording so it cannot fall back into legacy Memory', async () => {
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), new FakeRecords());
    const result = await runtime.handle(message('@AFTERTRACE', { quotedLineMessageId: 'quoted-image-1' }));
    expect(result.status).toBe('QUOTED_NOT_READY');
  });
});
