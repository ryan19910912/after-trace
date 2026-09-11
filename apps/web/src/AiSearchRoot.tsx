import { useEffect, useMemo, useState } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type WorklogInputType, type WorklogSurfaces } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const QUICK_SEARCHES = [
  '昨天做了什麼？',
  '這週有哪些工作紀錄？',
  '找出收款相關紀錄',
  '找出最近的維修紀錄',
] as const;

type SearchRecord = {
  id: number;
  sourceId: number;
  inputType: WorklogInputType;
  title: string | null;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
};

type SearchResult = {
  entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
  interpretation: {
    terms: string[];
    from: string | null;
    to: string | null;
  };
  records: SearchRecord[];
};

export function AiSearchRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const worklogApi = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);

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
      } else {
        setError(message(cause, 'AI 搜尋載入失敗'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!session || !sourceId || !query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/ai/capture/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceId,
          query: query.trim(),
          timeZone: browserTimeZone(),
          limit: 20,
        }),
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
      } else {
        setError(searchErrorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <main className="shell fatal-shell">
      <section className="fatal-card">
        <p className="eyebrow">AFTERTRACE AI</p>
        <h1>AI 搜尋</h1>
        <p className="muted">用一句話找你有權限的個人或群組紀錄。</p>
        {error ? <div className="error">{error}</div> : null}
        <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/ai-search" />
      </section>
    </main>;
  }

  return <main className="shell worklog-shell ai-search-shell">
    <div className="topbar">
      <div>
        <p className="eyebrow">AFTERTRACE AI</p>
        <h1>AI 搜尋</h1>
        <p className="muted">直接描述你想找的事情，AFTERTRACE 會從你有權限的紀錄中搜尋。</p>
      </div>
      <div className="filter-actions">
        <button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button>
        <button className="ghost" onClick={() => { location.href = '/subscription'; }}>方案</button>
      </div>
    </div>

    {error ? <div className="error">{error}</div> : null}

    <section className="panel stack ai-search-panel">
      <label>要搜尋哪裡？
        <select
          value={sourceId ?? ''}
          disabled={busy || !surfaces}
          onChange={(event) => { setSourceId(Number(event.target.value) || null); setResult(null); }}
        >
          {surfaces?.personal ? <option value={surfaces.personal.sourceId}>我的紀錄</option> : null}
          {surfaces?.groups.map((group) => <option key={group.sourceId} value={group.sourceId}>{group.name}</option>)}
        </select>
      </label>
      <label>想找什麼？
        <textarea
          rows={3}
          maxLength={1000}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：昨天晴空案收款的紀錄"
        />
      </label>
      <div className="quick-searches" aria-label="常用搜尋範例">
        <span className="muted">不知道怎麼問？試試：</span>
        <div>
          {QUICK_SEARCHES.map((example) => <button
            key={example}
            type="button"
            className="quick-search-chip"
            disabled={busy}
            onClick={() => { setQuery(example); setResult(null); }}
          >{example}</button>)}
        </div>
      </div>
      <p className="muted">AI 搜尋會使用 AI Pro 或尚未用完的免費 AI 體驗額度；一般關鍵字與日期搜尋仍然免費。</p>
      <div className="filter-actions">
        <button disabled={busy || !sourceId || !query.trim()} onClick={() => void search()}>{busy ? '搜尋中…' : '開始搜尋'}</button>
        <button className="ghost" disabled={busy} onClick={() => { setQuery(''); setResult(null); setError(null); }}>清除</button>
      </div>
    </section>

    {result ? <section className="panel stack ai-search-results">
      <div className="topbar compact-topbar">
        <div>
          <p className="eyebrow">搜尋結果</p>
          <h2>{result.records.length} 筆紀錄</h2>
        </div>
        <span className="muted">{result.entitlementSource === 'FREE_TRIAL' ? '使用免費 AI 體驗' : '使用 AI Pro'}</span>
      </div>
      <SearchInterpretation result={result} />
      {result.records.length === 0
        ? <div className="empty">沒有找到符合條件的紀錄。可以換個說法，或回紀錄頁使用免費關鍵字／日期篩選。</div>
        : <div className="worklog-record-list">
          {result.records.map((record) => <SearchRecordCard key={record.id} record={record} />)}
        </div>}
    </section> : null}
  </main>;
}

