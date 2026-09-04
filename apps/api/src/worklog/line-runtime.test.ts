import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import type { WorklogAttachmentIngestionService } from './attachment-ingestion';
import type { GroupAiAuthorizationResult } from './ai-responsibility';
import { configureWorklogAttachmentRuntime } from './attachment-runtime';
import type { GroupAiResponsibilityBindResult, GroupBootstrapResult } from './bootstrap';
import type { GroupAccessAuthorizationResult } from './collaboration';
import type { WorklogLineRecordEditResult } from './line-record-edit';
import type { CachedLineText } from './line-text-cache';
import { WorklogLineRuntime } from './line-runtime';
import type { WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';

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
  group: GroupBootstrapResult = { status: 'BOUND', userId: 7, sourceId: 20 };
  claim: GroupAiResponsibilityBindResult = { status: 'BOUND', sourceId: 20, responsibleUserId: 7 };
  bootstrapCalls = 0;
  claimCalls = 0;

  async bootstrapGroupInteraction() {
    this.bootstrapCalls += 1;
    return this.group;
  }

  async claimGroupAiResponsibility() {
    this.claimCalls += 1;
    return this.claim;
  }
}

class FakeCollaboration {
  accessResult: GroupAccessAuthorizationResult = { status: 'OK', actorUserId: 7 };
  aiResult: GroupAiAuthorizationResult = { status: 'OK', actorUserId: 7, chargedUserId: 8 };
  accessCalls = 0;
  aiCalls = 0;

  async authorizeGroupAccess() {
    this.accessCalls += 1;
    return this.accessResult;
  }

  async authorizeGroupAi() {
    this.aiCalls += 1;
    return this.aiResult;
  }
}

class FakeRecords {
  result: WorklogTextRecordWriteResult = { status: 'CREATED', recordId: 99 };
  replyTargetResult: WorklogReplyEditTargetResolution = {
    status: 'FOUND',
    record: {
      id: 77,
      sourceId: 20,
      authorUserId: 7,
      entityId: 31,
      rawText: '王先生冷氣清潔費 3000',
      occurredAt: '2026-09-02T00:00:00.000Z',
      version: 2,
    },
  };
  calls = 0;
  quotedCalls = 0;
  replyTargetCalls: Array<{ sourceId: number; quotedLineMessageId: string }> = [];
  remembered: Array<{ lineMessageId: string; lineGroupId: string; lineUserId: string | null; text: string }> = [];
  cached: CachedLineText | null = null;
  lastQuotedInput: { lineMessageId: string; quotedLineMessageId: string; text: string } | null = null;

  async remember(input: {
    lineMessageId: string;
    lineGroupId: string;
    lineUserId: string | null;
    text: string;
  }) {
    this.remembered.push(input);
  }

  async resolve(lineGroupId: string, lineMessageId: string) {
    if (!this.cached) return null;
    return this.cached.lineGroupId === lineGroupId && this.cached.lineMessageId === lineMessageId
      ? this.cached
      : null;
  }

  async resolveReplyEditTarget(sourceId: number, quotedLineMessageId: string) {
    this.replyTargetCalls.push({ sourceId, quotedLineMessageId });
    return this.replyTargetResult;
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

class FakeEdit {
  result: WorklogLineRecordEditResult = { status: 'EDITED', recordVersion: 3, entityId: 31 };
  calls: Array<{
    recordId: number;
    actorUserId: number;
    chargedUserId: number;
    quotedLineMessageId: string;
    instruction: string;
  }> = [];

  async edit(input: {
    target: { id: number };
    actorUserId: number;
    chargedUserId: number;
    quotedLineMessageId: string;
    instruction: string;
  }) {
    this.calls.push({
      recordId: input.target.id,
      actorUserId: input.actorUserId,
      chargedUserId: input.chargedUserId,
      quotedLineMessageId: input.quotedLineMessageId,
      instruction: input.instruction,
    });
    return this.result;
  }
}

describe('WorklogLineRuntime', () => {
  it('temporarily caches ordinary GROUP text without bootstrapping, funding or Record persistence', async () => {
    const bootstrap = new FakeBootstrap();
    const collaboration = new FakeCollaboration();
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(bootstrap, collaboration, records);

    await expect(runtime.handle(message('王先生今天收五千'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(bootstrap.bootstrapCalls).toBe(0);
    expect(collaboration.accessCalls).toBe(0);
    expect(collaboration.aiCalls).toBe(0);
    expect(records.calls).toBe(0);
    expect(records.remembered[0]).toMatchObject({
      lineMessageId: 'message-1',
      lineGroupId: 'group-1',
      lineUserId: 'line-user-1',
      text: '王先生今天收五千',
    });
  });

  it('does not cache ordinary non-text messages', async () => {
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);
    await runtime.handle(message('', { messageType: 'image', textContent: null, charCount: 0 }));
    expect(records.remembered).toHaveLength(0);
  });

  it('claims GROUP AI responsibility without mutating Source ownership', async () => {
    const bootstrap = new FakeBootstrap();
    const runtime = new WorklogLineRuntime(bootstrap, new FakeCollaboration(), new FakeRecords());

    await expect(runtime.handle(message('@AFTERTRACE 啟用'))).resolves.toMatchObject({
      status: 'AI_RESPONSIBILITY_BOUND',
      sourceId: 20,
    });
    expect(bootstrap.bootstrapCalls).toBe(1);
    expect(bootstrap.claimCalls).toBe(1);
  });

  it('fails a conflicting AI responsibility claim without overwriting the current responsible user', async () => {
    const bootstrap = new FakeBootstrap();
    bootstrap.claim = { status: 'RESPONSIBILITY_CONFLICT', sourceId: 20 };
    const runtime = new WorklogLineRuntime(bootstrap, new FakeCollaboration(), new FakeRecords());

    await expect(runtime.handle(message('@AFTERTRACE 啟用'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'AI_RESPONSIBILITY_CONFLICT',
    });
  });

  it('lets HISTORY use free active-member access without checking AI points', async () => {
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
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.aiCalls).toBe(0);
    expect(records.calls).toBe(0);
  });

  it('rejects AI CREATE before persistence when no eligible scoped Grant can fund the GROUP', async () => {
    const collaboration = new FakeCollaboration();
    collaboration.aiResult = { status: 'AI_POINTS_EXHAUSTED' };
    const records = new FakeRecords();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records);

    await expect(runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'AI_POINTS_EXHAUSTED',
    });
    expect(records.calls).toBe(0);
  });

  it('persists raw CREATE then invokes one-title/time interpretation', async () => {
    const records = new FakeRecords();
    const normalizer = new FakeNormalizer();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records, normalizer);

    await expect(runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 99,
      duplicate: false,
    });
    expect(records.calls).toBe(1);
    expect(normalizer.calls).toEqual([99]);
  });

  it('treats LINE redelivery of the same CREATE as an idempotent duplicate', async () => {
    const records = new FakeRecords();
    records.result = { status: 'ALREADY_RECORDED', recordId: 99 };
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), records);

    await expect(runtime.handle(message('@AFTERTRACE 王先生二樓漏水已修復'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 99,
      duplicate: true,
    });
  });

