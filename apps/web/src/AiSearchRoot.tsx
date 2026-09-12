import { useEffect, useMemo, useState } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type RecordPage, type WorklogInputType, type WorklogRecord, type WorklogSurfaces } from './worklog-api';
import './worklog.css';
import './search.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const PAGE_SIZES = [10, 20, 40, 80] as const;
const QUICK_SEARCHES = ['昨天做了什麼？', '這週有哪些工作紀錄？', '找出收款相關紀錄', '找出最近的維修紀錄'] as const;

type SearchTab = 'GENERAL' | 'AI';
type SearchRecord = { id: number; sourceId: number; inputType: WorklogInputType; title: string | null; rawText: string; occurredAt: string | null; createdAt: string };
type SearchResult = { entitlementSource: 'FREE_TRIAL' | 'AI_PRO'; interpretation: { terms: string[]; from: string | null; to: string | null }; records: SearchRecord[] };
type GeneralFilters = { query: string; from: string; to: string };

export function AiSearchRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const worklogApi = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const initialTab = useMemo<SearchTab>(() => new URL(location.href).searchParams.get('tab') === 'ai' ? 'AI' : 'GENERAL', []);
  const defaults = useMemo(() => defaultSevenDayFilters(), []);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [tab, setTab] = useState<SearchTab>(initialTab);
  const [generalDraft, setGeneralDraft] = useState<GeneralFilters>(defaults);
  const [generalFilters, setGeneralFilters] = useState<GeneralFilters>(defaults);
  const [generalRecords, setGeneralRecords] = useState<WorklogRecord[]>([]);
  const [generalPage, setGeneralPage] = useState<RecordPage | null>(null);
  const [generalPageIndex, setGeneralPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [showDeleted, setShowDeleted] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);
  useEffect(() => {
    if (!session || !sourceId || tab !== 'GENERAL') return;
    void loadGeneral(session, sourceId, generalFilters, generalPageIndex, pageSize, showDeleted);
  }, [session, sourceId, generalFilters, generalPageIndex, pageSize, showDeleted, tab]);

  async function bootstrap() {
    setBusy(true);
    setError(null);
    try {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      const url = new URL(location.href);
      const entry = url.searchParams.get('t')?.trim();
      if (entry) {
        const exchanged = await worklogApi.exchangeEntry(entry);
        token = exchanged.sessionToken;
        localStorage.setItem(SESSION_KEY, token);
        setSession(token);
        url.searchParams.delete('t');
        history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        localStorage.setItem(SESSION_KEY, callback);
        setSession(callback);
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      }
      if (!token) return;
      const next = await worklogApi.surfaces(token);
      setSurfaces(next);
      setSourceId(next.personal?.sourceId ?? next.groups[0]?.sourceId ?? null);
    } catch (cause) {
      if (sessionError(cause)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setSurfaces(null);
        setSourceId(null);
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else setError(message(cause, '搜尋載入失敗'));
    } finally {
      setBusy(false);
    }
  }

  async function loadGeneral(token: string, nextSourceId: number, filters: GeneralFilters, pageIndex: number, limit: number, deleted: boolean) {
    setBusy(true);
    setError(null);
    try {
      const scope = scopeForSource(nextSourceId, surfaces);
      if (!scope) return;
      const requestFilters = {
        query: filters.query || undefined,
        from: filters.from ? localDayBoundaryIso(filters.from, 'start') : undefined,
        to: filters.to ? localDayBoundaryIso(filters.to, 'end') : undefined,
        limit,
        offset: pageIndex * limit,
      };
      const response = deleted
        ? await worklogApi.deletedRecords(token, scope, requestFilters)
        : scope.type === 'PERSONAL'
          ? await worklogApi.personalRecords(token, requestFilters)
          : await worklogApi.groupRecords(token, scope.sourceId, requestFilters);
      setGeneralRecords(response.records);
      setGeneralPage(response.page);
    } catch (cause) {
      setGeneralRecords([]);
      setGeneralPage(null);
      setError(message(cause, '一般搜尋失敗'));
    } finally {
      setBusy(false);
    }
  }

  async function searchAi() {
    if (!session || !sourceId || !query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/ai/capture/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, query: query.trim(), timeZone: browserTimeZone(), limit: 20 }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw apiError(response, body);
      setResult(searchResult(body));
    } catch (cause) {
      if (sessionError(cause)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setSurfaces(null);
        setSourceId(null);
        setError('登入已過期，請重新登入 AFTERTRACE。');
      } else setError(searchErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function selectTab(next: SearchTab) {
    setTab(next);
    setError(null);
    const url = new URL(location.href);
    url.searchParams.set('tab', next === 'AI' ? 'ai' : 'general');
    history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  }

  function applyGeneral() {
    setGeneralPageIndex(0);
    setGeneralFilters({ ...generalDraft });
  }

  function resetGeneral() {
    const next = defaultSevenDayFilters();
    setGeneralDraft(next);
    setGeneralFilters(next);
    setGeneralPageIndex(0);
  }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card"><p className="eyebrow">AFTERTRACE</p><h1>搜尋</h1><p className="muted">一般搜尋可以用關鍵字與日期快速找紀錄；需要理解一句話時再使用 AI 搜尋。</p>{error ? <div className="error">{error}</div> : null}<LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/ai-search" /></section></main>;

  const searchDescription = tab === 'GENERAL'
    ? '用關鍵字、日期與搜尋範圍，快速找到你曾經記下的工作紀錄。'
    : '直接用一句話描述你想找的事情，AI 會理解你的需求並從紀錄中找出相關內容。';

  return <main className="shell worklog-shell ai-search-shell search-hub-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>搜尋</h1><p className="muted">{searchDescription}</p></div></div>
    {error ? <div className="error">{error}</div> : null}

    <nav className="search-mode-tabs" aria-label="搜尋模式">
      <button className={tab === 'GENERAL' ? 'active' : ''} onClick={() => selectTab('GENERAL')}>一般搜尋</button>
      <button className={tab === 'AI' ? 'active' : ''} onClick={() => selectTab('AI')}>AI 搜尋</button>
    </nav>

    {tab === 'GENERAL' ? <section className="panel search-general-panel">
      <div className="search-general-head"><div className="record-view-switch"><button className={!showDeleted ? 'active' : ''} onClick={() => { setShowDeleted(false); setGeneralPageIndex(0); }}>目前紀錄</button><button className={showDeleted ? 'active' : ''} onClick={() => { setShowDeleted(true); setGeneralPageIndex(0); }}>回收桶</button></div><div className="page-size-select"><span>每頁</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]); setGeneralPageIndex(0); }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select><span>筆</span></div></div>
      <div className="general-search-fields"><label>搜尋範圍<select value={sourceId ?? ''} disabled={busy || !surfaces} onChange={(event) => { setSourceId(Number(event.target.value) || null); setGeneralPageIndex(0); }}>{surfaces?.personal ? <option value={surfaces.personal.sourceId}>我的紀錄</option> : null}{surfaces?.groups.map((group) => <option key={group.sourceId} value={group.sourceId}>{group.name}</option>)}</select></label><label>關鍵字<input value={generalDraft.query} onChange={(event) => setGeneralDraft({ ...generalDraft, query: event.target.value })} placeholder="搜尋紀錄內容" /></label><label>從<input type="date" value={generalDraft.from} onChange={(event) => setGeneralDraft({ ...generalDraft, from: event.target.value })} /></label><label>到<input type="date" value={generalDraft.to} onChange={(event) => setGeneralDraft({ ...generalDraft, to: event.target.value })} /></label></div>
      <div className="record-filter-actions-v2"><button disabled={busy || !sourceId} onClick={applyGeneral}>搜尋</button><button className="ghost" disabled={busy} onClick={resetGeneral}>重設為最近 7 天</button></div>
      <div className="search-result-list">{busy && generalRecords.length === 0 ? <div className="empty">載入中…</div> : null}{!busy && generalRecords.length === 0 ? <div className="empty"><strong>{showDeleted ? '回收桶是空的' : '找不到符合條件的紀錄'}</strong></div> : null}{generalRecords.map((record) => <article className="worklog-record-card" key={record.id}><div className="worklog-record-meta"><time>{record.occurredAt ? '發生時間' : '建立時間'}：{formatDateTime(record.occurredAt ?? record.createdAt)}</time>{record.version > 1 ? <span>已編輯</span> : null}</div><strong>{record.rawText}</strong></article>)}</div>
      <div className="pagination-v2"><button className="ghost" disabled={busy || generalPageIndex === 0} onClick={() => setGeneralPageIndex((value) => Math.max(0, value - 1))}>上一頁</button><span>第 {generalPageIndex + 1} 頁</span><button className="ghost" disabled={busy || !generalPage?.hasMore} onClick={() => setGeneralPageIndex((value) => value + 1)}>下一頁</button></div>
    </section> : null}

    {tab === 'AI' ? <>
      <section className="panel stack ai-search-panel"><label className="ai-search-field"><span>要搜尋哪裡？</span><select value={sourceId ?? ''} disabled={busy || !surfaces} onChange={(event) => { setSourceId(Number(event.target.value) || null); setResult(null); }}>{surfaces?.personal ? <option value={surfaces.personal.sourceId}>我的紀錄</option> : null}{surfaces?.groups.map((group) => <option key={group.sourceId} value={group.sourceId}>{group.name}</option>)}</select></label><label className="ai-search-field"><span>想找什麼？</span><textarea rows={3} maxLength={1000} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：昨天晴空案收款的紀錄" /></label><div className="quick-searches"><strong>不知道怎麼問？試試：</strong><div>{QUICK_SEARCHES.map((example) => <button key={example} type="button" className="quick-search-chip" disabled={busy} onClick={() => { setQuery(example); setResult(null); }}>{example}</button>)}</div></div><p className="muted">AI 搜尋會使用 AI Pro 或尚未用完的 AI 體驗額度；一般搜尋不會消耗 AI 額度。</p><div className="filter-actions"><button disabled={busy || !sourceId || !query.trim()} onClick={() => void searchAi()}>{busy ? '搜尋中…' : '開始搜尋'}</button><button className="ghost" disabled={busy} onClick={() => { setQuery(''); setResult(null); setError(null); }}>清除</button></div></section>
      {result ? <section className="panel stack ai-search-results"><div className="topbar compact-topbar"><div><p className="eyebrow">搜尋結果</p><h2>{result.records.length} 筆紀錄</h2></div></div><SearchInterpretation result={result} />{result.records.length === 0 ? <div className="empty">沒有找到符合條件的紀錄，可以換個說法或切回一般搜尋。</div> : <div className="worklog-record-list">{result.records.map((record) => <SearchRecordCard key={record.id} record={record} />)}</div>}</section> : null}
    </> : null}
  </main>;
}

