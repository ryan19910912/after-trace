import { useAdminSession } from './admin-session';
import { FeedbackEnvironment } from './FeedbackEnvironment';
import { adminFetch } from './admin-fetch';
import { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';

const SESSION_KEY = 'aftertrace.admin.session';
type Category = 'BUG' | 'FEATURE' | 'UX' | 'OTHER';
type Status = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'IGNORED';
type FeedbackRow = {
  id: string;
  user_id: string;
  public_account_id: string;
  display_name: string | null;
  channel: string;
  text: string;
  context: unknown;
  category: Category;
  status: Status;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

export function AdminFeedbackPage({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new FeedbackAdminApi(apiBaseUrl), [apiBaseUrl]);
  const generation = useRef(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [status, setStatus] = useState<Status | ''>('');
  const [category, setCategory] = useState<Category | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void load(); return () => { generation.current++; }; }, [status, category, offset]);

  async function load() {
    const current = ++generation.current; setBusy(true); setError(null);
    try { const result = await api.list(status || null, category || null, offset); if (current === generation.current) { setRows(result.rows); setHasMore(result.hasMore); } }
    catch (cause) { if (current === generation.current) setError(message(cause, '意見回饋載入失敗')); }
    finally { if (current === generation.current) setBusy(false); }
  }

  async function update(row: FeedbackRow, nextCategory: Category, nextStatus: Status) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.update(row.id, nextCategory, nextStatus);
      setNotice(`回饋 #${row.id} 已更新為 ${categoryLabel(nextCategory)}／${statusLabel(nextStatus)}。`);
      await load();
    } catch (cause) { setError(message(cause, '回饋狀態更新失敗')); }
    finally { setBusy(false); }
  }

  if (!sessionStorage.getItem(SESSION_KEY)) return <main className="shell auth-shell"><section className="login-card">
    <p className="eyebrow">AFTERTRACE ADMIN</p><h1>意見回饋管理</h1>
    <p className="muted">請先登入管理後台。</p><button onClick={() => { location.href = '/'; }}>前往登入</button>
  </section></main>;

  return <main className="shell">
    <header className="topbar admin-hero"><div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>意見回饋管理</h1><p className="muted">分類、追蹤並結案使用者送出的意見回饋。</p></div></header>
    {error ? <div role="alert" className="banner error">{error}</div> : null}
    {notice ? <div role="status" className="banner success">{notice}</div> : null}
    <section className="card filter-card feedback-filter-card"><div className="filter-grid">
      <label>狀態<select disabled={busy} value={status} onChange={(event) => { setOffset(0); setStatus(event.target.value as Status | ''); }}><option value="">全部</option><option value="OPEN">待處理</option><option value="IN_PROGRESS">處理中</option><option value="RESOLVED">已解決</option><option value="IGNORED">忽略</option></select></label>
      <label>分類<select disabled={busy} value={category} onChange={(event) => { setOffset(0); setCategory(event.target.value as Category | ''); }}><option value="">全部</option><option value="BUG">問題回報</option><option value="FEATURE">功能建議</option><option value="UX">使用體驗</option><option value="OTHER">其他</option></select></label>
    </div><button disabled={busy} onClick={() => void load()}>重新整理</button></section>
    {busy && <p role="status">正在載入…</p>}
    <section className="stack">
      {!busy && rows.length === 0 ? <div className="card empty-state-card"><strong>目前沒有符合條件的回饋。</strong><p className="muted">新的回饋送出後會顯示在這裡。</p></div> : null}
      {rows.map((row) => <FeedbackCard key={row.id} row={row} busy={busy} onUpdate={update} />)}
    </section>
    <nav className="actions" aria-label="回饋分頁"><button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>上一頁</button><span>第 {Math.floor(offset / 30) + 1} 頁 · 每頁 30 筆</span><button disabled={busy || !hasMore} onClick={() => setOffset(offset + 30)}>下一頁</button></nav>
  </main>;
}

function FeedbackCard({ row, busy, onUpdate }: { row: FeedbackRow; busy: boolean; onUpdate: (row: FeedbackRow, category: Category, status: Status) => Promise<void> }) {
  const { can } = useAdminSession(); const canEdit = can('feedback.write');
  const [category, setCategory] = useState<Category>(row.category);
  const [status, setStatus] = useState<Status>(row.status);
  useEffect(() => { setCategory(row.category); setStatus(row.status); }, [row.category, row.status]);
  return <article className="card stack">
    <div className="card-head"><div><strong>#{row.id} · {row.public_account_id || `使用者 ${row.user_id}`}</strong><div className="muted">{row.display_name || '未設定名稱'} · {new Date(row.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</div></div><span className="pill">{statusLabel(row.status)}</span></div>
    {can('users.read')&&row.public_account_id&&<a href={'/users?q='+encodeURIComponent(row.public_account_id)}>查看此用戶</a>}<p className="content">{row.text}</p>
    <FeedbackEnvironment context={row.context} channel={row.channel} />
    <div className="filter-grid">
      <label>分類<select disabled={busy||!canEdit} value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="BUG">問題回報</option><option value="FEATURE">功能建議</option><option value="UX">使用體驗</option><option value="OTHER">其他</option></select></label>
      <label>狀態<select disabled={busy||!canEdit} value={status} onChange={(event) => setStatus(event.target.value as Status)}><option value="OPEN">待處理</option><option value="IN_PROGRESS">處理中</option><option value="RESOLVED">已解決</option><option value="IGNORED">忽略</option></select></label>
    </div>
    <div className="actions"><button disabled={busy || !canEdit || (category === row.category && status === row.status)} onClick={() => void onUpdate(row, category, status)}>儲存處理狀態</button></div>
    <div className="muted">目前：{categoryLabel(row.category)}／{statusLabel(row.status)}{row.updated_by ? ` · ${row.updated_by}` : ''}</div>
  </article>;
}

class FeedbackAdminApi {
  constructor(private readonly baseUrl: string) {}
  private token() { const value = sessionStorage.getItem(SESSION_KEY)?.trim(); if (!value) throw new Error('ADMIN_SESSION_REQUIRED'); return value; }
  private async request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${this.token()}`); headers.set('Accept', 'application/json');
    const response = await adminFetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin/feedback-management${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) { if (response.status === 401) sessionStorage.removeItem(SESSION_KEY); throw new Error(typeof body.error === 'string' ? body.error : `HTTP_${response.status}`); }
    return body;
  }
  async list(status: Status | null, category: Category | null, offset = 0): Promise<{ rows: FeedbackRow[]; hasMore: boolean }> {
    const query = new URLSearchParams(); if (status) query.set('status', status); if (category) query.set('category', category); query.set('limit', '30'); query.set('offset', String(offset));
    const body = await this.request(`/?${query.toString()}`); return { rows: Array.isArray(body.feedback) ? body.feedback as FeedbackRow[] : [], hasMore: (body.page as { hasMore?: boolean } | undefined)?.hasMore === true };
  }
  async update(id: string, category: Category, status: Status) {
    return this.request(`/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, status }) });
  }
}

function categoryLabel(value: Category) { return value === 'BUG' ? '問題回報' : value === 'FEATURE' ? '功能建議' : value === 'UX' ? '使用體驗' : '其他'; }
function statusLabel(value: Status) { return value === 'OPEN' ? '待處理' : value === 'IN_PROGRESS' ? '處理中' : value === 'RESOLVED' ? '已解決' : '忽略'; }
function message(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }
