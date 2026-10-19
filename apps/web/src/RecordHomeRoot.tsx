import { useEffect, useMemo, useRef, useState } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import {
  browserSpeechRecognitionSupported,
  createBrowserSpeechRecognition,
  speechRecognitionErrorMessage,
  type BrowserSpeechRecognition,
} from './speech-input';
import { WorklogApi, type RecordScope, type WorklogRecord, type WorklogSurfaces } from './worklog-api';
import './record-home.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';

type Scope = { type: 'PERSONAL'; sourceId: number } | { type: 'GROUP'; sourceId: number };
type RecordDraft = { title: string; rawText: string; occurredAt: string };
type SpeechState = 'IDLE' | 'LISTENING' | 'ERROR';
const EMPTY_RECORD: RecordDraft = { title: '', rawText: '', occurredAt: '' };

export function RecordHomeRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechFinalRef = useRef('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const speechSupported = useMemo(() => browserSpeechRecognitionSupported(), []);

  const [session] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [recentRecords, setRecentRecords] = useState<WorklogRecord[]>([]);
  const [draft, setDraft] = useState<RecordDraft>({ ...EMPTY_RECORD });
  const [editing, setEditing] = useState<WorklogRecord | null>(null);
  const [editDraft, setEditDraft] = useState<RecordDraft | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>('IDLE');
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    void bootstrap(session);
    return () => abortSpeechCapture();
  }, [session]);

  useEffect(() => {
    if (!session || !scope) return;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    void loadRecent(session, scope);
  }, [session, scope?.type, scope?.sourceId]);

  async function bootstrap(token: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await api.surfaces(token);
      setSurfaces(next);
      const remembered = storedScope();
      setScope(remembered && scopeExists(remembered, next) ? remembered : defaultScope(next));
    } catch (cause) {
      setError(message(cause, '紀錄空間載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function loadRecent(token: string, nextScope: Scope) {
    try {
      const filters = { limit: 10, offset: 0 };
      const result = nextScope.type === 'PERSONAL'
        ? await api.personalRecords(token, filters)
        : await api.groupRecords(token, nextScope.sourceId, filters);
      setRecentRecords(result.records);
    } catch {
      setRecentRecords([]);
    }
  }

  async function createRecord() {
    if (!session || !scope || !draft.rawText.trim() || !optionalLocalDateValid(draft.occurredAt)) return;
    abortSpeechCapture();
    setLoading(true);
    setError(null);
    try {
      await api.createRecord(session, recordScope(scope), {
        title: draft.title.trim() || null,
        rawText: draft.rawText.trim(),
        occurredAt: localDateOrNull(draft.occurredAt),
      });
      setDraft({ ...EMPTY_RECORD });
      speechFinalRef.current = '';
      setSpeechMessage(null);
      setNotice('紀錄已儲存。');
      await loadRecent(session, scope);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } catch (cause) {
      setError(message(cause, '新增紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  function startEdit(record: WorklogRecord) {
    setEditing(record);
    setEditDraft({
      title: record.title ?? '',
      rawText: record.rawText,
      occurredAt: datetimeLocalValue(record.occurredAt),
    });
    setError(null);
    setNotice(null);
  }

  async function saveEdit() {
    if (!session || !scope || !editing || !editDraft?.rawText.trim() || !optionalLocalDateValid(editDraft.occurredAt)) return;
    setLoading(true);
    setError(null);
    try {
      await api.updateRecord(session, editing.id, {
        expectedVersion: editing.version,
        title: editDraft.title.trim() || null,
        rawText: editDraft.rawText.trim(),
        occurredAt: localDateOrNull(editDraft.occurredAt),
      } as Parameters<WorklogApi['updateRecord']>[2]);
      setEditing(null);
      setEditDraft(null);
      setNotice('紀錄已更新。');
      await loadRecent(session, scope);
    } catch (cause) {
      setError(message(cause, '更新紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function deleteRecord(record: WorklogRecord) {
    if (!session || !scope || loading) return;
    if (!window.confirm(`確定要刪除「${record.title || previewTitle(record.rawText)}」？之後仍可在搜尋頁的回收桶還原。`)) return;
    setLoading(true);
    setError(null);
    try {
      await api.deleteRecord(session, record.id, record.version);
      if (editing?.id === record.id) { setEditing(null); setEditDraft(null); }
      setNotice('紀錄已移到回收桶。');
      await loadRecent(session, scope);
    } catch (cause) {
      setError(message(cause, '刪除紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  function startSpeechCapture() {
    if (!scope) return;
    if (!speechSupported) {
      setSpeechState('ERROR');
      setSpeechMessage('這個瀏覽器目前不支援語音轉文字，請直接使用文字輸入。');
      return;
    }
    abortSpeechCapture();
    speechFinalRef.current = '';
    setDraft((current) => ({ ...current, rawText: '' }));
    setSpeechMessage(null);
    const recognition = createBrowserSpeechRecognition({
      onTranscript: ({ finalText, interimText }) => {
        if (finalText) speechFinalRef.current = [speechFinalRef.current, finalText].filter(Boolean).join(' ').trim();
        setDraft((current) => ({ ...current, rawText: [speechFinalRef.current, interimText].filter(Boolean).join(' ').trim() }));
      },
      onError: (code) => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setSpeechState('ERROR');
        setSpeechMessage(speechRecognitionErrorMessage(code));
      },
      onEnd: () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setSpeechState((current) => current === 'ERROR' ? current : 'IDLE');
        setDraft((current) => ({ ...current, rawText: speechFinalRef.current || current.rawText }));
      },
    });
    if (!recognition) return;
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setSpeechState('LISTENING');
    } catch {
      recognitionRef.current = null;
      setSpeechState('ERROR');
      setSpeechMessage('麥克風無法啟動，可以再試一次。');
    }
  }

  function abortSpeechCapture() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try { recognition.abort?.(); } catch { /* noop */ }
    }
    setSpeechState('IDLE');
  }

  function toggleSpeechCapture() {
    if (speechState === 'LISTENING') {
      try { recognitionRef.current?.stop(); } catch { abortSpeechCapture(); }
      return;
    }
    startSpeechCapture();
  }

  function clearComposer() {
    abortSpeechCapture();
    speechFinalRef.current = '';
    setDraft({ ...EMPTY_RECORD });
    setSpeechMessage(null);
    composerRef.current?.focus();
  }

  if (!session) {
    return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>紀錄</h1><p className="muted">登入後即可開始記錄。</p><LoginProviderButtons apiBaseUrl={apiBaseUrl} /></section></main>;
  }

  const occurredAtValid = optionalLocalDateValid(draft.occurredAt);
  return <main className="shell record-home-shell record-capture-only">
    <div className="topbar record-home-title"><div><p className="eyebrow">AFTERTRACE</p><h1>紀錄</h1><p className="muted">想到就記，需要時再搜尋與整理。</p></div></div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <div className="record-home-subnav"><a className="active" href="/">紀錄</a><a href="/worklog">群組</a></div>

    <section className="record-capture-layout">
      <section className="panel quick-record-v2">
        <div className="quick-record-v2-head"><h2>快速紀錄</h2><label>記錄到<select value={scopeKey(scope)} disabled={!scope} onChange={(event) => { const next = parseScopeKey(event.target.value); if (next) { abortSpeechCapture(); setScope(next); } }}>{!scope ? <option value="">載入紀錄空間…</option> : null}{surfaces?.personal ? <option value={`PERSONAL:${surfaces.personal.sourceId}`}>我的紀錄</option> : null}{surfaces?.groups.map((group) => <option key={group.sourceId} value={`GROUP:${group.sourceId}`}>{group.name}</option>)}</select></label></div>
        <label className="record-title-field">標題（選填）<input maxLength={255} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：客戶報價討論" /></label>
        <label className="record-time-above">發生時間（選填）<input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label>
        <label className="record-content-field">內容<textarea ref={composerRef} rows={9} value={draft.rawText} onChange={(event) => { abortSpeechCapture(); setDraft({ ...draft, rawText: event.target.value }); }} placeholder="直接輸入工作紀錄，或按下語音輸入…" /></label>
        {speechMessage ? <p className="capture-warning">{speechMessage}</p> : null}
        <div className="quick-record-v2-actions"><button className={`quick-voice-button${speechState === 'LISTENING' ? ' listening' : ''}`} disabled={loading || !scope} onClick={toggleSpeechCapture}>{speechState === 'LISTENING' ? '■ 停止語音' : '🎙 語音輸入'}</button><button disabled={loading || !scope || !draft.rawText.trim() || !occurredAtValid} onClick={() => void createRecord()}>儲存紀錄</button><button className="ghost" disabled={loading || (!draft.title && !draft.rawText && !draft.occurredAt)} onClick={clearComposer}>清除</button></div>
      </section>

      <aside className="panel recent-record-preview">
        <div className="section-head"><div><p className="eyebrow">最近紀錄</p><h2>最近 10 筆</h2></div><a className="text-link" href="/ai-search?tab=general">搜尋全部</a></div>
        {loading && recentRecords.length === 0 ? <div className="empty">載入中…</div> : null}
        {!loading && recentRecords.length === 0 ? <div className="empty">目前還沒有紀錄。</div> : null}
        <div className="recent-record-preview-list">{recentRecords.map((record) => <article key={record.id}>
          <div className="recent-record-head"><div><strong>{record.title || previewTitle(record.rawText)}</strong><time>{formatDateTime(record.occurredAt ?? record.createdAt)}</time></div><div className="recent-record-actions"><button className="ghost compact" disabled={loading} onClick={() => startEdit(record)}>編輯</button><button className="ghost compact danger" disabled={loading} onClick={() => void deleteRecord(record)}>刪除</button></div></div>
          <p>{record.rawText}</p>
        </article>)}</div>
      </aside>
    </section>

    {editing && editDraft ? <div className="record-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) { setEditing(null); setEditDraft(null); } }}><section className="panel record-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="record-edit-title">
      <div className="section-head"><h2 id="record-edit-title">編輯紀錄</h2><button className="ghost compact" disabled={loading} onClick={() => { setEditing(null); setEditDraft(null); }}>關閉</button></div>
      <label>標題（選填）<input maxLength={255} value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></label>
      <label>發生時間（選填）<input type="datetime-local" value={editDraft.occurredAt} onChange={(event) => setEditDraft({ ...editDraft, occurredAt: event.target.value })} /></label>
      <label>內容<textarea rows={8} value={editDraft.rawText} onChange={(event) => setEditDraft({ ...editDraft, rawText: event.target.value })} /></label>
      <div className="filter-actions"><button disabled={loading || !editDraft.rawText.trim()} onClick={() => void saveEdit()}>{loading ? '儲存中…' : '儲存修改'}</button><button className="ghost" disabled={loading} onClick={() => { setEditing(null); setEditDraft(null); }}>取消</button></div>
    </section></div> : null}
  </main>;
}

function recordScope(value: Scope): RecordScope {
  return value.type === 'PERSONAL' ? { type: 'PERSONAL', sourceId: value.sourceId } : { type: 'GROUP', sourceId: value.sourceId };
}
function storedScope(): Scope | null {
  const raw = localStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') return { type: 'PERSONAL', sourceId: value.sourceId };
    if (value.type === 'GROUP' && typeof value.sourceId === 'number') return { type: 'GROUP', sourceId: value.sourceId };
  } catch { /* noop */ }
  return null;
}
function defaultScope(surfaces: WorklogSurfaces): Scope | null {
  if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId };
  const group = surfaces.groups[0];
  return group ? { type: 'GROUP', sourceId: group.sourceId } : null;
}
function scopeExists(scope: Scope, surfaces: WorklogSurfaces): boolean {
  return scope.type === 'PERSONAL' ? surfaces.personal?.sourceId === scope.sourceId : surfaces.groups.some((group) => group.sourceId === scope.sourceId);
}
function scopeKey(scope: Scope | null): string { return scope ? `${scope.type}:${scope.sourceId}` : ''; }
function parseScopeKey(value: string): Scope | null {
  const [type, rawId] = value.split(':');
  const sourceId = Number(rawId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  if (type === 'PERSONAL') return { type: 'PERSONAL', sourceId };
  if (type === 'GROUP') return { type: 'GROUP', sourceId };
  return null;
}
function optionalLocalDateValid(value: string): boolean { return !value.trim() || !Number.isNaN(new Date(value).getTime()); }
function localDateOrNull(value: string): string | null { return value.trim() ? new Date(value).toISOString() : null; }
function datetimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function previewTitle(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized || '未命名紀錄';
}
function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW');
}
function message(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }
