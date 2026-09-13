import { useEffect, useMemo, useRef, useState } from 'react';
import { AiCaptureApi, type AiEntitlementDecision } from './ai-capture-api';
import { LoginProviderButtons } from './LoginProviderButtons';
import {
  browserSpeechRecognitionSupported,
  createBrowserSpeechRecognition,
  speechRecognitionErrorMessage,
  type BrowserSpeechRecognition,
} from './speech-input';
import { WorklogApi, type RecordScope, type WorklogSurfaces } from './worklog-api';
import './worklog.css';
import './capture.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';

type Props = { apiBaseUrl: string };
type CaptureScope = RecordScope;
type CaptureDraft = { title: string; rawText: string; occurredAt: string };
type SpeechState = 'IDLE' | 'LISTENING' | 'ERROR';
type CaptureMode = 'MANUAL' | 'AI';

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
  const [speechState, setSpeechState] = useState<SpeechState>('IDLE');
  const [interimText, setInterimText] = useState('');
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
    return () => abortSpeechCapture();
  }, []);

  useEffect(() => {
    if (!scope) return;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    if (session) void loadEntitlement(session, scope.sourceId);
  }, [scope?.type, scope?.sourceId, session]);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      const token = callback || localStorage.getItem(SESSION_KEY);
      if (callback) {
        localStorage.setItem(SESSION_KEY, callback);
        setSession(callback);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }
      if (!token) return;

      const nextSurfaces = await api.surfaces(token);
      setSurfaces(nextSurfaces);
      const remembered = storedScope();
      const nextScope = remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces);
      setScope(nextScope);
      if (nextScope) await loadEntitlement(token, nextScope.sourceId);
    } catch (cause) {
      setError(message(cause, '快速紀錄載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function loadEntitlement(token: string, sourceId: number) {
    setEntitlementLoading(true);
    try {
      setEntitlement(await aiApi.entitlement(token, sourceId));
    } catch (cause) {
      setEntitlement(null);
      if (mode === 'AI') setError(message(cause, 'AI 使用狀態載入失敗'));
    } finally {
      setEntitlementLoading(false);
    }
  }

  function chooseScope(nextScope: CaptureScope) {
    abortSpeechCapture();
    setScope(nextScope);
    setInterimText('');
    setSpeechMessage(null);
    setNotice(null);
  }

  function chooseMode(nextMode: CaptureMode) {
    abortSpeechCapture();
    setMode(nextMode);
    setError(null);
    setNotice(null);
    if (nextMode === 'AI' && session && scope) void loadEntitlement(session, scope.sourceId);
  }

  function toggleSpeechCapture() {
    if (speechState === 'LISTENING') {
      stopSpeechCapture();
      return;
    }
    startSpeechCapture();
  }

  function startSpeechCapture() {
    if (!scope) {
      setSpeechMessage('請先選擇要記錄到哪個空間。');
      return;
    }
    if (!speechSupported) {
      setSpeechState('ERROR');
      setSpeechMessage('這個瀏覽器目前不支援語音轉文字，仍可直接使用下方文字輸入。');
      return;
    }

    abortSpeechCapture();
    setSpeechMessage(null);
    setError(null);
    setInterimText('');

    const recognition = createBrowserSpeechRecognition({
      onTranscript: ({ finalText, interimText: interim }) => {
        if (finalText) {
          setDraft((current) => ({ ...current, rawText: appendSpeechText(current.rawText, finalText) }));
        }
        setInterimText(interim);
      },
      onError: (code) => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setSpeechState('ERROR');
        setInterimText('');
        setSpeechMessage(speechRecognitionErrorMessage(code));
      },
      onEnd: () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setSpeechState((current) => current === 'ERROR' ? current : 'IDLE');
        setInterimText('');
      },
    });

    if (!recognition) {
      setSpeechState('ERROR');
      setSpeechMessage('這個瀏覽器目前不支援語音轉文字，仍可直接使用文字輸入。');
      return;
    }

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setSpeechState('LISTENING');
    } catch {
      recognitionRef.current = null;
      setSpeechState('ERROR');
      setSpeechMessage('麥克風無法啟動，可以再試一次或直接使用文字輸入。');
    }
  }

  function stopSpeechCapture() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setSpeechState('IDLE');
      setInterimText('');
      return;
    }
    try {
      recognition.stop();
    } catch {
      recognitionRef.current = null;
      setSpeechState('IDLE');
      setInterimText('');
    }
  }

  function abortSpeechCapture() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.abort?.();
      } catch {
        // Ignore browser speech teardown errors.
      }
    }
    setSpeechState('IDLE');
    setInterimText('');
  }

  async function saveRecord() {
    if (!session || !scope || !draft.rawText.trim()) return;
    if (mode === 'MANUAL' && !optionalLocalDateValid(draft.occurredAt)) return;
    abortSpeechCapture();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'AI') {
        const result = await aiApi.captureText(session, scope.sourceId, draft.rawText.trim());
        setDraft({ ...EMPTY_DRAFT });
        setSpeechMessage(null);
        setNotice(`AI 已整理並記錄到「${scopeLabel(scope, surfaces)}」${result.record.title ? `：${result.record.title}` : '。'}`);
        await loadEntitlement(session, scope.sourceId);
      } else {
        await api.createRecord(session, scope, {
          title: draft.title.trim() || null,
          rawText: draft.rawText.trim(),
          occurredAt: localDateOrNull(draft.occurredAt),
        });
        setDraft({ ...EMPTY_DRAFT });
        setSpeechMessage(null);
        setNotice(`已記錄到「${scopeLabel(scope, surfaces)}」。`);
      }
    } catch (cause) {
      const text = message(cause, mode === 'AI' ? 'AI 紀錄失敗' : '新增紀錄失敗');
      setError(aiCaptureErrorMessage(text));
      if (mode === 'AI') await loadEntitlement(session, scope.sourceId);
    } finally {
      setSaving(false);
    }
  }

  function clearSession() {
    abortSpeechCapture();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVE_SCOPE_KEY);
    setSession(null);
    setSurfaces(null);
    setScope(null);
    setEntitlement(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  if (!session) {
    return <main className="shell capture-shell">
      <section className="panel capture-login-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>快速紀錄</h1>
        <p className="muted">登入後，從麥克風或文字直接留下工作紀錄。</p>
        {error ? <div className="error">{error}</div> : null}
        <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/capture" />
        <button className="ghost" onClick={() => { window.location.href = '/'; }}>回完整紀錄頁</button>
      </section>
    </main>;
  }

  const occurredAtValid = optionalLocalDateValid(draft.occurredAt);
  const selectedLabel = scope ? scopeLabel(scope, surfaces) : '尚未選擇';
  const aiAllowed = entitlement?.allowed === true && entitlement.source !== 'BLOCKED';
  const saveDisabled = saving
    || !scope
    || !draft.rawText.trim()
    || (mode === 'MANUAL' && !occurredAtValid)
    || (mode === 'AI' && (!aiAllowed || entitlementLoading));

  return <main className="shell capture-shell">
    <header className="capture-topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>快速紀錄</h1></div>
      <div className="filter-actions">
        <button className="ghost" onClick={() => { window.location.href = '/'; }}>全部紀錄</button>
        <button className="ghost" onClick={clearSession}>登出</button>
      </div>
    </header>

    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <section className="panel capture-card">
      <div className="capture-destination">
        <span>目前會記錄到</span>
        <strong>{selectedLabel}</strong>
      </div>

      <div className="capture-scope-row" aria-label="選擇紀錄空間">
        {surfaces?.personal ? <button className={scope?.type === 'PERSONAL' ? 'worklog-scope active' : 'worklog-scope'} onClick={() => chooseScope({ type: 'PERSONAL', sourceId: surfaces.personal!.sourceId })}>我的紀錄</button> : null}
        {surfaces?.groups.map((group) => <button key={group.sourceId} className={scope?.type === 'GROUP' && scope.sourceId === group.sourceId ? 'worklog-scope active' : 'worklog-scope'} onClick={() => chooseScope({ type: 'GROUP', sourceId: group.sourceId })}>{group.name}</button>)}
      </div>

      <div className="capture-mode-row" aria-label="選擇紀錄模式">
        <button className={mode === 'MANUAL' ? 'capture-mode active' : 'capture-mode'} onClick={() => chooseMode('MANUAL')}>
          <strong>一般紀錄</strong><span>免費・不呼叫 AI</span>
        </button>
        <button className={mode === 'AI' ? 'capture-mode active' : 'capture-mode'} onClick={() => chooseMode('AI')}>
          <strong>AI 整理紀錄</strong><span>使用 AI Pro 或試用額度</span>
        </button>
      </div>

      {mode === 'AI' ? <AiEntitlementCard entitlement={entitlement} loading={entitlementLoading} /> : null}

      <button
        className={`capture-mic${speechState === 'LISTENING' ? ' listening' : ''}`}
        disabled={loading || saving || !scope || (!speechSupported && speechState !== 'ERROR')}
        aria-pressed={speechState === 'LISTENING'}
        onClick={toggleSpeechCapture}
      >
        <span className="capture-mic-icon" aria-hidden="true">🎙️</span>
        <span>{speechState === 'LISTENING' ? '停止語音輸入' : '按一下開始說話'}</span>
      </button>

      <p className="capture-provider-note">
        {mode === 'MANUAL'
          ? '使用瀏覽器提供的語音轉文字；這條免費路徑不會呼叫 AFTERTRACE AI，也不會消耗 AI 額度。'
          : '麥克風仍只負責瀏覽器語音轉文字；按下「AI 整理並記錄」後，文字才會送到 AFTERTRACE AI。'}
      </p>
      {!speechSupported ? <p className="capture-warning">目前瀏覽器不支援這項語音功能，請直接使用文字輸入。</p> : null}
      {speechMessage ? <p className="capture-warning">{speechMessage}</p> : null}
      {interimText ? <div className="capture-interim"><span>辨識中</span><strong>{interimText}</strong></div> : null}

      {mode === 'MANUAL' ? <label className="capture-title-label">標題（選填）
        <input
          value={draft.title}
          maxLength={255}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="例如：客戶報價討論"
        />
      </label> : null}

      <label className="capture-text-label">紀錄內容
        <textarea
          rows={7}
          value={draft.rawText}
          onChange={(event) => setDraft({ ...draft, rawText: event.target.value })}
          placeholder={mode === 'AI' ? '例如：今天晴空案向王先生收了 3000 元清潔費' : '也可以直接打字；語音辨識完成的文字會出現在這裡。'}
        />
      </label>

      {mode === 'MANUAL' ? <>
        <label className="capture-time-label">發生時間（選填）
          <input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} />
        </label>
        <p className="muted">標題與發生時間都可以留空；未填標題時仍會以內容保存紀錄，時間軸則使用記錄建立時間。</p>
      </> : <p className="muted">AI 只會在文字有明確日期資訊時解析發生日期；不會自己捏造日期。AI 會為這筆新紀錄產生可搜尋的標題與關鍵詞。</p>}

      <div className="capture-actions">
        <button disabled={saveDisabled} onClick={() => void saveRecord()}>
          {saving ? '處理中…' : mode === 'AI' ? 'AI 整理並記錄' : '確認記錄'}
        </button>
        <button className="ghost" disabled={saving || (!draft.title && !draft.rawText && !draft.occurredAt)} onClick={() => {
          abortSpeechCapture();
          setDraft({ ...EMPTY_DRAFT });
          setSpeechMessage(null);
          setNotice(null);
        }}>清除</button>
      </div>

      {mode === 'AI' && entitlement && !aiAllowed ? <button className="ghost capture-upgrade" onClick={() => { window.location.href = '/subscription'; }}>查看 AI Pro</button> : null}
    </section>
  </main>;
}

