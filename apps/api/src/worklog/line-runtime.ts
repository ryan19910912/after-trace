import type { BufferedGroupMessage } from '../line/events';
import type { GroupBootstrapResult, GroupOwnerBindResult } from './bootstrap';
import type { GroupRecordAuthorizationResult } from './collaboration';
import { parseWorklogCommand } from './command';
import type { WorklogTextRecordWriteResult } from './records';

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

export interface WorklogLineRecordWritePort {
  recordText(input: {
    sourceId: number;
    authorUserId: number;
    lineMessageId: string;
    text: string;
    sourceTimestamp?: Date;
  }): Promise<WorklogTextRecordWriteResult>;
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
        | 'IDEMPOTENCY_CONFLICT';
      replyText: string;
    };

export class WorklogLineRuntime {
  constructor(
    private readonly bootstrap: WorklogLineBootstrapPort,
    private readonly collaboration: WorklogLineCollaborationPort,
    private readonly records: WorklogLineRecordWritePort,
  ) {}

  async handle(message: BufferedGroupMessage): Promise<WorklogLineRuntimeResult> {
    const command = parseWorklogCommand(message);
    if (!command) return { status: 'NOT_HANDLED' };
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
          replyText: '這個群組已經綁定其他 AFTERTRACE Owner；目前不會覆蓋既有 Owner。',
        };
      }
      return {
        status: 'OWNER_BOUND',
        sourceId: bound.sourceId,
        replyText: bound.status === 'ALREADY_BOUND'
          ? '這個群組已經綁定在你的 AFTERTRACE 帳號。'
          : '群組已完成 AFTERTRACE Owner 綁定；方案有開啟群組權限後即可開始記錄。',
      };
    }

    const group = await this.bootstrap.bootstrapGroupInteraction({
      lineGroupId: message.lineGroupId,
      lineUserId: message.lineUserId,
      at: message.lineTimestamp,
    });
    if (group.status === 'PENDING_OWNER') {
      return {
        status: 'REJECTED',
        reason: 'PENDING_OWNER',
        replyText: '這個群組還沒有 AFTERTRACE Owner。請要負責訂閱的人輸入「@AFTERTRACE 啟用」完成綁定。',
      };
    }

    const authorization = await this.collaboration.authorizeGroupRecord({
      sourceId: group.sourceId,
      actorUserId: group.userId,
      requestedAiUnits: 0,
    });
    if (authorization.status !== 'OK') return rejectedAuthorization(authorization.status);

    if (command.kind === 'QUERY') {
      return { status: 'QUERY', sourceId: group.sourceId, userId: group.userId };
    }

    if (command.kind === 'RECORD_QUOTED') {
      return {
        status: 'QUOTED_NOT_READY',
        replyText: '這版新的 Worklog 已先切到安全的文字紀錄流程；附件／音檔／圖片紀錄正在接新的 content-fetch 流程，這次沒有寫入舊 Memory。',
      };
    }

    const write = await this.records.recordText({
      sourceId: group.sourceId,
      authorUserId: group.userId,
      lineMessageId: message.lineMessageId,
      text: command.text,
      sourceTimestamp: message.lineTimestamp,
    });
    if (write.status === 'CREATED') {
      return {
        status: 'RECORDED',
        recordId: write.recordId,
        duplicate: false,
        replyText: '已記錄。',
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
      replyText: '這個群組目前無法建立紀錄，請重新啟用 AFTERTRACE 後再試。',
    };
  }
}

function rejectedAuthorization(
  status: Exclude<GroupRecordAuthorizationResult['status'], 'OK'>,
): WorklogLineRuntimeResult {
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
