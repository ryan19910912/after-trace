import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import { worklogAttachmentRuntime } from './attachment-runtime';
import { parseWorklogOaCommand, worklogLineHelpText } from './command';
import { historyFiltersFromText } from './history-navigation';
import type { WorklogInterpretedEditService } from './interpreted-edit';
import type { WorklogInterpretedRecordService } from './interpreted-record';
import type { WorklogLineNaturalInterpreterService } from './line-natural-interpreter';
import type {
  WorklogOaAiGrantPort,
  WorklogOaBootstrapPort,
  WorklogOaLifecycleResult,
  WorklogOaRecordWritePort,
  WorklogOaRuntimeResult,
} from './oa-runtime';
import type { WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';

export class WorklogOaNaturalRuntime {
  constructor(
    private readonly bootstrap: WorklogOaBootstrapPort,
    private readonly records: WorklogOaRecordWritePort,
    private readonly interpreter: WorklogLineNaturalInterpreterService,
    private readonly interpretedRecords: WorklogInterpretedRecordService,
    private readonly interpretedEdits: WorklogInterpretedEditService,
    private readonly aiGrants: WorklogOaAiGrantPort,
  ) {}

  async handleLifecycle(event: OaLifecycleEvent): Promise<WorklogOaLifecycleResult> {
    if (event.type === 'FOLLOW') {
      const followed = await this.bootstrap.handleOaFollow({ lineUserId: event.lineUserId, at: event.lineTimestamp });
      return { status: 'FOLLOWED', userId: followed.userId, sourceId: followed.sourceId };
    }
    const unfollowed = await this.bootstrap.handleOaUnfollow({ lineUserId: event.lineUserId, at: event.lineTimestamp });
    return { status: 'UNFOLLOWED', userId: unfollowed.userId };
  }

  async handleMessage(message: BufferedPrivateMessage): Promise<WorklogOaRuntimeResult> {
    const touched = await this.bootstrap.touchPrivateInteraction({ lineUserId: message.lineUserId, at: message.lineTimestamp });
    const command = parseWorklogOaCommand(message);
    if (!command) return { status: 'NOT_HANDLED' };
    if (!touched.isOaFriend) return notFriend();
    if (command.kind === 'HELP') return { status: 'HELP', replyText: worklogLineHelpText() };
    if (command.kind === 'CLAIM_GROUP' || command.kind === 'RELEASE_GROUP') {
      return { status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE', replyText: '「啟用 AI / 取消 AI」是 LINE 群組設定，請在對應群組內操作。' };
    }
    if (command.kind !== 'NATURAL_TEXT') {
      return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '小跡目前無法處理這個舊版指令格式，請直接用自然語言描述你要做的事。' };
    }

    const personal = await this.bootstrap.bootstrapPrivateInteraction({ lineUserId: message.lineUserId, at: message.lineTimestamp });
    if (personal.status !== 'READY') return notFriend();
    if (!(await this.safeCanStartAi(personal.userId, personal.sourceId, message.lineTimestamp))) {
      return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '你的 AI 點數不足，這次沒有呼叫 AI；你仍可前往 AFTERTRACE 免費手動新增、查詢或編輯紀錄。' };
    }

    let target: WorklogReplyEditTargetResolution | null = null;
    if (command.quotedLineMessageId) target = await this.records.resolveReplyEditTarget(personal.sourceId, command.quotedLineMessageId);

    const interpreted = await this.interpreter.interpret({
      sourceId: personal.sourceId,
      actorUserId: personal.userId,
      chargedUserId: personal.userId,
      text: command.text,
      referenceOccurredAt: message.lineTimestamp,
      quotedText: null,
      target: target?.status === 'FOUND' ? target.record : null,
    });
    if (interpreted.status === 'AI_POINTS_EXHAUSTED') return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '你的 AI 點數不足，這次沒有呼叫 AI。' };
    if (interpreted.status === 'FAILED') return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '小跡這次沒有成功理解你的需求，請稍後再試。' };

    const intent = interpreted.interpretation;
    if (intent.intent === 'QUERY') {
      return { status: 'QUERY', sourceId: personal.sourceId, userId: personal.userId, filters: historyFiltersFromText(intent.queryText, message.lineTimestamp) };
    }

    if (intent.intent === 'EDIT') {
      if (!command.quotedLineMessageId) return { status: 'REJECTED', reason: 'EDIT_TARGET_REQUIRED', replyText: '我知道你想修改紀錄，但目前無法確定是哪一筆。請直接 Reply 要修改的 AFTERTRACE 紀錄。' };
      if (!target || target.status !== 'FOUND') return replyEditTargetFailure(target);
      const result = await this.interpretedEdits.apply({
        target: target.record,
        actorUserId: personal.userId,
        chargedUserId: personal.userId,
        lineCommandMessageId: message.lineMessageId,
        quotedLineMessageId: command.quotedLineMessageId,
        commandTimestamp: message.lineTimestamp,
        instruction: intent.instruction,
        output: intent.edit,
      });
      return privateLineEditResult(target.record.id, result);
    }

    if (intent.intent === 'UNKNOWN') {
      return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: intent.reason ? `小跡還不確定你的意思：${intent.reason}` : '小跡還不確定你想記錄、查詢還是修改，請換個方式描述。' };
    }

    if (command.quotedLineMessageId && (!target || target.status !== 'FOUND')) {
      const attachments = worklogAttachmentRuntime();
      if (attachments) {
        const result = await attachments.ingest({
          sourceId: personal.sourceId,
          actorUserId: personal.userId,
          chargedUserId: personal.userId,
          commandLineMessageId: message.lineMessageId,
          quotedLineMessageId: command.quotedLineMessageId,
          sourceTimestamp: message.lineTimestamp,
          instruction: command.text,
        });
        if (result.status === 'RECORDED') return { status: 'RECORDED', recordId: result.recordId, duplicate: result.duplicate, replyText: result.duplicate ? '這則附件已經記錄過了。' : '已記錄到你的個人 AFTERTRACE。' };
        if (result.status === 'IN_PROGRESS') return { status: 'QUOTED_NOT_READY', replyText: '這則附件正在處理中，請稍後到 AFTERTRACE 查看。' };
      }
    }

    const write = await this.records.recordText({
      sourceId: personal.sourceId,
      authorUserId: personal.userId,
      lineMessageId: message.lineMessageId,
      text: intent.content,
      sourceTimestamp: message.lineTimestamp,
    });
    return this.finishInterpretedRecord(write, personal.userId, intent.record);
  }

  private async finishInterpretedRecord(
    write: WorklogTextRecordWriteResult,
    actorUserId: number,
    output: import('./text-normalization').WorklogTextNormalizationOutput,
  ): Promise<WorklogOaRuntimeResult> {
    if (write.status === 'IDEMPOTENCY_CONFLICT') return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 訊息的紀錄狀態不一致，為避免寫錯資料，本次沒有覆蓋既有紀錄。' };
    if (write.status === 'SOURCE_NOT_FOUND') return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '你的個人 AFTERTRACE 紀錄區目前無法使用，請稍後再試。' };
    const applied = await this.interpretedRecords.apply({ recordId: write.recordId, actorUserId, output });
    if (applied.status === 'PENDING_CONFIRMATION') return { status: 'RECORDED', recordId: write.recordId, duplicate: write.status === 'ALREADY_RECORDED', replyText: '原文已保存，AI 需要你確認紀錄標題。請到 AFTERTRACE 完成確認；這次不會再呼叫第二次 AI。' };
    if (applied.status === 'RECORD_CHANGED') return { status: 'RECORDED', recordId: write.recordId, duplicate: write.status === 'ALREADY_RECORDED', replyText: '原文已保存，但套用 AI 結果時紀錄已變更，請到 AFTERTRACE 查看。' };
    return { status: 'RECORDED', recordId: write.recordId, duplicate: write.status === 'ALREADY_RECORDED', replyText: write.status === 'ALREADY_RECORDED' ? '這則訊息已經記錄過了。' : '已記錄到你的個人 AFTERTRACE。' };
  }

  private async safeCanStartAi(userId: number, sourceId: number, at: Date): Promise<boolean> {
    try { return await this.aiGrants.canStartAi(userId, sourceId, at); } catch { return false; }
  }
}

