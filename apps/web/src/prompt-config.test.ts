import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishedPrompts, renderLocalPrompt } from './prompt-config';
afterEach(() => vi.unstubAllGlobals());
const prompts = ['capture','search','task','rewrite','related','summary'].map((key) => ({ key, template: '{{input}}', maxTokens: 128, version: 1 }));
describe('published prompt retrieval', () => {
  it('deduplicates in-flight reads and revalidates without sending user content', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ prompts }, { headers: { ETag: '"version-1"' } })).mockResolvedValueOnce(new Response(null, { status: 304 })); vi.stubGlobal('fetch', fetch);
    const first = publishedPrompts('https://config.test'); expect(publishedPrompts('https://config.test')).toBe(first); expect(await first).toEqual(prompts);
    expect(await publishedPrompts('https://config.test')).toEqual(prompts); expect(fetch.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"version-1"' });
    expect(fetch.mock.calls.every((call) => !call[1].body && !call[1].method)).toBe(true);
  });
  it('does not run a compiled-in fallback on configuration failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(publishedPrompts('https://unavailable.test')).rejects.toThrow('手動保存');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(publishedPrompts('https://offline.test')).rejects.toThrow('AI 設定暫時無法取得');
  });
  it('does a single substitution pass without interpreting inserted user placeholders', () => {
    expect(renderLocalPrompt('內容 {{input}}，時間 {{now}}', { input: '{{now}}', now: 'today' })).toBe('內容 {{now}}，時間 today');
    expect(() => renderLocalPrompt('{{missing}}', {})).toThrow('必要變數');
  });
});

describe('prompt configuration timeout recovery',()=>{it('bounds a stalled request and allows a fresh retry',async()=>{const controller=new AbortController();const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);try{const fetch=vi.fn().mockImplementationOnce((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))).mockResolvedValueOnce(Response.json({prompts}));vi.stubGlobal('fetch',fetch);const pending=publishedPrompts('https://timeout-prompt.test');expect(timeout).toHaveBeenCalledWith(15000);controller.abort();await expect(pending).rejects.toThrow('手動保存');expect(await publishedPrompts('https://timeout-prompt.test')).toEqual(prompts);expect(fetch).toHaveBeenCalledTimes(2);}finally{timeout.mockRestore();}});});