function SearchInterpretation({ result }: { result: SearchResult }) {
  const { terms, from, to } = result.interpretation;
  return <div className="worklog-record-meta">
    {terms.length ? <span>關鍵字：{terms.join('、')}</span> : null}
    {from ? <span>從：{formatDateTime(from)}</span> : null}
    {to ? <span>到：{formatDateTime(to)}</span> : null}
  </div>;
}

function SearchRecordCard({ record }: { record: SearchRecord }) {
  const date = record.occurredAt ?? record.createdAt;
  return <article className="worklog-record-card">
    <div className="worklog-record-meta">
      <span>{inputLabel(record.inputType)}</span>
      {record.title ? <span>{record.title}</span> : null}
      <time>{record.occurredAt ? '發生時間' : '建立時間'}：{formatDateTime(date)}</time>
    </div>
    <strong>{record.rawText}</strong>
  </article>;
}

function searchResult(body: Record<string, unknown>): SearchResult {
  const interpretationRaw = plainObject(body.interpretation);
  const recordsRaw = Array.isArray(body.records) ? body.records : [];
  const entitlementSource = body.entitlementSource === 'FREE_TRIAL' ? 'FREE_TRIAL' : 'AI_PRO';
  return {
    entitlementSource,
    interpretation: {
      terms: Array.isArray(interpretationRaw.terms)
        ? interpretationRaw.terms.filter((value): value is string => typeof value === 'string').slice(0, 8)
        : [],
      from: nullableString(interpretationRaw.from),
      to: nullableString(interpretationRaw.to),
    },
    records: recordsRaw.map((value) => {
      const record = plainObject(value);
      return {
        id: Number(record.id),
        sourceId: Number(record.sourceId ?? record.source_id),
        inputType: inputType(record.inputType ?? record.input_type),
        title: nullableString(record.title),
        rawText: String(record.rawText ?? record.raw_text ?? ''),
        occurredAt: nullableString(record.occurredAt ?? record.occurred_at),
        createdAt: String(record.createdAt ?? record.created_at ?? ''),
      };
    }).filter((record) => Number.isSafeInteger(record.id) && record.id > 0 && record.rawText.trim()),
  };
}

function inputType(value: unknown): WorklogInputType {
  return value === 'AUDIO' || value === 'IMAGE' || value === 'FILE' ? value : 'TEXT';
}

function inputLabel(value: WorklogInputType): string {
  if (value === 'AUDIO') return '語音';
  if (value === 'IMAGE') return '圖片';
  if (value === 'FILE') return '檔案';
  return '文字';
}

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'; }
  catch { return 'Asia/Taipei'; }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function searchErrorMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/TRIAL_EXHAUSTED|AI_NOT_ENTITLED/.test(code)) return '免費 AI 體驗已用完，或目前沒有 AI Pro。一般搜尋仍可免費使用。';
  if (/MONTHLY_POINT_CAP|MONTHLY_PROVIDER_COST_CAP/.test(code)) return '本期 AI 使用已達方案上限；一般搜尋仍可正常使用，AI 會在下一個方案週期恢復。';
  if (code === 'AI_NATURAL_SEARCH_DISABLED') return 'AI 搜尋目前暫停使用；一般搜尋仍可正常使用。';
  if (code === 'SOURCE_NOT_AUTHORIZED') return '你目前沒有這個紀錄範圍的存取權限。';
  return message(cause, 'AI 搜尋失敗');
}

function sessionError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text);
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { throw new Error(`AI_SEARCH_INVALID_RESPONSE_${response.status}`); }
}

function apiError(response: Response, body: Record<string, unknown>): Error {
  const code = typeof body.error === 'string' && body.error ? body.error : `AI_SEARCH_FAILED_${response.status}`;
  return new Error(code);
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
