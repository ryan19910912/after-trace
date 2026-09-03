export type WorklogInputType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';

export type WorklogRecord = {
  id: number;
  sourceId: number;
  authorUserId: number | null;
  inputType: WorklogInputType;
  rawText: string | null;
  sourceTimestamp: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecordPage = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type RecordFilters = {
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type RecordTypeCounts = {
  TEXT: number;
  AUDIO: number;
  IMAGE: number;
  FILE: number;
};

// Transitional shape until aggregate subscription quota is replaced by the grant ledger.
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

export type SubscriptionPlan = {
  code: string;
  display_name: string;
  price_twd: string;
  rank: number;
  ai_allowance_units: number;
  capabilities: Record<string, unknown>;
  current: boolean;
};

export type SubscriptionPlans = {
  currentPlanCode: string;
  checkoutEnabled: boolean;
  plans: SubscriptionPlan[];
};

export type CheckoutIntent = {
  id: string;
  plan_code: string;
  status: string;
  checkout_url: string | null;
  created_at: string;
  checkoutEnabled: boolean;
  providerConfigured: boolean;
  message?: string;
};

async function json<T>(response: Response, fallback: string): Promise<T & { error?: string }> {
  const text = await response.text();
  let body: T & { error?: string };
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

  async exchangeEntry(token: string) {
    return json<EntryExchange>(await fetch(this.base('/api/v1/auth/entry/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }), '登入連結驗證失敗');
  }

  async surfaces(sessionToken: string) {
    return (await json<{ surfaces: WorklogSurfaces }>(
      await this.request(sessionToken, '/api/v1/worklog/surfaces'),
      '紀錄範圍載入失敗',
    )).surfaces;
  }

  async personalRecords(
    sessionToken: string,
    filters: RecordFilters = {},
  ): Promise<{ records: WorklogRecord[]; page: RecordPage }> {
    return this.recordPage(
      sessionToken,
      '/api/v1/worklog/records/personal',
      filters,
      '個人紀錄載入失敗',
    );
  }

  async groupRecords(
    sessionToken: string,
    sourceId: number,
    filters: RecordFilters = {},
  ): Promise<{ records: WorklogRecord[]; page: RecordPage }> {
    return this.recordPage(
      sessionToken,
      `/api/v1/worklog/records/group/${sourceId}`,
      filters,
      '群組紀錄載入失敗',
    );
  }

  async myUsage(sessionToken: string) {
    return (await json<{ usage: UserUsage }>(
      await this.request(sessionToken, '/api/v1/worklog/usage/me'),
      'AI 額度載入失敗',
    )).usage;
  }

  async submitFeedback(
    sessionToken: string,
    text: string,
    context: Record<string, string | number>,
  ) {
    await json(
      await this.request(sessionToken, '/api/v1/worklog/feedback', this.body('POST', { text, context })),
      '意見送出失敗',
    );
  }

  async subscriptionPlans(sessionToken: string): Promise<SubscriptionPlans> {
    const response = await this.request(sessionToken, '/api/v1/subscription/plans');
    const value = await json<{
      currentPlanCode: string;
      checkoutEnabled: boolean;
      plans: SubscriptionPlan[];
    }>(response, '方案載入失敗');
    return {
      currentPlanCode: value.currentPlanCode,
      checkoutEnabled: value.checkoutEnabled,
      plans: value.plans,
    };
  }

  async createCheckoutIntent(
    sessionToken: string,
    planCode: string,
    requestKey: string,
  ): Promise<CheckoutIntent> {
    return (await json<{ intent: CheckoutIntent }>(
      await this.request(
        sessionToken,
        '/api/v1/subscription/checkout-intents',
        this.body('POST', { planCode, requestKey }),
      ),
      '付款流程建立失敗',
    )).intent;
  }

  private async recordPage(
    sessionToken: string,
    path: string,
    filters: RecordFilters,
    fallback: string,
  ) {
    const params = new URLSearchParams();
    if (filters.query?.trim()) params.set('q', filters.query.trim());
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    const suffix = params.toString() ? `?${params}` : '';
    const body = await json<{ records: Record<string, unknown>[]; page: RecordPage }>(
      await this.request(sessionToken, `${path}${suffix}`),
      fallback,
    );
    return { records: body.records.map(recordFromApi), page: body.page };
  }

  private body(method: string, value: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    };
  }

  private request(sessionToken: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(this.base(path), { ...init, headers });
  }
}

function recordFromApi(raw: Record<string, unknown>): WorklogRecord {
  return {
    id: Number(raw.id),
    sourceId: Number(raw.source_id ?? raw.sourceId),
    authorUserId: nullableNumber(raw.author_user_id ?? raw.authorUserId),
    inputType: String(raw.input_type ?? raw.inputType) as WorklogInputType,
    rawText: nullableString(raw.raw_text ?? raw.rawText),
    sourceTimestamp: nullableString(raw.source_timestamp ?? raw.sourceTimestamp),
    editedAt: nullableString(raw.edited_at ?? raw.editedAt),
    createdAt: String(raw.created_at ?? raw.createdAt),
    updatedAt: String(raw.updated_at ?? raw.updatedAt),
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
