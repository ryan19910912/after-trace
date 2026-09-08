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
      setUsername(session.username);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登入失敗');
    } finally { setBusy(false); }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    api.setSessionToken(null);
    setUsername(null);
  }

  if (busy) return <main className="shell"><section className="panel"><h1>AFTERTRACE Admin</h1><p>正在確認管理員登入狀態…</p></section></main>;

  if (!username) return <main className="shell auth-shell"><form className="login-card" onSubmit={(event) => { event.preventDefault(); void login(); }}>
    <p className="eyebrow">AFTERTRACE</p>
    <h1>管理後台</h1>
    <p className="muted">登入後管理 V1 商業方案、公告、意見回饋與營運資料。</p>
    {error ? <div className="banner error">{error}</div> : null}
    <label>管理員帳號<input autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} /></label>
    <label>密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button disabled={!loginUsername.trim() || !password}>登入</button>
  </form></main>;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">AFTERTRACE</p><h1>V1 管理後台</h1><p className="muted">{username} · 商業模型固定 FREE + AI Pro NT$99/月。</p></div>
      <button className="ghost" onClick={logout}>登出</button>
    </header>

    <section className="stack">
      <article className="card">
        <h2>帳號與客服查詢</h2>
        <p className="muted">以 AFTERTRACE 帳號 ID 精確查詢使用者，不依賴 Google / LINE / Apple provider identity。</p>
        <div className="header-actions"><a href="/accounts">帳號查詢</a></div>
      </article>

      <article className="card">
        <h2>商業與 AI</h2>
        <p className="muted">管理 FREE 一次性 AI 試用、AI Pro 月度資源／Provider Cost hard cap 與功能開關。</p>
        <div className="header-actions"><a href="/commercial">商業方案設定</a><a href="/pricing-calculator">成本試算</a><a href="/profitability">獲利與 AI 成本</a></div>
      </article>

      <article className="card">
        <h2>使用者溝通</h2>
        <p className="muted">公告與意見回饋都走 AFTERTRACE durable domain；LINE OA 僅作外部聯絡客服。</p>
        <div className="header-actions"><a href="/announcements">公告管理</a><a href="/feedback-management">意見回饋管理</a></div>
      </article>
    </section>
  </main>;
}
