import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import { parseWorklogCommand } from './command';
import { historyFiltersFromText, type WorklogHistoryFilters } from './history-navigation';
import type { WorklogLineRecordEditResult } from './line-record-edit';
import type {
  WorklogPrivateInputMode,
  WorklogPrivateInputModeConsumeResult,
  WorklogPrivateInputModeService,
} from './oa-input-mode';
import type { WorklogReplyEditTarget, WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';
import type { WorklogTextNormalizationResult, WorklogTextNormalizationService } from './text-normalization';

export interface WorklogOaBootstrapPort {
  handleOaFollow(input: { lineUserId: string; displayName?: string | null; at?: Date }): Promise<{ userId: number; workspaceId: number; sourceId: number }>;
  handleOaUnfollow(input: { lineUserId: string; at?: Date }): Promise<{ userId: number }>;
  touchPrivateInteraction(input: { lineUserId: string; displayName?: string | null; at?: Date }): Promise<{ userId: number; lineUserId: string; isOaFriend: boolean }>;
  bootstrapPrivateInteraction(input: { lineUserId: string; displayName?: string | null; at?: Date }): Promise<PrivateBootstrapResult>;
}

export interface WorklogOaRecordWritePort {
  recordText(input: { sourceId: number; authorUserId: number; lineMessageId: string; text: string; sourceTimestamp?: Date }): Promise<WorklogTextRecordWriteResult>;
  resolveReplyEditTarget(sourceId: number, quotedLineMessageId: string): Promise<WorklogReplyEditTargetResolution>;
}

export interface WorklogOaTextNormalizationPort {
  normalizeText(recordId: number): ReturnType<WorklogTextNormalizationService['normalizeText']>;
}

export interface WorklogOaRecordEditPort {
  edit(input: {
    target: WorklogReplyEditTarget;
    actorUserId: number;
    chargedUserId: number;
    lineCommandMessageId: string;
    quotedLineMessageId: string;
    commandTimestamp: Date;
    instruction: string;
  }): Promise<WorklogLineRecordEditResult>;
}

export interface WorklogOaAiGrantPort {
  canStartAi(userId: number, sourceId: number, at?: Date): Promise<boolean>;
}

export interface WorklogOaInputModePort {
  set(userId: number, action: WorklogPrivateInputMode, at?: Date): ReturnType<WorklogPrivateInputModeService['set']>;
  consume(userId: number, at?: Date): Promise<WorklogPrivateInputModeConsumeResult>;
}

export type WorklogOaLifecycleResult =
  | { status: 'FOLLOWED'; userId: number; sourceId: number }
  | { status: 'UNFOLLOWED'; userId: number };

export type WorklogOaRuntimeResult =
  | { status: 'NOT_HANDLED' }
  | { status: 'MODE_SELECTED'; action: WorklogPrivateInputMode; replyText: string }
  | { status: 'QUERY'; sourceId: number; userId: number; filters: WorklogHistoryFilters }
  | { status: 'RECORDED'; recordId: number; duplicate: boolean; replyText: string }
  | { status: 'EDITED'; recordId: number; recordVersion: number; replyText: string }
  | { status: 'EDIT_CONFIRMATION_PENDING'; recordId: number; confirmationId: number; replyText: string }
  | { status: 'EDIT_IN_PROGRESS'; replyText: string }
  | {
      status: 'REJECTED';
      reason:
        | 'NOT_OA_FRIEND'
        | 'GROUP_COMMAND_IN_PRIVATE'
        | 'MODE_EXPIRED'
        | 'SOURCE_NOT_FOUND'
        | 'IDEMPOTENCY_CONFLICT'
        | 'AI_POINTS_EXHAUSTED'
        | 'EDIT_TARGET_REQUIRED'
        | 'EDIT_TARGET_NOT_FOUND'
        | 'EDIT_TARGET_AMBIGUOUS'
        | 'EDIT_TARGET_DELETED'
        | 'EDIT_NOT_READY'
        | 'EDIT_RECORD_CHANGED'
        | 'EDIT_FAILED';
      replyText: string;
    };

export class WorklogOaRuntime {
  constructor(
    private readonly bootstrap: WorklogOaBootstrapPort,
    private readonly records: WorklogOaRecordWritePort,
    private readonly textNormalization: WorklogOaTextNormalizationPort | undefined,
    private readonly recordEdit: WorklogOaRecordEditPort | undefined,
    private readonly aiGrants: WorklogOaAiGrantPort | undefined,
    private readonly inputModes: WorklogOaInputModePort,
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
    const text = message.messageType === 'text' ? message.textContent?.trim() ?? '' : '';
    const selectedMode = privateInputModeSelection(text);

    if (selectedMode) {
      if (!touched.isOaFriend) return notFriend();
      await this.inputModes.set(touched.userId, selectedMode, message.lineTimestamp);
      return {
        status: 'MODE_SELECTED',
        action: selectedMode,
        replyText: selectedMode === 'RECORD'
          ? '請輸入你要記錄的事情。\n例如：晴空案今天收3000清潔費'
          : '請輸入你想查詢的內容。\n例如：晴空案目前收款進度如何',
      };
    }

    // A mode only consumes the next non-empty text message. Sticker/image/audio/file
    // events leave it intact so users do not lose the operation by accident.
    if (text) {
      const pending = await this.inputModes.consume(touched.userId, message.lineTimestamp);
      if (pending.status === 'EXPIRED') {
        return {
          status: 'REJECTED',
          reason: 'MODE_EXPIRED',
          replyText: '剛剛的操作已逾時，請重新點選「快速記錄」或「查詢紀錄」。',
        };
      }
      if (pending.status === 'ACTIVE') {
        if (!touched.isOaFriend) return notFriend();
        const personal = await this.readyPersonal(message);
        if ('status' in personal && personal.status === 'REJECTED') return personal;

        if (pending.action === 'QUERY') {
          return {
            status: 'QUERY',
            sourceId: personal.sourceId,
            userId: personal.userId,
            filters: historyFiltersFromText(text, message.lineTimestamp),
          };
        }
        return this.recordModeText(message, personal, text);
      }
    }

    // Private OA create/query no longer relies on @AFTERTRACE. Keep only the existing
    // Reply-edit command as a compatibility path until edit receives its own menu UX.
    const legacy = parseWorklogCommand(message);
    if (!legacy) return { status: 'NOT_HANDLED' };
    if (legacy.kind === 'CLAIM_GROUP') {
      return { status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE', replyText: '群組 AI 額度設定請在對應 LINE 群組內操作。' };
    }
    if (legacy.kind !== 'EDIT_REQUEST') return { status: 'NOT_HANDLED' };
    if (!touched.isOaFriend) return notFriend();

    const personal = await this.readyPersonal(message);
    if ('status' in personal && personal.status === 'REJECTED') return personal;
    return this.editPrivateRecord(message, personal, legacy.instruction, legacy.quotedLineMessageId);
  }

  private async readyPersonal(message: BufferedPrivateMessage): Promise<
    | { userId: number; sourceId: number }
    | Extract<WorklogOaRuntimeResult, { status: 'REJECTED' }>
  > {
    const personal = await this.bootstrap.bootstrapPrivateInteraction({ lineUserId: message.lineUserId, at: message.lineTimestamp });
    return personal.status === 'READY'
      ? { userId: personal.userId, sourceId: personal.sourceId }
      : notFriend();
  }

  private async recordModeText(
    message: BufferedPrivateMessage,
    personal: { userId: number; sourceId: number },
    text: string,
  ): Promise<WorklogOaRuntimeResult> {
    if (!(await this.canStartPrivateAi(personal.userId, personal.sourceId, message.lineTimestamp))) {
      return {
        status: 'REJECTED',
        reason: 'AI_POINTS_EXHAUSTED',
        replyText: '你的 AI 點數不足，這次沒有呼叫 AI；你仍可前往 AFTERTRACE 免費手動新增紀錄。',
      };
    }

    const write = await this.records.recordText({
      sourceId: personal.sourceId,
      authorUserId: personal.userId,
      lineMessageId: message.lineMessageId,
      text,
      sourceTimestamp: message.lineTimestamp,
    });
    if (write.status === 'CREATED' || write.status === 'ALREADY_RECORDED') {
      const normalization = await this.normalizeBestEffort(write.recordId, message);
      return {
        status: 'RECORDED',
        recordId: write.recordId,
        duplicate: write.status === 'ALREADY_RECORDED',
        replyText: normalizationReplyText(
          normalization,
          write.status === 'ALREADY_RECORDED' ? '這則訊息已經記錄過了。' : '已記錄到你的個人 AFTERTRACE。',
        ),
      };
    }
    if (write.status === 'IDEMPOTENCY_CONFLICT') {
      return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 訊息的紀錄狀態不一致，為避免寫錯資料，本次沒有覆蓋既有紀錄。' };
    }
    return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '你的個人 AFTERTRACE 紀錄區目前無法使用，請稍後再試。' };
  }

  private async editPrivateRecord(
    message: BufferedPrivateMessage,
    personal: { userId: number; sourceId: number },
    instruction: string,
    quotedLineMessageId: string | null,
  ): Promise<WorklogOaRuntimeResult> {
    if (!quotedLineMessageId) {
      return { status: 'REJECTED', reason: 'EDIT_TARGET_REQUIRED', replyText: '目前無法確定你要修改哪一筆紀錄，請直接 Reply 要修改的原始紀錄，或前往 AFTERTRACE 編輯。' };
    }
    const target = await this.records.resolveReplyEditTarget(personal.sourceId, quotedLineMessageId);
    if (target.status !== 'FOUND') return replyEditTargetFailure(target);
    if (!this.recordEdit) return { status: 'REJECTED', reason: 'EDIT_NOT_READY', replyText: 'LINE AI 修改服務目前尚未啟用；請先到 AFTERTRACE 紀錄頁手動編輯。' };
    if (!(await this.canStartPrivateAi(personal.userId, personal.sourceId, message.lineTimestamp))) {
      return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '你的 AI 點數不足，這次沒有呼叫 AI 修改。' };
    }
    const edited = await this.recordEdit.edit({
      target: target.record,
      actorUserId: personal.userId,
      chargedUserId: personal.userId,
      lineCommandMessageId: message.lineMessageId,
      quotedLineMessageId,
      commandTimestamp: message.lineTimestamp,
      instruction,
    });
    return privateLineEditResult(target.record.id, edited);
  }

  private async canStartPrivateAi(userId: number, sourceId: number, at: Date): Promise<boolean> {
    if (!this.aiGrants) return false;
    try { return await this.aiGrants.canStartAi(userId, sourceId, at); }
    catch { return false; }
  }

  private async normalizeBestEffort(recordId: number, message: BufferedPrivateMessage): Promise<WorklogTextNormalizationResult | null> {
    if (!this.textNormalization) return null;
    try { return await this.textNormalization.normalizeText(recordId); }
    catch (error) {
      console.error(JSON.stringify({
        event: 'worklog_text_normalization_failed_after_persist',
        source: 'PRIVATE',
        recordId,
        lineUserId: message.lineUserId,
        lineMessageId: message.lineMessageId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
      return null;
    }
  }
}

function privateInputModeSelection(text: string): WorklogPrivateInputMode | null {
  const normalized = text.replace(/^[📝✏️🔍]\s*/u, '').trim();
  if (/^(?:快速記錄|快速紀錄)$/.test(normalized)) return 'RECORD';
  if (/^(?:查詢紀錄|查詢記錄)$/.test(normalized)) return 'QUERY';
  return null;
}

function notFriend(): Extract<WorklogOaRuntimeResult, { status: 'REJECTED' }> {
  return { status: 'REJECTED', reason: 'NOT_OA_FRIEND', replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用 LINE 快速紀錄。' };
}

function normalizationReplyText(result: WorklogTextNormalizationResult | null, successText: string): string {
  if (result?.status === 'NORMALIZED' || result?.status === 'ALREADY_NORMALIZED') return successText;
  if (result?.status === 'PENDING_CONFIRMATION') return '原文已保存，AI 需要你確認紀錄標題。請到 AFTERTRACE 完成確認；不會再扣第二次 AI 點數。';
  if (result?.status === 'IN_PROGRESS') return '原文已保存，AI 標題正在安全處理中，請稍後到 AFTERTRACE 查看。';
  return '原文已保存，但 AI 標題目前尚未完成。請到 AFTERTRACE 查看或手動整理；原始紀錄不會遺失。';
}

function replyEditTargetFailure(result: Exclude<WorklogReplyEditTargetResolution, { status: 'FOUND' }>): WorklogOaRuntimeResult {
  switch (result.status) {
    case 'NOT_FOUND': return { status: 'REJECTED', reason: 'EDIT_TARGET_NOT_FOUND', replyText: '找不到你回覆的個人 AFTERTRACE 紀錄。請確認 Reply 的是原本已記錄的訊息，或前往 AFTERTRACE 編輯。' };
    case 'AMBIGUOUS': return { status: 'REJECTED', reason: 'EDIT_TARGET_AMBIGUOUS', replyText: '你回覆的 LINE 訊息目前對應到多筆有效紀錄，為避免改錯資料不會自動修改；請前往 AFTERTRACE 紀錄頁處理。' };
    case 'DELETED': return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '你回覆的個人 AFTERTRACE 紀錄目前已刪除；請先到回收桶還原，或直接在 AFTERTRACE 紀錄頁處理。' };
  }
}

function privateLineEditResult(recordId: number, result: WorklogLineRecordEditResult): WorklogOaRuntimeResult {
  switch (result.status) {
    case 'EDITED': return { status: 'EDITED', recordId, recordVersion: result.recordVersion, replyText: '已更新這筆個人 AFTERTRACE 紀錄。' };
    case 'PENDING_CONFIRMATION': return { status: 'EDIT_CONFIRMATION_PENDING', recordId, confirmationId: result.confirmationId, replyText: 'AI 已理解修改內容，但紀錄標題需要你確認。請到 AFTERTRACE 紀錄頁完成確認；不會再扣第二次 AI 點數。' };
    case 'IN_PROGRESS': return { status: 'EDIT_IN_PROGRESS', replyText: '這筆修改已在安全處理中，請稍後查看 AFTERTRACE；系統不會因重送而再次呼叫 AI。' };
    case 'AI_POINTS_EXHAUSTED': return { status: 'REJECTED', reason: 'AI_POINTS_EXHAUSTED', replyText: '你的 AI 點數不足，這次沒有呼叫 AI 修改。' };
    case 'RECORD_CHANGED':
    case 'NOT_ELIGIBLE': return { status: 'REJECTED', reason: 'EDIT_RECORD_CHANGED', replyText: '這筆紀錄在修改期間已被變更或刪除，為避免覆蓋較新的內容，本次沒有套用 AI 修改。' };
    case 'IDEMPOTENCY_CONFLICT': return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 修改指令的處理狀態不一致，為避免重複扣點或改錯資料，本次沒有再次執行 AI。' };
    case 'FAILED': return { status: 'REJECTED', reason: 'EDIT_FAILED', replyText: '這次 AI 修改沒有成功套用。原紀錄保持不變，請稍後再試或到 AFTERTRACE 手動編輯。' };
  }
}
