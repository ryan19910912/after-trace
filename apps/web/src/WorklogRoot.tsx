import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WorklogApi,
  type RecordFilters,
  type RecordPage,
  type UserUsage,
  type WorklogInputType,
  type WorklogRecord,
  type WorklogSurfaces,
} from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';

type Props = { apiBaseUrl: string };
type Scope =
  | { type: 'PERSONAL'; sourceId: number }
  | { type: 'GROUP'; sourceId: number; lineGroupId: string };
type Page = 'RECORDS' | 'FEEDBACK';
type FilterDraft = { query: string; from: string; to: string };

const EMPTY_FILTER: FilterDraft = { query: '', from: '', to: '' };

export function WorklogRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const started = useRef(false);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [records, setRecords] = useState<WorklogRecord[]>([]);
  const [recordPage, setRecordPage] = useState<RecordPage | null>(null);
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [page, setPage] = useState<Page>('RECORDS');
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(EMPTY_FILTER);
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void bootstrap();
    }
  }, []);

  useEffect(() => {
    if (!session || !scope) return;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    void loadScope(session, scope, filters, false);
  }, [session, scope?.type, scope?.sourceId, filters]);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      let token = callback || localStorage.getItem(SESSION_KEY);
      const url = new URL(window.location.href);
      const entry = url.searchParams.get('t')?.trim();

      if (entry) {
        const exchanged = await api.exchangeEntry(entry);
        token = exchanged.sessionToken;
        persistSession(token);
        setSession(token);
        url.searchParams.delete('t');
        url.searchParams.delete('openExternalBrowser');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callback) {
        persistSession(callback);
        setSession(callback);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }

      if (!token) return;
      const [nextSurfaces, nextUsage] = await Promise.all([
        api.surfaces(token),
        api.myUsage(token),
      ]);
      setSurfaces(nextSurfaces);
      setUsage(nextUsage);
      const remembered = storedScope();
      setScope(remembered && scopeExists(remembered, nextSurfaces) ? remembered : defaultScope(nextSurfaces));
    } catch (cause) {
      const text = message(cause, '載入失敗');
      if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text)) clearSession();
      setError(text);
    } finally {
      setLoading(false);
    }
  }

  async function loadScope(
    token: string,
    nextScope: Scope,
    nextFilters: FilterDraft,
    append: boolean,
  ) {
    setLoading(true);
    setError(null);
    try {
      const requestFilters = apiFilters(nextFilters, append ? recordPage?.nextOffset ?? 0 : 0);
      const result = nextScope.type === 'PERSONAL'
        ? await api.personalRecords(token, requestFilters)
        : await api.groupRecords(token, nextScope.sourceId, requestFilters);
      setRecords((current) => append ? dedupeRecords([...current, ...result.records]) : result.records);
      setRecordPage(result.page);
    } catch (cause) {
      setError(message(cause, '紀錄載入失敗'));
      if (!append) setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVE_SCOPE_KEY);
    setSession(null);
    setSurfaces(null);
    setScope(null);
    setRecords([]);
    setUsage(null);
  }

  function applyFilters() {
    setFilters({ ...filterDraft });
    setRecordPage(null);
  }

  function clearFilters() {
    setFilterDraft(EMPTY_FILTER);
    setFilters(EMPTY_FILTER);
    setRecordPage(null);
  }

  if (!session) {
    return <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE</p>
        <h1>工作紀錄中心</h1>
        <p className="muted">使用 LINE 登入，查看與管理你的工作紀錄。</p>
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => { window.location.href = api.lineLoginUrl(); }}>使用 LINE 登入</button>
      </section>
    </main>;
  }

  return <main className="shell worklog-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE</p>
        <h1>工作紀錄</h1>
      </div>
      <button className="ghost" onClick={clearSession}>登出</button>
    </div>

    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}
    {usage ? <UsageBar usage={usage} /> : null}

    <nav className="worklog-main-tabs">
      <button className={page === 'RECORDS' ? 'active' : ''} onClick={() => setPage('RECORDS')}>紀錄</button>
      <button className={page === 'FEEDBACK' ? 'active' : ''} onClick={() => setPage('FEEDBACK')}>意見回饋</button>
    </nav>

    {page === 'RECORDS' ? <>
      <ScopePicker surfaces={surfaces} scope={scope} onChange={setScope} />
      <RecordFiltersPanel
        draft={filterDraft}
        onChange={setFilterDraft}
        onApply={applyFilters}
        onClear={clearFilters}
      />
      <section className="panel">
        {loading && records.length === 0 ? <div className="empty">載入中…</div> : null}
        {!loading && scope && records.length === 0 ? <div className="empty">目前沒有符合條件的紀錄。</div> : null}
        <div className="worklog-record-list">
          {records.map((record) => <RecordCard key={record.id} record={record} />)}
        </div>
        {recordPage?.hasMore ? <button
          className="load-more"
          disabled={loading}
          onClick={() => session && scope && void loadScope(session, scope, filters, true)}
        >{loading ? '載入中…' : '載入更多'}</button> : null}
      </section>
    </> : null}

    {page === 'FEEDBACK' ? <FeedbackPanel
      busy={loading}
      onSubmit={async (text) => {
        if (!session) return;
        await api.submitFeedback(session, text, {
          page: window.location.pathname,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userAgent: navigator.userAgent,
          appVersion: 'worklog-mvp',
          scopeType: scope?.type ?? 'NONE',
          sourceId: scope?.sourceId ?? 0,
        });
        setNotice('意見已送出，謝謝。');
      }}
    /> : null}
  </main>;
}

