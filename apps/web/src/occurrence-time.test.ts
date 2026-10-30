import { describe, expect, it } from 'vitest';
import { inferOccurrenceTime } from './occurrence-time';
const now = new Date(2026, 9, 28, 23, 10);
describe('occurrence time from explicit user text', () => {
  it.each([
    ['晚上十點進行副本任務執行', '2026-10-28T22:00'],
    ['明天下午三點半開會', '2026-10-29T15:30'],
    ['2026/11/02 上午九點十五分完成部署', '2026-11-02T09:15'],
    ['10月29日 22:10 測試', '2026-10-29T22:10'],
    ['昨天晚上十一點回覆客戶', '2026-10-27T23:00'],
    ['今晚十點測試', '2026-10-28T22:00'],
    ['2026-11-02', '2026-11-02T00:00'],
    ['2026-11-02T22:10', '2026-11-02T22:10'],
    ['凌晨十二點半', '2026-10-28T00:30'],
    ['下午三點三刻', '2026-10-28T15:45'],
  ])('parses %s', (text, expected) => { expect(inferOccurrenceTime(text, now).occurredAt).toBe(expected); });
  it.each(['今天完成部署，明天測試', '完成部署', '下週一下午三點', '下午三點到五點', '2026/2/30 晚上十點', '25:00', '10:99', '花了三小時處理', '大後天晚上十點'])('leaves ambiguous or invalid input empty: %s', (text) => { expect(inferOccurrenceTime(text, now).occurredAt).toBe(''); });
  it('discloses the assumed date and handles month boundaries', () => {
    expect(inferOccurrenceTime('晚上十點', now).timeNote).toContain('未寫日期，以今天帶入');
    expect(inferOccurrenceTime('明晚十點', new Date(2026, 11, 31)).occurredAt).toBe('2027-01-01T22:00');
  });
});
