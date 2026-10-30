import { afterEach, describe, expect, it, vi } from 'vitest';
import { localAiTool } from './local-ai-tools';
import { runLocalAi } from './local-ai';
import type { WorklogApi } from './worklog-api';
vi.mock('./prompt-config', () => ({ publishedPrompts: vi.fn(async () => []), configuredPrompt: vi.fn(async (key: string, values: Record<string, string>) => ({ prompt: JSON.stringify(values), maxNewTokens: key === 'summary' ? 320 : 192 })) }));
vi.mock('./local-ai', () => ({ runLocalAi: vi.fn() }));
afterEach(() => vi.clearAllMocks());
function api() {
  return { record: vi.fn(async () => ({ id: 10, sourceId: 1, rawText: '原始內容', version: 4 })), surfaces: vi.fn(async () => ({ personal: { sourceId: 1 }, groups: [] })), personalRecords: vi.fn(async () => ({ records: [{ id: 10, sourceId: 1, rawText: '原始內容', version: 4 }], page: { hasMore: false } })), groupRecords: vi.fn(), updateRecord: vi.fn() };
}
describe('local tools authorization and proposals', () => {
  it('rejects a scope outside authorized surfaces before inference or record reads', async () => {
    const client = api();
    await expect(localAiTool(client as unknown as WorklogApi, 'session', '/summary', { sourceId: 2 })).rejects.toThrow('SOURCE_NOT_AUTHORIZED');
    expect(runLocalAi).not.toHaveBeenCalled(); expect(client.personalRecords).not.toHaveBeenCalled();
  });
  it('produces rewrite with original version but never performs a record mutation', async () => {
    const client = api(); vi.mocked(runLocalAi).mockResolvedValue('修改建議');
    const result = await localAiTool(client as unknown as WorklogApi, 'session', '/rewrite', { sourceId: 1, recordId: 10, instruction: '精簡' });
    expect(result).toMatchObject({ proposedText: '修改建議', expectedVersion: 4, originalText: '原始內容' });
    expect(client.updateRecord).not.toHaveBeenCalled();
  });
  it('does not trust model-generated task dates', async () => {
    const client = api(); vi.mocked(runLocalAi).mockResolvedValue('{"title":"回覆客戶","body":"報價","dueAt":"2099-01-01"}');
    expect(await localAiTool(client as unknown as WorklogApi, 'session', '/task-proposal', { sourceId: 1, text: '回覆報價' })).toMatchObject({ title: '回覆客戶', dueAt: null, remindAt: null });
  });
});

describe('bounded local AI record reads', () => {
  it('does not download record history for an unreferenced task proposal', async () => {
    const client = api(); vi.mocked(runLocalAi).mockResolvedValue('{"title":"回覆客戶","body":"內容"}');
    await localAiTool(client as unknown as WorklogApi, 'session', '/task-proposal', { sourceId: 1, text: '回覆客戶' });
    expect(client.personalRecords).not.toHaveBeenCalled(); expect(client.record).not.toHaveBeenCalled();
  });
  it('rejects a record from another scope before local inference', async () => {
    const client = api(); client.record.mockResolvedValue({ id: 10, sourceId: 2, rawText: 'private', version: 1 });
    await expect(localAiTool(client as unknown as WorklogApi, 'session', '/rewrite', { sourceId: 1, recordId: 10 })).rejects.toThrow('SOURCE_NOT_AUTHORIZED');
    expect(runLocalAi).not.toHaveBeenCalled();
  });
});


describe('summary progress and cancellation', () => {
  it('publishes completed chunks and stops before the next inference when cancelled', async () => {
    const client = api();
    client.personalRecords.mockResolvedValue({ records: [{ id: 10, sourceId: 1, rawText: '工作'.repeat(7000), version: 4 }], page: { hasMore: false } });
    const controller = new AbortController(); const onProgress = vi.fn(); const partial: string[] = [];
    vi.mocked(runLocalAi).mockResolvedValue('已完成重點');
    await expect(localAiTool(client as unknown as WorklogApi, 'session', '/summary', { sourceId: 1 }, { signal: controller.signal, onProgress, onSummary: (text) => { partial.push(text); controller.abort(); } })).rejects.toThrow('已取消');
    expect(partial).toEqual(['已完成重點']); expect(onProgress).toHaveBeenCalledWith('正在整理第 1／2 段');
    expect(runLocalAi).toHaveBeenCalledTimes(1); expect(runLocalAi).toHaveBeenCalledWith(expect.objectContaining({ maxNewTokens: 320 }));
  });
  it('searches at most two terms concurrently and preserves deterministic deduplication', async () => {
    const client = api(); let active = 0, peak = 0;
    client.personalRecords.mockImplementation(async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--; return { records: [{ id: 10, sourceId: 1, rawText: '原文', version: 4 }], page: { hasMore: false } }; });
    vi.mocked(runLocalAi).mockResolvedValue('{"terms":["甲","乙","丙","丁","甲"]}');
    const result = await localAiTool(client as unknown as WorklogApi, 'session', '/search', { sourceId: 1, query: '測試' });
    expect(peak).toBe(2); expect(client.personalRecords).toHaveBeenCalledTimes(4); expect(result.records).toHaveLength(1);
  });
});
