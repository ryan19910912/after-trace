import { describe, expect, it } from 'vitest';
import {
  CommercialConfigService,
  type AiProConfigSnapshot,
  type CommercialConfigRepository,
  type FreeAiTrialConfigSnapshot,
} from './commercial-config';

class FakeRepository implements CommercialConfigRepository {
  saved: { points: number; actor: string } | null = null;
  savedAiPro: { input: Parameters<CommercialConfigRepository['setAiProConfig']>[0]; actor: string } | null = null;
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
  aiPro: AiProConfigSnapshot = {
    code: 'AI_PRO',
    displayName: 'AI Pro',
    priceTwd: '99.00',
    enabled: true,
    aiEnabled: true,
    aiMediaIngestion: true,
    aiNaturalSearch: true,
    aiRelatedRecords: true,
    aiTimeRangeSummary: true,
    aiRecordRewrite: true,
    monthlyAiPointCap: 1000,
    monthlyProviderCostCapTwd: '30',
    perRequestAiPointCap: 200,
    updatedAt: '2026-09-07T00:00:00.000Z',
  };

  async getFreeAiTrialConfig() { return this.snapshot; }
  async setFreeAiTrialPoints(points: number, actor: string) {
    this.saved = { points, actor };
    return { ...this.snapshot, freeInitialAiTrialPoints: points, updatedBy: actor };
  }
  async getAiProConfig() { return this.aiPro; }
  async setAiProConfig(input: Parameters<CommercialConfigRepository['setAiProConfig']>[0], actor: string) {
    this.savedAiPro = { input, actor };
    return { ...this.aiPro, ...input } as AiProConfigSnapshot;
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

  it('keeps AI Pro at the fixed V1 commercial price while accepting hard caps and capability toggles', async () => {
    const repository = new FakeRepository();
    const service = new CommercialConfigService(repository);
    const result = await service.setAiProConfig({
      enabled: true,
      aiMediaIngestion: false,
      aiNaturalSearch: false,
      aiRelatedRecords: false,
      aiTimeRangeSummary: false,
      aiRecordRewrite: false,
      monthlyAiPointCap: 2000,
      monthlyProviderCostCapTwd: '30',
      perRequestAiPointCap: 250,
    }, 'operator');
    expect(result.priceTwd).toBe('99.00');
    expect(repository.savedAiPro).toEqual({
      actor: 'operator',
      input: {
        enabled: true,
        aiMediaIngestion: false,
        aiNaturalSearch: false,
        aiRelatedRecords: false,
        aiTimeRangeSummary: false,
        aiRecordRewrite: false,
        monthlyAiPointCap: 2000,
        monthlyProviderCostCapTwd: '30',
        perRequestAiPointCap: 250,
      },
    });
  });

  it('defaults accepted AI Pro capabilities on when omitted without adding another paid tier', async () => {
    const repository = new FakeRepository();
    await new CommercialConfigService(repository).setAiProConfig({
      enabled: true,
      monthlyAiPointCap: 1000,
      monthlyProviderCostCapTwd: '30',
      perRequestAiPointCap: null,
    }, 'operator');
    expect(repository.savedAiPro?.input).toMatchObject({
      aiMediaIngestion: true,
      aiNaturalSearch: true,
      aiRelatedRecords: true,
      aiTimeRangeSummary: true,
      aiRecordRewrite: true,
    });
  });

  it('rejects an AI Pro per-request cap larger than its monthly cap', async () => {
    const service = new CommercialConfigService(new FakeRepository());
    await expect(service.setAiProConfig({
      enabled: true,
      monthlyAiPointCap: 100,
      monthlyProviderCostCapTwd: '30',
      perRequestAiPointCap: 101,
    }, 'operator')).rejects.toThrow('INVALID_AI_PRO_PER_REQUEST_CAP');
  });
});
