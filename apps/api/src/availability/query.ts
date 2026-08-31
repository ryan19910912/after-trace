import { z } from 'zod';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const clockTime = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export const availabilitySearchQuerySchema = z
  .object({
    sport: z.string().trim().min(1).max(64).optional(),
    venueId: z.coerce.number().int().positive().optional(),
    city: z.string().trim().min(1).max(80).optional(),
    district: z.string().trim().min(1).max(80).optional(),
    date: z.string().regex(isoDate, 'date must use YYYY-MM-DD').optional(),
    start: z.string().regex(clockTime, 'start must use HH:mm or HH:mm:ss').optional(),
    end: z.string().regex(clockTime, 'end must use HH:mm or HH:mm:ss').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => !value.start || !value.end || value.start < value.end, {
    message: 'start must be before end',
    path: ['end'],
  });

export type AvailabilitySearchQuery = z.infer<typeof availabilitySearchQuerySchema>;

export function parseAvailabilitySearchQuery(input: Record<string, string>) {
  return availabilitySearchQuerySchema.safeParse(input);
}
