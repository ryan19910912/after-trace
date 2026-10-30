import { configuredPrompt, publishedPrompts } from './prompt-config';
import { runLocalAi } from './local-ai';
import { WorklogApi, type RecordFilters, type WorklogRecord } from './worklog-api';

function object(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('本機 AI 回傳格式不正確，請重試。');
  return parsed as Record<string, unknown>;
}
export async function localAiTool(api: WorklogApi, session: string, path: string, input: Record<string, unknown>, options: { signal?: AbortSignal; onSummary?: (text: string, completed: number, total: number) => void; onProgress?: (text: string) => void } = {}): Promise<Record<string, unknown>> {
  const checkCancelled = () => { if (options.signal?.aborted) throw new Error('已取消本機 AI 處理，已完成的摘要仍保留。'); };
  checkCancelled();
  const infer = async (request: Parameters<typeof runLocalAi>[0]) => { checkCancelled(); const text = await runLocalAi(request); checkCancelled(); return text; };
  const sourceId = Number(input.sourceId);
  const surfaces = await api.surfaces(session);
  const personal = surfaces.personal?.sourceId === sourceId;
  if (!personal && !surfaces.groups.some((group) => group.sourceId === sourceId)) throw new Error('SOURCE_NOT_AUTHORIZED');
  const prompts = await publishedPrompts(api.baseUrl);
  const promptFor = (key: string, values: Record<string, string>) => configuredPrompt(key, values, api.baseUrl, prompts);
  const load = (filters: RecordFilters) => personal ? api.personalRecords(session, filters) : api.groupRecords(session, sourceId, filters);
  if (path === '/search') {
    const interpretation = object(await infer(await promptFor('search', { now: new Date().toISOString(), timeZone: String(input.timeZone), query: String(input.query) })));
    const terms = Array.isArray(interpretation.terms) ? interpretation.terms.filter((term): term is string => typeof term === 'string' && !!term.trim()).slice(0, 5) : [];
    const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
    const from = date(interpretation.from), to = date(interpretation.to);
    const records = new Map<number, WorklogRecord>();
    const queries = terms.length ? [...new Set(terms)] : [''];
    for (let i = 0; i < queries.length; i += 2) {
      checkCancelled();
      const pages = await Promise.all(queries.slice(i, i + 2).map((query) => load({ query, from, to, limit: 20, offset: 0 })));
      for (const page of pages) for (const record of page.records) records.set(record.id, record);
    }
    return { entitlementSource: 'LOCAL', interpretation: { terms, from: from ?? null, to: to ?? null }, records: [...records.values()].slice(0, 20) };
  }
  const target = input.recordId ? await api.record(session, Number(input.recordId)) : undefined;
  if (target && target.sourceId !== sourceId) throw new Error('SOURCE_NOT_AUTHORIZED');
  if (path === '/task-proposal') {
    const result = object(await infer(await promptFor('task', { text: String(input.text), reference: target?.rawText ?? '' })));
    return { title: typeof result.title === 'string' ? result.title.slice(0, 255) : '', body: typeof result.body === 'string' ? result.body : null, dueAt: null, remindAt: null };
  }
  if (path === '/rewrite' && target) return { recordId: target.id, expectedVersion: target.version, originalText: target.rawText, proposedText: await infer(await promptFor('rewrite', { instruction: String(input.instruction), record: target.rawText })) };
  const records: WorklogRecord[] = [];
  let offset = 0;
  let hasMore = false;
  const maxRecords = path === '/related' ? 41 : 400;
  do {
    checkCancelled();
    const page = await load({ from: typeof input.from === 'string' ? input.from : undefined, to: typeof input.to === 'string' ? input.to : undefined, limit: Math.min(80, maxRecords - records.length), offset });
    records.push(...page.records); offset += page.records.length; hasMore = page.page.hasMore;
    if (!page.records.length) break;
  } while (hasMore && records.length < maxRecords);
  if (path === '/related' && target) {
    const candidates = records.filter((record) => record.id !== target.id).slice(0, 40);
    const selection = object(await infer(await promptFor('related', { target: target.rawText.slice(0, 2000), candidates: JSON.stringify(candidates.map((record) => ({ id: record.id, text: record.rawText.slice(0, 250) }))) })));
    const ids = Array.isArray(selection.ids) ? selection.ids : [];
    return { records: candidates.filter((record) => ids.includes(record.id)).slice(0, 8).map((record) => ({ ...record, relevanceScore: 1 })), truncated: hasMore || records.length > 41 };
  }
  if (path === '/summary') {
    if (!records.length) return { status: 'NO_RECORDS' };
    const chunks: string[] = [];
    let current = '';
    for (const record of records) {
      const line = `[${record.occurredAt ?? record.createdAt}] ${record.rawText}\n`;
      if (current.length + line.length > 10000 && current) { chunks.push(current); current = ''; }
      // Large individual Records are summarized in slices too.
      for (let i = 0; i < line.length; i += 10000) {
        const slice = line.slice(i, i + 10000);
        if (current.length + slice.length > 10000) { chunks.push(current); current = ''; }
        current += slice;
      }
    }
    if (current) chunks.push(current);
    const summaries: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      checkCancelled();
      options.onProgress?.(`正在整理第 ${index + 1}／${chunks.length} 段`);
      summaries.push(await infer(await promptFor('summary', { records: chunk })));
      options.onSummary?.(summaries.join('\n\n'), index + 1, chunks.length);
    }
    return { summary: summaries.join('\n\n'), recordCount: records.length, truncated: hasMore, entitlementSource: 'LOCAL' };
  }
  throw new Error('不支援的本機 AI 功能。');
}
