import { describe, expect, it } from 'vitest';
import { classifyAttachmentRetry } from './attachment-retry-policy';

describe('classifyAttachmentRetry', () => {
  it.each([
    'AI_RUNTIME_CONFIG_MISSING',
    'AI_QUOTA_EXHAUSTED',
    'NO_SUBSCRIPTION',
    'SUBSCRIPTION_INACTIVE',
    'PLAN_DISABLED',
    'NOT_YET_EFFECTIVE',
    'PERIOD_NOT_STARTED',
    'PERIOD_EXPIRED',
    'LINE_CONTENT_NOT_READY',
  ])('marks %s as safe pre-provider retry', (reason) => {
    expect(classifyAttachmentRetry(reason)).toEqual({
      disposition: 'SAFE_RETRY',
      canRetryWithoutProviderReplay: true,
      reason,
    });
  });

  it.each([
    'LINE_CONTENT_EXPIRED',
    'LINE_CONTENT_EMPTY',
    'LINE_CONTENT_TOO_LARGE',
    'LINE_CONTENT_NOT_RETRIEVABLE',
    'ATTACHMENT_UNSUPPORTED',
  ])('requires resend/replacement for %s', (reason) => {
    const decision = classifyAttachmentRetry(reason);
    expect(decision.disposition).toBe('RESEND_REQUIRED');
    expect(decision.canRetryWithoutProviderReplay).toBe(false);
  });

  it.each([
    'ATTACHMENT_INGESTION_FAILED',
    'AI_USAGE_EXCEEDED_RESERVATION',
    'ACTUAL_EXCEEDS_RESERVED',
    'RESERVATION_NOT_FOUND',
    'RESERVATION_NOT_ACTIVE',
    'SOURCE_NOT_FOUND',
    'SOME_NEW_PROVIDER_ERROR',
  ])('never auto-replays uncertain failure %s', (reason) => {
    const decision = classifyAttachmentRetry(reason);
    expect(decision.disposition).toBe('MANUAL_REVIEW');
    expect(decision.canRetryWithoutProviderReplay).toBe(false);
  });

  it('normalizes error-code casing but defaults unknown/empty states conservatively', () => {
    expect(classifyAttachmentRetry(' ai_quota_exhausted ').disposition).toBe('SAFE_RETRY');
    expect(classifyAttachmentRetry(null)).toEqual({
      disposition: 'MANUAL_REVIEW',
      canRetryWithoutProviderReplay: false,
      reason: 'UNKNOWN_ATTACHMENT_FAILURE',
    });
  });
});
