import {noticeApiFailure} from './diagnostics';
export type LocalPrompt = { key: string; template: string; maxTokens: number; version: number };
const keys = ['capture', 'search', 'task', 'rewrite', 'related', 'summary'];
const cache = new Map<string, { etag: string; prompts: LocalPrompt[] }>();
const pending = new Map<string, Promise<LocalPrompt[]>>();
export function publishedPrompts(baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''): Promise<LocalPrompt[]> {
  const base = baseUrl.replace(/\/$/, '');
  const existing = pending.get(base); if (existing) return existing;
  const previous = cache.get(base);
  const request = (async () => {
    const response = await fetch(base + '/api/v1/local-ai/prompts', { headers: previous?.etag ? { 'If-None-Match': previous.etag } : {}, signal: AbortSignal.timeout(15000), cache: 'no-cache' });
    if (response.status === 304 && previous) return previous.prompts;
    noticeApiFailure(response);if (!response.ok) throw new Error('AI 設定暫時無法取得，請稍後重試；仍可手動保存。');
    const body = await response.json() as { prompts?: LocalPrompt[] };
    if (!Array.isArray(body.prompts) || body.prompts.length !== keys.length || keys.some((key) => !body.prompts?.some((p) => p.key === key)) || body.prompts.some((p) => typeof p.template !== 'string' || !p.template.trim() || p.template.length > 4000 || !Number.isInteger(p.maxTokens) || p.maxTokens < 64 || p.maxTokens > 768 || !Number.isSafeInteger(p.version) || p.version < 1)) throw new Error('AI 設定格式不正確，請通知管理員。');
    cache.set(base, { etag: response.headers.get('ETag') ?? '', prompts: body.prompts }); return body.prompts;
  })().catch((cause: unknown) => {
    if (cause instanceof Error && cause.message.startsWith('AI 設定')) throw cause;
    throw new Error('AI 設定暫時無法取得，請稍後重試；仍可手動保存。');
  }).finally(() => { pending.delete(base); });
  pending.set(base, request); return request;
}
export function renderLocalPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z]\w*)\s*\}\}/g, (_match, name: string) => { if (!Object.prototype.hasOwnProperty.call(values, name)) throw new Error('AI 設定缺少必要變數。'); return values[name]; });
}
export async function configuredPrompt(key: string, values: Record<string, string>, baseUrl?: string, snapshot?: LocalPrompt[]) {
  const prompt = (snapshot ?? await publishedPrompts(baseUrl)).find((item) => item.key === key);
  if (!prompt) throw new Error('AI 設定尚未初始化。');
  return { prompt: renderLocalPrompt(prompt.template, values), maxNewTokens: prompt.maxTokens };
}
