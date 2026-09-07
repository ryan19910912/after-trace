import { useEffect, useMemo, useRef, useState } from 'react';
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
const RETURN_KEY = 'aftertrace.worklog.returnTo';

type Props = { apiBaseUrl: string };
type CaptureScope = RecordScope;
type CaptureDraft = { rawText: string; occurredAt: string };
type SpeechState = 'IDLE' | 'LISTENING' | 'ERROR';

const EMPTY_DRAFT: CaptureDraft = { rawText: '', occurredAt: '' };

export function CaptureRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechSupported = useMemo(() => browserSpeechRecognitionSupported(), []);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<CaptureScope | null>(() => storedScope());
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
  }, [scope?.type, scope?.sourceId]);

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
      setScope(remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces));
    } catch (cause) {
      setError(message(cause, '快速紀錄載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  function chooseScope(nextScope: CaptureScope) {
    abortSpeechCapture();
    setScope(nextScope);
    setInterimText('');
    setSpeechMessage(null);
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
      setSpeechMessage('這個瀏覽器目前不支援語音轉文字，仍可直接使用下方文字輸入。');
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
    if (!session || !scope || !draft.rawText.trim() || !optionalLocalDateValid(draft.occurredAt)) return;
    abortSpeechCapture();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.createRecord(session, scope, {
        rawText: draft.rawText.trim(),
        occurredAt: localDateOrNull(draft.occurredAt),
      });
      setDraft({ ...EMPTY_DRAFT });
      setSpeechMessage(null);
      setNotice(`已記錄到「${scopeLabel(scope, surfaces)}」。`);
    } catch (cause) {
      setError(message(cause, '新增紀錄失敗'));
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
    setDraft({ ...EMPTY_DRAFT });
  }

  if (!session) {
    return <main className="shell capture-shell">
      <section className="panel capture-login-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>快速紀錄</h1>
        <p className="muted">登入後，從麥克風或文字直接留下工作紀錄。</p>
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => {
          localStorage.setItem(RETURN_KEY, '/capture');
          window.location.href = api.lineLoginUrl();
        }}>登入 AFTERTRACE</button>
        <button className="ghost" onClick={() => { window.location.href = '/'; }}>回完整紀錄頁</button>
      </section>
    </main>;
  }

  const occurredAtValid = optionalLocalDateValid(draft.occurredAt);
  const selectedLabel = scope ? scopeLabel(scope, surfaces) : '尚未選擇';

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

      <button
        className={`capture-mic${speechState === 'LISTENING' ? ' listening' : ''}`}
        disabled={loading || saving || !scope || (!speechSupported && speechState !== 'ERROR')}
        aria-pressed={speechState === 'LISTENING'}
        onClick={toggleSpeechCapture}
      >
        <span className="capture-mic-icon" aria-hidden="true">🎙️</span>
        <span>{speechState === 'LISTENING' ? '停止語音輸入' : '按一下開始說話'}</span>
      </button>

      <p className="capture-provider-note">使用瀏覽器提供的語音轉文字；這條免費路徑不會呼叫 AFTERTRACE AI，也不會消耗 AI 額度。</p>
      {!speechSupported ? <p className="capture-warning">目前瀏覽器不支援這項語音功能，請直接使用文字輸入。</p> : null}
      {speechMessage ? <p className="capture-warning">{speechMessage}</p> : null}
      {interimText ? <div className="capture-interim"><span>辨識中</span><strong>{interimText}</strong></div> : null}

      <label className="capture-text-label">紀錄內容
        <textarea
          rows={7}
          value={draft.rawText}
          onChange={(event) => setDraft({ ...draft, rawText: event.target.value })}
          placeholder="也可以直接打字；語音辨識完成的文字會出現在這裡。"
        />
      </label>

      <label className="capture-time-label">發生時間（選填）
        <input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} />
      </label>
      <p className="muted">沒有填發生時間也可以儲存；之後時間軸會使用記錄建立時間顯示。</p>

      <div className="capture-actions">
        <button disabled={saving || !scope || !draft.rawText.trim() || !occurredAtValid} onClick={() => void saveRecord()}>{saving ? '儲存中…' : '確認記錄'}</button>
        <button className="ghost" disabled={saving || (!draft.rawText && !draft.occurredAt)} onClick={() => {
          abortSpeechCapture();
          setDraft({ ...EMPTY_DRAFT });
          setSpeechMessage(null);
          setNotice(null);
        }}>清除</button>
      </div>
    </section>
  </main>;
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
