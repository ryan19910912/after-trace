import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import {
  WorklogOaRuntime,
  type WorklogOaAiGrantPort,
  type WorklogOaBootstrapPort,
  type WorklogOaRecordWritePort,
} from './oa-runtime';
import type { WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';

function privateMessage(textContent: string, quotedLineMessageId: string | null = null): BufferedPrivateMessage {
  return {
    webhookEventId: 'event-private-1',
    replyToken: 'reply-private-1',
    lineUserId: 'line-user-1',
    lineMessageId: 'message-private-1',
    quotedLineMessageId,
    messageType: 'text',
    textContent,
    charCount: textContent.length,
    quoteToken: null,
    lineTimestamp: new Date('2026-09-02T07:30:00+08:00'),
    metadata: null,
  };
}

class FakeBootstrap implements WorklogOaBootstrapPort {
  public touches = 0;
  public follows = 0;
  public unfollows = 0;
  public privateBootstraps = 0;
  public isFriend = true;

  async handleOaFollow(): Promise<{ userId: number; workspaceId: number; sourceId: number }> {
    this.follows += 1;
    this.isFriend = true;
    return { userId: 7, workspaceId: 8, sourceId: 9 };
  }

  async handleOaUnfollow(): Promise<{ userId: number }> {
    this.unfollows += 1;
    this.isFriend = false;
    return { userId: 7 };
  }

  async touchPrivateInteraction(): Promise<{ userId: number; lineUserId: string; isOaFriend: boolean }> {
    this.touches += 1;
    return { userId: 7, lineUserId: 'line-user-1', isOaFriend: this.isFriend };
  }

  async bootstrapPrivateInteraction(): Promise<PrivateBootstrapResult> {
    this.privateBootstraps += 1;
    return this.isFriend
      ? { status: 'READY', userId: 7, workspaceId: 8, sourceId: 9 }
      : { status: 'NOT_OA_FRIEND', userId: 7 };
  }
}

class FakeRecords implements WorklogOaRecordWritePort {
  public calls: Array<{
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
  }> = [];
  public replyTargetCalls: Array<{ sourceId: number; quotedLineMessageId: string }> = [];
  public nextResult: WorklogTextRecordWriteResult = { status: 'CREATED', recordId: 101 };
  public replyTargetResult: WorklogReplyEditTargetResolution = {
    status: 'FOUND',
    record: {
      id: 101,
      sourceId: 9,
      authorUserId: 7,
      entityId: 20,
      rawText: '王先生冷氣清潔費 3000',
      occurredAt: '2026-09-02T00:00:00.000Z',
      version: 1,
    },
  };

  async recordText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
  }): Promise<WorklogTextRecordWriteResult> {
    this.calls.push(input);
    return this.nextResult;
  }

  async resolveReplyEditTarget(sourceId: number, quotedLineMessageId: string) {
    this.replyTargetCalls.push({ sourceId, quotedLineMessageId });
    return this.replyTargetResult;
  }
}

class FakeAiGrants implements WorklogOaAiGrantPort {
  public calls: Array<{ userId: number; sourceId: number; at?: Date }> = [];
  constructor(public enabled = true) {}

  async canStartAi(userId: number, sourceId: number, at?: Date): Promise<boolean> {
    this.calls.push({ userId, sourceId, at });
    return this.enabled;
  }
}

function runtime(
  bootstrap = new FakeBootstrap(),
  records = new FakeRecords(),
  aiGrants: WorklogOaAiGrantPort = new FakeAiGrants(true),
) {
  return new WorklogOaRuntime(bootstrap, records, undefined, undefined, aiGrants);
}