function notFriend(): Extract<WorklogOaRuntimeResult, { status: 'REJECTED' }> {
  return { status: 'REJECTED', reason: 'NOT_OA_FRIEND', replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用小跡。' };
}
function replyEditTargetFailure(result: WorklogReplyEditTargetResolution | null): WorklogOaRuntimeResult {
  if (!result || result.status === 'NOT_FOUND') return { status: 'REJECTED', reason: 'EDIT_TARGET_NOT_FOUND', replyText: '找不到你回覆的個人 AFTERTRACE 紀錄。請 Reply 原本已記錄的訊息，或前往 AFTERTRACE 編輯。' };
  if (result.status === 'AMBIGUOUS') return { status: 'REJECTED', reason: 'EDIT_TARGET_AMBIGUOUS', replyText: '你回覆的 LINE 訊息目前對應到多筆有效紀錄，為避免改錯資料，請前往 AFTERTRACE 處理。' };
  if (result.status === 'DELETED') return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '你回覆的個人 AFTERTRACE 紀錄目前已刪除；請先到回收桶還原。' };
  return { status: 'REJECTED', reason: 'EDIT_TARGET_NOT_FOUND', replyText: '找不到要修改的紀錄。' };
}
function privateLineEditResult(recordId: number, result: Awaited<ReturnType<WorklogInterpretedEditService['apply']>>): WorklogOaRuntimeResult {
  switch (result.status) {
    case 'EDITED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已更新這筆個人 AFTERTRACE 紀錄。' };
    case 'PENDING_CONFIRMATION': return { status: 'EDIT_CONFIRMATION_PENDING', recordId, confirmationId: result.confirmationId, replyText: 'AI 已理解修改內容，但紀錄標題需要你確認。請到 AFTERTRACE 完成確認；這次不會再呼叫第二次 AI。' };
    case 'IN_PROGRESS': return { status: 'EDIT_IN_PROGRESS', replyText: '這筆修改正在安全處理中，請稍後查看 AFTERTRACE。' };
    case 'IDEMPOTENCY_CONFLICT': return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 修改指令的處理狀態不一致，本次沒有重複套用。' };
    case 'RECORD_CHANGED':
    case 'NOT_ELIGIBLE': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄在修改期間已被變更或刪除，本次沒有覆蓋較新的內容。' };
    case 'AI_POINTS_EXHAUSTED': return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '你的 AI 點數不足。' };
    case 'FAILED': return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '這次修改沒有成功套用，原紀錄保持不變。' };
  }
}
