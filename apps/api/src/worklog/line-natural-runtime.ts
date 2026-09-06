import type { BufferedGroupMessage } from '../line/events';
import { worklogAttachmentRuntime } from './attachment-runtime';
import { parseWorklogCommand, worklogLineHelpText } from './command';
import { historyFiltersFromText } from './history-navigation';
import type { WorklogInterpretedEditService } from './interpreted-edit';
import type { WorklogInterpretedRecordService } from './interpreted-record';
import type { WorklogLineRecordActionService, WorklogLineRecordActionResult } from './line-record-actions';
import type { WorklogLineSystemQueryService } from './line-system-query';
import type {
  WorklogLineBootstrapPort,
  WorklogLineCollaborationPort,
  WorklogLineRecordWritePort,
  WorklogLineRuntimeResult,
  WorklogLineTextCachePort,
} from './line-runtime';
import type { WorklogLineNaturalInterpreterService } from './line-natural-interpreter';
import type { WorklogTextRecordWriteResult } from './records';

export class WorklogLineNaturalRuntime {
  constructor(
    private readonly bootstrap: WorklogLineBootstrapPort,
    private readonly collaboration: WorklogLineCollaborationPort,
    private readonly records: WorklogLineRecordWritePort,
    private readonly interpreter: WorklogLineNaturalInterpreterService,
    private readonly interpretedRecords: WorklogInterpretedRecordService,
    private readonly interpretedEdits: WorklogInterpretedEditService,
    private readonly recordActions: WorklogLineRecordActionService,
    private readonly systemQueries: WorklogLineSystemQueryService,
    private readonly textCache: WorklogLineTextCachePort = records,
  ) {}

  async handle(message: BufferedGroupMessage): Promise<WorklogLineRuntimeResult> {
    const command = parseWorklogCommand(message);
    if (!command) {
      await this.cacheOrdinaryTextBestEffort(message);
      return { status: 'NOT_HANDLED' };
    }
    if (!message.lineUserId) return { status: 'REJECTED', reason: 'USER_UNKNOWN', replyText: 'AFTERTRACE 無法辨識你的 LINE 使用者身分，這次沒有建立紀錄。' };
    if (command.kind === 'HELP') return { status: 'HELP', replyText: worklogLineHelpText() };

    if (command.kind === 'CLAIM_GROUP') {
      await this.bootstrap.bootstrapGroupInteraction({ lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, at: message.lineTimestamp });
      const bound = await this.bootstrap.claimGroupAiResponsibility({ lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, evidence: 'EXPLICIT_CLAIM', at: message.lineTimestamp });
      if (bound.status === 'RESPONSIBILITY_CONFLICT') return { status: 'REJECTED', reason: 'AI_RESPONSIBILITY_CONFLICT', replyText: '這個群組目前已有其他 AI 額度負責人；這次不會覆蓋既有設定。' };
      return { status: 'AI_RESPONSIBILITY_BOUND', sourceId: bound.sourceId, replyText: bound.status === 'ALREADY_BOUND' ? '你目前已是這個群組的 AI 額度負責人。' : '已完成這個群組的 AI 額度負責人設定。' };
    }

    const group = await this.bootstrap.bootstrapGroupInteraction({ lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, at: message.lineTimestamp });

    if (command.kind === 'RELEASE_GROUP') {
      const released = await this.collaboration.releaseGroupAiResponsibility({ sourceId: group.sourceId, actorUserId: group.userId, at: message.lineTimestamp });
      if (released.status === 'RELEASED') return { status: 'AI_RESPONSIBILITY_RELEASED', sourceId: released.sourceId, replyText: '已取消你在這個群組的 AI 額度負責人設定。\n\n目前這個群組沒有 AI 額度負責人。' };
      if (released.status === 'UNBOUND') return { status: 'REJECTED', reason: 'AI_RESPONSIBILITY_UNBOUND', replyText: '這個群組目前沒有 AI 額度負責人。' };
      if (released.status === 'NOT_RESPONSIBLE') return { status: 'REJECTED', reason: 'AI_RESPONSIBILITY_NOT_OWNER', replyText: '你目前不是這個群組的 AI 額度負責人，因此沒有變更設定。' };
      if (released.status === 'NOT_ACTIVE_MEMBER') return { status: 'REJECTED', reason: 'NOT_ACTIVE_MEMBER', replyText: '你目前不是這個 AFTERTRACE 群組的有效成員。' };
      return { status: 'REJECTED', reason: 'GROUP_NOT_FOUND', replyText: '找不到這個 AFTERTRACE 群組設定。' };
    }

    if (command.kind !== 'NATURAL_TEXT') return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '小跡目前無法處理這個舊版指令格式，請直接用自然語言描述你要做的事。' };

