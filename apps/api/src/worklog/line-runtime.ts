import type { BufferedGroupMessage } from '../line/events';
import type { GroupBootstrapResult, GroupOwnerBindResult } from './bootstrap';
import type { GroupRecordAuthorizationResult } from './collaboration';
import { parseWorklogCommand } from './command';
import type { WorklogLineTextCacheService } from './line-text-cache';
import { worklogAttachmentRuntime } from './attachment-runtime';
import type { WorklogTextRecordWriteResult } from './records';
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
  authorizeGroupRecord(input: {
    sourceId: number;
    actorUserId: number;
    requestedAiUnits?: number;
  }): Promise<GroupRecordAuthorizationResult>;
}

export interface WorklogLineTextCachePort {
  remember(input: {
    lineMessageId: string;
    lineGroupId: string;
    lineUserId: string | null;
    text: string;
    lineTimestamp: Date;
  }): ReturnType<WorklogLineTextCacheService['remember']>;
  resolve(lineGroupId: string, quotedLineMessageId: string, now?: Date): ReturnType<WorklogLineTextCacheService['resolve']>;
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
}

export interface WorklogLineTextNormalizationPort {
  normalizeText(recordId: number): ReturnType<WorklogTextNormalizationService['normalizeText']>;
}

export type WorklogLineRuntimeResult =
  | { status: 'NOT_HANDLED' }
  | { status: 'QUERY'; sourceId: number; userId: number }
  | { status: 'RECORDED'; recordId: number; duplicate: boolean; replyText: string }
  | { status: 'OWNER_BOUND'; sourceId: number; replyText: string }
  | { status: 'QUOTED_NOT_READY'; replyText: string }
  | {
      status: 'REJECTED';
      reason:
        | 'USER_UNKNOWN'
        | 'PENDING_OWNER'
        | 'OWNER_CONFLICT'
        | 'GROUP_NOT_FOUND'
        | 'GROUP_INACTIVE'
        | 'OWNER_UNBOUND'
        | 'NOT_ACTIVE_MEMBER'
        | 'RECORDING_DISABLED'
        | 'GROUP_NOT_ENTITLED'
        | 'AI_QUOTA_EXHAUSTED'
        | 'SOURCE_NOT_FOUND'
        | 'IDEMPOTENCY_CONFLICT'
        | 'ATTACHMENT_FAILED';
      replyText: string;
    };

