export type WorklogGroupSystemState = {
  responsibleUserId: number | null;
  responsibleDisplayName: string | null;
  responsibleLineUserId: string | null;
};

export type WorklogAiAllowanceStatus = {
  totalPoints: number;
  remainingPoints: number;
};

export interface WorklogLineSystemQueryRepository {
  groupState(sourceId: number): Promise<WorklogGroupSystemState | null>;
  allowance(ownerUserId: number, sourceId: number, at: Date): Promise<WorklogAiAllowanceStatus>;
}

/** Provider-free deterministic status presentation for fixed `小跡 狀態`. */
export class WorklogLineSystemQueryService {
  constructor(
    private readonly repository: WorklogLineSystemQueryRepository,
    // Retained temporarily so existing composition can pass the historical grant service
    // without making status depend on provider-backed routing or a second entitlement path.
    _legacyGrants?: unknown,
  ) {}

  async groupStatus(input: { sourceId: number; at?: Date }): Promise<string> {
    const state = await this.repository.groupState(input.sourceId);
    if (!state) return '找不到這個 AFTERTRACE 群組設定。';
    if (!state.responsibleUserId) {
      return [
        'AFTERTRACE 群組狀態',
        '',
        'AI 負責人：尚未設定',
        'AI 點數：—',
        '目前額度使用率：—',
        'AI 功能：暫停',
        '',
        '請輸入「小跡 啟用 AI」設定負責人。',
      ].join('\n');
    }

    const allowance = await this.repository.allowance(
      state.responsibleUserId,
      input.sourceId,
      input.at ?? new Date(),
    );
    const name = state.responsibleDisplayName?.trim() || '已設定的群組成員';
    return formatStatus('AFTERTRACE 群組狀態', name, allowance);
  }

  async personalStatus(input: { userId: number; sourceId: number; at?: Date }): Promise<string> {
    const allowance = await this.repository.allowance(
      input.userId,
      input.sourceId,
      input.at ?? new Date(),
    );
    return formatStatus('AFTERTRACE 個人狀態', '你', allowance);
  }
}

function formatStatus(title: string, responsible: string, allowance: WorklogAiAllowanceStatus): string {
  const total = safePoints(allowance.totalPoints);
  const remaining = Math.min(total, safePoints(allowance.remainingPoints));
  const used = Math.max(0, total - remaining);
  const usedPercent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return [
    title,
    '',
    `AI 負責人：${responsible}`,
    `AI 點數：${remaining.toLocaleString('zh-TW')} / ${total.toLocaleString('zh-TW')}`,
    `目前額度使用率：${usedPercent}%`,
    `AI 功能：${remaining > 0 ? '可使用' : '目前無可用點數'}`,
  ].join('\n');
}

function safePoints(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
