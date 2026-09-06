import { describe, expect, it } from 'vitest';
import { anomalyErrorCode, anomalyErrorDetail, anomalyErrorSummary } from './anomalies';

describe('anomaly error diagnostics', () => {
  it('surfaces a nested Postgres cause in the primary summary and code', () => {
    const postgres = Object.assign(new Error('column scope.reserved_points does not exist'), {
      code: '42703',
      severity: 'ERROR',
      column: 'reserved_points',
      detail: 'Missing column in Dev schema',
    });
    const drizzle = new Error('Failed query: SELECT ...', { cause: postgres });

    expect(anomalyErrorCode(drizzle, 'GROUP_MESSAGE_FAILED')).toBe('42703');
    expect(anomalyErrorSummary(drizzle, 'fallback')).toContain('Failed query: SELECT ...');
    expect(anomalyErrorSummary(drizzle, 'fallback')).toContain('Caused by: [42703] column scope.reserved_points does not exist');
    expect(anomalyErrorSummary(drizzle, 'fallback')).toContain('Detail: Missing column in Dev schema');
    expect(anomalyErrorDetail(drizzle)).toMatchObject({
      message: 'Failed query: SELECT ...',
      cause: {
        code: '42703',
        severity: 'ERROR',
        column: 'reserved_points',
      },
    });
  });
});
