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

export interface CommercialConfigRepository {
  getFreeAiTrialConfig(): Promise<FreeAiTrialConfigSnapshot | null>;
  setFreeAiTrialPoints(points: number, actor: string): Promise<FreeAiTrialConfigSnapshot>;
}

export class CommercialConfigService {
  constructor(private readonly repository: CommercialConfigRepository) {}

  getFreeAiTrialConfig(): Promise<FreeAiTrialConfigSnapshot | null> {
    return this.repository.getFreeAiTrialConfig();
  }

  setFreeAiTrialPoints(points: number, actor: string): Promise<FreeAiTrialConfigSnapshot> {
    if (!Number.isSafeInteger(points) || points < 0 || points > 2_000_000_000) {
      throw new Error('INVALID_FREE_INITIAL_AI_TRIAL_POINTS');
    }
    const normalizedActor = actor.trim();
    if (!normalizedActor || normalizedActor.length > 128) throw new Error('INVALID_ADMIN_ACTOR');
    return this.repository.setFreeAiTrialPoints(points, normalizedActor);
  }
}