describe('WorklogOaRuntime', () => {
  it('keeps ordinary OA text as human-support traffic while touching last interaction', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const subject = runtime(bootstrap, records);

    await expect(subject.handleMessage(privateMessage('我想問一下方案'))).resolves.toEqual({
      status: 'NOT_HANDLED',
    });
    expect(bootstrap.touches).toBe(1);
    expect(bootstrap.privateBootstraps).toBe(0);
    expect(records.calls).toHaveLength(0);
  });

  it('persists explicit private text records only after positive private AI grant preflight', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const grants = new FakeAiGrants(true);
    const subject = runtime(bootstrap, records, grants);

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 王先生今天收五千'))).resolves.toEqual({
      status: 'RECORDED',
      recordId: 101,
      duplicate: false,
      replyText: '已記錄到你的個人 AFTERTRACE。',
    });
    expect(grants.calls).toEqual([{ userId: 7, sourceId: 9, at: new Date('2026-09-02T07:30:00+08:00') }]);
    expect(bootstrap.privateBootstraps).toBe(1);
    expect(records.calls).toEqual([
      {
        sourceId: 9,
        authorUserId: 7,
        lineMessageId: 'message-private-1',
        text: '王先生今天收五千',
        sourceTimestamp: new Date('2026-09-02T07:30:00+08:00'),
      },
    ]);
  });

  it('does not persist private AI CREATE when eligible points are zero at request start', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const grants = new FakeAiGrants(false);
    const subject = runtime(bootstrap, records, grants);

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 王先生今天收五千'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'AI_POINTS_EXHAUSTED',
    });
    expect(grants.calls).toHaveLength(1);
    expect(records.calls).toHaveLength(0);
  });

  it('rejects explicit private product commands when OA friendship state is inactive', async () => {
    const bootstrap = new FakeBootstrap();
    bootstrap.isFriend = false;
    const records = new FakeRecords();
    const subject = runtime(bootstrap, records);

    const result = await subject.handleMessage(privateMessage('@AFTERTRACE 今天完成二樓維修'));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'NOT_OA_FRIEND' });
    expect(bootstrap.privateBootstraps).toBe(0);
    expect(records.calls).toHaveLength(0);
  });

  it('returns a scoped personal query target without consuming AI eligibility', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const grants = new FakeAiGrants(false);
    const subject = runtime(bootstrap, records, grants);

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 9,
      userId: 7,
      filters: {},
    });
    expect(grants.calls).toHaveLength(0);
    expect(records.calls).toHaveLength(0);
  });

  it('converts strong natural-language history requests into deterministic filters instead of a new Record', async () => {
    const records = new FakeRecords();
    const subject = runtime(new FakeBootstrap(), records, new FakeAiGrants(false));

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 王大明這週做了什麼'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 9,
      userId: 7,
      filters: {
        query: '王大明',
        from: '2026-08-30T16:00:00.000Z',
        to: '2026-09-06T16:00:00.000Z',
      },
    });
    expect(records.calls).toHaveLength(0);
  });

  it('never persists an obvious edit request and resolves its Reply only inside the personal Source', async () => {
    const records = new FakeRecords();
    const subject = runtime(new FakeBootstrap(), records);

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_TARGET_REQUIRED',
    });
    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800', 'quoted-record-1'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_NOT_READY',
    });
    expect(records.replyTargetCalls).toEqual([{ sourceId: 9, quotedLineMessageId: 'quoted-record-1' }]);
    expect(records.calls).toHaveLength(0);
  });

  it('resolves a valid private edit target before zero-point rejection', async () => {
    const records = new FakeRecords();
    const grants = new FakeAiGrants(false);
    const edit = {
      calls: 0,
      async edit() {
        this.calls += 1;
        return { status: 'FAILED', reason: 'should-not-run' } as const;
      },
    };
    const subject = new WorklogOaRuntime(new FakeBootstrap(), records, undefined, edit, grants);

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800', 'quoted-record-1'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'AI_POINTS_EXHAUSTED',
    });
    expect(records.replyTargetCalls).toEqual([{ sourceId: 9, quotedLineMessageId: 'quoted-record-1' }]);
    expect(grants.calls).toHaveLength(1);
    expect(edit.calls).toBe(0);
  });

  it('refuses private Reply edits when the target is missing, ambiguous or deleted', async () => {
    const records = new FakeRecords();
    const subject = runtime(new FakeBootstrap(), records);

    records.replyTargetResult = { status: 'NOT_FOUND' };
    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800', 'missing'))).resolves.toMatchObject({ reason: 'EDIT_TARGET_NOT_FOUND' });
    records.replyTargetResult = { status: 'AMBIGUOUS' };
    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800', 'ambiguous'))).resolves.toMatchObject({ reason: 'EDIT_TARGET_AMBIGUOUS' });
    records.replyTargetResult = { status: 'DELETED' };
    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800', 'deleted'))).resolves.toMatchObject({ reason: 'EDIT_TARGET_DELETED' });

    expect(records.calls).toHaveLength(0);
  });

  it('does not allow group ownership commands in private OA chat', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const subject = runtime(bootstrap, records);

    const result = await subject.handleMessage(privateMessage('@AFTERTRACE 啟用'));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE' });
    expect(bootstrap.privateBootstraps).toBe(0);
    expect(records.calls).toHaveLength(0);
  });

  it('intercepts quoted private recording after positive AI grant preflight until content-fetch runtime is ready', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const grants = new FakeAiGrants(true);
    const subject = runtime(bootstrap, records, grants);

    const result = await subject.handleMessage(privateMessage('@AFTERTRACE', 'quoted-audio-1'));
    expect(result.status).toBe('QUOTED_NOT_READY');
    expect(grants.calls).toHaveLength(1);
    expect(records.calls).toHaveLength(0);
  });

  it('rejects quoted private recording before attachment runtime when points are zero', async () => {
    const records = new FakeRecords();
    const subject = runtime(new FakeBootstrap(), records, new FakeAiGrants(false));

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE', 'quoted-audio-1'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'AI_POINTS_EXHAUSTED',
    });
    expect(records.calls).toHaveLength(0);
  });

  it('delegates OA follow and unfollow lifecycle updates', async () => {
    const bootstrap = new FakeBootstrap();
    const subject = runtime(bootstrap, new FakeRecords());
    const followed: OaLifecycleEvent = {
      webhookEventId: 'follow-1',
      lineUserId: 'line-user-1',
      type: 'FOLLOW',
      lineTimestamp: new Date('2026-09-02T07:00:00+08:00'),
    };
    const unfollowed: OaLifecycleEvent = {
      webhookEventId: 'unfollow-1',
      lineUserId: 'line-user-1',
      type: 'UNFOLLOW',
      lineTimestamp: new Date('2026-09-02T08:00:00+08:00'),
    };

    await expect(subject.handleLifecycle(followed)).resolves.toEqual({
      status: 'FOLLOWED',
      userId: 7,
      sourceId: 9,
    });
    await expect(subject.handleLifecycle(unfollowed)).resolves.toEqual({
      status: 'UNFOLLOWED',
      userId: 7,
    });
    expect(bootstrap.follows).toBe(1);
    expect(bootstrap.unfollows).toBe(1);
  });

  it('preserves TEXT idempotency result in private OA flow after AI grant preflight', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    records.nextResult = { status: 'ALREADY_RECORDED', recordId: 101 };
    const subject = runtime(bootstrap, records);

    await expect(subject.handleMessage(privateMessage('@AFTERTRACE 王先生今天收五千'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 101,
      duplicate: true,
    });
  });
});
