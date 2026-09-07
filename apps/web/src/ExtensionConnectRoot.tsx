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

export function ExtensionConnectRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const connectTarget = useMemo(() => extensionConnectTarget(window.location), []);
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
      await sendExtensionSession({
        extensionId: connectTarget.extensionId,
        nonce: connectTarget.nonce,
        sessionToken: session,
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
      <h1>連接 Chrome 擴充功能</h1>
      <p className="muted">這個動作只會把你目前的 AFTERTRACE 登入工作階段交給你剛剛開啟的 AFTERTRACE 擴充功能，不會傳送 Google、LINE 或 Apple 的登入憑證。</p>

      {!connectTarget ? <div className="error">這個擴充功能連接請求無效，請回到 AFTERTRACE 擴充功能重新按一次「連接」。</div> : null}
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

export async function sendExtensionSession(input: {
  extensionId: string;
  nonce: string;
  sessionToken: string;
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
