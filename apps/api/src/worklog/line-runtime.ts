import type { BufferedGroupMessage } from '../line/events';
import type { GroupAiAuthorizationResult } from './ai-responsibility';
import { worklogAttachmentRuntime } from './attachment-runtime';
import type { GroupBootstrapResult, GroupOwnerBindResult } from './bootstrap';
import type { GroupAccessAuthorizationResult } from './collaboration';
import { parseWorklogCommand } from './command';
import { historyFiltersFromText, type WorklogHistoryFilters } from './history-navigation';
import type { WorklogLineRecordEditResult } from './line-record-edit';
import type { WorklogLineTextCacheService } from './line-text-cache';
import type {
  WorklogReplyEditTarget,
  WorklogReplyEditTargetResolution,
  WorklogTextRecordWriteResult,
} from './records';
import type { WorklogTextNormalizationService } from './text-normalization';

export interface WorklogLineBootstrapPort {
  bootstrapGroupInteraction(input: {
    lineGroupId: string;
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<GroupBootstrapResult>;
  bindGroupOwner(input: {
    lineGroupId: string;
    ownerLineUserId: string;
    ownerDisplayName?: string | null;
    evidence: 'RELIABLE_JOIN_ACTOR' | 'EXPLICIT_CLAIM';
    at?: Date;
  }): Promise<GroupOwnerBindResult>;
}

export interface WorklogLineCollaborationPort {
  authorizeGroupAccess(input: {
    sourceId: number;
    actorUserId: number;
  }): Promise<GroupAccessAuthorizationResult>;
  authorizeGroupAi(input: {
    sourceId: number;
    actorUserId: number;
    at?: Date;
  }): Promise<GroupAiAuthorizationResult>;
}

export interface WorklogLineTextCachePort {
  remember(input: {
    lineMessageId: string;
    lineGroupId: string;
    lineUserId: string | null;
    text: string;
    lineTimestamp: Date;
  }): ReturnType<WorklogLineTextCacheService['remember']>;
  resolve(
    lineGroupId: string,
    quotedLineMessageId: string,
    now?: Date,
  ): ReturnType<WorklogLineTextCacheService['resolve']>;
}

export interface WorklogLineRecordWritePort extends WorklogLineTextCachePort {
  recordText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult>;
  recordQuotedText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    quotedLineMessageId: string;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult>;
  resolveReplyEditTarget(
    sourceId: number,
    quotedLineMessageId: string,
  ): Promise<WorklogReplyEditTargetResolution>;
}

export interface WorklogLineTextNormalizationPort {
  normalizeText(recordId: number): ReturnType<WorklogTextNormalizationService['normalizeText']>;
}

export interface WorklogLineRecordEditPort {
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

export type WorklogLineRuntimeResult =
  | { status: 'NOT_HANDLED' }
  | { status: 'QUERY'; sourceId: number; userId: number; filters: WorklogHistoryFilters }
  | { status: 'RECORDED'; recordId: number; duplicate: boolean; replyText: string }
  | { status: 'EDITED'; recordId: number; recordVersion: number; replyText: string }
  | { status: 'EDIT_CONFIRMATION_PENDING'; recordId: number; confirmationId: number; replyText: string }
  | { status: 'EDIT_IN_PROGRESS'; replyText: string }
  | { status: 'OWNER_BOUND'; sourceId: number; replyText: string }
  | { status: 'QUOTED_NOT_READY'; replyText: string }
  | {
      status: 'REJECTED';
      reason:
        | 'USER_UNKNOWN'
        | 'OWNER_CONFLICT'
        | 'GROUP_NOT_FOUND'
        | 'GROUP_INACTIVE'
        | 'AI_RESPONSIBLE_USER_UNBOUND'
        | 'AI_RESPONSIBLE_USER_ABSENT'
        | 'NOT_ACTIVE_MEMBER'
        | 'AI_POINTS_EXHAUSTED'
        | 'AI_MEDIA_DISABLED'
        | 'SOURCE_NOT_FOUND'
        | 'IDEMPOTENCY_CONFLICT'
        | 'ATTACHMENT_FAILED'
        | 'EDIT_TARGET_REQUIRED'
        | 'EDIT_TARGET_NOT_FOUND'
        | 'EDIT_TARGET_AMBIGUOUS'
        | 'EDIT_TARGET_DELETED'
        | 'EDIT_NOT_READY'
        | 'EDIT_RECORD_CHANGED'
        | 'EDIT_FAILED';
      replyText: string;
    };

export class WorklogLineRuntime {
  constructor(
    private readonly bootstrap: WorklogLineBootstrapPort,
    private readonly collaboration: WorklogLineCollaborationPort,
    private readonly records: WorklogLineRecordWritePort,
    private readonly textNormalization?: WorklogLineTextNormalizationPort,
    private readonly recordEdit?: WorklogLineRecordEditPort,
    private readonly textCache: WorklogLineTextCachePort = records,
  ) {}

  async handle(message: BufferedGroupMessage): Promise<WorklogLineRuntimeResult> {
    const command = parseWorklogCommand(message);
    if (!command) {
      await this.cacheOrdinaryTextBestEffort(message);
      return { status: 'NOT_HANDLED' };
    }
    if (!message.lineUserId) {
      return {
        status: 'REJECTED',
        reason: 'USER_UNKNOWN',
        replyText: 'AFTERTRACE 無法辨識你的 LINE 使用者身分，這次沒有建立紀錄。',
      };
    }

    if (command.kind === 'CLAIM_GROUP') {
      await this.bootstrap.bootstrapGroupInteraction({
        lineGroupId: message.lineGroupId,
        lineUserId: message.lineUserId,
        at: message.lineTimestamp,
      });
      const bound = await this.bootstrap.bindGroupOwner({
        lineGroupId: message.lineGroupId,
        ownerLineUserId: message.lineUserId,
        evidence: 'EXPLICIT_CLAIM',
        at: message.lineTimestamp,
      });
      if (bound.status === 'OWNER_CONFLICT') {
        return {
          status: 'REJECTED',
          reason: 'OWNER_CONFLICT',
          replyText: '這個群組目前已有其他 AI 額度負責人；這次不會覆蓋既有設定。',
        };
      }
      return {
        status: 'OWNER_BOUND',
        sourceId: bound.sourceId,
        replyText: bound.status === 'ALREADY_BOUND'
          ? '你目前已是這個群組的 AI 額度負責人。'
          : '已完成這個群組的 AI 額度負責人設定。',
      };
    }

    const group = await this.bootstrap.bootstrapGroupInteraction({
      lineGroupId: message.lineGroupId,
      lineUserId: message.lineUserId,
      at: message.lineTimestamp,
    });

    if (command.kind === 'QUERY') {
      const access = await this.collaboration.authorizeGroupAccess({
        sourceId: group.sourceId,
        actorUserId: group.userId,
      });
      if (access.status !== 'OK') return rejectedAuthorization(access);
      return {
        status: 'QUERY',
        sourceId: group.sourceId,
        userId: group.userId,
        filters: historyFiltersFromText(command.naturalText, message.lineTimestamp),
      };
    }

    if (command.kind === 'EDIT_REQUEST') {
      if (!command.quotedLineMessageId) {
        return {
          status: 'REJECTED',
          reason: 'EDIT_TARGET_REQUIRED',
          replyText: '目前無法確定你要修改哪一筆紀錄，請直接 Reply 要修改的原始紀錄，或前往 AFTERTRACE 編輯。',
        };
      }
      const access = await this.collaboration.authorizeGroupAccess({
        sourceId: group.sourceId,
        actorUserId: group.userId,
      });
      if (access.status !== 'OK') return rejectedAuthorization(access);

      const target = await this.records.resolveReplyEditTarget(
        group.sourceId,
        command.quotedLineMessageId,
      );
      if (target.status !== 'FOUND') return replyEditTargetFailure(target);
      if (!this.recordEdit) {
        return {
          status: 'REJECTED',
          reason: 'EDIT_NOT_READY',
          replyText: 'LINE AI 修改服務目前尚未啟用；請先到 AFTERTRACE 紀錄頁手動編輯。',
        };
      }

      // Resolve the deterministic same-Source target before checking AI funding.
      // The edit service then performs its own positive Grant reservation immediately
      // before provider execution so no provider call can start on a zero balance.
      const funding = await this.collaboration.authorizeGroupAi({
        sourceId: group.sourceId,
        actorUserId: group.userId,
        at: message.lineTimestamp,
      });
      if (funding.status !== 'OK') return rejectedAuthorization(funding);

      const edited = await this.recordEdit.edit({
        target: target.record,
        actorUserId: group.userId,
        chargedUserId: funding.chargedUserId,
        lineCommandMessageId: message.lineMessageId,
        quotedLineMessageId: command.quotedLineMessageId,
        commandTimestamp: message.lineTimestamp,
        instruction: command.instruction,
      });
      return lineEditResult(target.record.id, edited);
    }

    // CREATE / attachment are AI-assisted LINE operations. Manual PWA CRUD/history
    // never passes through this check. Positive eligible scoped Grant balance is the
    // only customer AI allowance gate at this layer.
    const authorization = await this.collaboration.authorizeGroupAi({
      sourceId: group.sourceId,
      actorUserId: group.userId,
      at: message.lineTimestamp,
    });
    if (authorization.status !== 'OK') return rejectedAuthorization(authorization);

    if (command.kind === 'RECORD_QUOTED') {
      const cached = await this.textCache.resolve(
        message.lineGroupId,
        command.quotedLineMessageId,
        message.lineTimestamp,
      );
      if (cached) {
        const write = await this.records.recordQuotedText({
          sourceId: group.sourceId,
          authorUserId: group.userId,
          lineMessageId: message.lineMessageId,
          quotedLineMessageId: command.quotedLineMessageId,
          text: cached.text,
          sourceTimestamp: cached.lineTimestamp,
        });
        return this.finishWrite(write, message, '已記錄你回覆的文字。');
      }

      const attachments = worklogAttachmentRuntime();
      if (!attachments) {
        return {
          status: 'QUOTED_NOT_READY',
          replyText: '附件處理服務目前尚未啟用，這次沒有建立紀錄。',
        };
      }
      const result = await attachments.ingest({
        sourceId: group.sourceId,
        actorUserId: group.userId,
        chargedUserId: authorization.chargedUserId,
        commandLineMessageId: message.lineMessageId,
        quotedLineMessageId: command.quotedLineMessageId,
        sourceTimestamp: message.lineTimestamp,
        instruction: command.instruction,
        allowAiMedia: true,
      });
      if (result.status === 'RECORDED') {
        return {
          status: 'RECORDED',
          recordId: result.recordId,
          duplicate: result.duplicate,
          replyText: result.duplicate ? '這則附件已經記錄過了。' : '已記錄你回覆的附件。',
        };
      }
      if (result.status === 'IN_PROGRESS') {
        return {
          status: 'QUOTED_NOT_READY',
          replyText: '這則附件正在處理中，請稍後到 AFTERTRACE 紀錄頁查看。',
        };
      }
      return attachmentFailure(result.reason);
    }

    const write = await this.records.recordText({
      sourceId: group.sourceId,
      authorUserId: group.userId,
      lineMessageId: message.lineMessageId,
      text: command.text,
      sourceTimestamp: message.lineTimestamp,
    });
    return this.finishWrite(write, message, '已記錄。');
  }

  private async finishWrite(
    write: WorklogTextRecordWriteResult,
    message: BufferedGroupMessage,
    createdReplyText: string,
  ): Promise<WorklogLineRuntimeResult> {
    if (write.status === 'CREATED') {
      await this.normalizeBestEffort(write.recordId, message);
      return {
        status: 'RECORDED',
        recordId: write.recordId,
        duplicate: false,
        replyText: createdReplyText,
      };
    }
    if (write.status === 'ALREADY_RECORDED') {
      await this.normalizeBestEffort(write.recordId, message);
      return {
        status: 'RECORDED',
        recordId: write.recordId,
        duplicate: true,
        replyText: '這則訊息已經記錄過了。',
      };
    }
    if (write.status === 'IDEMPOTENCY_CONFLICT') {
      return {
        status: 'REJECTED',
        reason: 'IDEMPOTENCY_CONFLICT',
        replyText: '這則 LINE 訊息的紀錄狀態不一致，為避免寫錯資料，本次沒有覆蓋既有紀錄。',
      };
    }
    return {
      status: 'REJECTED',
      reason: 'SOURCE_NOT_FOUND',
      replyText: '這個群組目前無法建立紀錄，請稍後再試。',
    };
  }

  private async cacheOrdinaryTextBestEffort(message: BufferedGroupMessage): Promise<void> {
    if (message.messageType !== 'text' || !message.textContent) return;
    try {
      await this.textCache.remember({
        lineMessageId: message.lineMessageId,
        lineGroupId: message.lineGroupId,
        lineUserId: message.lineUserId,
        text: message.textContent,
        lineTimestamp: message.lineTimestamp,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'worklog_line_text_cache_failed',
        lineGroupId: message.lineGroupId,
        lineMessageId: message.lineMessageId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
    }
  }

  private async normalizeBestEffort(recordId: number, message: BufferedGroupMessage): Promise<void> {
    if (!this.textNormalization) return;
    try {
      await this.textNormalization.normalizeText(recordId);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'worklog_text_normalization_failed_after_persist',
        source: 'GROUP',
        recordId,
        lineGroupId: message.lineGroupId,
        lineMessageId: message.lineMessageId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
    }
  }
}

function replyEditTargetFailure(
  result: Exclude<WorklogReplyEditTargetResolution, { status: 'FOUND' }>,
): WorklogLineRuntimeResult {
  switch (result.status) {
    case 'NOT_FOUND':
      return {
        status: 'REJECTED',
        reason: 'EDIT_TARGET_NOT_FOUND',
        replyText: '找不到你回覆的 AFTERTRACE 紀錄。請確認 Reply 的是這個群組中原本已記錄的訊息，或前往 AFTERTRACE 編輯。',
      };
    case 'AMBIGUOUS':
      return {
        status: 'REJECTED',
        reason: 'EDIT_TARGET_AMBIGUOUS',
        replyText: '你回覆的 LINE 訊息目前對應到多筆有效紀錄，為避免改錯資料不會自動修改；請前往 AFTERTRACE 紀錄頁處理。',
      };
    case 'DELETED':
      return {
        status: 'REJECTED',
        reason: 'EDIT_TARGET_DELETED',
        replyText: '你回覆的 AFTERTRACE 紀錄目前已刪除；請先到回收桶還原，或直接在 AFTERTRACE 紀錄頁處理。',
      };
  }
}

function lineEditResult(
  recordId: number,
  result: WorklogLineRecordEditResult,
): WorklogLineRuntimeResult {
  switch (result.status) {
    case 'EDITED':
      return {
        status: 'EDITED',
        recordId,
        recordVersion: result.recordVersion,
        replyText: '已更新這筆 AFTERTRACE 紀錄。',
      };
    case 'PENDING_CONFIRMATION':
      return {
        status: 'EDIT_CONFIRMATION_PENDING',
        recordId,
        confirmationId: result.confirmationId,
        replyText: 'AI 已理解修改內容，但紀錄標題需要你確認。請到 AFTERTRACE 紀錄頁完成確認；不會再扣第二次 AI 點數。',
      };
    case 'IN_PROGRESS':
      return {
        status: 'EDIT_IN_PROGRESS',
        replyText: '這筆修改已在安全處理中，請稍後查看 AFTERTRACE；系統不會因重送而再次呼叫 AI。',
      };
    case 'AI_POINTS_EXHAUSTED':
      return {
        status: 'REJECTED',
        reason: 'AI_POINTS_EXHAUSTED',
        replyText: '目前這個群組可用的 AI 點數不足，這次沒有呼叫 AI 修改。',
      };
    case 'RECORD_CHANGED':
    case 'NOT_ELIGIBLE':
      return {
        status: 'REJECTED',
        reason: 'EDIT_RECORD_CHANGED',
        replyText: '這筆紀錄在修改期間已被變更或刪除，為避免覆蓋較新的內容，本次沒有套用 AI 修改。',
      };
    case 'IDEMPOTENCY_CONFLICT':
      return {
        status: 'REJECTED',
        reason: 'IDEMPOTENCY_CONFLICT',
        replyText: '這則 LINE 修改指令的處理狀態不一致，為避免重複扣點或改錯資料，本次沒有再次執行 AI。',
      };
    case 'FAILED':
      return {
        status: 'REJECTED',
        reason: 'EDIT_FAILED',
        replyText: '這次 AI 修改沒有成功套用。原紀錄保持不變，請稍後再試或到 AFTERTRACE 手動編輯。',
      };
  }
}

function attachmentFailure(reason: string): WorklogLineRuntimeResult {
  if (reason === 'LINE_CONTENT_NOT_READY') {
    return {
      status: 'QUOTED_NOT_READY',
      replyText: 'LINE 還在準備這則附件，請稍後再 Reply「@AFTERTRACE」，不用重新上傳。',
    };
  }
  if (reason === 'LINE_CONTENT_NOT_RETRIEVABLE') {
    return {
      status: 'REJECTED',
      reason: 'ATTACHMENT_FAILED',
      replyText: '如果你回覆的是較早的文字，LINE 無法事後取回原文，請改傳「@AFTERTRACE 原文」；如果是附件，請重新傳送後再 Reply「@AFTERTRACE」。',
    };
  }
  if (reason === 'LINE_CONTENT_EXPIRED') {
    return {
      status: 'REJECTED',
      reason: 'ATTACHMENT_FAILED',
      replyText: '這則內容已過期，請重新傳送後再 Reply @AFTERTRACE。',
    };
  }
  if (reason === 'LINE_CONTENT_TOO_LARGE') {
    return {
      status: 'REJECTED',
      reason: 'ATTACHMENT_FAILED',
      replyText: '這個附件太大，目前無法處理，請縮小檔案後重新傳送。',
    };
  }
  if (reason === 'ATTACHMENT_UNSUPPORTED') {
    return {
      status: 'REJECTED',
      reason: 'ATTACHMENT_FAILED',
      replyText: '目前這個檔案格式還不能直接處理；Word／Excel 支援正在實作中，目前請先改傳 PDF、圖片、音檔或文字檔。',
    };
  }
  if (reason === 'AI_MEDIA_DISABLED') {
    return {
      status: 'REJECTED',
      reason: 'AI_MEDIA_DISABLED',
      replyText: '目前 AI 額度設定沒有開啟語音／圖片／檔案處理，這次沒有處理附件。',
    };
  }
  if (/POINTS|QUOTA|ALLOWANCE|SUBSCRIPTION/.test(reason)) {
    return {
      status: 'REJECTED',
      reason: 'AI_POINTS_EXHAUSTED',
      replyText: '目前這個群組可用的 AI 點數不足，這次沒有處理附件。',
    };
  }
  return {
    status: 'REJECTED',
    reason: 'ATTACHMENT_FAILED',
    replyText: '這次附件沒有成功處理，請重新傳送後再試。',
  };
}

type RejectedAuthorization =
  | Exclude<GroupAiAuthorizationResult, { status: 'OK' }>
  | Exclude<GroupAccessAuthorizationResult, { status: 'OK' }>;

function rejectedAuthorization(result: RejectedAuthorization): WorklogLineRuntimeResult {
  switch (result.status) {
    case 'GROUP_NOT_FOUND':
      return {
        status: 'REJECTED',
        reason: result.status,
        replyText: '找不到這個 AFTERTRACE 群組設定。',
      };
    case 'GROUP_INACTIVE':
      return {
        status: 'REJECTED',
        reason: result.status,
        replyText: '這個 AFTERTRACE 群組目前已停用。',
      };
    case 'AI_RESPONSIBLE_USER_UNBOUND':
      return {
        status: 'REJECTED',
        reason: result.status,
        replyText: '這個群組目前還沒有 AI 額度負責人，請先輸入「@AFTERTRACE 啟用」。',
      };
    case 'AI_RESPONSIBLE_USER_ABSENT':
      return {
        status: 'REJECTED',
        reason: result.status,
        replyText: '目前 AI 額度負責人已不在此 LINE 群組，群組 AI 功能暫停。',
      };
    case 'NOT_ACTIVE_MEMBER':
      return {
        status: 'REJECTED',
        reason: result.status,
        replyText: '你目前不是這個 AFTERTRACE 群組的有效成員。',
      };
    case 'AI_POINTS_EXHAUSTED':
      return {
        status: 'REJECTED',
        reason: result.status,
        replyText: '目前這個群組可用的 AI 點數已用完。',
      };
  }
}
