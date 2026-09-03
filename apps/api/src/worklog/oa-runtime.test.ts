import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import { WorklogOaRuntime, type WorklogOaBootstrapPort, type WorklogOaRecordWritePort } from './oa-runtime';
import type { WorklogTextRecordWriteResult } from './records';

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
  public nextResult: WorklogTextRecordWriteResult = { status: 'CREATED', recordId: 101 };

  async recordText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
  }): Promise<WorklogTextRecordWriteResult> {
    this.calls.push(input);
    return this.nextResult;
  }
}

describe('WorklogOaRuntime', () => {
  it('keeps ordinary OA text as human-support traffic while touching last interaction', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(bootstrap, records);

    await expect(runtime.handleMessage(privateMessage('我想問一下方案'))).resolves.toEqual({
      status: 'NOT_HANDLED',
    });
    expect(bootstrap.touches).toBe(1);
    expect(bootstrap.privateBootstraps).toBe(0);
    expect(records.calls).toHaveLength(0);
  });

  it('persists explicit private text records to the OA-friend personal source', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(bootstrap, records);

    await expect(runtime.handleMessage(privateMessage('@AFTERTRACE 王先生今天收五千'))).resolves.toEqual({
      status: 'RECORDED',
      recordId: 101,
      duplicate: false,
      replyText: '已記錄到你的個人 AFTERTRACE。',
    });
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

  it('rejects explicit private product commands when OA friendship state is inactive', async () => {
    const bootstrap = new FakeBootstrap();
    bootstrap.isFriend = false;
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(bootstrap, records);

    const result = await runtime.handleMessage(privateMessage('@AFTERTRACE 今天完成二樓維修'));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'NOT_OA_FRIEND' });
    expect(bootstrap.privateBootstraps).toBe(0);
    expect(records.calls).toHaveLength(0);
  });

  it('returns a scoped personal query target without recording', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(bootstrap, records);

    await expect(runtime.handleMessage(privateMessage('@AFTERTRACE 查詢'))).resolves.toEqual({
      status: 'QUERY',
      sourceId: 9,
      userId: 7,
      filters: {},
    });
    expect(records.calls).toHaveLength(0);
  });

  it('converts strong natural-language history requests into deterministic filters instead of a new Record', async () => {
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(new FakeBootstrap(), records);

    await expect(runtime.handleMessage(privateMessage('@AFTERTRACE 王大明這週做了什麼'))).resolves.toEqual({
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

  it('never persists an obvious edit request as a new Record', async () => {
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(new FakeBootstrap(), records);

    await expect(runtime.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_TARGET_REQUIRED',
    });
    await expect(runtime.handleMessage(privateMessage('@AFTERTRACE 幫我改成 2800', 'quoted-record-1'))).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'EDIT_NOT_READY',
    });
    expect(records.calls).toHaveLength(0);
  });

  it('does not allow group ownership commands in private OA chat', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(bootstrap, records);

    const result = await runtime.handleMessage(privateMessage('@AFTERTRACE 啟用'));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE' });
    expect(bootstrap.privateBootstraps).toBe(0);
    expect(records.calls).toHaveLength(0);
  });

  it('intercepts quoted private recording until the new content-fetch path is ready', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    const runtime = new WorklogOaRuntime(bootstrap, records);

    const result = await runtime.handleMessage(privateMessage('@AFTERTRACE', 'quoted-audio-1'));
    expect(result.status).toBe('QUOTED_NOT_READY');
    expect(records.calls).toHaveLength(0);
  });

  it('delegates OA follow and unfollow lifecycle updates', async () => {
    const bootstrap = new FakeBootstrap();
    const runtime = new WorklogOaRuntime(bootstrap, new FakeRecords());
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

    await expect(runtime.handleLifecycle(followed)).resolves.toEqual({
      status: 'FOLLOWED',
      userId: 7,
      sourceId: 9,
    });
    await expect(runtime.handleLifecycle(unfollowed)).resolves.toEqual({
      status: 'UNFOLLOWED',
      userId: 7,
    });
    expect(bootstrap.follows).toBe(1);
    expect(bootstrap.unfollows).toBe(1);
  });

  it('preserves TEXT idempotency result in private OA flow', async () => {
    const bootstrap = new FakeBootstrap();
    const records = new FakeRecords();
    records.nextResult = { status: 'ALREADY_RECORDED', recordId: 101 };
    const runtime = new WorklogOaRuntime(bootstrap, records);

    await expect(runtime.handleMessage(privateMessage('@AFTERTRACE 王先生今天收五千'))).resolves.toMatchObject({
      status: 'RECORDED',
      recordId: 101,
      duplicate: true,
    });
  });
});
