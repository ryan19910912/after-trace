import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { DrizzleWorklogLineSystemQueryRepository } from './drizzle-line-system-query';

describe('DrizzleWorklogLineSystemQueryRepository allowance', () => {
  it('aggregates scoped total and remaining points in TypeScript', async () => {
    const database = {
      execute: async () => ({
        rows: [
          {
            original_points: 400_000,
            remaining_points: 320_000,
            cap_points: null,
            used_points: 80_000,
            reserved_points: 0,
          },
          {
            original_points: 100_000,
            remaining_points: 90_000,
            cap_points: 50_000,
            used_points: 10_000,
            reserved_points: 5_000,
          },
        ],
      }),
    } as unknown as Database;

    const repository = new DrizzleWorklogLineSystemQueryRepository(database);
    await expect(repository.allowance(7, 20, new Date('2026-09-06T12:00:00Z'))).resolves.toEqual({
      totalPoints: 450_000,
      remainingPoints: 355_000,
    });
  });
});
