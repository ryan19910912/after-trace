const RETURN_KEY = 'aftertrace.worklog.returnTo';

export function LoginProviderButtons({
  apiBaseUrl,
  returnTo,
}: {
  apiBaseUrl: string;
  returnTo?: '/capture' | '/subscription' | '/feedback' | '/tasks';
}) {
  function login(provider: 'google' | 'line' | 'apple') {
    if (returnTo) localStorage.setItem(RETURN_KEY, returnTo);
    else localStorage.removeItem(RETURN_KEY);
    window.location.href = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/auth/${provider}/start`;
  }

  return <div className="login-provider-actions" aria-label="選擇登入方式">
    <button className="login-provider google" onClick={() => login('google')}>使用 Google 登入</button>
    <button className="login-provider line" onClick={() => login('line')}>使用 LINE 登入</button>
    <button className="login-provider apple" onClick={() => login('apple')}>使用 Apple 登入</button>
    <p className="muted login-provider-note">Google、LINE 與 Apple 都只用來驗證登入；你的 AFTERTRACE 帳號以帳號 ID 識別。</p>
  </div>;
}