  it('records delayed Reply text only from the exact GROUP cache', async () => {
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

    await expect(runtime.handle(message('@AFTERTRACE', {
      lineMessageId: 'command-1',
      quotedLineMessageId: 'quoted-text-1',
    }))).resolves.toMatchObject({ status: 'RECORDED', recordId: 99 });
    expect(records.lastQuotedInput).toMatchObject({
      lineMessageId: 'command-1',
      quotedLineMessageId: 'quoted-text-1',
      text: '王先生今天收五千',
    });
  });

  it('does not resolve delayed Reply text from another GROUP cache', async () => {
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

  it('uses deterministic same-Source Reply target before GROUP AI funding for EDIT', async () => {
    const records = new FakeRecords();
    const collaboration = new FakeCollaboration();
    const edit = new FakeEdit();
    const runtime = new WorklogLineRuntime(
      new FakeBootstrap(),
      collaboration,
      records,
      undefined,
      edit,
    );

    await expect(runtime.handle(message('@AFTERTRACE 幫我改成 2800', {
      lineMessageId: 'edit-command-1',
      quotedLineMessageId: 'record-message-1',
    }))).resolves.toMatchObject({ status: 'EDITED', recordId: 77, recordVersion: 3 });
    expect(records.replyTargetCalls).toEqual([{ sourceId: 20, quotedLineMessageId: 'record-message-1' }]);
    expect(collaboration.accessCalls).toBe(1);
    expect(collaboration.aiCalls).toBe(1);
    expect(edit.calls).toEqual([{
      recordId: 77,
      actorUserId: 7,
      chargedUserId: 8,
      quotedLineMessageId: 'record-message-1',
      instruction: '幫我改成 2800',
    }]);
  });

  it('does not check AI funding when EDIT Reply target is absent or invalid', async () => {
    const records = new FakeRecords();
    const collaboration = new FakeCollaboration();
    const runtime = new WorklogLineRuntime(new FakeBootstrap(), collaboration, records, undefined, new FakeEdit());

    await expect(runtime.handle(message('@AFTERTRACE 幫我改成 2800'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_TARGET_REQUIRED',
    });
    expect(collaboration.aiCalls).toBe(0);

    records.replyTargetResult = { status: 'NOT_FOUND' };
    await expect(runtime.handle(message('@AFTERTRACE 幫我改成 2800', {
      quotedLineMessageId: 'missing-record',
    }))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_TARGET_NOT_FOUND',
    });
    expect(collaboration.aiCalls).toBe(0);
  });

  it('passes the responsible user as chargedUserId into attachment ingestion', async () => {
    const calls: Array<{ chargedUserId?: number; allowAiMedia?: boolean }> = [];
    configureWorklogAttachmentRuntime({
      ingest: async (input: { chargedUserId?: number; allowAiMedia?: boolean }) => {
        calls.push(input);
        return { status: 'RECORDED' as const, recordId: 55, duplicate: false };
      },
    } as unknown as WorklogAttachmentIngestionService);

    try {
      const runtime = new WorklogLineRuntime(new FakeBootstrap(), new FakeCollaboration(), new FakeRecords());
      const result = await runtime.handle(message('@AFTERTRACE', {
        lineMessageId: 'command-media-1',
        quotedLineMessageId: 'quoted-media-1',
      }));
      expect(result.status).toBe('RECORDED');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ chargedUserId: 8, allowAiMedia: true });
    } finally {
      configureWorklogAttachmentRuntime(null);
    }
  });
});
