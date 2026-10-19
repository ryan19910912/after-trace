import { useEffect, useMemo, useRef, useState } from 'react';
import { AiCaptureApi, type AiEntitlementDecision } from './ai-capture-api';
import { LoginProviderButtons } from './LoginProviderButtons';
import { browserSpeechRecognitionSupported, createBrowserSpeechRecognition, speechRecognitionErrorMessage, type BrowserSpeechRecognition } from './speech-input';
import { WorklogApi, type RecordScope, type WorklogSurfaces } from './worklog-api';
import './worklog.css';
import './capture.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';
const HARD_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const HARD_MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 30 * 1024 * 1024;

type Props = { apiBaseUrl: string };
type CaptureScope = RecordScope;
type CaptureDraft = { title: string; rawText: string; occurredAt: string };
type SpeechState = 'IDLE' | 'LISTENING' | 'ERROR';
type CaptureMode = 'MANUAL' | 'AI';
type MediaKind = 'IMAGE' | 'AUDIO' | 'FILE';
const EMPTY_DRAFT: CaptureDraft = { title: '', rawText: '', occurredAt: '' };

export function CaptureRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const aiApi = useMemo(() => new AiCaptureApi(apiBaseUrl), [apiBaseUrl]);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechSupported = useMemo(() => browserSpeechRecognitionSupported(), []);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<CaptureScope | null>(() => storedScope());
  const [mode, setMode] = useState<CaptureMode>('MANUAL');
  const [entitlement, setEntitlement] = useState<AiEntitlementDecision | null>(null);
  const [entitlementLoading, setEntitlementLoading] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft>({ ...EMPTY_DRAFT });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>('IDLE');
  const [interimText, setInterimText] = useState('');
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); return () => abortSpeechCapture(); }, []);
  useEffect(() => { if (!scope) return; localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope)); if (session) void loadEntitlement(session, scope.sourceId); }, [scope?.type, scope?.sourceId, session]);

  async function bootstrap() {
    setLoading(true); setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      const token = callback || localStorage.getItem(SESSION_KEY);
      if (callback) { localStorage.setItem(SESSION_KEY, callback); setSession(callback); window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`); }
      if (!token) return;
      const nextSurfaces = await api.surfaces(token); setSurfaces(nextSurfaces);
      const remembered = storedScope(); const nextScope = remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces); setScope(nextScope);
      if (nextScope) await loadEntitlement(token, nextScope.sourceId);
    } catch (cause) { setError(message(cause, '快速紀錄載入失敗')); }
    finally { setLoading(false); }
  }
  async function loadEntitlement(token: string, sourceId: number) { setEntitlementLoading(true); try { setEntitlement(await aiApi.entitlement(token, sourceId)); } catch (cause) { setEntitlement(null); if (mode === 'AI') setError(message(cause, 'AI 使用狀態載入失敗')); } finally { setEntitlementLoading(false); } }
  function chooseScope(nextScope: CaptureScope) { abortSpeechCapture(); setScope(nextScope); setInterimText(''); setSpeechMessage(null); setNotice(null); }
  function chooseMode(nextMode: CaptureMode) { abortSpeechCapture(); setMode(nextMode); setError(null); setNotice(null); if (nextMode === 'AI' && session && scope) void loadEntitlement(session, scope.sourceId); }
  function toggleSpeechCapture() { if (speechState === 'LISTENING') stopSpeechCapture(); else startSpeechCapture(); }
  function startSpeechCapture() {
    if (!scope) { setSpeechMessage('請先選擇要記錄到哪裡。'); return; }
    if (!speechSupported) { setSpeechState('ERROR'); setSpeechMessage('這個瀏覽器目前不支援語音轉文字，可以直接使用文字輸入。'); return; }
    abortSpeechCapture(); setSpeechMessage(null); setError(null); setInterimText('');
    const recognition = createBrowserSpeechRecognition({ onTranscript: ({ finalText, interimText: interim }) => { if (finalText) setDraft((current) => ({ ...current, rawText: appendSpeechText(current.rawText, finalText) })); setInterimText(interim); }, onError: (code) => { if (recognitionRef.current === recognition) recognitionRef.current = null; setSpeechState('ERROR'); setInterimText(''); setSpeechMessage(speechRecognitionErrorMessage(code)); }, onEnd: () => { if (recognitionRef.current === recognition) recognitionRef.current = null; setSpeechState((current) => current === 'ERROR' ? current : 'IDLE'); setInterimText(''); } });
    if (!recognition) return; recognitionRef.current = recognition; try { recognition.start(); setSpeechState('LISTENING'); } catch { recognitionRef.current = null; setSpeechState('ERROR'); setSpeechMessage('麥克風無法啟動，可以再試一次或直接使用文字輸入。'); }
  }
  function stopSpeechCapture() { const recognition = recognitionRef.current; if (!recognition) { setSpeechState('IDLE'); setInterimText(''); return; } try { recognition.stop(); } catch { recognitionRef.current = null; setSpeechState('IDLE'); setInterimText(''); } }
  function abortSpeechCapture() { const recognition = recognitionRef.current; recognitionRef.current = null; if (recognition) { try { recognition.abort?.(); } catch {} } setSpeechState('IDLE'); setInterimText(''); }

  async function saveRecord() {
    if (!session || !scope || !draft.rawText.trim()) return;
    if (mode === 'MANUAL' && !optionalLocalDateValid(draft.occurredAt)) return;
    abortSpeechCapture(); setSaving(true); setError(null); setNotice(null);
    try {
      if (mode === 'AI') {
        if (!entitlement?.allowed || entitlement.source === 'BLOCKED') throw new Error(entitlement?.reason ?? 'AI_NOT_ENTITLED');
        const result = await aiApi.captureText(session, scope.sourceId, draft.rawText.trim());
        setDraft({ ...EMPTY_DRAFT }); setNotice(`AI 已整理並記錄${result.record.title ? `：${result.record.title}` : '。'}`); await loadEntitlement(session, scope.sourceId);
      } else {
        await api.createRecord(session, scope, { title: draft.title.trim() || null, rawText: draft.rawText.trim(), occurredAt: localDateOrNull(draft.occurredAt) });
        setDraft({ ...EMPTY_DRAFT }); setNotice('紀錄已儲存。');
      }
    } catch (cause) { setError(aiCaptureErrorMessage(message(cause, mode === 'AI' ? 'AI 紀錄失敗' : '新增紀錄失敗'))); }
    finally { setSaving(false); }
  }

  async function processMedia(kind: MediaKind) {
    if (!session || !scope || !entitlement?.allowed || entitlement.source === 'BLOCKED' || saving) return;
    const file = kind === 'IMAGE' ? imageFile : kind === 'AUDIO' ? audioFile : documentFile; if (!file) return;
    const hardMaxBytes = kind === 'IMAGE' ? HARD_MAX_IMAGE_BYTES : kind === 'AUDIO' ? HARD_MAX_AUDIO_BYTES : HARD_MAX_FILE_BYTES;
    if (file.size > hardMaxBytes) { setError(`${kindLabel(kind)}檔案超過系統可處理的大小，請縮小後再試。`); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      let title: string | null = null;
      if (kind === 'IMAGE') title = (await aiApi.captureImage(session, scope.sourceId, file, draft.rawText)).record.title;
      if (kind === 'AUDIO') title = (await aiApi.captureAudio(session, scope.sourceId, file, draft.rawText, await audioDuration(file))).record.title;
      if (kind === 'FILE') title = (await aiApi.captureFile(session, scope.sourceId, file, draft.rawText)).record.title;
      if (kind === 'IMAGE') setImageFile(null); if (kind === 'AUDIO') setAudioFile(null); if (kind === 'FILE') setDocumentFile(null);
      setDraft((current) => ({ ...current, rawText: '' })); setNotice(`${kindLabel(kind)}已由 AI 整理並記錄${title ? `：${title}` : '。'}`); await loadEntitlement(session, scope.sourceId);
    } catch (cause) { setError(aiCaptureErrorMessage(message(cause, 'AI 檔案處理失敗'))); }
    finally { setSaving(false); }
  }

  if (!session) return <main className="shell capture-shell"><section className="panel capture-login-card"><p className="eyebrow">AFTERTRACE</p><h1>快速紀錄</h1><p className="muted">登入後即可快速留下工作紀錄。</p>{error ? <div className="error">{error}</div> : null}<LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/capture" /><button className="ghost" onClick={() => { window.location.href = '/'; }}>回紀錄頁</button></section></main>;

  const occurredAtValid = optionalLocalDateValid(draft.occurredAt);
  const aiAllowed = entitlement?.allowed === true && entitlement.source !== 'BLOCKED';
  const saveDisabled = saving || !scope || !draft.rawText.trim() || (mode === 'MANUAL' && !occurredAtValid) || (mode === 'AI' && (!aiAllowed || entitlementLoading));

  return <main className="shell capture-shell"><header className="capture-topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>快速紀錄</h1></div><button className="ghost" onClick={() => { window.location.href = '/'; }}>回紀錄頁</button></header>{error ? <div className="error">{error}</div> : null}{notice ? <div className="worklog-notice">{notice}</div> : null}<section className="panel capture-card">
    <div className="capture-scope-row">{surfaces?.personal ? <button className={scope?.type === 'PERSONAL' ? 'worklog-scope active' : 'worklog-scope'} onClick={() => chooseScope({ type: 'PERSONAL', sourceId: surfaces.personal!.sourceId })}>我的紀錄</button> : null}{surfaces?.groups.map((group) => <button key={group.sourceId} className={scope?.type === 'GROUP' && scope.sourceId === group.sourceId ? 'worklog-scope active' : 'worklog-scope'} onClick={() => chooseScope({ type: 'GROUP', sourceId: group.sourceId })}>{group.name}</button>)}</div>
    <div className="capture-mode-row"><button className={mode === 'MANUAL' ? 'capture-mode active' : 'capture-mode'} onClick={() => chooseMode('MANUAL')}><strong>一般紀錄</strong><span>免費使用，自己輸入文字</span></button><button className={mode === 'AI' ? 'capture-mode active' : 'capture-mode'} onClick={() => chooseMode('AI')}><strong>AI 整理</strong><span>免費體驗額度或 AI Pro 都可使用</span></button></div>
    {mode === 'AI' ? <AiEntitlementCard entitlement={entitlement} loading={entitlementLoading} /> : null}
    <button className={`capture-mic${speechState === 'LISTENING' ? ' listening' : ''}`} disabled={loading || saving || !scope} onClick={toggleSpeechCapture}>🎙️ {speechState === 'LISTENING' ? '停止語音輸入' : '語音轉文字'}</button>
    {speechMessage ? <p className="capture-warning">{speechMessage}</p> : null}{interimText ? <div className="capture-interim"><span>辨識中</span><strong>{interimText}</strong></div> : null}
    {mode === 'MANUAL' ? <label className="capture-title-label">標題（選填）<input value={draft.title} maxLength={255} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：客戶報價討論" /></label> : null}
    <label className="capture-text-label">{mode === 'AI' ? '要整理的文字或補充說明' : '紀錄內容'}<textarea rows={7} value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} placeholder={mode === 'AI' ? '輸入工作內容，AI 會協助整理並扣除可用 AI 點數。' : '直接輸入工作紀錄，或使用瀏覽器語音轉文字。'} /></label>
    {mode === 'MANUAL' ? <><label className="capture-time-label">發生時間（選填）<input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label><p className="muted">標題與發生時間都可以留空；內容為必填。瀏覽器語音轉文字不會消耗 AI 額度。</p></> : null}
    {mode === 'AI' ? <section className="capture-media-panel"><h3>圖片、音訊與檔案整理</h3><p className="muted">免費 AI 體驗與 AI Pro 都可使用；每次處理會依實際用量扣除 AI 點數。免費體驗採安全的檔案大小與音訊長度限制，AI Pro 則依訂閱方案設定。</p>{aiAllowed ? <div className="capture-media-grid"><MediaPicker label="圖片" accept="image/png,image/jpeg,image/webp" file={imageFile} onFile={setImageFile} note="目前一次選擇 1 張" busy={saving} onSubmit={() => void processMedia('IMAGE')} /><MediaPicker label="音訊" accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav" file={audioFile} onFile={setAudioFile} note="依可用方案限制長度與大小" busy={saving} onSubmit={() => void processMedia('AUDIO')} /><MediaPicker label="檔案" accept="application/pdf,text/plain,text/markdown,text/csv,application/json,application/xml,text/xml" file={documentFile} onFile={setDocumentFile} note="PDF、文字、CSV 等" busy={saving} onSubmit={() => void processMedia('FILE')} /></div> : <div className="capture-media-locked">{entitlementLoading ? '正在確認 AI 額度…' : '目前沒有可用 AI 額度；可升級 AI Pro 繼續使用。'}</div>}</section> : null}
    <div className="capture-actions"><button disabled={saveDisabled} onClick={() => void saveRecord()}>{saving ? '處理中…' : mode === 'AI' ? 'AI 整理並記錄' : '儲存紀錄'}</button><button className="ghost" disabled={saving || (!draft.title && !draft.rawText && !draft.occurredAt)} onClick={() => setDraft({ ...EMPTY_DRAFT })}>清除</button></div>
  </section></main>;
}

function MediaPicker({ label, accept, file, onFile, note, busy, onSubmit }: { label: string; accept: string; file: File | null; onFile: (file: File | null) => void; note: string; busy: boolean; onSubmit: () => void }) { return <div className="capture-media-item"><strong>{label}</strong><input type="file" accept={accept} disabled={busy} onChange={(event) => onFile(event.target.files?.[0] ?? null)} /><small>{file ? file.name : note}</small><button disabled={busy || !file} onClick={onSubmit}>用 AI 整理</button></div>; }
function AiEntitlementCard({ entitlement, loading }: { entitlement: AiEntitlementDecision | null; loading: boolean }) { if (loading) return <div className="capture-ai-state"><strong>正在確認 AI 使用狀態…</strong></div>; if (!entitlement) return <div className="capture-ai-state blocked"><strong>目前無法讀取 AI 使用狀態</strong><span>一般紀錄仍可正常使用。</span></div>; if (entitlement.allowed && entitlement.source === 'FREE_TRIAL') return <div className="capture-ai-state"><strong>免費 AI 體驗可使用</strong><span>目前尚有 {entitlement.remainingPoints?.toLocaleString() ?? '—'} 點，可用於 AI 搜尋、整理、圖片、音訊、檔案、摘要、改寫與待辦建議。</span></div>; if (entitlement.allowed && entitlement.source === 'AI_PRO') return <div className="capture-ai-state"><strong>AI Pro 可使用</strong><span>{entitlement.remainingPoints !== null ? `本期約剩 ${entitlement.remainingPoints.toLocaleString()} 點。` : ''}{entitlement.periodEndsAt ? ` 下次週期：${formatDate(entitlement.periodEndsAt)}。` : ''}</span></div>; return <div className="capture-ai-state blocked"><strong>目前沒有可用 AI 額度</strong><span>{entitlementReason(entitlement.reason, entitlement.periodEndsAt)}</span></div>; }
function entitlementReason(reason: string, periodEndsAt?: string | null): string { const reset = periodEndsAt ? `，預計於 ${formatDate(periodEndsAt)} 恢復` : ''; if (reason === 'TRIAL_EXHAUSTED') return '免費 AI 體驗額度已用完；一般紀錄、一般搜尋與其他免費功能仍可使用。'; if (reason === 'MONTHLY_POINT_CAP_REACHED' || reason === 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED' || reason === 'MONTHLY_PROVIDER_COST_CAP_REACHED') return `本期 AI 使用量已達上限${reset}。`; if (reason === 'PER_REQUEST_POINT_CAP_EXCEEDED') return '這次內容超過單次 AI 使用上限，請縮短後再試。'; return '目前沒有可用 AI 額度；可升級 AI Pro 繼續使用。'; }
function aiCaptureErrorMessage(error: string): string { if (error === 'AI_AUDIO_DURATION_TOO_LONG') return '這段音訊超過目前可用方案允許的長度，請縮短後再試。'; if (error === 'AI_IMAGE_TOO_LARGE' || error === 'AI_AUDIO_TOO_LARGE' || error === 'AI_FILE_TOO_LARGE') return '檔案超過目前可用方案允許的大小，請縮小後再試。'; if (/^[A-Z0-9_]+$/.test(error)) return entitlementReason(error); return error; }
function storedScope(): CaptureScope | null { const raw = localStorage.getItem(ACTIVE_SCOPE_KEY); if (!raw) return null; try { const value = JSON.parse(raw) as Record<string, unknown>; if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') return { type: 'PERSONAL', sourceId: value.sourceId }; if (value.type === 'GROUP' && typeof value.sourceId === 'number') return { type: 'GROUP', sourceId: value.sourceId }; } catch {} return null; }
function defaultScope(surfaces: WorklogSurfaces): CaptureScope | null { if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId }; const group = surfaces.groups[0]; return group ? { type: 'GROUP', sourceId: group.sourceId } : null; }
function scopeExists(scope: CaptureScope, surfaces: WorklogSurfaces): boolean { return scope.type === 'PERSONAL' ? surfaces.personal?.sourceId === scope.sourceId : surfaces.groups.some((group) => group.sourceId === scope.sourceId); }
function appendSpeechText(current: string, next: string): string { const base = current.trimEnd(); const addition = next.trim(); if (!base) return addition; if (!addition) return current; return `${base}${/[。！？!?]$/.test(base) ? ' ' : '，'}${addition}`; }
function optionalLocalDateValid(value: string): boolean { return !value.trim() || !Number.isNaN(new Date(value).getTime()); }
function localDateOrNull(value: string): string | null { return value.trim() ? new Date(value).toISOString() : null; }
function kindLabel(kind: MediaKind): string { return kind === 'IMAGE' ? '圖片' : kind === 'AUDIO' ? '音訊' : '檔案'; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }); }
async function audioDuration(file: File): Promise<number | null> { return new Promise((resolve) => { const audio = document.createElement('audio'); const url = URL.createObjectURL(file); const finish = (value: number | null) => { URL.revokeObjectURL(url); resolve(value); }; audio.preload = 'metadata'; audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : null); audio.onerror = () => finish(null); audio.src = url; }); }
function message(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }
