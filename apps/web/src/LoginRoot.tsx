import { useEffect } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import './login.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const RETURN_KEY = 'aftertrace.worklog.returnTo';
const ALLOWED_RETURN_PATHS = new Set(['/capture', '/subscription', '/feedback', '/tasks']);

export function LoginRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const returnTo = safeReturnTo(localStorage.getItem(RETURN_KEY));

  useEffect(() => {
    if (localStorage.getItem(SESSION_KEY)) {
      window.location.replace(returnTo ?? '/');
    }
  }, [returnTo]);

  return <main className="shell fatal-shell">
    <section className="fatal-card login-card">
      <p className="eyebrow">AFTERTRACE</p>
      <h1>登入 AFTERTRACE</h1>
      <p className="muted">選擇一個登入方式。登入服務只負責驗證，不會成為帳號 ID 或工作資料的核心識別。</p>

      <LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo={returnTo ?? undefined} />

      <p className="login-provider-note">AFTERTRACE 不會因為 Google、LINE 或 Apple 提供相同 Email 就自動合併帳號。</p>
      {returnTo ? <button type="button" className="link-button login-back" onClick={() => { window.location.href = returnTo; }}>返回上一頁</button> : null}
    </section>
  </main>;
}

function safeReturnTo(value: string | null): '/capture' | '/subscription' | '/feedback' | '/tasks' | null {
  return value && ALLOWED_RETURN_PATHS.has(value)
    ? value as '/capture' | '/subscription' | '/feedback' | '/tasks'
    : null;
}
