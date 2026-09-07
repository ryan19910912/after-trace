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

export class AdminCommercialApi {
  private sessionToken: string | null = null;
  constructor(private readonly baseUrl: string) {}

  setSessionToken(token: string | null) {
    this.sessionToken = token?.trim() || null;
  }

  async getFreeAiTrial(): Promise<FreeAiTrialConfig | null> {
    const response = await this.request('/free-ai-trial', { method: 'GET' }, true);
    if (response.status === 404) return null;
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.config as FreeAiTrialConfig;
  }

  async setFreeAiTrial(points: number): Promise<FreeAiTrialConfig> {
    const response = await this.request('/free-ai-trial', {
      method: 'PUT',
      body: JSON.stringify({ freeInitialAiTrialPoints: points }),
    }, true);
    const body = await parseBody(response);
    if (!response.ok) throw new Error(body.error || `ADMIN_COMMERCIAL_API_FAILED_${response.status}`);
    return body.config as FreeAiTrialConfig;
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
