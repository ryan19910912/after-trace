import { useEffect, useMemo, useState } from 'react';
import { WorklogApi } from './worklog-api';
import './worklog.css';

const SESSION_KEY = 'aftertrace.worklog.session';
const RETURN_KEY = 'aftertrace.worklog.returnTo';

export function FeedbackRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const callback = hash.get('session')?.trim();
    if (callback) {
      localStorage.setItem(SESSION_KEY, callback);
      setSession(callback);
      history.replaceState({}, document.title, `${location.pathname}${location.search}`);
    }
  }, []);

  async function submit() {
    if (!session || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitFeedback(session, text.trim(), {
        page: location.pathname,
        viewport: `${innerWidth}x${innerHeight}`,
        userAgent: navigator.userAgent,
        appVersion: 'worklog-web-pwa',
      });
      setDone(true);
      setText('');
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setDone(false);
        setError('登入已過期，請重新登入 AFTERTRACE 後再送出回饋。');
      } else {
        setError(cause instanceof Error ? cause.message : '回饋送出失敗');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <main className="shell fatal-shell">
    <section className="fatal-card">
      <p className="eyebrow">AFTERTRACE</p>
      <h1>意見回饋</h1>
      <p className="muted">登入後可把問題、建議或覺得不好用的地方直接送給我們。</p>
      {error ? <div className="error">{error}</div> : null}
      <button onClick={() => {
        localStorage.setItem(RETURN_KEY, '/feedback');
        location.href = api.lineLoginUrl();
      }}>登入 AFTERTRACE</button>
    </section>
  </main>;

  return <main className="shell worklog-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>意見回饋</h1></div><button className="ghost" onClick={() => { location.href = '/'; }}>回紀錄</button></div>
    {error ? <div className="error">{error}</div> : null}
    {done ? <div className="worklog-notice">已收到你的回饋，謝謝。</div> : null}
    <section className="panel feedback-panel">
      <h2>哪裡可以更好？</h2>
      <p className="muted">例如：字太小、操作不好找、搜尋結果不符合預期、希望增加什麼功能。</p>
      <textarea rows={8} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} placeholder="直接寫下你的想法…" />
      <button disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? '送出中…' : '送出回饋'}</button>
    </section>
  </main>;
}

function isSessionError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text);
}
