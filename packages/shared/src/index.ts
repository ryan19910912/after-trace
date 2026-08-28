export const memoryDecisionValues = [
  'NEW',
  'DUPLICATE',
  'UPDATE',
  'CONTRADICT',
] as const;

export type MemoryDecision = (typeof memoryDecisionValues)[number];

export const creditBucketValues = ['WELCOME', 'AD', 'PAID'] as const;
export type CreditBucket = (typeof creditBucketValues)[number];

export const aiUsageTypeValues = [
  'CHAT',
  'MEMORY_EXTRACTION',
  'MEMORY_SEARCH',
  'EXPLICIT_MEMORY',
  'REMINDER',
] as const;
export type AiUsageType = (typeof aiUsageTypeValues)[number];
