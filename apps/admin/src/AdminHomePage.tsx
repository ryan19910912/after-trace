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
      const destination = sessionStorage.getItem('aftertrace.admin.returnTo'); sessionStorage.removeItem('aftertrace.admin.returnTo');
      window.location.href = destination && /^\/(?:ai-prompts|accounts|announcements|feedback-management|profitability|commercial|ai-runtime)$/.test(destination) ? destination : '/';
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
    <p className="muted">登入後管理帳號、公告、使用者回饋與歷史帳務。</p>
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
        <p className="muted">集中管理帳號、使用者溝通與歷史帳務。</p>
      </div>
      <div className="admin-user-pill compact"><span className="admin-user-dot" /><div><small>已登入</small><strong>{username}</strong></div></div>
    </header>

    <section className="admin-overview-strip">
      <div><span>推論位置</span><strong>使用者裝置</strong></div>
      <div><span>雲端 AI</span><strong>已停用</strong></div>
      <div><span>訂閱與金流</span><strong>已停用</strong></div>
      <div><span>資料管理</span><strong>帳號與紀錄</strong></div>
    </section>

    <section className="admin-dashboard-grid">
      <article className="admin-dashboard-card accounts">
        <div className="admin-card-head"><span className="admin-card-icon">ID</span><span className="admin-card-kicker">帳號支援</span></div>
        <h2>帳號與客服</h2>
        <p className="muted">使用帳號 ID 精確查詢使用者，快速處理登入、群組與客服問題。</p>
        <div className="admin-card-actions"><a className="admin-action-primary" href="/accounts">開啟帳號查詢 <span>→</span></a></div>
      </article>

      <article className="admin-dashboard-card commercial">
        <div className="admin-card-head"><span className="admin-card-icon">AI</span><span className="admin-card-kicker">AI 設定</span></div>
        <h2>AI 提示與設定</h2>
        <p className="muted">管理本機 AI 提示的草稿、發布與歷史版本。歷史方案與用量保留查閱。</p>
        <div className="admin-card-actions"><a className="admin-action-primary" href="/ai-prompts">管理 AI 提示 <span>→</span></a><a href="/ai-runtime">本機 AI</a><a href="/profitability">歷史用量分析</a></div>
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
