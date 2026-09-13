import { useEffect, useMemo, useState } from 'react';
import { LoginProviderButtons } from './LoginProviderButtons';
import { WorklogApi } from './worklog-api';
import './worklog.css';
import './feedback.css';

const SESSION_KEY = 'aftertrace.worklog.session';
type FeedbackCategory = 'BUG' | 'FEATURE' | 'UX' | 'OTHER';
const CATEGORIES: Array<{ value: FeedbackCategory; label: string; help: string }> = [
  { value: 'BUG', label: '問題回報', help: '錯誤、無法使用、結果異常' },
  { value: 'FEATURE', label: '功能建議', help: '希望新增或改善功能' },
  { value: 'UX', label: '使用體驗', help: '操作流程、介面、可用性' },
  { value: 'OTHER', label: '其他', help: '其他想告訴我們的事' },
];

export function FeedbackRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  const api = useMemo(() => new WorklogApi(apiBaseUrl), [apiBaseUrl]);
  const [session, setSession] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [category, setCategory] = useState<FeedbackCategory>('BUG');
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
    setBusy(true); setError(null);
    try {
      await api.submitFeedback(session, text.trim(), {
        category,
        page: location.pathname,
        viewport: `${innerWidth}x${innerHeight}`,
        userAgent: navigator.userAgent,
        appVersion: 'worklog-web-pwa',
      });
      setDone(true); setText('');
    } catch (cause) {
      if (isSessionError(cause)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setDone(false);
        setError('登入已過期，請重新登入 AFTERTRACE 後再送出回饋。');
      } else {
        setError(cause instanceof Error ? cause.message : '回饋送出失敗');
      }
    } finally { setBusy(false); }
  }

  if (!session) return <main className="shell fatal-shell"><section className="fatal-card">
    <p className="eyebrow">AFTERTRACE</p><h1>意見回饋</h1><p className="muted">登入後可以把使用上的問題、建議或想新增的功能告訴我們。</p>
    {error ? <div className="error">{error}</div> : null}<LoginProviderButtons apiBaseUrl={apiBaseUrl} returnTo="/feedback" />
  </section></main>;

  return <main className="shell worklog-shell feedback-root-shell">
    <div className="topbar"><div><p className="eyebrow">AFTERTRACE</p><h1>意見回饋</h1></div></div>
    {error ? <div className="error">{error}</div> : null}{done ? <div className="worklog-notice">已收到你的回饋，謝謝。</div> : null}
    <section className="panel feedback-panel">
      <h2>您的意見，是促進我們進步的動力！</h2>
      <p className="muted">先選擇回饋類別，再寫下實際遇到的情況或建議，方便我們更快整理與處理。</p>
      <div className="feedback-category-options" role="radiogroup" aria-label="回饋類別">
        {CATEGORIES.map((item) => <label className="feedback-category-option" key={item.value}><input type="radio" name="feedback-category" value={item.value} checked={category === item.value} onChange={() => setCategory(item.value)} /><span><strong>{item.label}</strong><small>{item.help}</small></span></label>)}
      </div>
      <textarea rows={8} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} placeholder="直接寫下你的想法…" />
      <button disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? '送出中…' : '送出回饋'}</button>
    </section>
  </main>;
}

function isSessionError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text);
}
