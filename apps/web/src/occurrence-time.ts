function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes('十')) { const [tens, units] = value.split('十'); return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0); }
  return digits[value] ?? NaN;
}
function localValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function inferOccurrenceTime(text: string, reference = new Date()): { occurredAt: string; timeNote?: string } {
  const empty = { occurredAt: '' };
  const dates: string[] = []; const times: number[] = []; const notes: string[] = [];
  let invalid = false;
  const addDate = (year: number, month: number, day: number) => {
    const value = new Date(year, month - 1, day);
    if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) invalid = true;
    else dates.push(localValue(value).slice(0, 10));
  };
  let rest = text.replace(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})(?:日|號|号)?/g, (_match, y, m, d) => { addDate(Number(y), Number(m), Number(d)); return ' '; });
  rest = rest.replace(/(?<!\d)(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})(?:日|號|号)?/g, (_match, m, d) => { addDate(reference.getFullYear(), Number(m), Number(d)); notes.push('未寫年份，以今年帶入'); return ' '; });
  const offsets: Record<string, number> = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 明晚: 1, 後天: 2, 后天: 2, 昨天: -1, 昨日: -1, 昨晚: -1, 前天: -2 };
  for (const match of rest.matchAll(/今天|今日|今晚|明天|明日|明晚|後天|后天|昨天|昨日|昨晚|前天/g)) {
    const value = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + offsets[match[0]]);
    dates.push(localValue(value).slice(0, 10)); notes.push(`「${match[0]}」依此裝置日期換算`);
  }
  if (/下[週周個个]|上[週周個个]|本[週周]|這[週周]|这周|星期|週[一二三四五六日天]|周[一二三四五六日天]|大[後后]天/.test(rest)) return empty;
  const periodPattern = '(?:上午|早上|清晨|凌晨|中午|下午|傍晚|晚上|夜間|夜里|今晚|明晚|昨晚)';
  const clock = new RegExp(`(${periodPattern})?\\s*([0-9零〇一二兩两三四五六七八九十]+)\\s*(?::|：|點|点|時|时)\\s*(半|一刻|三刻|[0-9零〇一二兩两三四五六七八九十]+)?(?:分)?`, 'g');
  for (const match of text.matchAll(clock)) {
    let hour = chineseNumber(match[2]);
    const minute = match[3] === '半' ? 30 : match[3] === '一刻' ? 15 : match[3] === '三刻' ? 45 : match[3] ? chineseNumber(match[3]) : 0;
    const period = match[1] ?? '';
    if (period && (hour < 0 || hour > 12)) { invalid = true; continue; }
    if (/下午|傍晚|晚上|夜間|夜里|今晚|明晚|昨晚/.test(period) && hour < 12) hour += 12;
    if (/上午|早上|清晨|凌晨/.test(period) && hour === 12) hour = 0;
    if (period === '中午' && hour < 11) hour += 12;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) invalid = true;
    else times.push(hour * 60 + minute);
  }
  const uniqueDates = [...new Set(dates)], uniqueTimes = [...new Set(times)];
  if (invalid || uniqueDates.length > 1 || uniqueTimes.length > 1 || (!dates.length && !times.length)) return empty;
  if (!dates.length) { uniqueDates.push(localValue(reference).slice(0, 10)); notes.push('未寫日期，以今天帶入'); }
  if (!times.length) notes.push('只提供日期，時間先帶入 00:00');
  const minutes = uniqueTimes[0] ?? 0;
  return { occurredAt: `${uniqueDates[0]}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, timeNote: [...new Set(notes), '請確認或修改發生時間'].join('；') };
}