    const funding = await this.collaboration.authorizeGroupAi({ sourceId: group.sourceId, actorUserId: group.userId, at: message.lineTimestamp });
    if (funding.status !== 'OK') return rejectedAuthorization(funding.status);

    let target: Awaited<ReturnType<WorklogLineRecordActionService['resolveTarget']>> | null = null;
    let quotedText: Awaited<ReturnType<WorklogLineTextCachePort['resolve']>> = null;
    if (command.quotedLineMessageId) {
      [target, quotedText] = await Promise.all([
        this.recordActions.resolveTarget(group.sourceId, command.quotedLineMessageId),
        this.textCache.resolve(message.lineGroupId, command.quotedLineMessageId, message.lineTimestamp),
      ]);
    }

    const interpreted = await this.interpreter.interpret({
      sourceId: group.sourceId,
      actorUserId: group.userId,
      chargedUserId: funding.chargedUserId,
      text: command.text,
      referenceOccurredAt: quotedText?.lineTimestamp ?? message.lineTimestamp,
      quotedText: quotedText?.text ?? null,
      target: target?.status === 'FOUND' ? target.record : null,
    });
    if (interpreted.status === 'AI_POINTS_EXHAUSTED') return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '目前這個群組可用的 AI 點數已用完。' };
    if (interpreted.status === 'FAILED') return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '小跡這次沒有成功理解你的需求，請稍後再試。' };

    const intent = interpreted.interpretation;
    if (intent.intent === 'QUERY') {
      const access = await this.collaboration.authorizeGroupAccess({ sourceId: group.sourceId, actorUserId: group.userId });
      if (access.status !== 'OK') return rejectedAuthorization(access.status);
      return { status: 'QUERY', sourceId: group.sourceId, userId: group.userId, filters: historyFiltersFromText(intent.queryText, message.lineTimestamp) };
    }

    if (intent.intent === 'SYSTEM_QUERY') {
      return { status: 'HELP', replyText: await this.systemQueries.group({ sourceId: group.sourceId, query: intent.query, at: message.lineTimestamp }) };
    }

    if (intent.intent === 'EDIT') {
      if (!command.quotedLineMessageId || !target || target.status !== 'FOUND') return exactTargetRequired('修改');
      if (target.record.status !== 'ACTIVE') return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '這筆紀錄目前已刪除，請先還原後再修改。' };
      const result = await this.interpretedEdits.apply({
        target: target.record,
        actorUserId: group.userId,
        chargedUserId: funding.chargedUserId,
        lineCommandMessageId: message.lineMessageId,
        quotedLineMessageId: command.quotedLineMessageId,
        commandTimestamp: message.lineTimestamp,
        instruction: intent.instruction,
        output: intent.edit,
      });
      return lineEditResult(target.record.id, result);
    }

    if (intent.intent === 'DELETE' || intent.intent === 'RESTORE' || intent.intent === 'MOVE') {
      if (!command.quotedLineMessageId || !target || target.status !== 'FOUND') return exactTargetRequired(intent.intent === 'DELETE' ? '刪除' : intent.intent === 'RESTORE' ? '還原' : '移動');
      const result = intent.intent === 'DELETE'
        ? await this.recordActions.delete(target.record, group.userId)
        : intent.intent === 'RESTORE'
          ? await this.recordActions.restore(target.record, group.userId)
          : await this.recordActions.move(target.record, group.userId, intent.title);
      return recordActionResult(result, target.record.id);
    }

    if (intent.intent === 'UNKNOWN') return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: intent.reason ? `小跡還不確定你的意思：${intent.reason}` : '小跡還不確定你想記錄、查詢、修改、刪除、還原或移動哪個內容，請換個方式描述。' };

    if (command.quotedLineMessageId && !quotedText && (!target || target.status !== 'FOUND')) {
      const attachments = worklogAttachmentRuntime();
      if (attachments) {
        const result = await attachments.ingest({ sourceId: group.sourceId, actorUserId: group.userId, chargedUserId: funding.chargedUserId, commandLineMessageId: message.lineMessageId, quotedLineMessageId: command.quotedLineMessageId, sourceTimestamp: message.lineTimestamp, instruction: command.text, allowAiMedia: true });
        if (result.status === 'RECORDED') return { status: 'RECORDED', recordId: result.recordId, duplicate: result.duplicate, replyText: result.duplicate ? '這則附件已經記錄過了。' : '已記錄你回覆的附件。' };
        if (result.status === 'IN_PROGRESS') return { status: 'QUOTED_NOT_READY', replyText: '這則附件正在處理中，請稍後到 AFTERTRACE 紀錄頁查看。' };
      }
    }

    const sourceTimestamp = quotedText?.lineTimestamp ?? message.lineTimestamp;
    const write = quotedText && command.quotedLineMessageId
      ? await this.records.recordQuotedText({ sourceId: group.sourceId, authorUserId: group.userId, lineMessageId: message.lineMessageId, quotedLineMessageId: command.quotedLineMessageId, text: intent.content, sourceTimestamp })
      : await this.records.recordText({ sourceId: group.sourceId, authorUserId: group.userId, lineMessageId: message.lineMessageId, text: intent.content, sourceTimestamp });
    return this.finishInterpretedRecord(write, group.userId, intent.record);
  }

  private async finishInterpretedRecord(write: WorklogTextRecordWriteResult, actorUserId: number, output: import('./text-normalization').WorklogTextNormalizationOutput): Promise<WorklogLineRuntimeResult> {
    if (write.status === 'IDEMPOTENCY_CONFLICT') return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 訊息的紀錄狀態不一致，為避免寫錯資料，本次沒有覆蓋既有紀錄。' };
    if (write.status === 'SOURCE_NOT_FOUND') return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '這個群組目前無法建立紀錄，請稍後再試。' };
    const applied = await this.interpretedRecords.apply({ recordId: write.recordId, actorUserId, output });
    if (applied.status === 'PENDING_CONFIRMATION') return { status: 'RECORDED', recordId: write.recordId, duplicate: write.status === 'ALREADY_RECORDED', replyText: '原文已保存，AI 需要你確認紀錄標題。請到 AFTERTRACE 完成確認；這次不會再呼叫第二次 AI。' };
    if (applied.status === 'RECORD_CHANGED') return { status: 'RECORDED', recordId: write.recordId, duplicate: write.status === 'ALREADY_RECORDED', replyText: '原文已保存，但套用 AI 結果時紀錄已變更，請到 AFTERTRACE 查看。' };
    return { status: 'RECORDED', recordId: write.recordId, duplicate: write.status === 'ALREADY_RECORDED', replyText: write.status === 'ALREADY_RECORDED' ? '這則訊息已經記錄過了。' : '已記錄。' };
  }

  private async cacheOrdinaryTextBestEffort(message: BufferedGroupMessage): Promise<void> {
    if (message.messageType !== 'text' || !message.textContent) return;
    try { await this.textCache.remember({ lineMessageId: message.lineMessageId, lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, text: message.textContent, lineTimestamp: message.lineTimestamp }); }
    catch (error) { console.error(JSON.stringify({ event: 'worklog_line_text_cache_failed', lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, message: error instanceof Error ? error.message : 'unknown error' })); }
  }
}

