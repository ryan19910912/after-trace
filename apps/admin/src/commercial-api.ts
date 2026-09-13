export type FreeAiTrialConfig = {
  freeInitialAiTrialPoints: number;
  updatedBy: string | null;
  updatedAt: string;
  recipients: number;
  exhaustedRecipients: number;
  issuedPoints: number;
  remainingPoints: number;
  consumedPoints: number;
};

export type SubscriptionPlanConfig = {
  code: string;
  displayName: string;
  priceTwd: string;
  enabled: boolean;
  aiEnabled: boolean;
  aiMediaIngestion: boolean;
  aiNaturalSearch: boolean;
  aiRelatedRecords: boolean;
  aiTimeRangeSummary: boolean;
  aiRecordRewrite: boolean;
  aiTaskProposal: boolean;
  monthlyAiPointCap: number;
  monthlyProviderCostCapTwd: string;
  perRequestAiPointCap: number | null;
  maxImagesPerRequest: number;
  maxImageBytes: number;
  maxAudioSeconds: number;
  maxAudioBytes: number;
  maxFileBytes: number;
  updatedAt: string;
};
export type AiProConfig = SubscriptionPlanConfig;
export type SubscriptionPlanInput = Omit<SubscriptionPlanConfig, 'code' | 'aiEnabled' | 'updatedAt'> & { code?: string };

export class AdminCommercialApi {
  private sessionToken: string | null = null;
  constructor(private readonly baseUrl: string) {}

  setSessionToken(token: string | null) { this.sessionToken = token?.trim() || null; }
  async getFreeAiTrial(): Promise<FreeAiTrialConfig | null> { return this.getNullable<FreeAiTrialConfig>('/free-ai-trial'); }
  async setFreeAiTrial(points: number): Promise<FreeAiTrialConfig> { return this.putConfig<FreeAiTrialConfig>('/free-ai-trial', { freeInitialAiTrialPoints: points }); }
  async getAiPro(): Promise<AiProConfig | null> { return this.getNullable<AiProConfig>('/ai-pro'); }
  async getPlans(): Promise<SubscriptionPlanConfig[]> {
    const response = await this.request('/plans', { method: 'GET' }, true);
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return Array.isArray(body.plans) ? body.plans as SubscriptionPlanConfig[] : [];
  }
  async createPlan(input: SubscriptionPlanInput): Promise<SubscriptionPlanConfig> {
    const response = await this.request('/plans', { method: 'POST', body: JSON.stringify(input) }, true);
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.plan as SubscriptionPlanConfig;
  }
  async updatePlan(code: string, input: SubscriptionPlanInput): Promise<SubscriptionPlanConfig> {
    const response = await this.request(`/plans/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(input) }, true);
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.plan as SubscriptionPlanConfig;
  }

  async setAiPro(input: {
    enabled: boolean; aiMediaIngestion: boolean; aiNaturalSearch: boolean; aiRelatedRecords: boolean; aiTimeRangeSummary: boolean; aiRecordRewrite: boolean; aiTaskProposal: boolean;
    monthlyAiPointCap: number; monthlyProviderCostCapTwd: string; perRequestAiPointCap: number | null;
  }): Promise<AiProConfig> { return this.putConfig<AiProConfig>('/ai-pro', input); }

  private async getNullable<T>(path: string): Promise<T | null> {
    const response = await this.request(path, { method: 'GET' }, true);
    if (response.status === 404) return null;
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.config as T;
  }
  private async putConfig<T>(path: string, value: unknown): Promise<T> {
    const response = await this.request(path, { method: 'PUT', body: JSON.stringify(value) }, true);
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.config as T;
  }
  private request(path: string, init: RequestInit, authenticated: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (authenticated && this.sessionToken) headers.set('Authorization', `Bearer ${this.sessionToken}`);
    return fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin/commercial-config${path}`, { ...init, headers });
  }
}

type AdminCommercialResponseBody = { error?: string; config?: unknown; plan?: unknown; plans?: unknown };
async function parseBody(response: Response): Promise<AdminCommercialResponseBody> {
  const text = await response.text();
  try { const parsed = text ? JSON.parse(text) as unknown : {}; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AdminCommercialResponseBody : {}; }
  catch { throw new Error(`ADMIN_COMMERCIAL_API_INVALID_RESPONSE_${response.status}`); }
}