function ScopePicker({
  surfaces,
  scope,
  onChange,
}: {
  surfaces: WorklogSurfaces | null;
  scope: Scope | null;
  onChange: (scope: Scope) => void;
}) {
  return <section className="panel worklog-scope-panel">
    <div className="worklog-scope-row">
      {surfaces?.personal ? <button
        className={scope?.type === 'PERSONAL' ? 'worklog-scope active' : 'worklog-scope'}
        onClick={() => onChange({ type: 'PERSONAL', sourceId: surfaces.personal!.sourceId })}
      >個人紀錄</button> : null}
      {surfaces?.groups.map((group, index) => <button
        key={group.sourceId}
        className={scope?.type === 'GROUP' && scope.sourceId === group.sourceId ? 'worklog-scope active' : 'worklog-scope'}
        onClick={() => onChange({ type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId })}
      >群組 {index + 1}</button>)}
    </div>
  </section>;
}

function UsageBar({ usage }: { usage: UserUsage }) {
  return <section className="panel worklog-usage">
    <strong>{usage.planCode}</strong>
    <span>AI {usage.aiUsedUnits.toLocaleString('zh-TW')} / {usage.aiAllowanceUnits.toLocaleString('zh-TW')}</span>
    <span>剩餘 {usage.aiRemainingUnits.toLocaleString('zh-TW')}</span>
  </section>;
}

function RecordFiltersPanel({
  draft,
  onChange,
  onApply,
  onClear,
}: {
  draft: FilterDraft;
  onChange: (value: FilterDraft) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return <section className="panel record-filter-card">
    <div className="record-filter-grid">
      <label>模糊搜尋
        <input
          value={draft.query}
          onChange={(event) => onChange({ ...draft, query: event.target.value })}
          placeholder="搜尋紀錄內容"
        />
      </label>
      <label>從
        <input
          type="datetime-local"
          value={draft.from}
          onChange={(event) => onChange({ ...draft, from: event.target.value })}
        />
      </label>
      <label>到
        <input
          type="datetime-local"
          value={draft.to}
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
        />
      </label>
    </div>
    <div className="filter-actions">
      <button onClick={onApply}>套用篩選</button>
      <button className="ghost" onClick={onClear}>清除</button>
    </div>
  </section>;
}

function RecordCard({ record }: { record: WorklogRecord }) {
  const content = record.rawText || '尚無可顯示文字';
  const timestamp = record.sourceTimestamp || record.createdAt;
  return <article className="worklog-record-card">
    <div className="worklog-record-meta">
      <span>{inputLabel(record.inputType)}</span>
      <time>{new Date(timestamp).toLocaleString('zh-TW')}</time>
    </div>
    <strong>{content}</strong>
  </article>;
}

function FeedbackPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  return <section className="panel feedback-panel">
    <p className="eyebrow">FEEDBACK</p>
    <h2>告訴我們哪裡不好用</h2>
    <p className="muted">送出時會附上目前頁面、畫面尺寸、瀏覽器與目前紀錄範圍，方便排查；不會附上你的原始工作紀錄內容。</p>
    <textarea
      rows={7}
      value={text}
      onChange={(event) => setText(event.target.value)}
      placeholder="例如：群組紀錄篩選很難找、某個附件一直失敗…"
    />
    <button
      disabled={busy || !text.trim()}
      onClick={() => void onSubmit(text.trim()).then(() => setText(''))}
    >送出意見</button>
  </section>;
}

function apiFilters(value: FilterDraft, offset: number): RecordFilters {
  return {
    query: value.query,
    from: value.from ? new Date(value.from).toISOString() : undefined,
    to: value.to ? new Date(value.to).toISOString() : undefined,
    limit: 50,
    offset,
  };
}

function storedScope(): Scope | null {
  const raw = localStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') {
      return { type: 'PERSONAL', sourceId: value.sourceId };
    }
    if (
      value.type === 'GROUP'
      && typeof value.sourceId === 'number'
      && typeof value.lineGroupId === 'string'
    ) {
      return { type: 'GROUP', sourceId: value.sourceId, lineGroupId: value.lineGroupId };
    }
  } catch {
    // Ignore invalid persisted UI state and choose a fresh authorized scope.
  }
  return null;
}

function defaultScope(surfaces: WorklogSurfaces): Scope | null {
  if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId };
  const group = surfaces.groups[0];
  return group ? { type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId } : null;
}

function scopeExists(scope: Scope, surfaces: WorklogSurfaces) {
  return scope.type === 'PERSONAL'
    ? surfaces.personal?.sourceId === scope.sourceId
    : surfaces.groups.some((group) => group.sourceId === scope.sourceId && group.lineGroupId === scope.lineGroupId);
}

function persistSession(token: string) {
  localStorage.setItem(SESSION_KEY, token);
}

function dedupeRecords(records: WorklogRecord[]) {
  const seen = new Set<number>();
  return records.filter((record) => seen.has(record.id) ? false : (seen.add(record.id), true));
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function inputLabel(type: WorklogInputType) {
  return ({ TEXT: '文字', AUDIO: '音檔', IMAGE: '圖片', FILE: '檔案' } as const)[type];
}
