import { useEffect, useMemo } from 'react';
import { WorklogApi } from './worklog-api';
import './login.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const RETURN_KEY = 'aftertrace.worklog.returnTo';
const ALLOWED_RETURN_PATHS = new Set(['/capture', '/subscription', '/feedback', '/tasks']);

export function LoginRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const returnTo = safeReturnTo(localStorage.getItem(RETURN_KEY));

  useEffect(() => {
    if (localStorage.getItem(SESSION_KEY)) {
      window.location.replace(returnTo ?? '/');
    }
  }, [returnTo]);

  function start(provider: 'google' | 'line') {
    if (returnTo) localStorage.setItem(RETURN_KEY, returnTo);
    else localStorage.removeItem(RETURN_KEY);
    window.location.href = api.providerLoginUrl(provider);
  }

  return <main className="shell fatal-shell">
    <section className="fatal-card login-card">
      <p className="eyebrow">AFTERTRACE</p>
      <h1>登入 AFTERTRACE</h1>
      <p className="muted">選擇一個登入方式。Google 與 LINE 都只用來驗證你的 AFTERTRACE 帳號，不會成為帳號 ID 或工作資料的核心識別。</p>

      <div className="login-provider-actions" aria-label="登入方式">
        <button type="button" onClick={() => start('google')}>使用 Google 登入</button>
        <button type="button" className="ghost" onClick={() => start('line')}>使用 LINE 登入</button>
      </div>

      <p className="login-provider-note">AFTERTRACE 不會因為不同登入服務提供相同 Email 就自動合併帳號。</p>
      {returnTo ? <button type="button" className="link-button login-back" onClick={() => { window.location.href = returnTo; }}>返回上一頁</button> : null}
    </section>
  </main>;
}

function safeReturnTo(value: string | null): string | null {
  return value && ALLOWED_RETURN_PATHS.has(value) ? value : null;
}
