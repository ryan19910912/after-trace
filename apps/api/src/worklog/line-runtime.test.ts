import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import type { GroupBootstrapResult, GroupOwnerBindResult } from './bootstrap';
import type { GroupAccessAuthorizationResult, GroupRecordAuthorizationResult } from './collaboration';
import type { CachedLineText } from './line-text-cache';
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
  accessResult: GroupAccessAuthorizationResult = {
    status: 'OK',
    actorUserId: 7,
    ownerUserId: 7,
    ownerPlanCode: 'SUB1',
    ownerCapabilities: { groupCollaboration: true },
  };
  result: GroupRecordAuthorizationResult = {
    status: 'OK',
    actorUserId: 7,
    chargedUserId: 7,
    ownerPlanCode: 'SUB1',
    ownerCapabilities: { groupCollaboration: true },
    remainingAiUnits: 100,
  };
  calls = 0;
  accessCalls = 0;
  requestedAiUnits: number[] = [];

  async authorizeGroupAccess() {
    this.accessCalls += 1;
    return this.accessResult;
  }

  async authorizeGroupRecord(input: { requestedAiUnits?: number }) {
    this.calls += 1;
    this.requestedAiUnits.push(input.requestedAiUnits ?? -1);
    return this.result;
  }
}

class FakeRecords {
  result: WorklogTextRecordWriteResult = { status: 'CREATED', recordId: 99 };
  calls = 0;
  quotedCalls = 0;
  remembered: Array<{ lineMessageId: string; lineGroupId: string; text: string }> = [];
  cached: CachedLineText | null = null;
  lastQuotedInput: { lineMessageId: string; quotedLineMessageId: string; text: string } | null = null;

  async remember(input: { lineMessageId: string; lineGroupId: string; text: string }) {
    this.remembered.push(input);
  }

  async resolve(lineGroupId: string, lineMessageId: string) {
    if (!this.cached) return null;
    return this.cached.lineGroupId === lineGroupId && this.cached.lineMessageId === lineMessageId
      ? this.cached
      : null;
  }

  async recordText() {
    this.calls += 1;
    return this.result;
  }

  async recordQuotedText(input: { lineMessageId: string; quotedLineMessageId: string; text: string }) {
    this.quotedCalls += 1;
    this.lastQuotedInput = input;
    return this.result;
  }
}

describe('WorklogLineRuntime', () => {
  it('temporarily caches ordinary group TEXT without bootstrapping or creating a record', async () => {
    const bootstrap = new FakeBootstrap();
    const collaboration = new FakeCollaboration();
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(bootstrap, collaboration, records);

    await expect(runtime.handle(message('王先生今天收五千'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(bootstrap.bootstrapCalls).toBe(0);
    expect(collaboration.calls).toBe(0);
    expect(collaboration.accessCalls).toBe(0);
    expect(records.calls).toBe(0);
    expect(records.remembered).toHaveLength(1);
    expect(records.remembered[0]).toMatchObject({
      lineMessageId: 'message-1',
      lineGroupId: 'group-1',
      text: '王先生今天收五千',
    });
  });

  it('does not cache non-text ordinary messages', async () => {
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);
    await runtime.handle(message('', { messageType: 'image', textContent: null, charCount: 0 }));
    expect(records.remembered).toHaveLength(0);
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

  it('persists raw TEXT without reserving AI units at the authorization boundary', async () => {
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

  it('records delayed Reply TEXT from the exact group cache with both LINE ids', async () => {
    const records = new FakeRecords();
    records.cached = {
      lineMessageId: 'quoted-text-1',
      lineGroupId: 'group-1',
      lineUserId: 'line-user-2',
      text: '王先生今天收五千',
      lineTimestamp: new Date('2026-09-01T12:00:00Z'),
      expiresAt: new Date('2026-09-06T12:00:00Z'),
    };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);
    const result = await runtime.handle(message('@AFTERTRACE', {
      lineMessageId: 'command-1',
      quotedLineMessageId: 'quoted-text-1',
    }));

    expect(result.status).toBe('RECORDED');
    expect(records.quotedCalls).toBe(1);
    expect(records.lastQuotedInput).toMatchObject({
      lineMessageId: 'command-1',
      quotedLineMessageId: 'quoted-text-1',
      text: '王先生今天收五千',
    });
  });

  it('does not resolve a cached TEXT from another group', async () => {
    const records = new FakeRecords();
    records.cached = {
      lineMessageId: 'quoted-text-1',
      lineGroupId: 'other-group',
      lineUserId: 'line-user-2',
      text: '不應跨群組讀到',
      lineTimestamp: new Date('2026-09-01T12:00:00Z'),
      expiresAt: new Date('2026-09-06T12:00:00Z'),
    };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);
    const result = await runtime.handle(message('@AFTERTRACE', { quotedLineMessageId: 'quoted-text-1' }));
    expect(result.status).toBe('QUOTED_NOT_READY');
    expect(records.quotedCalls).toBe(0);
  });

  it('returns a scoped query action only when the owner plan still has group collaboration', async () => {
    const collaboration = new FakeCollaboration();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());
    await expect(runtime.handle(message('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 20,
      userId: 7,
    });
    expect(collaboration.accessCalls).toBe(1);
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
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.calls).toBe(0);
  });

  it('keeps FREE personal-only by rejecting group query links when entitlement is gone', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.accessResult = { status: 'GROUP_NOT_ENTITLED' };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());

    const result = await runtime.handle(message('@AFTERTRACE 查詢'));
    expect(result.status).toBe('REJECTED');
    if (result.status === 'REJECTED') expect(result.reason).toBe('GROUP_NOT_ENTITLED');
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.calls).toBe(0);
  });

  it('keeps cache miss on quoted content away from legacy Memory', async () => {
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), new FakeRecords());
    const result = await runtime.handle(message('@AFTERTRACE', { quotedLineMessageId: 'quoted-image-1' }));
    expect(result.status).toBe('QUOTED_NOT_READY');
  });
});
