const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the calendar date in Asia/Taipei for a concrete instant. */
export function taipeiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to resolve Asia/Taipei date');
  return `${year}-${month}-${day}`;
}

/**
 * Adds whole calendar days to an ISO date without introducing runtime-local
 * timezone behavior. The input/output are date-only values, not instants.
 */
export function addIsoDays(value: string, days: number): string {
  if (!ISO_DATE.test(value)) throw new Error('Date must use YYYY-MM-DD');
  if (!Number.isInteger(days)) throw new Error('days must be an integer');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Date must be a valid calendar date');
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
