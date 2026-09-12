import { useEffect, useMemo, useRef, useState } from 'react';
import { aiTaskDeepLinkUrl } from './ai-task-deep-link';
import { aiToolsDeepLinkUrl } from './ai-tools-deep-link';
import { LoginProviderButtons } from './LoginProviderButtons';
import {
  browserSpeechRecognitionSupported,
  createBrowserSpeechRecognition,
  speechRecognitionErrorMessage,
  type BrowserSpeechRecognition,
} from './speech-input';
import {
  WorklogApi,
  type RecordPage,
  type RecordScope,
  type WorklogRecord,
  type WorklogRecordRevision,
  type WorklogSurfaces,
} from './worklog-api';
import './record-home.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';
const PAGE_SIZES = [10, 20, 40, 80] as const;

type Scope =
  | { type: 'PERSONAL'; sourceId: number }
  | { type: 'GROUP'; sourceId: number };
type FilterDraft = { query: string; from: string; to: string };
type RecordDraft = { rawText: string; occurredAt: string };
type SpeechState = 'IDLE' | 'LISTENING' | 'ERROR';

const EMPTY_RECORD: RecordDraft = { rawText: '', occurredAt: '' };

export function RecordHomeRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const initialFilters = useMemo(() => defaultSevenDayFilters(), []);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechFinalRef = useRef('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const loadGeneration = useRef(0);
  const speechSupported = useMemo(() => browserSpeechRecognitionSupported(), []);

  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [records, setRecords] = useState<WorklogRecord[]>([]);
  const [recordPage, setRecordPage] = useState<RecordPage | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(initialFilters);
  const [filters, setFilters] = useState<FilterDraft>(initialFilters);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [createDraft, setCreateDraft] = useState<RecordDraft>({ ...EMPTY_RECORD });
  const [speechState, setSpeechState] = useState<SpeechState>('IDLE');
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorklogRecord | null>(null);
  const [editDraft, setEditDraft] = useState<RecordDraft | null>(null);
  const [historyRecord, setHistoryRecord] = useState<WorklogRecord | null>(null);
  const [revisions, setRevisions] = useState<WorklogRecordRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
    return () => abortSpeechCapture();
  }, []);

  useEffect(() => {
    if (!session || !scope) return;
    loadGeneration.current += 1;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    void loadRecords(session, scope, filters, showDeleted, pageIndex, pageSize);
  }, [session, scope?.type, scope?.sourceId, filters, showDeleted, pageIndex, pageSize]);

  async function bootstrap() {
    const token = localStorage.getItem(SESSION_KEY);
    setSession(token);
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const nextSurfaces = await api.surfaces(token);
      setSurfaces(nextSurfaces);
      const remembered = storedScope();
      setScope(remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces));
    } catch (cause) {
      setError(message(cause, '紀錄空間載入失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords(token: string, nextScope: Scope, nextFilters: FilterDraft, deleted: boolean, nextPage: number, nextSize: number) {
    const generation = loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const requestFilters = {
        query: nextFilters.query || undefined,
        from: nextFilters.from ? localDayBoundaryIso(nextFilters.from, 'start') : undefined,
        to: nextFilters.to ? localDayBoundaryIso(nextFilters.to, 'end') : undefined,
        limit: nextSize,
        offset: nextPage * nextSize,
      };
      const result = deleted
        ? await api.deletedRecords(token, recordScope(nextScope), requestFilters)
        : nextScope.type === 'PERSONAL'
          ? await api.personalRecords(token, requestFilters)
          : await api.groupRecords(token, nextScope.sourceId, requestFilters);
      if (generation !== loadGeneration.current) return;
      setRecords(result.records);
      setRecordPage(result.page);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setRecords([]);
      setRecordPage(null);
      setError(message(cause, '紀錄載入失敗'));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }

  async function createRecord() {
    if (!session || !scope || !createDraft.rawText.trim() || !optionalLocalDateValid(createDraft.occurredAt)) return;
    abortSpeechCapture();
    setLoading(true);
    setError(null);
    try {
      await api.createRecord(session, recordScope(scope), {
        rawText: createDraft.rawText.trim(),
        occurredAt: localDateOrNull(createDraft.occurredAt),
      });
      setCreateDraft({ ...EMPTY_RECORD });
      speechFinalRef.current = '';
      setSpeechMessage(null);
      setNotice('紀錄已儲存。');
      setPageIndex(0);
      loadGeneration.current += 1;
      await loadRecords(session, scope, filters, false, 0, pageSize);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } catch (cause) {
      setError(message(cause, '新增紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit() {
    if (!session || !editing || !editDraft || !editDraft.rawText.trim() || !optionalLocalDateValid(editDraft.occurredAt)) return;
    setLoading(true);
    setError(null);
    try {
      await api.updateRecord(session, editing.id, {
        expectedVersion: editing.version,
        rawText: editDraft.rawText.trim(),
        occurredAt: localDateOrNull(editDraft.occurredAt),
      });
      setEditing(null);
      setEditDraft(null);
      setNotice('紀錄已更新。');
      loadGeneration.current += 1;
      await loadRecords(session, scope!, filters, showDeleted, pageIndex, pageSize);
    } catch (cause) {
      setError(message(cause, '更新紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function deleteRecord(record: WorklogRecord) {
    if (!session || !scope || !window.confirm('將這筆紀錄移到回收桶？')) return;
    setLoading(true);
    try {
      await api.deleteRecord(session, record.id, record.version);
      setNotice('紀錄已移到回收桶。');
      loadGeneration.current += 1;
      await loadRecords(session, scope, filters, false, pageIndex, pageSize);
    } catch (cause) {
      setError(message(cause, '刪除紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function restoreRecord(record: WorklogRecord) {
    if (!session || !scope) return;
    setLoading(true);
    try {
      await api.restoreRecord(session, record.id, record.version);
      setNotice('紀錄已還原。');
      loadGeneration.current += 1;
      await loadRecords(session, scope, filters, true, pageIndex, pageSize);
    } catch (cause) {
      setError(message(cause, '還原紀錄失敗'));
    } finally {
      setLoading(false);
    }
  }

  async function openHistory(record: WorklogRecord) {
    if (!session) return;
    setLoading(true);
    try {
      setRevisions(await api.recordRevisions(session, record.id));
      setHistoryRecord(record);
    } catch (cause) {
      setError(message(cause, '編輯紀錄載入失敗'));
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
    setCreateDraft((current) => ({ ...current, rawText: '' }));
    setSpeechMessage(null);
    const recognition = createBrowserSpeechRecognition({
      onTranscript: ({ finalText, interimText }) => {
        if (finalText) speechFinalRef.current = [speechFinalRef.current, finalText].filter(Boolean).join(' ').trim();
        setCreateDraft((current) => ({ ...current, rawText: [speechFinalRef.current, interimText].filter(Boolean).join(' ').trim() }));
      },
      onError: (code) => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setSpeechState('ERROR');
        setSpeechMessage(speechRecognitionErrorMessage(code));
      },
      onEnd: () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setSpeechState((current) => current === 'ERROR' ? current : 'IDLE');
        setCreateDraft((current) => ({ ...current, rawText: speechFinalRef.current || current.rawText }));
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
    setCreateDraft({ ...EMPTY_RECORD });
    setSpeechMessage(null);
    composerRef.current?.focus();
  }

  function applyFilters() {
    setPageIndex(0);
    setFilters({ ...filterDraft });
  }

  function resetFilters() {
    const defaults = defaultSevenDayFilters();
    setFilterDraft(defaults);
    setFilters(defaults);
    setPageIndex(0);
  }

  function switchView(deleted: boolean) {
    setShowDeleted(deleted);
    setPageIndex(0);
  }

  if (!session) {
    return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>紀錄列表</h1><p className="muted">登入後即可開始記錄。</p><LoginProviderButtons apiBaseUrl={apiBaseUrl} /></section></main>;
  }

  const occurredAtValid = optionalLocalDateValid(createDraft.occurredAt);

  return <main className="shell record-home-shell">
    <div className="topbar record-home-title"><div><p className="eyebrow">AFTERTRACE</p><h1>紀錄列表</h1><p className="muted">預設顯示最近 7 天的紀錄。</p></div></div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <div className="record-home-subnav"><a className="active" href="/">紀錄</a><a href="/worklog">群組</a><a href="/feedback">回饋</a></div>

    <section className="record-home-grid">
      <section className="panel quick-record-v2">
        <div className="quick-record-v2-head"><h2>快速紀錄</h2><label>記錄到<select value={scopeKey(scope)} onChange={(event) => { const next = parseScopeKey(event.target.value); if (next) { abortSpeechCapture(); setScope(next); setPageIndex(0); } }}><option value="">請選擇</option>{surfaces?.personal ? <option value={`PERSONAL:${surfaces.personal.sourceId}`}>我的紀錄</option> : null}{surfaces?.groups.map((group) => <option key={group.sourceId} value={`GROUP:${group.sourceId}`}>{group.name}</option>)}</select></label></div>
        <label className="record-time-above">發生時間（選填）<input type="datetime-local" value={createDraft.occurredAt} onChange={(event) => setCreateDraft({ ...createDraft, occurredAt: event.target.value })} /></label>
        <textarea ref={composerRef} rows={9} value={createDraft.rawText} onChange={(event) => { abortSpeechCapture(); setCreateDraft({ ...createDraft, rawText: event.target.value }); }} placeholder="直接輸入工作紀錄，或按下語音輸入…" />
        {speechMessage ? <p className="capture-warning">{speechMessage}</p> : null}
        <div className="quick-record-v2-actions"><button className={`quick-voice-button${speechState === 'LISTENING' ? ' listening' : ''}`} disabled={loading || !scope} onClick={toggleSpeechCapture}>{speechState === 'LISTENING' ? '■ 停止語音' : '🎙 語音輸入'}</button><button disabled={loading || !scope || !createDraft.rawText.trim() || !occurredAtValid} onClick={() => void createRecord()}>儲存紀錄</button><button className="ghost" disabled={loading || (!createDraft.rawText && !createDraft.occurredAt)} onClick={clearComposer}>清除文字</button></div>
      </section>

      <section className="panel recent-records-panel">
        <div className="recent-records-head"><div className="record-view-switch"><button className={!showDeleted ? 'active' : ''} onClick={() => switchView(false)}>目前紀錄</button><button className={showDeleted ? 'active' : ''} onClick={() => switchView(true)}>回收桶</button></div><div className="page-size-select"><span>每頁</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]); setPageIndex(0); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select><span>筆</span></div></div>

        <div className="record-filter-grid-v2"><label>搜尋<input value={filterDraft.query} onChange={(event) => setFilterDraft({ ...filterDraft, query: event.target.value })} placeholder="搜尋紀錄內容" /></label><label>從<input type="date" value={filterDraft.from} onChange={(event) => setFilterDraft({ ...filterDraft, from: event.target.value })} /></label><label>到<input type="date" value={filterDraft.to} onChange={(event) => setFilterDraft({ ...filterDraft, to: event.target.value })} /></label></div>
        <div className="record-filter-actions-v2"><button onClick={applyFilters}>套用篩選</button><button className="ghost" onClick={resetFilters}>重設為最近 7 天</button></div>

        <div className="record-list-v2">
          {loading && records.length === 0 ? <div className="empty">載入中…</div> : null}
          {!loading && records.length === 0 ? <div className="empty"><strong>{showDeleted ? '回收桶是空的' : '最近 7 天沒有紀錄'}</strong></div> : null}
          {records.map((record) => <article className="record-card-v2" key={record.id}><div className="record-card-v2-meta"><time>{formatDateTime(record.occurredAt ?? record.createdAt)}</time>{record.version > 1 ? <span>已編輯</span> : null}</div><p>{record.rawText}</p><div className="record-card-v2-actions">{showDeleted ? <button onClick={() => void restoreRecord(record)}>還原</button> : <><button className="ghost" onClick={() => { setEditing(record); setEditDraft({ rawText: record.rawText, occurredAt: datetimeLocalValue(record.occurredAt) }); }}>編輯</button><button className="ghost" onClick={() => { window.location.href = aiToolsDeepLinkUrl({ sourceId: record.sourceId, recordId: record.id, tool: 'related' }); }}>找相關</button><button className="ghost" onClick={() => { window.location.href = aiToolsDeepLinkUrl({ sourceId: record.sourceId, recordId: record.id, tool: 'rewrite' }); }}>AI 改寫</button><button className="ghost" onClick={() => { window.location.href = aiTaskDeepLinkUrl({ sourceId: record.sourceId, recordId: record.id }); }}>AI 待辦</button><button className="ghost" onClick={() => void openHistory(record)}>編輯紀錄</button><button className="ghost danger-text" onClick={() => void deleteRecord(record)}>刪除</button></>}</div></article>)}
        </div>

        <div className="pagination-v2"><button className="ghost" disabled={loading || pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>上一頁</button><span>第 {pageIndex + 1} 頁</span><button className="ghost" disabled={loading || !recordPage?.hasMore} onClick={() => setPageIndex((value) => value + 1)}>下一頁</button></div>
      </section>
    </section>

    {editing && editDraft ? <div className="modal-backdrop"><section className="modal stack"><h2>編輯紀錄</h2><label>發生時間（選填）<input type="datetime-local" value={editDraft.occurredAt} onChange={(event) => setEditDraft({ ...editDraft, occurredAt: event.target.value })} /></label><label>紀錄內容<textarea rows={7} value={editDraft.rawText} onChange={(event) => setEditDraft({ ...editDraft, rawText: event.target.value })} /></label><div className="actions"><button disabled={loading || !editDraft.rawText.trim()} onClick={() => void saveEdit()}>儲存</button><button className="ghost" onClick={() => { setEditing(null); setEditDraft(null); }}>取消</button></div></section></div> : null}

    {historyRecord ? <div className="modal-backdrop"><section className="modal stack"><div className="section-head"><div><p className="eyebrow">HISTORY</p><h2>編輯紀錄</h2></div><button className="ghost" onClick={() => { setHistoryRecord(null); setRevisions([]); }}>關閉</button></div>{revisions.length === 0 ? <p className="muted">這筆紀錄尚無修改歷史。</p> : revisions.map((revision) => <article className="record-card-v2" key={revision.id}><div className="record-card-v2-meta"><span>版本 {revision.version}</span><time>{formatDateTime(revision.createdAt)}</time></div><p>{revision.previousRawText}</p><p>→ {revision.newRawText}</p></article>)}</section></div> : null}
  </main>;
}

function recordScope(value: Scope): RecordScope {
  return value.type === 'PERSONAL' ? { type: 'PERSONAL', sourceId: value.sourceId } : { type: 'GROUP', sourceId: value.sourceId };
}

function defaultSevenDayFilters(): FilterDraft {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 6);
  return { query: '', from: localDay(from), to: localDay(today) };
}

function localDay(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function localDayBoundaryIso(value: string, boundary: 'start' | 'end'): string {
  const date = new Date(`${value}T00:00:00`);
  if (boundary === 'end') date.setHours(23, 59, 59, 999);
  return date.toISOString();
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

function scopeKey(scope: Scope | null): string {
  return scope ? `${scope.type}:${scope.sourceId}` : '';
}

function parseScopeKey(value: string): Scope | null {
  const [type, rawId] = value.split(':');
  const sourceId = Number(rawId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  if (type === 'PERSONAL') return { type: 'PERSONAL', sourceId };
  if (type === 'GROUP') return { type: 'GROUP', sourceId };
  return null;
}

function optionalLocalDateValid(value: string): boolean {
  return !value.trim() || !Number.isNaN(new Date(value).getTime());
}

function localDateOrNull(value: string): string | null {
  return value.trim() ? new Date(value).toISOString() : null;
}

function datetimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW');
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
