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

export class ManagementApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly lineGroupId: string,
  ) {}

  private async managementRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    headers.set('X-Line-Group-Id', this.lineGroupId);
    if (init?.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/management${path}`, {
      ...init,
      headers,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string } & T;
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
    const body = (await response.json()) as { ok?: boolean; error?: string } & T;
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
