import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import { worklogAttachmentRuntime } from './attachment-runtime';
import { isWorklogStatusCommand, parseWorklogOaCommand, worklogLineHelpText } from './command';
import { historyFiltersFromText } from './history-navigation';
import type { WorklogInterpretedEditService } from './interpreted-edit';
import type { WorklogInterpretedRecordService } from './interpreted-record';
import type { WorklogLineNaturalInterpreterService } from './line-natural-interpreter';
import type { WorklogLineRecordActionService, WorklogLineRecordActionResult } from './line-record-actions';
import type { WorklogLineSystemQueryService } from './line-system-query';
import type {
  WorklogOaAiGrantPort,
  WorklogOaBootstrapPort,
  WorklogOaLifecycleResult,
  WorklogOaRecordWritePort,
  WorklogOaRuntimeResult,
} from './oa-runtime';
import type { WorklogTextRecordWriteResult } from './records';

export class WorklogOaNaturalRuntime {
  constructor(
    private readonly bootstrap: WorklogOaBootstrapPort,
    private readonly records: WorklogOaRecordWritePort,
    private readonly interpreter: WorklogLineNaturalInterpreterService,
    private readonly interpretedRecords: WorklogInterpretedRecordService,
    private readonly interpretedEdits: WorklogInterpretedEditService,
    private readonly recordActions: WorklogLineRecordActionService,
    private readonly systemQueries: WorklogLineSystemQueryService,
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

    if (isWorklogStatusCommand(message)) {
      const personal = await this.bootstrap.bootstrapPrivateInteraction({ lineUserId: message.lineUserId, at: message.lineTimestamp });
      if (personal.status !== 'READY') return notFriend();
      return { status: 'HELP', replyText: await this.systemQueries.personalStatus({ userId: personal.userId, sourceId: personal.sourceId, at: message.lineTimestamp }) };
    }

    if (command.kind === 'HELP') return { status: 'HELP', replyText: worklogLineHelpText() };
    if (command.kind === 'CLAIM_GROUP' || command.kind === 'RELEASE_GROUP') {
      return { status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE', replyText: '「啟用 AI / 取消 AI」是 LINE 群組設定，請在對應群組內操作。' };
    }
    if (command.kind !== 'NATURAL_TEXT') return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '小跡目前無法處理這個舊版指令格式，請直接用自然語言描述你要做的事。' };

    const personal = await this.bootstrap.bootstrapPrivateInteraction({ lineUserId: message.lineUserId, at: message.lineTimestamp });
    if (personal.status !== 'READY') return notFriend();
    if (!(await this.safeCanStartAi(personal.userId, personal.sourceId, message.lineTimestamp))) {
      return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '你的 AI 點數不足，這次沒有呼叫 AI；你仍可前往 AFTERTRACE 免費手動新增、查詢或編輯紀錄。' };
    }

    let target: Awaited<ReturnType<WorklogLineRecordActionService['resolveTarget']>> | null = null;
    if (command.quotedLineMessageId) target = await this.recordActions.resolveTarget(personal.sourceId, command.quotedLineMessageId);

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
    if (intent.intent === 'QUERY') return { status: 'QUERY', sourceId: personal.sourceId, userId: personal.userId, filters: historyFiltersFromText(intent.queryText, message.lineTimestamp) };

    if (intent.intent === 'EDIT') {
      if (!command.quotedLineMessageId || !target || target.status !== 'FOUND') return exactTargetRequired('修改');
      if (target.record.status !== 'ACTIVE') return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '這筆紀錄目前已刪除，請先還原後再修改。' };
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

    if (intent.intent === 'DELETE' || intent.intent === 'RESTORE' || intent.intent === 'MOVE') {
      if (!command.quotedLineMessageId || !target || target.status !== 'FOUND') return exactTargetRequired(intent.intent === 'DELETE' ? '刪除' : intent.intent === 'RESTORE' ? '還原' : '移動');
      const result = intent.intent === 'DELETE'
        ? await this.recordActions.delete(target.record, personal.userId)
        : intent.intent === 'RESTORE'
          ? await this.recordActions.restore(target.record, personal.userId)
          : await this.recordActions.move(target.record, personal.userId, intent.title);
      return recordActionResult(result, target.record.id);
    }

    if (intent.intent === 'UNKNOWN') return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: intent.reason ? `小跡還不確定你的意思：${intent.reason}` : '小跡還不確定你想記錄、查詢、修改、刪除、還原或移動哪個內容，請換個方式描述。' };

    if (command.quotedLineMessageId && (!target || target.status !== 'FOUND')) {
      const attachments = worklogAttachmentRuntime();
      if (attachments) {
        const result = await attachments.ingest({ sourceId: personal.sourceId, actorUserId: personal.userId, chargedUserId: personal.userId, commandLineMessageId: message.lineMessageId, quotedLineMessageId: command.quotedLineMessageId, sourceTimestamp: message.lineTimestamp, instruction: command.text });
        if (result.status === 'RECORDED') return { status: 'RECORDED', recordId: result.recordId, duplicate: result.duplicate, replyText: result.duplicate ? '這則附件已經記錄過了。' : '已記錄到你的個人 AFTERTRACE。' };
        if (result.status === 'IN_PROGRESS') return { status: 'QUOTED_NOT_READY', replyText: '這則附件正在處理中，請稍後到 AFTERTRACE 查看。' };
      }
    }

    const write = await this.records.recordText({ sourceId: personal.sourceId, authorUserId: personal.userId, lineMessageId: message.lineMessageId, text: intent.content, sourceTimestamp: message.lineTimestamp });
    return this.finishInterpretedRecord(write, personal.userId, intent.record);
  }

  private async finishInterpretedRecord(write: WorklogTextRecordWriteResult, actorUserId: number, output: import('./text-normalization').WorklogTextNormalizationOutput): Promise<WorklogOaRuntimeResult> {
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

function exactTargetRequired(action: string): WorklogOaRuntimeResult {
  return { status: 'REJECTED', reason: 'EDIT_TARGET_REQUIRED', replyText: `我知道你想${action}紀錄，但目前無法確定是哪一筆。請直接 Reply 要${action}的 AFTERTRACE 紀錄。` };
}

function recordActionResult(result: WorklogLineRecordActionResult, recordId: number): WorklogOaRuntimeResult {
  switch (result.status) {
    case 'DELETED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已刪除這筆個人 AFTERTRACE 紀錄；需要時可以再還原。' };
    case 'RESTORED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已還原這筆個人 AFTERTRACE 紀錄。' };
    case 'MOVED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已移動這筆個人 AFTERTRACE 紀錄到指定標題。' };
    case 'NOT_ACTIVE': return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '這筆紀錄目前不是可操作的有效紀錄。' };
    case 'NOT_DELETED': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄目前沒有被刪除，不需要還原。' };
    case 'AMBIGUOUS_TITLE': return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '要移動的標題和現有標題可能重複或太相近，請到 AFTERTRACE 選擇正確標題。' };
    case 'VERSION_CONFLICT': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄剛剛已被其他操作變更，請重新查看後再試。' };
    case 'NOT_FOUND': return { status: 'REJECTED', reason: 'EDIT_TARGET_NOT_FOUND', replyText: '找不到這筆個人 AFTERTRACE 紀錄。' };
  }
}

function notFriend(): Extract<WorklogOaRuntimeResult, { status: 'REJECTED' }> {
  return { status: 'REJECTED', reason: 'NOT_OA_FRIEND', replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用小跡。' };
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
