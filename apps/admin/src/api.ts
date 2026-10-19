export type Row = Record<string, unknown>;

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

export class AdminApi {
  private sessionToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setSessionToken(token: string | null) {
    this.sessionToken = token?.trim() || null;
  }

  async login(username: string, password: string): Promise<{ sessionToken: string; username: string }> {
    return this.request('/login', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
  }

  async session(): Promise<{ username: string }> {
    return this.request('/session');
  }

  async profitability(period: AdminProfitabilityPeriod = 'TODAY'): Promise<AdminProfitabilityReport> {
    return (await this.request<{ report: AdminProfitabilityReport }>(
      `/profitability?period=${encodeURIComponent(period)}`,
    )).report;
  }

  async accountLookup(query: string): Promise<Row[]> {
    const value = query.trim();
    if (!value) return [];
    return normalizeAdminApiTimestamps((await this.request<{ accounts: Row[] }>(
      `/accounts?q=${encodeURIComponent(value)}`,
    )).accounts);
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
  }): Promise<AdminAiRuntimeConfig> {
    return (await this.request<{ config: AdminAiRuntimeConfig }>('/ai-runtime', {
      method: 'PUT',
      body: JSON.stringify(input),
    })).config;
  }

  private async request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('Content-Type', 'application/json');
    if (authenticated && this.sessionToken) headers.set('Authorization', `Bearer ${this.sessionToken}`);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin${path}`, { ...init, headers });
    const text = await response.text();
    let body: ({ ok?: boolean; error?: string } & T);
    try { body = text ? JSON.parse(text) as { ok?: boolean; error?: string } & T : {} as { ok?: boolean; error?: string } & T; }
    catch { throw new Error(`ADMIN_API_INVALID_RESPONSE_${response.status}`); }
    const normalized = normalizeAdminApiTimestamps(body) as { ok?: boolean; error?: string } & T;
    if (!response.ok) throw new Error(normalized.error || `ADMIN_API_FAILED_${response.status}`);
    return normalized;
  }
}

export function normalizeAdminApiTimestamps<T>(value: T): T {
  if (typeof value === 'string') return normalizeTimestampText(value) as T;
  if (Array.isArray(value)) return value.map((item) => normalizeAdminApiTimestamps(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = normalizeAdminApiTimestamps(item);
  }
  return result as T;
}

function normalizeTimestampText(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$/.exec(value.trim());
  if (!match) return value;
  const [, datePart, timePart, fractionPart, offsetHour, offsetMinute] = match;
  const milliseconds = fractionPart ? `.${fractionPart.slice(0, 3).padEnd(3, '0')}` : '';
  return `${datePart}T${timePart}${milliseconds}${offsetHour}:${offsetMinute ?? '00'}`;
}
