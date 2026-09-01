import type { BufferedPrivateMessage, OaLifecycleEvent } from '../line/events';
import type { PrivateBootstrapResult } from './bootstrap';
import { parseWorklogCommand } from './command';
import type { WorklogTextRecordWriteResult } from './records';

export interface WorklogOaBootstrapPort {
  handleOaFollow(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<{ userId: number; workspaceId: number; sourceId: number }>;
  handleOaUnfollow(input: { lineUserId: string; at?: Date }): Promise<{ userId: number }>;
  touchPrivateInteraction(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<{ userId: number; lineUserId: string; isOaFriend: boolean }>;
  bootstrapPrivateInteraction(input: {
    lineUserId: string;
    displayName?: string | null;
    at?: Date;
  }): Promise<PrivateBootstrapResult>;
}

export interface WorklogOaRecordWritePort {
  recordText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult>;
}

export type WorklogOaLifecycleResult =
  | { status: 'FOLLOWED'; userId: number; sourceId: number }
  | { status: 'UNFOLLOWED'; userId: number };

export type WorklogOaRuntimeResult =
  | { status: 'NOT_HANDLED' }
  | { status: 'QUERY'; sourceId: number; userId: number }
  | { status: 'RECORDED'; recordId: number; duplicate: boolean; replyText: string }
  | { status: 'QUOTED_NOT_READY'; replyText: string }
  | {
      status: 'REJECTED';
      reason: 'NOT_OA_FRIEND' | 'GROUP_COMMAND_IN_PRIVATE' | 'SOURCE_NOT_FOUND' | 'IDEMPOTENCY_CONFLICT';
      replyText: string;
    };

/**
 * OA-private worklog boundary.
 *
 * Ordinary private text remains human-support traffic. Only explicit @AFTERTRACE
 * commands are handled as product actions. Raw personal text records are persisted
 * before any future AI normalization so provider/quota failures cannot erase input.
 */
export class WorklogOaRuntime {
  constructor(
    private readonly bootstrap: WorklogOaBootstrapPort,
    private readonly records: WorklogOaRecordWritePort,
  ) {}

  async handleLifecycle(event: OaLifecycleEvent): Promise<WorklogOaLifecycleResult> {
    if (event.type === 'FOLLOW') {
      const followed = await this.bootstrap.handleOaFollow({
        lineUserId: event.lineUserId,
        at: event.lineTimestamp,
      });
      return { status: 'FOLLOWED', userId: followed.userId, sourceId: followed.sourceId };
    }

    const unfollowed = await this.bootstrap.handleOaUnfollow({
      lineUserId: event.lineUserId,
      at: event.lineTimestamp,
    });
    return { status: 'UNFOLLOWED', userId: unfollowed.userId };
  }

  async handleMessage(message: BufferedPrivateMessage): Promise<WorklogOaRuntimeResult> {
    const touched = await this.bootstrap.touchPrivateInteraction({
      lineUserId: message.lineUserId,
      at: message.lineTimestamp,
    });
    const command = parseWorklogCommand(message);
    if (!command) return { status: 'NOT_HANDLED' };

    if (command.kind === 'CLAIM_GROUP') {
      return {
        status: 'REJECTED',
        reason: 'GROUP_COMMAND_IN_PRIVATE',
        replyText: '「@AFTERTRACE 啟用」要在要綁定的 LINE 群組裡使用。',
      };
    }

    if (!touched.isOaFriend) {
      return {
        status: 'REJECTED',
        reason: 'NOT_OA_FRIEND',
        replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用個人紀錄。',
      };
    }

    const personal = await this.bootstrap.bootstrapPrivateInteraction({
      lineUserId: message.lineUserId,
      at: message.lineTimestamp,
    });
    if (personal.status === 'NOT_OA_FRIEND') {
      return {
        status: 'REJECTED',
        reason: 'NOT_OA_FRIEND',
        replyText: '請先加入 AFTERTRACE LINE 官方帳號好友後再使用個人紀錄。',
      };
    }

    if (command.kind === 'QUERY') {
      return { status: 'QUERY', sourceId: personal.sourceId, userId: personal.userId };
    }

    if (command.kind === 'RECORD_QUOTED') {
      return {
        status: 'QUOTED_NOT_READY',
        replyText: '個人附件／音檔／圖片紀錄正在接新的 content-fetch 流程，這次尚未建立紀錄。',
      };
    }

    const write = await this.records.recordText({
      sourceId: personal.sourceId,
      authorUserId: personal.userId,
      lineMessageId: message.lineMessageId,
      text: command.text,
      sourceTimestamp: message.lineTimestamp,
    });
    if (write.status === 'CREATED') {
      return {
        status: 'RECORDED',
        recordId: write.recordId,
        duplicate: false,
        replyText: '已記錄到你的個人 AFTERTRACE。',
      };
    }
    if (write.status === 'ALREADY_RECORDED') {
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
      replyText: '你的個人 AFTERTRACE 紀錄區目前無法使用，請稍後再試。',
    };
  }
}
