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

export type AiProConfig = {
  code: 'AI_PRO';
  displayName: string;
  priceTwd: '99.00';
  enabled: boolean;
  aiEnabled: boolean;
  aiMediaIngestion: boolean;
  monthlyAiPointCap: number;
  monthlyProviderCostCapTwd: string;
  perRequestAiPointCap: number | null;
  updatedAt: string;
};

export class AdminCommercialApi {
  private sessionToken: string | null = null;
  constructor(private readonly baseUrl: string) {}

  setSessionToken(token: string | null) {
    this.sessionToken = token?.trim() || null;
  }

  async getFreeAiTrial(): Promise<FreeAiTrialConfig | null> {
    return this.getNullable<FreeAiTrialConfig>('/free-ai-trial');
  }

  async setFreeAiTrial(points: number): Promise<FreeAiTrialConfig> {
    return this.put<FreeAiTrialConfig>('/free-ai-trial', { freeInitialAiTrialPoints: points });
  }

  async getAiPro(): Promise<AiProConfig | null> {
    return this.getNullable<AiProConfig>('/ai-pro');
  }

  async setAiPro(input: {
    enabled: boolean;
    aiMediaIngestion: boolean;
    monthlyAiPointCap: number;
    monthlyProviderCostCapTwd: string;
    perRequestAiPointCap: number | null;
  }): Promise<AiProConfig> {
    return this.put<AiProConfig>('/ai-pro', input);
  }

  private async getNullable<T>(path: string): Promise<T | null> {
    const response = await this.request(path, { method: 'GET' }, true);
    if (response.status === 404) return null;
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.config as T;
  }

  private async put<T>(path: string, value: unknown): Promise<T> {
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

async function parseBody(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  try { return text ? JSON.parse(text) as Record<string, any> : {}; }
  catch { throw new Error(`ADMIN_COMMERCIAL_API_INVALID_RESPONSE_${response.status}`); }
}
