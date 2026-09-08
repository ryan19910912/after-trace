import { useEffect, useMemo, useState } from 'react';
import { aiToolsDeepLinkFromSearch, aiToolsDeepLinkUrl } from './ai-tools-deep-link';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi, type WorklogInputType, type WorklogSurfaces } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';

type RelatedRecord = {
  id: number;
  inputType: WorklogInputType;
  title: string | null;
  rawText: string;
  occurredAt: string | null;
  createdAt: string;
  relevanceScore: number;
};

type RewriteProposal = {
  recordId: number;
  expectedVersion: number;
  originalText: string;
  proposedText: string;
  entitlementSource: 'FREE_TRIAL' | 'AI_PRO';
};

export function AiToolsRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const worklogApi = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const deepLink = useMemo(() => aiToolsDeepLinkFromSearch(window.location.search), []);
  const loginReturn = useMemo(() => deepLink ? aiToolsDeepLinkUrl(deepLink) : '/ai-tools', [deepLink]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [relatedRecordId, setRelatedRecordId] = useState(() => deepLink?.tool === 'related' ? String(deepLink.recordId) : '');
  const [related, setRelated] = useState<RelatedRecord[]>([]);
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<string | null>(null);
  const [rewriteRecordId, setRewriteRecordId] = useState(() => deepLink?.tool === 'rewrite' ? String(deepLink.recordId) : '');
  const [rewriteInstruction, setRewriteInstruction] = useState('改得更清楚、精簡，但保留原本事實。');
  const [proposal, setProposal] = useState<RewriteProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void bootstrap(); }, []);

  async function bootstrap() {
    setBusy(true); setError(null);
    try {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const callback = hash.get('session')?.trim();
      const token = callback || localStorage.getItem(SESSION_KEY);
      if (callback) {
        localStorage.setItem(SESSION_KEY, callback);
        setSession(callback);
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      }
      if (!token) return;
      const next = await worklogApi.surfaces(token);
      setSurfaces(next);
      const defaultSourceId = next.personal?.sourceId ?? next.groups[0]?.sourceId ?? null;
      const linkedSourceId = deepLink && sourceExists(next, deepLink.sourceId) ? deepLink.sourceId : null;
      setSourceId(linkedSourceId ?? defaultSourceId);
      if (deepLink && !linkedSourceId) {
        setNotice('這個 AI 工具連結指定的紀錄範圍目前不可用，已改用你可使用的預設範圍。');
      }
      if (deepLink && linkedSourceId) {
        window.setTimeout(() => document.getElementById(deepLink.tool)?.scrollIntoView({ block: 'start' }), 0);
      }
    } catch (cause) {
      handleError(cause, 'AI 工具載入失敗');
    } finally { setBusy(false); }
  }

  async function loadRelated() {
    const recordId = positiveId(relatedRecordId);
    if (!session || !sourceId || !recordId || busy) return;
    setBusy(true); setError(null); setNotice(null); setRelated([]);
    try {
      const body = await postAi('/related', { sourceId, recordId, limit: 8 });
      const rows = Array.isArray(body.records) ? body.records : [];
      setRelated(rows.map(relatedRecord).filter((row): row is RelatedRecord => row !== null));
      setNotice(rows.length ? null : '目前沒有找到分數大於 0 的相關紀錄。');
    } catch (cause) { handleError(cause, '相關紀錄載入失敗'); }
    finally { setBusy(false); }
  }

  async function createSummary() {
    if (!session || !sourceId || !summaryFrom || !summaryTo || busy) return;
    const from = localIso(summaryFrom);
    const to = localIso(summaryTo);
    if (!from || !to || new Date(from).getTime() >= new Date(to).getTime()) {
      setError('請輸入有效的摘要開始與結束時間。'); return;
    }
    setBusy(true); setError(null); setNotice(null); setSummary(null); setSummaryMeta(null);
    try {
      const body = await postAi('/summary', { sourceId, from, to, timeZone: browserTimeZone() });
      if (body.status === 'NO_RECORDS') {
        setNotice('這個時間區間沒有可摘要的紀錄，因此沒有使用 provider AI。');
        return;
      }
      const text = typeof body.summary === 'string' ? body.summary.trim() : '';
      if (!text) throw new Error('AI_SUMMARY_INVALID_RESPONSE');
      setSummary(text);
      const count = Number(body.recordCount ?? 0);
      setSummaryMeta(`${Number.isSafeInteger(count) ? count : 0} 筆紀錄${body.truncated === true ? '（已達單次 200 筆上限）' : ''} · ${body.entitlementSource === 'FREE_TRIAL' ? 'AI 試用' : 'AI Pro'}`);
    } catch (cause) { handleError(cause, '區間摘要失敗'); }
    finally { setBusy(false); }
  }

  async function proposeRewrite() {
    const recordId = positiveId(rewriteRecordId);
    if (!session || !sourceId || !recordId || !rewriteInstruction.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null); setProposal(null);
    try {
      const body = await postAi('/rewrite', { sourceId, recordId, instruction: rewriteInstruction.trim() });
      const proposedText = typeof body.proposedText === 'string' ? body.proposedText.trim() : '';
      const originalText = typeof body.originalText === 'string' ? body.originalText : '';
      const expectedVersion = Number(body.expectedVersion);
      if (!proposedText || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new Error('AI_REWRITE_INVALID_RESPONSE');
      setProposal({
        recordId,
        expectedVersion,
        originalText,
        proposedText,
        entitlementSource: body.entitlementSource === 'FREE_TRIAL' ? 'FREE_TRIAL' : 'AI_PRO',
      });
    } catch (cause) { handleError(cause, 'AI 改寫失敗'); }
    finally { setBusy(false); }
  }

  async function acceptRewrite() {
    if (!session || !proposal || busy) return;
    if (!window.confirm('確定以 AI 建議內容更新這筆紀錄？若紀錄已被其他人修改，AFTERTRACE 會拒絕覆蓋並重新載入最新版。')) return;
    setBusy(true); setError(null);
    try {
      await worklogApi.updateRecord(session, proposal.recordId, {
        expectedVersion: proposal.expectedVersion,
        rawText: proposal.proposedText,
      });
      setProposal(null);
      setNotice('AI 改寫已由你確認並套用；Record revision history 已保留。');
    } catch (cause) { handleError(cause, '套用 AI 改寫失敗'); }
    finally { setBusy(false); }
  }

  async function postAi(path: string, body: Record<string, unknown>) {
    if (!session) throw new Error('WEB_SESSION_REQUIRED');
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/ai/capture${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value = await responseBody(response);
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `AI_TOOLS_FAILED_${response.status}`);
    return value;
  }

  function handleError(cause: unknown, fallback: string) {
    if (sessionError(cause)) {
      localStorage.removeItem(SESSION_KEY);
      setSession(null); setSurfaces(null); setSourceId(null);
      setError('登入已過期，請重新登入 AFTERTRACE。');
      return;
    }
    setError(aiErrorMessage(cause, fallback));
  }

  if (!session) {
    return <main className="shell fatal-shell"><section className="fatal-card">
      <p className="eyebrow">AFTERTRACE AI</p><h1>AI 工具</h1>
      <p className="muted">登入後使用相關紀錄、時間區間摘要與明確確認的 AI 改寫。</p>
      {error ? <div className="error">{error}</div> : null}
      <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo={loginReturn} />
    </section></main>;
  }

  return <main className="shell worklog-shell">
    <div className="topbar">
      <div><p className="eyebrow">AFTERTRACE AI</p><h1>AI 工具</h1><p className="muted">所有資料都限定在你已授權的 AFTERTRACE Source。</p></div>
      <div className="filter-actions"><button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button><button className="ghost" onClick={() => { location.href = '/ai-search'; }}>AI 搜尋</button></div>
    </div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}

    <section className="panel stack">
      <label>紀錄範圍<select value={sourceId ?? ''} disabled={busy || !surfaces} onChange={(event) => {
        setSourceId(Number(event.target.value) || null); setRelated([]); setSummary(null); setProposal(null);
      }}>
        {surfaces?.personal ? <option value={surfaces.personal.sourceId}>我的紀錄</option> : null}
        {surfaces?.groups.map((group) => <option key={group.sourceId} value={group.sourceId}>{group.name}</option>)}
      </select></label>
    </section>

    <section id="related" className="panel stack">
      <div><p className="eyebrow">RELATED</p><h2>相關紀錄</h2></div>
      <p className="muted">從紀錄頁進入時會自動帶入 Record ID；也可以在這裡手動輸入。相關排序只使用你已授權的同 Source 資料，目前不額外呼叫 provider。</p>
      <label>紀錄 ID<input inputMode="numeric" value={relatedRecordId} onChange={(event) => setRelatedRecordId(event.target.value)} /></label>
      <button disabled={busy || !sourceId || !positiveId(relatedRecordId)} onClick={() => void loadRelated()}>{busy ? '處理中…' : '找相關紀錄'}</button>
      {related.length ? <div className="worklog-record-list">{related.map((record) => <article key={record.id} className="worklog-record-card">
        <div className="worklog-record-meta"><span>ID {record.id}</span><span>相關分數 {record.relevanceScore}</span>{record.title ? <span>{record.title}</span> : null}</div>
        <strong>{record.rawText}</strong>
      </article>)}</div> : null}
    </section>

    <section className="panel stack">
      <div><p className="eyebrow">SUMMARY</p><h2>時間區間摘要</h2></div>
      <p className="muted">AFTERTRACE 先在 PostgreSQL 取出同 Source、同時間區間、最多 200 筆紀錄，再把這個 bounded dataset 交給 provider 摘要。</p>
      <div className="record-filter-grid">
        <label>從<input type="datetime-local" value={summaryFrom} onChange={(event) => setSummaryFrom(event.target.value)} /></label>
        <label>到<input type="datetime-local" value={summaryTo} onChange={(event) => setSummaryTo(event.target.value)} /></label>
      </div>
      <button disabled={busy || !sourceId || !summaryFrom || !summaryTo} onClick={() => void createSummary()}>{busy ? '摘要中…' : '產生 AI 摘要'}</button>
      {summary ? <article className="worklog-record-card"><div className="worklog-record-meta"><span>{summaryMeta}</span></div><strong>{summary}</strong></article> : null}
    </section>

    <section id="rewrite" className="panel stack">
      <div><p className="eyebrow">REWRITE</p><h2>AI 改寫建議</h2></div>
      <p className="muted">從紀錄頁進入時會自動帶入 Record ID。AI 只產生 proposal，不直接改 Record；你確認後才會透過 optimistic version/revision API 更新。</p>
      <label>紀錄 ID<input inputMode="numeric" value={rewriteRecordId} onChange={(event) => setRewriteRecordId(event.target.value)} /></label>
      <label>改寫要求<textarea rows={3} maxLength={1000} value={rewriteInstruction} onChange={(event) => setRewriteInstruction(event.target.value)} /></label>
      <button disabled={busy || !sourceId || !positiveId(rewriteRecordId) || !rewriteInstruction.trim()} onClick={() => void proposeRewrite()}>{busy ? '產生中…' : '產生改寫建議'}</button>
      {proposal ? <div className="stack">
        <article className="worklog-record-card"><div className="worklog-record-meta"><span>原文 · v{proposal.expectedVersion}</span></div><strong>{proposal.originalText}</strong></article>
        <article className="worklog-record-card"><div className="worklog-record-meta"><span>AI 建議</span><span>{proposal.entitlementSource === 'FREE_TRIAL' ? 'AI 試用' : 'AI Pro'}</span></div><strong>{proposal.proposedText}</strong></article>
        <div className="filter-actions"><button disabled={busy} onClick={() => void acceptRewrite()}>確認套用</button><button className="ghost" disabled={busy} onClick={() => setProposal(null)}>取消</button></div>
      </div> : null}
    </section>
  </main>;
}

