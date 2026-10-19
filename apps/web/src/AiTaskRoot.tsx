import { useEffect, useMemo, useState } from 'react';
import { aiTaskDeepLinkFromSearch, aiTaskDeepLinkUrl } from './ai-task-deep-link';
import { LoginProviderButtons } from './LoginProviderButtons';
import { TaskApi } from './task-api';
import { WorklogApi, type WorklogSurfaces } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';

type Proposal = {
  sourceId: number;
  recordId: number | null;
  title: string;
  body: string | null;
  dueAt: string | null;
  remindAt: string | null;
};

export function AiTaskRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const worklogApi = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const taskApi = useMemo(() => new TaskApi(apiBaseUrl), [apiBaseUrl]);
  const deepLink = useMemo(() => aiTaskDeepLinkFromSearch(window.location.search), []);
  const loginReturn = useMemo(() => deepLink ? aiTaskDeepLinkUrl(deepLink) : '/ai-task', [deepLink]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [surfaces, setSurfaces] = useState<WorklogSurfaces | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [recordId, setRecordId] = useState('');
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
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
        localStorage.setItem(SESSION_KEY, callback); setSession(callback);
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
      }
      if (!token) return;
      const next = await worklogApi.surfaces(token);
      setSurfaces(next);
      const deepLinkAuthorized = deepLink
        ? next.personal?.sourceId === deepLink.sourceId || next.groups.some((group) => group.sourceId === deepLink.sourceId)
        : false;
      if (deepLink && deepLinkAuthorized) {
        setSourceId(deepLink.sourceId);
        setRecordId(String(deepLink.recordId));
      } else {
        setSourceId(next.personal?.sourceId ?? next.groups[0]?.sourceId ?? null);
      }
    } catch (cause) { handleError(cause, 'AI 待辦載入失敗'); }
    finally { setBusy(false); }
  }

  async function propose() {
    if (!session || !sourceId || !text.trim() || busy) return;
    const targetRecordId = recordId.trim() ? positiveId(recordId) : null;
    if (recordId.trim() && !targetRecordId) { setError('紀錄編號必須是有效的正整數。'); return; }
    setBusy(true); setError(null); setNotice(null); setProposal(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/ai/task-proposal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, recordId: targetRecordId, text: text.trim(), timeZone: browserTimeZone() }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `AI_TASK_PROPOSAL_FAILED_${response.status}`);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) throw new Error('AI_TASK_PROPOSAL_INVALID_RESPONSE');
      setProposal({ sourceId, recordId: targetRecordId, title, body: nullableString(body.body), dueAt: nullableString(body.dueAt), remindAt: nullableString(body.remindAt) });
    } catch (cause) { handleError(cause, 'AI 待辦建議產生失敗'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!session || !proposal || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await taskApi.create(session, {
        title: proposal.title,
        body: proposal.body,
        sourceId: proposal.sourceId,
        recordId: proposal.recordId,
        dueAt: proposal.dueAt,
        remindAt: proposal.remindAt,
      });
      setNotice(`待辦「${created.title}」已建立。`);
      setProposal(null); setText(''); setRecordId('');
    } catch (cause) { handleError(cause, '待辦建立失敗'); }
    finally { setBusy(false); }
  }

  function handleError(cause: unknown, fallback: string) {
    const code = cause instanceof Error ? cause.message : String(cause ?? '');
    if (/INVALID_WEB_SESSION|WEB_SESSION_REQUIRED|WORKLOG_USER_NOT_FOUND/.test(code)) {
      localStorage.removeItem(SESSION_KEY); setSession(null); setSurfaces(null); setSourceId(null);
      setError('登入已過期，請重新登入。'); return;
    }
    if (code === 'TRIAL_EXHAUSTED') { setError('免費 AI 體驗額度已用完；可升級 AI Pro 繼續使用 AI 待辦建議，或手動建立待辦。'); return; }
    if (code === 'AI_NOT_ENTITLED') { setError('目前沒有可用 AI 額度；你仍可到待辦頁手動建立待辦。'); return; }
    if (/MONTHLY_POINT_CAP|MONTHLY_PROVIDER_COST_CAP/.test(code)) { setError('本期 AI 使用量已達上限；手動待辦仍可正常使用。'); return; }
    if (code === 'AI_TASK_PROPOSAL_DISABLED') { setError('AI 待辦建議目前暫停使用；手動待辦仍可正常使用。'); return; }
    if (code === 'RECORD_NOT_FOUND') { setError('找不到這筆紀錄，或它不在目前選擇的紀錄範圍。'); return; }
    setError(cause instanceof Error && cause.message && !/^[A-Z0-9_]+$/.test(cause.message) ? cause.message : fallback);
  }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card">
    <p className="eyebrow">AFTERTRACE AI</p><h1>AI 待辦建議</h1>
    <p className="muted">免費 AI 體驗額度或 AI Pro 都可以先整理待辦內容與時間；你確認後才會真正建立待辦。</p>
    {error ? <div className="error">{error}</div> : null}
    <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo={loginReturn} />
  </section></main>;

  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE AI</p><h1>AI 待辦建議</h1><p className="muted">免費 AI 體驗與 AI Pro 都能使用。AI 只會先產生建議，你確認後才會建立待辦。</p></div><div className="filter-actions"><button className="ghost" onClick={() => { location.href = '/tasks'; }}>我的待辦</button><button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button></div></div>
    {error ? <div className="error">{error}</div> : null}
    {notice ? <div className="worklog-notice">{notice}</div> : null}
    <section className="panel stack">
      <label>紀錄範圍<select value={sourceId ?? ''} disabled={busy || !surfaces} onChange={(event) => { setSourceId(Number(event.target.value) || null); setProposal(null); }}>
        {surfaces?.personal ? <option value={surfaces.personal.sourceId}>我的紀錄</option> : null}
        {surfaces?.groups.map((group) => <option key={group.sourceId} value={group.sourceId}>{group.name}</option>)}
      </select></label>
      <label>參考紀錄編號（選填）<input inputMode="numeric" value={recordId} onChange={(event) => setRecordId(event.target.value)} placeholder="例如 123" /></label>
      <label>想做什麼？<textarea rows={5} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：下週三提醒我回王先生晴空案的報價" /></label>
      <p className="muted">AI 只會解讀你明確寫出的時間；沒有時間資訊時，不會自行補上提醒時間。本次處理會從可用 AI 額度扣除用量。</p>
      <button disabled={busy || !sourceId || !text.trim()} onClick={() => void propose()}>{busy ? '整理中…' : '產生待辦建議'}</button>
    </section>

    {proposal ? <section className="panel stack">
      <div><p className="eyebrow">AI 建議</p><h2>確認後才會建立</h2></div>
      <label>待辦名稱<input value={proposal.title} maxLength={255} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} /></label>
      <label>補充內容<textarea rows={4} value={proposal.body ?? ''} onChange={(event) => setProposal({ ...proposal, body: event.target.value || null })} /></label>
      <div className="record-filter-grid">
        <label>到期時間<input type="datetime-local" value={localInput(proposal.dueAt)} onChange={(event) => setProposal({ ...proposal, dueAt: isoOrNull(event.target.value) })} /></label>
        <label>提醒時間<input type="datetime-local" value={localInput(proposal.remindAt)} onChange={(event) => setProposal({ ...proposal, remindAt: isoOrNull(event.target.value) })} /></label>
      </div>
      <p className="muted">取消後不會建立待辦。</p>
      <div className="filter-actions"><button disabled={busy || !proposal.title.trim()} onClick={() => void confirm()}>確認建立待辦</button><button className="ghost" disabled={busy} onClick={() => setProposal(null)}>取消</button></div>
    </section> : null}
  </main>;
}

function positiveId(value: string) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function browserTimeZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'; } catch { return 'Asia/Taipei'; } }
function nullableString(value: unknown) { return typeof value === 'string' && value.trim() ? value : null; }
function localInput(value: string | null) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }
function isoOrNull(value: string) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
async function responseBody(response: Response): Promise<Record<string, unknown>> { const text = await response.text(); if (!text) return {}; try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`AI_TASK_INVALID_RESPONSE_${response.status}`); } }
