import {reportLocalError} from './diagnostics';
import { getModelConfiguration, type LocalModelConfiguration } from './model-config';
import { configuredPrompt } from './prompt-config';
import { inferOccurrenceTime } from './occurrence-time';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 60;
export type LocalDraft = { title: string; rawText: string; occurredAt: string; timeNote?: string; reviewNote?: string };
export type LocalRequest = { prompt: string; image?: Blob; audio?: Float32Array; language?: 'chinese' | 'english'; maxNewTokens?: number; preload?: boolean; diagnosticModelChoice?:'PRIMARY'|'FALLBACK'; models?: LocalModelConfiguration };

export function validateImage(file: Blob): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('只接受 PNG、JPEG 或 WebP 圖片，不支援文件或音訊檔上傳。');
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('圖片必須小於 5 MB，且不能是空白檔案。');
}
export function parseLocalDraft(text: string): LocalDraft {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let value: unknown;
  try { value = JSON.parse(cleaned); } catch { throw new Error('AI 未能產生有效草稿，請重試或手動輸入。'); }
  if (!value || typeof value !== 'object') throw new Error('AI 草稿格式不正確。');
  const draft = value as Record<string, unknown>;
  if (typeof draft.rawText !== 'string' || !draft.rawText.trim() || draft.rawText.length > 20000) throw new Error('AI 草稿內容不完整，請重試或手動輸入。');
  return { title: typeof draft.title === 'string' ? draft.title.trim().slice(0, 255) : '', rawText: draft.rawText.trim(), occurredAt: '' };
}

const statusListeners = new Set<(message: string) => void>();
export function subscribeLocalAiStatus(listener: (message: string) => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}
function reportStatus(message: string): void { statusListeners.forEach((listener) => listener(message)); }
let worker: Worker | null = null;
let rejectPending: ((error: Error) => void) | null = null;
let initializing = false;
let modelReady = false;
let preloadPromise: Promise<void> | null = null;
let generation = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRelease() { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(releaseLocalAi, 5 * 60_000); }
export function releaseLocalAi(): void {
  if (idleTimer) clearTimeout(idleTimer); idleTimer = null;
  cancelLocalAi(); worker?.terminate(); worker = null; modelReady = false;
}
export function cancelLocalAi(): void {
  if (!rejectPending && !initializing) { reportStatus(''); return; }
  generation++; initializing = false; modelReady = false; reportStatus('');
  worker?.terminate(); worker = null;
  rejectPending?.(new Error('已取消本機 AI 處理，原有內容仍保留。')); rejectPending = null;
}
export function preloadLocalAi(progress: (message: string) => void = () => {}): Promise<void> {
  if (modelReady) { progress('本機 AI 已準備好。'); return Promise.resolve(); }
  if (preloadPromise) return preloadPromise;
  preloadPromise = executeLocalAi({ prompt: '', preload: true }, progress).then(() => {}).catch(error=>{if(error instanceof Error&&!/取消|WebGPU|此裝置無法/.test(error.message))reportLocalError('AI_MODEL_FAILED','VISION');throw error;}).finally(() => { preloadPromise = null; });
  return preloadPromise;
}
export async function runLocalAi(request: LocalRequest, progress: (message: string) => void = () => {}, signal?: AbortSignal): Promise<string> {
  const check=()=>{if(signal?.aborted)throw new Error('已取消本機 AI 處理，原有內容仍保留。');};check();
  if (preloadPromise) { progress('模型正在背景準備，完成後立即解析…'); try { await preloadPromise; } catch(error) { if(!request.audio)throw error; } }
  check();try{return await executeLocalAi(request, progress);}catch(error){const message=error instanceof Error?error.message:'';if(!signal?.aborted&&!/取消|沒有收到聲音|錄音資料|語音長度|WebGPU|此裝置無法|請先輸入|內容太長|只接受|圖片必須|正在處理/.test(message))reportLocalError(/memory|記憶體/i.test(message)?'AI_MEMORY_LIMIT':'AI_MODEL_FAILED',request.audio?(request.diagnosticModelChoice??'PRIMARY'):'VISION');throw error;}
}
async function executeLocalAi(request: LocalRequest, progress: (message: string) => void): Promise<string> {
  if (rejectPending || initializing) throw new Error('本機 AI 正在處理另一項工作，請稍候。');
  if (request.image) validateImage(request.image);
  if (request.audio && (!request.audio.length || request.audio.length > 16000 * MAX_AUDIO_SECONDS)) throw new Error('語音長度必須介於 0 到 60 秒。');
  if (!request.preload && !request.audio && !request.prompt.trim()) throw new Error('請先輸入內容。');
  if (request.prompt.length > 24000) throw new Error('內容太長，請縮短後分次處理。');
  if (idleTimer) clearTimeout(idleTimer);
  reportStatus('正在準備本機 AI，首次使用需下載模型…');
  const id = ++generation;
  initializing = true;
  let models = request.models;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu || !await gpu.requestAdapter()) throw new Error('此裝置無法使用本機 AI，請使用支援 WebGPU 的瀏覽器，或手動輸入紀錄。');
    models ??= await getModelConfiguration();
    if (id !== generation) throw new Error('已取消本機 AI 處理。');
  } catch (error) { if (id === generation) { reportStatus(''); if (worker) scheduleRelease(); } throw error; }
  finally { if (id === generation) initializing = false; }
  worker ??= new Worker(new URL('./local-ai.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cancelLocalAi(), 10 * 60_000);
    const finish = () => { clearTimeout(timer); rejectPending = null; reportStatus(''); scheduleRelease(); };
    rejectPending = (error) => { finish(); reject(error); };
    worker!.onmessage = ({ data }: MessageEvent<{ type: string; text: string }>) => {
      if (data.type === 'progress') { progress(data.text); reportStatus(data.text); return; }
      finish();
      if (data.type === 'result') { modelReady = !request.audio; resolve(data.text); } else { releaseLocalAi(); reject(new Error(data.text)); }
    };
    worker!.onerror = () => { finish(); releaseLocalAi(); reject(new Error('本機模型無法執行，請重試或改用手動輸入。')); };
    worker!.postMessage({ ...request, models });
  });
}
export function reviewDraftTitle(draft: LocalDraft): LocalDraft {
  const negative=/(尚未|還沒|还没|沒有|没有|未曾|未付款|未支付|未收到|未完成|未通關|不需|無需|取消)/;
  const positive=/(收到|已.{0,3}(完成|付款|收款|通關)|完成|付款成功|支付成功|通關成功|提款|取款|已寄出)/;
  const unsupported=['銀行','提款','取款'].some(term=>draft.title.includes(term)&&!draft.rawText.includes(term));
  if(unsupported||(negative.test(draft.rawText)&&positive.test(draft.title)&&!negative.test(draft.title)))return {...draft,title:'',reviewNote:'內容含未完成狀態，或標題加入了未確認的資訊；已將標題留白，請核對後自行補上。'};
  return draft;
}
export async function organizeLocal(input: string, image?: Blob, progress?: (message: string) => void, apiBaseUrl?: string): Promise<LocalDraft> {
  const request = await configuredPrompt('capture', { input }, apiBaseUrl);
  const output=await runLocalAi({...request,image},progress);let draft:LocalDraft;try{draft=reviewDraftTitle(parseLocalDraft(output));}catch(error){reportLocalError('AI_OUTPUT_INVALID','VISION');throw error;}
  return { ...draft, ...inferOccurrenceTime(image ? [input, draft.rawText].filter(Boolean).join('\n') : input) };
}
