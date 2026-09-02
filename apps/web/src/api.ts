export type ManagedMemory = {
  id: number;
  category: string;
  subject: string | null;
  content: string;
  sourceMessageId: string | null;
  sourceLineUserId: string | null;
  sourceLineTimestamp: string | null;
  sourceQuoteToken: string | null;
  updatedAt: string;
};

export type CrossGroupMemory = {
  id: number;
  groupId: number;
  lineGroupId: string;
  groupName: string;
  category: string;
  subject: string | null;
  content: string;
  sourceMessageId: string | null;
  sourceLineTimestamp: string | null;
  updatedAt: string;
};

export type ManagedReminder = {
  id: number;
  message: string;
  scheduledFor: string;
  status: 'SCHEDULED' | 'DISPATCHING' | 'CANCELLED' | 'DELIVERED';
};

export type EnergyBucket = 'FREE' | 'SUBSCRIPTION' | 'AD' | 'PAID';

export type PrivateEnergyOverview = {
  userId: number;
  usableUnits: string;
  reservedUnits: string;
  buckets: Record<EnergyBucket, { usableUnits: string; reservedUnits: string }>;
  lots: Array<{
    id: number;
    bucket: EnergyBucket;
    availableUnits: string;
    reservedUnits: string;
    expiresAt: string | null;
    sourceType: string;
  }>;
  subscription: null | {
    provider: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  proactive: {
    subscriptionUsable: boolean;
    paidUsable: boolean;
    enabled: boolean;
  };
};

export type CommerceCatalog = {
  provider: string | null;
  checkoutEnabled: boolean;
  subscription: null | {
    code: 'SUBSCRIPTION_V1';
    energyUnits: string;
    priceTwd: string | null;
  };
  paidPacks: Array<{
    code: 'SMALL' | 'MEDIUM' | 'LARGE';
    energyUnits: string;
    priceTwd: string | null;
  }>;
};

export type EnergyCatalogResponse = {
  catalog: CommerceCatalog;
  rewardedAd: {
    enabled: boolean;
    energyUnits: string | null;
    dailyLimit: number;
    cooldownMinutes: number;
  };
};

export type RewardedAdNonce = {
  nonce: string;
  expiresAt: string;
  client: {
    provider: 'GOOGLE_AD_MANAGER_WEB';
    networkCode: string;
    adUnitPath: string;
  };
};

export type RewardedAdClaim = {
  status: 'GRANTED' | 'ALREADY_GRANTED';
  claimId: number;
  operationId: number;
  units: string;
};

export type CheckoutProductCode = 'SUBSCRIPTION_V1' | 'PAID_SMALL' | 'PAID_MEDIUM' | 'PAID_LARGE';

export type CheckoutSession = {
  status: 'READY' | 'ALREADY_READY';
  checkoutUrl: string;
  provider: string;
  providerCheckoutId: string;
  expiresAt: string | null;
};

export type WebEntryContext =
  | { type: 'GROUP'; lineGroupId: string }
  | { type: 'PRIVATE'; userId: number; sourceId: number };

export type WebAuthExchange = {
  sessionToken: string;
  lineUserId: string;
  entryContext: WebEntryContext;
  lineGroupId?: string;
  groupContextToken?: string;
};

export type ManagedGroup = {
  id: number;
  lineGroupId: string;
  name: string;
  groupContextToken: string;
};

async function responseBody<T>(response: Response, fallback: string): Promise<{ ok?: boolean; error?: string } & T> {
  const raw = await response.text();
  if (!raw) {
    if (!response.ok) throw new Error(`${fallback}: ${response.status}`);
    return {} as { ok?: boolean; error?: string } & T;
  }
  try {
    return JSON.parse(raw) as { ok?: boolean; error?: string } & T;
  } catch {
    throw new Error(`${fallback}: ${response.status}${raw.trim() ? ` - ${raw.trim().slice(0, 160)}` : ''}`);
  }
}

function isWebEntryContext(value: unknown): value is WebEntryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (raw.type === 'GROUP') return typeof raw.lineGroupId === 'string' && raw.lineGroupId.length > 0;
  return raw.type === 'PRIVATE'
    && typeof raw.userId === 'number'
    && Number.isSafeInteger(raw.userId)
    && raw.userId > 0
    && typeof raw.sourceId === 'number'
    && Number.isSafeInteger(raw.sourceId)
    && raw.sourceId > 0;
}

