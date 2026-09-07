import { useEffect, useState } from 'react';
import {
  fetchLoginProviderAvailability,
  LOGIN_PROVIDER_FALLBACK,
  type LoginProviderAvailability,
} from './login-provider-availability';

const RETURN_KEY = 'aftertrace.worklog.returnTo';

export function LoginProviderButtons({
  apiBaseUrl,
  returnTo,
}: {
  apiBaseUrl: string;
  returnTo?: '/capture' | '/subscription' | '/feedback' | '/tasks';
}) {
  const [providers, setProviders] = useState<LoginProviderAvailability>(LOGIN_PROVIDER_FALLBACK);

  useEffect(() => {
    let active = true;
    void fetchLoginProviderAvailability(apiBaseUrl)
      .then((next) => { if (active) setProviders(next); })
      .catch(() => { if (active) setProviders(LOGIN_PROVIDER_FALLBACK); });
    return () => { active = false; };
  }, [apiBaseUrl]);

  function login(provider: 'google' | 'line' | 'apple') {
    if (returnTo) localStorage.setItem(RETURN_KEY, returnTo);
    else localStorage.removeItem(RETURN_KEY);
    window.location.href = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/auth/${provider}/start`;
  }

  const anyProvider = providers.google || providers.line || providers.apple;

  return <div className="login-provider-actions" aria-label="選擇登入方式">
    {providers.google ? <button className="login-provider google" onClick={() => login('google')}>使用 Google 登入</button> : null}
    {providers.line ? <button className="login-provider line" onClick={() => login('line')}>使用 LINE 登入</button> : null}
    {providers.apple ? <button className="login-provider apple" onClick={() => login('apple')}>使用 Apple 登入</button> : null}
    {!anyProvider ? <p className="error">登入服務目前尚未設定完成，請稍後再試。</p> : null}
    <p className="muted login-provider-note">登入服務只用來驗證身份；你的 AFTERTRACE 帳號仍以帳號 ID 識別，不會因 Email 相同而自動合併。</p>
  </div>;
}
