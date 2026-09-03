import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import type { WorklogAttachmentIngestionService } from './attachment-ingestion';
import { configureWorklogAttachmentRuntime } from './attachment-runtime';
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
  };
  result: GroupRecordAuthorizationResult = {
    status: 'OK',
    actorUserId: 7,
    chargedUserId: 7,
    ownerPlanCode: 'SUB1',
    ownerCapabilities: {
      aiTextRecording: true,
      aiMediaIngestion: true,
    },
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

class FakeNormalizer {
  calls: number[] = [];

  async normalizeText(recordId: number) {
    this.calls.push(recordId);
    return { status: 'NORMALIZED' as const, entityId: 71, createdEntity: false };
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

  it('keeps the transitional unowned group state until AI responsible-user bootstrap is replaced', async () => {
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

  it('supports the transitional explicit AI responsible-user claim command', async () => {
    const bootstrap = new FakeBootstrap();
    const runtime = new WorklogLineRuntime(bootstrap, new FakeCollaboration(), new FakeRecords());

    const result = await runtime.handle(message('@AFTERTRACE 啟用'));
    expect(result.status).toBe('OWNER_BOUND');
    expect(bootstrap.bootstrapCalls).toBe(1);
    expect(bootstrap.bindCalls).toBe(1);
  });

  it('blocks a member before LINE AI record persistence when legacy funding authorization denies recording', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.result = { status: 'RECORDING_DISABLED' };
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records);

    const result = await runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'));
    expect(result.status).toBe('REJECTED');
    if (result.status === 'REJECTED') expect(result.reason).toBe('RECORDING_DISABLED');
    expect(records.calls).toBe(0);
  });

  it('persists raw TEXT first and lets the post-persist interpreter own provider preflight', async () => {
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

  it('does not invoke text interpretation when the transitional capability disables AI text', async () => {
    const collaboration = new FakeCollaboration();
    if (collaboration.result.status === 'OK') {
      collaboration.result.ownerCapabilities.aiTextRecording = false;
    }
    const records = new FakeRecords();
    const normalizer = new FakeNormalizer();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records, normalizer);

    await expect(runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 99,
    });
    expect(records.calls).toBe(1);
    expect(normalizer.calls).toEqual([]);
  });

  it('runs one-title/time interpretation for group TEXT when AI text is enabled', async () => {
    const normalizer = new FakeNormalizer();
    const runtime = new WorklogLineRuntime(
      new FakeBootstrap(),
      new FakeCollaboration(),
      new FakeRecords(),
      normalizer,
    );

    await runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'));
    expect(normalizer.calls).toEqual([99]);
  });

  it('passes disabled AI media capability into attachment ingestion', async () => {
    const collaboration = new FakeCollaboration();
    if (collaboration.result.status === 'OK') {
      collaboration.result.ownerCapabilities.aiMediaIngestion = false;
    }
    const calls: Array<{ allowAiMedia?: boolean }> = [];
    configureWorklogAttachmentRuntime({
      ingest: async (input: { allowAiMedia?: boolean }) => {
        calls.push(input);
        return { status: 'FAILED' as const, reason: 'AI_MEDIA_DISABLED' };
      },
    } as unknown as WorklogAttachmentIngestionService);

    try {
      const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());
      const result = await runtime.handle(message('@AFTERTRACE', {
        lineMessageId: 'command-media-1',
        quotedLineMessageId: 'quoted-media-1',
      }));
      expect(result.status).toBe('REJECTED');
      if (result.status === 'REJECTED') expect(result.reason).toBe('AI_MEDIA_DISABLED');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ allowAiMedia: false });
    } finally {
      configureWorklogAttachmentRuntime(null);
    }
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

  it('returns the group query action from active-member manual access without a plan gate', async () => {
    const collaboration = new FakeCollaboration();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());
    await expect(runtime.handle(message('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 20,
      userId: 7,
      filters: {},
    });
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.calls).toBe(0);
  });

  it('routes strong natural-language history to deterministic PWA filters without persisting a Record', async () => {
    const collaboration = new FakeCollaboration();
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records);

    await expect(runtime.handle(message('@AFTERTRACE 王大明這週做了什麼', {
      lineTimestamp: new Date('2026-09-04T03:30:00+08:00'),
    }))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 20,
      userId: 7,
      filters: {
        query: '王大明',
        from: '2026-08-30T16:00:00.000Z',
        to: '2026-09-06T16:00:00.000Z',
      },
    });
    expect(records.calls).toBe(0);
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.calls).toBe(0);
  });

  it('does not persist obvious edit commands and requires a reliable Reply target', async () => {
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);

    await expect(runtime.handle(message('@AFTERTRACE 幫我改成 2800'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_TARGET_REQUIRED',
    });
    await expect(runtime.handle(message('@AFTERTRACE 幫我改成 2800', {
      quotedLineMessageId: 'quoted-record-1',
    }))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_NOT_READY',
    });
    expect(records.calls).toBe(0);
    expect(records.quotedCalls).toBe(0);
  });

  it('does not let legacy recording permission remove historical query access', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.result = { status: 'RECORDING_DISABLED' };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());

    await expect(runtime.handle(message('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 20,
      userId: 7,
      filters: {},
    });
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.calls).toBe(0);
  });

  it('denies a group query when the actor is not an active member', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.accessResult = { status: 'NOT_ACTIVE_MEMBER' };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, new FakeRecords());

    const result = await runtime.handle(message('@AFTERTRACE 查詢'));
    expect(result.status).toBe('REJECTED');
    if (result.status === 'REJECTED') expect(result.reason).toBe('NOT_ACTIVE_MEMBER');
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.calls).toBe(0);
  });

  it('keeps cache miss on quoted content away from retired conversation Memory', async () => {
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), new FakeRecords());
    const result = await runtime.handle(message('@AFTERTRACE', { quotedLineMessageId: 'quoted-image-1' }));
    expect(result.status).toBe('QUOTED_NOT_READY');
  });
});
