import { useEffect, useMemo, useState } from 'react';
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
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [status, setStatus] = useState<Status | ''>('');
  const [category, setCategory] = useState<Category | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void load(); }, [status, category]);

  async function load() {
    setBusy(true); setError(null);
    try { setRows(await api.list(status || null, category || null)); }
    catch (cause) { setError(message(cause, '意見回饋載入失敗')); }
    finally { setBusy(false); }
  }

  async function update(row: FeedbackRow, nextCategory: Category, nextStatus: Status) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.update(row.id, nextCategory, nextStatus);
      setNotice(`回饋 #${row.id} 已更新為 ${categoryLabel(nextCategory)} / ${statusLabel(nextStatus)}。`);
      await load();
    } catch (cause) { setError(message(cause, '回饋狀態更新失敗')); }
    finally { setBusy(false); }
  }

  if (!sessionStorage.getItem(SESSION_KEY)) return <main className="shell auth-shell"><section className="login-card">
    <p className="eyebrow">AFTERTRACE ADMIN</p><h1>意見回饋管理</h1>
    <p className="muted">請先回管理後台登入。</p><button onClick={() => { location.href = '/'; }}>回管理後台</button>
  </section></main>;

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>意見回饋管理</h1><p className="muted">分類、追蹤並結案 Web/PWA 使用者送出的意見回饋。</p></div><button className="ghost" onClick={() => { location.href = '/'; }}>回管理後台</button></header>
    {error ? <div className="banner error">{error}</div> : null}
    {notice ? <div className="banner success">{notice}</div> : null}
    <section className="card filter-card"><div className="filter-grid">
      <label>狀態<select value={status} onChange={(event) => setStatus(event.target.value as Status | '')}><option value="">全部</option><option value="OPEN">待處理</option><option value="IN_PROGRESS">處理中</option><option value="RESOLVED">已解決</option><option value="IGNORED">忽略</option></select></label>
      <label>分類<select value={category} onChange={(event) => setCategory(event.target.value as Category | '')}><option value="">全部</option><option value="BUG">Bug</option><option value="FEATURE">功能建議</option><option value="UX">UX</option><option value="OTHER">其他</option></select></label>
    </div><button disabled={busy} onClick={() => void load()}>重新整理</button></section>
    <section className="stack">
      {!busy && rows.length === 0 ? <div className="empty">目前沒有符合條件的回饋。</div> : null}
      {rows.map((row) => <FeedbackCard key={row.id} row={row} busy={busy} onUpdate={update} />)}
    </section>
  </main>;
}

function FeedbackCard({ row, busy, onUpdate }: { row: FeedbackRow; busy: boolean; onUpdate: (row: FeedbackRow, category: Category, status: Status) => Promise<void> }) {
  const [category, setCategory] = useState<Category>(row.category);
  const [status, setStatus] = useState<Status>(row.status);
  useEffect(() => { setCategory(row.category); setStatus(row.status); }, [row.category, row.status]);
  return <article className="card stack">
    <div className="card-head"><div><strong>#{row.id} · {row.public_account_id || `User ${row.user_id}`}</strong><div className="muted">{row.display_name || '未設定名稱'} · {new Date(row.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</div></div><span className="pill">{statusLabel(row.status)}</span></div>
    <p className="content">{row.text}</p>
    {row.context ? <details><summary>送出環境</summary><pre>{JSON.stringify(row.context, null, 2)}</pre></details> : null}
    <div className="filter-grid">
      <label>分類<select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="BUG">Bug</option><option value="FEATURE">功能建議</option><option value="UX">UX</option><option value="OTHER">其他</option></select></label>
      <label>狀態<select value={status} onChange={(event) => setStatus(event.target.value as Status)}><option value="OPEN">待處理</option><option value="IN_PROGRESS">處理中</option><option value="RESOLVED">已解決</option><option value="IGNORED">忽略</option></select></label>
    </div>
    <div className="actions"><button disabled={busy || (category === row.category && status === row.status)} onClick={() => void onUpdate(row, category, status)}>儲存處理狀態</button></div>
    <div className="muted">目前：{categoryLabel(row.category)} / {statusLabel(row.status)}{row.updated_by ? ` · ${row.updated_by}` : ''}</div>
  </article>;
}

class FeedbackAdminApi {
  constructor(private readonly baseUrl: string) {}
  private token() { const value = sessionStorage.getItem(SESSION_KEY)?.trim(); if (!value) throw new Error('ADMIN_SESSION_REQUIRED'); return value; }
  private async request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${this.token()}`); headers.set('Accept', 'application/json');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/admin/feedback-management${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) { if (response.status === 401) sessionStorage.removeItem(SESSION_KEY); throw new Error(typeof body.error === 'string' ? body.error : `HTTP_${response.status}`); }
    return body;
  }
  async list(status: Status | null, category: Category | null): Promise<FeedbackRow[]> {
    const query = new URLSearchParams(); if (status) query.set('status', status); if (category) query.set('category', category); query.set('limit', '200');
    const body = await this.request(`/?${query.toString()}`); return Array.isArray(body.feedback) ? body.feedback as FeedbackRow[] : [];
  }
  async update(id: string, category: Category, status: Status) {
    return this.request(`/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, status }) });
  }
}

function categoryLabel(value: Category) { return value === 'BUG' ? 'Bug' : value === 'FEATURE' ? '功能建議' : value === 'UX' ? 'UX' : '其他'; }
function statusLabel(value: Status) { return value === 'OPEN' ? '待處理' : value === 'IN_PROGRESS' ? '處理中' : value === 'RESOLVED' ? '已解決' : '忽略'; }
function message(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }
