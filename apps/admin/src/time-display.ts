const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const nativeToLocaleString = Date.prototype.toLocaleString;

const taipeiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAIPEI_TIME_ZONE,
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
