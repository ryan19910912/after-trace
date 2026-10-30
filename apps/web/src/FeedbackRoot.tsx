import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [receipt,setReceipt]=useState('');const [items,setItems]=useState<Awaited<ReturnType<WorklogApi['ownFeedback']>>['feedback']>([]);const [cursors,setCursors]=useState<Array<string|null>>([null]);const [page,setPage]=useState(0);const [nextCursor,setNextCursor]=useState<string|null>(null);const [historyBusy,setHistoryBusy]=useState(false);const [historyError,setHistoryError]=useState('');const [reload,setReload]=useState(0);const historyGeneration=useRef(0);
  useEffect(()=>{if(!session)return;const current=++historyGeneration.current;setHistoryBusy(true);setHistoryError('');void api.ownFeedback(session,cursors[page]).then(result=>{if(current!==historyGeneration.current)return;setItems(result.feedback);setNextCursor(result.page.nextCursor);}).catch((cause:unknown)=>{if(current!==historyGeneration.current)return;if(isSessionError(cause)){localStorage.removeItem(SESSION_KEY);setSession(null);}setHistoryError(cause instanceof Error?cause.message:'回饋紀錄載入失敗');}).finally(()=>{if(current===historyGeneration.current)setHistoryBusy(false);});return()=>{historyGeneration.current++;};},[api,session,page,cursors,reload]);

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
      const result=await api.submitFeedback(session, text.trim(), {
        category,
        page: location.pathname,
        viewport: `${innerWidth}x${innerHeight}`,
        userAgent: navigator.userAgent,
        appVersion: 'worklog-web-pwa',
      });
      setDone(true);setReceipt(result.feedback.id);setCursors([null]);setPage(0);setReload(v=>v+1); setText('');
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
    {error ? <div className="error">{error}</div> : null}{done ? <div className="worklog-notice">已收到你的回饋 #{receipt}，可在下方查看處理進度。</div> : null}
    <section className="panel feedback-panel">
      <h2>您的意見，是促進我們進步的動力！</h2>
      <p className="muted">先選擇回饋類別，再寫下實際遇到的情況或建議，方便我們更快整理與處理。</p>
      <div className="feedback-category-options" role="radiogroup" aria-label="回饋類別">
        {CATEGORIES.map((item) => <label className="feedback-category-option" key={item.value}><input type="radio" name="feedback-category" value={item.value} checked={category === item.value} onChange={() => setCategory(item.value)} /><span><strong>{item.label}</strong><small>{item.help}</small></span></label>)}
      </div>
      <textarea aria-label="回饋內容" rows={8} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} placeholder="直接寫下你的想法…" />
      <button disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? '送出中…' : '送出回饋'}</button>
    </section>
    <section className="panel feedback-panel" aria-label="我的回饋紀錄"><div className="topbar"><h2>我的回饋</h2><button className="ghost" disabled={historyBusy} onClick={()=>{setPage(0);setCursors([null]);setReload(v=>v+1);}}>更新處理進度</button></div><p className="muted">只顯示你送出的回饋；狀態更新後可在這裡查看。</p>{historyError&&<p role="alert" className="error">{historyError}<button onClick={()=>setReload(v=>v+1)}>重試載入回饋</button></p>}{historyBusy?<p role="status">載入回饋紀錄中…</p>:items.length?items.map(item=><article key={item.id} className="feedback-history-item"><header><strong>回饋 #{item.id}</strong><span>{({OPEN:'待處理',IN_PROGRESS:'處理中',RESOLVED:'已解決',IGNORED:'已結案'} as Record<string,string>)[item.status]??'待確認'}</span></header><p>{item.text.length>160?item.text.slice(0,160)+'…':item.text}</p>{item.text.length>160&&<details><summary>查看完整回饋</summary><p>{item.text}</p></details>}<small>送出於 {new Date(item.created_at).toLocaleString('zh-TW')} · 更新於 {new Date(item.updated_at).toLocaleString('zh-TW')}</small></article>):!historyError&&<p>尚未送出回饋。</p>}<nav className="feedback-pagination" aria-label="回饋紀錄分頁"><button disabled={historyBusy||page===0} onClick={()=>setPage(v=>v-1)}>上一頁</button><span>第 {page+1} 頁</span><button disabled={historyBusy||!nextCursor} onClick={()=>{setCursors(v=>[...v.slice(0,page+1),nextCursor]);setPage(v=>v+1);}}>下一頁</button></nav></section>
  </main>;
}

function isSessionError(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause ?? '');
  return /INVALID_WEB_SESSION|WEB_SESSION_REQUIRED/.test(text);
}