export class WorklogLineRuntime {
  constructor(
    private readonly bootstrap: WorklogLineBootstrapPort,
    private readonly collaboration: WorklogLineCollaborationPort,
    private readonly records: WorklogLineRecordWritePort,
    private readonly textNormalization?: WorklogLineTextNormalizationPort,
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
        status: 'REJECTED', reason: 'USER_UNKNOWN',
        replyText: 'AFTERTRACE 無法辨識你的 LINE 使用者身分，這次沒有建立紀錄。',
      };
    }

    if (command.kind === 'CLAIM_GROUP') {
      await this.bootstrap.bootstrapGroupInteraction({
        lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, at: message.lineTimestamp,
      });
      const bound = await this.bootstrap.bindGroupOwner({
        lineGroupId: message.lineGroupId,
        ownerLineUserId: message.lineUserId,
        evidence: 'EXPLICIT_CLAIM',
        at: message.lineTimestamp,
      });
      if (bound.status === 'OWNER_CONFLICT') {
        return { status: 'REJECTED', reason: 'OWNER_CONFLICT', replyText: '這個群組已經綁定其他 AFTERTRACE Owner；目前不會覆蓋既有 Owner。' };
      }
      return {
        status: 'OWNER_BOUND', sourceId: bound.sourceId,
        replyText: bound.status === 'ALREADY_BOUND'
          ? '這個群組已經綁定在你的 AFTERTRACE 帳號。'
          : '群組已完成 AFTERTRACE Owner 綁定；方案有開啟群組權限後即可開始記錄。',
      };
    }

    const group = await this.bootstrap.bootstrapGroupInteraction({
      lineGroupId: message.lineGroupId, lineUserId: message.lineUserId, at: message.lineTimestamp,
    });
    if (group.status === 'PENDING_OWNER') {
      return { status: 'REJECTED', reason: 'PENDING_OWNER', replyText: '這個群組還沒有 AFTERTRACE Owner。請要負責訂閱的人輸入「@AFTERTRACE 啟用」完成綁定。' };
    }
    if (command.kind === 'QUERY') return { status: 'QUERY', sourceId: group.sourceId, userId: group.userId };

    const authorization = await this.collaboration.authorizeGroupRecord({
      sourceId: group.sourceId, actorUserId: group.userId, requestedAiUnits: 0,
    });
    if (authorization.status !== 'OK') return rejectedAuthorization(authorization.status);

    if (command.kind === 'RECORD_QUOTED') {
      const cached = await this.textCache.resolve(message.lineGroupId, command.quotedLineMessageId, message.lineTimestamp);
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
        return { status: 'QUOTED_NOT_READY', replyText: '附件處理服務目前尚未啟用，這次沒有建立紀錄。' };
      }
      const result = await attachments.ingest({
        sourceId: group.sourceId,
        actorUserId: group.userId,
        chargedUserId: authorization.chargedUserId,
        commandLineMessageId: message.lineMessageId,
        quotedLineMessageId: command.quotedLineMessageId,
        sourceTimestamp: message.lineTimestamp,
        instruction: command.instruction,
      });
      if (result.status === 'RECORDED') {
        return {
          status: 'RECORDED', recordId: result.recordId, duplicate: result.duplicate,
          replyText: result.duplicate ? '這則附件已經記錄過了。' : '已記錄你回覆的附件。',
        };
      }
      if (result.status === 'IN_PROGRESS') {
        return { status: 'QUOTED_NOT_READY', replyText: '這則附件正在處理中，請稍後到 AFTERTRACE 紀錄頁查看。' };
      }
      return attachmentFailure(result.reason);
    }

    const write = await this.records.recordText({
      sourceId: group.sourceId, authorUserId: group.userId, lineMessageId: message.lineMessageId,
      text: command.text, sourceTimestamp: message.lineTimestamp,
    });
    return this.finishWrite(write, message, '已記錄。');
  }

  private async finishWrite(write: WorklogTextRecordWriteResult, message: BufferedGroupMessage, createdReplyText: string): Promise<WorklogLineRuntimeResult> {
    if (write.status === 'CREATED') {
      await this.normalizeBestEffort(write.recordId, message);
      return { status: 'RECORDED', recordId: write.recordId, duplicate: false, replyText: createdReplyText };
    }
    if (write.status === 'ALREADY_RECORDED') {
      await this.normalizeBestEffort(write.recordId, message);
      return { status: 'RECORDED', recordId: write.recordId, duplicate: true, replyText: '這則訊息已經記錄過了。' };
    }
    if (write.status === 'IDEMPOTENCY_CONFLICT') {
      return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 訊息的紀錄狀態不一致，為避免寫錯資料，本次沒有覆蓋既有紀錄。' };
    }
    return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '這個群組目前無法建立紀錄，請重新啟用 AFTERTRACE 後再試。' };
  }

  private async cacheOrdinaryTextBestEffort(message: BufferedGroupMessage): Promise<void> {
    if (message.messageType !== 'text' || !message.textContent) return;
    try {
      await this.textCache.remember({
        lineMessageId: message.lineMessageId, lineGroupId: message.lineGroupId,
        lineUserId: message.lineUserId, text: message.textContent, lineTimestamp: message.lineTimestamp,
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'worklog_line_text_cache_failed', lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, message: error instanceof Error ? error.message : 'unknown error' }));
    }
  }

  private async normalizeBestEffort(recordId: number, message: BufferedGroupMessage): Promise<void> {
    if (!this.textNormalization) return;
    try { await this.textNormalization.normalizeText(recordId); }
    catch (error) {
      console.error(JSON.stringify({ event: 'worklog_text_normalization_failed_after_persist', source: 'GROUP', recordId, lineGroupId: message.lineGroupId, lineMessageId: message.lineMessageId, message: error instanceof Error ? error.message : 'unknown error' }));
    }
  }
}

function attachmentFailure(reason: string): WorklogLineRuntimeResult {
  if (reason === 'LINE_CONTENT_EXPIRED') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '這則內容已過期，請重新傳送後再 Reply @AFTERTRACE。' };
  if (reason === 'LINE_CONTENT_TOO_LARGE') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '這個附件太大，目前無法處理，請縮小檔案後重新傳送。' };
  if (reason === 'ATTACHMENT_UNSUPPORTED') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '目前不支援這個檔案格式，請改傳圖片、音檔、PDF 或文字檔。' };
  if (/QUOTA|ALLOWANCE|SUBSCRIPTION/.test(reason)) return { status: 'REJECTED', reason: 'AI_QUOTA_EXHAUSTED', replyText: '目前 Owner 的 AI 額度不足，這次沒有處理附件。' };
  return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '這次附件沒有成功處理，請重新傳送後再試。' };
}

function rejectedAuthorization(status: Exclude<GroupRecordAuthorizationResult['status'], 'OK'>): WorklogLineRuntimeResult {
  const replyText: Record<Exclude<GroupRecordAuthorizationResult['status'], 'OK'>, string> = {
    GROUP_NOT_FOUND: '找不到這個 AFTERTRACE 群組設定，請重新啟用後再試。',
    GROUP_INACTIVE: '這個 AFTERTRACE 群組目前已停用。',
    OWNER_UNBOUND: '這個群組還沒有 AFTERTRACE Owner，請先輸入「@AFTERTRACE 啟用」。',
    NOT_ACTIVE_MEMBER: '你目前不是這個 AFTERTRACE 群組的有效成員。',
    RECORDING_DISABLED: '群組 Owner 已關閉你的 AFTERTRACE 紀錄權限。',
    GROUP_NOT_ENTITLED: '目前 Owner 的方案沒有開啟群組紀錄權限。',
    AI_QUOTA_EXHAUSTED: '目前 Owner 的 AI 額度已用完。',
  };
  return { status: 'REJECTED', reason: status, replyText: replyText[status] };
}
