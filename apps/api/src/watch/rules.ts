import { z } from 'zod';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function isValidIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

const dateSchema = z.string().refine(isValidIsoDate, 'Invalid ISO date');
const timeSchema = z.string().regex(timePattern).transform(normalizeTime);
const venueIdsSchema = z
  .array(z.number().int().positive())
  .max(50)
  .transform((values) => [...new Set(values)].sort((a, b) => a - b));
const daysOfWeekSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((values) => [...new Set(values)].sort((a, b) => a - b));

export const createWatchRuleSchema = z
  .object({
    sport: z.string().trim().min(2).max(64).regex(/^[a-z0-9_-]+$/i).transform((value) => value.toLowerCase()),
    enabled: z.boolean().default(true),
    venueIds: venueIdsSchema.default([]),
    dateFrom: dateSchema.nullish().transform((value) => value ?? null),
    dateTo: dateSchema.nullish().transform((value) => value ?? null),
    daysOfWeek: daysOfWeekSchema.nullish().transform((value) => value ?? []),
    startTime: timeSchema.nullish().transform((value) => value ?? null),
    endTime: timeSchema.nullish().transform((value) => value ?? null),
    city: z.string().trim().min(1).max(80).default('臺北市'),
    district: z.string().trim().min(1).max(80).nullish().transform((value) => value ?? null),
  })
  .superRefine((value, context) => {
    const error = validateWatchWindow(value);
    if (error) context.addIssue({ code: 'custom', message: error });
  });

export const updateWatchRuleSchema = z.object({
  enabled: z.boolean().optional(),
  venueIds: venueIdsSchema.optional(),
  dateFrom: dateSchema.nullable().optional(),
  dateTo: dateSchema.nullable().optional(),
  daysOfWeek: daysOfWeekSchema.nullable().optional(),
  startTime: timeSchema.nullable().optional(),
  endTime: timeSchema.nullable().optional(),
  city: z.string().trim().min(1).max(80).optional(),
  district: z.string().trim().min(1).max(80).nullable().optional(),
});

export type CreateWatchRuleInput = z.infer<typeof createWatchRuleSchema>;
export type UpdateWatchRuleInput = z.infer<typeof updateWatchRuleSchema>;

export type WatchWindow = {
  dateFrom: string | null;
  dateTo: string | null;
  startTime: string | null;
  endTime: string | null;
};

export function validateWatchWindow(value: WatchWindow): string | null {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) return 'dateFrom must be on or before dateTo';
  if (value.startTime && value.endTime && value.startTime >= value.endTime) return 'startTime must be before endTime';
  return null;
}

export function parseIdempotencyKey(value: string | undefined | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(normalized)) return null;
  return normalized;
}

export async function fingerprintWatchCreate(input: CreateWatchRuleInput): Promise<string> {
  const canonical = JSON.stringify({
    ...input,
    venueIds: [...input.venueIds].sort((a, b) => a - b),
    daysOfWeek: [...input.daysOfWeek].sort((a, b) => a - b),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type MatchableWatchRule = {
  enabled: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
  city: string;
  district: string | null;
  venueIds: number[];
};

export type MatchableAvailabilityEvent = {
  venueId: number;
  useDate: string;
  startTime: string;
  endTime: string;
  city: string;
  district: string | null;
};

export function matchesWatchRule(rule: MatchableWatchRule, event: MatchableAvailabilityEvent): boolean {
  if (!rule.enabled) return false;
  if (rule.city !== event.city) return false;
  if (rule.district && rule.district !== event.district) return false;
  if (rule.venueIds.length > 0 && !rule.venueIds.includes(event.venueId)) return false;
  if (rule.dateFrom && event.useDate < rule.dateFrom) return false;
  if (rule.dateTo && event.useDate > rule.dateTo) return false;
  if (rule.startTime && event.startTime < rule.startTime) return false;
  if (rule.endTime && event.endTime > rule.endTime) return false;
  if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
    const day = new Date(`${event.useDate}T00:00:00Z`).getUTCDay();
    if (!rule.daysOfWeek.includes(day)) return false;
  }
  return true;
}
