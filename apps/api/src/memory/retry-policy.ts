export type MemoryAiRetryPolicy = {
  maxTransientAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
};

export const defaultMemoryAiRetryPolicy: MemoryAiRetryPolicy = {
  maxTransientAttempts: 3,
  baseDelaySeconds: 60,
  maxDelaySeconds: 15 * 60,
};

export class MemoryAiExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryAiExecutionError';
  }
}

export type ClassifiedMemoryAiFailure = {
  code: string;
  retryable: boolean;
};

export function classifyMemoryAiFailure(error: unknown): ClassifiedMemoryAiFailure {
  if (error instanceof MemoryAiExecutionError) {
    return {
      code: normalizeErrorCode(error.code),
      retryable: error.retryable,
    };
  }
  return {
    code: 'MEMORY_AI_RETRYABLE_FAILURE',
    retryable: true,
  };
}

export function validateMemoryAiRetryPolicy(
  policy: MemoryAiRetryPolicy,
): MemoryAiRetryPolicy {
  positiveInteger(policy.maxTransientAttempts, 'maxTransientAttempts');
  positiveInteger(policy.baseDelaySeconds, 'baseDelaySeconds');
  positiveInteger(policy.maxDelaySeconds, 'maxDelaySeconds');
  if (policy.maxDelaySeconds < policy.baseDelaySeconds) {
    throw new Error('maxDelaySeconds must be greater than or equal to baseDelaySeconds');
  }
  return { ...policy };
}

export function nextMemoryAiRetryAt(
  now: Date,
  attemptCount: number,
  policy: MemoryAiRetryPolicy,
): Date {
  positiveInteger(attemptCount, 'attemptCount');
  const validated = validateMemoryAiRetryPolicy(policy);
  const exponent = Math.min(attemptCount - 1, 30);
  const delaySeconds = Math.min(
    validated.baseDelaySeconds * 2 ** exponent,
    validated.maxDelaySeconds,
  );
  return new Date(now.getTime() + delaySeconds * 1_000);
}

export function waitingMemoryAiRetryAt(
  now: Date,
  policy: MemoryAiRetryPolicy,
): Date {
  const validated = validateMemoryAiRetryPolicy(policy);
  return new Date(now.getTime() + validated.baseDelaySeconds * 1_000);
}

function normalizeErrorCode(value: string): string {
  return value.trim().toUpperCase().slice(0, 128) || 'MEMORY_AI_FAILURE';
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
