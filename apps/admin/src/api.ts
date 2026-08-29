export type AdminOverview = {
  users: number;
  groups: number;
  activeGroups: number;
  aiCallsToday: number;
  aiCostTwdToday: string;
  platformSubsidyUnitsToday: string;
  failedMemoryRequests: number;
  failedChats: number;
  scheduledReminders: number;
  scheduledProactive: number;
};

export type Row = Record<string, unknown>;
export type AdminSetting = {
  key: string;
  section: string;
  label: string;
  kind: 'text' | 'positive-number' | 'positive-integer';
  value: string | null;
  source: 'DATABASE' | 'DEFAULT' | 'UNCONFIGURED';
  updatedBy: string | null;
  updatedAt: string | null;
};

export class AdminApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin${path}`, { ...init, credentials: 'include', headers });
    const body = await response.json() as { ok?: boolean; error?: string } & T;
    if (!response.ok) throw new Error(body.error || `Admin API failed: ${response.status}`);
    return body;
  }

  async overview(): Promise<AdminOverview> { return (await this.request<{ overview: AdminOverview }>('/overview')).overview; }
  async users(query = ''): Promise<Row[]> { return (await this.request<{ users: Row[] }>(`/users${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)).users; }
  async userDetail(id: string | number): Promise<Record<string, unknown>> { return (await this.request<{ detail: Record<string, unknown> }>(`/users/${id}`)).detail; }
  async groups(query = ''): Promise<Row[]> { return (await this.request<{ groups: Row[] }>(`/groups${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)).groups; }
  async groupDetail(id: string | number): Promise<Record<string, unknown>> { return (await this.request<{ detail: Record<string, unknown> }>(`/groups/${id}`)).detail; }
  async failures(): Promise<{ memory: Row[]; chat: Row[]; proactive: Row[] }> { return (await this.request<{ failures: { memory: Row[]; chat: Row[]; proactive: Row[] } }>('/failures')).failures; }
  async settings(): Promise<AdminSetting[]> { return (await this.request<{ settings: AdminSetting[] }>('/settings')).settings; }
  async updateSetting(key: string, value: string): Promise<void> { await this.request(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }); }
  async audit(): Promise<Row[]> { return (await this.request<{ audit: Row[] }>('/audit')).audit; }
  async retryMemoryRequest(id: string | number): Promise<void> { await this.request(`/memory-requests/${id}/retry`, { method: 'POST' }); }
  async cancelProactive(id: string | number): Promise<void> { await this.request(`/proactive/${id}/cancel`, { method: 'POST' }); }
}
