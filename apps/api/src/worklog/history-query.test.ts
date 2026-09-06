import { describe, expect, it, vi } from 'vitest';
import { formatHistoryReply, WorklogHistoryQueryService } from './history-query';

type ExecuteResult = { rows: unknown[] };

function database(...results: ExecuteResult[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  return { db: { execute } as never, execute };
}

describe('WorklogHistoryQueryService', () => {
  it('resolves an existing title, removes it from the semantic query, and returns newest DB facts', async () => {
    const { db, execute } = database(
      { rows: [{ id: '71', name: '晴空案' }] },
      { rows: [
        {
          id: '103',
          title: '晴空案',
          raw_text: '今天收3千清潔費',
          occurred_at: '2026-09-06T00:00:00.000Z',
          total: 8,
        },
        {
          id: '102',
          title: '晴空案',
          raw_text: '第一期款已收到',
          occurred_at: '2026-09-03T00:00:00.000Z',
          total: 8,
        },
      ] },
    );
    const service = new WorklogHistoryQueryService(db);

    await expect(service.query(9, { query: '晴空案目前收款進度如何' })).resolves.toEqual({
      total: 8,
      title: '晴空案',
      query: '收款',
      filters: { entityId: 71, query: '收款' },
      records: [
        {
          id: 103,
          title: '晴空案',
          rawText: '今天收3千清潔費',
          occurredAt: '2026-09-06T00:00:00.000Z',
        },
        {
          id: 102,
          title: '晴空案',
          rawText: '第一期款已收到',
          occurredAt: '2026-09-03T00:00:00.000Z',
        },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('fails closed to zero matches when the DB result is empty and preserves date filters', async () => {
    const { db, execute } = database(
      { rows: [] },
      { rows: [] },
      { rows: [{ total: 0 }] },
    );
    const service = new WorklogHistoryQueryService(db);
    const from = '2026-09-01T00:00:00.000Z';
    const to = '2026-10-01T00:00:00.000Z';

    await expect(service.query(5, { query: '收款', from, to })).resolves.toEqual({
      total: 0,
      title: null,
      query: '收款',
      filters: { query: '收款', from, to },
      records: [],
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});

describe('formatHistoryReply', () => {
  it('returns stored facts and a deep link without composing an AI summary', () => {
    const reply = formatHistoryReply({
      total: 8,
      title: '晴空案',
      query: '收款',
      filters: { entityId: 71, query: '收款' },
      records: [
        { id: 1, title: '晴空案', rawText: '今天收3千清潔費', occurredAt: '2026-09-06T00:00:00.000Z' },
        { id: 2, title: '晴空案', rawText: '第一期款已收到', occurredAt: '2026-09-03T00:00:00.000Z' },
      ],
    }, 'https://example.test/worklog?q=%E6%94%B6%E6%AC%BE');

    expect(reply).toContain('找到 8 筆「晴空案」與「收款」相關的紀錄');
    expect(reply).toContain('今天收3千清潔費');
    expect(reply).toContain('第一期款已收到');
    expect(reply).toContain('查看更多紀錄：');
    expect(reply).toContain('https://example.test/worklog');
    expect(reply).not.toContain('目前收款進度');
  });

  it('caps the displayed recent-count wording at five', () => {
    const records = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      title: '晴空案',
      rawText: `紀錄 ${index + 1}`,
      occurredAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    }));
    const reply = formatHistoryReply({ total: 12, records, filters: {}, title: '晴空案', query: null }, null);
    expect(reply).toContain('以下是最近 5 筆');
  });
});
