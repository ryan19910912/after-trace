import { describe, expect, it } from 'vitest';
import {
  AiRelatedRecordsService,
  type AiRelatedRecordsRepository,
} from './ai-related-records';

function repository(calls: string[], options: { enabled?: boolean; found?: boolean } = {}): AiRelatedRecordsRepository {
  return {
    async relatedEnabled() {
      calls.push('capability');
      return options.enabled !== false;
    },
    async findRelated(input) {
      calls.push(`find:${input.sourceId}:${input.recordId}:${input.limit}`);
      if (options.found === false) return { targetFound: false, records: [] };
      return {
        targetFound: true,
        records: [{
          id: 91,
          sourceId: input.sourceId,
          inputType: 'TEXT',
          title: '晴空案收款',
          rawText: '晴空案收到第二期款項。',
          occurredAt: '2026-09-06T02:00:00.000Z',
          createdAt: '2026-09-06T02:05:00.000Z',
          relevanceScore: 12,
        }],
      };
    },
  };
}

describe('AiRelatedRecordsService', () => {
  it('checks Source/user entitlement before capability or target Record existence', async () => {
    const calls: string[] = [];
    const service = new AiRelatedRecordsService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'BLOCKED',
          allowed: false,
          reason: 'SOURCE_NOT_AUTHORIZED',
          remainingPoints: null,
          periodEndsAt: null,
          perRequestAiPointCap: null,
        };
      },
    });

    const result = await service.related({ userId: 7, sourceId: 12, recordId: 55 });

    expect(result).toMatchObject({ status: 'BLOCKED', decision: { reason: 'SOURCE_NOT_AUTHORIZED' } });
    expect(calls).toEqual(['resolve']);
  });

  it('fails closed when the operator disables related Records', async () => {
    const calls: string[] = [];
    const service = new AiRelatedRecordsService(repository(calls, { enabled: false }), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'AI_PRO',
          allowed: true,
          reason: 'AI_PRO_AVAILABLE',
          remainingPoints: 100,
          periodEndsAt: '2026-10-07T00:00:00.000Z',
          perRequestAiPointCap: 100,
        };
      },
    });

    expect(await service.related({ userId: 7, sourceId: 12, recordId: 55 })).toEqual({
      status: 'FAILED',
      reason: 'AI_RELATED_RECORDS_DISABLED',
    });
    expect(calls).toEqual(['resolve', 'capability']);
  });

  it('allows an eligible FREE trial to use deterministic ranking without provider accounting', async () => {
    const calls: string[] = [];
    const service = new AiRelatedRecordsService(repository(calls), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'FREE_TRIAL',
          allowed: true,
          reason: 'FREE_TRIAL_AVAILABLE',
          remainingPoints: 60,
          periodEndsAt: null,
          perRequestAiPointCap: 100,
        };
      },
    });

    const result = await service.related({ userId: 7, sourceId: 12, recordId: 55, limit: 6 });

    expect(result).toMatchObject({
      status: 'RESULTS',
      entitlementSource: 'FREE_TRIAL',
      recordId: 55,
      records: [{ id: 91, relevanceScore: 12 }],
    });
    expect(calls).toEqual(['resolve', 'capability', 'find:12:55:6']);
  });

  it('returns not found only after the Source entitlement boundary passes', async () => {
    const calls: string[] = [];
    const service = new AiRelatedRecordsService(repository(calls, { found: false }), {
      async resolve() {
        calls.push('resolve');
        return {
          source: 'AI_PRO',
          allowed: true,
          reason: 'AI_PRO_AVAILABLE',
          remainingPoints: 100,
          periodEndsAt: '2026-10-07T00:00:00.000Z',
          perRequestAiPointCap: null,
        };
      },
    });

    expect(await service.related({ userId: 7, sourceId: 12, recordId: 404 })).toEqual({
      status: 'NOT_FOUND',
      reason: 'RECORD_NOT_FOUND',
    });
    expect(calls).toEqual(['resolve', 'capability', 'find:12:404:8']);
  });
});