function exactTargetRequired(action: string): WorklogLineRuntimeResult {
  return { status: 'REJECTED', reason: 'EDIT_TARGET_REQUIRED', replyText: `我知道你想${action}紀錄，但目前無法確定是哪一筆。請直接 Reply 要${action}的 AFTERTRACE 紀錄。` };
}

function recordActionResult(result: WorklogLineRecordActionResult, recordId: number): WorklogLineRuntimeResult {
  switch (result.status) {
    case 'DELETED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已刪除這筆 AFTERTRACE 紀錄；需要時可以再還原。' };
    case 'RESTORED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已還原這筆 AFTERTRACE 紀錄。' };
    case 'MOVED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已移動這筆 AFTERTRACE 紀錄到指定標題。' };
    case 'NOT_ACTIVE': return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '這筆紀錄目前不是可操作的有效紀錄。' };
    case 'NOT_DELETED': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄目前沒有被刪除，不需要還原。' };
    case 'AMBIGUOUS_TITLE': return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '要移動的標題和現有標題可能重複或太相近，請到 AFTERTRACE 選擇正確標題。' };
    case 'VERSION_CONFLICT': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄剛剛已被其他操作變更，請重新查看後再試。' };
    case 'NOT_FOUND': return { status: 'REJECTED', reason: 'EDIT_TARGET_NOT_FOUND', replyText: '找不到這筆 AFTERTRACE 紀錄。' };
  }
}