function AiEntitlementCard({ entitlement, loading }: { entitlement: AiEntitlementDecision | null; loading: boolean }) {
  if (loading) return <div className="capture-ai-state"><strong>正在確認 AI 使用資格…</strong></div>;
  if (!entitlement) return <div className="capture-ai-state blocked"><strong>目前無法讀取 AI 使用狀態</strong><span>一般紀錄仍可正常使用。</span></div>;
  if (entitlement.allowed && entitlement.source === 'FREE_TRIAL') {
    return <div className="capture-ai-state"><strong>免費體驗 AI Pro</strong><span>目前尚有 {entitlement.remainingPoints?.toLocaleString() ?? '—'} AI 試用點數。</span></div>;
  }
  if (entitlement.allowed && entitlement.source === 'AI_PRO') {
    return <div className="capture-ai-state"><strong>AI Pro 可使用</strong><span>本期 AI 功能正常；仍受公平使用與每月方案資源上限限制。</span></div>;
  }
  return <div className="capture-ai-state blocked"><strong>AI 目前不可使用</strong><span>{entitlementReason(entitlement.reason)}</span></div>;
}

function entitlementReason(reason: string): string {
  switch (reason) {
    case 'TRIAL_EXHAUSTED': return '免費 AI 試用已用完；一般紀錄仍可免費使用。';
    case 'AI_NOT_ENTITLED': return '目前沒有可用的 AI 試用或 AI Pro。';
    case 'MONTHLY_POINT_CAP_REACHED':
    case 'MONTHLY_POINT_CAP_WOULD_BE_EXCEEDED': return '本期 AI 方案資源已達上限，下一個週期會恢復。';
    case 'MONTHLY_PROVIDER_COST_CAP_REACHED': return '本期 AI 使用已達方案安全上限，下一個週期會恢復。';
    case 'PROVIDER_COST_ACCOUNTING_INCOMPLETE': return 'AI 使用量正在核對中，暫時無法開始新的 AI 工作。';
    case 'PER_REQUEST_POINT_CAP_EXCEEDED': return '這次內容超過單次 AI 安全上限，請縮短後再試。';
    case 'SOURCE_NOT_AUTHORIZED': return '你目前沒有這個紀錄空間的使用權限。';
    default: return '目前無法使用 AI；一般紀錄仍可正常使用。';
  }
}

