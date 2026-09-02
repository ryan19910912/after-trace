export type AttachmentRetryDisposition =
  | 'SAFE_RETRY'
  | 'RESEND_REQUIRED'
  | 'MANUAL_REVIEW';

export type AttachmentRetryDecision = {
  disposition: AttachmentRetryDisposition;
  canRetryWithoutProviderReplay: boolean;
  reason: string;
};

const SAFE_PRE_PROVIDER_FAILURES = new Set([
  'AI_RUNTIME_CONFIG_MISSING',
  'AI_QUOTA_EXHAUSTED',
  'NO_SUBSCRIPTION',
  'SUBSCRIPTION_INACTIVE',
  'PLAN_DISABLED',
  'NOT_YET_EFFECTIVE',
  'PERIOD_NOT_STARTED',
  'PERIOD_EXPIRED',
]);

const RESEND_FAILURES = new Set([
  'LINE_CONTENT_EXPIRED',
  'LINE_CONTENT_EMPTY',
  'LINE_CONTENT_TOO_LARGE',
  'ATTACHMENT_UNSUPPORTED',
]);

const PROVIDER_OR_SETTLEMENT_UNCERTAIN_FAILURES = new Set([
  'ATTACHMENT_INGESTION_FAILED',
  'AI_USAGE_EXCEEDED_RESERVATION',
  'ACTUAL_EXCEEDS_RESERVED',
  'RESERVATION_NOT_FOUND',
  'RESERVATION_NOT_ACTIVE',
  'SOURCE_NOT_FOUND',
]);

/**
 * Classifies a terminal attachment ingestion failure for operator UX.
 *
 * SAFE_RETRY means the known failure happened before any provider request and
 * retrying the original LINE quoted message can be allowed without double-bill
 * risk. RESEND_REQUIRED means replay is either impossible or user input must be
 * replaced. MANUAL_REVIEW is the conservative default whenever provider or DB
 * settlement may have happened and replay could create duplicate provider cost.
 */
export function classifyAttachmentRetry(errorCode: string | null | undefined): AttachmentRetryDecision {
  const code = normalize(errorCode);

  if (SAFE_PRE_PROVIDER_FAILURES.has(code)) {
    return {
      disposition: 'SAFE_RETRY',
      canRetryWithoutProviderReplay: true,
      reason: code,
    };
  }

  if (RESEND_FAILURES.has(code)) {
    return {
      disposition: 'RESEND_REQUIRED',
      canRetryWithoutProviderReplay: false,
      reason: code,
    };
  }

  if (PROVIDER_OR_SETTLEMENT_UNCERTAIN_FAILURES.has(code)) {
    return {
      disposition: 'MANUAL_REVIEW',
      canRetryWithoutProviderReplay: false,
      reason: code,
    };
  }

  return {
    disposition: 'MANUAL_REVIEW',
    canRetryWithoutProviderReplay: false,
    reason: code || 'UNKNOWN_ATTACHMENT_FAILURE',
  };
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().slice(0, 128);
}
