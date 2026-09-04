export type AdminOverview = {
  users: number;
  oaFriends: number;
  groups: number;
  activeGroups: number;
  records: number;
  recordsToday: number;
  aiCallsToday: number;
  aiPointsToday: number;
  platformSubsidizedPointsToday: number;
  aiCostTwdToday: string;
  platformSubsidizedCostTwdToday: string;
  missingAiCostTwdRequestsToday: number;
  missingSubsidyCostTwdRequestsToday: number;
  openAnomalies: number;
  failedAttachments: number;
  failedNormalizations: number;
  feedback30d: number;
};

export type AdminProfitabilityPeriod = 'TODAY' | '7D' | '30D' | 'BILLING_MONTH';

export type AdminProfitabilityBreakdownRow = {
  key: string;
  requests: number;
  activeUsers: number;
  chargedUsers: number;
  customerPointsCharged: number;
  platformSubsidizedPoints: number;
  providerCostUsd: string;
  providerCostTwd: string;
  missingProviderCostTwdRequests: number;
};

export type AdminProfitabilityReport = {
  summary: {
    period: AdminProfitabilityPeriod;
    from: string;
    to: string;
    requests: number;
    activeUsers: number;
    chargedUsers: number;
    customerPointsCharged: number;
    platformSubsidizedPoints: number;
    providerCostUsd: string;
    providerCostTwd: string;
    platformSubsidizedCostUsd: string;
    platformSubsidizedCostTwd: string;
    missingProviderCostTwdRequests: number;
    missingSubsidyCostTwdRequests: number;
    averagePointsPerRequest: number;
    averageProviderCostUsdPerRequest: string;
    averageProviderCostTwdPerRequest: string | null;
    averagePointsPerActiveUser: number;
    averageProviderCostUsdPerActiveUser: string;
    averageProviderCostTwdPerActiveUser: string | null;
    averagePointsPerChargedUser: number;
    revenueTwd: null;
    realizedAiCostRatio: null;
    realizedGrossMargin: null;
    revenueStatus: 'UNAVAILABLE_NO_SUCCESSFUL_PAYMENT_FACT';
  };
  byModel: AdminProfitabilityBreakdownRow[];
  byOperation: AdminProfitabilityBreakdownRow[];
  bySourceType: AdminProfitabilityBreakdownRow[];
  byGrantType: Array<{ grantType: string; requests: number; pointsCharged: number }>;
  byPlan: Array<{ planCode: string; requests: number; pointsCharged: number }>;
  grantInventory: Array<{
    grantType: string;
    grants: number;
    exhaustedGrants: number;
    originalPoints: number;
    usedPoints: number;
    reservedPoints: number;
    remainingPoints: number;
    utilizationPercent: number;
    exhaustionPercent: number;
  }>;
};

export type Row = Record<string, unknown>;

export type AdminCapabilityDefinition = {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string';
  defaultValue: boolean | number | string;
  min?: number;
  max?: number;
  description?: string;
  shipped?: boolean;
};

export type AdminPlan = {
  id?: string;
  code: string;
  display_name: string;
  price_twd: string;
  rank: number;
  enabled: boolean;
  subscription_period_points: number;
  capabilities: Record<string, boolean | number | string>;
  created_at?: string;
  updated_at?: string;
};

