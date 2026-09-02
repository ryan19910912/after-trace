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
  createdAt: string;
  updatedAt: string;
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
  try {
    body = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string };
  } catch {
    throw new Error(`${fallback} (${response.status})`);
  }
  if (!response.ok) throw new Error(body.error || `${fallback} (${response.status})`);
  return body;
}

export class WorklogApi {
  constructor(private readonly baseUrl: string) {}

  private base(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  lineLoginUrl() {
    return this.base('/api/v1/auth/line/start');
  }

  async exchangeEntry(token: string): Promise<EntryExchange> {
    return json<EntryExchange>(await fetch(this.base('/api/v1/auth/entry/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
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

  private request(sessionToken: string, path: string) {
    return fetch(this.base(path), { headers: { Authorization: `Bearer ${sessionToken}` } });
  }
}
