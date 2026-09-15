import { useEffect, useState } from 'react';
import { AdminApi } from './api';

const SESSION_KEY = 'aftertrace.admin.session';

export function AdminHomePage({ api }: { api: AdminApi }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY);
    api.setSessionToken(token);
    if (!token) { setBusy(false); return; }
    void api.session()
      .then((session) => setUsername(session.username))
      .catch(() => { sessionStorage.removeItem(SESSION_KEY); api.setSessionToken(null); })
      .finally(() => setBusy(false));
  }, [api]);

  async function login() {
    if (!loginUsername.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      const session = await api.login(loginUsername.trim(), password);
      sessionStorage.setItem(SESSION_KEY, session.sessionToken);
      api.setSessionToken(session.sessionToken);
      window.location.href = '/';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登入失敗');
      setBusy(false);
    }
  }

  if (busy) return <main className="shell"><section className="panel"><h1>AFTERTRACE Admin</h1><p>正在確認管理員登入狀態…</p></section></main>;

  if (!username) return <main className="shell auth-shell"><form className="login-card" onSubmit={(event) => { event.preventDefault(); void login(); }}>
    <img className="admin-login-logo" src="/aftertrace-icon.svg" alt="" />
    <p className="eyebrow">AFTERTRACE ADMIN</p>
    <h1>管理後台</h1>
    <p className="muted">登入後管理商業方案、AI 成本、公告與使用者支援。</p>
    {error ? <div className="banner error">{error}</div> : null}
    <label>管理員帳號<input autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} /></label>
    <label>密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button disabled={!loginUsername.trim() || !password}>登入</button>
  </form></main>;

  return <main className="shell admin-home-shell">
    <header className="topbar admin-page-head">
      <div>
        <p className="eyebrow">AFTERTRACE ADMIN</p>
        <h1>營運總覽</h1>
        <p className="muted">集中管理帳號、商業方案、AI 成本與使用者溝通。</p>
      </div>
      <div className="admin-user-pill compact"><span className="admin-user-dot" /><div><small>已登入</small><strong>{username}</strong></div></div>
    </header>

    <section className="admin-overview-strip">
      <div><span>免費方案</span><strong>FREE</strong></div>
      <div><span>訂閱方案</span><strong>AI Pro</strong></div>
      <div><span>每月訂閱價格</span><strong>NT$99</strong></div>
      <div><span>系統狀態</span><strong>正常運作</strong></div>
    </section>

    <section className="admin-dashboard-grid">
      <article className="admin-dashboard-card accounts">
        <div className="admin-card-head"><span className="admin-card-icon">ID</span><span className="admin-card-kicker">帳號支援</span></div>
        <h2>帳號與客服</h2>
        <p className="muted">使用帳號 ID 精確查詢使用者，快速處理登入、訂閱與客服問題。</p>
        <div className="admin-card-actions"><a className="admin-action-primary" href="/accounts">開啟帳號查詢 <span>→</span></a></div>
      </article>

      <article className="admin-dashboard-card commercial">
        <div className="admin-card-head"><span className="admin-card-icon">AI</span><span className="admin-card-kicker">商業設定</span></div>
        <h2>商業與 AI</h2>
        <p className="muted">管理免費體驗、訂閱方案、AI 模型價格、方案內成本試算與營運分析。</p>
        <div className="admin-card-actions"><a className="admin-action-primary" href="/commercial">方案設定與成本試算 <span>→</span></a><a href="/ai-runtime">模型與價格</a><a href="/profitability">獲利分析</a></div>
      </article>

      <article className="admin-dashboard-card communication">
        <div className="admin-card-head"><span className="admin-card-icon">MSG</span><span className="admin-card-kicker">使用者溝通</span></div>
        <h2>公告與回饋</h2>
        <p className="muted">集中管理站內公告、重要通知與使用者意見回饋。</p>
        <div className="admin-card-actions"><a className="admin-action-primary" href="/announcements">公告管理 <span>→</span></a><a href="/feedback-management">意見回饋</a></div>
      </article>
    </section>
  </main>;
}
