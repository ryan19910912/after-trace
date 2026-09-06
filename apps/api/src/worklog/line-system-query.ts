import type { WorklogAiGrantService } from './ai-grants';
import type { WorklogSystemQueryKind } from './line-natural-interpreter';

export type WorklogGroupSystemState = {
  responsibleUserId: number | null;
  responsibleDisplayName: string | null;
  responsibleLineUserId: string | null;
};

export interface WorklogLineSystemQueryRepository {
  groupState(sourceId: number): Promise<WorklogGroupSystemState | null>;
}

export class WorklogLineSystemQueryService {
  constructor(
    private readonly repository: WorklogLineSystemQueryRepository,
    private readonly grants: Pick<WorklogAiGrantService, 'eligibleBalance'>,
  ) {}

  async group(input: { sourceId: number; query: WorklogSystemQueryKind; at?: Date }): Promise<string> {
    const state = await this.repository.groupState(input.sourceId);
    if (!state) return '找不到這個 AFTERTRACE 群組設定。';
    if (!state.responsibleUserId) return '目前這個群組沒有 AI 額度負責人。';
    const name = state.responsibleDisplayName?.trim() || '目前的 AI 額度負責人';
    if (input.query === 'AI_RESPONSIBLE_USER') return `目前這個群組的 AI 額度負責人是 ${name}。`;
    const balance = await this.grants.eligibleBalance(state.responsibleUserId, input.sourceId, input.at ?? new Date());
    if (input.query === 'AI_BALANCE') return `這個群組目前可用 AI 點數：${balance.totalRemainingPoints.toLocaleString('zh-TW')}。\nAI 額度負責人：${name}`;
    return balance.totalRemainingPoints > 0
      ? `這個群組目前可以使用 AI。\nAI 額度負責人：${name}\n可用 AI 點數：${balance.totalRemainingPoints.toLocaleString('zh-TW')}`
      : `這個群組目前 AI 點數已用完。\nAI 額度負責人：${name}`;
  }

  async personal(input: { userId: number; sourceId: number; query: WorklogSystemQueryKind; at?: Date }): Promise<string> {
    const balance = await this.grants.eligibleBalance(input.userId, input.sourceId, input.at ?? new Date());
    if (input.query === 'AI_BALANCE') return `你目前可用 AI 點數：${balance.totalRemainingPoints.toLocaleString('zh-TW')}。`;
    if (input.query === 'AI_RESPONSIBLE_USER') return '個人 AFTERTRACE 的 AI 點數由你自己的帳號負責。';
    return balance.totalRemainingPoints > 0
      ? `你目前可以使用 AI。\n可用 AI 點數：${balance.totalRemainingPoints.toLocaleString('zh-TW')}`
      : '你目前 AI 點數已用完；仍可在 AFTERTRACE 免費手動新增、查詢與編輯紀錄。';
  }
}
