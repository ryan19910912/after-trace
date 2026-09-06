import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import {
  WorklogOaRuntime,
  type WorklogOaAiGrantPort,
  type WorklogOaBootstrapPort,
  type WorklogOaInputModePort,
  type WorklogOaRecordWritePort,
} from './oa-runtime';
import type { WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';
import type { WorklogTextNormalizationResult } from './text-normalization';

function message(textContent: string | null, messageType = 'text', at = '2026-09-06T13:00:00+08:00'): BufferedPrivateMessage {
  return {
    webhookEventId: 'event-1',
    replyToken: 'reply-1',
    lineUserId: 'line-user-1',
    lineMessageId: `message-${messageType}-${textContent ?? 'none'}`,
    quotedLineMessageId: null,
    messageType,
    textContent,
    charCount: textContent?.length ?? 0,
    quoteToken: null,
    lineTimestamp: new Date(at),
    metadata: null,
  };
}

class Bootstrap implements WorklogOaBootstrapPort {
  async handleOaFollow() { return { userId: 7, workspaceId: 8, sourceId: 9 }; }
  async handleOaUnfollow() { return { userId: 7 }; }
  async touchPrivateInteraction() { return { userId: 7, lineUserId: 'line-user-1', isOaFriend: true }; }
  async bootstrapPrivateInteraction(): Promise<PrivateBootstrapResult> {
    return { status: 'READY', userId: 7, workspaceId: 8, sourceId: 9 };
  }
}

class Modes implements WorklogOaInputModePort {
  action: 'RECORD' | 'QUERY' | null = null;
  expired = false;
  sets: Array<'RECORD' | 'QUERY'> = [];
  consumes = 0;

  async set(_userId: number, action: 'RECORD' | 'QUERY') {
    this.action = action;
    this.sets.push(action);
  }

  async consume() {
    this.consumes += 1;
    if (this.expired) {
      this.expired = false;
      this.action = null;
      return { status: 'EXPIRED' as const };
    }
    const action = this.action;
    this.action = null;
    return action ? { status: 'ACTIVE' as const, action } : { status: 'NONE' as const };
  }
}

class Records implements WorklogOaRecordWritePort {
  calls: Array<{ text: string; sourceTimestamp?: Date }> = [];
  async recordText(input: { text: string; sourceTimestamp?: Date }): Promise<WorklogTextRecordWriteResult> {
    this.calls.push({ text: input.text, sourceTimestamp: input.sourceTimestamp });
    return { status: 'CREATED', recordId: 101 };
  }
  async resolveReplyEditTarget(): Promise<WorklogReplyEditTargetResolution> { return { status: 'NOT_FOUND' }; }
}

class Grants implements WorklogOaAiGrantPort {
  calls = 0;
  async canStartAi() { this.calls += 1; return true; }
}

class Normalizer {
  async normalizeText(): Promise<WorklogTextNormalizationResult> {
    return { status: 'NORMALIZED', entityId: 20, createdEntity: false };
  }
}

function subject(modes: Modes, records = new Records(), grants = new Grants()) {
  return {
    runtime: new WorklogOaRuntime(new Bootstrap(), records, new Normalizer(), undefined, grants, modes),
    records,
    grants,
  };
}

describe('WorklogOaRuntime Rich Menu input modes', () => {
  it('sets RECORD mode and treats the next text as the exact Record input', async () => {
    const modes = new Modes();
    const { runtime, records, grants } = subject(modes);

    await expect(runtime.handleMessage(message('快速記錄'))).resolves.toMatchObject({
      status: 'MODE_SELECTED',
      action: 'RECORD',
    });
    await expect(runtime.handleMessage(message('晴空案今天收3000清潔費'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 101,
    });

    expect(modes.sets).toEqual(['RECORD']);
    expect(records.calls).toEqual([{
      text: '晴空案今天收3000清潔費',
      sourceTimestamp: new Date('2026-09-06T13:00:00+08:00'),
    }]);
    expect(grants.calls).toBe(1);
    expect(modes.action).toBeNull();
  });

  it('sets QUERY mode and routes the next text to deterministic history without AI preflight', async () => {
    const modes = new Modes();
    const { runtime, records, grants } = subject(modes);

    await runtime.handleMessage(message('查詢紀錄'));
    await expect(runtime.handleMessage(message('晴空案目前收款進度如何'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 9,
      userId: 7,
      filters: { query: '晴空案目前收款進度如何' },
    });
    expect(records.calls).toHaveLength(0);
    expect(grants.calls).toBe(0);
  });

  it('does not consume a pending text mode when a sticker arrives', async () => {
    const modes = new Modes();
    const { runtime, records } = subject(modes);

    await runtime.handleMessage(message('快速記錄'));
    await expect(runtime.handleMessage(message(null, 'sticker'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(modes.consumes).toBe(0);
    await runtime.handleMessage(message('晴空案完成清潔'));
    expect(records.calls).toHaveLength(1);
  });

  it('fails clearly when the pending mode expired and does not create a Record', async () => {
    const modes = new Modes();
    const { runtime, records } = subject(modes);

    await runtime.handleMessage(message('快速記錄'));
    modes.expired = true;
    await expect(runtime.handleMessage(message('晴空案完成清潔'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'MODE_EXPIRED',
    });
    expect(records.calls).toHaveLength(0);
  });
});