export type AdminAiRuntimeConfig = {
  id?: number;
  provider: string;
  model: string;
  input_usd_per_million: string;
  output_usd_per_million: string;
  audio_usd_per_million: string | null;
  image_usd_per_million: string | null;
  usd_twd_rate: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AdminAnomalies = {
  events: Row[];
  attachments: Row[];
  normalizations: Row[];
};

export type UserListFilters = {
  query?: string;
  planCode?: string;
  userType?: '' | 'INDIVIDUAL' | 'GROUP_ENABLED';
  sortUpdated?: 'ASC' | 'DESC';
};

export class AdminApi {
  private sessionToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setSessionToken(token: string | null) {
    this.sessionToken = token?.trim() || null;
  }

  async login(username: string, password: string): Promise<{ sessionToken: string; username: string }> {
    return this.request('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }, false);
  }

  async session(): Promise<{ username: string }> {
    return this.request('/session');
  }

  async overview(): Promise<AdminOverview> {
    return (await this.request<{ overview: AdminOverview }>('/overview')).overview;
  }

  async profitability(period: AdminProfitabilityPeriod = 'TODAY'): Promise<AdminProfitabilityReport> {
    return (await this.request<{ report: AdminProfitabilityReport }>(
      `/profitability?period=${encodeURIComponent(period)}`,
    )).report;
  }

  async users(filters: UserListFilters = {}): Promise<Row[]> {
    const params = new URLSearchParams();
    if (filters.query?.trim()) params.set('q', filters.query.trim());
    if (filters.planCode?.trim()) params.set('plan', filters.planCode.trim());
    if (filters.userType) params.set('type', filters.userType);
    params.set('sort', filters.sortUpdated ?? 'DESC');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return applyServerLabels((await this.request<{ users: Row[] }>(`/users${suffix}`)).users);
  }

  async userDetail(id: string | number): Promise<Record<string, unknown>> {
    const [detailResponse, plansResponse] = await Promise.all([
      this.request<{ detail: Record<string, unknown> }>(`/users/${id}`),
      this.request<{ plans: AdminPlan[] }>('/plans'),
    ]);
    const detail = detailResponse.detail;
    const user = asRow(detail.user);
    const plan = plansResponse.plans.find((item) => item.code === String(user.plan_code ?? ''));
    const effectiveRow = { ...user, plan_enabled: plan?.enabled ?? false };
    return applyServerLabels({
      ...detail,
      user: {
        ...effectiveRow,
        subscription_effective_state: effectiveSubscriptionState(effectiveRow),
      },
    });
  }

  async updateUserSubscription(id: string | number, planCode: string, currentPeriodEnd?: string | null): Promise<void> {
    await this.request(`/users/${id}/subscription`, {
      method: 'PUT',
      body: JSON.stringify({ planCode, currentPeriodEnd }),
    });
  }

  async groups(query = ''): Promise<Row[]> {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return applyServerLabels((await this.request<{ groups: Row[] }>(`/groups${suffix}`)).groups);
  }

  async groupDetail(id: string | number): Promise<Record<string, unknown>> {
    const detail = (await this.request<{ detail: Record<string, unknown> }>(`/groups/${id}`)).detail;
    return applyServerLabels(detail);
  }

  async capabilityDefinitions(): Promise<AdminCapabilityDefinition[]> {
    return (await this.request<{ capabilityDefinitions: AdminCapabilityDefinition[] }>('/capabilities')).capabilityDefinitions;
  }

  async plans(): Promise<AdminPlan[]> {
    return (await this.request<{ plans: AdminPlan[] }>('/plans')).plans;
  }

  async savePlan(input: {
    code: string;
    displayName: string;
    priceTwd: string;
    rank: number;
    enabled: boolean;
    subscriptionPeriodPoints: number;
    capabilities: Record<string, boolean | number | string>;
  }): Promise<void> {
    await this.request(`/plans/${encodeURIComponent(input.code)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async aiRuntime(): Promise<AdminAiRuntimeConfig | null> {
    return (await this.request<{ config: AdminAiRuntimeConfig | null }>('/ai-runtime')).config;
  }

  async saveAiRuntime(input: {
    provider: string;
    model: string;
    inputUsdPerMillion: string;
    outputUsdPerMillion: string;
    audioUsdPerMillion: string | null;
    imageUsdPerMillion: string | null;
    usdTwdRate: string | null;
  }): Promise<void> {
    await this.request('/ai-runtime', { method: 'PUT', body: JSON.stringify(input) });
  }

  async feedback(): Promise<Row[]> {
    return applyServerLabels((await this.request<{ feedback: Row[] }>('/feedback')).feedback);
  }

  async anomalies(): Promise<AdminAnomalies> {
    return applyServerLabels((await this.request<{ anomalies: AdminAnomalies }>('/anomalies')).anomalies);
  }

  async updateAnomaly(id: string | number, status: 'OPEN' | 'RESOLVED' | 'IGNORED'): Promise<void> {
    await this.request(`/anomalies/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }

  async audit(): Promise<Row[]> {
    return applyServerLabels((await this.request<{ audit: Row[] }>('/audit')).audit);
  }

  private async request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('Content-Type', 'application/json');
    if (authenticated && this.sessionToken) headers.set('Authorization', `Bearer ${this.sessionToken}`);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin${path}`, { ...init, headers });
    const text = await response.text();
    let body: ({ ok?: boolean; error?: string } & T) | null = null;
    try {
      body = text ? JSON.parse(text) as { ok?: boolean; error?: string } & T : {} as { ok?: boolean; error?: string } & T;
    } catch {
      throw new Error(`ADMIN_API_INVALID_RESPONSE_${response.status}`);
    }
    if (!response.ok) throw new Error(body.error || `ADMIN_API_FAILED_${response.status}`);
    return body;
  }
}

export function effectiveSubscriptionState(row: Row, now = new Date()): string {
  const persisted = String(row.subscription_status ?? '').toUpperCase();
  if (!persisted) return 'NO_SUBSCRIPTION';
  if (persisted !== 'ACTIVE') return persisted;
  if (row.plan_enabled === false) return 'PLAN_DISABLED';

  const effectiveAt = optionalDate(row.effective_at);
  const periodStart = optionalDate(row.current_period_start);
  const periodEnd = optionalDate(row.current_period_end);
  const timestamp = now.getTime();

  if (effectiveAt && timestamp < effectiveAt.getTime()) return 'NOT_YET_EFFECTIVE';
  if (periodStart && timestamp < periodStart.getTime()) return 'PERIOD_NOT_STARTED';
  if (periodEnd && timestamp >= periodEnd.getTime()) return 'PERIOD_EXPIRED';
  return 'ACTIVE';
}

function applyServerLabels<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => applyServerLabels(item)) as T;
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) result[key] = applyServerLabels(item);

  for (const [key, item] of Object.entries(source)) {
    if (!key.endsWith('_label') || typeof item !== 'string') continue;
    const baseKey = key.slice(0, -6);
    if (!(baseKey in source)) continue;
    result[`${baseKey}_code`] = source[baseKey];
    result[baseKey] = item;
  }
  return result as T;
}

function optionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
