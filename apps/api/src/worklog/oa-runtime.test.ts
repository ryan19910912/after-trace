import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import { WorklogOaRuntime, type WorklogOaAiGrantPort, type WorklogOaBootstrapPort, type WorklogOaRecordWritePort } from './oa-runtime';
import type { WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';
import type { WorklogTextNormalizationResult } from './text-normalization';

function privateMessage(textContent: string, quotedLineMessageId: string | null = null): BufferedPrivateMessage {
  return { webhookEventId: 'event-private-1', replyToken: 'reply-private-1', lineUserId: 'line-user-1', lineMessageId: 'message-private-1', quotedLineMessageId, messageType: 'text', textContent, charCount: textContent.length, quoteToken: null, lineTimestamp: new Date('2026-09-02T07:30:00+08:00'), metadata: null };
}
class FakeBootstrap implements WorklogOaBootstrapPort {
  touches = 0; follows = 0; unfollows = 0; privateBootstraps = 0; isFriend = true;
  async handleOaFollow() { this.follows += 1; this.isFriend = true; return { userId: 7, workspaceId: 8, sourceId: 9 }; }
  async handleOaUnfollow() { this.unfollows += 1; this.isFriend = false; return { userId: 7 }; }
  async touchPrivateInteraction() { this.touches += 1; return { userId: 7, lineUserId: 'line-user-1', isOaFriend: this.isFriend }; }
  async bootstrapPrivateInteraction(): Promise<PrivateBootstrapResult> { this.privateBootstraps += 1; return this.isFriend ? { status: 'READY', userId: 7, workspaceId: 8, sourceId: 9 } : { status: 'NOT_OA_FRIEND', userId: 7 }; }
}
class FakeRecords implements WorklogOaRecordWritePort {
  calls: Array<{ sourceId: number; authorUserId: number; lineMessageId: string; text: string; sourceTimestamp?: Date }> = [];
  replyTargetCalls: Array<{ sourceId: number; quotedLineMessageId: string }> = [];
  nextResult: WorklogTextRecordWriteResult = { status: 'CREATED', recordId: 101 };
  replyTargetResult: WorklogReplyEditTargetResolution = { status: 'FOUND', record: { id: 101, sourceId: 9, authorUserId: 7, entityId: 20, rawText: '王先生冷氣清潔費 3000', occurredAt: '2026-09-02T00:00:00.000Z', version: 1 } };
  async recordText(input: { sourceId: number; authorUserId: number; lineMessageId: string; text: string; sourceTimestamp?: Date }) { this.calls.push(input); return this.nextResult; }
  async resolveReplyEditTarget(sourceId: number, quotedLineMessageId: string) { this.replyTargetCalls.push({ sourceId, quotedLineMessageId }); return this.replyTargetResult; }
}
class FakeAiGrants implements WorklogOaAiGrantPort {
  calls: Array<{ userId: number; sourceId: number; at?: Date }> = [];
  constructor(public enabled = true) {}
  async canStartAi(userId: number, sourceId: number, at?: Date) { this.calls.push({ userId, sourceId, at }); return this.enabled; }
}
class FakeNormalizer {
  calls: number[] = [];
  result: WorklogTextNormalizationResult = { status: 'NORMALIZED', entityId: 20, createdEntity: false };
  async normalizeText(recordId: number) { this.calls.push(recordId); return this.result; }
}
function runtime(bootstrap = new FakeBootstrap(), records = new FakeRecords(), grants: WorklogOaAiGrantPort = new FakeAiGrants(true), normalizer = new FakeNormalizer()) {
  return new WorklogOaRuntime(bootstrap, records, normalizer, undefined, grants);
}

describe('WorklogOaRuntime 小跡 private commands', () => {
  it('keeps ordinary OA text as support traffic', async () => {
    const bootstrap = new FakeBootstrap(); const records = new FakeRecords();
    await expect(runtime(bootstrap, records).handleMessage(privateMessage('我想問一下方案'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(bootstrap.touches).toBe(1); expect(bootstrap.privateBootstraps).toBe(0); expect(records.calls).toHaveLength(0);
  });

  it('records 小跡 content with one AI preflight', async () => {
    const records = new FakeRecords(); const grants = new FakeAiGrants(true);
    await expect(runtime(new FakeBootstrap(), records, grants).handleMessage(privateMessage('小跡 王先生今天收五千'))).resolves.toEqual({ status: 'RECORDED', recordId: 101, duplicate: false, replyText: '已記錄到你的個人 AFTERTRACE。' });
    expect(grants.calls).toEqual([{ userId: 7, sourceId: 9, at: new Date('2026-09-02T07:30:00+08:00') }]);
    expect(records.calls[0]).toMatchObject({ sourceId: 9, authorUserId: 7, lineMessageId: 'message-private-1', text: '王先生今天收五千', sourceTimestamp: new Date('2026-09-02T07:30:00+08:00') });
  });

  it('does not record when AI points are zero', async () => {
    const records = new FakeRecords(); const grants = new FakeAiGrants(false);
    await expect(runtime(new FakeBootstrap(), records, grants).handleMessage(privateMessage('小跡 王先生今天收五千'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED' });
    expect(grants.calls).toHaveLength(1); expect(records.calls).toHaveLength(0);
  });

  it('requires OA friendship for 小跡 commands', async () => {
    const bootstrap = new FakeBootstrap(); bootstrap.isFriend = false;
    await expect(runtime(bootstrap).handleMessage(privateMessage('小跡 今天完成二樓維修'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'NOT_OA_FRIEND' });
  });

  it('queries deterministically without AI preflight', async () => {
    const grants = new FakeAiGrants(false);
    await expect(runtime(new FakeBootstrap(), new FakeRecords(), grants).handleMessage(privateMessage('小跡 查 晴空案收款'))).resolves.toEqual({ status: 'QUERY', sourceId: 9, userId: 7, filters: { query: '晴空案收款' } });
    expect(grants.calls).toHaveLength(0);
  });

  it('supports today, recent and help shortcuts', async () => {
    const subject = runtime(new FakeBootstrap(), new FakeRecords(), new FakeAiGrants(false));
    await expect(subject.handleMessage(privateMessage('小跡 今天'))).resolves.toMatchObject({ status: 'QUERY', sourceId: 9, userId: 7 });
    await expect(subject.handleMessage(privateMessage('小跡 最近'))).resolves.toEqual({ status: 'QUERY', sourceId: 9, userId: 7, filters: {} });
    const help = await subject.handleMessage(privateMessage('小跡 幫助'));
    expect(help.status).toBe('HELP');
    if (help.status === 'HELP') expect(help.replyText).toContain('小跡 查 晴空案收款');
  });

  it('keeps Reply edit target deterministic', async () => {
    const records = new FakeRecords();
    await expect(runtime(new FakeBootstrap(), records).handleMessage(privateMessage('小跡 幫我改成 2800'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'EDIT_TARGET_REQUIRED' });
    await expect(runtime(new FakeBootstrap(), records).handleMessage(privateMessage('小跡 幫我改成 2800', 'quoted-record-1'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'EDIT_NOT_READY' });
    expect(records.replyTargetCalls).toEqual([{ sourceId: 9, quotedLineMessageId: 'quoted-record-1' }]);
  });

  it('routes Reply 小跡 記 through quoted preflight', async () => {
    const grants = new FakeAiGrants(false);
    await expect(runtime(new FakeBootstrap(), new FakeRecords(), grants).handleMessage(privateMessage('小跡 記', 'quoted-audio-1'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED' });
    expect(grants.calls).toHaveLength(1);
  });

  it('delegates OA follow and unfollow lifecycle updates', async () => {
    const bootstrap = new FakeBootstrap(); const subject = runtime(bootstrap);
    const followed: OaLifecycleEvent = { webhookEventId: 'follow-1', lineUserId: 'line-user-1', type: 'FOLLOW', lineTimestamp: new Date('2026-09-02T07:00:00+08:00') };
    const unfollowed: OaLifecycleEvent = { webhookEventId: 'unfollow-1', lineUserId: 'line-user-1', type: 'UNFOLLOW', lineTimestamp: new Date('2026-09-02T08:00:00+08:00') };
    await expect(subject.handleLifecycle(followed)).resolves.toEqual({ status: 'FOLLOWED', userId: 7, sourceId: 9 });
    await expect(subject.handleLifecycle(unfollowed)).resolves.toEqual({ status: 'UNFOLLOWED', userId: 7 });
  });

  it('preserves already-recorded idempotency result', async () => {
    const records = new FakeRecords(); records.nextResult = { status: 'ALREADY_RECORDED', recordId: 101 };
    await expect(runtime(new FakeBootstrap(), records).handleMessage(privateMessage('小跡 王先生今天收五千'))).resolves.toMatchObject({ status: 'RECORDED', recordId: 101, duplicate: true });
  });
});
