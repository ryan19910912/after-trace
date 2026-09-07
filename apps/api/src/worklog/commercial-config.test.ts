import { describe, expect, it } from 'vitest';
import {
  CommercialConfigService,
  type CommercialConfigRepository,
  type FreeAiTrialConfigSnapshot,
} from './commercial-config';

class FakeRepository implements CommercialConfigRepository {
  saved: { points: number; actor: string } | null = null;
  snapshot: FreeAiTrialConfigSnapshot = {
    freeInitialAiTrialPoints: 500,
    updatedBy: 'admin',
    updatedAt: '2026-09-07T00:00:00.000Z',
    recipients: 10,
    exhaustedRecipients: 2,
    issuedPoints: 5000,
    remainingPoints: 3000,
    consumedPoints: 2000,
  };

  async getFreeAiTrialConfig() {
    return this.snapshot;
  }

  async setFreeAiTrialPoints(points: number, actor: string) {
    this.saved = { points, actor };
    return { ...this.snapshot, freeInitialAiTrialPoints: points, updatedBy: actor };
  }
}

describe('CommercialConfigService', () => {
  it('accepts a positive Admin-configured FREE initial AI trial point quantity', async () => {
    const repository = new FakeRepository();
    const service = new CommercialConfigService(repository);

    const result = await service.setFreeAiTrialPoints(800, 'operator');

    expect(repository.saved).toEqual({ points: 800, actor: 'operator' });
    expect(result.freeInitialAiTrialPoints).toBe(800);
  });

  it('rejects zero instead of silently creating a zero-value trial', async () => {
    const service = new CommercialConfigService(new FakeRepository());
    await expect(service.setFreeAiTrialPoints(0, 'operator'))
      .rejects.toThrow('INVALID_FREE_INITIAL_AI_TRIAL_POINTS');
  });

  it('does not express the trial config as a TWD value', async () => {
    const config = await new CommercialConfigService(new FakeRepository()).getFreeAiTrialConfig();
    expect(config).not.toHaveProperty('priceTwd');
    expect(config).not.toHaveProperty('trialTwd');
  });
});
