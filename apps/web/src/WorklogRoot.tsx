import { useEffect, useMemo, useRef, useState } from 'react';
import { WorklogApi, type WorklogInputType, type WorklogRecord, type WorklogSurfaces } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const ACTIVE_SCOPE_KEY = 'aftertrace.worklog.scope';

type Props = { apiBaseUrl: string };
type Scope = { type: 'PERSONAL'; sourceId: number } | { type: 'GROUP'; sourceId: number; lineGroupId: string };

function storedScope(): Scope | null {
  const raw = localStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'PERSONAL' && typeof value.sourceId === 'number') return { type: 'PERSONAL', sourceId: value.sourceId };
    if (value.type === 'GROUP' && typeof value.sourceId === 'number' && typeof value.lineGroupId === 'string') {
      return { type: 'GROUP', sourceId: value.sourceId, lineGroupId: value.lineGroupId };
    }
  } catch {
    // ignore stale client state
  }
  return null;
}

export function WorklogRoot({ apiBaseUrl }: Props) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const started = useRef(false);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [scope, setScope] = useState<Scope | null>(() => storedScope());
  const [records, setRecords] = useState<WorklogRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState<'' | WorklogInputType>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!session || !scope) return;
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
    void loadRecords(session, scope);
  }, [session, scope?.type, scope?.sourceId]);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callbackSession = hash.get('session')?.trim();
      let token = callbackSession || localStorage.getItem(SESSION_KEY);

      const url = new URL(window.location.href);
      const entryToken = url.searchParams.get('t')?.trim();
      if (entryToken) {
        const exchanged = await api.exchangeEntry(entryToken);
        token = exchanged.sessionToken;
        localStorage.setItem(SESSION_KEY, token);
        setSession(token);
        url.searchParams.delete('t');
        url.searchParams.delete('openExternalBrowser');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
      } else if (callbackSession) {
        localStorage.setItem(SESSION_KEY, callbackSession);
        setSession(callbackSession);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }

      if (!token) return;
      const nextSurfaces = await api.surfaces(token);
      setSurfaces(nextSurfaces);
      const remembered = storedScope();
      const validRemembered = remembered && scopeExists(remembered, nextSurfaces) ? remembered : null;
      const initial = validRemembered ?? defaultScope(nextSurfaces);
      setScope(initial);
      if (initial) await loadRecords(token, initial);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '載入失敗';
      if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(message)) clearSession();
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords(token: string, nextScope: Scope) {
    setLoading(true);
    setError(null);
    try {
      const next = nextScope.type === 'PERSONAL'
        ? await api.personalRecords(token)
        : await api.groupRecords(token, nextScope.sourceId);
      setRecords(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '紀錄載入失敗');
      setRecords([]);
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
  }

  const visibleRecords = records.filter((record) => {
    if (typeFilter && record.inputType !== typeFilter) return false;
    if (categoryFilter && record.category !== categoryFilter) return false;
    if (query.trim()) {
      const needle = query.trim().toLowerCase();
      const haystack = `${record.normalizedSummary ?? ''}\n${record.rawText ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  if (!session) {
    return (
      <main className="shell fatal-shell">
        <section className="fatal-card">
          <p className="eyebrow">AFTERTRACE</p>
          <h1>工作紀錄中心</h1>
          <p className="muted">使用 LINE 登入，查看你的個人與群組紀錄。</p>
          {error ? <div className="error">{error}</div> : null}
          <button type="button" onClick={() => { window.location.href = api.lineLoginUrl(); }}>使用 LINE 登入</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell worklog-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">AFTERTRACE</p>
          <h1>工作紀錄</h1>
        </div>
        <button className="ghost" type="button" onClick={clearSession}>登出</button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel worklog-scope-panel">
        <div className="worklog-scope-row">
          {surfaces?.personal ? (
            <button
              type="button"
              className={scope?.type === 'PERSONAL' ? 'worklog-scope active' : 'worklog-scope'}
              onClick={() => setScope({ type: 'PERSONAL', sourceId: surfaces.personal!.sourceId })}
            >個人紀錄</button>
          ) : null}
          {surfaces?.groups.map((group, index) => (
            <button
              key={group.sourceId}
              type="button"
              className={scope?.type === 'GROUP' && scope.sourceId === group.sourceId ? 'worklog-scope active' : 'worklog-scope'}
              onClick={() => setScope({ type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId })}
            >群組 {index + 1}</button>
          ))}
        </div>
      </section>

      <section className="panel worklog-filter-panel">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋紀錄文字" />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as '' | WorklogInputType)}>
          <option value="">全部類型</option><option value="TEXT">文字</option><option value="AUDIO">音檔</option><option value="IMAGE">圖片</option><option value="FILE">檔案</option>
        </select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">全部分類</option><option value="NOTE">備註</option><option value="WORK">施工</option><option value="ISSUE">問題</option><option value="PAYMENT">收款</option><option value="EXPENSE">支出</option><option value="MATERIAL">材料</option><option value="OTHER">其他</option>
        </select>
      </section>

      <section className="panel">
        {loading ? <div className="empty">載入中…</div> : null}
        {!loading && !scope ? <div className="empty">目前沒有可查看的紀錄範圍。</div> : null}
        {!loading && scope && visibleRecords.length === 0 ? <div className="empty">目前沒有符合條件的紀錄。</div> : null}
        <div className="worklog-record-list">
          {visibleRecords.map((record) => <RecordCard key={record.id} record={record} />)}
        </div>
      </section>
    </main>
  );
}

function RecordCard({ record }: { record: WorklogRecord }) {
  const content = record.normalizedSummary || record.rawText || '尚無可顯示文字';
  return (
    <article className="worklog-record-card">
      <div className="worklog-record-meta">
        <span>{inputLabel(record.inputType)}</span><span>{categoryLabel(record.category)}</span><time>{new Date(record.createdAt).toLocaleString('zh-TW')}</time>
      </div>
      <strong>{content}</strong>
      {record.normalizedSummary && record.rawText && record.normalizedSummary !== record.rawText ? <p className="muted worklog-raw">原始內容：{record.rawText}</p> : null}
    </article>
  );
}

function defaultScope(surfaces: WorklogSurfaces): Scope | null {
  if (surfaces.personal) return { type: 'PERSONAL', sourceId: surfaces.personal.sourceId };
  const group = surfaces.groups[0];
  return group ? { type: 'GROUP', sourceId: group.sourceId, lineGroupId: group.lineGroupId } : null;
}

function scopeExists(scope: Scope, surfaces: WorklogSurfaces) {
  if (scope.type === 'PERSONAL') return surfaces.personal?.sourceId === scope.sourceId;
  return surfaces.groups.some((group) => group.sourceId === scope.sourceId && group.lineGroupId === scope.lineGroupId);
}

function inputLabel(type: WorklogInputType) {
  return ({ TEXT: '文字', AUDIO: '音檔', IMAGE: '圖片', FILE: '檔案' } as const)[type];
}

function categoryLabel(category: string) {
  return ({ NOTE: '備註', WORK: '施工', ISSUE: '問題', PAYMENT: '收款', EXPENSE: '支出', MATERIAL: '材料', OTHER: '其他', PHOTO: '照片', AUDIO: '音訊' } as Record<string, string>)[category] ?? category;
}
