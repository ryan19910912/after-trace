import { describe, expect, it } from 'vitest';
import type { BufferedGroupMessage } from '../line/events';
import type { WorklogLineNaturalInterpreterService } from './line-natural-interpreter';
import { WorklogLineNaturalRuntime } from './line-natural-runtime';
import type { WorklogInterpretedRecordService } from './interpreted-record';
import type { WorklogInterpretedEditService } from './interpreted-edit';
import type { WorklogLineRecordActionService } from './line-record-actions';
import type { WorklogLineSystemQueryService } from './line-system-query';

function message(textContent: string, quotedLineMessageId: string | null = null): BufferedGroupMessage {
  return {
    webhookEventId: 'event-1', replyToken: 'reply-1', lineGroupId: 'group-1', lineMessageId: 'message-1',
    quotedLineMessageId, lineUserId: 'line-user-1', messageType: 'text', textContent, charCount: textContent.length,
    quoteToken: null, lineTimestamp: new Date('2026-09-06T10:00:00+08:00'), metadata: null,
  };
}

class FakeBootstrap {
  claimStatus: 'BOUND' | 'ALREADY_BOUND' | 'RESPONSIBILITY_CONFLICT' = 'BOUND';
  async bootstrapGroupInteraction() { return { status: 'BOUND' as const, userId: 7, sourceId: 20 }; }
  async claimGroupAiResponsibility() {
    return this.claimStatus === 'RESPONSIBILITY_CONFLICT'
      ? { status: 'RESPONSIBILITY_CONFLICT' as const, sourceId: 20 }
      : { status: this.claimStatus, sourceId: 20, responsibleUserId: 7 };
  }
}
class FakeCollaboration {
  async authorizeGroupAccess() { return { status: 'OK' as const, actorUserId: 7 }; }
  async authorizeGroupAi() { return { status: 'OK' as const, actorUserId: 7, chargedUserId: 8 }; }
  async releaseGroupAiResponsibility() { return { status: 'RELEASED' as const, sourceId: 20, previousResponsibleUserId: 7 }; }
}
class FakeRecords {
  calls: Array<{ text: string }> = [];
  async remember() {}
  async resolve() { return null; }
  async resolveReplyEditTarget() { return { status: 'NOT_FOUND' as const }; }
  async recordQuotedText(input: { text: string }) { this.calls.push({ text: input.text }); return { status: 'CREATED' as const, recordId: 99 }; }
  async recordText(input: { text: string }) { this.calls.push({ text: input.text }); return { status: 'CREATED' as const, recordId: 99 }; }
}
class FakeInterpreter {
  calls = 0;
  result: unknown = {
    status: 'INTERPRETED',
    interpretation: {
      intent: 'RECORD', content: '今天晴空案收了三千清潔費',
      record: { title: '晴空案', titleRequiresConfirmation: false, occurredAt: '2026-09-05T16:00:00.000Z', searchTerms: ['收款', '3000'] },
    },
  };
  async interpret() { this.calls += 1; return this.result; }
}
class FakeInterpretedRecords {
  calls = 0;
  async apply() { this.calls += 1; return { status: 'APPLIED' as const, entityId: 31, createdEntity: false }; }
}
class FakeInterpretedEdits {
  async apply() { return { status: 'EDITED' as const, recordVersion: 3, entityId: 31 }; }
}

const fakeRecordActions = {
  async resolveTarget() { return { status: 'NOT_FOUND' as const }; },
  async delete() { return { status: 'NOT_FOUND' as const }; },
  async restore() { return { status: 'NOT_FOUND' as const }; },
  async move() { return { status: 'NOT_FOUND' as const }; },
} as unknown as WorklogLineRecordActionService;

const fakeSystemQueries = {
  async groupStatus() { return 'AFTERTRACE 群組狀態'; },
} as unknown as WorklogLineSystemQueryService;

function runtime(interpreter = new FakeInterpreter(), records = new FakeRecords()) {
  return {
    interpreter,
    records,
    value: new WorklogLineNaturalRuntime(
      new FakeBootstrap(),
      new FakeCollaboration(),
      records,
      interpreter as unknown as WorklogLineNaturalInterpreterService,
      new FakeInterpretedRecords() as unknown as WorklogInterpretedRecordService,
      new FakeInterpretedEdits() as unknown as WorklogInterpretedEditService,
      fakeRecordActions,
      fakeSystemQueries,
    ),
  };
}

describe('WorklogLineNaturalRuntime', () => {
  it('keeps ordinary group chat outside the interpreter', async () => {
    const test = runtime();
    await expect(test.value.handle(message('大家明天九點集合'))).resolves.toEqual({ status: 'NOT_HANDLED' });
    expect(test.interpreter.calls).toBe(0);
  });

  it('keeps fixed help command provider-free', async () => {
    const test = runtime();
    const result = await test.value.handle(message('小跡 幫助'));
    expect(result.status).toBe('HELP');
    expect(test.interpreter.calls).toBe(0);
  });

  it('keeps fixed status command provider-free', async () => {
    const test = runtime();
    const result = await test.value.handle(message('小跡 狀態'));
    expect(result).toMatchObject({ status: 'HELP', replyText: 'AFTERTRACE 群組狀態' });
    expect(test.interpreter.calls).toBe(0);
  });

  it('uses one interpretation result to create and file a Record without a second provider call', async () => {
    const test = runtime();
    await expect(test.value.handle(message('小跡 幫我記一下今天晴空案收了三千清潔費'))).resolves.toMatchObject({ status: 'RECORDED', recordId: 99 });
    expect(test.interpreter.calls).toBe(1);
    expect(test.records.calls).toEqual([{ text: '今天晴空案收了三千清潔費' }]);
  });

  it('routes natural query from the same one-call interpreter result', async () => {
    const interpreter = new FakeInterpreter();
    interpreter.result = { status: 'INTERPRETED', interpretation: { intent: 'QUERY', queryText: '今天 晴空案' } };
    const test = runtime(interpreter);
    const result = await test.value.handle(message('小跡 我要查詢一下今天晴空案的內容'));
    expect(result).toMatchObject({ status: 'QUERY', sourceId: 20, userId: 7 });
    expect(interpreter.calls).toBe(1);
    if (result.status === 'QUERY') expect(result.filters.query).toBe('晴空案');
  });

  it('rejects interpreted EDIT without a deterministic Reply target', async () => {
    const interpreter = new FakeInterpreter();
    interpreter.result = {
      status: 'INTERPRETED',
      interpretation: { intent: 'EDIT', instruction: '把金額改成 2800', edit: { rawText: '晴空案收款 2800', occurredAt: null, title: null, titleRequiresConfirmation: false } },
    };
    const test = runtime(interpreter);
    await expect(test.value.handle(message('小跡 我想修改一下金額成 2800'))).resolves.toMatchObject({ status: 'REJECTED', reason: 'EDIT_TARGET_REQUIRED' });
    expect(interpreter.calls).toBe(1);
  });

  it('keeps AI responsibility controls provider-free', async () => {
    const test = runtime();
    await expect(test.value.handle(message('小跡 啟用 AI'))).resolves.toMatchObject({ status: 'AI_RESPONSIBILITY_BOUND' });
    await expect(test.value.handle(message('小跡 取消 AI'))).resolves.toMatchObject({ status: 'AI_RESPONSIBILITY_RELEASED' });
    expect(test.interpreter.calls).toBe(0);
  });
});
