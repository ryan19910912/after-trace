import { describe, expect, it } from 'vitest';
import {
  MemoryAiExecutionError,
  classifyMemoryAiFailure,
  nextMemoryAiRetryAt,
  validateMemoryAiRetryPolicy,
} from './retry-policy';

describe('memory AI retry policy', () => {
  it('preserves typed permanent provider failures', () => {
    expect(
      classifyMemoryAiFailure(
        new MemoryAiExecutionError('GEMINI_AUTH_REJECTED', false, 'unauthorized'),
      ),
    ).toEqual({ code: 'GEMINI_AUTH_REJECTED', retryable: false });
  });

  it('treats unknown failures as retryable but bounded by policy', () => {
    expect(classifyMemoryAiFailure(new Error('boom'))).toEqual({
      code: 'MEMORY_AI_RETRYABLE_FAILURE',
      retryable: true,
    });
  });

  it('uses capped exponential retry delay', () => {
    const policy = validateMemoryAiRetryPolicy({
      maxTransientAttempts: 5,
      baseDelaySeconds: 30,
      maxDelaySeconds: 90,
    });
    const now = new Date('2026-08-29T02:00:00Z');

    expect(nextMemoryAiRetryAt(now, 1, policy)).toEqual(
      new Date('2026-08-29T02:00:30Z'),
    );
    expect(nextMemoryAiRetryAt(now, 2, policy)).toEqual(
      new Date('2026-08-29T02:01:00Z'),
    );
    expect(nextMemoryAiRetryAt(now, 5, policy)).toEqual(
      new Date('2026-08-29T02:01:30Z'),
    );
  });
});