function aiCaptureErrorMessage(error: string): string {
  if (/^[A-Z0-9_]+$/.test(error)) return entitlementReason(error);
  return error;
}

function storedScope(): CaptureScope | null {
  const raw = localStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') return { type: 'PERSONAL', sourceId: value.sourceId };
    if (value.type === 'GROUP' && typeof value.sourceId === 'number') return { type: 'GROUP', sourceId: value.sourceId };
  } catch {
    // Ignore invalid local preference.
  }
  return null;
}

function defaultScope(surfaces: WorklogSurfaces): CaptureScope | null {
  if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId };
  const group = surfaces.groups[0];
  return group ? { type: 'GROUP', sourceId: group.sourceId } : null;
}

function scopeExists(scope: CaptureScope, surfaces: WorklogSurfaces): boolean {
  return scope.type === 'PERSONAL'
    ? surfaces.personal?.sourceId === scope.sourceId
    : surfaces.groups.some((group) => group.sourceId === scope.sourceId);
}

function scopeLabel(scope: CaptureScope, surfaces: WorklogSurfaces | null): string {
  if (scope.type === 'PERSONAL') return '我的紀錄';
  return surfaces?.groups.find((group) => group.sourceId === scope.sourceId)?.name ?? `群組 ${scope.sourceId}`;
}

function appendSpeechText(current: string, next: string): string {
  const base = current.trimEnd();
  const addition = next.trim();
  if (!base) return addition;
  if (!addition) return current;
  return `${base}${/[。！？!?]$/.test(base) ? ' ' : '，'}${addition}`;
}

function optionalLocalDateValid(value: string): boolean {
  return !value.trim() || !Number.isNaN(new Date(value).getTime());
}

function localDateOrNull(value: string): string | null {
  return value.trim() ? new Date(value).toISOString() : null;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
