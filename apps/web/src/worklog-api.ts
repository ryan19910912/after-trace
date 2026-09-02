export type WorklogInputType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';

export type WorklogRecord = {
  id: number;
  sourceId: number;
  authorUserId: number | null;
  inputType: WorklogInputType;
  category: string;
  rawText: string | null;
  normalizedSummary: string | null;
  customerId: number | null;
  projectId: number | null;
  sourceTimestamp: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecordTypeCounts = { TEXT: number; AUDIO: number; IMAGE: number; FILE: number };
export type UserUsage = {
  userId: number;
  planCode: string;
  aiAllowanceUnits: number;
  aiUsedUnits: number;
  aiReservedUnits: number;
  aiRemainingUnits: number;
  providerCostUsd: number;
  providerCostTwd: number;
  records: RecordTypeCounts;
};
export type GroupMemberUsage = {
  userId: number;
  displayName: string | null;
  recordingEnabled: boolean;
  aiUsedUnits: number;
  providerCostUsd: number;
  providerCostTwd: number;
  records: RecordTypeCounts;
  lastInteractionAt: string | null;
  updatedAt: string;
};
export type GroupOwnerView = {
  sourceId: number;
  ownerUserId: number;
  owner: UserUsage;
  groupAiUsedUnits: number;
  groupProviderCostUsd: number;
  groupProviderCostTwd: number;
  members: GroupMemberUsage[];
};

export type WorklogSurfaces = {
  personal: { sourceId: number } | null;
  groups: Array<{ sourceId: number; lineGroupId: string }>;
};

export type WebEntryContext =
  | { type: 'GROUP'; lineGroupId: string }
  | { type: 'PRIVATE'; userId: number; sourceId: number };

export type EntryExchange = {
  sessionToken: string;
  lineUserId: string;
  entryContext: WebEntryContext;
};

async function json<T>(response: Response, fallback: string): Promise<T & { error?: string }> {
  const text = await response.text();
  let body: (T & { error?: string }) | null = null;
  try { body = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string }; }
  catch { throw new Error(`${fallback} (${response.status})`); }
  if (!response.ok) throw new Error(body.error || `${fallback} (${response.status})`);
  return body;
}

export class WorklogApi {
  constructor(private readonly baseUrl: string) {}
  private base(path: string) { return `${this.baseUrl.replace(/\/$/, '')}${path}`; }
  lineLoginUrl() { return this.base('/api/v1/auth/line/start'); }

  async exchangeEntry(token: string): Promise<EntryExchange> {
    return json<EntryExchange>(await fetch(this.base('/api/v1/auth/entry/exchange'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    }), '登入連結驗證失敗');
  }

  async surfaces(sessionToken: string): Promise<WorklogSurfaces> {
    const body = await json<{ surfaces: WorklogSurfaces }>(await this.request(sessionToken, '/api/v1/worklog/surfaces'), '紀錄範圍載入失敗');
    return body.surfaces;
  }

  async personalRecords(sessionToken: string): Promise<WorklogRecord[]> {
    const body = await json<{ records: WorklogRecord[] }>(await this.request(sessionToken, '/api/v1/worklog/records/personal'), '個人紀錄載入失敗');
    return body.records;
  }

  async groupRecords(sessionToken: string, sourceId: number): Promise<WorklogRecord[]> {
    const body = await json<{ records: WorklogRecord[] }>(await this.request(sessionToken, `/api/v1/worklog/records/group/${sourceId}`), '群組紀錄載入失敗');
    return body.records;
  }

  async myUsage(sessionToken: string): Promise<UserUsage> {
    const body = await json<{ usage: UserUsage }>(await this.request(sessionToken, '/api/v1/worklog/usage/me'), 'AI 額度載入失敗');
    return body.usage;
  }

  async ownerView(sessionToken: string, sourceId: number): Promise<GroupOwnerView | null> {
    const response = await this.request(sessionToken, `/api/v1/worklog/groups/${sourceId}/owner-view`);
    if (response.status === 403) return null;
    const body = await json<{ ownerView: GroupOwnerView }>(response, '群組管理資料載入失敗');
    return body.ownerView;
  }

  async setRecordingEnabled(sessionToken: string, sourceId: number, memberUserId: number, enabled: boolean): Promise<void> {
    await json(await this.request(sessionToken, `/api/v1/worklog/groups/${sourceId}/members/${memberUserId}/recording`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    }), '成員紀錄權限更新失敗');
  }

  private request(sessionToken: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(this.base(path), { ...init, headers });
  }
}
