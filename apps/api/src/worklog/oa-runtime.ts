import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import { worklogAttachmentRuntime } from './attachment-runtime';
import type { PrivateBootstrapResult } from './bootstrap';
import { parseWorklogCommand } from './command';
import { historyFiltersFromText, type WorklogHistoryFilters } from './history-navigation';
import type { WorklogReplyEditTargetResolution, WorklogTextRecordWriteResult } from './records';
import type { WorklogTextNormalizationService } from './text-normalization';

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

export type WorklogOaLifecycleResult =
  | { status: 'FOLLOWED'; userId: number; sourceId: number }
  | { status: 'UNFOLLOWED'; userId: number };

export type WorklogOaRuntimeResult =
  | { status: 'NOT_HANDLED' }
  | { status: 'QUERY'; sourceId: number; userId: number; filters: WorklogHistoryFilters }
  | { status: 'RECORDED'; recordId: number; duplicate: boolean; replyText: string }
  | { status: 'QUOTED_NOT_READY'; replyText: string }
  | {
      status: 'REJECTED';
      reason:
        | 'NOT_OA_FRIEND'
        | 'GROUP_COMMAND_IN_PRIVATE'
        | 'SOURCE_NOT_FOUND'
        | 'IDEMPOTENCY_CONFLICT'
        | 'ATTACHMENT_FAILED'
        | 'EDIT_TARGET_REQUIRED'
        | 'EDIT_TARGET_NOT_FOUND'
        | 'EDIT_TARGET_AMBIGUOUS'
        | 'EDIT_TARGET_DELETED'
        | 'EDIT_NOT_READY';
      replyText: string;
    };