function scopeForSource(sourceId: number, surfaces: WorklogSurfaces | null) {
  if (surfaces?.personal?.sourceId === sourceId) return { type: 'PERSONAL' as const, sourceId };
  return surfaces?.groups.some((group) => group.sourceId === sourceId) ? { type: 'GROUP' as const, sourceId } : null;
}
function defaultSevenDayFilters(): GeneralFilters {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 6);
  return { query: '', from: localDay(from), to: localDay(today) };
}
function localDay(date: Date): string { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 10); }
function localDayBoundaryIso(value: string, boundary: 'start' | 'end'): string { const date = new Date(`${value}T00:00:00`); if (boundary === 'end') date.setHours(23, 59, 59, 999); return date.toISOString(); }
function SearchInterpretation({ result }: { result: SearchResult }) { const { terms, from, to } = result.interpretation; return <div className="worklog-record-meta">{terms.length ? <span>關鍵字：{terms.join('、')}</span> : null}{from ? <span>從：{formatDateTime(from)}</span> : null}{to ? <span>到：{formatDateTime(to)}</span> : null}</div>; }
function SearchRecordCard({ record }: { record: SearchRecord }) { const date = record.occurredAt ?? record.createdAt; return <article className="worklog-record-card"><div className="worklog-record-meta"><span>{inputLabel(record.inputType)}</span>{record.title ? <span>{record.title}</span> : null}<time>{record.occurredAt ? '發生時間' : '建立時間'}：{formatDateTime(date)}</time></div><strong>{record.rawText}</strong></article>; }
function searchResult(body: Record<string, unknown>): SearchResult { const interpretationRaw = plainObject(body.interpretation); const recordsRaw = Array.isArray(body.records) ? body.records : []; return { entitlementSource: body.entitlementSource === 'FREE_TRIAL' ? 'FREE_TRIAL' : 'AI_PRO', interpretation: { terms: Array.isArray(interpretationRaw.terms) ? interpretationRaw.terms.filter((value): value is string => typeof value === 'string').slice(0, 8) : [], from: nullableString(interpretationRaw.from), to: nullableString(interpretationRaw.to) }, records: recordsRaw.map((value) => { const record = plainObject(value); return { id: Number(record.id), sourceId: Number(record.sourceId ?? record.source_id), inputType: inputType(record.inputType ?? record.input_type), title: nullableString(record.title), rawText: String(record.rawText ?? record.raw_text ?? ''), occurredAt: nullableString(record.occurredAt ?? record.occurred_at), createdAt: String(record.createdAt ?? record.created_at ?? '') }; }).filter((record) => Number.isSafeInteger(record.id) && record.id > 0 && record.rawText.trim()) }; }
function inputType(value: unknown): WorklogInputType { return value === 'AUDIO' || value === 'IMAGE' || value === 'FILE' ? value : 'TEXT'; }
function inputLabel(value: WorklogInputType) { return value === 'AUDIO' ? '語音' : value === 'IMAGE' ? '圖片' : value === 'FILE' ? '檔案' : '文字'; }
function browserTimeZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'; } catch { return 'Asia/Taipei'; } }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }); }
function searchErrorMessage(cause: unknown) { const code = cause instanceof Error ? cause.message : String(cause ?? ''); if (/TRIAL_EXHAUSTED|AI_NOT_ENTITLED/.test(code)) return 'AI 體驗額度已用完，或目前沒有 AI Pro。一般搜尋仍可免費使用。'; if (/MONTHLY_POINT_CAP|MONTHLY_PROVIDER_COST_CAP/.test(code)) return '本期 AI 使用已達方案上限；一般搜尋仍可正常使用。'; return message(cause, 'AI 搜尋失敗'); }
function sessionError(cause: unknown) { const text = cause instanceof Error ? cause.message : String(cause ?? ''); return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text); }
async function responseBody(response: Response): Promise<Record<string, unknown>> { const text = await response.text(); if (!text) return {}; try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`AI_SEARCH_INVALID_RESPONSE_${response.status}`); } }
function apiError(response: Response, body: Record<string, unknown>) { return new Error(typeof body.error === 'string' && body.error ? body.error : `AI_SEARCH_FAILED_${response.status}`); }
function plainObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nullableString(value: unknown) { return value === null || value === undefined || value === '' ? null : String(value); }
function message(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }
