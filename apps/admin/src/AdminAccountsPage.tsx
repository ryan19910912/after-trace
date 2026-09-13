import { useEffect, useState } from 'react';
import { AdminApi, type Row } from './api';

const SESSION_KEY = 'aftertrace.admin.session';

export function AdminAccountsPage({ api }: { api: AdminApi }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.setSessionToken(sessionStorage.getItem(SESSION_KEY));
  }, [api]);

  async function search() {
    const value = query.trim();
    if (!value || busy) return;
    setBusy(true); setError(null);
    try {
      setRows(await api.accountLookup(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '帳號查詢失敗');
    } finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="topbar admin-hero">
      <div><p className="eyebrow">AFTERTRACE ADMIN</p><h1>帳號查詢</h1><p className="muted">優先使用使用者提供的「帳號 ID」精確查詢，快速處理登入、訂閱與客服問題。</p></div>
    </header>

    {error ? <div className="banner error">{error}</div> : null}
    <section className="card stack admin-search-card">
      <label>帳號 ID 或顯示名稱
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 AT-7K4M2P" onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} />
      </label>
      <button className="primary-action" disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? '查詢中…' : '查詢帳號'}</button>
    </section>

    <section className="stack">
      {rows.length === 0 ? <article className="card empty-state-card"><strong>尚無查詢結果。</strong><p className="muted">輸入帳號 ID 或顯示名稱後，查詢結果會顯示在這裡。</p></article> : rows.map((row) => <article className="card" key={String(row.id)}>
        <div className="card-head">
          <div>
            <p className="eyebrow">帳號資料</p>
            <h2>{String(row.display_name ?? '未設定顯示名稱')}</h2>
          </div>
          <strong>{String(row.public_account_id ?? '帳號 ID 尚未就緒')}</strong>
        </div>
        <div className="metric-grid">
          <Metric name="方案" value={String(row.plan_code ?? 'FREE')} />
          <Metric name="訂閱狀態" value={String(row.subscription_status ?? '—')} />
          <Metric name="群組數" value={String(row.member_group_count ?? '0')} />
          <Metric name="紀錄數" value={String(Number(row.text_count ?? 0) + Number(row.audio_count ?? 0) + Number(row.image_count ?? 0) + Number(row.file_count ?? 0))} />
        </div>
      </article>)}
    </section>
  </main>;
}

function Metric({ name, value }: { name: string; value: string }) {
  return <article className="metric"><span>{name}</span><strong>{value}</strong></article>;
}