export class WorklogOaRuntime {
  constructor(
    private readonly bootstrap: WorklogOaBootstrapPort,
    private readonly records: WorklogOaRecordWritePort,
    private readonly textNormalization?: WorklogOaTextNormalizationPort,
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
    const command = parseWorklogCommand(message);
    if (!command) return { status: 'NOT_HANDLED' };

    if (command.kind === 'CLAIM_GROUP') {
      return { status: 'REJECTED', reason: 'GROUP_COMMAND_IN_PRIVATE', replyText: '「@AFTERTRACE 啟用」要在要設定的 LINE 群組裡使用。' };
    }
    if (!touched.isOaFriend) {
      return { status: 'REJECTED', reason: 'NOT_OA_FRIEND', replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用個人紀錄。' };
    }

    const personal = await this.bootstrap.bootstrapPrivateInteraction({ lineUserId: message.lineUserId, at: message.lineTimestamp });
    if (personal.status === 'NOT_OA_FRIEND') {
      return { status: 'REJECTED', reason: 'NOT_OA_FRIEND', replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用個人紀錄。' };
    }

    if (command.kind === 'QUERY') {
      return {
        status: 'QUERY',
        sourceId: personal.sourceId,
        userId: personal.userId,
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
      const target = await this.records.resolveReplyEditTarget(personal.sourceId, command.quotedLineMessageId);
      return replyEditTargetResult(target);
    }

    if (command.kind === 'RECORD_QUOTED') {
      const attachments = worklogAttachmentRuntime();
      if (!attachments) return { status: 'QUOTED_NOT_READY', replyText: '附件處理服務目前尚未啟用，這次沒有建立紀錄。' };
      const result = await attachments.ingest({
        sourceId: personal.sourceId,
        actorUserId: personal.userId,
        chargedUserId: personal.userId,
        commandLineMessageId: message.lineMessageId,
        quotedLineMessageId: command.quotedLineMessageId,
        sourceTimestamp: message.lineTimestamp,
        instruction: command.instruction,
      });
      if (result.status === 'RECORDED') {
        return {
          status: 'RECORDED',
          recordId: result.recordId,
          duplicate: result.duplicate,
          replyText: result.duplicate ? '這則附件已經記錄過了。' : '已記錄到你的個人 AFTERTRACE。',
        };
      }
      if (result.status === 'IN_PROGRESS') return { status: 'QUOTED_NOT_READY', replyText: '這則附件正在處理中，請稍後到 AFTERTRACE 查看。' };
      return attachmentFailure(result.reason);
    }

    const write = await this.records.recordText({
      sourceId: personal.sourceId,
      authorUserId: personal.userId,
      lineMessageId: message.lineMessageId,
      text: command.text,
      sourceTimestamp: message.lineTimestamp,
    });
    if (write.status === 'CREATED') {
      await this.normalizeBestEffort(write.recordId, message);
      return { status: 'RECORDED', recordId: write.recordId, duplicate: false, replyText: '已記錄到你的個人 AFTERTRACE。' };
    }
    if (write.status === 'ALREADY_RECORDED') {
      await this.normalizeBestEffort(write.recordId, message);
      return { status: 'RECORDED', recordId: write.recordId, duplicate: true, replyText: '這則訊息已經記錄過了。' };
    }
    if (write.status === 'IDEMPOTENCY_CONFLICT') {
      return { status: 'REJECTED', reason: 'IDEMPOTENCY_CONFLICT', replyText: '這則 LINE 訊息的紀錄狀態不一致，為避免寫錯資料，本次沒有覆蓋既有紀錄。' };
    }
    return { status: 'REJECTED', reason: 'SOURCE_NOT_FOUND', replyText: '你的個人 AFTERTRACE 紀錄區目前無法使用，請稍後再試。' };
  }

  private async normalizeBestEffort(recordId: number, message: BufferedPrivateMessage): Promise<void> {
    if (!this.textNormalization) return;
    try {
      await this.textNormalization.normalizeText(recordId);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'worklog_text_normalization_failed_after_persist',
        source: 'PRIVATE',
        recordId,
        lineUserId: message.lineUserId,
        lineMessageId: message.lineMessageId,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
    }
  }
}

function replyEditTargetResult(result: WorklogReplyEditTargetResolution): WorklogOaRuntimeResult {
  switch (result.status) {
    case 'FOUND':
      return { status: 'REJECTED', reason: 'EDIT_NOT_READY', replyText: '已確認你回覆的是個人 AFTERTRACE 中的有效紀錄，但 LINE AI 修改尚未完成接線；目前請先到 AFTERTRACE 紀錄頁手動編輯。' };
    case 'NOT_FOUND':
      return { status: 'REJECTED', reason: 'EDIT_TARGET_NOT_FOUND', replyText: '找不到你回覆的個人 AFTERTRACE 紀錄。請確認 Reply 的是原本已記錄的訊息，或前往 AFTERTRACE 編輯。' };
    case 'AMBIGUOUS':
      return { status: 'REJECTED', reason: 'EDIT_TARGET_AMBIGUOUS', replyText: '你回覆的 LINE 訊息目前對應到多筆有效紀錄，為避免改錯資料不會自動修改；請前往 AFTERTRACE 紀錄頁處理。' };
    case 'DELETED':
      return { status: 'REJECTED', reason: 'EDIT_TARGET_DELETED', replyText: '你回覆的個人 AFTERTRACE 紀錄目前已刪除；請先到回收桶還原，或直接在 AFTERTRACE 紀錄頁處理。' };
  }
}

function attachmentFailure(reason: string): WorklogOaRuntimeResult {
  if (reason === 'LINE_CONTENT_NOT_READY') return { status: 'QUOTED_NOT_READY', replyText: 'LINE 還在準備這則附件，請稍後再 Reply「@AFTERTRACE」，不用重新上傳。' };
  if (reason === 'LINE_CONTENT_NOT_RETRIEVABLE') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '如果你回覆的是文字，LINE 無法事後取回原文，請改傳「@AFTERTRACE 原文」；如果是附件，請重新傳送後再 Reply「@AFTERTRACE」。' };
  if (reason === 'LINE_CONTENT_EXPIRED') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '這則內容已過期，請重新傳送後再 Reply @AFTERTRACE。' };
  if (reason === 'LINE_CONTENT_TOO_LARGE') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '這個附件太大，目前無法處理，請縮小檔案後重新傳送。' };
  if (reason === 'ATTACHMENT_UNSUPPORTED') return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '目前不支援這個檔案格式，請改傳圖片、音檔、PDF 或文字檔。' };
  if (/POINTS|QUOTA|ALLOWANCE|SUBSCRIPTION/.test(reason)) return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '你的 AI 點數不足，這次沒有處理附件。' };
  return { status: 'REJECTED', reason: 'ATTACHMENT_FAILED', replyText: '這次附件沒有成功處理，請重新傳送後再試。' };
}