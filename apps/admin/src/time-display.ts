export const ADMIN_TIME_ZONE = 'Asia/Taipei';
export const ADMIN_TIME_ZONE_LABEL = '台北時間';
const nativeToLocaleString = Date.prototype.toLocaleString;

const taipeiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ADMIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatTaipeiDateTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(
    taipeiDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatAdminDateTime(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (value instanceof Date) return formatTaipeiDateTime(value) || fallback;
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const formatted = formatTaipeiDateTime(value);
  return formatted || String(value);
}

/**
 * Audit/detail values often arrive as ISO strings nested in JSON snapshots. Detect those
 * centrally so every Admin surface renders the same Asia/Taipei wall-clock format.
 */
export function formatAdminValueDateTime(value: unknown): string | null {
  if (value instanceof Date) return formatTaipeiDateTime(value) || null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null;
  const formatted = formatTaipeiDateTime(text);
  return formatted || null;
}

export function installTaipeiDateDisplayPolicy(): void {
  Date.prototype.toLocaleString = function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    const useAftertraceDisplay = options === undefined
      && (locales === undefined || locales === 'zh-TW');
    if (useAftertraceDisplay && !Number.isNaN(this.getTime())) {
      return formatTaipeiDateTime(this);
    }
    return nativeToLocaleString.call(this, locales, options);
  };
}
