import { describe, expect, it } from 'vitest';
import type { BufferedPrivateMessage } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import type { WorklogInterpretedEditService } from './interpreted-edit';
import type { WorklogInterpretedRecordService } from './interpreted-record';
import type { WorklogLineNaturalInterpreterService } from './line-natural-interpreter';
import { WorklogOaNaturalRuntime } from './oa-natural-runtime';
import type { WorklogOaAiGrantPort, WorklogOaBootstrapPort, WorklogOaRecordWritePort } from './oa-runtime';

function privateMessage(textContent: string, quotedLineMessageId: string | null = null): BufferedPrivateMessage {
  return {
    webhookEventId: 'event-private-1', replyToken: 'reply-private-1', lineUserId: 'line-user-1', lineMessageId: 'message-private-1',
    quotedLineMessageId, messageType: 'text', textContent, charCount: textContent.length, quoteToken: null,
    lineTimestamp: new Date('2026-09-06T10:00:00+08:00'), metadata: null,
  };
}
class FakeBootstrap implements WorklogOaBootstrapPort {
  isFriend = true;
  async handleOaFollow() { this.isFriend = true; return { userId: 7, workspaceId: 8, sourceId: 9 }; }
  async handleOaUnfollow() { this.isFriend = false; return { userId: 7 }; }
  async touchPrivateInteraction() { return { userId: 7, lineUserId: 'line-user-1', isOaFriend: this.isFriend }; }
  async bootstrapPrivateInteraction(): Promise<PrivateBootstrapResult> { return this.isFriend ? { status: 'READY', userId: 7, workspaceId: 8, sourceId: 9 } : { status: 'NOT_OA_FRIEND', userId: 7 }; }
}
class FakeRecords implements WorklogOaRecordWritePort {
  calls: Array<{ text: string }> = [];
  async recordText(input: { text: string }) { this.calls.push({ text: input.text }); return { status: 'CREATED' as const, recordId: 99 }; }
  async resolveReplyEditTarget() { return { status: 'NOT_FOUND' as const }; }
}
class FakeInterpreter {
  calls = 0;
  result: unknown = {
    status: 'INTERPRETED',
    interpretation: {
      intent: 'RECORD', content: '今天晴空案收了三千清潔費',
      record: { title: '晴空案', titleRequiresConfirmation: false, occurredAt: null, searchTerms: ['收款', '3000'] },
    },
  };
  async interpret() { this.calls += 1; return this.result; }
}
class FakeInterpretedRecords { async apply() { return { status: 'APPLIED' as const, entityId: 31, createdEntity: false }; } }
class FakeInterpretedEdits { async apply() { return { status: 'EDITED' as const, recordVersion: 3, entityId: 31 }; } }
class FakeGrants implements WorklogOaAiGrantPort { async canStartAi() { return true; } }

function runtime(interpreter = new FakeInterpreter(), bootstrap = new FakeBootstrap(), records = new FakeRecords()) {
  return {
    interpreter, bootstrap, records,
    value: new WorklogOaNaturalRuntime(
      bootstrap,
      records,
      interpreter as unknown as WorklogLineNaturalInterpreterService,
      new FakeInterpretedRecords() as unknown as WorklogInterpretedRecordService,
      new FakeInterpretedEdits() as unknown as WorklogInterpretedEditService,
      new FakeGrants(),
    ),
  };
}

describe('WorklogOaNaturalRuntime', () => {
  it('keeps ordinary OA chat outside 小跡 processing', async () => {
    const test = runtime();
    await expect(test.value.handleMessage(privateMessage('你好'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(test.interpreter.calls).toBe(0);
  });

  it('keeps help provider-free', async () => {
    const test = runtime();
    const result = await test.value.handleMessage(privateMessage('小跡 幫助'));
    expect(result.status).toBe('HELP');
    expect(test.interpreter.calls).toBe(0);
  });

  it('uses one interpretation result for private Record create', async () => {
    const test = runtime();
    await expect(test.value.handleMessage(privateMessage('小跡 幫我記一下今天晴空案收了三千清潔費'))).resolves.toMatchObject({ status: 'RECORDED', recordId: 99 });
    expect(test.interpreter.calls).toBe(1);
    expect(test.records.calls).toEqual([{ text: '今天晴空案收了三千清潔費' }]);
  });

  it('routes natural query without creating a Record', async () => {
    const interpreter = new FakeInterpreter();
    interpreter.result = { status: 'INTERPRETED', interpretation: { intent: 'QUERY', queryText: '今天 晴空案' } };
    const test = runtime(interpreter);
    const result = await test.value.handleMessage(privateMessage('小跡 我要查詢一下今天晴空案'));
    expect(result).toMatchObject({ status: 'QUERY', sourceId: 9, userId: 7 });
    expect(test.records.calls).toHaveLength(0);
  });

  it('rejects GROUP AI responsibility controls in OA without provider use', async () => {
    const test = runtime();
    await expect(test.value.handleMessage(privateMessage('小跡 啟用 AI'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE' });
    await expect(test.value.handleMessage(privateMessage('小跡 取消 AI'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE' });
    expect(test.interpreter.calls).toBe(0);
  });

  it('requires OA friendship before natural-language provider work', async () => {
    const bootstrap = new FakeBootstrap(); bootstrap.isFriend = false;
    const test = runtime(new FakeInterpreter(), bootstrap);
    await expect(test.value.handleMessage(privateMessage('小跡 幫我查晴空案'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'NOT_OA_FRIEND' });
    expect(test.interpreter.calls).toBe(0);
  });
});
