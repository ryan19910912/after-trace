export type FreeAiTrialConfigSnapshot = {
  freeInitialAiTrialPoints: number;
  updatedBy: string | null;
  updatedAt: string;
  recipients: number;
  exhaustedRecipients: number;
  issuedPoints: number;
  remainingPoints: number;
  consumedPoints: number;
};

export type AiProConfigSnapshot = {
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

export type AiProConfigInput = {
  enabled: boolean;
  aiMediaIngestion?: boolean;
  monthlyAiPointCap: number;
  monthlyProviderCostCapTwd: string;
  perRequestAiPointCap?: number | null;
};

export interface CommercialConfigRepository {
  getFreeAiTrialConfig(): Promise<FreeAiTrialConfigSnapshot | null>;
  setFreeAiTrialPoints(points: number, actor: string): Promise<FreeAiTrialConfigSnapshot>;
  getAiProConfig(): Promise<AiProConfigSnapshot | null>;
  setAiProConfig(input: AiProConfigInput, actor: string): Promise<AiProConfigSnapshot>;
}

export class CommercialConfigService {
  constructor(private readonly repository: CommercialConfigRepository) {}

  getFreeAiTrialConfig(): Promise<FreeAiTrialConfigSnapshot | null> {
    return this.repository.getFreeAiTrialConfig();
  }

  setFreeAiTrialPoints(points: number, actor: string): Promise<FreeAiTrialConfigSnapshot> {
    if (!Number.isSafeInteger(points) || points <= 0 || points > 2_000_000_000) {
      throw new Error('INVALID_FREE_INITIAL_AI_TRIAL_POINTS');
    }
    return this.repository.setFreeAiTrialPoints(points, adminActor(actor));
  }

  getAiProConfig(): Promise<AiProConfigSnapshot | null> {
    return this.repository.getAiProConfig();
  }

  setAiProConfig(input: AiProConfigInput, actor: string): Promise<AiProConfigSnapshot> {
    if (!Number.isSafeInteger(input.monthlyAiPointCap) || input.monthlyAiPointCap <= 0 || input.monthlyAiPointCap > 2_000_000_000) {
      throw new Error('INVALID_AI_PRO_MONTHLY_POINT_CAP');
    }
    const providerCostCap = positiveDecimal(input.monthlyProviderCostCapTwd, 'INVALID_AI_PRO_PROVIDER_COST_CAP');
    const perRequest = input.perRequestAiPointCap === undefined || input.perRequestAiPointCap === null
      ? null
      : input.perRequestAiPointCap;
    if (perRequest !== null && (!Number.isSafeInteger(perRequest) || perRequest <= 0 || perRequest > input.monthlyAiPointCap)) {
      throw new Error('INVALID_AI_PRO_PER_REQUEST_CAP');
    }
    return this.repository.setAiProConfig({
      enabled: Boolean(input.enabled),
      aiMediaIngestion: input.aiMediaIngestion !== false,
      monthlyAiPointCap: input.monthlyAiPointCap,
      monthlyProviderCostCapTwd: providerCostCap,
      perRequestAiPointCap: perRequest,
    }, adminActor(actor));
  }
}

function adminActor(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error('INVALID_ADMIN_ACTOR');
  return normalized;
}

function positiveDecimal(value: string, error: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) throw new Error(error);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) throw new Error(error);
  return normalized;
}
