import { getModelConfiguration, type LocalModelConfiguration } from './model-config';
import { runLocalAi, releaseLocalAi } from './local-ai';
const PREFERENCE = 'aftertrace.speech-model-choice';
export class SpeechFallbackError extends Error {}
export function resetSpeechModelChoice() { try { localStorage.removeItem(PREFERENCE); } catch { /* Storage may be disabled. */ } }
function key(m: LocalModelConfiguration) { return [m.speechModel,m.speechRevision,m.speechFallbackModel,m.speechFallbackRevision].join('@'); }
function remembered(m: LocalModelConfiguration): boolean { try { const p=JSON.parse(localStorage.getItem(PREFERENCE)??'null');return p?.key===key(m)&&p?.fallback===true; } catch { return false; } }
function remember(m: LocalModelConfiguration, fallback: boolean) { try { localStorage.setItem(PREFERENCE,JSON.stringify({key:key(m),fallback})); } catch { /* A choice still works for this attempt. */ } }
async function cached(m: LocalModelConfiguration): Promise<boolean> {
  try {
    if (!globalThis.caches || !(await caches.keys()).includes('transformers-cache')) return false;
    const urls=(await (await caches.open('transformers-cache')).keys()).map(r=>r.url);
    const prefix='https://huggingface.co/'+m.speechModel+'/resolve/'+m.speechRevision+'/onnx/';
    return ['encoder_model_q4.onnx','decoder_model_merged_q4.onnx'].every(file=>urls.includes(prefix+file));
  } catch { return false; }
}
async function enoughStorage(m: LocalModelConfiguration, bytes?: number): Promise<boolean> {
  if (!bytes || !navigator.storage?.estimate || await cached(m)) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const estimate=await Promise.race([navigator.storage.estimate(),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),2000);})]);
    if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return true;
    return Math.max(0,estimate.quota!-estimate.usage!) >= bytes*1.15+64*1024*1024;
  } catch { return true; } finally { if(timer)clearTimeout(timer); }
}
export async function transcribeLocalSpeech(audio: Float32Array, language: 'chinese'|'english', options: {
  baseUrl: string; mode?: 'primary'|'fallback'; signal?: AbortSignal; progress?: (text:string)=>void;
  onModel?: (value:{fallback:boolean;canFallback:boolean})=>void;
}): Promise<string> {
  const check=()=>{if(options.signal?.aborted)throw new Error('已取消語音辨識，錄音仍保留。');};check();
  const config=await getModelConfiguration(options.baseUrl);check();
  const available=!!config.speechFallbackModel&&!!config.speechFallbackRevision&&config.speechFallbackModel!==config.speechModel;
  const fallback=available&&(options.mode==='fallback'||(!options.mode&&remembered(config)));
  if(options.mode==='fallback'&&!available)throw new Error('目前沒有設定其他語音模型，請重試或手動輸入。');
  if(options.mode)remember(config,fallback);
  const selected=fallback?{...config,speechModel:config.speechFallbackModel!,speechRevision:config.speechFallbackRevision!}:config;
  options.onModel?.({fallback,canFallback:available&&!fallback});
  if(!await enoughStorage(selected,fallback?config.speechFallbackDownloadBytes:config.speechDownloadBytes)){
    check();if(available&&!fallback)throw new SpeechFallbackError('瀏覽器可用儲存空間可能不足，尚未下載主要語音模型。可改用較輕量模型，或清除模型快取後重試。');
    throw new Error('瀏覽器可用儲存空間可能不足，請清除模型快取後重試，或使用文字輸入。');
  }
  check();options.progress?.(fallback?'使用較輕量語音模型，錄音仍在此裝置辨識。':'使用主要語音模型，在此裝置辨識。');
  try { const text=await runLocalAi({prompt:'',audio,language,models:selected,diagnosticModelChoice:fallback?'FALLBACK':'PRIMARY'},options.progress,options.signal);check();return text; }
  catch(error){
    check();const message=error instanceof Error?error.message:'語音辨識失敗';
    if(available&&!fallback&&!/取消|WebGPU|此裝置無法|沒有收到聲音|錄音資料|語音長度/.test(message)){
      releaseLocalAi();throw new SpeechFallbackError(message+'；可保留原錄音，改用較輕量模型重試。');
    }
    throw error;
  }
}