export class WebAuthApi {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v1/auth${path}`;
  }

  lineLoginUrl(): string {
    return this.url('/line/start');
  }

  async exchangeEntry(token: string): Promise<WebAuthExchange> {
    const response = await fetch(this.url('/entry/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = await responseBody<WebAuthExchange>(response, '登入連結驗證失敗');
    if (!response.ok) throw new Error(body.error || `登入連結驗證失敗: ${response.status}`);
    if (
      typeof body.sessionToken !== 'string'
      || !body.sessionToken
      || typeof body.lineUserId !== 'string'
      || !body.lineUserId
      || !isWebEntryContext(body.entryContext)
    ) {
      throw new Error('登入連結驗證回傳格式不正確');
    }
    if (body.entryContext.type === 'GROUP' && typeof body.groupContextToken !== 'string') {
      throw new Error('群組登入內容不完整');
    }
    return body;
  }

  async groups(sessionToken: string): Promise<ManagedGroup[]> {
    const response = await fetch(this.url('/groups'), {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await responseBody<{ groups: ManagedGroup[] }>(response, '群組載入失敗');
    if (!response.ok) throw new Error(body.error || `群組載入失敗: ${response.status}`);
    return body.groups;
  }

  async memories(sessionToken: string, query = ''): Promise<CrossGroupMemory[]> {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    const response = await fetch(this.url(`/memories${suffix}`), {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await responseBody<{ memories: CrossGroupMemory[] }>(response, '跨群組記憶搜尋失敗');
    if (!response.ok) throw new Error(body.error || `跨群組記憶搜尋失敗: ${response.status}`);
    return body.memories;
  }
}

export class ManagementApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly groupContextToken: string,
  ) {}

  private async managementRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    headers.set('X-Line-Group-Context', this.groupContextToken);
    if (init?.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/management${path}`, {
      ...init,
      headers,
    });
    const body = await responseBody<T>(response, 'API request failed');
    if (!response.ok) throw new Error(body.error || `API request failed: ${response.status}`);
    return body;
  }

  private async userEnergyRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (init?.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/energy${path}`, {
      ...init,
      headers,
    });
    const body = await responseBody<T>(response, 'Energy API request failed');
    if (!response.ok) throw new Error(body.error || `Energy API request failed: ${response.status}`);
    return body;
  }

  async energy(): Promise<PrivateEnergyOverview> {
    const body = await this.userEnergyRequest<{ energy: PrivateEnergyOverview }>('/me');
    return body.energy;
  }

  async catalog(): Promise<EnergyCatalogResponse> {
    return this.userEnergyRequest<EnergyCatalogResponse>('/catalog');
  }

  async checkout(productCode: CheckoutProductCode): Promise<CheckoutSession> {
    const body = await this.userEnergyRequest<{ checkout: CheckoutSession }>('/checkout', {
      method: 'POST',
      body: JSON.stringify({ productCode, requestKey: crypto.randomUUID() }),
    });
    return body.checkout;
  }

  async rewardedAdNonce(): Promise<RewardedAdNonce> {
    return this.userEnergyRequest<RewardedAdNonce>('/rewarded-ad/nonce', { method: 'POST' });
  }

  async claimRewardedAd(nonce: string, providerEventId: string): Promise<RewardedAdClaim> {
    const body = await this.userEnergyRequest<{ result: RewardedAdClaim }>('/rewarded-ad/claim', {
      method: 'POST',
      body: JSON.stringify({ nonce, providerEventId }),
    });
    return body.result;
  }

  async memories(query = ''): Promise<ManagedMemory[]> {
    const body = await this.managementRequest<{ memories: ManagedMemory[] }>(
      `/memories${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
    );
    return body.memories;
  }

  async updateMemory(id: number, input: { category: string; subject: string | null; content: string }): Promise<void> {
    await this.managementRequest(`/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async deleteMemory(id: number): Promise<void> {
    await this.managementRequest(`/memories/${id}`, { method: 'DELETE' });
  }

  async reminders(): Promise<ManagedReminder[]> {
    const body = await this.managementRequest<{ reminders: ManagedReminder[] }>('/reminders');
    return body.reminders;
  }

  async createReminder(input: { requestKey: string; message: string; scheduledFor: string }): Promise<void> {
    await this.managementRequest('/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async cancelReminder(id: number): Promise<void> {
    await this.managementRequest(`/reminders/${id}`, { method: 'DELETE' });
  }
}