function relatedRecord(value: unknown): RelatedRecord | null {
  const raw = plainObject(value);
  const id = Number(raw.id);
  const score = Number(raw.relevanceScore ?? raw.relevance_score);
  const rawText = typeof raw.rawText === 'string' ? raw.rawText : typeof raw.raw_text === 'string' ? raw.raw_text : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !rawText.trim() || !Number.isFinite(score)) return null;
  return {
    id,
    inputType: inputType(raw.inputType ?? raw.input_type),
    title: nullableString(raw.title),
    rawText: rawText.trim(),
    occurredAt: nullableString(raw.occurredAt ?? raw.occurred_at),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    relevanceScore: score,
  };
}
function sourceExists(surfaces: WorklogSurfaces, sourceId: number): boolean {
  return surfaces.personal?.sourceId === sourceId || surfaces.groups.some((group) => group.sourceId === sourceId);
}
function inputType(value: unknown): WorklogInputType { return value === 'AUDIO' || value === 'IMAGE' || value === 'FILE' ? value : 'TEXT'; }
function positiveId(value: string): number | null { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function localIso(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function browserTimeZone(): string { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'; } catch { return 'Asia/Taipei'; } }
function plainObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nullableString(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : String(value); }
async function responseBody(response: Response): Promise<Record<string, unknown>> { const text = await response.text(); if (!text) return {}; try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`AI_TOOLS_INVALID_RESPONSE_${response.status}`); } }
function sessionError(cause: unknown): boolean { const code = cause instanceof Error ? cause.message : String(cause ?? ''); return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(code); }
function aiErrorMessage(cause: unknown, fallback: string): string {
  const code = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/TRIAL_EXHAUSTED|AI_NOT_ENTITLED/.test(code)) return 'AI 試用已用完或目前沒有 AI entitlement；FREE 手動功能仍可正常使用。可到方案頁查看 AI Pro。';
  if (/MONTHLY_POINT_CAP|MONTHLY_PROVIDER_COST_CAP/.test(code)) return '本期 AI 已達方案安全上限；FREE 手動功能仍可正常使用。';
  if (code === 'SOURCE_NOT_AUTHORIZED') return '你目前沒有這個紀錄範圍的存取權限。';
  if (code.endsWith('_DISABLED')) return '這項 AI 功能目前由營運端關閉；FREE 手動功能不受影響。';
  if (code === 'RECORD_NOT_FOUND') return '找不到這筆紀錄，或它已不在目前的紀錄範圍中。';
  return cause instanceof Error && cause.message ? cause.message : fallback;
}