import { describe, expect, it } from 'vitest';
import { effectiveSubscriptionState } from './api';

describe('effectiveSubscriptionState', () => {
  const now = new Date('2026-09-02T08:30:00.000Z');

  it('does not trust a stale persisted ACTIVE status after the period ended', () => {
    expect(effectiveSubscriptionState({
      subscription_status: 'ACTIVE',
      plan_enabled: true,
      effective_at: '2026-08-01T00:00:00.000Z',
      current_period_start: '2026-08-01T00:00:00.000Z',
      current_period_end: '2026-09-01T00:00:00.000Z',
    }, now)).toBe('PERIOD_EXPIRED');
  });

  it('distinguishes future effective and future period states', () => {
    expect(effectiveSubscriptionState({
      subscription_status: 'ACTIVE',
      plan_enabled: true,
      effective_at: '2026-09-03T00:00:00.000Z',
      current_period_start: '2026-09-03T00:00:00.000Z',
    }, now)).toBe('NOT_YET_EFFECTIVE');

    expect(effectiveSubscriptionState({
      subscription_status: 'ACTIVE',
      plan_enabled: true,
      effective_at: '2026-09-01T00:00:00.000Z',
      current_period_start: '2026-09-03T00:00:00.000Z',
    }, now)).toBe('PERIOD_NOT_STARTED');
  });

  it('treats a disabled plan as ineffective even when the subscription row is ACTIVE', () => {
    expect(effectiveSubscriptionState({
      subscription_status: 'ACTIVE',
      plan_enabled: false,
      effective_at: '2026-09-01T00:00:00.000Z',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    }, now)).toBe('PLAN_DISABLED');
  });

  it('preserves explicit inactive database statuses', () => {
    expect(effectiveSubscriptionState({ subscription_status: 'PAST_DUE' }, now)).toBe('PAST_DUE');
    expect(effectiveSubscriptionState({ subscription_status: 'CANCELED' }, now)).toBe('CANCELED');
    expect(effectiveSubscriptionState({}, now)).toBe('NO_SUBSCRIPTION');
  });
});