function rejectedAuthorization(status: string): WorklogLineRuntimeResult {
  switch (status) {
    case 'GROUP_NOT_FOUND': return { status: 'REJECTED', reason: 'GROUP_NOT_FOUND', replyText: '找不到這個 AFTERTRACE 群組設定。' };
    case 'GROUP_INACTIVE': return { status: 'REJECTED', reason: 'GROUP_INACTIVE', replyText: '這個 AFTERTRACE 群組目前已停用。' };
    case 'AI_RESPONSIBLE_USER_UNBOUND': return { status: 'REJECTED', reason: 'AI_RESPONSIBLE_USER_UNBOUND', replyText: '這個群組目前還沒有 AI 額度負責人，請先輸入「小跡 啟用 AI」。' };
    case 'AI_RESPONSIBLE_USER_ABSENT': return { status: 'REJECTED', reason: 'AI_RESPONSIBLE_USER_ABSENT', replyText: '目前 AI 額度負責人已不在此 LINE 群組，群組 AI 功能暫停。' };
    case 'NOT_ACTIVE_MEMBER': return { status: 'REJECTED', reason: 'NOT_ACTIVE_MEMBER', replyText: '你目前不是這個 AFTERTRACE 群組的有效成員。' };
    default: return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '目前這個群組可用的 AI 點數已用完。' };
  }
}

function lineEditResult(recordId: number, result: Awaited<ReturnType<WorklogInterpretedEditService['apply']>>): WorklogLineRuntimeResult {
  switch (result.status) {
    case 'EDITED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已更新這筆 AFTERTRACE 紀錄。' };
    case 'PENDING_CONFIRMATION': return { status: 'EDIT_CONFIRMATION_PENDING', recordId, confirmationId: result.confirmationId, replyText: 'AI 已理解修改內容，但紀錄標題需要你確認。請到 AFTERTRACE 完成確認；這次不會再呼叫第二次 AI。' };
    case 'IN_PROGRESS': return { status: 'EDIT_IN_PROGRESS', replyText: '這筆修改正在安全處理中，請稍後查看 AFTERTRACE。' };
    case 'IDEMPOTENCY_CONFLICT': return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 修改指令的處理狀態不一致，為避免改錯資料，本次沒有重複套用。' };
    case 'RECORD_CHANGED':
    case 'NOT_ELIGIBLE': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄在修改期間已被變更或刪除，本次沒有覆蓋較新的內容。' };
    case 'AI_POINTS_EXHAUSTED': return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '目前這個群組可用的 AI 點數不足。' };
    case 'FAILED': return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '這次修改沒有成功套用，原紀錄保持不變。' };
  }
}
