import { AutoProcessor, Qwen3_5ForConditionalGeneration, RawImage, pipeline, env, type Tensor } from '@huggingface/transformers';
import type { LocalRequest } from './local-ai';

// Remote access is used only to download static model/runtime assets. Inference is local.
env.allowLocalModels = false;
env.useBrowserCache = true;
// Download static runtime assets only. No text, image or audio is sent here.
const ortVersion = env.backends.onnx.versions!.web;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
};
let loadedModelKey = '';
const progress = (event: { status?: string; progress?: number }) => {
  if (event.status === 'progress') postMessage({ type: 'progress', text: `下載模型資源（目前檔案 ${Math.round(event.progress ?? 0)}%）` });
};
let model: Awaited<ReturnType<typeof Qwen3_5ForConditionalGeneration.from_pretrained>> | null = null;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;

self.onmessage = async ({ data }: MessageEvent<LocalRequest>) => {
  try {
    postMessage({ type: 'progress', text: '準備本機模型，首次使用需要下載，可能需要數分鐘。' });
    if (!data.models) throw new Error('缺少模型設定，請重新整理後重試。');
    const selected = data.models;
    if (data.audio) {
      // Release the vision/text model before loading speech to bound GPU memory.
      await model?.dispose(); model = null; processor = null; loadedModelKey = '';
      const { normalizeSpeechText, validateSpeechSignal } = await import('./speech-text');
      validateSpeechSignal(data.audio);
      const transcriber = await pipeline('automatic-speech-recognition', selected.speechModel, { revision: selected.speechRevision, device: 'webgpu', dtype: 'q4', progress_callback: progress });
      try {
        const output = await transcriber(data.audio, { task: 'transcribe', language: data.language ?? 'chinese', chunk_length_s: 25, stride_length_s: 3 });
        postMessage({ type: 'result', text: normalizeSpeechText((Array.isArray(output) ? output[0] : output).text, data.language) });
      } finally { await transcriber.dispose(); }
      return;
    }
    const key = selected.visionModel + '@' + selected.visionRevision;
    if (loadedModelKey !== key) { await model?.dispose(); model = null; processor = null; loadedModelKey = key; }
    processor ??= await AutoProcessor.from_pretrained(selected.visionModel, { revision: selected.visionRevision, progress_callback: progress });
    model ??= await Qwen3_5ForConditionalGeneration.from_pretrained(selected.visionModel, {
      revision: selected.visionRevision,
      device: 'webgpu', dtype: { embed_tokens: 'q4', vision_encoder: 'fp16', decoder_model_merged: 'q4' }, progress_callback: progress,
    });
    if (data.preload) { postMessage({ type: 'result', text: '' }); return; }
    const content: ({ type: 'image' } | { type: 'text'; text: string })[] = [];
    let image: RawImage | undefined;
    if (data.image) {
      image = await RawImage.fromBlob(data.image);
      if (image.width * image.height > 25_000_000) throw new Error('圖片解析度過大，請縮小後再試。');
      if (Math.max(image.width, image.height) > 1024) {
        const ratio = 1024 / Math.max(image.width, image.height);
        image = await image.resize(Math.round(image.width * ratio), Math.round(image.height * ratio));
      }
      content.push({ type: 'image' });
    }
    content.push({ type: 'text', text: data.prompt });
    const text = processor.apply_chat_template([{ role: 'user', content }], { add_generation_prompt: true });
    const inputs = image ? await processor(text, image) : await processor(text);
    postMessage({ type: 'progress', text: '正在使用此裝置解析，請稍候…' });
    const output = await model.generate({ ...inputs, max_new_tokens: Math.max(64, Math.min(data.maxNewTokens ?? 768, 768)), do_sample: false }) as Tensor;
    const decoded = processor.batch_decode(output.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true });
    postMessage({ type: 'result', text: decoded[0] });
  } catch (error) {
    postMessage({ type: 'error', text: error instanceof Error ? `本機解析失敗：${error.message}` : '本機解析失敗，請重試或手動輸入。' });
  }
};
