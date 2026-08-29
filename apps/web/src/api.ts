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

export type Overview = {
  buckets: Record<'WELCOME' | 'AD' | 'PAID', { hasAvailable: boolean; hasReserved: boolean }>;
  aiUsageCount: number;
  rewardedAd: {
    grantCountToday: number;
    lastAcceptedAt: string | null;
  };
};

export type Capabilities = {
  rewardedAdClaimEnabled: boolean;
  rewardedAdDailyLimit: number;
  rewardedAdCooldownMinutes: number;
  reminderCreationEnabled: boolean;
};

export class ManagementApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly lineGroupId: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    headers.set('X-Line-Group-Id', this.lineGroupId);
    if (init?.body) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/management${path}`, {
      ...init,
      headers,
    });
    const body = (await response.json()) as { ok?: boolean; error?: string } & T;
    if (!response.ok) {
      throw new Error(body.error || `API request failed: ${response.status}`);
    }
    return body;
  }

  async overview(): Promise<{ overview: Overview; capabilities: Capabilities }> {
    return this.request('/overview');
  }

  async memories(query = ''): Promise<ManagedMemory[]> {
    const body = await this.request<{ memories: ManagedMemory[] }>(
      `/memories${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
    );
    return body.memories;
  }

  async updateMemory(
    id: number,
    input: { category: string; subject: string | null; content: string },
  ): Promise<void> {
    await this.request(`/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async deleteMemory(id: number): Promise<void> {
    await this.request(`/memories/${id}`, { method: 'DELETE' });
  }

  async reminders(): Promise<ManagedReminder[]> {
    const body = await this.request<{ reminders: ManagedReminder[] }>('/reminders');
    return body.reminders;
  }

  async createReminder(input: {
    requestKey: string;
    message: string;
    scheduledFor: string;
  }): Promise<void> {
    await this.request('/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async cancelReminder(id: number): Promise<void> {
    await this.request(`/reminders/${id}`, { method: 'DELETE' });
  }
}
