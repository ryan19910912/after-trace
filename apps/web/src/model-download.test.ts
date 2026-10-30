import { describe, expect, it, vi } from 'vitest';
import { createModelDownloadFetch } from './model-download';
const url='https://huggingface.co/onnx-community/model/resolve/pinned/preprocessor_config.json';
describe('static model download recovery',()=>{
 it('recovers CORS/network failures using fresh URLs without credentials',async()=>{const f=vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(new Response('{}'));const r=await createModelDownloadFetch(f)(url);expect(r.status).toBe(200);expect(f).toHaveBeenCalledTimes(2);expect(f.mock.calls[0][0]).toBe(url);expect(f.mock.calls[1][0]).toContain('aftertrace_retry=');expect(f.mock.calls[1][1]).toMatchObject({credentials:'omit',mode:'cors',referrerPolicy:'no-referrer'});});
 it('bounds retries and shows an actionable download error',async()=>{const f=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));await expect(createModelDownloadFetch(f)(url)).rejects.toThrow('模型資源下載失敗');expect(f).toHaveBeenCalledTimes(3);});
 it('does not retry missing files or unrelated API requests',async()=>{const f=vi.fn().mockResolvedValue(new Response('',{status:404}));expect((await createModelDownloadFetch(f)(url)).status).toBe(404);expect(f).toHaveBeenCalledTimes(1);f.mockRejectedValue(new TypeError('offline'));await expect(createModelDownloadFetch(f)('https://example.test/api',{method:'POST',body:'private'})).rejects.toThrow('offline');expect(f).toHaveBeenCalledTimes(2);});
 it('does not retry cancellation',async()=>{const c=new AbortController();c.abort();const f=vi.fn();await expect(createModelDownloadFetch(f)(url,{signal:c.signal})).rejects.toBeDefined();expect(f).not.toHaveBeenCalled();});
 it('retries transient server failures but keeps successful response streaming',async()=>{const ok=new Response('stream'),f=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValue(ok);expect(await createModelDownloadFetch(f)(url)).toBe(ok);expect(f).toHaveBeenCalledTimes(2);});
});
