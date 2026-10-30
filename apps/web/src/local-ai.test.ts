import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, parseLocalDraft, reviewDraftTitle, runLocalAi, validateImage, cancelLocalAi, subscribeLocalAiStatus, releaseLocalAi, preloadLocalAi } from './local-ai';
vi.mock('./model-config', () => ({ getModelConfiguration: vi.fn(async () => ({ visionModel: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT', visionRevision: '9a4c21d8f724176b0a7edaaed36303044451886e', speechModel: 'onnx-community/whisper-small', speechRevision: '36050c46d777d46dc4b5f43f6d90574fc38f8732', version: 1 })) }));
afterEach(() => { releaseLocalAi(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('local AI input and output bounds', () => {
  it('accepts supported image types and rejects documents and oversized images', () => {
    expect(() => validateImage(new Blob(['image'], { type: 'image/png' }))).not.toThrow();
    expect(() => validateImage(new Blob(['pdf'], { type: 'application/pdf' }))).toThrow('只接受');
    expect(() => validateImage(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/jpeg' }))).toThrow('5 MB');
  });
  it('validates AI draft and never accepts a model-invented occurrence time', () => {
    expect(parseLocalDraft('```json\n{"title":"測試","rawText":"內容","occurredAt":"2030-01-01"}\n```')).toEqual({ title: '測試', rawText: '內容', occurredAt: '' });
    expect(() => parseLocalDraft('{"rawText":""}')).toThrow();
    expect(() => parseLocalDraft('invalid')).toThrow();
  });
  it('rejects unsupported hardware without any remote inference fallback', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', {});
    await expect(runLocalAi({ prompt: 'private content' })).rejects.toThrow('WebGPU');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects audio longer than 60 seconds before initializing runtime', async () => {
    await expect(runLocalAi({ prompt: '', audio: new Float32Array(16000 * 61) })).rejects.toThrow('60 秒');
  });
});

describe('local AI cancellation before adapter initialization', () => {
  it('cancels pending hardware initialization without creating a Worker', async () => {
    let complete: (value: object) => void = () => {};
    const adapter = new Promise<object>((resolve) => { complete = resolve; });
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => adapter } });
    const Worker = vi.fn(); vi.stubGlobal('Worker', Worker);
    const statuses: string[] = []; const unsubscribe = subscribeLocalAiStatus((value) => statuses.push(value));
    const pending = runLocalAi({ prompt: 'private text' });
    cancelLocalAi(); complete({});
    await expect(pending).rejects.toThrow('已取消');
    expect(Worker).not.toHaveBeenCalled(); expect(statuses.at(-1)).toBe(''); unsubscribe();
  });
});


it('reuses idle worker across navigation cleanup and releases it after five minutes', async () => {
  vi.useFakeTimers(); vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  const terminate = vi.fn();
  class FakeWorker {
    onmessage?: (event: { data: { type: string; text: string } }) => void;
    terminate = terminate;
    postMessage() { void Promise.resolve().then(() => this.onmessage?.({ data: { type: 'result', text: '完成' } })); }
  }
  const Worker = vi.fn(function () { return new FakeWorker(); });
  vi.stubGlobal('Worker', Worker);
  await expect(runLocalAi({ prompt: '第一次' })).resolves.toBe('完成'); cancelLocalAi();
  await expect(runLocalAi({ prompt: '第二次' })).resolves.toBe('完成'); expect(Worker).toHaveBeenCalledTimes(1); expect(terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5 * 60_000); expect(terminate).toHaveBeenCalledTimes(1);
});


it('shares preload work and queues analysis until preload finishes without a second worker', async () => {
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  const messages: { preload?: boolean; prompt: string }[] = []; let ready: () => void = () => {};
  class FakeWorker {
    onmessage?: (event: { data: { type: string; text: string } }) => void;
    terminate = vi.fn();
    postMessage(request: { preload?: boolean; prompt: string }) {
      messages.push(request);
      if (request.preload) ready = () => this.onmessage?.({ data: { type: 'result', text: '' } });
      else void Promise.resolve().then(() => this.onmessage?.({ data: { type: 'result', text: '解析完成' } }));
    }
  }
  const Worker = vi.fn(function () { return new FakeWorker(); }); vi.stubGlobal('Worker', Worker);
  const first = preloadLocalAi(); expect(preloadLocalAi()).toBe(first);
  const analysis = runLocalAi({ prompt: '晚上十點打副本' });
  await Promise.resolve(); await Promise.resolve();
  expect(messages).toEqual([expect.objectContaining({ prompt: '', preload: true })]); ready();
  await first; await expect(analysis).resolves.toBe('解析完成');
  expect(messages).toHaveLength(2); expect(Worker).toHaveBeenCalledTimes(1);
  await preloadLocalAi(); expect(messages).toHaveLength(2);
});

describe('conservative title review',()=>{it('does not keep a positive payment title over an unpaid balance',()=>{const draft=reviewDraftTitle({title:'王先生收到三千五百元尾款',rawText:'王先生收到款項三千五百元，尾款還沒有收到。',occurredAt:''});expect(draft.title).toBe('');expect(draft.reviewNote).toContain('核對');expect(draft.rawText).toContain('尾款還沒有收到');});it('rejects unsupported bank/withdrawal context',()=>{expect(reviewDraftTitle({title:'銀行取款記錄',rawText:'王先生收到款項3500元。',occurredAt:''}).title).toBe('');});it('keeps a title that explicitly preserves the negative state',()=>{expect(reviewDraftTitle({title:'尾款尚未收到',rawText:'尾款尚未收到。',occurredAt:''}).title).toBe('尾款尚未收到');});});


it('does not restart canceled speech while waiting for vision preload',async()=>{
  vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({})}});const messages:unknown[]=[];
  class FakeWorker {onmessage?:unknown;terminate=vi.fn();postMessage(request:unknown){messages.push(request);}}
  const Worker=vi.fn(function(){return new FakeWorker();});vi.stubGlobal('Worker',Worker);
  const preload=preloadLocalAi().catch(()=>{});await vi.waitFor(()=>expect(messages).toHaveLength(1));
  const controller=new AbortController();const pending=runLocalAi({prompt:'',audio:new Float32Array([.1])},()=>{},controller.signal);
  controller.abort();cancelLocalAi();await expect(pending).rejects.toThrow('已取消');await preload;
  expect(messages).toHaveLength(1);expect(Worker).toHaveBeenCalledTimes(1);
});
