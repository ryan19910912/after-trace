const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function taipeiParts(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((item) => item.type === type)?.value;
  if (!value) throw new Error(`Unable to resolve Asia/Taipei ${type}`);
  return value;
}

/** Returns the calendar date in Asia/Taipei for a concrete instant. */
export function taipeiDate(value: Date): string {
  const parts = taipeiParts(value);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** Returns the local wall-clock time in Asia/Taipei as HH:mm:ss. */
export function taipeiTime(value: Date): string {
  const parts = taipeiParts(value);
  return `${part(parts, 'hour')}:${part(parts, 'minute')}:${part(parts, 'second')}`;
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
