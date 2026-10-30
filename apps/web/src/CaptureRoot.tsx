import { useEffect, useMemo, useRef, useState } from 'react';
import { inferOccurrenceTime } from './occurrence-time';

import { cancelLocalAi, preloadLocalAi, organizeLocal, validateImage, type LocalDraft } from './local-ai';
import { WorklogApi, type RecordScope } from './worklog-api';

import './capture.css';
import { transcribeLocalSpeech, SpeechFallbackError, resetSpeechModelChoice } from './speech-runtime';

export function CaptureRoot({ apiBaseUrl, embedded = false, onSaved, onScopeChange }: { apiBaseUrl: string; embedded?: boolean; onSaved?: (scope: RecordScope) => void; onScopeChange?: (scope: RecordScope) => void }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const session = 'local-device';

  const [scope, setScope] = useState<RecordScope | null>(null);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [voiceClip,setVoiceClip]=useState<Blob|null>(null);const [voiceUrl,setVoiceUrl]=useState('');const [hasSpeech,setHasSpeech]=useState(false);
  useEffect(()=>{if(!voiceClip){setVoiceUrl('');return;}const url=URL.createObjectURL(voiceClip);setVoiceUrl(url);return()=>URL.revokeObjectURL(url);},[voiceClip]);
  const [draft, setDraft] = useState<LocalDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const speechAbort=useRef<AbortController|null>(null);
  const [speechBusy,setSpeechBusy]=useState(false),[speechSlow,setSpeechSlow]=useState(false),[speechRetry,setSpeechRetry]=useState(false),[speechFallback,setSpeechFallback]=useState(false),[speechUsingFallback,setSpeechUsingFallback]=useState(false);
  const [speechLanguage, setSpeechLanguage] = useState<'chinese' | 'english'>('chinese');
  const [status, setStatus] = useState('');
  const [modelStatus, setModelStatus] = useState('');
  const [preparingModel, setPreparingModel] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const lock = useRef(false);
  const review = useRef<HTMLElement | null>(null);
  useEffect(() => { if (draft) { review.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); review.current?.querySelector('input')?.focus({ preventScroll: true }); } }, [!!draft]);

  useEffect(() => {
    if (!session || !scope) return;
    let active = true; setPreparingModel(true);
    void preloadLocalAi((message) => { if (active) setModelStatus(message); })
      .then(() => { if (active) setModelStatus('本機 AI 已準備好。'); })
      .catch((cause: unknown) => { if (active) setModelStatus(cause instanceof Error ? cause.message + '；仍可手動編輯保存。' : '模型尚未準備好，可按 AI 解析重試或手動保存。'); })
      .finally(() => { if (active) setPreparingModel(false); });
    return () => { active = false; };
  }, [session, !!scope]);
  useEffect(() => {
    const guard = (event: Event) => { if ((input.trim() || image || voiceClip || draft || recording || busy) && !window.confirm('離開會捨棄尚未保存的內容，確定離開？')) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (input.trim() || image || draft || recording || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('aftertrace:before-navigate', guard); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('aftertrace:before-navigate', guard); window.removeEventListener('beforeunload', unload); };
  }, [input, image, voiceClip, draft, recording, busy]);
  useEffect(() => {
    mounted.current = true;
    if (session) void api.surfaces(session).then((value) => {
      if (!mounted.current) return;

      let remembered: RecordScope | null = null;
      try { remembered = JSON.parse(localStorage.getItem('aftertrace.worklog.scope') ?? 'null') as RecordScope | null; } catch { /* Ignore invalid remembered scope. */ }
      const valid = remembered && ((remembered.type === 'PERSONAL' && value.personal?.sourceId === remembered.sourceId) || (remembered.type === 'GROUP' && value.groups.some((group) => group.sourceId === remembered?.sourceId)));
      const next: RecordScope | null = valid ? remembered : value.personal ? { type: 'PERSONAL', sourceId: value.personal.sourceId } : value.groups[0] ? { type: 'GROUP', sourceId: value.groups[0].sourceId } : null;
      setScope(next); if (next) onScopeChange?.(next);
    }).catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : '圖片無法讀取'); });
    return () => { mounted.current = false; speechAbort.current?.abort(); generation.current++; cancelLocalAi(); if (timer.current) clearTimeout(timer.current); if (recorder.current) { recorder.current.onstop = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); } stream.current?.getTracks().forEach((track) => track.stop()); };
  }, [api, session]);
  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function pickImage(file: File | null) {
    if (!file) return;
    try { validateImage(file); setImage(file); setError(''); } catch (cause) { setError(String(cause)); }
  }
  async function analyze() {
    if (lock.current || recording || draft || (!input.trim() && !image)) return;
    lock.current = true; const id = ++generation.current; setBusy(true); setError('');
    try { const next = await organizeLocal(input, image ?? undefined, setStatus, apiBaseUrl); if (mounted.current && id === generation.current) { setDraft(next); setStatus('請核對並修改草稿，確認後才會保存。'); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '解析失敗'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function startRecording() {
    if (recording) { recorder.current?.stop(); return; }
    if (busy || lock.current || draft) return;
    lock.current = true; setBusy(true); setError('');
    const id = ++generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('此瀏覽器不支援錄音，請改用文字。');
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || id !== generation.current) { capture.getTracks().forEach((track) => track.stop()); return; }
      stream.current = capture;
      const instance = new MediaRecorder(capture); recorder.current = instance;
      const chunks: Blob[] = [];
      instance.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      instance.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        capture.getTracks().forEach((track) => track.stop()); recorder.current = null;
        if (!mounted.current || id !== generation.current) return;
        setRecording(false); setBusy(true); lock.current = true;
        const clip=new Blob(chunks,{type:instance.mimeType});setVoiceClip(clip);setHasSpeech(true);void transcribe(clip,id);
      };
      instance.onerror = () => { setError('錄音失敗，請重試。'); if (instance.state !== 'inactive') instance.stop(); };
      instance.start(); setRecording(true); setStatus('錄音中，最多 60 秒；按停止後在本機辨識。');
      timer.current = setTimeout(() => { if (instance.state === 'recording') instance.stop(); }, 60_000);
    } catch (cause) { stream.current?.getTracks().forEach((track) => track.stop()); setError(cause instanceof Error ? cause.message : '無法錄音'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function retrySpeech(mode?:'primary'|'fallback') {
    if(!voiceClip||recording||draft)return;
    speechAbort.current?.abort();cancelLocalAi();const id=++generation.current;lock.current=true;setBusy(true);setError('');void transcribe(voiceClip,id,mode);
  }
  async function transcribe(blob: Blob, id: number, mode?:'primary'|'fallback') {
    const controller=new AbortController();speechAbort.current=controller;setSpeechBusy(true);setSpeechSlow(false);setSpeechRetry(false);setSpeechFallback(false);
    const slow=setTimeout(()=>{if(mounted.current&&id===generation.current)setSpeechSlow(true);},30000);
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ sampleRate: 16000 });
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (decoded.duration > 61) throw new Error('錄音超過 60 秒，請重新錄製。');
      const length = Math.min(decoded.length, 60 * 16000);
      const mono = new Float32Array(length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const samples = decoded.getChannelData(channel);
        for (let i = 0; i < length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
      }
      if(controller.signal.aborted||id!==generation.current)return;
      const text = await transcribeLocalSpeech(mono,speechLanguage,{baseUrl:apiBaseUrl,mode,signal:controller.signal,progress:setStatus,onModel:({fallback,canFallback})=>{if(mounted.current&&id===generation.current){setSpeechUsingFallback(fallback);setSpeechFallback(canFallback);}}});
      if (!text.trim()) throw new Error('沒有辨識到語音，請重試。');
      if (mounted.current && id === generation.current) { setSpeechFallback(false);setInput((current) => [current, text].filter(Boolean).join('\n')); setStatus('語音已轉成文字，請先核對人名、金額與否定語句，再解析或自行編輯。'); }
    } catch (cause) { if (mounted.current&&id===generation.current) {setSpeechRetry(true);setSpeechFallback(cause instanceof SpeechFallbackError);setError(cause instanceof Error ? cause.message : '語音辨識失敗');} }
    finally { clearTimeout(slow);await context?.close();if(mounted.current&&id===generation.current){lock.current=false;setBusy(false);setSpeechBusy(false);setSpeechSlow(false);} }
  }
  async function save() {
    if (lock.current || !session || !scope || !draft?.rawText.trim()) return;
    if (draft.occurredAt && Number.isNaN(new Date(draft.occurredAt).getTime())) { setError('請輸入有效時間。'); return; }
    lock.current = true; setBusy(true); setSaving(true); setError('');
    try {
      await api.createRecord(session, scope, { title: draft.title.trim() || null, rawText: draft.rawText.trim(), occurredAt: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : null });
      setDraft(null); setInput(''); setImage(null);setVoiceClip(null);setHasSpeech(false); setStatus('紀錄已保存。'); onSaved?.(scope);
    } catch (cause) { setError(captureSaveError(cause)); }
    finally { lock.current = false; setBusy(false); setSaving(false); }
  }

  const content = <section className="panel stack local-capture">
    {embedded ? <h2>留下紀錄</h2> : <h1>留下紀錄</h1>}<p>文字、圖片與短語音都在此裝置解析；確認內容後才保存。</p><details><summary>首次使用與裝置需求</summary><p>首次使用需下載數百 MB 至數 GB 的模型資源，建議使用 Wi-Fi。可在「本機 AI」頁面查看或清除快取。此裝置需支援 WebGPU，無法使用時仍可手動保存。</p></details>
    {error && <div className="error" role="alert">{error}</div>}
    {modelStatus && <div className="capture-status"><p aria-live="polite">{modelStatus}</p>{preparingModel && <button className="ghost" onClick={cancelLocalAi}>暫停準備模型</button>}</div>}
    {status && <p className="capture-status" role="status" aria-live="polite">{status}</p>}
    <p className="muted">保存位置：此裝置的本機紀錄</p>
    <label>輸入內容或貼上圖片<textarea aria-label="輸入內容或貼上圖片" maxLength={20000} rows={draft ? 3 : 6} value={input} disabled={busy || recording || !!draft} onChange={(event) => setInput(event.target.value)} onPaste={(event) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); if (files.length > 1) setError('一次只能處理一張圖片。'); else pickImage(files[0]); }
    }} /></label>
    <label>選擇圖片（PNG、JPEG、WebP，最多 5 MB）<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || recording || !!draft} onChange={(event) => { pickImage(event.target.files?.[0] ?? null); event.target.value = ''; }} /></label>
    {preview && <div><img src={preview} alt="待解析圖片" style={{ maxWidth: '100%', maxHeight: 300 }} /><button className="ghost" disabled={busy || recording || !!draft} onClick={() => setImage(null)}>移除圖片</button></div>}
    {voiceUrl&&<section className="capture-voice-review"><strong>重聽最近一次錄音</strong><audio aria-label="重聽最近一次錄音" controls preload="metadata" src={voiceUrl}/><p className="muted">錄音只留在這個頁面，保存或離開後移除，不會上傳。</p><button className="ghost" disabled={busy||recording} onClick={()=>{setVoiceClip(null);setSpeechRetry(false);setSpeechFallback(false);}}>移除錄音</button></section>}
    {voiceClip&&!draft&&<section className="capture-speech-options" aria-label="語音模型與重試">{speechUsingFallback&&<p className="muted">此裝置使用較輕量語音模型，可重設選擇以恢復優先使用主要模型。</p>}{speechBusy&&speechSlow&&<p role="note">下載或辨識時間較長；可以取消，或用同一段錄音切換較輕量模型。</p>}{speechFallback&&(!speechBusy||speechSlow)&&<button className="ghost" disabled={recording} onClick={()=>retrySpeech('fallback')}>改用較輕量模型辨識原錄音</button>}{speechRetry&&!busy&&<button className="ghost" onClick={()=>retrySpeech()}>重新辨識原錄音</button>}</section>}
    {hasSpeech&&<p className="capture-review-warning" role="note">語音可能誤認同音姓名與詞語，AI 整理也可能出錯。請核對標題、人名、金額與「未付款／未完成」等狀態，修改正確後再確認保存。</p>}
    {!draft && <label>語音語言<select disabled={busy || recording} value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value as 'chinese' | 'english')}><option value="chinese">中文</option><option value="english">英文</option></select></label>}
    {!draft&&<button className="ghost" disabled={busy||recording} onClick={()=>{resetSpeechModelChoice();setSpeechUsingFallback(false);setStatus('已重設裝置選擇，下次語音將優先使用主要模型。');}}>重設此裝置語音模型選擇</button>}
    {!draft && <p className="capture-voice-hint muted">每次最多 60 秒，語音在此裝置辨識；確認後才保存。</p>}
    {!draft && <div className="filter-actions">
      <button className={recording ? 'danger' : 'ghost'} aria-label={recording ? '停止錄音' : '錄製短語音（最多 60 秒）'} disabled={busy || !!draft} onClick={() => void startRecording()}>{recording ? '停止錄音' : '錄製短語音'}</button>
      <button disabled={busy || recording || !!draft || (!input.trim() && !image)} onClick={() => void analyze()}>AI 解析</button>
      <button className="ghost" disabled={busy || recording || !!draft || !input.trim()} onClick={() => setDraft({ title: '', rawText: input, ...inferOccurrenceTime(input) })}>自行編輯草稿</button>
      {busy && !saving && <button className="ghost" onClick={() => { speechAbort.current?.abort();generation.current++; cancelLocalAi();lock.current=false;setBusy(false);setSpeechBusy(false);setSpeechSlow(false);if(voiceClip)setSpeechRetry(true);setStatus('已取消解析，輸入內容與錄音仍保留。'); }}>取消解析</button>}
    </div>}
    {draft && <section ref={review} className="panel stack capture-review" aria-label="保存前確認">{embedded ? <h3>確認要保存的資訊</h3> : <h2>確認要保存的資訊</h2>}<p>請確認並修改要保存的內容。圖片與錄音不會上傳，只有確認後的文字會保存。</p>
      {draft.reviewNote&&<p className="capture-review-warning" role="note">{draft.reviewNote}</p>}
      <label>標題<input maxLength={255} disabled={busy} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>內容<textarea aria-label="內容" maxLength={20000} rows={8} disabled={busy} value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} /></label>
      <label>發生時間（選填）<input type="datetime-local" disabled={busy} value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value, timeNote: undefined })} /></label>
      {draft.timeNote && <p className="muted" role="note">{draft.timeNote}</p>}
      <div className="filter-actions"><button disabled={busy || !scope || !draft.rawText.trim()} onClick={() => void save()}>確認保存</button><button className="ghost" disabled={busy} onClick={() => { if (window.confirm('捨棄已編輯的草稿並返回輸入？')) setDraft(null); }}>返回輸入</button></div>
    </section>}
  </section>;
  return embedded ? content : <main className="shell local-capture-page">{content}</main>;
}

export function captureSaveError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : '';
  const labels: Record<string, string> = {
    GROUP_ACCESS_FORBIDDEN: '你已無法存取這個群組，草稿已保留。請返回輸入並改選保存範圍。',
    SOURCE_NOT_AUTHORIZED: '你沒有這個紀錄範圍的權限，草稿已保留。',


    RECORD_TEXT_REQUIRED: '請輸入要保存的內容，最多 20,000 字。',
  };
  return labels[code] ?? (code || '保存失敗，草稿仍保留。');
}
