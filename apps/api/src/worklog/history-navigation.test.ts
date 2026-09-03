import { describe, expect, it } from 'vitest';
import { historyFiltersFromText } from './history-navigation';

describe('historyFiltersFromText', () => {
  const at = new Date('2026-09-04T03:30:00+08:00');

  it('extracts a keyword and this-week Taipei range', () => {
    expect(historyFiltersFromText('王大明這週做了什麼', at)).toEqual({
      query: '王大明',
      from: '2026-08-30T16:00:00.000Z',
      to: '2026-09-06T16:00:00.000Z',
    });
  });

  it('builds group-wide today range without inventing a keyword', () => {
    expect(historyFiltersFromText('這個群組今天發生什麼？', at)).toEqual({
      from: '2026-09-03T16:00:00.000Z',
      to: '2026-09-04T16:00:00.000Z',
    });
  });

  it('supports yesterday, last week and month boundaries', () => {
    expect(historyFiltersFromText('晴空案昨天有哪些紀錄', at)).toEqual({
      query: '晴空案',
      from: '2026-09-02T16:00:00.000Z',
      to: '2026-09-03T16:00:00.000Z',
    });
    expect(historyFiltersFromText('晴空案上週做了什麼', at)).toEqual({
      query: '晴空案',
      from: '2026-08-23T16:00:00.000Z',
      to: '2026-08-30T16:00:00.000Z',
    });
    expect(historyFiltersFromText('晴空案本月做了什麼', at)).toEqual({
      query: '晴空案',
      from: '2026-08-31T16:00:00.000Z',
      to: '2026-09-30T16:00:00.000Z',
    });
  });

  it('returns no filters for exact generic query navigation', () => {
    expect(historyFiltersFromText(null, at)).toEqual({});
  });
});
