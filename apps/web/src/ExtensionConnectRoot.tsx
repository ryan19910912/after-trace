import { useEffect, useMemo, useState } from 'react';
import { safeLoginReturn } from './login-return';

const SESSION_KEY = 'aftertrace.worklog.session';
const RETURN_KEY = 'aftertrace.worklog.returnTo';

type ChromeRuntime = {
  lastError?: { message?: string };
  sendMessage(
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ): void;
};

type ChromeBridge = { runtime?: ChromeRuntime };
type ConnectResponse = { ok?: unknown; error?: unknown };
type ExtensionSessionResponse = {
  ok?: unknown;
  error?: unknown;
  sessionToken?: unknown;
  expiresInSeconds?: unknown;
};

export function ExtensionConnectRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const connectTarget = useMemo(() => extensionConnectTarget(window.location), []);
  const storeUrl = safeChromeStoreUrl(import.meta.env.VITE_CHROME_EXTENSION_STORE_URL?.trim());
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const callback = hash.get('session')?.trim();
    if (!callback) return;
    localStorage.setItem(SESSION_KEY, callback);
    setSession(callback);
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }, []);

  function loginFirst() {
    const returnTo = safeLoginReturn(`${window.location.pathname}${window.location.search}`);
    if (returnTo) localStorage.setItem(RETURN_KEY, returnTo);
    window.location.href = '/login';
  }

  async function connect() {
    if (!session || !connectTarget) return;
    setBusy(true);
    setError(null);
    try {
      const extensionSession = await issueExtensionSession(apiBaseUrl, session);
      await sendExtensionSession({
        extensionId: connectTarget.extensionId,
        nonce: connectTarget.nonce,
        sessionToken: extensionSession.sessionToken,
        sessionExpiresAt: new Date(Date.now() + extensionSession.expiresInSeconds * 1000).toISOString(),
        apiBaseUrl,
        webAppUrl: window.location.origin,
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '擴充功能連接失敗');
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell fatal-shell">
    <section className="fatal-card login-card">
      <p className="eyebrow">AFTERTRACE</p>
      <h1>{connectTarget ? '連接 Chrome 擴充功能' : 'Chrome 擴充元件'}</h1>
      {connectTarget ? <p className="muted">這個動作會建立一個較短效的 AFTERTRACE 擴充功能工作階段，不會把 Google、LINE 或 Apple 的登入憑證交給擴充功能。</p> : <>
        <p className="muted">安裝 AFTERTRACE 擴充元件後，可以在瀏覽網頁時快速留下目前網址、文字、截圖與工作內容，不必先切回 AFTERTRACE。</p>
        {storeUrl ? <div className="stack"><a className="line-support-link" href={storeUrl} target="_blank" rel="noreferrer"><strong>安裝 Chrome 擴充元件</strong></a><p className="muted">安裝完成後，請從擴充元件內按「連接 AFTERTRACE」，再回到這裡完成帳號連接。</p></div> : <div className="worklog-notice">擴充元件功能已經實作，但目前專案尚未設定 Chrome Web Store 上架連結，所以還不能讓一般使用者一鍵安裝。完成 Chrome Web Store 上架後，只要設定 VITE_CHROME_EXTENSION_STORE_URL，這裡就會直接顯示安裝按鈕。</div>}
      </>}

      {error ? <div className="error">{error}</div> : null}
      {done ? <div className="worklog-notice">已連接。現在可以回到擴充功能選擇紀錄空間並快速記錄。</div> : null}

      {!session && connectTarget ? <button type="button" onClick={loginFirst}>先登入 AFTERTRACE</button> : null}
      {session && connectTarget && !done ? <button type="button" disabled={busy} onClick={() => void connect()}>{busy ? '連接中…' : '連接這個擴充功能'}</button> : null}
      <button type="button" className="ghost" onClick={() => { window.location.href = '/'; }}>回 AFTERTRACE</button>
    </section>
  </main>;
}

export function extensionConnectTarget(locationLike: Pick<Location, 'pathname' | 'search'>): {
  extensionId: string;
  nonce: string;
} | null {
  const safe = safeLoginReturn(`${locationLike.pathname}${locationLike.search}`);
  if (!safe?.startsWith('/extension/connect?')) return null;
  const params = new URLSearchParams(safe.slice(safe.indexOf('?') + 1));
  const extensionId = params.get('extensionId');
  const nonce = params.get('nonce');
  return extensionId && nonce ? { extensionId, nonce } : null;
}

export async function issueExtensionSession(
  apiBaseUrl: string,
  webSessionToken: string,
): Promise<{ sessionToken: string; expiresInSeconds: number }> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/account/extension-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${webSessionToken}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let body: ExtensionSessionResponse;
  try {
    body = text ? JSON.parse(text) as ExtensionSessionResponse : {};
  } catch {
    throw new Error(`擴充功能工作階段建立失敗 (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `擴充功能工作階段建立失敗 (${response.status})`);
  }
  const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken.trim() : '';
  const expiresInSeconds = Number(body.expiresInSeconds);
  if (!sessionToken || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 60 * 60 * 24 * 7) {
    throw new Error('擴充功能工作階段回應無效');
  }
  return { sessionToken, expiresInSeconds };
}

export async function sendExtensionSession(input: {
  extensionId: string;
  nonce: string;
  sessionToken: string;
  sessionExpiresAt: string;
  apiBaseUrl: string;
  webAppUrl: string;
}): Promise<void> {
  const chromeBridge = (globalThis as unknown as { chrome?: ChromeBridge }).chrome;
  const runtime = chromeBridge?.runtime;
  if (!runtime?.sendMessage) {
    throw new Error('找不到 AFTERTRACE Chrome 擴充功能，請確認已安裝並從擴充功能重新發起連接。');
  }

  await new Promise<void>((resolve, reject) => {
    runtime.sendMessage(input.extensionId, {
      type: 'AFTERTRACE_EXTENSION_CONNECT',
      nonce: input.nonce,
      sessionToken: input.sessionToken,
      sessionExpiresAt: input.sessionExpiresAt,
      apiBaseUrl: input.apiBaseUrl,
      webAppUrl: input.webAppUrl,
    }, (response) => {
      const runtimeError = runtime.lastError?.message;
      if (runtimeError) {
        reject(new Error('擴充功能沒有回應，請回到擴充功能重新發起連接。'));
        return;
      }
      const body = response as ConnectResponse | undefined;
      if (!body || body.ok !== true) {
        reject(new Error(typeof body?.error === 'string' ? body.error : '擴充功能拒絕了這次連接。'));
        return;
      }
      resolve();
    });
  });
}

function safeChromeStoreUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)chromewebstore\.google\.com$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}
